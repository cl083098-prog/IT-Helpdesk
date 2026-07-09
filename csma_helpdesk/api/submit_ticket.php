<?php
// api/submit_ticket.php
// ── Workflow: Equipment and Consumable tickets route to Department Head
//    approval before reaching IT Admin. All other categories go directly to IT.
// ── NEW: SLA is extended when the requested item is out of stock or low stock.

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['success'=>false,'message'=>'Method Not Allowed']); exit;
}

$data = json_decode(file_get_contents('php://input'), true);
$required = ['requester_id','department_id','category','request_type','equipment_item','title'];
foreach ($required as $f) {
    if (empty($data[$f])) {
        http_response_code(400);
        echo json_encode(['success'=>false,'message'=>"Missing: $f"]);
        exit;
    }
}

const APPROVAL_REQUIRED_CATEGORIES = ['Equipment', 'Consumable'];
// Categories for which stock availability affects SLA
const STOCK_SENSITIVE_CATEGORIES   = ['Equipment', 'Consumable'];

function getSLA(PDO $pdo, $cat, $rt, $equip) {
    $st = $pdo->prepare(
        "SELECT priority, response_hours, resolution_hours FROM sla_rules
         WHERE category=:cat AND request_type=:rt
           AND equipment_keyword IS NOT NULL
           AND :equip LIKE CONCAT('%', equipment_keyword, '%')
         ORDER BY CHAR_LENGTH(equipment_keyword) DESC LIMIT 1"
    );
    $st->execute([':cat'=>$cat,':rt'=>$rt,':equip'=>$equip]);
    $r = $st->fetch();
    if ($r) return $r;

    $st2 = $pdo->prepare(
        "SELECT priority, response_hours, resolution_hours FROM sla_rules
         WHERE category=:cat AND request_type=:rt AND equipment_keyword IS NULL LIMIT 1"
    );
    $st2->execute([':cat'=>$cat,':rt'=>$rt]);
    return $st2->fetch() ?: ['priority'=>'Low','response_hours'=>8,'resolution_hours'=>48];
}

/**
 * checkInventoryStock — returns:
 *   ['found' => bool, 'in_stock' => bool, 'status' => 'In Stock'|'Low Stock'|'Out of Stock'|'Unknown',
 *    'quantity' => int, 'item_name' => string|null]
 * A ticket for an item that is Out of Stock gets its SLA doubled;
 * a Low Stock item gets +50% resolution time.  In Stock keeps the standard SLA.
 * If the item is not in the catalogue we treat it as "Unknown" and leave SLA alone.
 */
function checkInventoryStock(PDO $pdo, string $equipment): array {
    $default = ['found'=>false,'in_stock'=>false,'status'=>'Unknown','quantity'=>0,'item_name'=>null];
    if ($equipment === '') return $default;
    try {
        $st = $pdo->prepare(
            "SELECT id, name, quantity, low_stock_pct, oversupply_threshold
             FROM inventory
             WHERE :q LIKE CONCAT('%', name, '%') OR name LIKE CONCAT('%', :q2, '%')
             ORDER BY CHAR_LENGTH(name) DESC LIMIT 1"
        );
        $st->execute([':q'=>$equipment, ':q2'=>$equipment]);
        $row = $st->fetch();
        if (!$row) return $default;

        $qty       = (int)$row['quantity'];
        $threshold = ((int)$row['low_stock_pct'] / 100) * (int)$row['oversupply_threshold'];
        if ($qty <= 0)            $status = 'Out of Stock';
        elseif ($qty <= $threshold) $status = 'Low Stock';
        else                        $status = 'In Stock';

        return [
            'found'     => true,
            'in_stock'  => $qty > 0,
            'status'    => $status,
            'quantity'  => $qty,
            'item_name' => $row['name'],
        ];
    } catch (PDOException $e) { return $default; }
}

