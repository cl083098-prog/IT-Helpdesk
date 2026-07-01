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

$data     = json_decode(file_get_contents('php://input'), true);
$username = trim($data['username'] ?? '');
$password = trim($data['password'] ?? '');

if (!$username || !$password) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Username and password are required.']);
    exit;
}

try {
    $stmt = $pdo->prepare(
        "SELECT id, username, password, role, full_name, email, department
         FROM users
         WHERE username = :username AND is_active = 1
         LIMIT 1"
    );
    $stmt->execute([':username' => $username]);
    $user = $stmt->fetch();

    // Verify password against bcrypt hash
    if (!$user || !password_verify($password, $user['password'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid username or password. Please try again.']);
        exit;
    }

    // Don't send the password hash to the frontend
    unset($user['password']);

    echo json_encode([
        'success' => true,
        'user'    => $user   // includes real DB id, role, full_name, email, department
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
}
