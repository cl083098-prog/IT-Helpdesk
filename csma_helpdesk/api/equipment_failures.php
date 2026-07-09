<?php
// api/equipment_failures.php
// -----------------------------------------------------------------------------
// v3: Equipment Failure records are now DERIVED from service request tickets
// whose category is 'Equipment'. This module is a REPORT, not an editable list.
//
// Read-only for everyone (admin, school_admin). No write actions.
//
// Field mapping ticket -> failure record:
//   equipment_name   = COALESCE(equipment_item, title)
//   department       = departments.name
//   failure_date     = DATE(submitted_at)
//   issue            = title (or description if title is generic)
//   action_taken     = repair_remarks
//   resolution_date  = DATE(completed_at)
//   cost             = COALESCE(repair_total_cost, 0)
//   status           = mapped ticket status
//   receipt_path     = repair_receipt_path (new — visible in detail modal)
// -----------------------------------------------------------------------------

require_once 'config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$body   = json_decode(file_get_contents('php://input'), true) ?: [];
$action = trim($_GET['action']    ?? $body['action']    ?? '');
$role   = trim($_GET['user_role'] ?? $body['user_role'] ?? '');

function jsonOk(array $data = [])   { echo json_encode(['success' => true] + $data); exit; }
function jsonFail(string $msg, int $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'message' => $msg]);
    exit;
}

const READ_ACTIONS = ['list_failures', 'get_summary', 'get_failure'];

if ($action === '')                          jsonFail('Missing action.');
if (!in_array($action, READ_ACTIONS, true))  jsonFail('Unknown or write-blocked action: ' . $action, 400);
if (!in_array($role, ['admin', 'school_admin'], true)) {
    jsonFail('Forbidden: not authorized to view equipment failure records.', 403);
}

// Map ticket.status -> failure status shown in the report
function mapStatus(string $s): string {
    switch ($s) {
        case 'Completed':
        case 'Closed':
            return 'Resolved';
        case 'Ongoing':
        case 'Pending Confirmation':
            return 'In Progress';
        case 'Cancelled':
            return 'Cancelled';
        default:                       // Pending, anything unknown
            return 'Pending';
    }
}

// Feature-detect optional columns so a fresh install doesn't crash
try {
    $ticketCols   = $pdo->query("SHOW COLUMNS FROM tickets")->fetchAll(PDO::FETCH_COLUMN);
    $hasExtRep    = in_array('external_repair',     $ticketCols, true);
    $hasReceipt   = in_array('repair_receipt_path', $ticketCols, true);
    $hasCompleted = in_array('completed_at',        $ticketCols, true);
    $hasEquipItem = in_array('equipment_item',      $ticketCols, true);
} catch (PDOException $e) { jsonFail('DB error: ' . $e->getMessage(), 500); }

$equipCol    = $hasEquipItem ? 't.equipment_item' : "''";
$repairCost  = $hasExtRep ? 't.repair_total_cost' : "0";
$repairRem   = $hasExtRep ? 't.repair_remarks'    : "''";
$receiptCol  = $hasReceipt ? 't.repair_receipt_path' : 'NULL';
$completedAt = $hasCompleted ? 't.completed_at'   : 'NULL';

$BASE_SELECT = "
    t.id,
    COALESCE(NULLIF($equipCol, ''), t.title) AS equipment_name,
    d.name  AS department,
    DATE(t.submitted_at) AS failure_date,
    t.title AS issue,
    t.description AS issue_full,
    $repairRem AS action_taken,
    DATE($completedAt) AS resolution_date,
    COALESCE($repairCost, 0) AS cost,
    t.status AS raw_status,
    t.ticket_code,
    t.category,
    t.priority,
    $receiptCol AS receipt_path,
    u.full_name AS requester_name,
    t.submitted_at,
    $completedAt AS completed_at
";

