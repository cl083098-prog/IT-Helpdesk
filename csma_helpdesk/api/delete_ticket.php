<?php
require_once 'config.php';
header('Content-Type: application/json');

$data     = json_decode(file_get_contents('php://input'), true);
$ticketId = (int)($data['ticket_id'] ?? 0);
if (!$ticketId) { http_response_code(400); echo json_encode(['success'=>false,'message'=>'ticket_id required']); exit; }

try {
    $pdo->prepare("DELETE FROM tickets WHERE id = :id")->execute([':id'=>$ticketId]);
    echo json_encode(['success'=>true,'message'=>'Ticket deleted']);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Delete failed']);
}