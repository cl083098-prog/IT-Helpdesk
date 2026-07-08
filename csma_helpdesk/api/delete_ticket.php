<?php
require_once 'config.php';
header('Content-Type: application/json');

$data     = json_decode(file_get_contents('php://input'), true);
$ticketId = (int)($data['ticket_id'] ?? 0);
if (!$ticketId) { http_response_code(400); echo json_encode(['success'=>false,'message'=>'ticket_id required']); exit; }

try {
    // Fetch ticket details before deletion for accurate audit log
    $tcStmt = $pdo->prepare("SELECT t.ticket_code, t.title, u.full_name AS requester FROM tickets t JOIN users u ON u.id = t.requester_id WHERE t.id = :id");
    $tcStmt->execute([':id' => $ticketId]);
    $tc = $tcStmt->fetch();

    $pdo->prepare("DELETE FROM tickets WHERE id = :id")->execute([':id' => $ticketId]);

    // Write audit log after successful delete
    $adminId   = (int)($data['admin_id']   ?? 0);
    $adminName = trim($data['admin_name']  ?? 'IT Admin');
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL, user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '', module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '', detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL, status ENUM('Success','Failed','Warning') DEFAULT 'Success', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
        $pdo->prepare("INSERT INTO audit_log (user_id,user_name,user_role,module,action,detail,ip_address,status) VALUES(:uid,:uname,'admin','ServiceRequest','Deleted ticket',:det,:ip,'Success')")
            ->execute([
                ':uid'   => $adminId,
                ':uname' => $adminName,
                ':det'   => "Ticket: #" . ($tc['ticket_code'] ?? $ticketId) . " — " . ($tc['title'] ?? '—') . " | Requester: " . ($tc['requester'] ?? '—') . " | Permanently deleted",
                ':ip'    => $_SERVER['REMOTE_ADDR'] ?? '',
            ]);
    } catch (PDOException $al) {}

    echo json_encode(['success' => true, 'message' => 'Ticket deleted']);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Delete failed: ' . $e->getMessage()]);
}