try {
    switch ($action) {

        // ─── LIST ────────────────────────────────────────────────────────
        case 'list_failures': {
            $search = trim($_GET['search']     ?? '');
            $dept   = trim($_GET['department'] ?? '');
            $from   = trim($_GET['date_from']  ?? '');
            $to     = trim($_GET['date_to']    ?? '');
            $status = trim($_GET['status']     ?? '');

            $where  = ["t.category = 'Equipment'"];
            $params = [];
            if ($search !== '') {
                $where[] = "(t.title LIKE :s OR t.description LIKE :s OR $equipCol LIKE :s)";
                $params[':s'] = "%$search%";
            }
            if ($dept !== '' && $dept !== 'all') {
                $where[] = 'd.name = :dept'; $params[':dept'] = $dept;
            }
            if ($from !== '') { $where[] = 'DATE(t.submitted_at) >= :from'; $params[':from'] = $from; }
            if ($to   !== '') { $where[] = 'DATE(t.submitted_at) <= :to';   $params[':to']   = $to; }

            $sql = "SELECT $BASE_SELECT
                    FROM tickets t
                    LEFT JOIN departments d ON d.id = t.department_id
                    LEFT JOIN users u       ON u.id = t.requester_id
                    WHERE " . implode(' AND ', $where) . "
                    ORDER BY t.submitted_at DESC, t.id DESC";

            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
            foreach ($rows as &$r) { $r['status'] = mapStatus($r['raw_status']); }

            // Post-filter on mapped status
            if ($status !== '' && $status !== 'all') {
                $rows = array_values(array_filter($rows, fn($r) => $r['status'] === $status));
            }
            jsonOk(['failures' => $rows]);
        }

        // ─── SUMMARY ─────────────────────────────────────────────────────
        case 'get_summary': {
            $rows = $pdo->query(
                "SELECT t.submitted_at, $completedAt AS completed_at,
                        COALESCE($repairCost, 0) AS cost, t.status
                 FROM tickets t
                 WHERE t.category = 'Equipment'"
            )->fetchAll();

            $total = count($rows);
            $totalCost   = 0.0;
            $totDays     = 0;
            $resolvedCnt = 0;
            $pending     = 0;
            $inProgress  = 0;
            $resolved    = 0;

            foreach ($rows as $r) {
                $totalCost += (float)$r['cost'];
                $st = mapStatus((string)$r['status']);
                if ($st === 'Pending')     $pending++;
                if ($st === 'In Progress') $inProgress++;
                if ($st === 'Resolved')    $resolved++;
                if (!empty($r['completed_at'])) {
                    $d1 = strtotime($r['submitted_at']);
                    $d2 = strtotime($r['completed_at']);
                    if ($d2 && $d1 && $d2 >= $d1) {
                        $totDays += (int)ceil(($d2 - $d1) / 86400);
                        $resolvedCnt++;
                    }
                }
            }
            $avgDays = $resolvedCnt > 0 ? round($totDays / $resolvedCnt, 1) : 0;

            jsonOk(['summary' => [
                'total_failures'      => $total,
                'total_cost'          => round($totalCost, 2),
                'avg_resolution_days' => $avgDays,
                'pending'             => $pending,
                'in_progress'         => $inProgress,
                'resolved'            => $resolved,
            ]]);
        }

        // ─── SINGLE RECORD (for the detail modal) ────────────────────────
        case 'get_failure': {
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonFail('Missing id.');
            $sql = "SELECT $BASE_SELECT
                    FROM tickets t
                    LEFT JOIN departments d ON d.id = t.department_id
                    LEFT JOIN users u       ON u.id = t.requester_id
                    WHERE t.id = :id AND t.category = 'Equipment'";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([':id' => $id]);
            $row = $stmt->fetch();
            if (!$row) jsonFail('Failure record not found.', 404);
            $row['status'] = mapStatus($row['raw_status']);
            jsonOk(['failure' => $row]);
        }
    }
} catch (PDOException $e) {
    jsonFail('Database error: ' . $e->getMessage(), 500);
}
