<?php
require_once 'config.php';
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
    // Verify the ticket exists
    $check = $pdo->prepare("SELECT id FROM tickets WHERE id = :id");
    $check->execute([':id' => $ticketId]);
    if (!$check->fetch()) {
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

    echo json_encode([
        'success'     => true,
        'activity_id' => (int)$pdo->lastInsertId(),
        'message'     => 'Follow-up added successfully.'
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
}
