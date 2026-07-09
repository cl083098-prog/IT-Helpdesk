<?php
/**
 * api/generate_report.php
 * ------------------------------------------------------------------
 * Central Report Generator for CSMA IT Helpdesk Portal.
 *
 * Query parameters:
 *   report_type  : ServiceRequest | Inventory | EquipmentFailures |
 *                  CostAnalysis   | BudgetPlanning | UserManagement |
 *                  Feedback       | ActivityLog
 *   date_from    : YYYY-MM-DD (optional)
 *   date_to      : YYYY-MM-DD (optional)
 *   export_format: PDF | Excel | CSV
 *   user_id      : integer (who is generating; used to log the report)
 *   role         : admin | school_admin  (controls default report set)
 *
 * Behaviour:
 *   PDF   -> streams a print-ready HTML page (auto window.print()).
 *            The user selects "Save as PDF" in the print dialog.
 *   Excel -> streams an HTML table with the .xls MIME type.
 *   CSV   -> streams a native CSV (fputcsv).
 *
 *   In every case the file starts with the FORMAL HEADER:
 *      School logo | "Colegio De Santa Monica De Angat"
 *                    "IT Helpdesk Portal Report"
 *                    <specific report type>
 *
 *   Every successful generation is logged into `generated_reports`
 *   and into `audit_log` (Reports / Generate).
 * ------------------------------------------------------------------
 */

require_once __DIR__ . '/config.php';

// ── Ensure timestamps are in Philippine Standard Time (UTC+8) ──
date_default_timezone_set('Asia/Manila');
try { $pdo->exec("SET time_zone = '+08:00'"); } catch (PDOException $e) {}

// ---------- Lightweight JSON action: recent reports listing --------
if (($_GET['action'] ?? '') === 'recent') {
    header('Content-Type: application/json');
    $uid  = (int)($_GET['user_id'] ?? 0);
    $role = trim($_GET['role'] ?? '');
    try {
        if ($role === 'admin' && $uid > 0) {
            // IT Admin sees only their own reports
            $stmt = $pdo->prepare(
                "SELECT id, report_name, report_type, export_format, created_at
                 FROM generated_reports
                 WHERE generated_by = :uid
                 ORDER BY created_at DESC LIMIT 25"
            );
            $stmt->execute([':uid' => $uid]);
        } else {
            $stmt = $pdo->query(
                "SELECT id, report_name, report_type, export_format, created_at
                 FROM generated_reports
                 ORDER BY created_at DESC LIMIT 25"
            );
        }
        echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage(), 'data' => []]);
    }
    exit;
}

// ---------- Input --------------------------------------------------
$reportType  = trim($_GET['report_type']   ?? 'ServiceRequest');
$dateFrom    = trim($_GET['date_from']     ?? '');
$dateTo      = trim($_GET['date_to']       ?? '');
$exportFmt   = strtoupper(trim($_GET['export_format'] ?? 'PDF'));
$userId      = (int)($_GET['user_id']      ?? 0);
$role        = trim($_GET['role']          ?? 'admin');

// Basic validation ---------------------------------------------------
$allowedTypes = [
    'ServiceRequest'    => 'Service Request Report',
    'Inventory'         => 'Inventory Status Report',
    'EquipmentFailures' => 'Equipment Failures Analysis',
    'CostAnalysis'      => 'Cost Analysis Report',
    'BudgetPlanning'    => 'Budget Planning Report',
    'UserManagement'    => 'User Management Report',
    'Feedback'          => 'Feedback Report',
    'ActivityLog'       => 'Activity Log Report',
];
if (!isset($allowedTypes[$reportType])) {
    http_response_code(400);
    exit('Invalid report type.');
}
if (!in_array($exportFmt, ['PDF', 'EXCEL', 'CSV'], true)) {
    http_response_code(400);
    exit('Invalid export format.');
}
if ($dateFrom && !DateTime::createFromFormat('Y-m-d', $dateFrom)) $dateFrom = '';
if ($dateTo   && !DateTime::createFromFormat('Y-m-d', $dateTo))   $dateTo   = '';

$reportTitle = $allowedTypes[$reportType];

// A request is a "view" (not a fresh generation) if EITHER:
//   (a) the caller passed ?view=1 / ?mode=view, OR
//   (b) an identical report (same user + type + range + format) was
//       already logged in the last 60 seconds — this catches the case
//       where the client-side view=1 flag was lost (cached JS, direct
//       link, etc.) and prevents duplicate Recent-Reports entries.
$isView = !empty($_GET['view']) || (($_GET['mode'] ?? '') === 'view');

if (!$isView && $userId > 0) {
    try {
        $dupe = $pdo->prepare(
            "SELECT id FROM generated_reports
             WHERE generated_by  = :uid
               AND report_type   = :type
               AND IFNULL(date_from,'') = :df
               AND IFNULL(date_to  ,'') = :dt
               AND UPPER(export_format) = :fmt
               AND created_at > (NOW() - INTERVAL 60 SECOND)
             LIMIT 1"
        );
        $dupe->execute([
            ':uid'  => $userId,
            ':type' => $reportType,
            ':df'   => $dateFrom,
            ':dt'   => $dateTo,
            ':fmt'  => strtoupper($exportFmt),
        ]);
        if ($dupe->fetchColumn()) {
            $isView = true;   // duplicate within 60s window → treat as re-view
        }
    } catch (PDOException $e) { /* non-fatal */ }
}

// ---------- Fetch data --------------------------------------------
$data = fetchReportData($pdo, $reportType, $dateFrom, $dateTo);

// ---------- Log (only for fresh generations) ----------------------
$reportName = $reportTitle
            . ($dateFrom ? " ({$dateFrom} to " . ($dateTo ?: 'now') . ')' : '')
            . ' - ' . $exportFmt;

if (!$isView) {
    try {
    $pdo->prepare(
        "INSERT INTO generated_reports (generated_by, report_name, report_type, date_from, date_to, export_format)
         VALUES (:by, :name, :type, :df, :dt, :fmt)"
    )->execute([
        ':by'   => $userId ?: null,
        ':name' => $reportName,
        ':type' => $reportType,
        ':df'   => $dateFrom ?: null,
        ':dt'   => $dateTo   ?: null,
        ':fmt'  => ucfirst(strtolower($exportFmt)),
    ]);

    // Audit trail
    $userName = 'System';
    if ($userId) {
        $u = $pdo->prepare("SELECT full_name FROM users WHERE id = :id");
        $u->execute([':id' => $userId]);
        $userName = $u->fetchColumn() ?: 'System';
    }
    $pdo->prepare(
        "INSERT INTO audit_log (user_name, user_role, module, action, status, detail)
         VALUES (:un, :ur, 'Reports', :ac, 'Success', :dt)"
    )->execute([
        ':un' => $userName,
        ':ur' => $role,
        ':ac' => 'Generated ' . $reportTitle,
        ':dt' => 'Format: ' . $exportFmt . ' | Range: ' . ($dateFrom ?: 'ALL') . ' to ' . ($dateTo ?: 'ALL'),
    ]);
} catch (PDOException $e) {
    // Non-fatal: continue even if logging fails.
}
}

