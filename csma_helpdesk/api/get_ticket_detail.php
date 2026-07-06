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
    // ── Full ticket row ───────────────────────────────────────────────────────
    $stmt = $pdo->prepare(
        "SELECT
            t.id, t.ticket_code, t.title, t.description, t.category,
            t.request_type, t.equipment_item, t.location, t.priority,
            t.status, t.approval_status,
            t.assigned_to,
            t.external_repair, t.repair_service_cost, t.repair_parts_cost,
            t.repair_service_fee, t.repair_total_cost, t.repair_remarks,
            t.repair_receipt_path,
            t.consumable_item_id, t.consumable_qty_needed, t.consumable_dept_id,
            t.sla_response_hours, t.sla_resolution_hours, t.sla_custom_hours,
            t.response_due_at, t.resolution_due_at,
            t.submitted_at, t.completed_at, t.closed_at,
            u.full_name     AS requester_name,
            u.email         AS requester_email,
            d.name          AS department_name,
            d.id            AS department_id
        FROM tickets t
        JOIN users       u ON u.id = t.requester_id
        JOIN departments d ON d.id = t.department_id
        WHERE t.id = :id"
    );
    $stmt->execute([':id' => $ticketId]);
    $ticket = $stmt->fetch();
    if (!$ticket) {
        http_response_code(404);
        echo json_encode(['success'=>false,'message'=>'Ticket not found']);
        exit;
    }

    // ── Conversation & follow-ups ─────────────────────────────────────────────
    $convStmt = $pdo->prepare(
        "SELECT author_name, message, message_type, created_at
         FROM ticket_activity
         WHERE ticket_id = :id
         ORDER BY created_at ASC"
    );
    $convStmt->execute([':id' => $ticketId]);
    $ticket['conversations'] = $convStmt->fetchAll();

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
