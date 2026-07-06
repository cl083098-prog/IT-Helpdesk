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

    echo json_encode(['success'=>true,'message'=>'Ticket updated.']);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Update failed: ' . $e->getMessage()]);
}