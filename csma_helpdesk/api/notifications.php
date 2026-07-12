<?php
// api/notifications.php
// -----------------------------------------------------------------------------
// Unified notifications endpoint used by all four roles.
//
// GET  ?action=get&user_id=X&user_role=Y      -> list (unread first)
// POST action=mark_all_read {user_id, user_role}
// POST action=mark_one      {notif_id, user_id}
// POST action=push          {target_user | target_role, title, description, ...}
//                              — used sparingly; workflow endpoints should call
//                                pushNotification() from notifications_helper.php
//                                directly rather than round-trip through HTTP.
// -----------------------------------------------------------------------------

require_once 'config.php';
require_once 'notifications_helper.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function jsOk(array $d): void  { echo json_encode(array_merge(['success'=>true],$d)); exit; }
function jsErr(string $m): void { echo json_encode(['success'=>false,'message'=>$m]); exit; }

$body    = json_decode(file_get_contents('php://input'), true) ?? [];
$action  = trim($_GET['action']    ?? $body['action']    ?? '');
$userId  = (int)($_GET['user_id']  ?? $body['user_id']  ?? 0);
$role    = trim($_GET['user_role'] ?? $body['user_role'] ?? '');

// Ensure the table exists (uses the helper's idempotent CREATE)
pushNotification($pdo, ['title' => '__PING__', 'target_user' => -1]); // no-op path just to trigger CREATE TABLE
$pdo->exec("DELETE FROM notifications WHERE title = '__PING__' AND target_user = -1");

try {
    switch ($action) {

        // ── LIST ────────────────────────────────────────────────────────────
        case 'get': {
            // v18: For the 'admin' role specifically, a broadcast to
            // target_role='admin' must have target_user NULL; otherwise it's
            // a personal notif meant for exactly one admin and shouldn't leak
            // to their peers. For other roles the boundary matters less (few
            // dept_heads/school_admins per install) but we apply the same
            // rule for consistency.
            $sql = "SELECT id, target_role, target_user, event_type, title, description,
                           link_url, ticket_id, is_read, created_at
                    FROM notifications
                    WHERE target_user = :uid";
            $params = [':uid' => $userId];
            if ($role !== '') {
                $sql .= " OR (target_user IS NULL AND target_role = :role)";
                $params[':role'] = $role;
            }
            $sql .= " ORDER BY is_read ASC, created_at DESC LIMIT 50";

            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();

            $unread = 0;
            foreach ($rows as $r) if (!$r['is_read']) $unread++;

            jsOk(['data' => $rows, 'unread' => $unread]);
        }

        // ── MARK ALL READ ───────────────────────────────────────────────────
        case 'mark_all_read': {
            $sql = "UPDATE notifications SET is_read = 1
                    WHERE is_read = 0 AND (target_user = :uid";
            $params = [':uid' => $userId];
            if ($role !== '') {
                $sql .= " OR (target_user IS NULL AND target_role = :role)";
                $params[':role'] = $role;
            }
            $sql .= ")";
            $pdo->prepare($sql)->execute($params);
            jsOk(['message' => 'Marked all as read.']);
        }

        // ── MARK ONE READ ───────────────────────────────────────────────────
        case 'mark_one': {
            $notifId = (int)($body['notif_id'] ?? $_GET['notif_id'] ?? 0);
            if (!$notifId) jsErr('notif_id required');
            $pdo->prepare("UPDATE notifications SET is_read = 1 WHERE id = :id")
                ->execute([':id' => $notifId]);
            jsOk(['message' => 'Marked as read.']);
        }

        // ── UNREAD COUNT (light-weight polling) ─────────────────────────────
        case 'unread_count': {
            $sql = "SELECT COUNT(*) FROM notifications
                    WHERE is_read = 0 AND (target_user = :uid";
            $params = [':uid' => $userId];
            if ($role !== '') {
                $sql .= " OR (target_user IS NULL AND target_role = :role)";
                $params[':role'] = $role;
            }
            $sql .= ")";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            jsOk(['unread' => (int)$stmt->fetchColumn()]);
        }

        // ── PUSH (rarely used from HTTP — helper is preferred) ──────────────
        case 'push': {
            $ok = pushNotification($pdo, [
                'target_role' => $body['target_role'] ?? null,
                'target_user' => isset($body['target_user']) ? (int)$body['target_user'] : null,
                'event_type'  => $body['event_type']  ?? 'info',
                'title'       => trim($body['title']  ?? ''),
                'description' => trim($body['description'] ?? ''),
                'link_url'    => $body['link_url']  ?? null,
                'ticket_id'   => isset($body['ticket_id']) ? (int)$body['ticket_id'] : null,
            ]);
            if (!$ok) jsErr('Could not push notification.');
            jsOk(['message' => 'Pushed.']);
        }

        default:
            jsErr("Unknown action: $action");
    }
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'DB error: '.$e->getMessage()]);
}
