<?php
require_once 'config.php';
require_once 'notifications_helper.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method Not Allowed']);
    exit;
}

$data       = json_decode(file_get_contents('php://input'), true);
$ticketId   = (int)($data['ticket_id']   ?? 0);
$authorId   = (int)($data['author_id']   ?? 0);
$authorName = trim($data['author_name']  ?? '');
$message    = trim($data['message']      ?? '');

if (!$ticketId || !$authorId || !$message) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'ticket_id, author_id, and message are required.']);
    exit;
}

if (!$authorName) $authorName = 'User';

try {
    // Fetch ticket info and author role for targeted notifications
    $tcStmt = $pdo->prepare(
        "SELECT t.ticket_code, t.title, t.requester_id, t.department_id,
                u.role AS author_role
         FROM tickets t
         JOIN users u ON u.id = :aid
         WHERE t.id = :tid"
    );
    $tcStmt->execute([':aid' => $authorId, ':tid' => $ticketId]);
    $tcRow = $tcStmt->fetch();

    if (!$tcRow) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Ticket not found.']);
        exit;
    }

    $stmt = $pdo->prepare(
        "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
         VALUES (:tid, :aid, :aname, :msg)"
    );
    $stmt->execute([
        ':tid'   => $ticketId,
        ':aid'   => $authorId,
        ':aname' => $authorName,
        ':msg'   => $message,
    ]);
    $activityId = (int)$pdo->lastInsertId();

    // ── Push notifications to the relevant parties ───────────────────────────
    // Truncate message preview
    $preview     = mb_strimwidth($message, 0, 90, '…');
    $tcCode      = $tcRow['ticket_code'];
    $authorRole  = $tcRow['author_role'] ?? 'requester';
    $requesterId = (int)$tcRow['requester_id'];
    $deptId      = (int)$tcRow['department_id'];

    try {
        if ($authorRole === 'admin') {
            // IT Admin sent a message → notify the requester
            pushNotification($pdo, [
                'target_user' => $requesterId,
                'event_type'  => 'reply',
                'title'       => "New message on #{$tcCode}",
                'description' => "{$authorName}: {$preview}",
                'ticket_id'   => $ticketId,
            ]);
            // Also notify the dept head of the department
            pushNotificationToDeptHead($pdo, $deptId,
                "IT Admin replied on #{$tcCode}",
                "{$authorName}: {$preview}",
                'reply', null, $ticketId
            );
        } elseif ($authorRole === 'dept_head') {
            // Dept Head sent a message → notify requester + IT admins
            pushNotification($pdo, [
                'target_user' => $requesterId,
                'event_type'  => 'reply',
                'title'       => "New message on #{$tcCode}",
                'description' => "{$authorName}: {$preview}",
                'ticket_id'   => $ticketId,
            ]);
            pushNotificationToRole($pdo, 'admin',
                "Dept Head replied on #{$tcCode}",
                "{$authorName}: {$preview}",
                'reply', null, $ticketId
            );
        } else {
            // Requester sent a message → notify IT admins + dept head
            pushNotificationToRole($pdo, 'admin',
                "New message on #{$tcCode}",
                "{$authorName}: {$preview}",
                'reply', null, $ticketId
            );
            pushNotificationToDeptHead($pdo, $deptId,
                "Requester sent a message on #{$tcCode}",
                "{$authorName}: {$preview}",
                'reply', null, $ticketId
            );
        }
    } catch (Exception $notifErr) { /* non-fatal */ }

    echo json_encode([
        'success'     => true,
        'activity_id' => $activityId,
        'message'     => 'Follow-up added successfully.'
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
}
