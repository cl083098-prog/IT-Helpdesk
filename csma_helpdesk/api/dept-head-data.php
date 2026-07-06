<?php
// api/dept-head-data.php
// Returns all data needed by the Department Head dashboard in one fetch call.

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$action = $_GET['action'] ?? $_POST['action'] ?? '';

try {
    switch ($action) {

        // ── Requests awaiting approval from this dept head's department ──────
        case 'get_pending_approvals':
            $deptHeadId = (int)($_GET['dept_head_id'] ?? 0);
            if (!$deptHeadId) { jsonError('dept_head_id required'); }

            // Get this dept head's department
            $deptStmt = $pdo->prepare("SELECT department FROM users WHERE id = :id");
            $deptStmt->execute([':id' => $deptHeadId]);
            $deptRow = $deptStmt->fetch();
            if (!$deptRow) { jsonError('User not found'); }
            $department = $deptRow['department'];

            $filter = $_GET['filter'] ?? 'all'; // all | pending | approved | rejected

            $sql = "SELECT
                        t.id, t.ticket_code, t.title, t.priority, t.category,
                        t.equipment_item, t.description, t.submitted_at,
                        t.approval_status, t.status, t.sla_response_hours,
                        t.response_due_at, t.resolution_due_at,
                        u.full_name AS requester_name,
                        d.name AS department_name,
                        ta.estimated_cost, ta.rejection_note, ta.decided_at
                    FROM tickets t
                    JOIN users u       ON u.id = t.requester_id
                    JOIN departments d ON d.id = t.department_id
                    LEFT JOIN ticket_approvals ta
                        ON ta.ticket_id = t.id AND ta.dept_head_id = :dhid
                    WHERE d.name = :dept
                      AND t.category IN ('Equipment', 'Consumable')";

            if ($filter === 'pending')  $sql .= " AND t.approval_status = 'Pending Approval'";
            if ($filter === 'approved') $sql .= " AND t.approval_status = 'Approved'";
            if ($filter === 'rejected') $sql .= " AND t.approval_status = 'Rejected'";

            $sql .= " ORDER BY t.submitted_at DESC";

            $stmt = $pdo->prepare($sql);
            $stmt->execute([':dhid' => $deptHeadId, ':dept' => $department]);
            jsonSuccess(['approvals' => $stmt->fetchAll(), 'department' => $department]);
            break;

        // ── Dept head's own submitted tickets ────────────────────────────────
        case 'get_my_tickets':
            $deptHeadId = (int)($_GET['dept_head_id'] ?? 0);
            if (!$deptHeadId) { jsonError('dept_head_id required'); }

            $stmt = $pdo->prepare(
                "SELECT t.id, t.ticket_code, t.title, t.category, t.equipment_item,
                        t.request_type, t.priority, t.status, t.approval_status,
                        t.description, t.location, t.preferred_date,
                        d.name AS department, t.assigned_to,
                        t.response_due_at, t.resolution_due_at, t.submitted_at
                 FROM tickets t
                 JOIN departments d ON d.id = t.department_id
                 WHERE t.requester_id = :rid
                 ORDER BY t.submitted_at DESC"
            );
            $stmt->execute([':rid' => $deptHeadId]);
            $tickets = $stmt->fetchAll();

            // Attach conversation threads
            if ($tickets) {
                $ids = array_column($tickets, 'id');
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $actStmt = $pdo->prepare(
                    "SELECT ticket_id, author_name, message,
                            IF(author_id = ?, 1, 0) AS is_requester, created_at
                     FROM ticket_activity
                     WHERE ticket_id IN ($placeholders)
                     ORDER BY created_at ASC"
                );
                $actStmt->execute(array_merge([$deptHeadId], $ids));
                $grouped = [];
                foreach ($actStmt->fetchAll() as $act) {
                    $grouped[$act['ticket_id']][] = $act;
                }
                foreach ($tickets as &$t) {
                    $t['conversations'] = $grouped[$t['id']] ?? [];
                }
            }

            jsonSuccess(['data' => $tickets]);
            break;

        // ── Dashboard stats for dept head ────────────────────────────────────
        case 'get_stats':
            $deptHeadId = (int)($_GET['dept_head_id'] ?? 0);
            if (!$deptHeadId) { jsonError('dept_head_id required'); }

            // My own tickets stats
            $myStmt = $pdo->prepare(
                "SELECT status, COUNT(*) AS cnt FROM tickets
                 WHERE requester_id = :rid GROUP BY status"
            );
            $myStmt->execute([':rid' => $deptHeadId]);
            $myCounts = ['Pending' => 0, 'Ongoing' => 0, 'Completed' => 0, 'Closed' => 0];
            foreach ($myStmt->fetchAll() as $r) {
                $myCounts[$r['status']] = (int)$r['cnt'];
            }

            // Pending approvals count
            $deptStmt = $pdo->prepare("SELECT department FROM users WHERE id = :id");
            $deptStmt->execute([':id' => $deptHeadId]);
            $dept = $deptStmt->fetchColumn();

            $pendingApprovalCount = 0;
            if ($dept) {
                $paStmt = $pdo->prepare(
                    "SELECT COUNT(*) FROM tickets t
                     JOIN departments d ON d.id = t.department_id
                     WHERE d.name = :dept AND t.approval_status = 'Pending Approval'"
                );
                $paStmt->execute([':dept' => $dept]);
                $pendingApprovalCount = (int)$paStmt->fetchColumn();
            }

            jsonSuccess([
                'my_total'             => array_sum($myCounts),
                'my_pending'           => $myCounts['Pending'],
                'my_ongoing'           => $myCounts['Ongoing'],
                'my_completed'         => $myCounts['Completed'],
                'pending_approvals'    => $pendingApprovalCount,
            ]);
            break;

        // ── Approve a ticket ─────────────────────────────────────────────────
        case 'approve_ticket':
            $data          = jsonBody();
            $ticketId      = (int)($data['ticket_id']    ?? 0);
            $deptHeadId    = (int)($data['dept_head_id'] ?? 0);
            $estimatedCost = $data['estimated_cost'] ?? null;
            if (!$ticketId || !$deptHeadId) { jsonError('ticket_id and dept_head_id required'); }

            $pdo->beginTransaction();

            // Upsert approval record
            // FIX: PDO with real (non-emulated) prepared statements does not allow
            // the same named placeholder to appear twice in one query — each
            // occurrence needs its own bound value, so :cost is split into
            // :cost_ins / :cost_upd even though it's the same PHP value.
            $upsert = $pdo->prepare(
                "INSERT INTO ticket_approvals (ticket_id, dept_head_id, decision, estimated_cost, decided_at)
                 VALUES (:tid, :dhid, 'Approved', :cost_ins, NOW())
                 ON DUPLICATE KEY UPDATE decision='Approved', estimated_cost=:cost_upd, decided_at=NOW()"
            );
            $upsert->execute([
                ':tid'      => $ticketId,
                ':dhid'     => $deptHeadId,
                ':cost_ins' => $estimatedCost,
                ':cost_upd' => $estimatedCost,
            ]);

            // Update ticket approval_status
            $pdo->prepare("UPDATE tickets SET approval_status = 'Approved' WHERE id = :id")
                ->execute([':id' => $ticketId]);

            // Log activity
            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
                 VALUES (:tid, :aid, :aname, 'Request approved by Department Head.')"
            )->execute([':tid' => $ticketId, ':aid' => $deptHeadId, ':aname' => $data['dept_head_name'] ?? 'Dept Head']);

            $pdo->commit();
            jsonSuccess(['message' => 'Ticket approved.']);
            break;

        // ── Reject a ticket ──────────────────────────────────────────────────
        case 'reject_ticket':
            $data       = jsonBody();
            $ticketId   = (int)($data['ticket_id']    ?? 0);
            $deptHeadId = (int)($data['dept_head_id'] ?? 0);
            $note       = trim($data['rejection_note'] ?? '');
            if (!$ticketId || !$deptHeadId) { jsonError('ticket_id and dept_head_id required'); }

            $pdo->beginTransaction();

            // FIX: same duplicate-placeholder issue as approve_ticket — :note
            // cannot be reused across INSERT and ON DUPLICATE KEY UPDATE.
            $upsert = $pdo->prepare(
                "INSERT INTO ticket_approvals (ticket_id, dept_head_id, decision, rejection_note, decided_at)
                 VALUES (:tid, :dhid, 'Rejected', :note_ins, NOW())
                 ON DUPLICATE KEY UPDATE decision='Rejected', rejection_note=:note_upd, decided_at=NOW()"
            );
            $upsert->execute([
                ':tid'      => $ticketId,
                ':dhid'     => $deptHeadId,
                ':note_ins' => $note,
                ':note_upd' => $note,
            ]);

            // FIX: Rejection must (a) tag the ticket as Rejected and (b) close it
            // automatically — a rejected request never reaches IT Admin, so there
            // is nothing left to action and it shouldn't sit open indefinitely.
            $pdo->prepare(
                "UPDATE tickets
                 SET approval_status = 'Rejected',
                     status = 'Closed',
                     closed_at = NOW()
                 WHERE id = :id"
            )->execute([':id' => $ticketId]);

            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
                 VALUES (:tid, :aid, :aname, :msg)"
            )->execute([
                ':tid'   => $ticketId,
                ':aid'   => $deptHeadId,
                ':aname' => $data['dept_head_name'] ?? 'Dept Head',
                ':msg'   => 'Request rejected by Department Head — ticket closed.' . ($note ? " Reason: $note" : '')
            ]);

            $pdo->commit();
            jsonSuccess(['message' => 'Ticket rejected.']);
            break;

        // ── Submit feedback ──────────────────────────────────────────────────
        case 'submit_feedback':
            $data     = jsonBody();
            $ticketId = (int)($data['ticket_id'] ?? 0);
            $userId   = (int)($data['user_id']   ?? 0);
            $rating   = (int)($data['rating']    ?? 0);
            $comment  = trim($data['comment']    ?? '');
            if (!$ticketId || !$userId || $rating < 1 || $rating > 5) {
                jsonError('ticket_id, user_id, and rating (1-5) required');
            }

            // FIX: same duplicate-placeholder issue — :rating and :comment each
            // need distinct names for their INSERT vs UPDATE occurrence.
            $stmt = $pdo->prepare(
                "INSERT INTO ticket_feedback (ticket_id, user_id, rating, comment)
                 VALUES (:tid, :uid, :rating_ins, :comment_ins)
                 ON DUPLICATE KEY UPDATE rating=:rating_upd, comment=:comment_upd, submitted_at=NOW()"
            );
            $stmt->execute([
                ':tid'         => $ticketId, ':uid' => $userId,
                ':rating_ins'  => $rating,   ':comment_ins' => $comment ?: null,
                ':rating_upd'  => $rating,   ':comment_upd' => $comment ?: null,
            ]);
            jsonSuccess(['message' => 'Feedback submitted.']);
            break;

        // ── Confirm issue resolved (move to Closed) ──────────────────────────
        case 'confirm_resolved':
            $data     = jsonBody();
            $ticketId = (int)($data['ticket_id'] ?? 0);
            $userId   = (int)($data['user_id']   ?? 0);
            if (!$ticketId || !$userId) { jsonError('ticket_id and user_id required'); }

            $pdo->beginTransaction();
            // Set completed_at when closing — only set if column exists (safe fallback)
            try {
                $pdo->prepare("UPDATE tickets SET status='Closed', closed_at=NOW(), completed_at=NOW() WHERE id=:id")
                    ->execute([':id' => $ticketId]);
            } catch (PDOException $colErr) {
                // completed_at column may not exist yet — fall back gracefully
                $pdo->prepare("UPDATE tickets SET status='Closed', closed_at=NOW() WHERE id=:id")
                    ->execute([':id' => $ticketId]);
            }

            // Log with message_type if column exists
            $userName = $data['user_name'] ?? 'User';
            try {
                $pdo->prepare(
                    "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message, message_type)
                     VALUES (:tid, :uid, :uname, 'Issue confirmed as resolved by user. Ticket closed.', 'system')"
                )->execute([':tid' => $ticketId, ':uid' => $userId, ':uname' => $userName]);
            } catch (PDOException $e) {
                $pdo->prepare(
                    "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
                     VALUES (:tid, :uid, :uname, 'Issue confirmed as resolved by user. Ticket closed.')"
                )->execute([':tid' => $ticketId, ':uid' => $userId, ':uname' => $userName]);
            }
            $pdo->commit();
            jsonSuccess(['message' => 'Ticket closed.']);
            break;

        // ── Reopen ticket (Not Resolved) ─────────────────────────────────────
        case 'reopen_ticket':
            $data     = jsonBody();
            $ticketId = (int)($data['ticket_id'] ?? 0);
            $userId   = (int)($data['user_id']   ?? 0);
            if (!$ticketId || !$userId) { jsonError('ticket_id and user_id required'); }

            $pdo->prepare("UPDATE tickets SET status='Ongoing' WHERE id=:id")
                ->execute([':id' => $ticketId]);

            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
                 VALUES (:tid, :uid, :uname, 'User indicated issue is NOT fully resolved. Ticket re-opened.')"
            )->execute([':tid' => $ticketId, ':uid' => $userId, ':uname' => $data['user_name'] ?? 'User']);

            jsonSuccess(['message' => 'Ticket re-opened.']);
            break;

        default:
            jsonError('Unknown action: ' . htmlspecialchars($action), 400);
    }

} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function jsonSuccess(array $data): void {
    echo json_encode(array_merge(['success' => true], $data));
    exit;
}

function jsonError(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['success' => false, 'message' => $msg]);
    exit;
}

function jsonBody(): array {
    $raw = file_get_contents('php://input');
    return $raw ? (json_decode($raw, true) ?? []) : [];
}
