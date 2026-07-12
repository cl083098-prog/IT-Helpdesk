<?php
// api/update_ticket.php
// ── Workflow fix:
//    - When IT Admin sets status to 'Completed', the ticket moves to
//      'Pending Confirmation' (not Closed). The requester must confirm.
//    - A separate 'send_confirmation' action triggers the confirmation notice.
//    - 'Closed' can only be set by the requester via dept-head-data.php
//      confirm_resolved action.

require_once 'config.php';
require_once 'notifications_helper.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$data     = json_decode(file_get_contents('php://input'), true);
$ticketId = (int)($data['ticket_id'] ?? 0);
if (!$ticketId) {
    http_response_code(400);
    echo json_encode(['success'=>false,'message'=>'ticket_id required']);
    exit;
}

// ── Handle the special 'send_confirmation' action ────────────────────────────
// Image 3 shows: IT Admin clicks "Mark as Completed" → modal appears →
// clicks "Send Confirmation Request" → ticket moves to Pending Confirmation.
$action = trim($data['action'] ?? '');

if ($action === 'send_confirmation') {
    // ── v9 fix: ensure audit_log exists BEFORE starting the transaction. ──
    // MySQL treats DDL (CREATE TABLE, ALTER TABLE, DROP TABLE) as statements
    // that implicitly commit any active transaction. Running "CREATE TABLE
    // IF NOT EXISTS audit_log" inside a transaction — even when the table
    // already existed — would silently end the transaction, so the later
    // $pdo->commit() call threw "There is no active transaction" and the
    // whole request came back as HTTP 500. This is the exact toast the user
    // was seeing after clicking "Send Confirmation Request".
    //
    // CREATE TABLE IF NOT EXISTS is idempotent and safe to run every time
    // in autocommit mode.
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL, user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '', module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '', detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL, status ENUM('Success','Failed','Warning') DEFAULT 'Success', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    } catch (PDOException $ddlErr) { /* audit table missing is non-fatal */ }

    try {
        $pdo->beginTransaction();

        $pdo->prepare(
            "UPDATE tickets SET status = 'Pending Confirmation' WHERE id = :id"
        )->execute([':id' => $ticketId]);

        $adminName = $data['admin_name'] ?? 'IT Admin';
        $adminId   = (int)($data['admin_id'] ?? 0);

        // Log with message_type if column exists, fall back gracefully.
        // NOTE: keep this inside the transaction — it's a normal INSERT, not DDL.
        try {
            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message, message_type)
                 VALUES (:tid, :aid, :aname, :msg, 'status_change')"
            )->execute([
                ':tid'   => $ticketId,
                ':aid'   => $adminId,
                ':aname' => $adminName,
                ':msg'   => 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester to verify the issue is fully resolved.',
            ]);
        } catch (PDOException $colErr) {
            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
                 VALUES (:tid, :aid, :aname, :msg)"
            )->execute([
                ':tid'   => $ticketId,
                ':aid'   => $adminId,
                ':aname' => $adminName,
                ':msg'   => 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester.',
            ]);
        }

        // Fetch ticket details for the audit log entry
        $tcRow = $pdo->prepare("SELECT t.ticket_code, t.title, u.full_name AS requester_name FROM tickets t JOIN users u ON u.id = t.requester_id WHERE t.id = :id");
        $tcRow->execute([':id' => $ticketId]);
        $tc = $tcRow->fetch();
        $tcCode = $tc['ticket_code']    ?? $ticketId;
        $tcTitle = $tc['title']         ?? '—';
        $requesterName = $tc['requester_name'] ?? '';

        $pdo->commit();

        // ── v14: Inventory deduction ─────────────────────────────────────
        // If this ticket is a Consumable with a linked inventory item and a
        // needed qty, and we haven't already deducted (idempotent flag),
        // deduct now. This is the point of physical handover so the numbers
        // in inventory match reality from here on.
        try {
            $tk = $pdo->prepare(
                "SELECT category, request_type, consumable_item_id, consumable_qty_needed,
                        consumable_dept_id, stock_deducted
                 FROM tickets WHERE id = :id"
            );
            $tk->execute([':id' => $ticketId]);
            $t = $tk->fetch() ?: [];

            // v18: deduct for Consumable AND Equipment tickets.
            // Consumable: needs both item_id and qty explicitly set (unchanged).
            // Equipment:  requires item_id; if qty isn't set we default to 1
            //             but ONLY for request types that actually issue new
            //             gear from stock (Replacement, Installation). Other
            //             Equipment types — Hardware Issue, Maintenance —
            //             are about fixing existing gear, so they never
            //             auto-deduct even when an item happens to be linked.
            $cat      = (string)($t['category']    ?? '');
            $rt       = (string)($t['request_type']?? '');
            $itemId   = (int)($t['consumable_item_id']    ?? 0);
            $qty      = (int)($t['consumable_qty_needed'] ?? 0);
            $already  = (int)($t['stock_deducted']        ?? 0);

            $isConsumable = $cat === 'Consumable';
            $isEquipment  = $cat === 'Equipment';

            if ($isEquipment && $itemId > 0 && $qty === 0 &&
                in_array($rt, ['Replacement', 'Installation'], true)) {
                $qty = 1;
            }

            $catOk = $isConsumable || $isEquipment;

            if ($catOk && $itemId > 0 && $qty > 0 && !$already) {
                $pdo->beginTransaction();
                try {
                    // Row-lock so concurrent completions don't over-deduct.
                    $lk = $pdo->prepare("SELECT name, quantity FROM inventory WHERE id = :id FOR UPDATE");
                    $lk->execute([':id' => $itemId]);
                    $inv = $lk->fetch();

                    if ($inv) {
                        $onHand   = (int)$inv['quantity'];
                        $itemName = $inv['name'];
                        $newQty   = $onHand - $qty;      // may go negative — see below

                        $pdo->prepare("UPDATE inventory SET quantity = quantity - :q WHERE id = :id")
                            ->execute([':q' => $qty, ':id' => $itemId]);

                        // Look up destination department name for the allocation log
                        $deptName = '';
                        if (!empty($t['consumable_dept_id'])) {
                            $d = $pdo->prepare("SELECT name FROM departments WHERE id = :id");
                            $d->execute([':id' => (int)$t['consumable_dept_id']]);
                            $deptName = (string)($d->fetchColumn() ?: '');
                        }

                        // Record the movement in the same table `allocate_item` uses,
                        // so the department's allocation history sees it too.
                        try {
                            $pdo->prepare(
                                "INSERT INTO inventory_allocations
                                    (item_id, department, quantity, date_allocated, action_type, allocated_by)
                                 VALUES
                                    (:iid, :dept, :q, CURRENT_DATE, 'Allocate', :uid)"
                            )->execute([
                                ':iid'  => $itemId,
                                ':dept' => $deptName ?: 'Ticket fulfillment',
                                ':q'    => $qty,
                                ':uid'  => $adminId ?: null,
                            ]);
                        } catch (PDOException $iaErr) { /* table may not exist on all installs */ }

                        // Mark the ticket so we never deduct twice
                        $pdo->prepare("UPDATE tickets SET stock_deducted = 1 WHERE id = :id")
                            ->execute([':id' => $ticketId]);

                        $pdo->commit();

                        // If we drove the balance to zero or negative, warn IT Admin
                        if ($newQty <= 0) {
                            try {
                                pushNotificationToRole($pdo, 'admin',
                                    "Low stock alert: $itemName",
                                    "Ticket #$tcCode consumed $qty of $itemName. New on-hand: $newQty."
                                        . ($newQty < 0 ? ' Balance went negative — please reconcile.' : ''),
                                    'low_stock',
                                    null,
                                    (int)$ticketId
                                );
                            } catch (Throwable $ne) {}
                        }
                    }
                } catch (PDOException $de) {
                    if ($pdo->inTransaction()) $pdo->rollBack();
                    error_log("[stock deduction] ticket #$ticketId failed: " . $de->getMessage());
                }
            }
        } catch (PDOException $tkErr) { /* non-fatal — send_confirmation already committed */ }

        // ── Audit log write happens AFTER commit. ─────────────────────────
        // Best-effort — a missing table, permissions error, or ENUM mismatch
        // must never bubble up as an HTTP 500 that hides the fact that the
        // status change actually succeeded.
        try {
            $pdo->prepare("INSERT INTO audit_log (user_id,user_name,user_role,module,action,detail,ip_address,status) VALUES(:uid,:uname,:urole,'ServiceRequest','Marked ticket as Pending Confirmation',:det,:ip,'Success')")
                ->execute([
                    ':uid'   => $adminId,
                    ':uname' => $adminName,
                    ':urole' => 'admin',
                    ':det'   => "Ticket: #$tcCode — $tcTitle | Status changed to Pending Confirmation | Confirmation request sent to requester: $requesterName",
                    ':ip'    => $_SERVER['REMOTE_ADDR'] ?? '',
                ]);
        } catch (PDOException $al) { /* audit log is best-effort */ }

        // ── Notify requester that action is needed ─────────────────────────
        pushNotification($pdo, [
            'target_user' => (int)($pdo->query("SELECT requester_id FROM tickets WHERE id = " . (int)$ticketId)->fetchColumn() ?: 0),
            'target_role' => 'requester',
            'event_type'  => 'confirmation_needed',
            'title'       => "Please confirm resolution of #$tcCode",
            'description' => "IT Admin has marked \"$tcTitle\" as completed. Please confirm the issue is fully resolved, or re-open the ticket if it's not.",
            'ticket_id'   => (int)$ticketId,
        ]);

        echo json_encode([
            'success'    => true,
            'new_status' => 'Pending Confirmation',
            'message'    => 'Confirmation request sent to the requester. Ticket is now Pending Confirmation.',
        ]);
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success'=>false,'message'=>'DB error: ' . $e->getMessage()]);
    }
    exit;
}

