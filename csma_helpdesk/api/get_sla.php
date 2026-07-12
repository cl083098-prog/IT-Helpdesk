<?php
// api/get_sla.php  (v15)
// Returns the FINAL SLA that will actually be persisted on the ticket if
// this request were submitted right now, including any stock-based
// extension. Same shared function submit_ticket.php uses to persist —
// so preview == storage. That's the whole point of "SLA at submit is
// the basis of consistent SLA".

require_once 'config.php';
require_once 'sla_helper.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$data     = json_decode(file_get_contents('php://input'), true) ?? [];
$category = trim($data['category']     ?? '');
$reqType  = trim($data['request_type'] ?? '');
$equipment= trim($data['equipment']    ?? '');

if (!$category || !$reqType) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing fields']);
    exit;
}

try {
    $sla = calculateSlaForTicket($pdo, $category, $reqType, $equipment);
    echo json_encode(['success' => true, 'sla' => $sla]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: '.$e->getMessage()]);
}