// ---------- Emit --------------------------------------------------
$fileBase = preg_replace('/[^A-Za-z0-9]+/', '_', $reportTitle) . '_' . date('Ymd_His');

switch ($exportFmt) {
    case 'CSV':
        emitCsv($fileBase, $reportTitle, $dateFrom, $dateTo, $data);
        break;
    case 'EXCEL':
        emitExcel($fileBase, $reportTitle, $dateFrom, $dateTo, $data);
        break;
    default:
        emitPdf($fileBase, $reportTitle, $dateFrom, $dateTo, $data);
}
exit;

/* ================================================================
 * ============  DATA FETCHERS  ===================================
 * ============================================================== */
function fetchReportData(PDO $pdo, string $type, string $df, string $dt): array
{
    switch ($type) {
        case 'ServiceRequest':    return fetchServiceRequests($pdo, $df, $dt);
        case 'Inventory':         return fetchInventory($pdo);
        case 'EquipmentFailures': return fetchEquipmentFailures($pdo, $df, $dt);
        case 'CostAnalysis':      return fetchCostAnalysis($pdo, $df, $dt);
        case 'BudgetPlanning':    return fetchBudgetPlanning($pdo, $df, $dt);
        case 'UserManagement':    return fetchUsers($pdo);
        case 'Feedback':          return fetchFeedback($pdo, $df, $dt);
        case 'ActivityLog':       return fetchActivityLog($pdo, $df, $dt);
    }
    return ['columns' => [], 'rows' => [], 'summary' => []];
}

/** Build a WHERE fragment that limits a date column by [df, dt]. */
function dateWhere(string $col, string $df, string $dt, array &$params): string
{
    $w = [];
    if ($df) { $w[] = "DATE($col) >= :df"; $params[':df'] = $df; }
    if ($dt) { $w[] = "DATE($col) <= :dt"; $params[':dt'] = $dt; }
    return $w ? implode(' AND ', $w) : '';
}

// -- Service Requests ---------------------------------------------
function fetchServiceRequests(PDO $pdo, string $df, string $dt): array
{
    $params = [];
    $dw = dateWhere('t.submitted_at', $df, $dt, $params);
    $where = $dw ? "WHERE $dw" : '';

    $sql = "SELECT t.ticket_code, t.title, t.category, t.request_type,
                   u.full_name AS requester, d.name AS department,
                   t.priority, t.status, t.approval_status,
                   t.submitted_at, t.completed_at,
                   CASE
                     WHEN t.completed_at IS NOT NULL
                       THEN TIMESTAMPDIFF(HOUR, t.submitted_at, t.completed_at)
                     ELSE NULL
                   END AS resolution_hours,
                   CASE
                     WHEN t.resolution_due_at IS NULL THEN 'N/A'
                     WHEN t.completed_at IS NULL AND NOW() > t.resolution_due_at THEN 'Breached'
                     WHEN t.completed_at IS NOT NULL AND t.completed_at > t.resolution_due_at THEN 'Breached'
                     ELSE 'Met'
                   END AS sla_compliance
            FROM tickets t
            JOIN users u       ON u.id = t.requester_id
            JOIN departments d ON d.id = t.department_id
            $where
            ORDER BY t.submitted_at DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Summary counts
    $sumParams = $params;
    $sumSql = "SELECT status, COUNT(*) cnt FROM tickets t "
            . ($dw ? "WHERE $dw" : '') . " GROUP BY status";
    $sumStmt = $pdo->prepare($sumSql);
    $sumStmt->execute($sumParams);
    $counts = [];
    foreach ($sumStmt->fetchAll() as $r) $counts[$r['status']] = (int)$r['cnt'];

    return [
        'columns' => ['Ticket Code','Title','Category','Request Type','Requester',
                      'Department','Priority','Status','Approval','Submitted',
                      'Completed','Resolution (hrs)','SLA'],
        'rows' => array_map(fn($r) => [
            $r['ticket_code'], $r['title'], $r['category'], $r['request_type'],
            $r['requester'], $r['department'], $r['priority'], $r['status'],
            $r['approval_status'], $r['submitted_at'], $r['completed_at'] ?: '-',
            $r['resolution_hours'] ?? '-', $r['sla_compliance'],
        ], $rows),
        'summary' => [
            'Total Requests' => array_sum($counts),
            'Pending'        => $counts['Pending']   ?? 0,
            'Ongoing'        => $counts['Ongoing']   ?? 0,
            'Completed'      => $counts['Completed'] ?? 0,
            'Closed'         => $counts['Closed']    ?? 0,
        ],
    ];
}

// -- Inventory -----------------------------------------------------
function fetchInventory(PDO $pdo): array
{
    $sql = "SELECT item_name, category, quantity, price_unit,
                   (quantity * price_unit) AS total_value,
                   low_stock_pct, oversupply_threshold,
                   CASE
                     WHEN quantity <= (low_stock_pct/100) * oversupply_threshold THEN 'Low Stock'
                     WHEN quantity >= oversupply_threshold THEN 'Oversupply'
                     ELSE 'Normal'
                   END AS stock_status
            FROM inventory
            ORDER BY category, item_name";
    $rows = $pdo->query($sql)->fetchAll();

    $totalValue = 0; $lowStock = 0;
    foreach ($rows as $r) {
        $totalValue += (float)$r['total_value'];
        if ($r['stock_status'] === 'Low Stock') $lowStock++;
    }

    return [
        'columns' => ['Item Name','Category','Quantity','Unit Price (PHP)',
                      'Total Value (PHP)','Stock Status'],
        'rows' => array_map(fn($r) => [
            $r['item_name'], $r['category'], $r['quantity'],
            number_format((float)$r['price_unit'], 2),
            number_format((float)$r['total_value'], 2),
            $r['stock_status'],
        ], $rows),
        'summary' => [
            'Total Items'     => count($rows),
            'Low Stock Items' => $lowStock,
            'Total Value'     => 'PHP ' . number_format($totalValue, 2),
        ],
    ];
}