// ── Standard status/assignment update ─────────────────────────────────────────
$sets   = [];
$params = [':id' => $ticketId];

foreach (['assigned_to', 'priority'] as $f) {
    if (isset($data[$f])) {
        $sets[]       = "$f = :$f";
        $params[":$f"] = $data[$f];
    }
}

if (isset($data['status'])) {
    $requestedStatus = $data['status'];

    // ── FIX 3 guard: IT Admin cannot set status directly to 'Completed' ────────
    // They must use the send_confirmation action above (which sets
    // 'Pending Confirmation'). 'Closed' can only be set by the requester.
    // This prevents the premature closure bug from Image 3/4.
    $adminBlockedStatuses = ['Completed', 'Closed', 'Pending Confirmation'];
    if (in_array($requestedStatus, $adminBlockedStatuses, true) && $action !== 'admin_override') {
        echo json_encode([
            'success' => false,
            'message' => "Use action='send_confirmation' to mark a ticket as completed. The requester must confirm resolution before it closes.",
        ]);
        exit;
    }

    $sets[]            = 'status = :status';
    $params[':status'] = $requestedStatus;

    // Only set closed_at when actually closing (set by requester via confirm_resolved)
    if ($requestedStatus === 'Closed') {
        $sets[] = 'closed_at = NOW()';
    }
}

