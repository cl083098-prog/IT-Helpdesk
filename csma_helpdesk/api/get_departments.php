<?php
require_once 'config.php';
header('Content-Type: application/json');

try {
    $stmt = $pdo->query(
        "SELECT id, name, code FROM departments WHERE is_active = 1 ORDER BY name ASC"
    );
    echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error']);
}