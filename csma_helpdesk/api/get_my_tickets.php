<?php
require_once 'config.php';
header('Content-Type: application/json');

$requesterId = (int)($_GET['requester_id'] ?? 0);
if (!$requesterId) { http_response_code(400); echo json_encode(['success'=>false,'message'=>'requester_id required']); exit; }

try {
    $stmt = $pdo->prepare(
        "SELECT t.id, t.ticket_code, t.title, t.category, t.equipment_item, t.request_type,
                t.priority, t.status, t.description, t.location, t.preferred_date,
                d.name AS department, t.assigned_to, t.response_due_at, t.resolution_due_at, t.submitted_at
         FROM tickets t JOIN departments d ON d.id = t.department_id
         WHERE t.requester_id = :rid ORDER BY t.submitted_at DESC"
    );
    $stmt->execute([':rid'=>$requesterId]);
    $tickets = $stmt->fetchAll();

    if ($tickets) {
        $ids = array_column($tickets, 'id');
        $ph  = implode(',', array_fill(0, count($ids), '?'));
        $actStmt = $pdo->prepare(
            "SELECT ticket_id, author_name, message,
                    IF(author_id = ?, 1, 0) AS is_requester, created_at
             FROM ticket_activity WHERE ticket_id IN ($ph) ORDER BY created_at ASC"
        );
        $actStmt->execute(array_merge([$requesterId], $ids));
        $grouped = [];
        foreach ($actStmt->fetchAll() as $act) { $grouped[$act['ticket_id']][] = $act; }
        foreach ($tickets as &$t) { $t['conversations'] = $grouped[$t['id']] ?? []; }
    }

    echo json_encode(['success'=>true,'data'=>$tickets]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Database error']);
}