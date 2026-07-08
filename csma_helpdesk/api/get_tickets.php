<?php
// api/get_tickets.php
// ── Workflow fix: IT Admin only sees tickets where approval is Not Required
//    OR already Approved. Tickets still Pending Approval are NOT shown here
//    — they appear only in the Department Head's queue.

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$status   = $_GET['status']   ?? 'all';
$search   = trim($_GET['search'] ?? '');

try {
    $where  = [];
    $params = [];

    // ── FIX 2: Only show tickets that the IT Admin is allowed to action ────────
    // A ticket is visible to IT Admin when:
    //   - It needs no approval (Software, Network, Account Access, Other), OR
    //   - The Department Head has already approved it.
    // Tickets with approval_status = 'Pending Approval' or 'Rejected' stay hidden.
    $where[]  = "t.approval_status IN ('Not Required', 'Approved')";

    if ($status !== 'all') {
        $where[]           = 't.status = :status';
        $params[':status'] = $status;
    }
    if ($search !== '') {
        $sv           = "%$search%";
        $where[]      = '(t.ticket_code LIKE :s1 OR u.full_name LIKE :s2 OR t.equipment_item LIKE :s3 OR t.title LIKE :s4)';
        $params[':s1'] = $params[':s2'] = $params[':s3'] = $params[':s4'] = $sv;
    }

    $whereSQL = 'WHERE ' . implode(' AND ', $where);

    $sql = "SELECT
                t.id, t.ticket_code, t.category, u.full_name AS requester,
                d.name AS department, t.equipment_item, t.title,
                t.assigned_to, t.priority, t.status, t.approval_status,
                t.request_type,
                t.response_due_at, t.resolution_due_at,
                t.submitted_at, t.completed_at
            FROM tickets t
            JOIN users u       ON u.id = t.requester_id
            JOIN departments d ON d.id = t.department_id
            $whereSQL
            ORDER BY t.submitted_at DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $tickets = $stmt->fetchAll();

    // Status counts — only over admin-visible tickets
    $countSql = "SELECT status, COUNT(*) AS cnt FROM tickets
                 WHERE approval_status IN ('Not Required','Approved')
                 GROUP BY status";
    $counts = [];
    foreach ($pdo->query($countSql)->fetchAll() as $r) {
        $counts[$r['status']] = (int)$r['cnt'];
    }

    echo json_encode([
        'success' => true,
        'data'    => $tickets,
        'counts'  => $counts,
        'total'   => array_sum($counts),
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Database error: ' . $e->getMessage()]);
}