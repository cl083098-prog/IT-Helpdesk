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

require_once 'sla_helper.php';

try {
    $pdo->beginTransaction();

    // ── Ticket code ────────────────────────────────────────────────────────────
    $maxRow     = $pdo->query("SELECT MAX(id) AS max_id FROM tickets")->fetch();
    $ticketCode = 'SR-' . str_pad(($maxRow['max_id'] ?? 0) + 1, 4, '0', STR_PAD_LEFT);

    // ── SLA — SAME shared function get_sla.php uses for the submit-time preview.
    //    Preview number == persisted number. This is what keeps the SLA
    //    consistent across every role from the moment a ticket is created.
    $sla = calculateSlaForTicket(
        $pdo,
        (string)$data['category'],
        (string)$data['request_type'],
        (string)($data['equipment_item'] ?? '')
    );
    $responseHrs   = (int)ceil($sla['response_hours']);
    $resolutionHrs = (int)ceil($sla['resolution_hours']);
    $priority      = $sla['priority'];
    $slaExtended   = $sla['sla_extended_reason'];
    $stockAvail    = $sla['stock_status'] === 'N/A' ? null
                   : ($sla['stock_status'] === 'Out of Stock' ? 0 : 1);

    $now           = new DateTime();
    $responseDue   = (clone $now)->modify("+{$responseHrs} hours")->format('Y-m-d H:i:s');
    $resolutionDue = (clone $now)->modify("+{$resolutionHrs} hours")->format('Y-m-d H:i:s');

    // ── Approval routing ──────────────────────────────────────────────────────
    $needsApproval = in_array($data['category'], APPROVAL_REQUIRED_CATEGORIES, true);

    // v28: any dept_head submitting a ticket skips approval — a dept_head
    // reviewing their own request adds nothing. Simpler and more reliable
    // than the previous dept_id match, which failed when a dept_head user
    // had no department_id set (older seed scripts didn't populate it).
    if ($needsApproval) {
        try {
            $usrStmt = $pdo->prepare("SELECT role FROM users WHERE id = :id LIMIT 1");
            $usrStmt->execute([':id' => (int)$data['requester_id']]);
            $usr = $usrStmt->fetch();
            if ($usr && $usr['role'] === 'dept_head') {
                $needsApproval = false;
            }
        } catch (PDOException $eApp) { /* fall through */ }
    }

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

    // ── v28: Notifications (best-effort, after main tx committed) ────────────
    // Regressed in v21 rebuild. Re-added so the bell wakes up on every ticket.
    require_once 'notifications_helper.php';
    $requesterName = $data['requester_name'] ?? 'Requester';
    $shortTitle    = mb_strimwidth((string)($data['title'] ?? '—'), 0, 60, '…');
    $reqId         = (int)($data['requester_id']  ?? 0);
    $deptId        = (int)($data['department_id'] ?? 0);

    // Confirm to the requester
    pushNotification($pdo, [
        'target_user' => $reqId,
        'target_role' => 'requester',
        'event_type'  => 'ticket_submitted',
        'title'       => "Ticket #$ticketCode submitted",
        'description' => $needsApproval
            ? "Your request \"$shortTitle\" was submitted and is awaiting Department Head approval."
            : "Your request \"$shortTitle\" was submitted and routed to the IT Admin.",
        'ticket_id'   => $newTicketId,
    ]);

    if ($needsApproval && $deptId > 0) {
        pushNotificationToDeptHead($pdo, $deptId,
            "Approval needed for #$ticketCode",
            "$requesterName submitted \"$shortTitle\" for your department. Please review and approve.",
            'approval_needed', null, $newTicketId);
    } else {
        pushNotificationToRole($pdo, 'admin',
            "New ticket #$ticketCode",
            "$requesterName reported: \"$shortTitle\" (Priority: $priority)"
                . ($slaExtended ? " — $slaExtended" : ''),
            'ticket_submitted', null, $newTicketId);
    }

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