// -- Equipment Failures -------------------------------------------
function fetchEquipmentFailures(PDO $pdo, string $df, string $dt): array
{
    $params = [];
    $dw = dateWhere('t.submitted_at', $df, $dt, $params);
    $where = "WHERE t.request_type = 'Hardware Issue'" . ($dw ? " AND $dw" : '');

    $sql = "SELECT t.equipment_item, t.category, COUNT(*) AS failure_count,
                   MIN(t.submitted_at) AS first_failure,
                   MAX(t.submitted_at) AS last_failure,
                   COALESCE(SUM(ta.estimated_cost), 0) AS total_cost
            FROM tickets t
            LEFT JOIN ticket_approvals ta ON ta.ticket_id = t.id AND ta.decision='Approved'
            $where
            GROUP BY t.equipment_item, t.category
            ORDER BY failure_count DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    return [
        'columns' => ['Equipment','Category','Failure Count','First Failure',
                      'Last Failure','Total Cost (PHP)'],
        'rows' => array_map(fn($r) => [
            $r['equipment_item'] ?: '-', $r['category'], $r['failure_count'],
            $r['first_failure'], $r['last_failure'],
            number_format((float)$r['total_cost'], 2),
        ], $rows),
        'summary' => [
            'Distinct Equipment' => count($rows),
            'Total Failures'     => array_sum(array_column($rows, 'failure_count')),
        ],
    ];
}

// -- Cost Analysis -------------------------------------------------
function fetchCostAnalysis(PDO $pdo, string $df, string $dt): array
{
    $params = [];
    $dw = dateWhere('t.submitted_at', $df, $dt, $params);
    $where = "WHERE ta.decision='Approved' AND ta.estimated_cost IS NOT NULL"
           . ($dw ? " AND $dw" : '');

    $sql = "SELECT d.name AS department, t.request_type, t.category,
                   COUNT(*) AS ticket_count,
                   SUM(ta.estimated_cost) AS total_cost
            FROM ticket_approvals ta
            JOIN tickets t     ON t.id = ta.ticket_id
            JOIN departments d ON d.id = t.department_id
            $where
            GROUP BY d.name, t.request_type, t.category
            ORDER BY total_cost DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $grand = 0; $repair = 0; $maint = 0; $repl = 0;
    foreach ($rows as $r) {
        $c = (float)$r['total_cost'];
        $grand += $c;
        if ($r['request_type'] === 'Hardware Issue')      $repair += $c;
        elseif ($r['request_type'] === 'Maintenance')     $maint  += $c;
        elseif ($r['request_type'] === 'Installation')    $repl   += $c;
    }

    return [
        'columns' => ['Department','Request Type','Category','Tickets','Total Cost (PHP)'],
        'rows' => array_map(fn($r) => [
            $r['department'], $r['request_type'], $r['category'], $r['ticket_count'],
            number_format((float)$r['total_cost'], 2),
        ], $rows),
        'summary' => [
            'Repair Costs'      => 'PHP ' . number_format($repair, 2),
            'Maintenance Costs' => 'PHP ' . number_format($maint, 2),
            'Replacement Costs' => 'PHP ' . number_format($repl, 2),
            'Grand Total'       => 'PHP ' . number_format($grand, 2),
        ],
    ];
}

// -- Budget Planning (predictive using historical averages) --------
function fetchBudgetPlanning(PDO $pdo, string $df, string $dt): array
{
    // Base historical average per department (last 12 months if no range given).
    $sql = "SELECT d.name AS department,
                   COALESCE(SUM(ta.estimated_cost), 0) AS historical_cost,
                   COUNT(DISTINCT DATE_FORMAT(t.submitted_at, '%Y-%m')) AS months_span
            FROM departments d
            LEFT JOIN tickets t          ON t.department_id = d.id
            LEFT JOIN ticket_approvals ta ON ta.ticket_id = t.id AND ta.decision='Approved'
            WHERE (t.submitted_at IS NULL OR t.submitted_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH))
            GROUP BY d.name
            ORDER BY historical_cost DESC";
    $rows = $pdo->query($sql)->fetchAll();

    // Predict next-quarter budget = 3 * monthly average * 1.10 (10% inflation buffer).
    $out = [];
    $grandCurrent = 0; $grandPredicted = 0;
    foreach ($rows as $r) {
        $months = max(1, (int)$r['months_span']);
        $monthlyAvg = (float)$r['historical_cost'] / $months;
        $predicted  = round($monthlyAvg * 3 * 1.10, 2);
        $current    = round($monthlyAvg * 3, 2);
        $grandCurrent   += $current;
        $grandPredicted += $predicted;
        $out[] = [
            $r['department'],
            number_format($current, 2),
            number_format($predicted, 2),
            ($current > 0 ? '+' . round(($predicted - $current) / $current * 100, 1) . '%' : 'N/A'),
        ];
    }

    return [
        'columns' => ['Department','Current Quarter Est. (PHP)','Predicted Next Quarter (PHP)','Trend'],
        'rows'    => $out,
        'summary' => [
            'Current Quarter Total'   => 'PHP ' . number_format($grandCurrent, 2),
            'Predicted Next Quarter'  => 'PHP ' . number_format($grandPredicted, 2),
            'Inflation Buffer'        => '10%',
        ],
    ];
}

// -- User Management ----------------------------------------------
function fetchUsers(PDO $pdo): array
{
    // Detect optional columns (project has helpers for this elsewhere)
    $cols = $pdo->query("SHOW COLUMNS FROM users")->fetchAll(PDO::FETCH_COLUMN);
    $hasIsActive = in_array('is_active', $cols, true);
    $hasCreated  = in_array('created_at', $cols, true);
    $hasEmpId    = in_array('employee_id', $cols, true);

    $select = ['id', 'full_name', 'email', 'role', 'department'];
    if ($hasEmpId)    $select[] = 'employee_id';
    if ($hasIsActive) $select[] = 'is_active';
    if ($hasCreated)  $select[] = 'created_at';

    $rows = $pdo->query("SELECT " . implode(',', $select) . " FROM users ORDER BY role, full_name")
                ->fetchAll();

    $roleLabels = [
        'admin'        => 'IT Administrator',
        'requester'    => 'Faculty / Staff',
        'dept_head'    => 'Department Head',
        'school_admin' => 'School Admin',
    ];

    $out = [];
    $active = 0; $inactive = 0;
    foreach ($rows as $r) {
        $status = $hasIsActive ? ((int)$r['is_active'] ? 'Active' : 'Inactive') : 'Active';
        if ($status === 'Active') $active++; else $inactive++;
        $out[] = [
            $hasEmpId ? ($r['employee_id'] ?? '-') : $r['id'],
            $r['full_name'],
            $r['email'],
            $roleLabels[$r['role']] ?? $r['role'],
            $r['department'] ?? '-',
            $status,
            $hasCreated ? ($r['created_at'] ?? '-') : '-',
        ];
    }

    return [
        'columns' => ['Employee ID','Full Name','Email','Role','Department','Status','Date Joined'],
        'rows'    => $out,
        'summary' => [
            'Total Users' => count($rows),
            'Active'      => $active,
            'Inactive'    => $inactive,
        ],
    ];
}

