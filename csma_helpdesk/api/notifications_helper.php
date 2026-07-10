<?php
// api/notifications_helper.php
// -----------------------------------------------------------------------------
// Shared helper — require_once'd by every workflow endpoint that needs to
// create notifications (submit_ticket, save_ticket_detail, update_ticket,
// dept-head-data, etc).
//
// Design:
//   • Idempotent CREATE TABLE — safe to call every time.
//   • Best-effort: any exception is swallowed. The core business op must
//     never fail because of a notification write.
//   • Two forms:
//       pushNotification($pdo, [...])      → single row
//       pushNotificationToRole($pdo, $role, $title, ...)  → role broadcast helper
// -----------------------------------------------------------------------------

if (!function_exists('pushNotification')) {

    /**
     * @param PDO   $pdo
     * @param array $args {
     *   @var string|null $target_role   'admin' | 'school_admin' | 'dept_head' | 'requester'  (optional)
     *   @var int|null    $target_user   users.id                                                (optional)
     *   @var string      $event_type    'ticket_submitted' | 'status_change' | 'approval_needed' | ... (default 'info')
     *   @var string      $title         short one-line title (required)
     *   @var string      $description   longer detail                                            (optional)
     *   @var string|null $link_url      deep-link (optional)
     *   @var int|null    $ticket_id     related ticket id (optional)
     * }
     * @return bool  true on success (or when swallowed silently)
     */
    function pushNotification(PDO $pdo, array $args): bool {
        try {
            // Idempotent — CI/staging DBs may not have been migrated yet.
            $pdo->exec(
                "CREATE TABLE IF NOT EXISTS notifications (
                    id           INT AUTO_INCREMENT PRIMARY KEY,
                    target_role  VARCHAR(50)  DEFAULT NULL,
                    target_user  INT          DEFAULT NULL,
                    event_type   VARCHAR(50)  NOT NULL DEFAULT 'info',
                    title        VARCHAR(150) NOT NULL,
                    description  TEXT         DEFAULT NULL,
                    link_url     VARCHAR(255) DEFAULT NULL,
                    ticket_id    INT          DEFAULT NULL,
                    is_read      TINYINT(1)   NOT NULL DEFAULT 0,
                    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            );

            $title = trim((string)($args['title'] ?? ''));
            if ($title === '') return false;

            // Detect available columns so we don't crash on older schemas
            static $cols = null;
            if ($cols === null) {
                $cols = $pdo->query("SHOW COLUMNS FROM notifications")->fetchAll(PDO::FETCH_COLUMN);
            }

            $fields = ['title'];
            $vals   = [':title'];
            $params = [':title' => $title];

            $mapping = [
                'target_role' => $args['target_role'] ?? null,
                'target_user' => isset($args['target_user']) ? (int)$args['target_user'] : null,
                'event_type'  => $args['event_type']  ?? 'info',
                'description' => $args['description'] ?? null,
                'link_url'    => $args['link_url']    ?? null,
                'ticket_id'   => isset($args['ticket_id']) ? (int)$args['ticket_id'] : null,
            ];

            foreach ($mapping as $col => $val) {
                if (!in_array($col, $cols, true)) continue;
                $fields[]           = $col;
                $vals[]             = ':' . $col;
                $params[':' . $col] = $val;
            }

            $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
                    VALUES (" . implode(',', $vals) . ")";
            $pdo->prepare($sql)->execute($params);
            return true;
        } catch (PDOException $e) {
            // Best-effort — never propagate. Log to error_log for post-mortem.
            error_log("[notifications_helper] push failed: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Broadcast to every user with the given role. Handy when there are
     * multiple IT Admins or School Admins.
     */
    function pushNotificationToRole(PDO $pdo, string $role, string $title, string $description = '',
                                     string $eventType = 'info', ?string $linkUrl = null, ?int $ticketId = null): bool {
        return pushNotification($pdo, [
            'target_role' => $role,
            'title'       => $title,
            'description' => $description,
            'event_type'  => $eventType,
            'link_url'    => $linkUrl,
            'ticket_id'   => $ticketId,
        ]);
    }

    /**
     * Notify the department head(s) of a given department. Falls back to a
     * role broadcast if there's no matching head on file.
     */
    function pushNotificationToDeptHead(PDO $pdo, int $departmentId, string $title, string $description = '',
                                        string $eventType = 'approval_needed', ?string $linkUrl = null, ?int $ticketId = null): bool {
        try {
            $stmt = $pdo->prepare("SELECT id FROM users WHERE role = 'dept_head' AND department_id = :did AND status = 'Active'");
            $stmt->execute([':did' => $departmentId]);
            $ids = $stmt->fetchAll(PDO::FETCH_COLUMN);

            if (empty($ids)) {
                // Fallback: broadcast to any dept head so nothing gets lost
                return pushNotificationToRole($pdo, 'dept_head', $title, $description, $eventType, $linkUrl, $ticketId);
            }

            $ok = true;
            foreach ($ids as $uid) {
                $ok = pushNotification($pdo, [
                    'target_user' => (int)$uid,
                    'target_role' => 'dept_head',
                    'title'       => $title,
                    'description' => $description,
                    'event_type'  => $eventType,
                    'link_url'    => $linkUrl,
                    'ticket_id'   => $ticketId,
                ]) && $ok;
            }
            return $ok;
        } catch (PDOException $e) {
            error_log("[notifications_helper] dept-head lookup failed: " . $e->getMessage());
            return false;
        }
    }
}
