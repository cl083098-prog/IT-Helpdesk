<?php
// api/get_inventory_items.php  (v15)
// Feeds the "Equipment/Item" dropdown on Submit Service Request.
//
// GET  ?category=Equipment  → items with type = 'Equipment'
// GET  ?category=Consumable → items with type = 'Consumable'
// Anything else             → returns [] (the UI falls back to a free-text input).

require_once 'config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$category = trim($_GET['category'] ?? '');
$typeMap  = ['Equipment' => 'Equipment', 'Consumable' => 'Consumable'];
if (!isset($typeMap[$category])) { echo json_encode(['success'=>true,'data'=>[]]); exit; }

try {
    $stmt = $pdo->prepare(
        "SELECT id, name, category, quantity, type
         FROM inventory
         WHERE type = :t
         ORDER BY name ASC"
    );
    $stmt->execute([':t' => $typeMap[$category]]);
    echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: '.$e->getMessage()]);
}