// -- Feedback ------------------------------------------------------
function fetchFeedback(PDO $pdo, string $df, string $dt): array
{
    $params = [];
    $dw = dateWhere('f.submitted_at', $df, $dt, $params);
    $where = $dw ? "WHERE $dw" : '';

    $sql = "SELECT f.rating, f.comment, f.submitted_at, f.responded_at,
                   u.full_name AS requester, d.name AS department,
                   t.ticket_code
            FROM ticket_feedback f
            JOIN tickets t     ON t.id = f.ticket_id
            JOIN users u       ON u.id = t.requester_id
            JOIN departments d ON d.id = t.department_id
            $where
            ORDER BY f.submitted_at DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $total = count($rows); $sum = 0; $pos = 0; $neg = 0; $responded = 0;
    foreach ($rows as $r) {
        $sum += (int)$r['rating'];
        if ($r['rating'] >= 4) $pos++;
        if ($r['rating'] <= 2) $neg++;
        if ($r['responded_at']) $responded++;
    }
    $avg = $total ? round($sum / $total, 2) : 0;
    $respRate = $total ? round($responded / $total * 100, 1) . '%' : '0%';

    return [
        'columns' => ['Ticket','Requester','Department','Rating',
                      'Comment','Submitted','Responded'],
        'rows' => array_map(fn($r) => [
            $r['ticket_code'], $r['requester'], $r['department'],
            $r['rating'] . ' / 5', $r['comment'] ?: '-',
            $r['submitted_at'], $r['responded_at'] ?: 'Not yet',
        ], $rows),
        'summary' => [
            'Total Feedback' => $total,
            'Average Rating' => $avg . ' / 5',
            'Positive (4-5)' => $pos,
            'Negative (1-2)' => $neg,
            'Response Rate'  => $respRate,
        ],
    ];
}

// -- Activity Log --------------------------------------------------
function fetchActivityLog(PDO $pdo, string $df, string $dt): array
{
    $params = [];
    $dw = dateWhere('created_at', $df, $dt, $params);
    $where = $dw ? "WHERE $dw" : '';

    $sql = "SELECT id, created_at, user_name, user_role, module, action, status,
                   COALESCE(detail, '') AS detail
            FROM audit_log
            $where
            ORDER BY created_at DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $roleLabels = [
        'admin' => 'IT Administrator', 'requester' => 'Faculty / Staff',
        'dept_head' => 'Department Head', 'school_admin' => 'School Admin',
    ];

    $it = 0; $usr = 0; $today = 0;
    foreach ($rows as $r) {
        if ($r['user_role'] === 'admin') $it++;
        elseif ($r['user_role'] !== 'school_admin') $usr++;
        if (substr($r['created_at'], 0, 10) === date('Y-m-d')) $today++;
    }

    return [
        'columns' => ['Log ID','Timestamp','User','Role','Module','Action','Status','Details'],
        'rows' => array_map(fn($r) => [
            $r['id'], $r['created_at'], $r['user_name'],
            $roleLabels[$r['user_role']] ?? $r['user_role'],
            $r['module'], $r['action'], $r['status'], $r['detail'],
        ], $rows),
        'summary' => [
            'Total Activities'   => count($rows),
            'IT Admin Actions'   => $it,
            'User Actions'       => $usr,
            "Today's Activities" => $today,
        ],
    ];
}

/* ================================================================
 * ============  OUTPUT / FORMAL HEADER  ==========================
 * ============================================================== */

/** Return an absolute URL to the school logo (works for both PDF/Excel). */
function logoDataUri(): string
{
    $path = realpath(__DIR__ . '/../assets/images/csma_logo.png');
    if ($path && is_readable($path)) {
        $mime = 'image/png';
        return 'data:' . $mime . ';base64,' . base64_encode(file_get_contents($path));
    }
    return '';
}

function headerSubtitle(string $reportTitle, string $df, string $dt): string
{
    $range = ($df || $dt)
        ? 'Date Range: ' . ($df ?: 'Beginning') . ' to ' . ($dt ?: 'Present')
        : 'Date Range: All Records';
    return $range . ' &nbsp;|&nbsp; Generated: ' . date('F j, Y g:i A');
}

