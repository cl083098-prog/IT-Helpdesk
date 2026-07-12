<?php
// api/login_diag.php
// Open in browser:  http://localhost/csma_helpdesk/api/login_diag.php
// Times each step of the login pipeline so you can see WHERE the hang is.

header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><meta charset="utf-8"><title>Login diagnostic</title>';
echo '<style>
    body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;margin:24px;color:#1c4c6e;background:#f5f9fe;}
    h1{font-size:1.3rem;margin:0 0 10px;}
    table{border-collapse:collapse;background:#fff;width:100%;max-width:720px;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
    th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #eef2f6;font-family:ui-monospace,Consolas,monospace;font-size:13px;}
    th{background:#eaf2fa;color:#1c4c6e;font-weight:600;}
    .ok{color:#1e7a4a;font-weight:600;}
    .warn{color:#b56c00;font-weight:600;}
    .bad{color:#c62828;font-weight:600;}
    .hint{color:#6b8399;font-size:12px;margin-top:12px;line-height:1.5;}
</style>';
echo '<h1>Login diagnostic</h1>';
echo '<p class="hint">Each step is timed. The one that takes multiple seconds is the culprit.</p>';

function row($label, $ms, $note = '') {
    $cls = $ms < 100 ? 'ok' : ($ms < 1000 ? 'warn' : 'bad');
    echo '<tr><td>' . htmlspecialchars($label) . '</td><td class="' . $cls . '">' . number_format($ms, 1) . ' ms</td><td>' . htmlspecialchars($note) . '</td></tr>';
}

echo '<table><thead><tr><th>Step</th><th>Time</th><th>Notes</th></tr></thead><tbody>';

// 1. Load config.php
$t0 = microtime(true);
try {
    require_once 'config.php';
    $ms = (microtime(true) - $t0) * 1000;
    row('1. require config.php + PDO connect', $ms, isset($pdo) ? 'PDO OK' : 'no $pdo variable');
} catch (Throwable $e) {
    $ms = (microtime(true) - $t0) * 1000;
    row('1. require config.php + PDO connect', $ms, 'FAILED: ' . $e->getMessage());
    echo '</tbody></table><p class="hint bad">Stopped: config.php failed. Check the DB credentials in <code>config.php</code>.</p>';
    exit;
}

// 2. Simple SELECT 1
$t0 = microtime(true);
try {
    $pdo->query("SELECT 1")->fetchColumn();
    $ms = (microtime(true) - $t0) * 1000;
    row('2. SELECT 1 (MySQL responsive?)', $ms);
} catch (Throwable $e) {
    $ms = (microtime(true) - $t0) * 1000;
    row('2. SELECT 1', $ms, 'FAILED: ' . $e->getMessage());
}

// 3. SELECT from users table (fast if indexed)
$t0 = microtime(true);
try {
    $u = $pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();
    $ms = (microtime(true) - $t0) * 1000;
    row('3. SELECT COUNT(*) FROM users', $ms, "$u rows");
} catch (Throwable $e) {
    $ms = (microtime(true) - $t0) * 1000;
    row('3. SELECT users', $ms, 'FAILED: ' . $e->getMessage());
}

// 4. Does audit_log exist?
$t0 = microtime(true);
try {
    $exists = $pdo->query("SHOW TABLES LIKE 'audit_log'")->fetch();
    $ms = (microtime(true) - $t0) * 1000;
    row('4. audit_log table exists?', $ms, $exists ? 'yes' : 'NO — first login will run CREATE TABLE (adds latency once)');
} catch (Throwable $e) {
    $ms = (microtime(true) - $t0) * 1000;
    row('4. audit_log check', $ms, 'FAILED: ' . $e->getMessage());
}

// 5. CREATE TABLE IF NOT EXISTS (idempotent — should be fast if it exists)
$t0 = microtime(true);
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL,
        user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '',
        module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '',
        detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL,
        status ENUM('Success','Failed','Warning') DEFAULT 'Success',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    $ms = (microtime(true) - $t0) * 1000;
    row('5. CREATE TABLE IF NOT EXISTS audit_log', $ms);
} catch (Throwable $e) {
    $ms = (microtime(true) - $t0) * 1000;
    row('5. CREATE TABLE audit_log', $ms, 'FAILED: ' . $e->getMessage());
}

// 6. password_verify with a real hash (measures bcrypt cost — should be <200ms)
$t0 = microtime(true);
$hash = password_hash('test123', PASSWORD_DEFAULT);
password_verify('test123', $hash);
$ms = (microtime(true) - $t0) * 1000;
row('6. password_hash + password_verify', $ms, 'bcrypt cost check');

echo '</tbody></table>';
echo '<p class="hint">Green = fast (&lt;100 ms). Amber = slow (&lt;1 s). Red = very slow (&gt;1 s) — that is where your 30 s hang is coming from.</p>';
echo '<p class="hint">Common patterns:<br>
    &bull; Step 1 red → PDO cannot reach MySQL. Restart MySQL only (not Apache).<br>
    &bull; Step 2 red → MySQL accepted the connection but is unresponsive to queries. Check phpMyAdmin.<br>
    &bull; Step 5 red on first run only → normal one-off cost of creating audit_log. Refresh; second run should be green.<br>
    &bull; Everything green here but the login page still times out → the browser is holding the connection open waiting for close. Apply the v20 login.php.</p>';
