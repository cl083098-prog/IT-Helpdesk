<?php
// api/login.php  — updated to support admin | requester | dept_head roles
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

    if (!$user || !password_verify($password, $user['password'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid username or password. Please try again.']);
        exit;
    }

    unset($user['password']);

    // Tell the frontend which dashboard to redirect to
    $redirectTo = match ($user['role']) {
        'admin'        => 'Dashboard.html',
        'dept_head'    => 'DeptHeadDashboard.html',
        'school_admin' => 'SchoolAdmin.html',
        default        => 'RequesterDashboard.html',
    };

    // ── Log successful login to audit_log ──────────────────────────────────────
    $roleLabels = ['admin'=>'IT Admin','school_admin'=>'School Admin','dept_head'=>'Dept Head','requester'=>'Faculty/Staff'];
    $roleLabel  = $roleLabels[$user['role']] ?? ucfirst($user['role']);
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL,
            user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '',
            module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '',
            detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL,
            status ENUM('Success','Failed','Warning') DEFAULT 'Success',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
        $pdo->prepare(
            "INSERT INTO audit_log (user_id,user_name,user_role,module,action,detail,ip_address,status)
             VALUES(:uid,:uname,:urole,'Authentication','Logged in',:detail,:ip,'Success')"
        )->execute([
            ':uid'    => $user['id'],
            ':uname'  => $user['full_name'],
            ':urole'  => $user['role'],
            ':detail' => "$roleLabel account authenticated. Redirected to: $redirectTo",
            ':ip'     => $_SERVER['REMOTE_ADDR'] ?? '',
        ]);
    } catch (PDOException $logErr) { /* Silently ignore if audit_log not yet available */ }

    echo json_encode([
        'success'     => true,
        'user'        => $user,
        'redirect_to' => $redirectTo,
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
}
