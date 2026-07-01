<?php
require_once 'config.php';
header('Content-Type: application/json');

$status = $_GET['status'] ?? 'all';
$search = trim($_GET['search'] ?? '');

try {
    $where = []; $params = [];
    if ($status !== 'all') { $where[] = 't.status = :status'; $params[':status'] = $status; }
    if ($search !== '')    { $where[] = '(t.ticket_code LIKE :s OR u.full_name LIKE :s OR t.equipment_item LIKE :s OR t.title LIKE :s)'; $params[':s'] = "%$search%"; }

    $whereSQL = $where ? 'WHERE '.implode(' AND ',$where) : '';

    $sql = "SELECT t.id, t.ticket_code, t.category, u.full_name AS requester,
                   d.name AS department, t.equipment_item, t.title,
                   t.assigned_to, t.priority, t.status,
                   t.response_due_at, t.resolution_due_at, t.submitted_at
            FROM tickets t
            JOIN users u       ON u.id = t.requester_id
            JOIN departments d ON d.id = t.department_id
            $whereSQL
            ORDER BY t.submitted_at DESC";

    $stmt = $pdo->prepare($sql); $stmt->execute($params);
    $tickets = $stmt->fetchAll();

    $counts = [];
    foreach ($pdo->query("SELECT status, COUNT(*) AS cnt FROM tickets GROUP BY status")->fetchAll() as $r) {
        $counts[$r['status']] = (int)$r['cnt'];
    }

    echo json_encode(['success'=>true,'data'=>$tickets,'counts'=>$counts,'total'=>array_sum($counts)]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Database error']);
}