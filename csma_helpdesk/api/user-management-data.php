<?php
// api/user-management-data.php
// Handles all User Management API actions for:
//   - IT Admin:     full CRUD on all users
//   - School Admin: add IT Admin, view all, reset IT Admin password
//
// Gracefully handles databases where the um-schema.sql migration
// has not been run yet (missing employee_id, is_active, force_password_change,
// created_at, updated_at, and audit_log table).

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// Action comes from GET params for read operations, from JSON body for writes.
// Also support action in GET params for backwards compatibility.
$rawBody       = file_get_contents('php://input');
$bodyData      = $rawBody ? (json_decode($rawBody, true) ?? []) : [];
$action        = trim($_GET['action'] ?? $bodyData['action'] ?? '');
$requestorId   = (int)($_GET['requestor_id']   ?? $bodyData['requestor_id']   ?? 0);
$requestorRole = trim($_GET['requestor_role']   ?? $bodyData['requestor_role'] ?? '');

// Validate requestor role
if (!in_array($requestorRole, ['admin', 'school_admin'], true)) {
    http_response_code(403);
    echo json_encode(['success'=>false,'message'=>'Access denied.']);
    exit;
}

// ── Detect which optional columns actually exist ──────────────────────────────
// This prevents "Unknown column" errors on databases that haven't run um-schema.sql
function columnsExist(PDO $pdo, string $table, array $cols): array {
    try {
        // FETCH_ASSOC is the PDO default; extract the 'Field' column explicitly
        $rows     = $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_ASSOC);
        $existing = array_column($rows, 'Field');
    } catch (PDOException $e) { return []; }
    return array_filter($cols, fn($c) => in_array($c, $existing, true));
}

$userCols    = columnsExist($pdo, 'users', ['employee_id','is_active','force_password_change','created_at','updated_at']);
$hasEmpId    = in_array('employee_id',           $userCols);
$hasIsActive = in_array('is_active',             $userCols);
$hasFpc      = in_array('force_password_change', $userCols);
$hasCreatedAt= in_array('created_at',            $userCols);

// ── Helpers ───────────────────────────────────────────────────────────────────
function roleLabel(string $r): string {
    return match($r) {
        'admin'        => 'IT Admin',
        'school_admin' => 'School Admin',
        'dept_head'    => 'Dept Head',
        'requester'    => 'Faculty/Staff',
        default        => ucfirst($r),
    };
}
function dbRole(string $label): string {
    return match($label) {
        'IT Admin'     => 'admin',
        'School Admin' => 'school_admin',
        'Dept Head'    => 'dept_head',
        'Faculty/Staff'=> 'requester',
        default        => 'requester',
    };
}
function jsonOk(array $d): void  { echo json_encode(array_merge(['success'=>true],$d)); exit; }
function jsonErr(string $m, int $c=400): void { http_response_code($c); echo json_encode(['success'=>false,'message'=>$m]); exit; }
function jsonBody(): array { global $bodyData; return $bodyData ?? []; }
function logAction(PDO $pdo, ?int $uid, string $uname, string $urole, string $module, string $action, string $detail, string $status = 'Success'): void {
    try {
        // Auto-create table if missing — safe to call on every log write
        static $tableEnsured = false;
        if (!$tableEnsured) {
            $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
                id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL,
                user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '',
                module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '',
                detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL,
                status ENUM('Success','Failed','Warning') DEFAULT 'Success',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
            $tableEnsured = true;
        }
        $pdo->prepare(
            "INSERT INTO audit_log (user_id,user_name,user_role,module,action,detail,ip_address,status)
             VALUES(:uid,:un,:ur,:mod,:act,:det,:ip,:st)"
        )->execute([':uid'=>$uid,':un'=>$uname,':ur'=>$urole,':mod'=>$module,
                    ':act'=>$action,':det'=>$detail?:null,':ip'=>$_SERVER['REMOTE_ADDR']??'',':st'=>$status]);
    } catch (PDOException $e) { /* Never break the main flow */ }
}