// -------- PDF (print-ready HTML) ---------------------------------
function emitPdf(string $fileBase, string $reportTitle,
                 string $df, string $dt, array $data): void
{
    header('Content-Type: text/html; charset=utf-8');

    $logo = logoDataUri();
    $dateRange = ($df || $dt)
        ? ($df ?: 'Beginning') . ' &ndash; ' . ($dt ?: 'Present')
        : 'All Records';
    $generated = date('F j, Y \a\t g:i A');

    // Excel/CSV download URLs re-use the current query string.
    $qs = $_SERVER['QUERY_STRING'] ?? '';
    $urlExcel = 'generate_report.php?' . preg_replace('/export_format=[^&]*/', 'export_format=EXCEL', $qs);
    $urlCsv   = 'generate_report.php?' . preg_replace('/export_format=[^&]*/', 'export_format=CSV',   $qs);

    echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">';
    echo '<title>' . htmlspecialchars($reportTitle) . ' &mdash; Preview</title>';
    echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
    echo '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">';
    echo '<style>' . reportCss() . '</style>';
    echo '</head><body>';

    // ══ Preview toolbar (system-styled) ════════════════════════
    echo '<div class="preview-shell no-print">';
    echo '<header class="preview-topbar">';
    echo '  <div class="preview-brand">';
    if ($logo) echo '    <img src="' . $logo . '" class="preview-brand-logo" alt="CSMA">';
    echo '    <div class="preview-brand-text">';
    echo '      <div class="preview-brand-title">CSMA IT Helpdesk Portal</div>';
    echo '      <div class="preview-brand-sub"><i class="fas fa-file-alt"></i> Report Preview &mdash; ' . htmlspecialchars($reportTitle) . '</div>';
    echo '    </div>';
    echo '  </div>';
    echo '  <div class="preview-actions">';
    echo '    <button class="pv-btn pv-btn-primary" onclick="window.print()"><i class="fas fa-print"></i> Print / Save as PDF</button>';
    echo '    <a class="pv-btn pv-btn-secondary" href="' . htmlspecialchars($urlExcel) . '"><i class="fas fa-file-excel"></i> Excel</a>';
    echo '    <a class="pv-btn pv-btn-secondary" href="' . htmlspecialchars($urlCsv) . '"><i class="fas fa-file-csv"></i> CSV</a>';
    echo '    <button class="pv-btn pv-btn-ghost" onclick="window.close()"><i class="fas fa-times"></i> Close</button>';
    echo '  </div>';
    echo '</header>';

    // ══ Preview status bar ══════════════════════════════════════
    echo '<div class="preview-statusbar">';
    echo '  <div><i class="fas fa-eye"></i> <strong>Preview Mode</strong> &mdash; This is exactly what will be printed or saved as PDF.</div>';
    echo '  <div class="pv-meta"><i class="fas fa-clock"></i> Generated ' . $generated . '</div>';
    echo '</div>';
    echo '</div>'; // /.preview-shell

    // ══ The actual document ═════════════════════════════════════
    echo '<div class="page-canvas">';
    echo '<div class="page">';

    // FORMAL HEADER ---------------------------------------------
    echo '<header class="doc-header">';
    echo '<div class="doc-header-inner">';
    if ($logo) {
        echo '<div class="doc-logo-wrap"><img class="doc-logo" src="' . $logo . '" alt="School Logo"></div>';
    }
    echo '<div class="doc-title-block">';
    echo '<div class="doc-school">Colegio De Santa Monica De Angat</div>';
    echo '<div class="doc-portal">IT Helpdesk Portal Report</div>';
    echo '</div>';
    echo '</div>';
    echo '<div class="doc-divider"></div>';
    echo '<div class="doc-meta-row">';
    echo '<div class="doc-report-type">' . htmlspecialchars($reportTitle) . '</div>';
    echo '<div class="doc-meta-info">';
    echo '<div><span class="meta-label">Date Range:</span> <span class="meta-value">' . $dateRange . '</span></div>';
    echo '<div><span class="meta-label">Generated:</span> <span class="meta-value">' . $generated . '</span></div>';
    echo '</div>';
    echo '</div>';
    echo '</header>';

    // SUMMARY ---------------------------------------------------
    if (!empty($data['summary'])) {
        echo '<section class="doc-section">';
        echo '<h4 class="section-title">Report Summary</h4>';
        echo '<div class="summary-grid">';
        foreach ($data['summary'] as $label => $val) {
            echo '<div class="summary-card">';
            echo '<div class="summary-label">' . htmlspecialchars((string)$label) . '</div>';
            echo '<div class="summary-value">' . htmlspecialchars((string)$val) . '</div>';
            echo '</div>';
        }
        echo '</div>';
        echo '</section>';
    }

    // DATA TABLE ------------------------------------------------
    $colCount = count($data['columns']);
    $tableCls = 'doc-table';
    if ($colCount >= 12)      $tableCls .= ' cols-xl';
    elseif ($colCount >= 9)   $tableCls .= ' cols-lg';
    elseif ($colCount >= 6)   $tableCls .= ' cols-md';

    echo '<section class="doc-section">';
    echo '<h4 class="section-title">Detailed Records <span class="record-count">(' . count($data['rows']) . ' record' . (count($data['rows']) === 1 ? '' : 's') . ')</span></h4>';
    echo '<div class="table-wrap">';
    echo '<table class="' . $tableCls . '"><thead><tr>';
    foreach ($data['columns'] as $c) echo '<th>' . htmlspecialchars($c) . '</th>';
    echo '</tr></thead><tbody>';
    if (!$data['rows']) {
        echo '<tr><td colspan="' . $colCount . '" class="empty">No records found for the selected criteria.</td></tr>';
    } else {
        foreach ($data['rows'] as $row) {
            echo '<tr>';
            foreach ($row as $cell) echo '<td>' . htmlspecialchars((string)$cell) . '</td>';
            echo '</tr>';
        }
    }
    echo '</tbody></table>';
    echo '</div>';
    echo '</section>';

    // FOOTER ----------------------------------------------------
    echo '<footer class="doc-footer">';
    echo '<div class="footer-line"></div>';
    echo '<p class="footer-text">&copy; ' . date('Y') . ' Colegio De Santa Monica De Angat &nbsp;&middot;&nbsp; IT Helpdesk Portal</p>';
    echo '<p class="footer-note">This is a system-generated report. For inquiries, contact the IT Administrator.</p>';
    echo '</footer>';

    echo '</div>'; // .page
    echo '</div>'; // .page-canvas

    // No auto-print. The user prints manually via the toolbar button.
    echo '</body></html>';
}

