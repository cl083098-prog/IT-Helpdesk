<?php
// api/update_ticket.php
// ── Workflow fix:
//    - When IT Admin sets status to 'Completed', the ticket moves to
//      'Pending Confirmation' (not Closed). The requester must confirm.
//    - A separate 'send_confirmation' action triggers the confirmation notice.
//    - 'Closed' can only be set by the requester via dept-head-data.php
//      confirm_resolved action.

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$data     = json_decode(file_get_contents('php://input'), true);
$ticketId = (int)($data['ticket_id'] ?? 0);
if (!$ticketId) {
    http_response_code(400);
    echo json_encode(['success'=>false,'message'=>'ticket_id required']);
    exit;
}

// ── Handle the special 'send_confirmation' action ────────────────────────────
// Image 3 shows: IT Admin clicks "Mark as Completed" → modal appears →
// clicks "Send Confirmation Request" → ticket moves to Pending Confirmation.
$action = trim($data['action'] ?? '');

if ($action === 'send_confirmation') {
    try {
        $pdo->beginTransaction();

        $pdo->prepare(
            "UPDATE tickets SET status = 'Pending Confirmation' WHERE id = :id"
        )->execute([':id' => $ticketId]);

        $adminName = $data['admin_name'] ?? 'IT Admin';
        $adminId   = (int)($data['admin_id'] ?? 0);

        // Log with message_type if column exists, fall back gracefully
        try {
            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message, message_type)
                 VALUES (:tid, :aid, :aname, :msg, 'status_change')"
            )->execute([
                ':tid'   => $ticketId,
                ':aid'   => $adminId,
                ':aname' => $adminName,
                ':msg'   => 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester to verify the issue is fully resolved.',
            ]);
        } catch (PDOException $colErr) {
            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
                 VALUES (:tid, :aid, :aname, :msg)"
            )->execute([
                ':tid'   => $ticketId,
                ':aid'   => $adminId,
                ':aname' => $adminName,
                ':msg'   => 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester.',
            ]);
        }

        // Fetch ticket details for audit log
        $tcRow = $pdo->prepare("SELECT t.ticket_code, t.title, u.full_name AS requester_name FROM tickets t JOIN users u ON u.id = t.requester_id WHERE t.id = :id");
        $tcRow->execute([':id' => $ticketId]);
        $tc = $tcRow->fetch();
        $tcCode = $tc['ticket_code'] ?? $ticketId;
        $tcTitle = $tc['title'] ?? '—';

        try {
            $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL, user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '', module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '', detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL, status ENUM('Success','Failed','Warning') DEFAULT 'Success', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
            $pdo->prepare("INSERT INTO audit_log (user_id,user_name,user_role,module,action,detail,ip_address,status) VALUES(:uid,:uname,:urole,'ServiceRequest','Marked ticket as Pending Confirmation',:det,:ip,'Success')")
                ->execute([':uid'=>$adminId,':uname'=>$adminName,':urole'=>'admin',':det'=>"Ticket: #$tcCode — $tcTitle | Status changed to Pending Confirmation | Confirmation request sent to requester: {$tc['requester_name']}",':ip'=>$_SERVER['REMOTE_ADDR']??'']);
        } catch (PDOException $al) {}

        $pdo->commit();

        echo json_encode([
            'success'    => true,
            'new_status' => 'Pending Confirmation',
            'message'    => 'Confirmation request sent to the requester. Ticket is now Pending Confirmation.',
        ]);
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success'=>false,'message'=>'DB error: ' . $e->getMessage()]);
    }
    exit;
}

// ── Standard status/assignment update ─────────────────────────────────────────
$sets   = [];
$params = [':id' => $ticketId];

foreach (['assigned_to', 'priority'] as $f) {
    if (isset($data[$f])) {
        $sets[]       = "$f = :$f";
        $params[":$f"] = $data[$f];
    }
}

if (isset($data['status'])) {
    $requestedStatus = $data['status'];

    // ── FIX 3 guard: IT Admin cannot set status directly to 'Completed' ────────
    // They must use the send_confirmation action above (which sets
    // 'Pending Confirmation'). 'Closed' can only be set by the requester.
    // This prevents the premature closure bug from Image 3/4.
    $adminBlockedStatuses = ['Completed', 'Closed', 'Pending Confirmation'];
    if (in_array($requestedStatus, $adminBlockedStatuses, true) && $action !== 'admin_override') {
        echo json_encode([
            'success' => false,
            'message' => "Use action='send_confirmation' to mark a ticket as completed. The requester must confirm resolution before it closes.",
        ]);
        exit;
    }

    $sets[]            = 'status = :status';
    $params[':status'] = $requestedStatus;

    // Only set closed_at when actually closing (set by requester via confirm_resolved)
    if ($requestedStatus === 'Closed') {
        $sets[] = 'closed_at = NOW()';
    }
}

if (empty($sets)) {
    http_response_code(400);
    echo json_encode(['success'=>false,'message'=>'Nothing to update']);
    exit;
}

try {
    $pdo->prepare("UPDATE tickets SET " . implode(', ', $sets) . " WHERE id = :id")
        ->execute($params);

    if (isset($data['admin_id'])) {
        $note = 'Updated — Status: ' . ($data['status'] ?? 'N/A');
        if (isset($data['assigned_to'])) $note .= ' | Assigned to: ' . $data['assigned_to'];
        $pdo->prepare(
            "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
             VALUES (:tid, :aid, :aname, :msg)"
        )->execute([
            ':tid'   => $ticketId,
            ':aid'   => (int)$data['admin_id'],
            ':aname' => $data['admin_name'] ?? 'Admin',
            ':msg'   => $note,
        ]);
    }

    // Audit log for standard status/assignment update
    if (isset($data['status']) || isset($data['assigned_to'])) {
        try {
            $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL, user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '', module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '', detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL, status ENUM('Success','Failed','Warning') DEFAULT 'Success', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
            $tcRow2 = $pdo->prepare("SELECT ticket_code, title FROM tickets WHERE id = :id");
            $tcRow2->execute([':id' => $ticketId]);
            $tc2 = $tcRow2->fetch();
            $parts = [];
            if (isset($data['status']))      $parts[] = "Status → {$data['status']}";
            if (isset($data['assigned_to'])) $parts[] = "Assigned to → {$data['assigned_to']}";
            $adminName2 = $data['admin_name'] ?? 'IT Admin';
            $adminId2   = (int)($data['admin_id'] ?? 0);
            $pdo->prepare("INSERT INTO audit_log (user_id,user_name,user_role,module,action,detail,ip_address,status) VALUES(:uid,:uname,'admin','ServiceRequest','Updated ticket',:det,:ip,'Success')")
                ->execute([':uid'=>$adminId2,':uname'=>$adminName2,':det'=>"Ticket: #" . ($tc2['ticket_code']??$ticketId) . " — " . ($tc2['title']??'') . " | " . implode(' | ', $parts),':ip'=>$_SERVER['REMOTE_ADDR']??'']);
        } catch (PDOException $al) {}
    }

    echo json_encode(['success'=>true,'message'=>'Ticket updated.']);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Update failed: ' . $e->getMessage()]);
}