// Build SELECT field list based on what columns exist
function buildUserSelect(bool $hasEmpId, bool $hasIsActive, bool $hasCreatedAt): string {
    $cols = ['id', 'username', 'full_name', 'email', 'department', 'role'];
    if ($hasEmpId)     $cols[] = 'employee_id';
    if ($hasIsActive)  $cols[] = 'is_active';
    if ($hasCreatedAt) $cols[] = 'created_at';
    return implode(', ', $cols);
}

function hydrateUser(array $u, bool $hasEmpId, bool $hasIsActive): array {
    $u['employee_id']  = $hasEmpId    ? ($u['employee_id']  ?? '—') : ('U-'.str_pad($u['id'],3,'0',STR_PAD_LEFT));
    $u['is_active']    = $hasIsActive ? (int)($u['is_active'] ?? 1) : 1;
    $u['role_label']   = roleLabel($u['role']);
    $u['status_text']  = $u['is_active'] ? 'Active' : 'Inactive';
    $u['created_at']   = $u['created_at'] ?? null;
    return $u;
}

try {
    $selectFields = buildUserSelect($hasEmpId, $hasIsActive, $hasCreatedAt);

    switch ($action) {

        // ── GET: List users ──────────────────────────────────────────────────
        case 'get_users':
            $roleFilter   = trim($_GET['role']   ?? 'all');
            $statusFilter = trim($_GET['status'] ?? 'all');
            $search       = trim($_GET['search'] ?? '');

            $where = []; $params = [];

            if ($roleFilter !== 'all') {
                $where[]          = 'role = :role';
                $params[':role']  = dbRole($roleFilter);
            }
            if ($statusFilter !== 'all' && $hasIsActive) {
                $where[]           = 'is_active = :active';
                $params[':active'] = $statusFilter === 'Active' ? 1 : 0;
            }
            if ($search !== '') {
                $sv = "%$search%";
                if ($hasEmpId) {
                    $where[]            = '(full_name LIKE :s1 OR email LIKE :s2 OR username LIKE :s3 OR employee_id LIKE :s4)';
                    $params[':s1'] = $params[':s2'] = $params[':s3'] = $params[':s4'] = $sv;
                } else {
                    $where[]            = '(full_name LIKE :s1 OR email LIKE :s2 OR username LIKE :s3)';
                    $params[':s1'] = $params[':s2'] = $params[':s3'] = $sv;
                }
            }

            $whereSQL  = $where ? 'WHERE ' . implode(' AND ', $where) : '';
            $orderSQL  = $hasCreatedAt ? 'ORDER BY created_at DESC' : 'ORDER BY id DESC';

            $stmt = $pdo->prepare("SELECT $selectFields FROM users $whereSQL $orderSQL");
            $stmt->execute($params);
            $users = array_map(fn($u) => hydrateUser($u, $hasEmpId, $hasIsActive), $stmt->fetchAll());

            // Summary counts
            $countSQL = $hasIsActive
                ? "SELECT role, is_active, COUNT(*) cnt FROM users GROUP BY role, is_active"
                : "SELECT role, 1 AS is_active, COUNT(*) cnt FROM users GROUP BY role";
            $counts = $pdo->query($countSQL)->fetchAll();

            jsonOk(['data' => $users, 'counts' => $counts]);
            break;

        // ── GET: Single user ─────────────────────────────────────────────────
        case 'get_user':
            $userId = (int)($_GET['user_id'] ?? 0);
            if (!$userId) jsonErr('user_id required');

            $stmt = $pdo->prepare("SELECT $selectFields FROM users WHERE id = :id");
            $stmt->execute([':id' => $userId]);
            $user = $stmt->fetch();
            if (!$user) jsonErr('User not found', 404);

            jsonOk(['user' => hydrateUser($user, $hasEmpId, $hasIsActive)]);
            break;

        // ── POST: Add user ───────────────────────────────────────────────────
        case 'add_user':
            $body       = jsonBody();
            $targetRole = dbRole($body['role'] ?? 'Faculty/Staff');

            // School Admin may only create IT Admin accounts
            if ($requestorRole === 'school_admin' && $targetRole !== 'admin') {
                jsonErr('School Admin can only create IT Admin accounts.', 403);
            }

            // Validate required fields
            $required = ['full_name', 'email', 'department', 'role'];
            foreach ($required as $f) {
                if (empty(trim($body[$f] ?? ''))) jsonErr("Field required: $f");
            }

            // Validate email format
            if (!filter_var(trim($body['email']), FILTER_VALIDATE_EMAIL)) {
                jsonErr('Invalid email address format.');
            }

            // Check email uniqueness
            $chk = $pdo->prepare("SELECT id FROM users WHERE email = :e LIMIT 1");
            $chk->execute([':e' => trim($body['email'])]);
            if ($chk->fetch()) jsonErr('A user with this email already exists.');

            // Generate username from email prefix
            $emailPrefix = explode('@', $body['email'])[0];
            $username    = strtolower(preg_replace('/[^a-z0-9\.]/i', '.', $emailPrefix));
            // Ensure username uniqueness
            $chkUn = $pdo->prepare("SELECT id FROM users WHERE username = :u LIMIT 1");
            $chkUn->execute([':u' => $username]);
            if ($chkUn->fetch()) {
                $username .= '.' . rand(100,999);
            }

            // Auto-generate employee_id
            $empId = trim($body['employee_id'] ?? '');
            if (!$empId && $hasEmpId) {
                $prefix = match($targetRole) { 'admin'=>'ADM', 'school_admin'=>'SA', 'dept_head'=>'DH', default=>'FAC' };
                $maxRow = $pdo->query("SELECT COALESCE(MAX(id),0)+1 AS nxt FROM users")->fetch();
                $empId  = $prefix . '-' . str_pad($maxRow['nxt'] ?? 1, 3, '0', STR_PAD_LEFT);
            }

            // Password
            $plainPwd  = trim($body['default_password'] ?? 'default123');
            if (strlen($plainPwd) < 6) $plainPwd = 'default123';
            $hashedPwd = password_hash($plainPwd, PASSWORD_BCRYPT, ['cost' => 12]);

            // Build INSERT dynamically based on available columns
            $insertCols = ['username', 'password', 'role', 'full_name', 'email', 'department'];
            $insertVals = [':un', ':pw', ':role', ':fn', ':em', ':dept'];
            $insertParams = [':un'=>$username,':pw'=>$hashedPwd,':role'=>$targetRole,
                ':fn'=>trim($body['full_name']),':em'=>trim($body['email']),':dept'=>trim($body['department'])];

            if ($hasEmpId && $empId) {
                $insertCols[] = 'employee_id'; $insertVals[] = ':eid';
                $insertParams[':eid'] = $empId;
            }
            if ($hasIsActive) {
                $insertCols[] = 'is_active'; $insertVals[] = ':active';
                $insertParams[':active'] = isset($body['is_active']) ? (int)$body['is_active'] : 1;
            }
            if ($hasFpc) {
                $insertCols[] = 'force_password_change'; $insertVals[] = ':fpc';
                $insertParams[':fpc'] = 1;
            }

            $pdo->prepare(
                "INSERT INTO users (" . implode(',', $insertCols) . ")
                 VALUES(" . implode(',', $insertVals) . ")"
            )->execute($insertParams);

            $newId = $pdo->lastInsertId();
            $requestorName = $body['requestor_name'] ?? 'Admin';
            $targetRoleLabel = roleLabel($targetRole);
            logAction($pdo, $requestorId, $requestorName, $requestorRole, 'UserManagement',
                "Created user account",
                "Name: {$body['full_name']} | Employee ID: " . ($empId ?: 'N/A') . " | Role: $targetRoleLabel | Email: {$body['email']} | Department: {$body['department']}");

            jsonOk(['message' => 'User created successfully.', 'user_id' => $newId, 'employee_id' => $empId ?: 'N/A']);
            break;

        // ── POST: Edit user ──────────────────────────────────────────────────
        case 'edit_user':
            if ($requestorRole === 'school_admin') {
                jsonErr('School Admin cannot edit user profiles.', 403);
            }
            $body   = jsonBody();
            $userId = (int)($body['user_id'] ?? 0);
            if (!$userId) jsonErr('user_id required');

            $sets = []; $params = [':id' => $userId];

            $allowedCols = ['full_name', 'email', 'department'];
            if ($hasIsActive) $allowedCols[] = 'is_active';

            foreach ($allowedCols as $f) {
                if (array_key_exists($f, $body)) {
                    $sets[]        = "$f = :$f";
                    $params[":$f"] = $f === 'is_active' ? (int)$body[$f] : trim($body[$f]);
                }
            }
            if (isset($body['role'])) {
                $sets[]          = 'role = :role';
                $params[':role'] = dbRole($body['role']);
            }
            if (empty($sets)) jsonErr('Nothing to update');

            $pdo->prepare("UPDATE users SET " . implode(', ', $sets) . " WHERE id = :id")
                ->execute($params);

            $requestorName = $body['requestor_name'] ?? 'Admin';
            // Fetch the user's name for a readable log entry
            $targetRow = $pdo->prepare("SELECT full_name, role FROM users WHERE id = :id");
            $targetRow->execute([':id' => $userId]);
            $targetInfo = $targetRow->fetch();
            $targetName = $targetInfo['full_name'] ?? "ID $userId";
            $targetRole2= roleLabel($targetInfo['role'] ?? '');
            $changedFields = array_keys(array_diff_key($body, ['user_id'=>1,'requestor_name'=>1,'requestor_id'=>1,'requestor_role'=>1,'action'=>1]));
            logAction($pdo, $requestorId, $requestorName, $requestorRole, 'UserManagement',
                "Edited user account",
                "User: $targetName ($targetRole2) | Fields updated: " . implode(', ', $changedFields));

            jsonOk(['message' => 'User updated successfully.']);
            break;

        // ── POST: Deactivate user ─────────────────────────────────────────────
        case 'delete_user':
            if ($requestorRole === 'school_admin') {
                jsonErr('School Admin cannot deactivate users.', 403);
            }
            $body   = jsonBody();
            $userId = (int)($body['user_id'] ?? 0);
            if (!$userId) jsonErr('user_id required');

            if ($hasIsActive) {
                $pdo->prepare("UPDATE users SET is_active = 0 WHERE id = :id")->execute([':id' => $userId]);
            } else {
                jsonErr('is_active column not found. Run um-schema.sql first.');
            }

            $requestorName = $body['requestor_name'] ?? 'Admin';
            $delRow = $pdo->prepare("SELECT full_name, email, role FROM users WHERE id = :id");
            $delRow->execute([':id' => $userId]);
            $delInfo = $delRow->fetch();
            $delName = $delInfo['full_name'] ?? "ID $userId";
            $delRole = roleLabel($delInfo['role'] ?? '');
            logAction($pdo, $requestorId, $requestorName, $requestorRole, 'UserManagement',
                "Deactivated user account",
                "User: $delName ($delRole) | Email: " . ($delInfo['email'] ?? '—') . " | Account disabled (is_active = 0)");
            jsonOk(['message' => 'User deactivated.']);
            break;

        // ── POST: Reset password ──────────────────────────────────────────────
        case 'reset_password':
            $body    = jsonBody();
            $userId  = (int)($body['user_id']         ?? 0);
            $newPwd  = trim($body['new_password']     ?? '');
            $confPwd = trim($body['confirm_password'] ?? $newPwd);

            if (!$userId)              jsonErr('user_id required');
            if (strlen($newPwd) < 8)   jsonErr('Password must be at least 8 characters.');
            if ($newPwd !== $confPwd)  jsonErr('Passwords do not match.');

            // School Admin may only reset IT Admin passwords
            if ($requestorRole === 'school_admin') {
                $chk = $pdo->prepare("SELECT role FROM users WHERE id = :id");
                $chk->execute([':id' => $userId]);
                $row = $chk->fetch();
                if (!$row)                   jsonErr('User not found.', 404);
                if ($row['role'] !== 'admin') jsonErr('School Admin can only reset IT Admin passwords.', 403);
            }

            $hash = password_hash($newPwd, PASSWORD_BCRYPT, ['cost' => 12]);
            if ($hasFpc) {
                $pdo->prepare("UPDATE users SET password = :pw, force_password_change = 1 WHERE id = :id")
                    ->execute([':pw' => $hash, ':id' => $userId]);
            } else {
                $pdo->prepare("UPDATE users SET password = :pw WHERE id = :id")
                    ->execute([':pw' => $hash, ':id' => $userId]);
            }

            $requestorName = $body['requestor_name'] ?? 'Admin';
            $resetRow = $pdo->prepare("SELECT full_name, email, role FROM users WHERE id = :id");
            $resetRow->execute([':id' => $userId]);
            $resetInfo = $resetRow->fetch();
            $resetName = $resetInfo['full_name'] ?? "ID $userId";
            $resetRole = roleLabel($resetInfo['role'] ?? '');
            logAction($pdo, $requestorId, $requestorName, $requestorRole, 'UserManagement',
                "Reset user password",
                "Target user: $resetName ($resetRole) | Email: " . ($resetInfo['email'] ?? '—') . " | Password changed and force-change flag set");
            jsonOk(['message' => 'Password reset successfully.']);
            break;

        // ── GET: Activity log ─────────────────────────────────────────────────
        case 'get_activity_log':
            $search   = trim($_GET['search']    ?? '');
            $module   = trim($_GET['module']    ?? 'all');
            $status   = trim($_GET['status']    ?? 'all');
            $dateFrom = trim($_GET['date_from'] ?? '');
            $dateTo   = trim($_GET['date_to']   ?? '');

            // Ensure audit_log table exists
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS audit_log (
                    id         INT AUTO_INCREMENT PRIMARY KEY,
                    user_id    INT DEFAULT NULL,
                    user_name  VARCHAR(100) NOT NULL DEFAULT '',
                    user_role  VARCHAR(50)  NOT NULL DEFAULT '',
                    module     VARCHAR(80)  NOT NULL DEFAULT '',
                    action     VARCHAR(150) NOT NULL DEFAULT '',
                    detail     TEXT DEFAULT NULL,
                    ip_address VARCHAR(45)  DEFAULT NULL,
                    status     ENUM('Success','Failed','Warning') DEFAULT 'Success',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )"
            );

            $where = []; $params = [];
            if ($module !== 'all') { $where[] = 'module = :mod'; $params[':mod'] = $module; }
            if ($status !== 'all') { $where[] = 'status = :st';  $params[':st']  = $status; }
            if ($dateFrom)         { $where[] = 'DATE(created_at) >= :df'; $params[':df'] = $dateFrom; }
            if ($dateTo)           { $where[] = 'DATE(created_at) <= :dt'; $params[':dt'] = $dateTo; }
            if ($search) {
                $sv = "%$search%";
                $where[]          = '(user_name LIKE :s1 OR action LIKE :s2 OR detail LIKE :s3)';
                $params[':s1'] = $params[':s2'] = $params[':s3'] = $sv;
            }
            $whereSQL = $where ? 'WHERE ' . implode(' AND ', $where) : '';
            $stmt = $pdo->prepare("SELECT * FROM audit_log $whereSQL ORDER BY created_at DESC LIMIT 300");
            $stmt->execute($params);
            jsonOk(['data' => $stmt->fetchAll()]);
            break;

        // ── GET: Single log entry ─────────────────────────────────────────────
        case 'get_log_entry':
            $logId = (int)($_GET['log_id'] ?? 0);
            if (!$logId) jsonErr('log_id required');
            $stmt = $pdo->prepare("SELECT * FROM audit_log WHERE id = :id");
            $stmt->execute([':id' => $logId]);
            $log = $stmt->fetch();
            if (!$log) jsonErr('Log entry not found', 404);
            jsonOk(['log' => $log]);
            break;

        default:
            jsonErr("Unknown action: " . htmlspecialchars($action), 400);
    }

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
}