// -------- Excel (HTML .xls) --------------------------------------
function emitExcel(string $fileBase, string $reportTitle,
                   string $df, string $dt, array $data): void
{
    header('Content-Type: application/vnd.ms-excel; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $fileBase . '.xls"');
    header('Cache-Control: max-age=0');
    header('Pragma: public');

    $dateRange = ($df || $dt)
        ? ($df ?: 'Beginning') . ' to ' . ($dt ?: 'Present')
        : 'All Records';
    $generated = date('F j, Y \a\t g:i A');
    $colCount  = max(1, count($data['columns']));

    echo "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\"
                 xmlns:x=\"urn:schemas-microsoft-com:office:excel\"
                 xmlns=\"http://www.w3.org/TR/REC-html40\">";
    echo '<head>';
    echo '<meta http-equiv="Content-Type" content="application/vnd.ms-excel; charset=utf-8">';
    echo '<meta name="ProgId" content="Excel.Sheet">';
    echo '<meta name="Generator" content="CSMA IT Helpdesk Portal">';
    echo '<!--[if gte mso 9]>
          <xml>
              <x:ExcelWorkbook>
                  <x:ExcelWorksheets>
                      <x:ExcelWorksheet>
                          <x:Name>' . htmlspecialchars($reportTitle) . '</x:Name>
                          <x:WorksheetOptions>
                              <x:DisplayGridlines/>
                              <x:FreezePanes/>
                              <x:FrozenNoSplit/>
                              <x:SplitHorizontal>7</x:SplitHorizontal>
                              <x:TopRowBottomPane>7</x:TopRowBottomPane>
                              <x:ActivePane>2</x:ActivePane>
                          </x:WorksheetOptions>
                      </x:ExcelWorksheet>
                  </x:ExcelWorksheets>
                  <x:AllowPNG/>
              </x:ExcelWorkbook>
          </xml>
          <![endif]-->';

    // Excel-safe CSS ---------------------------------------------
    echo '<style>
        body           { font-family: Calibri, Arial, sans-serif; font-size:11pt; color:#1e2f3e; }
        table          { border-collapse:collapse; }
        td, th         { vertical-align:middle; mso-number-format:"\@"; }

        .h-school      { font-size:20pt; font-weight:bold; color:#1c4c6e;
                         font-family:Calibri,Arial,sans-serif; letter-spacing:-0.5pt; }
        .h-portal      { font-size:12pt; font-weight:bold; color:#1f6392; }
        .h-type        { font-size:14pt; font-weight:bold; color:#1c4c6e;
                         background:#f5f9fe; padding:8pt; }
        .h-meta        { font-size:9pt; color:#5a6c7d; padding:4pt 8pt;
                         background:#eaf2fb; }
        .h-meta b      { color:#1c4c6e; }
        .divider       { background:#1c4c6e; height:6px; padding:0; line-height:1px; font-size:1px; }

        .section-title { font-size:11pt; font-weight:bold; color:#1c4c6e;
                         background:#eef3fc; padding:6pt 8pt;
                         border-top:2px solid #1c4c6e; border-bottom:1px solid #cfd8e3; }

        .sum-label     { font-size:9pt; color:#7a8a99; font-weight:bold;
                         background:#f7fafd; padding:6pt 10pt;
                         border:1px solid #e4ebf2; }
        .sum-value     { font-size:12pt; color:#1c4c6e; font-weight:bold;
                         background:#ffffff; padding:6pt 10pt;
                         border:1px solid #e4ebf2; mso-number-format:General; }

        .tbl-header    { background:#1c4c6e; color:#ffffff; font-weight:bold;
                         font-size:10pt; padding:8pt 6pt; text-align:left;
                         border:1px solid #123a56; }
        .tbl-cell      { font-size:10pt; padding:6pt; border:1px solid #d8e0e8;
                         background:#ffffff; }
        .tbl-cell-alt  { font-size:10pt; padding:6pt; border:1px solid #d8e0e8;
                         background:#fafcfe; }
        .tbl-first     { color:#1c4c6e; font-weight:bold; }

        .footer-text   { font-size:9pt; color:#5a6c7d; padding:8pt;
                         background:#f5f9fe; text-align:center;
                         border-top:2px solid #1c4c6e; }
        .footer-note   { font-size:8pt; color:#95a5a6; padding:2pt 8pt 8pt;
                         background:#f5f9fe; text-align:center; font-style:italic; }
    </style>';
    echo '</head><body>';

    // ══ Column widths — evenly distribute across the sheet ══
    echo '<table border="0" cellpadding="0" cellspacing="0" width="100%">';
    echo '<colgroup>';
    for ($i = 0; $i < $colCount; $i++) {
        echo '<col width="120">';
    }
    echo '</colgroup>';

    // ══ FORMAL HEADER ══════════════════════════════════════════
    // Row 1: School name
    echo '<tr height="34"><td class="h-school" colspan="' . $colCount . '"
              style="padding:10pt 8pt 2pt;">Colegio De Santa Monica De Angat</td></tr>';

    // Row 2: Portal subtitle
    echo '<tr height="22"><td class="h-portal" colspan="' . $colCount . '"
              style="padding:0 0 8pt 8pt;">IT Helpdesk Portal Report</td></tr>';

    // Row 3: Navy divider band
    echo '<tr height="6"><td class="divider" colspan="' . $colCount . '">&nbsp;</td></tr>';

    // Row 4: Report Type
    echo '<tr height="30"><td class="h-type" colspan="' . $colCount . '">'
       . htmlspecialchars($reportTitle) . '</td></tr>';

    // Row 5: Metadata
    echo '<tr height="22"><td class="h-meta" colspan="' . $colCount . '">'
       . '<b>Date Range:</b> ' . htmlspecialchars($dateRange)
       . ' &nbsp;&nbsp;|&nbsp;&nbsp; '
       . '<b>Generated:</b> ' . htmlspecialchars($generated)
       . '</td></tr>';

    // Row 6: Spacer
    echo '<tr height="10"><td colspan="' . $colCount . '">&nbsp;</td></tr>';

    // ══ SUMMARY ═══════════════════════════════════════════════
    if (!empty($data['summary'])) {
        echo '<tr height="22"><td class="section-title" colspan="' . $colCount . '">REPORT SUMMARY</td></tr>';
        // 2-column label/value pairs, arranged in rows of 2 pairs per line if wide enough
        $labels = array_keys($data['summary']);
        $vals   = array_values($data['summary']);
        $pairsPerRow = ($colCount >= 4) ? 2 : 1;
        $chunks = array_chunk(array_map(null, $labels, $vals), $pairsPerRow);

        foreach ($chunks as $rowPairs) {
            echo '<tr height="26">';
            $used = 0;
            $spanPerPair = intdiv($colCount, count($rowPairs)); // e.g. 12 cols / 2 pairs = 6
            $labelSpan   = max(1, intdiv($spanPerPair, 3));      // 1/3 label, 2/3 value
            $valueSpan   = $spanPerPair - $labelSpan;
            foreach ($rowPairs as $pair) {
                [$label, $val] = $pair;
                echo '<td class="sum-label" colspan="' . $labelSpan . '">'
                   . htmlspecialchars((string)$label) . '</td>';
                echo '<td class="sum-value" colspan="' . $valueSpan . '">'
                   . htmlspecialchars((string)$val) . '</td>';
                $used += $spanPerPair;
            }
            // Pad if leftover columns
            if ($used < $colCount) {
                echo '<td colspan="' . ($colCount - $used) . '" style="border:1px solid #e4ebf2;background:#ffffff;">&nbsp;</td>';
            }
            echo '</tr>';
        }

        // Spacer
        echo '<tr height="10"><td colspan="' . $colCount . '">&nbsp;</td></tr>';
    }

    // ══ DETAILED RECORDS ══════════════════════════════════════
    echo '<tr height="22"><td class="section-title" colspan="' . $colCount . '">'
       . 'DETAILED RECORDS (' . count($data['rows']) . ' record'
       . (count($data['rows']) === 1 ? '' : 's') . ')</td></tr>';

    // Column headers
    echo '<tr height="30">';
    foreach ($data['columns'] as $c) {
        echo '<th class="tbl-header">' . htmlspecialchars($c) . '</th>';
    }
    echo '</tr>';

    // Data rows
    if (!$data['rows']) {
        echo '<tr><td class="tbl-cell" colspan="' . $colCount . '"
                  align="center" style="padding:20pt;color:#95a5a6;font-style:italic;">'
           . 'No records found for the selected criteria.</td></tr>';
    } else {
        $alt = false;
        foreach ($data['rows'] as $row) {
            $cls = $alt ? 'tbl-cell-alt' : 'tbl-cell';
            echo '<tr>';
            $first = true;
            foreach ($row as $cell) {
                $firstCls = $first ? ' tbl-first' : '';
                echo '<td class="' . $cls . $firstCls . '">'
                   . htmlspecialchars((string)$cell) . '</td>';
                $first = false;
            }
            echo '</tr>';
            $alt = !$alt;
        }
    }

    // Spacer
    echo '<tr height="14"><td colspan="' . $colCount . '">&nbsp;</td></tr>';

    // ══ FOOTER ════════════════════════════════════════════════
    echo '<tr height="24"><td class="footer-text" colspan="' . $colCount . '">'
       . '&copy; ' . date('Y') . ' Colegio De Santa Monica De Angat  &middot;  IT Helpdesk Portal'
       . '</td></tr>';
    echo '<tr height="20"><td class="footer-note" colspan="' . $colCount . '">'
       . 'This is a system-generated report. For inquiries, contact the IT Administrator.'
       . '</td></tr>';

    echo '</table>';
    echo '</body></html>';
}

// -------- CSV -----------------------------------------------------
function emitCsv(string $fileBase, string $reportTitle,
                 string $df, string $dt, array $data): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $fileBase . '.csv"');
    header('Cache-Control: max-age=0');

    $out = fopen('php://output', 'w');
    // UTF-8 BOM so Excel opens accents correctly
    fwrite($out, "\xEF\xBB\xBF");

    // Formal header (as leading text rows)
    fputcsv($out, ['Colegio De Santa Monica De Angat']);
    fputcsv($out, ['IT Helpdesk Portal Report']);
    fputcsv($out, [$reportTitle]);
    fputcsv($out, [strip_tags(str_replace('&nbsp;', ' ', headerSubtitle($reportTitle, $df, $dt)))]);
    fputcsv($out, []);

    // Summary block
    if (!empty($data['summary'])) {
        fputcsv($out, ['Summary']);
        foreach ($data['summary'] as $label => $val) fputcsv($out, [$label, $val]);
        fputcsv($out, []);
    }

    // Data
    fputcsv($out, $data['columns']);
    if (!$data['rows']) {
        fputcsv($out, ['No records found.']);
    } else {
        foreach ($data['rows'] as $row) fputcsv($out, $row);
    }
    fclose($out);
}

/* -------- Shared print CSS for PDF view -------------------------- */
function reportCss(): string
{
    return <<<CSS
    *{margin:0;padding:0;box-sizing:border-box;}
    html,body{background:#eef2f7;}
    body{
        font-family:'Inter','Segoe UI',Arial,sans-serif;
        color:#1e2f3e;font-size:13px;line-height:1.5;
        -webkit-font-smoothing:antialiased;
    }

    /* ══════════════════════════════════════════════════════════
       PREVIEW SHELL (matches CSMA dashboard top-bar aesthetic)
    ══════════════════════════════════════════════════════════ */
    .preview-shell{
        position:sticky;top:0;z-index:100;
        background:#f5f9fe;
        border-bottom:1px solid #e0e8f0;
        box-shadow:0 2px 12px rgba(28,76,110,.06);
    }
    .preview-topbar{
        display:flex;align-items:center;justify-content:space-between;
        gap:20px;padding:14px 32px;
        background:#fff;
        border-bottom:1px solid #eef3f8;
    }
    .preview-brand{
        display:flex;align-items:center;gap:14px;min-width:0;
    }
    .preview-brand-logo{
        width:42px;height:42px;object-fit:contain;flex-shrink:0;
    }
    .preview-brand-text{min-width:0;}
    .preview-brand-title{
        font-size:16px;font-weight:700;color:#1c4c6e;
        letter-spacing:-0.01em;line-height:1.2;
    }
    .preview-brand-sub{
        font-size:12px;color:#7a8a99;font-weight:500;margin-top:2px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    }
    .preview-brand-sub i{color:#1f6392;margin-right:4px;}

    .preview-actions{
        display:flex;align-items:center;gap:8px;flex-wrap:wrap;
    }
    .pv-btn{
        display:inline-flex;align-items:center;gap:7px;
        padding:9px 16px;border:none;border-radius:8px;
        font-family:inherit;font-size:12.5px;font-weight:600;
        cursor:pointer;text-decoration:none;
        transition:all .15s;
    }
    .pv-btn i{font-size:12px;}
    .pv-btn-primary{
        background:#1c4c6e;color:#fff;
        box-shadow:0 2px 6px rgba(28,76,110,.25);
    }
    .pv-btn-primary:hover{background:#123a56;transform:translateY(-1px);}
    .pv-btn-secondary{
        background:#f5f9fe;color:#1c4c6e;
        border:1px solid #d0dceb;
    }
    .pv-btn-secondary:hover{background:#eaf2fb;border-color:#1c4c6e;}
    .pv-btn-ghost{
        background:transparent;color:#7a8a99;
    }
    .pv-btn-ghost:hover{background:#f0f4f9;color:#c0392b;}

    .preview-statusbar{
        display:flex;align-items:center;justify-content:space-between;
        gap:16px;padding:9px 32px;
        background:linear-gradient(90deg,#eaf2fb 0%,#f5f9fe 100%);
        font-size:11.5px;color:#5a6c7d;
    }
    .preview-statusbar strong{color:#1c4c6e;}
    .preview-statusbar i{color:#1f6392;margin-right:4px;}
    .pv-meta{color:#7a8a99;}

    /* ══════════════════════════════════════════════════════════
       PAGE CANVAS  (the "sheet of paper" behind the document)
    ══════════════════════════════════════════════════════════ */
    .page-canvas{
        padding:32px 20px 60px;
        min-height:calc(100vh - 110px);
    }
    .page{
        max-width:1120px;margin:0 auto;background:#fff;
        border-radius:10px;
        box-shadow:0 4px 24px rgba(28,76,110,.08);
        overflow:hidden;
    }

    /* ── Document header ── */
    .doc-header{padding:32px 48px 0;}
    .doc-header-inner{
        display:flex;align-items:center;gap:24px;padding-bottom:20px;
    }
    .doc-logo-wrap{
        flex-shrink:0;width:88px;height:88px;
        display:flex;align-items:center;justify-content:center;
    }
    .doc-logo{max-width:100%;max-height:100%;object-fit:contain;}
    .doc-title-block{flex:1;min-width:0;}
    .doc-school{
        font-size:26px;font-weight:800;color:#1c4c6e;
        letter-spacing:-0.02em;line-height:1.15;
    }
    .doc-portal{
        margin-top:4px;font-size:15px;font-weight:600;color:#1f6392;
    }
    .doc-divider{
        height:3px;
        background:linear-gradient(90deg,#1c4c6e 0%,#1c4c6e 65%,#f3b400 100%);
        margin:0 -48px;
    }
    .doc-meta-row{
        display:flex;justify-content:space-between;align-items:flex-end;
        padding:20px 0 24px;gap:24px;flex-wrap:wrap;
    }
    .doc-report-type{
        font-size:18px;font-weight:700;color:#1c4c6e;letter-spacing:-0.01em;
    }
    .doc-meta-info{
        font-size:12px;color:#5a6c7d;text-align:right;line-height:1.7;
    }
    .meta-label{
        font-weight:600;color:#7a8a99;text-transform:uppercase;
        letter-spacing:.04em;font-size:10.5px;
    }
    .meta-value{color:#2c3e50;font-weight:500;}

    /* ── Sections ── */
    .doc-section{padding:0 48px 28px;}
    .section-title{
        font-size:12px;font-weight:700;color:#1c4c6e;
        text-transform:uppercase;letter-spacing:.08em;
        margin:0 0 14px;padding-bottom:8px;
        border-bottom:1px solid #e4ebf2;
        display:flex;align-items:baseline;justify-content:space-between;
    }
    .record-count{
        font-size:11px;font-weight:500;color:#7a8a99;
        letter-spacing:.02em;text-transform:none;
    }

    /* ── Summary cards ── */
    .summary-grid{
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(160px,1fr));
        gap:12px;
    }
    .summary-card{
        background:#f7fafd;border:1px solid #e4ebf2;
        border-left:3px solid #1c4c6e;
        padding:14px 16px;border-radius:6px;
    }
    .summary-label{
        font-size:10.5px;color:#7a8a99;font-weight:600;
        text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;
    }
    .summary-value{
        font-size:22px;font-weight:700;color:#1c4c6e;
        letter-spacing:-0.02em;line-height:1.1;
    }

    /* ══════════════════════════════════════════════════════════
       DATA TABLE — fits within the page (NO horizontal scroll)
    ══════════════════════════════════════════════════════════ */
    .table-wrap{
        border-radius:6px;
        border:1px solid #e4ebf2;
        overflow:hidden;    /* clip, do not scroll */
    }
    .doc-table{
        width:100%;
        border-collapse:collapse;
        table-layout:fixed;                 /* equal-share widths */
        font-size:11.5px;
        word-wrap:break-word;
        overflow-wrap:break-word;
    }
    .doc-table thead th{
        background:#1c4c6e;color:#fff;
        padding:10px 8px;
        text-align:left;
        font-weight:600;font-size:10.5px;
        letter-spacing:.02em;
        border-bottom:2px solid #123a56;
        vertical-align:middle;
        white-space:normal;                 /* headers can wrap */
        overflow-wrap:break-word;
    }
    .doc-table tbody td{
        padding:8px;
        border-bottom:1px solid #eef3f8;
        color:#2c3e50;
        vertical-align:top;
        word-break:break-word;
        overflow-wrap:anywhere;
        hyphens:auto;
    }
    .doc-table tbody tr:last-child td{border-bottom:none;}
    .doc-table tbody tr:nth-child(even) td{background:#fafcfe;}
    .doc-table td.empty{
        text-align:center;padding:40px 20px;
        color:#95a5a6;font-style:italic;font-size:13px;
    }
    .doc-table td:first-child{
        font-variant-numeric:tabular-nums;
        font-weight:500;color:#1c4c6e;
    }

    /* Density steps for wider reports — shrink font/padding, do NOT scroll */
    .doc-table.cols-md{font-size:11px;}
    .doc-table.cols-md thead th{font-size:10px;padding:9px 7px;}
    .doc-table.cols-md tbody td{padding:7px;}

    .doc-table.cols-lg{font-size:10.5px;}
    .doc-table.cols-lg thead th{font-size:9.5px;padding:8px 6px;}
    .doc-table.cols-lg tbody td{padding:6px;}

    .doc-table.cols-xl{font-size:9.75px;line-height:1.35;}
    .doc-table.cols-xl thead th{font-size:9px;padding:7px 5px;letter-spacing:0;}
    .doc-table.cols-xl tbody td{padding:5px;}

    /* ── Footer ── */
    .doc-footer{padding:20px 48px 32px;text-align:center;}
    .footer-line{height:1px;background:#e4ebf2;margin-bottom:16px;}
    .footer-text{font-size:11.5px;color:#5a6c7d;font-weight:500;}
    .footer-note{font-size:10.5px;color:#95a5a6;margin-top:4px;font-style:italic;}

    /* ══════════════════════════════════════════════════════════
       RESPONSIVE
    ══════════════════════════════════════════════════════════ */
    @media (max-width:768px){
        .preview-topbar{flex-direction:column;align-items:stretch;padding:12px 16px;}
        .preview-actions{justify-content:flex-end;}
        .preview-statusbar{padding:8px 16px;flex-direction:column;align-items:flex-start;gap:4px;}
        .page-canvas{padding:16px 8px 40px;}
        .doc-header,.doc-section,.doc-footer{padding-left:20px;padding-right:20px;}
        .doc-divider{margin:0 -20px;}
        .doc-school{font-size:20px;}
    }

    /* ══════════════════════════════════════════════════════════
       PRINT
    ══════════════════════════════════════════════════════════ */
    @media print{
        @page{size:A4 landscape;margin:12mm 10mm;}
        html,body{background:#fff;}
        .no-print{display:none !important;}
        .page-canvas{padding:0;min-height:0;}
        .page{max-width:100%;box-shadow:none;border-radius:0;}
        .doc-header{padding:0;}
        .doc-header-inner{padding-bottom:14px;}
        .doc-divider{margin:0;}
        .doc-meta-row{padding:14px 0 18px;}
        .doc-section{padding:0 0 18px;}
        .doc-footer{padding:14px 0 0;}
        .doc-school{font-size:22pt;}
        .doc-portal{font-size:12pt;}
        .doc-report-type{font-size:14pt;}
        .summary-value{font-size:16pt;}
        .doc-table{font-size:8.5pt;}
        .doc-table.cols-lg{font-size:7.75pt;}
        .doc-table.cols-xl{font-size:7pt;}
        .doc-table thead th{
            background:#1c4c6e !important;color:#fff !important;
            padding:6px 5px;
            -webkit-print-color-adjust:exact;print-color-adjust:exact;
        }
        .doc-table tbody td{padding:5px;}
        .summary-card,.table-wrap{
            -webkit-print-color-adjust:exact;print-color-adjust:exact;
            border:1px solid #d0d7e0;
        }
        tr{page-break-inside:avoid;}
        thead{display:table-header-group;}
    }
CSS;
}
