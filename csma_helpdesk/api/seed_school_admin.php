<?php
// api/seed_school_admin.php
// Visit: http://localhost/csma_helpdesk/api/seed_school_admin.php
// DELETE after running in production.

require_once 'config.php';
$results = []; $errors = [];

// 1. Update ENUM
try {
    $pdo->exec("ALTER TABLE users MODIFY COLUMN role ENUM('admin','requester','dept_head','school_admin') NOT NULL DEFAULT 'requester'");
    $results[] = '✅ users.role ENUM updated to include school_admin';
} catch (PDOException $e) {
    $results[] = 'ℹ️  ENUM: ' . $e->getMessage();
}

// 2. Create audit_log
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT DEFAULT NULL,
        user_name VARCHAR(100) NOT NULL,
        user_role VARCHAR(50) NOT NULL,
        module VARCHAR(80) NOT NULL,
        action VARCHAR(150) NOT NULL,
        detail TEXT DEFAULT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        status ENUM('Success','Failed','Warning') DEFAULT 'Success',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )");
    $results[] = '✅ audit_log table ensured';
} catch (PDOException $e) { $results[] = 'ℹ️  audit_log: ' . $e->getMessage(); }

// 3. Create notifications
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        target_role VARCHAR(50) DEFAULT NULL,
        target_user INT DEFAULT NULL,
        title VARCHAR(150) NOT NULL,
        description TEXT DEFAULT NULL,
        is_read TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (target_user) REFERENCES users(id) ON DELETE CASCADE
    )");
    $results[] = '✅ notifications table ensured';
} catch (PDOException $e) { $results[] = 'ℹ️  notifications: ' . $e->getMessage(); }

// 4. Create generated_reports
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS generated_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        generated_by INT NOT NULL,
        report_name VARCHAR(200) NOT NULL,
        report_type VARCHAR(80) NOT NULL,
        date_from DATE DEFAULT NULL,
        date_to DATE DEFAULT NULL,
        export_format VARCHAR(10) NOT NULL,
        file_path VARCHAR(255) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (generated_by) REFERENCES users(id)
    )");
    $results[] = '✅ generated_reports table ensured';
} catch (PDOException $e) { $results[] = 'ℹ️  generated_reports: ' . $e->getMessage(); }

// 5. Seed user
$username = 'schooladmin'; $plainPass = 'schooladmin123';
$hash = password_hash($plainPass, PASSWORD_BCRYPT, ['cost' => 12]);
try {
    $check = $pdo->prepare("SELECT id FROM users WHERE username = :u LIMIT 1");
    $check->execute([':u' => $username]);
    $existing = $check->fetchColumn();
    if ($existing) {
        $pdo->prepare("UPDATE users SET password=:pw, role='school_admin', full_name=:fn, email=:em WHERE username=:u")
            ->execute([':pw'=>$hash,':fn'=>'Principal / School Admin',':em'=>'principal@csma.edu.ph',':u'=>$username]);
        $results[] = "✅ Updated '$username' → school_admin role, password reset";
    } else {
        $pdo->prepare("INSERT INTO users (username,password,role,full_name,email,department) VALUES(:u,:pw,'school_admin',:fn,:em,:dept)")
            ->execute([':u'=>$username,':pw'=>$hash,':fn'=>'Principal / School Admin',':em'=>'principal@csma.edu.ph',':dept'=>'Administration']);
        $results[] = "✅ Created new school_admin user '$username'";
    }
    $results[] = "🔑 Credentials: <strong>$username</strong> / <strong>$plainPass</strong>";
} catch (PDOException $e) { $errors[] = '❌ ' . $e->getMessage(); }

// 6. Verify
try {
    $row = $pdo->prepare("SELECT id,username,role,full_name FROM users WHERE username=:u");
    $row->execute([':u'=>$username]);
    $r = $row->fetch(PDO::FETCH_ASSOC);
    $results[] = '✅ Verified in DB: ' . json_encode($r);
} catch (PDOException $e) { $errors[] = '❌ Verify: ' . $e->getMessage(); }
?><!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>School Admin Seed</title>
<style>body{font-family:monospace;padding:32px;background:#f0f4f8}h1{color:#1a4a6e;margin-bottom:24px}.result{background:white;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.06)}.result p{margin-bottom:8px;font-size:.9rem;line-height:1.6}.error{background:#fde2e2;border-left:4px solid #c62828;padding:12px;border-radius:8px;margin-bottom:8px}.action{margin-top:24px;background:#1a4a6e;color:white;padding:14px 28px;border-radius:40px;display:inline-block;text-decoration:none;font-size:.9rem;font-weight:700}.warn{background:#fff5eb;border-left:4px solid #e67e22;padding:14px;border-radius:8px;margin-top:20px;font-size:.85rem}</style>
</head><body>
<h1>🔧 School Admin Setup</h1>
<div class="result">
<?php foreach($results as $r) echo "<p>$r</p>"; ?>
<?php foreach($errors as $e) echo "<p class='error'>" . htmlspecialchars($e) . "</p>"; ?>
</div>
<?php if(empty($errors)): ?>
<a class="action" href="../helpdesktry/Login.html">→ Go to Login Page</a>
<div class="warn">⚠️ Delete <code>api/seed_school_admin.php</code> after setup.</div>
<?php endif; ?>
</body></html>
