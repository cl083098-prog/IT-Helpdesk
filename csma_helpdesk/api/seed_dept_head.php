<?php
// api/seed_dept_head.php
// ============================================================================
// Run this ONCE by visiting:
//   http://localhost/csma_helpdesk/api/seed_dept_head.php
//
// It will:
//   1. Ensure the users.role ENUM includes 'dept_head'
//   2. Insert (or update) the dept_head test account with a proper bcrypt hash
//   3. Show you the result so you know it worked
//
// DELETE this file after running it in production.
// ============================================================================

require_once 'config.php';

$results = [];
$errors  = [];

// ── Step 1: Update the ENUM to include dept_head ─────────────────────────────
try {
    $pdo->exec(
        "ALTER TABLE users
         MODIFY COLUMN role ENUM('admin','requester','dept_head') NOT NULL DEFAULT 'requester'"
    );
    $results[] = '✅ users.role ENUM updated to include dept_head';
} catch (PDOException $e) {
    // May already include dept_head — that's fine
    $results[] = 'ℹ️  ENUM alter skipped (may already be correct): ' . $e->getMessage();
}

// ── Step 2: Update approval_status column on tickets ─────────────────────────
try {
    $pdo->exec(
        "ALTER TABLE tickets
         ADD COLUMN IF NOT EXISTS approval_status
             ENUM('Not Required','Pending Approval','Approved','Rejected')
             NOT NULL DEFAULT 'Not Required'
             AFTER status"
    );
    $results[] = '✅ tickets.approval_status column ensured';
} catch (PDOException $e) {
    $results[] = 'ℹ️  approval_status column skipped: ' . $e->getMessage();
}

// ── Step 3: Create ticket_approvals table if missing ─────────────────────────
try {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ticket_approvals (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            ticket_id       INT          NOT NULL,
            dept_head_id    INT          NOT NULL,
            decision        ENUM('Pending Approval','Approved','Rejected') NOT NULL DEFAULT 'Pending Approval',
            estimated_cost  DECIMAL(10,2) DEFAULT NULL,
            rejection_note  TEXT          DEFAULT NULL,
            decided_at      DATETIME      DEFAULT NULL,
            created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ticket_id)    REFERENCES tickets(id)  ON DELETE CASCADE,
            FOREIGN KEY (dept_head_id) REFERENCES users(id),
            UNIQUE KEY unique_ticket_depthead (ticket_id, dept_head_id)
        )"
    );
    $results[] = '✅ ticket_approvals table ensured';
} catch (PDOException $e) {
    $results[] = 'ℹ️  ticket_approvals: ' . $e->getMessage();
}

// ── Step 4: Create ticket_feedback table if missing ───────────────────────────
try {
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS ticket_feedback (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            ticket_id    INT        NOT NULL UNIQUE,
            user_id      INT        NOT NULL,
            rating       TINYINT(1) NOT NULL,
            comment      TEXT       DEFAULT NULL,
            submitted_at DATETIME   DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id)   REFERENCES users(id)
        )"
    );
    $results[] = '✅ ticket_feedback table ensured';
} catch (PDOException $e) {
    $results[] = 'ℹ️  ticket_feedback: ' . $e->getMessage();
}

// ── Step 5: Insert or update the dept_head user ──────────────────────────────
$username  = 'depthead';
$plainPass = 'depthead123';
$hash      = password_hash($plainPass, PASSWORD_BCRYPT, ['cost' => 12]);
$fullName  = 'Maria Santos';
$email     = 'maria.santos@csma.edu.ph';
$dept      = 'Senior High School';

try {
    // Check if user already exists
    $check = $pdo->prepare("SELECT id FROM users WHERE username = :u LIMIT 1");
    $check->execute([':u' => $username]);
    $existing = $check->fetchColumn();

    if ($existing) {
        // Update the existing user's password and role
        $upd = $pdo->prepare(
            "UPDATE users SET password = :pw, role = 'dept_head', full_name = :fn,
                              email = :em, department = :dept
             WHERE username = :u"
        );
        $upd->execute([':pw' => $hash, ':fn' => $fullName, ':em' => $email, ':dept' => $dept, ':u' => $username]);
        $results[] = "✅ Updated existing user '$username' — role set to dept_head, password reset";
    } else {
        // Insert new user
        $ins = $pdo->prepare(
            "INSERT INTO users (username, password, role, full_name, email, department)
             VALUES (:u, :pw, 'dept_head', :fn, :em, :dept)"
        );
        $ins->execute([':u' => $username, ':pw' => $hash, ':fn' => $fullName, ':em' => $email, ':dept' => $dept]);
        $results[] = "✅ Created new dept_head user '$username'";
    }

    $results[] = "🔑 Login credentials:  <strong>$username</strong> / <strong>$plainPass</strong>";

} catch (PDOException $e) {
    $errors[] = '❌ Failed to create dept_head user: ' . $e->getMessage();
}

// ── Step 6: Verify by loading the user back ───────────────────────────────────
try {
    $verify = $pdo->prepare("SELECT id, username, role, full_name, department FROM users WHERE username = :u");
    $verify->execute([':u' => $username]);
    $row = $verify->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        $results[] = '✅ Verification — user in DB: ' . json_encode($row);
    } else {
        $errors[] = '❌ Verification failed — user not found after insert';
    }
} catch (PDOException $e) {
    $errors[] = '❌ Verification query failed: ' . $e->getMessage();
}

// ── Output ────────────────────────────────────────────────────────────────────
?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Dept Head Seed</title>
    <style>
        body { font-family: monospace; padding: 32px; background: #f0f4f8; color: #1a2c3e; }
        h1 { font-size: 1.4rem; margin-bottom: 24px; color: #1a4a6e; }
        .result { background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .result p { margin-bottom: 8px; font-size: 0.9rem; line-height: 1.6; }
        .error  { background: #fde2e2; border-left: 4px solid #c62828; padding: 16px; border-radius: 8px; margin-bottom: 8px; }
        .action { margin-top: 24px; background: #1a4a6e; color: white; padding: 16px 28px; border-radius: 40px; display: inline-block; text-decoration: none; font-size: 0.9rem; font-weight: 700; }
        .warning { background: #fff5eb; border-left: 4px solid #e67e22; padding: 16px; border-radius: 8px; margin-top: 24px; font-size: 0.85rem; }
    </style>
</head>
<body>
    <h1>🔧 Department Head Setup</h1>
    <div class="result">
        <?php foreach ($results as $r): ?>
            <p><?= $r ?></p>
        <?php endforeach; ?>
        <?php foreach ($errors as $err): ?>
            <p class="error"><?= htmlspecialchars($err) ?></p>
        <?php endforeach; ?>
    </div>
    <?php if (empty($errors)): ?>
        <a class="action" href="../helpdesktry/Login.html">→ Go to Login Page</a>
        <div class="warning">
            ⚠️ <strong>Security reminder:</strong> Delete or rename <code>api/seed_dept_head.php</code> after setup is complete.
        </div>
    <?php endif; ?>
</body>
</html>
