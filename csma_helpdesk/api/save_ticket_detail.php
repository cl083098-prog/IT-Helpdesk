<?php
// api/save_ticket_detail.php
// Saves all IT Admin changes from the Request Details panel in one call:
//   - Status update (with Pending Confirmation guard)
//   - Assigned IT Officer
//   - External Repair & Maintenance costs
//   - Consumable item selection
//   - SLA custom hours
//   - Add reply/follow-up

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$data     = json_decode(file_get_contents('php://input'), true);
$ticketId = (int)($data['ticket_id'] ?? 0);
$adminId  = (int)($data['admin_id']  ?? 0);
$adminName = trim($data['admin_name'] ?? 'IT Admin');

if (!$ticketId) {
    http_response_code(400);
    echo json_encode(['success'=>false,'message'=>'ticket_id required']);
    exit;
}

try {
    // Detect optional columns to avoid crashes on fresh installs
    $ticketCols   = $pdo->query("SHOW COLUMNS FROM tickets")->fetchAll(PDO::FETCH_COLUMN);
    $actCols      = $pdo->query("SHOW COLUMNS FROM ticket_activity")->fetchAll(PDO::FETCH_COLUMN);
    $hasExtRepair = in_array('external_repair',    $ticketCols);
    $hasConsumable= in_array('consumable_item_id', $ticketCols);
    $hasSlaCustom = in_array('sla_custom_hours',   $ticketCols);
    $hasMsgType   = in_array('message_type',       $actCols);

    $pdo->beginTransaction();

    $sets   = [];
    $params = [':id' => $ticketId];

    // ── Status update ─────────────────────────────────────────────────────────
    if (isset($data['status'])) {
        $newStatus = $data['status'];
        // Guard: 'Completed' must go through send_confirmation flow, not direct set
        $forbidden = ['Completed', 'Pending Confirmation', 'Closed'];
        if (in_array($newStatus, $forbidden, true)) {
            $pdo->rollBack();
            echo json_encode(['success'=>false,'message'=>"Use 'Send Confirmation Request' to complete a ticket."]);
            exit;
        }
        $sets[]            = 'status = :status';
        $params[':status'] = $newStatus;

        // Log status change
        $pdo->prepare(
            "INSERT INTO ticket_activity (ticket_id,author_id,author_name,message,message_type)
             VALUES(:tid,:aid,:aname,:msg,'status_change')"
        )->execute([':tid'=>$ticketId,':aid'=>$adminId,':aname'=>$adminName,':msg'=>"Status changed to: $newStatus"]);
    }

    // ── Assign IT Officer ─────────────────────────────────────────────────────
    if (array_key_exists('assigned_to', $data)) {
        $sets[]               = 'assigned_to = :assigned_to';
        $params[':assigned_to'] = $data['assigned_to'] ?: null;
    }

    // ── External repair fields (only if columns exist) ───────────────────────
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
                $sets[]        = "$col = $param";
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
    }

    // ── Consumable item selection (only if columns exist) ────────────────────
    if ($hasConsumable) {
        if (array_key_exists('consumable_item_id', $data)) {
            $sets[]              = 'consumable_item_id = :consItem';
            $params[':consItem'] = $data['consumable_item_id'] ?: null;
        }
        if (array_key_exists('consumable_qty_needed', $data)) {
            $sets[]            = 'consumable_qty_needed = :consQty';
            $params[':consQty'] = (int)$data['consumable_qty_needed'] ?: null;
        }
        if (array_key_exists('consumable_dept_id', $data)) {
            $sets[]              = 'consumable_dept_id = :consDept';
            $params[':consDept'] = $data['consumable_dept_id'] ?: null;
        }
    }

    // ── SLA custom hours (only if column exists) ─────────────────────────────
    if ($hasSlaCustom && isset($data['sla_custom_hours']) && $data['sla_custom_hours'] !== '') {
        $customHours = (float)$data['sla_custom_hours'];
        $sets[]                = 'sla_custom_hours = :slaCustom';
        $params[':slaCustom']  = $customHours;
        $sets[]                = 'resolution_due_at = DATE_ADD(submitted_at, INTERVAL :slaH HOUR)';
        $params[':slaH']       = $customHours;
    }

    // ── Apply UPDATE if there's anything to save ──────────────────────────────
    if (!empty($sets)) {
        $pdo->prepare("UPDATE tickets SET " . implode(', ', $sets) . " WHERE id = :id")
            ->execute($params);
    }

    // ── Add reply / follow-up ─────────────────────────────────────────────────
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
    echo json_encode(['success'=>true,'message'=>'Changes saved successfully.']);

} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'DB error: ' . $e->getMessage()]);
}
