<?php
// api/save_ticket_detail.php
// Saves all IT Admin changes from the Request Details panel in one call.
// v3 changes:
//   • When SLA custom hours change, ALSO update `sla_resolution_hours` so
//     every role (requester, dept head, admin) sees the same value.
//   • Status guard now blocks BOTH direct-set of forbidden states AND
//     downgrades from a Completed/Closed ticket to Pending/Ongoing.

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$data      = json_decode(file_get_contents('php://input'), true);
$ticketId  = (int)($data['ticket_id'] ?? 0);
$adminId   = (int)($data['admin_id']  ?? 0);
$adminName = trim($data['admin_name'] ?? 'IT Admin');

if (!$ticketId) {
    http_response_code(400);
    echo json_encode(['success'=>false,'message'=>'ticket_id required']);
    exit;
}

try {
    // Detect optional columns
    $ticketCols   = $pdo->query("SHOW COLUMNS FROM tickets")->fetchAll(PDO::FETCH_COLUMN);
    $actCols      = $pdo->query("SHOW COLUMNS FROM ticket_activity")->fetchAll(PDO::FETCH_COLUMN);
    $hasExtRepair = in_array('external_repair',    $ticketCols);
    $hasReceipt   = in_array('repair_receipt_path',$ticketCols);
    $hasConsumable= in_array('consumable_item_id', $ticketCols);
    $hasSlaCustom = in_array('sla_custom_hours',   $ticketCols);
    $hasMsgType   = in_array('message_type',       $actCols);

    // Read the current ticket so we can guard downgrades
    $current = $pdo->prepare("SELECT status FROM tickets WHERE id = :id");
    $current->execute([':id' => $ticketId]);
    $currentStatus = (string)($current->fetchColumn() ?: '');

    $pdo->beginTransaction();

    $sets   = [];
    $params = [':id' => $ticketId];

    // ── Status update ─────────────────────────────────────────────────────────
    // Only accept status when the ticket is currently editable AND the
    // requested value is one of the editable states. This prevents the
    // "select falls back to Pending" bug from silently downgrading a
    // Completed/Closed ticket.
    $EDITABLE_STATES = ['Pending', 'Ongoing'];
    $LOCKED_STATES   = ['Completed', 'Pending Confirmation', 'Closed', 'Cancelled'];

    if (isset($data['status']) && $data['status'] !== '') {
        $newStatus = $data['status'];

        // Block trying to set a forbidden status directly
        if (in_array($newStatus, ['Completed', 'Pending Confirmation', 'Closed'], true)) {
            $pdo->rollBack();
            echo json_encode(['success'=>false,'message'=>"Use 'Send Confirmation Request' to complete a ticket."]);
            exit;
        }

        // Block downgrading a locked ticket
        if (in_array($currentStatus, $LOCKED_STATES, true) && $newStatus !== $currentStatus) {
            // Silently ignore — the client sent a stale value from a select
            // that couldn't represent the true status.
        } elseif (in_array($newStatus, $EDITABLE_STATES, true) && $newStatus !== $currentStatus) {
            $sets[]            = 'status = :status';
            $params[':status'] = $newStatus;

            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id,author_id,author_name,message,message_type)
                 VALUES(:tid,:aid,:aname,:msg,'status_change')"
            )->execute([':tid'=>$ticketId,':aid'=>$adminId,':aname'=>$adminName,':msg'=>"Status changed to: $newStatus"]);
        }
    }

    // ── Assign IT Officer ─────────────────────────────────────────────────────
    if (array_key_exists('assigned_to', $data)) {
        $sets[]                 = 'assigned_to = :assigned_to';
        $params[':assigned_to'] = $data['assigned_to'] ?: null;
    }

    // ── External repair fields ────────────────────────────────────────────────
    if ($hasExtRepair) {
        $repairFields = [
            'external_repair'     => ':extRepair',
            'repair_service_cost' => ':svcCost',
            'repair_parts_cost'   => ':partsCost',
            'repair_service_fee'  => ':svcFee',
            'repair_remarks'      => ':repRemarks',
        ];
        foreach ($repairFields as $col => $param) {
            if (array_key_exists($col, $data)) {
                $sets[]         = "$col = $param";
                $params[$param] = $data[$col] !== '' ? $data[$col] : null;
            }
        }
        if (isset($data['repair_service_cost']) || isset($data['repair_parts_cost']) || isset($data['repair_service_fee'])) {
            $svc   = (float)($data['repair_service_cost'] ?? 0);
            $parts = (float)($data['repair_parts_cost']   ?? 0);
            $fee   = (float)($data['repair_service_fee']  ?? 0);
            $total = $svc + $parts + $fee;
            $sets[]              = 'repair_total_cost = :repTotal';
            $params[':repTotal'] = $total > 0 ? $total : null;
        }
        // Allow deletion of the receipt via explicit null
        if ($hasReceipt && array_key_exists('remove_receipt', $data) && $data['remove_receipt']) {
            $sets[]                 = 'repair_receipt_path = NULL';
        }
    }

    // ── Consumable item selection ────────────────────────────────────────────
    if ($hasConsumable) {
        if (array_key_exists('consumable_item_id', $data)) {
            $sets[]               = 'consumable_item_id = :consItem';
            $params[':consItem']  = $data['consumable_item_id'] ?: null;
        }
        if (array_key_exists('consumable_qty_needed', $data)) {
            $sets[]              = 'consumable_qty_needed = :consQty';
            $params[':consQty']  = (int)$data['consumable_qty_needed'] ?: null;
        }
        if (array_key_exists('consumable_dept_id', $data)) {
            $sets[]                = 'consumable_dept_id = :consDept';
            $params[':consDept']   = $data['consumable_dept_id'] ?: null;
        }
    }

    // ── SLA hours: keep every role's view identical ──────────────────────────
    // v3: `sla_custom_hours` is the admin-editable value.  When it changes we
    // ALSO write the same number to `sla_resolution_hours` and recompute
    // `resolution_due_at` — so requesters, dept heads, and admins all see one
    // consistent SLA.
    if ($hasSlaCustom && isset($data['sla_custom_hours']) && $data['sla_custom_hours'] !== '') {
        $customHours = (float)$data['sla_custom_hours'];
        if ($customHours >= 0.5) {
            $sets[]                = 'sla_custom_hours    = :slaCustom';
            $params[':slaCustom']  = $customHours;
            $sets[]                = 'sla_resolution_hours = :slaResH';
            $params[':slaResH']    = $customHours;
            $sets[]                = 'resolution_due_at   = DATE_ADD(submitted_at, INTERVAL :slaH HOUR)';
            $params[':slaH']       = $customHours;
        }
    }

    // ── Apply UPDATE if anything to save ─────────────────────────────────────
    if (!empty($sets)) {
        $pdo->prepare("UPDATE tickets SET " . implode(', ', $sets) . " WHERE id = :id")
            ->execute($params);
    }

    // ── Add reply / follow-up ────────────────────────────────────────────────
    if (!empty(trim($data['reply'] ?? ''))) {
        if ($hasMsgType) {
            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id,author_id,author_name,message,message_type)
                 VALUES(:tid,:aid,:aname,:msg,'reply')"
            )->execute([':tid'=>$ticketId,':aid'=>$adminId,':aname'=>$adminName,':msg'=>trim($data['reply'])]);
        } else {
            $pdo->prepare(
                "INSERT INTO ticket_activity (ticket_id,author_id,author_name,message)
                 VALUES(:tid,:aid,:aname,:msg)"
            )->execute([':tid'=>$ticketId,':aid'=>$adminId,':aname'=>$adminName,':msg'=>trim($data['reply'])]);
        }
    }

    $pdo->commit();
    echo json_encode(['success'=>true]);

} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'Database error: '.$e->getMessage()]);
}
