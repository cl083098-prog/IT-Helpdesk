<?php
// api/get_ticket_detail.php
// Returns full ticket detail for the IT Admin Request Details panel.
// Called by viewTicket() in ServiceRequest.js.

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$ticketId = (int)($_GET['ticket_id'] ?? 0);
if (!$ticketId) {
    http_response_code(400);
    echo json_encode(['success'=>false,'message'=>'ticket_id required']);
    exit;
}

try {
    // ── Detect optional columns so we don't crash on fresh installs ────────────
    $ticketCols     = $pdo->query("SHOW COLUMNS FROM tickets")->fetchAll(PDO::FETCH_COLUMN);
    $activityCols   = $pdo->query("SHOW COLUMNS FROM ticket_activity")->fetchAll(PDO::FETCH_COLUMN);
    $hasExtRepair   = in_array('external_repair',      $ticketCols);
    $hasConsumable  = in_array('consumable_item_id',   $ticketCols);
    $hasSlaCustom   = in_array('sla_custom_hours',     $ticketCols);
    $hasCompletedAt = in_array('completed_at',         $ticketCols);
    $hasMsgType     = in_array('message_type',         $activityCols);

    // ── Base required columns ─────────────────────────────────────────────────
    $selectCols = [
        't.id', 't.ticket_code', 't.title', 't.description', 't.category',
        't.request_type', 't.equipment_item', 't.location', 't.priority',
        't.status', 't.approval_status', 't.assigned_to',
        't.sla_response_hours', 't.sla_resolution_hours',
        't.response_due_at', 't.resolution_due_at',
        't.submitted_at', 't.closed_at',
        'u.full_name AS requester_name', 'u.email AS requester_email',
        'd.name AS department_name', 'd.id AS department_id',
    ];
    // ── Optional columns (added only if they exist) ───────────────────────────
    if ($hasExtRepair) {
        $selectCols[] = 't.external_repair';
        $selectCols[] = 't.repair_service_cost';
        $selectCols[] = 't.repair_parts_cost';
        $selectCols[] = 't.repair_service_fee';
        $selectCols[] = 't.repair_total_cost';
        $selectCols[] = 't.repair_remarks';
        $selectCols[] = 't.repair_receipt_path';
    }
    if ($hasConsumable) {
        $selectCols[] = 't.consumable_item_id';
        $selectCols[] = 't.consumable_qty_needed';
        $selectCols[] = 't.consumable_dept_id';
    }
    if ($hasSlaCustom)   $selectCols[] = 't.sla_custom_hours';
    if ($hasCompletedAt) $selectCols[] = 't.completed_at';

    // ── Full ticket row ───────────────────────────────────────────────────────
    $stmt = $pdo->prepare(
        "SELECT " . implode(', ', $selectCols) . "
        FROM tickets t
        JOIN users       u ON u.id = t.requester_id
        JOIN departments d ON d.id = t.department_id
        WHERE t.id = :id"
    );
    $stmt->execute([':id' => $ticketId]);
    $ticket = $stmt->fetch();

    // Backfill optional fields with safe defaults so JS never gets undefined
    $ticket['external_repair']       = $ticket['external_repair']       ?? 0;
    $ticket['repair_service_cost']   = $ticket['repair_service_cost']   ?? null;
    $ticket['repair_parts_cost']     = $ticket['repair_parts_cost']     ?? null;
    $ticket['repair_service_fee']    = $ticket['repair_service_fee']    ?? null;
    $ticket['repair_total_cost']     = $ticket['repair_total_cost']     ?? null;
    $ticket['repair_remarks']        = $ticket['repair_remarks']        ?? '';
    $ticket['repair_receipt_path']   = $ticket['repair_receipt_path']   ?? null;
    $ticket['consumable_item_id']    = $ticket['consumable_item_id']    ?? null;
    $ticket['consumable_qty_needed'] = $ticket['consumable_qty_needed'] ?? null;
    $ticket['consumable_dept_id']    = $ticket['consumable_dept_id']    ?? null;
    $ticket['sla_custom_hours']      = $ticket['sla_custom_hours']      ?? null;
    $ticket['completed_at']          = $ticket['completed_at']          ?? null;
    if (!$ticket) {
        http_response_code(404);
        echo json_encode(['success'=>false,'message'=>'Ticket not found']);
        exit;
    }

    // ── v7: attach live stock status of the linked inventory item ────────────
    // Used by the client to decide whether the IT Admin can extend SLA.
    // Same rules as submit_ticket.php's checkInventoryStock:
    //   quantity <= 0             → 'Out of Stock'
    //   quantity <= low threshold → 'Low Stock'
    //   otherwise                 → 'In Stock'
    // If no matching inventory row is found we return 'N/A'.
    $ticket['stock_status']   = 'N/A';
    $ticket['stock_quantity'] = null;
    $ticket['stock_item_name']= null;
    try {
        $inv = null;
        // Strongest link first: consumable_item_id (set by IT Admin later)
        if (!empty($ticket['consumable_item_id'])) {
            $si = $pdo->prepare("SELECT id, name, quantity, low_stock_pct, oversupply_threshold
                                 FROM inventory WHERE id = :id LIMIT 1");
            $si->execute([':id' => (int)$ticket['consumable_item_id']]);
            $inv = $si->fetch();
        }
        // Fallback: fuzzy match on equipment_item text
        if (!$inv && !empty($ticket['equipment_item'])) {
            $si = $pdo->prepare(
                "SELECT id, name, quantity, low_stock_pct, oversupply_threshold
                 FROM inventory
                 WHERE :q LIKE CONCAT('%', name, '%') OR name LIKE CONCAT('%', :q2, '%')
                 ORDER BY CHAR_LENGTH(name) DESC LIMIT 1"
            );
            $si->execute([':q' => $ticket['equipment_item'], ':q2' => $ticket['equipment_item']]);
            $inv = $si->fetch();
        }
        if ($inv) {
            $qty       = (int)$inv['quantity'];
            $lowPct    = (int)($inv['low_stock_pct']       ?? 20);
            $oversupp  = (int)($inv['oversupply_threshold']?? 0);
            $threshold = $oversupp > 0 ? ($lowPct / 100.0) * $oversupp : 0;

            if     ($qty <= 0)                          $status = 'Out of Stock';
            elseif ($threshold > 0 && $qty <= $threshold) $status = 'Low Stock';
            else                                        $status = 'In Stock';

            $ticket['stock_status']    = $status;
            $ticket['stock_quantity']  = $qty;
            $ticket['stock_item_name'] = $inv['name'];
        }
    } catch (PDOException $e) { /* keep defaults on error */ }

    // ── Conversation & follow-ups ─────────────────────────────────────────────
    // Conversation query — handle missing message_type column gracefully
    $convSelect = $hasMsgType ? 'author_name, message, message_type, created_at' : 'author_name, message, created_at';
    $convStmt = $pdo->prepare(
        "SELECT $convSelect FROM ticket_activity WHERE ticket_id = :id ORDER BY created_at ASC"
    );
    $convStmt->execute([':id' => $ticketId]);
    $conversations = $convStmt->fetchAll();
    // Backfill message_type if column didn't exist
    $ticket['conversations'] = array_map(function($c) {
        $c['message_type'] = $c['message_type'] ?? 'system';
        return $c;
    }, $conversations);

    // ── v28: Attachments (images uploaded from the submit form) ─────────────
    try {
        $atStmt = $pdo->prepare(
            "SELECT id, file_path, original_name, mime_type, file_size, uploaded_at
             FROM ticket_attachments WHERE ticket_id = :id ORDER BY uploaded_at ASC"
        );
        $atStmt->execute([':id' => $ticketId]);
        $ticket['attachments'] = $atStmt->fetchAll();
    } catch (PDOException $e) {
        $ticket['attachments'] = []; // table may not exist yet
    }

    // ── Dept Head approval ────────────────────────────────────────────────────
    $apprStmt = $pdo->prepare(
        "SELECT ta.decision, ta.estimated_cost, ta.rejection_note, ta.decided_at,
                u.full_name AS decided_by
         FROM ticket_approvals ta
         JOIN users u ON u.id = ta.dept_head_id
         WHERE ta.ticket_id = :id
         ORDER BY ta.decided_at DESC LIMIT 1"
    );
    $apprStmt->execute([':id' => $ticketId]);
    $ticket['approval'] = $apprStmt->fetch() ?: null;

    // ── IT Officers list (for assign dropdown) ────────────────────────────────
    $officerStmt = $pdo->query(
        "SELECT id, full_name FROM users WHERE role = 'admin' ORDER BY full_name"
    );
    $ticket['it_officers'] = $officerStmt->fetchAll();

    // ── Inventory items list (for consumable dropdown) ────────────────────────
    $invStmt = $pdo->query(
        "SELECT id, name, quantity, type FROM inventory WHERE type = 'Consumable' ORDER BY name"
    );
    $ticket['inventory_items'] = $invStmt->fetchAll();

    // ── Departments list ──────────────────────────────────────────────────────
    $deptStmt = $pdo->query("SELECT id, name FROM departments ORDER BY name");
    $ticket['departments'] = $deptStmt->fetchAll();

    // ── Duration calc ─────────────────────────────────────────────────────────
    if ($ticket['submitted_at']) {
        $created   = new DateTime($ticket['submitted_at']);
        $until     = $ticket['completed_at'] ? new DateTime($ticket['completed_at']) : new DateTime();
        $diff      = $created->diff($until);
        $ticket['duration_text'] = $diff->days > 0 ? $diff->days . ' day' . ($diff->days > 1 ? 's' : '') : 'Today';
    } else {
        $ticket['duration_text'] = 'Ongoing';
    }

    echo json_encode(['success'=>true,'ticket'=>$ticket]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'DB error: ' . $e->getMessage()]);
}
