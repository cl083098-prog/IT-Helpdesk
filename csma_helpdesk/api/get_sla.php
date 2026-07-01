<?php
require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$data     = json_decode(file_get_contents('php://input'), true);
$category = trim($data['category']     ?? '');
$reqType  = trim($data['request_type'] ?? '');
$equipment= trim($data['equipment']    ?? '');

if (!$category || !$reqType) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing fields']);
    exit;
}

try {
    // Try: category + request_type + equipment keyword match
    $stmt = $pdo->prepare(
        "SELECT priority, response_hours, resolution_hours FROM sla_rules
         WHERE category = :cat AND request_type = :rt
           AND equipment_keyword IS NOT NULL
           AND :equip LIKE CONCAT('%', equipment_keyword, '%')
         ORDER BY CHAR_LENGTH(equipment_keyword) DESC LIMIT 1"
    );
    $stmt->execute([':cat'=>$category,':rt'=>$reqType,':equip'=>$equipment]);
    $rule = $stmt->fetch();

    // Fallback: category + request_type, no equipment
    if (!$rule) {
        $stmt2 = $pdo->prepare(
            "SELECT priority, response_hours, resolution_hours FROM sla_rules
             WHERE category = :cat AND request_type = :rt
               AND equipment_keyword IS NULL LIMIT 1"
        );
        $stmt2->execute([':cat'=>$category,':rt'=>$reqType]);
        $rule = $stmt2->fetch();
    }

    // Final fallback
    if (!$rule) {
        $rule = ['priority'=>'Low','response_hours'=>8,'resolution_hours'=>48];
    }

    echo json_encode(['success' => true, 'sla' => $rule]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error']);
}