<?php
// api/submit_ticket.php
// ── Workflow fix: Equipment and Consumable tickets route to Department Head
//    approval before reaching IT Admin. All other categories go directly to IT.

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['success'=>false,'message'=>'Method Not Allowed']); exit;
}

$data = json_decode(file_get_contents('php://input'), true);
$required = ['requester_id','department_id','category','request_type','equipment_item','title'];
foreach ($required as $f) {
    if (empty($data[$f])) {
        http_response_code(400);
        echo json_encode(['success'=>false,'message'=>"Missing: $f"]);
        exit;
    }
}

// ── Categories that require Department Head approval before IT Admin sees them
// Add or remove categories here as your school's policy changes.
const APPROVAL_REQUIRED_CATEGORIES = ['Equipment', 'Consumable'];

function getSLA(PDO $pdo, $cat, $rt, $equip) {
    $st = $pdo->prepare(
        "SELECT priority, response_hours, resolution_hours FROM sla_rules
         WHERE category=:cat AND request_type=:rt
           AND equipment_keyword IS NOT NULL
           AND :equip LIKE CONCAT('%', equipment_keyword, '%')
         ORDER BY CHAR_LENGTH(equipment_keyword) DESC LIMIT 1"
    );
    $st->execute([':cat'=>$cat,':rt'=>$rt,':equip'=>$equip]);
    $r = $st->fetch();
    if ($r) return $r;

    $st2 = $pdo->prepare(
        "SELECT priority, response_hours, resolution_hours FROM sla_rules
         WHERE category=:cat AND request_type=:rt AND equipment_keyword IS NULL LIMIT 1"
    );
    $st2->execute([':cat'=>$cat,':rt'=>$rt]);
    return $st2->fetch() ?: ['priority'=>'Low','response_hours'=>8,'resolution_hours'=>48];
}

try {
    $pdo->beginTransaction();

    // ── Ticket code ────────────────────────────────────────────────────────────
    $maxRow     = $pdo->query("SELECT MAX(id) AS max_id FROM tickets")->fetch();
    $ticketCode = 'SR-' . str_pad(($maxRow['max_id'] ?? 0) + 1, 4, '0', STR_PAD_LEFT);

    // ── SLA ────────────────────────────────────────────────────────────────────
    $sla           = getSLA($pdo, $data['category'], $data['request_type'], $data['equipment_item']);
    $now           = new DateTime();
    $responseDue   = (clone $now)->modify("+{$sla['response_hours']} hours")->format('Y-m-d H:i:s');
    $resolutionDue = (clone $now)->modify("+{$sla['resolution_hours']} hours")->format('Y-m-d H:i:s');

    // ── FIX 1: Determine approval routing ─────────────────────────────────────
    // Equipment and Consumable tickets must be approved by the Department Head
    // before the IT Admin can see or action them.
    $needsApproval   = in_array($data['category'], APPROVAL_REQUIRED_CATEGORIES, true);
    $approvalStatus  = $needsApproval ? 'Pending Approval' : 'Not Required';

    // ── Insert ticket ──────────────────────────────────────────────────────────
    $stmt = $pdo->prepare(
        "INSERT INTO tickets
            (ticket_code, requester_id, department_id, category, request_type,
             equipment_item, title, description, location, preferred_date,
             priority, approval_status,
             sla_response_hours, sla_resolution_hours,
             response_due_at, resolution_due_at)
         VALUES
            (:code, :rid, :did, :cat, :rt,
             :equip, :title, :desc, :loc, :pdate,
             :priority, :approvalStatus,
             :rh, :resh, :rdueAt, :resdueAt)"
    );
    $stmt->execute([
        ':code'           => $ticketCode,
        ':rid'            => (int)$data['requester_id'],
        ':did'            => (int)$data['department_id'],
        ':cat'            => $data['category'],
        ':rt'             => $data['request_type'],
        ':equip'          => $data['equipment_item'],
        ':title'          => $data['title'],
        ':desc'           => $data['description']    ?? null,
        ':loc'            => $data['location']       ?? null,
        ':pdate'          => $data['preferred_date'] ?? null,
        ':priority'       => $sla['priority'],
        ':approvalStatus' => $approvalStatus,
        ':rh'             => $sla['response_hours'],
        ':resh'           => $sla['resolution_hours'],
        ':rdueAt'         => $responseDue,
        ':resdueAt'       => $resolutionDue,
    ]);

    $newTicketId = $pdo->lastInsertId();

    // ── Activity log ───────────────────────────────────────────────────────────
    $activityMsg = $needsApproval
        ? 'Service request submitted. Awaiting Department Head approval before routing to IT Admin.'
        : 'Service request submitted. Routed directly to IT Admin for action.';

    $pdo->prepare(
        "INSERT INTO ticket_activity (ticket_id, author_id, author_name, message)
         VALUES (:tid, :aid, :aname, :msg)"
    )->execute([
        ':tid'   => $newTicketId,
        ':aid'   => (int)$data['requester_id'],
        ':aname' => $data['requester_name'] ?? 'Requester',
        ':msg'   => $activityMsg,
    ]);

    // ── FIX 1b: Create approval record for dept head if required ───────────────
    // Find the Department Head assigned to this department and create the
    // pending approval record in ticket_approvals.
    if ($needsApproval) {
        $deptHeadStmt = $pdo->prepare(
            "SELECT id FROM users
             WHERE role = 'dept_head' AND department = (
                 SELECT name FROM departments WHERE id = :did
             )
             LIMIT 1"
        );
        $deptHeadStmt->execute([':did' => (int)$data['department_id']]);
        $deptHeadRow = $deptHeadStmt->fetch();

        if ($deptHeadRow) {
            // Create a Pending Approval record so it appears in the dept head's queue
            $pdo->prepare(
                "INSERT INTO ticket_approvals (ticket_id, dept_head_id, decision)
                 VALUES (:tid, :dhid, 'Pending Approval')"
            )->execute([':tid' => $newTicketId, ':dhid' => $deptHeadRow['id']]);
        }
        // Note: if no dept head is found for this department the ticket remains
        // in Pending Approval status — admins can manually approve via phpMyAdmin
        // or a future admin override endpoint.
    }

    $pdo->commit();

    echo json_encode([
        'success'            => true,
        'ticket_code'        => $ticketCode,
        'ticket_id'          => $newTicketId,
        'priority'           => $sla['priority'],
        'approval_status'    => $approvalStatus,
        'needs_approval'     => $needsApproval,
        'response_due_at'    => $responseDue,
        'resolution_due_at'  => $resolutionDue,
        // Inform the frontend whether to show the approval notice
        'message'            => $needsApproval
            ? 'Your request has been submitted and sent to your Department Head for approval.'
            : 'Your request has been submitted and routed to the IT Admin.',
    ]);

} catch (PDOException $e) {
    $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'DB error: ' . $e->getMessage()]);
}
