<?php
require_once 'config.php';
header('Content-Type: application/json');

try {
    // v26: feature-detect the is_active column. The old code hardcoded
    // `WHERE is_active = 1`, which threw "Unknown column" on schemas that
    // don't have that column (the setup.sql shipped without one), so the
    // dropdown never populated and the auto-fill on the submit form
    // silently failed with no visible error.
    static $hasIsActive = null;
    if ($hasIsActive === null) {
        $cols = $pdo->query("SHOW COLUMNS FROM departments")->fetchAll(PDO::FETCH_COLUMN);
        $hasIsActive = in_array('is_active', $cols, true);
    }

    $sql = "SELECT id, name, code FROM departments";
    if ($hasIsActive) $sql .= " WHERE is_active = 1";
    $sql .= " ORDER BY name ASC";

    $stmt = $pdo->query($sql);
    echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
} catch (PDOException $e) {
    http_response_code(500);
    // v26: return the actual error so a broken query is diagnosable in
    // DevTools instead of showing "Database error" and disappearing.
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
}