if (empty($sets)) {
    http_response_code(400);
    echo json_encode(['success'=>false,'message'=>'Nothing to update']);
    exit;
}

try {
    $pdo->prepare("UPDATE tickets SET " . implode(', ', $sets) . " WHERE id = :id")
        ->execute($params);

    if (isset($data['admin_id'])) {
        $note = 'Updated — Status: ' . ($data['status'] ?? 'N/A');
        if (isset($data['assigned_to'])) $note .= ' | Assigned to: ' . $data['assigned_to'];
        $pdo->prepare(
            "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
             VALUES (:tid, :aid, :aname, :msg)"
        )->execute([
            ':tid'   => $ticketId,
            ':aid'   => (int)$data['admin_id'],
            ':aname' => $data['admin_name'] ?? 'Admin',
            ':msg'   => $note,
        ]);
    }

    // Audit log for standard status/assignment update
    if (isset($data['status']) || isset($data['assigned_to'])) {
        try {
            $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT DEFAULT NULL, user_name VARCHAR(100) NOT NULL DEFAULT '', user_role VARCHAR(50) NOT NULL DEFAULT '', module VARCHAR(80) NOT NULL DEFAULT '', action VARCHAR(150) NOT NULL DEFAULT '', detail TEXT DEFAULT NULL, ip_address VARCHAR(45) DEFAULT NULL, status ENUM('Success','Failed','Warning') DEFAULT 'Success', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
            $tcRow2 = $pdo->prepare("SELECT ticket_code, title FROM tickets WHERE id = :id");
            $tcRow2->execute([':id' => $ticketId]);
            $tc2 = $tcRow2->fetch();
            $parts = [];
            if (isset($data['status']))      $parts[] = "Status → {$data['status']}";
            if (isset($data['assigned_to'])) $parts[] = "Assigned to → {$data['assigned_to']}";
            $adminName2 = $data['admin_name'] ?? 'IT Admin';
            $adminId2   = (int)($data['admin_id'] ?? 0);
            $pdo->prepare("INSERT INTO audit_log (user_id,user_name,user_role,module,action,detail,ip_address,status) VALUES(:uid,:uname,'admin','ServiceRequest','Updated ticket',:det,:ip,'Success')")
                ->execute([':uid'=>$adminId2,':uname'=>$adminName2,':det'=>"Ticket: #" . ($tc2['ticket_code']??$ticketId) . " — " . ($tc2['title']??'') . " | " . implode(' | ', $parts),':ip'=>$_SERVER['REMOTE_ADDR']??'']);
        } catch (PDOException $al) {}
    }

    echo json_encode(['success'=>true,'message'=>'Ticket updated.']);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Update failed: ' . $e->getMessage()]);
}