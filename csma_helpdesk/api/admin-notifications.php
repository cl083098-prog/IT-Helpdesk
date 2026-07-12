<?php
// api/admin-notifications.php
// Lightweight notification endpoint for IT Administrator pages.
// Actions: get | mark_all_read | mark_one
// Uses the shared `notifications` table (created by school-admin-schema.sql).

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function jsOk(array $d): void  { echo json_encode(array_merge(['success'=>true],$d)); exit; }
function jsErr(string $m): void { echo json_encode(['success'=>false,'message'=>$m]); exit; }

$action = trim($_GET['action'] ?? '');
$userId = (int)($_GET['user_id'] ?? 0);

// Auth check — must be an IT Admin or the request has no user_id
// We trust the frontend session here; full auth is in login.php
if (!$userId && $action === 'get') {
    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $userId = (int)($body['user_id'] ?? 0);
}

try {
    // Ensure the notifications table exists before any query
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS notifications (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            target_role VARCHAR(50)  DEFAULT NULL,
            target_user INT          DEFAULT NULL,
            title       VARCHAR(150) NOT NULL,
            description TEXT         DEFAULT NULL,
            is_read     TINYINT(1)   DEFAULT 0,
            created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
        )"
    );

    switch ($action) {

        // ── GET notifications for an IT Admin user ───────────────────────────
        case 'get':
            // v18 fix: old query used `target_user = :uid OR target_role = 'admin'`
            // — which leaked notifications targeted at ANOTHER admin (with
            // target_user = other, target_role='admin') into this admin's bell.
            // Correct semantics:
            //   • target_user = me (personal)              → this admin sees
            //   • target_user IS NULL AND role='admin'     → broadcast to all admins
            //   • target_user IS NULL AND role IS NULL     → global broadcast
            //   • target_user = someone else               → hidden from me
            $stmt = $pdo->prepare(
                "SELECT * FROM notifications
                 WHERE target_user = :uid
                    OR (target_user IS NULL AND (target_role = 'admin' OR target_role IS NULL))
                 ORDER BY created_at DESC
                 LIMIT 30"
            );
            $stmt->execute([':uid' => $userId]);
            jsOk(['data' => $stmt->fetchAll()]);
            break;

        // ── Mark all as read ─────────────────────────────────────────────────
        case 'mark_all_read':
            $body   = json_decode(file_get_contents('php://input'), true) ?? [];
            $uid    = (int)($body['user_id'] ?? $userId);
            // v18: same scope fix — never touch OTHER admins' personal notifs.
            $pdo->prepare(
                "UPDATE notifications SET is_read = 1
                 WHERE is_read = 0 AND (target_user = :uid
                    OR (target_user IS NULL AND (target_role = 'admin' OR target_role IS NULL)))"
            )->execute([':uid' => $uid]);
            jsOk(['message' => 'All notifications marked as read.']);
            break;

        // ── Mark one as read ─────────────────────────────────────────────────
        case 'mark_one':
            $body   = json_decode(file_get_contents('php://input'), true) ?? [];
            $notifId = (int)($body['notif_id'] ?? 0);
            if (!$notifId) jsErr('notif_id required');
            $pdo->prepare("UPDATE notifications SET is_read = 1 WHERE id = :id")
                ->execute([':id' => $notifId]);
            jsOk(['message' => 'Notification marked as read.']);
            break;

        // ── Unread count (for lightweight polling) ───────────────────────────
        case 'unread_count':
            $stmt = $pdo->prepare(
                "SELECT COUNT(*) FROM notifications
                 WHERE is_read = 0 AND (target_user = :uid
                    OR (target_user IS NULL AND (target_role = 'admin' OR target_role IS NULL)))"
            );
            $stmt->execute([':uid' => $userId]);
            jsOk(['unread' => (int)$stmt->fetchColumn()]);
            break;

        // ── Push a new notification (called internally by other API files) ───
        case 'push':
            $body  = json_decode(file_get_contents('php://input'), true) ?? [];
            $title = trim($body['title'] ?? '');
            if (!$title) jsErr('title required');
            $pdo->prepare(
                "INSERT INTO notifications (target_role, target_user, title, description)
                 VALUES(:role, :uid, :title, :desc)"
            )->execute([
                ':role'  => $body['target_role'] ?? 'admin',
                ':uid'   => isset($body['target_user']) ? (int)$body['target_user'] : null,
                ':title' => $title,
                ':desc'  => trim($body['description'] ?? ''),
            ]);
            jsOk(['message' => 'Notification pushed.', 'id' => $pdo->lastInsertId()]);
            break;

        default:
            jsErr("Unknown action: " . htmlspecialchars($action));
    }

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
}