try {
    $pdo->beginTransaction();

    // ── Ticket code ────────────────────────────────────────────────────────────
    $maxRow     = $pdo->query("SELECT MAX(id) AS max_id FROM tickets")->fetch();
    $ticketCode = 'SR-' . str_pad(($maxRow['max_id'] ?? 0) + 1, 4, '0', STR_PAD_LEFT);

    // ── Base SLA ───────────────────────────────────────────────────────────────
    $sla = getSLA($pdo, $data['category'], $data['request_type'], $data['equipment_item']);
    $responseHrs   = (int)$sla['response_hours'];
    $resolutionHrs = (int)$sla['resolution_hours'];
    $priority      = $sla['priority'];

    // ── NEW: Stock-aware SLA adjustment ────────────────────────────────────────
    $stockAvail   = null;         // 1 = in stock, 0 = not
    $slaExtended  = null;         // human-readable reason string (or null)
    if (in_array($data['category'], STOCK_SENSITIVE_CATEGORIES, true)) {
        $stock = checkInventoryStock($pdo, (string)$data['equipment_item']);
        if ($stock['found']) {
            $stockAvail = $stock['in_stock'] ? 1 : 0;
            if ($stock['status'] === 'Out of Stock') {
                // Double the SLA and bump priority to High (procurement needed)
                $responseHrs   *= 2;
                $resolutionHrs *= 2;
                if ($priority === 'Low') $priority = 'Medium';
                $slaExtended   = "Item out of stock — SLA extended (procurement required).";
            } elseif ($stock['status'] === 'Low Stock') {
                // +50% resolution window
                $resolutionHrs = (int)ceil($resolutionHrs * 1.5);
                $slaExtended   = "Item stock low ({$stock['quantity']} left) — resolution extended.";
            }
        }
    }

    $now           = new DateTime();
    $responseDue   = (clone $now)->modify("+{$responseHrs} hours")->format('Y-m-d H:i:s');
    $resolutionDue = (clone $now)->modify("+{$resolutionHrs} hours")->format('Y-m-d H:i:s');

    // ── Approval routing ──────────────────────────────────────────────────────
    $needsApproval  = in_array($data['category'], APPROVAL_REQUIRED_CATEGORIES, true);
    $approvalStatus = $needsApproval ? 'Pending Approval' : 'Not Required';

    // ── Insert ticket ─────────────────────────────────────────────────────────
    // Detect whether the two optional columns from inventory_setup.sql are
    // present. If not (older DB), fall back to the classic INSERT so ticket
    // submission still works.
    $hasStockCols = false;
    try {
        $col = $pdo->query("SHOW COLUMNS FROM tickets LIKE 'stock_available'")->fetch();
        $hasStockCols = (bool)$col;
    } catch (PDOException $e) { $hasStockCols = false; }

    if ($hasStockCols) {
        $stmt = $pdo->prepare(
            "INSERT INTO tickets
                (ticket_code, requester_id, department_id, category, request_type,
                 equipment_item, title, description, location, preferred_date,
                 priority, approval_status,
                 sla_response_hours, sla_resolution_hours,
                 response_due_at, resolution_due_at,
                 stock_available, sla_extended_reason)
             VALUES
                (:code, :rid, :did, :cat, :rt,
                 :equip, :title, :desc, :loc, :pdate,
                 :priority, :approvalStatus,
                 :rh, :resh, :rdueAt, :resdueAt,
                 :stockAvail, :slaExt)"
        );
    } else {
        $stmt = $pdo->prepare(
            "INSERT INTO tickets
                (ticket_code, requester_id, department_id, category, request_type,
                 equipment_item, title, description, location, preferred_date,
                 priority, approval_status,
                 sla_response_hours, sla_resolution_hours,
                 response_due_at, resolution_due_at)
             VALUES
                (:code, :rid, :did, :cat, :rt,
                 :equip, :title, :desc, :loc, :pdate,
                 :priority, :approvalStatus,
                 :rh, :resh, :rdueAt, :resdueAt)"
        );
    }
    $params = [
        ':code'           => $ticketCode,
        ':rid'            => (int)$data['requester_id'],
        ':did'            => (int)$data['department_id'],
        ':cat'            => $data['category'],
        ':rt'             => $data['request_type'],
        ':equip'          => $data['equipment_item'],
        ':title'          => $data['title'],
        ':desc'           => $data['description']    ?? null,
        ':loc'            => $data['location']       ?? null,
        ':pdate'          => $data['preferred_date'] ?? null,
        ':priority'       => $priority,
        ':approvalStatus' => $approvalStatus,
        ':rh'             => $responseHrs,
        ':resh'           => $resolutionHrs,
        ':rdueAt'         => $responseDue,
        ':resdueAt'       => $resolutionDue,
    ];
    if ($hasStockCols) {
        $params[':stockAvail'] = $stockAvail;
        $params[':slaExt']     = $slaExtended;
    }
    $stmt->execute($params);

    $newTicketId = $pdo->lastInsertId();

    // ── Activity log ──────────────────────────────────────────────────────────
    $activityMsg = $needsApproval
        ? 'Service request submitted. Awaiting Department Head approval before routing to IT Admin.'
        : 'Service request submitted. Routed directly to IT Admin for action.';
    if ($slaExtended) $activityMsg .= ' ' . $slaExtended;

    $pdo->prepare(
        "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
         VALUES (:tid, :aid, :aname, :msg)"
    )->execute([
        ':tid'   => $newTicketId,
        ':aid'   => (int)$data['requester_id'],
        ':aname' => $data['requester_name'] ?? 'Requester',
        ':msg'   => $activityMsg,
    ]);

    // ── Approval record for dept head if required ─────────────────────────────
    if ($needsApproval) {
        $deptHeadStmt = $pdo->prepare(
            "SELECT id FROM users
             WHERE role = 'dept_head' AND department = (
                 SELECT name FROM departments WHERE id = :did
             ) LIMIT 1"
        );
        $deptHeadStmt->execute([':did' => (int)$data['department_id']]);
        $deptHeadRow = $deptHeadStmt->fetch();

        if ($deptHeadRow) {
            $pdo->prepare(
                "INSERT INTO ticket_approvals (ticket_id, dept_head_id, decision)
                 VALUES (:tid, :dhid, 'Pending Approval')"
            )->execute([':tid' => $newTicketId, ':dhid' => $deptHeadRow['id']]);
        }
    }

    $pdo->commit();

    // Audit log
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL, user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '', module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '', detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL, status ENUM('Success','Failed','Warning') DEFAULT 'Success', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
        $pdo->prepare("INSERT INTO audit_log (user_id,user_name,user_role,module,action,detail,ip_address,status) VALUES(:uid,:uname,'requester','ServiceRequest','Submitted service request',:det,:ip,'Success')")
            ->execute([
                ':uid'   => (int)($data['requester_id'] ?? 0),
                ':uname' => $data['requester_name'] ?? 'Requester',
                ':det'   => "Ticket: #{$ticketCode} — " . ($data['title'] ?? '—') . " | Category: " . ($data['category'] ?? '—') . " | Priority: $priority" . ($slaExtended ? " | $slaExtended" : ''),
                ':ip'    => $_SERVER['REMOTE_ADDR'] ?? '',
            ]);
    } catch (PDOException $al) {}

    echo json_encode([
        'success'             => true,
        'ticket_code'         => $ticketCode,
        'ticket_id'           => $newTicketId,
        'priority'            => $priority,
        'approval_status'     => $approvalStatus,
        'needs_approval'      => $needsApproval,
        'response_due_at'     => $responseDue,
        'resolution_due_at'   => $resolutionDue,
        'stock_available'     => $stockAvail,          // null | 0 | 1
        'sla_extended_reason' => $slaExtended,         // null | string
        'message'             => ($needsApproval
                                    ? 'Your request has been submitted and sent to your Department Head for approval.'
                                    : 'Your request has been submitted and routed to the IT Admin.')
                                . ($slaExtended ? ' Note: ' . $slaExtended : ''),
    ]);

} catch (PDOException $e) {
    $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'DB error: ' . $e->getMessage()]);
}
