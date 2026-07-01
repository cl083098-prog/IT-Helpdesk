<?php
require_once 'config.php';
header('Content-Type: application/json');

$data     = json_decode(file_get_contents('php://input'), true);
$ticketId = (int)($data['ticket_id'] ?? 0);
if (!$ticketId) { http_response_code(400); echo json_encode(['success'=>false,'message'=>'ticket_id required']); exit; }

$sets = []; $params = [':id' => $ticketId];
foreach (['status','assigned_to','priority'] as $f) {
    if (isset($data[$f])) { $sets[] = "$f = :$f"; $params[":$f"] = $data[$f]; }
}
if (($data['status'] ?? '') === 'Closed') { $sets[] = 'closed_at = NOW()'; }
if (empty($sets)) { http_response_code(400); echo json_encode(['success'=>false,'message'=>'Nothing to update']); exit; }

try {
    $pdo->prepare("UPDATE tickets SET ".implode(', ',$sets)." WHERE id = :id")->execute($params);

    if (isset($data['admin_id'])) {
        $note = "Updated — Status: ".($data['status'] ?? 'N/A');
        $pdo->prepare("INSERT INTO ticket_activity (ticket_id,author_id,author_name,message) VALUES (:tid,:aid,:aname,:msg)")
            ->execute([':tid'=>$ticketId,':aid'=>(int)$data['admin_id'],':aname'=>$data['admin_name'] ?? 'Admin',':msg'=>$note]);
    }

    echo json_encode(['success'=>true,'message'=>'Ticket updated']);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Update failed']);
}