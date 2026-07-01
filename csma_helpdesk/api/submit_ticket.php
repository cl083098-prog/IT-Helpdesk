<?php
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

    $maxRow     = $pdo->query("SELECT MAX(id) AS max_id FROM tickets")->fetch();
    $ticketCode = 'SR-' . str_pad(($maxRow['max_id'] ?? 0) + 1, 4, '0', STR_PAD_LEFT);

    $sla        = getSLA($pdo, $data['category'], $data['request_type'], $data['equipment_item']);
    $now        = new DateTime();
    $responseDue   = (clone $now)->modify("+{$sla['response_hours']} hours")->format('Y-m-d H:i:s');
    $resolutionDue = (clone $now)->modify("+{$sla['resolution_hours']} hours")->format('Y-m-d H:i:s');

    $stmt = $pdo->prepare(
        "INSERT INTO tickets
            (ticket_code,requester_id,department_id,category,request_type,
             equipment_item,title,description,location,preferred_date,
             priority,sla_response_hours,sla_resolution_hours,
             response_due_at,resolution_due_at)
         VALUES
            (:code,:rid,:did,:cat,:rt,
             :equip,:title,:desc,:loc,:pdate,
             :priority,:rh,:resh,:rdueAt,:resdueAt)"
    );
    $stmt->execute([
        ':code'    => $ticketCode,        ':rid'     => (int)$data['requester_id'],
        ':did'     => (int)$data['department_id'], ':cat'  => $data['category'],
        ':rt'      => $data['request_type'],       ':equip'=> $data['equipment_item'],
        ':title'   => $data['title'],              ':desc' => $data['description'] ?? null,
        ':loc'     => $data['location'] ?? null,   ':pdate'=> $data['preferred_date'] ?? null,
        ':priority'=> $sla['priority'],            ':rh'   => $sla['response_hours'],
        ':resh'    => $sla['resolution_hours'],    ':rdueAt'   => $responseDue,
        ':resdueAt'=> $resolutionDue,
    ]);

    $newId = $pdo->lastInsertId();
    $pdo->prepare(
        "INSERT INTO ticket_activity (ticket_id,author_id,author_name,message)
         VALUES (:tid,:aid,:aname,'Service request submitted.')"
    )->execute([':tid'=>$newId,':aid'=>(int)$data['requester_id'],':aname'=>$data['requester_name'] ?? 'Requester']);

    $pdo->commit();

    echo json_encode([
        'success'          => true,
        'ticket_code'      => $ticketCode,
        'ticket_id'        => $newId,
        'priority'         => $sla['priority'],
        'response_due_at'  => $responseDue,
        'resolution_due_at'=> $resolutionDue,
    ]);

} catch (PDOException $e) {
    $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>'DB error: ' . $e->getMessage()]);
}