<?php
// api/school-admin-data.php
// Single endpoint for all School Admin data needs.
// Usage: ?action=ACTION_NAME[&other_params]

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$action = trim($_GET['action'] ?? $_POST['action'] ?? '');

try {
    switch ($action) {

        // ── Dashboard summary ────────────────────────────────────────────────
        case 'get_dashboard':
            $counts = [];
            foreach ($pdo->query("SELECT status, COUNT(*) cnt FROM tickets GROUP BY status")->fetchAll() as $r)
                $counts[$r['status']] = (int)$r['cnt'];

            $invRow = safeQuery($pdo,
                "SELECT SUM(quantity*price_unit) total_val,
                        SUM(CASE WHEN quantity<=(low_stock_pct/100)*oversupply_threshold THEN 1 ELSE 0 END) low_stock
                 FROM inventory");
            $inv = $invRow ? $invRow : ['total_val'=>0,'low_stock'=>0];

            // Recent activities from audit_log
            $acts = $pdo->query(
                "SELECT a.action, a.module, a.user_name, a.created_at, a.status
                 FROM audit_log a ORDER BY a.created_at DESC LIMIT 8"
            )->fetchAll();

            jsonOk([
                'stats' => [
                    'total'     => array_sum($counts),
                    'pending'   => $counts['Pending']   ?? 0,
                    'ongoing'   => $counts['Ongoing']   ?? 0,
                    'completed' => $counts['Completed'] ?? 0,
                    'closed'    => $counts['Closed']    ?? 0,
                    'low_stock' => (int)($inv['low_stock'] ?? 0),
                    'inv_value' => (float)($inv['total_val'] ?? 0),
                ],
                'recent_activities' => $acts,
            ]);
            break;

        // ── Service Requests (view-only) ──────────────────────────────────────
        case 'get_service_requests':
            $status   = $_GET['status']     ?? 'all';
            $priority = $_GET['priority']   ?? 'all';
            $dept     = $_GET['department'] ?? 'all';
            $search   = trim($_GET['search'] ?? '');

            $where = []; $params = [];
            if ($status   !== 'all') { $where[] = 't.status = :status';         $params[':status']   = $status; }
            if ($priority !== 'all') { $where[] = 't.priority = :priority';     $params[':priority'] = $priority; }
            if ($dept     !== 'all') { $where[] = 'd.name = :dept';             $params[':dept']     = $dept; }
            if ($search   !== '')    {
                $where[] = '(t.ticket_code LIKE :s OR u.full_name LIKE :s OR t.title LIKE :s)';
                $params[':s'] = "%$search%";
            }
            $whereSQL = $where ? 'WHERE ' . implode(' AND ', $where) : '';

            $sql = "SELECT t.id, t.ticket_code, t.title, t.category, t.priority, t.status,
                           t.approval_status, t.assigned_to, t.submitted_at,
                           t.closed_at, t.updated_at,
                           u.full_name AS requester, d.name AS department
                    FROM tickets t
                    JOIN users u ON u.id = t.requester_id
                    JOIN departments d ON d.id = t.department_id
                    $whereSQL
                    ORDER BY t.submitted_at DESC";
            $stmt = $pdo->prepare($sql); $stmt->execute($params);

            $counts = [];
            foreach ($pdo->query("SELECT status, COUNT(*) cnt FROM tickets GROUP BY status")->fetchAll() as $r)
                $counts[$r['status']] = (int)$r['cnt'];

            jsonOk(['data' => $stmt->fetchAll(), 'counts' => $counts, 'total' => array_sum($counts)]);
            break;

        // ── Single ticket detail (with conversation + approval) ───────────────
        case 'get_ticket_detail':
            $id = (int)($_GET['ticket_id'] ?? 0);
            if (!$id) jsonErr('ticket_id required');

            $stmt = $pdo->prepare(
                "SELECT t.*, u.full_name AS requester, u.email AS requester_email,
                        d.name AS department
                 FROM tickets t
                 JOIN users u ON u.id = t.requester_id
                 JOIN departments d ON d.id = t.department_id
                 WHERE t.id = :id"
            );
            $stmt->execute([':id' => $id]);
            $ticket = $stmt->fetch();
            if (!$ticket) jsonErr('Ticket not found', 404);

            $conv = $pdo->prepare(
                "SELECT author_name, message, created_at FROM ticket_activity WHERE ticket_id=:id ORDER BY created_at ASC"
            );
            $conv->execute([':id' => $id]);
            $ticket['conversations'] = $conv->fetchAll();

            $appr = $pdo->prepare(
                "SELECT ta.decision, ta.estimated_cost, ta.rejection_note, ta.decided_at, u.full_name AS decided_by
                 FROM ticket_approvals ta JOIN users u ON u.id=ta.dept_head_id
                 WHERE ta.ticket_id=:id ORDER BY ta.decided_at DESC LIMIT 1"
            );
            $appr->execute([':id' => $id]);
            $ticket['approval'] = $appr->fetch() ?: null;

            jsonOk(['ticket' => $ticket]);
            break;

        // ── Inventory (view-only) ─────────────────────────────────────────────
        case 'get_inventory':
            $tab    = $_GET['tab']    ?? 'all'; // all|equipment|consumable|allocated
            $search = trim($_GET['search'] ?? '');
            $where = []; $params = [];

            if ($tab === 'equipment')  { $where[] = "type='Equipment'"; }
            if ($tab === 'consumable') { $where[] = "type='Consumable'"; }
            if ($search !== '') { $where[] = "(name LIKE :s OR category LIKE :s OR department LIKE :s)"; $params[':s'] = "%$search%"; }

            $whereSQL = $where ? 'WHERE '.implode(' AND ',$where) : '';

            $sql = "SELECT id, name, type, category, quantity, price_unit,
                           (quantity*price_unit) AS total_value,
                           low_stock_pct, oversupply_threshold, department,
                           CASE WHEN quantity<=(low_stock_pct/100)*oversupply_threshold THEN 'Low Stock'
                                WHEN quantity>oversupply_threshold THEN 'Oversupply'
                                ELSE 'In Stock' END AS stock_status
                    FROM inventory $whereSQL ORDER BY type, name";
            $stmt = $pdo->prepare($sql); $stmt->execute($params);
            $items = $stmt->fetchAll();

            // Summary stats
            $sumRow = $pdo->query(
                "SELECT SUM(quantity) total_qty,
                        SUM(CASE WHEN type='Equipment' THEN quantity ELSE 0 END) equip_qty,
                        SUM(CASE WHEN type='Consumable' THEN quantity ELSE 0 END) cons_qty,
                        SUM(quantity*price_unit) total_val,
                        SUM(CASE WHEN type='Equipment' THEN quantity*price_unit ELSE 0 END) equip_val,
                        SUM(CASE WHEN type='Consumable' THEN quantity*price_unit ELSE 0 END) cons_val,
                        COUNT(DISTINCT CASE WHEN type='Equipment' THEN id END) equip_types,
                        COUNT(DISTINCT CASE WHEN type='Consumable' THEN id END) cons_types,
                        SUM(CASE WHEN quantity<=(low_stock_pct/100)*oversupply_threshold THEN 1 ELSE 0 END) low_stock,
                        SUM(CASE WHEN quantity>oversupply_threshold THEN 1 ELSE 0 END) oversupply
                 FROM inventory"
            )->fetch();

            if ($tab === 'allocated') {
                $stmt2 = $pdo->query(
                    "SELECT ia.*, i.name AS item_name, i.type FROM inventory_allocations ia
                     JOIN inventory i ON i.id=ia.item_id ORDER BY ia.date_allocated DESC"
                );
                $items = $stmt2->fetchAll();
            }

            jsonOk(['data' => $items, 'summary' => $sumRow]);
            break;

        // ── Cost analysis (view-only) ─────────────────────────────────────────
        case 'get_cost_analysis':
            // Cost by department from ticket_approvals (estimated_cost field)
            $byDept = $pdo->query(
                "SELECT d.name AS department,
                        SUM(CASE WHEN t.request_type='Hardware Issue' THEN ta.estimated_cost ELSE 0 END) AS repair_cost,
                        SUM(CASE WHEN t.request_type='Installation' OR t.request_type='Maintenance' THEN ta.estimated_cost ELSE 0 END) AS maintenance_cost,
                        SUM(ta.estimated_cost) AS total_cost
                 FROM ticket_approvals ta
                 JOIN tickets t ON t.id=ta.ticket_id
                 JOIN departments d ON d.id=t.department_id
                 WHERE ta.decision='Approved' AND ta.estimated_cost IS NOT NULL
                 GROUP BY d.name ORDER BY total_cost DESC"
            )->fetchAll();

            // Cost by category
            $byCat = $pdo->query(
                "SELECT t.category,
                        SUM(ta.estimated_cost) AS total_cost,
                        COUNT(*) AS ticket_count
                 FROM ticket_approvals ta
                 JOIN tickets t ON t.id=ta.ticket_id
                 WHERE ta.decision='Approved' AND ta.estimated_cost IS NOT NULL
                 GROUP BY t.category ORDER BY total_cost DESC"
            )->fetchAll();

            // Totals
            $totals = $pdo->query(
                "SELECT SUM(CASE WHEN t.request_type='Hardware Issue' THEN ta.estimated_cost ELSE 0 END) AS repair,
                        SUM(CASE WHEN t.request_type='Maintenance' THEN ta.estimated_cost ELSE 0 END) AS maintenance,
                        SUM(CASE WHEN t.request_type='Installation' THEN ta.estimated_cost ELSE 0 END) AS replacement,
                        SUM(ta.estimated_cost) AS grand_total
                 FROM ticket_approvals ta
                 JOIN tickets t ON t.id=ta.ticket_id
                 WHERE ta.decision='Approved' AND ta.estimated_cost IS NOT NULL"
            )->fetch();

            // Monthly trend (last 6 months)
            $monthly = $pdo->query(
                "SELECT DATE_FORMAT(ta.decided_at,'%Y-%m') AS month,
                        SUM(ta.estimated_cost) AS total
                 FROM ticket_approvals ta
                 WHERE ta.decision='Approved' AND ta.estimated_cost IS NOT NULL
                   AND ta.decided_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
                 GROUP BY month ORDER BY month ASC"
            )->fetchAll();

            jsonOk(['by_department' => $byDept, 'by_category' => $byCat, 'totals' => $totals, 'monthly_trend' => $monthly]);
            break;

        // ── Feedback monitoring ───────────────────────────────────────────────
        case 'get_feedback':
            $rating     = (int)($_GET['rating']  ?? 0);
            $dept       = $_GET['department']    ?? 'all';
            $responded  = $_GET['responded']     ?? 'all'; // all|yes|no
            $dateFrom   = $_GET['date_from']     ?? '';
            $dateTo     = $_GET['date_to']       ?? '';

            $where = []; $params = [];
            if ($rating > 0) { $where[] = 'f.rating = :rating'; $params[':rating'] = $rating; }
            if ($dept !== 'all') { $where[] = 'd.name = :dept'; $params[':dept'] = $dept; }
            if ($responded === 'yes') $where[] = "f.comment IS NOT NULL AND f.comment != ''";
            if ($responded === 'no')  $where[] = "(f.comment IS NULL OR f.comment = '')";
            if ($dateFrom) { $where[] = 'DATE(f.submitted_at) >= :df'; $params[':df'] = $dateFrom; }
            if ($dateTo)   { $where[] = 'DATE(f.submitted_at) <= :dt'; $params[':dt'] = $dateTo; }

            $whereSQL = $where ? 'WHERE '.implode(' AND ',$where) : '';

            $sql = "SELECT f.id, f.ticket_id, f.rating, f.comment, f.submitted_at,
                           u.full_name AS requester_name, u.email AS requester_email,
                           d.name AS department,
                           t.ticket_code, t.title AS ticket_title
                    FROM ticket_feedback f
                    JOIN tickets t ON t.id=f.ticket_id
                    JOIN users u ON u.id=f.user_id
                    JOIN departments d ON d.id=t.department_id
                    $whereSQL
                    ORDER BY f.submitted_at DESC";
            $stmt = $pdo->prepare($sql); $stmt->execute($params);
            $feedbacks = $stmt->fetchAll();

            $summaryRow = $pdo->query(
                "SELECT AVG(rating) avg_rating, COUNT(*) total,
                        SUM(CASE WHEN rating>=4 THEN 1 ELSE 0 END) positive,
                        SUM(CASE WHEN rating<=3 THEN 1 ELSE 0 END) negative
                 FROM ticket_feedback"
            )->fetch();

            jsonOk(['data' => $feedbacks, 'summary' => $summaryRow]);
            break;

        // ── User management (view + password reset for IT Admin) ──────────────
        case 'get_users':
            $role   = $_GET['role']   ?? 'all';
            $status = $_GET['status'] ?? 'all';
            $search = trim($_GET['search'] ?? '');

            $where = []; $params = [];
            if ($role   !== 'all') { $where[] = 'role = :role';         $params[':role']   = $role; }
            if ($status !== 'all') { $where[] = 'is_active = :active';  $params[':active'] = $status === 'active' ? 1 : 0; }
            if ($search !== '')    { $where[] = "(full_name LIKE :s OR username LIKE :s OR email LIKE :s)"; $params[':s'] = "%$search%"; }

            $whereSQL = $where ? 'WHERE '.implode(' AND ',$where) : '';
            $stmt = $pdo->prepare("SELECT id, username, full_name, email, role, is_active, created_at FROM users $whereSQL ORDER BY created_at DESC");
            $stmt->execute($params);
            jsonOk(['data' => $stmt->fetchAll()]);
            break;

        case 'reset_admin_password':
            $body   = jsonBody();
            $userId = (int)($body['user_id']      ?? 0);
            $newPwd = trim($body['new_password']  ?? '');
            if (!$userId || strlen($newPwd) < 6) jsonErr('user_id and new_password (min 6 chars) required');

            // Only allowed to reset 'admin' role accounts
            $check = $pdo->prepare("SELECT role FROM users WHERE id=:id");
            $check->execute([':id' => $userId]);
            $row = $check->fetch();
            if (!$row || $row['role'] !== 'admin') jsonErr('Only IT Administrator passwords can be reset by School Admin.');

            $hash = password_hash($newPwd, PASSWORD_BCRYPT, ['cost' => 12]);
            $pdo->prepare("UPDATE users SET password=:pw WHERE id=:id")->execute([':pw'=>$hash,':id'=>$userId]);

            // Log to audit
            $reqUser = $body['requestor_name'] ?? 'School Admin';
            $pdo->prepare("INSERT INTO audit_log (user_name,user_role,module,action,status) VALUES(:un,'school_admin','UserManagement',:act,'Success')")
                ->execute([':un'=>$reqUser, ':act'=>"Reset password for IT Admin user ID $userId"]);

            jsonOk(['message' => 'Password reset successfully.']);
            break;

        // ── Audit log ────────────────────────────────────────────────────────
        case 'get_audit_log':
            $module   = $_GET['module']   ?? 'all';
            $role     = $_GET['role']     ?? 'all';
            $search   = trim($_GET['search'] ?? '');
            $dateFrom = $_GET['date_from'] ?? '';
            $dateTo   = $_GET['date_to']   ?? '';

            $where = []; $params = [];
            if ($module !== 'all') { $where[] = 'module = :module'; $params[':module'] = $module; }
            if ($role   !== 'all') { $where[] = 'user_role = :role'; $params[':role']   = $role; }
            if ($search !== '') { $where[] = "(user_name LIKE :s OR action LIKE :s OR detail LIKE :s)"; $params[':s'] = "%$search%"; }
            if ($dateFrom) { $where[] = 'DATE(created_at) >= :df'; $params[':df'] = $dateFrom; }
            if ($dateTo)   { $where[] = 'DATE(created_at) <= :dt'; $params[':dt'] = $dateTo; }

            $whereSQL = $where ? 'WHERE '.implode(' AND ',$where) : '';
            $stmt = $pdo->prepare("SELECT * FROM audit_log $whereSQL ORDER BY created_at DESC LIMIT 500");
            $stmt->execute($params);
            $logs = $stmt->fetchAll();

            $sumRow = $pdo->query(
                "SELECT COUNT(*) total,
                        SUM(CASE WHEN user_role='admin' THEN 1 ELSE 0 END) it_admin_actions,
                        SUM(CASE WHEN user_role NOT IN ('admin','school_admin') THEN 1 ELSE 0 END) user_actions,
                        SUM(CASE WHEN DATE(created_at)=CURDATE() THEN 1 ELSE 0 END) today
                 FROM audit_log"
            )->fetch();

            jsonOk(['data' => $logs, 'summary' => $sumRow]);
            break;

        // ── Notifications ────────────────────────────────────────────────────
        case 'get_notifications':
            $userId = (int)($_GET['user_id'] ?? 0);
            $stmt = $pdo->prepare(
                "SELECT * FROM notifications
                 WHERE target_user=:uid OR target_role='school_admin' OR target_user IS NULL
                 ORDER BY created_at DESC LIMIT 50"
            );
            $stmt->execute([':uid' => $userId]);
            jsonOk(['data' => $stmt->fetchAll()]);
            break;

        case 'mark_notifications_read':
            $body   = jsonBody();
            $userId = (int)($body['user_id'] ?? 0);
            $pdo->prepare(
                "UPDATE notifications SET is_read=1 WHERE target_user=:uid OR target_role='school_admin'"
            )->execute([':uid' => $userId]);
            jsonOk(['message' => 'All notifications marked as read.']);
            break;

        // ── Reports: log a generated report ──────────────────────────────────
        case 'log_report':
            $body = jsonBody();
            $pdo->prepare(
                "INSERT INTO generated_reports (generated_by,report_name,report_type,date_from,date_to,export_format)
                 VALUES(:by,:name,:type,:df,:dt,:fmt)"
            )->execute([
                ':by'   => (int)($body['user_id']       ?? 0),
                ':name' => $body['report_name']          ?? 'Report',
                ':type' => $body['report_type']          ?? 'ServiceRequest',
                ':df'   => $body['date_from']            ?? null,
                ':dt'   => $body['date_to']              ?? null,
                ':fmt'  => $body['export_format']        ?? 'PDF',
            ]);
            jsonOk(['message' => 'Report logged.']);
            break;

        case 'get_recent_reports':
            $userId = (int)($_GET['user_id'] ?? 0);
            $stmt = $pdo->prepare("SELECT * FROM generated_reports WHERE generated_by=:uid ORDER BY created_at DESC LIMIT 20");
            $stmt->execute([':uid' => $userId]);
            jsonOk(['data' => $stmt->fetchAll()]);
            break;

        default:
            jsonErr('Unknown action: ' . htmlspecialchars($action), 400);
    }
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'DB error: '.$e->getMessage()]);
}

function jsonOk(array $d): void { echo json_encode(array_merge(['success'=>true],$d)); exit; }
function jsonErr(string $m, int $c=400): void { http_response_code($c); echo json_encode(['success'=>false,'message'=>$m]); exit; }
function jsonBody(): array { $r=file_get_contents('php://input'); return $r?(json_decode($r,true)??[]):[]; }
function safeQuery(PDO $pdo, string $sql): ?array {
    try { return $pdo->query($sql)->fetch(); } catch (PDOException $e) { return null; }
}
