<?php
// api/upload_receipt.php
// -----------------------------------------------------------------------------
// Accepts a photo or PDF of a repair receipt from the IT Admin and stores it
// under assets/receipts/. Updates tickets.repair_receipt_path with the relative
// path so every view can render it.
//
// Multipart POST:
//   ticket_id   (int)     - required
//   admin_id    (int)     - optional (audit)
//   receipt     (file)    - required. JPG/PNG/WEBP/PDF up to 5 MB.
// -----------------------------------------------------------------------------

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function jsonFail(string $msg, int $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'message' => $msg]);
    exit;
}

$ticketId = (int)($_POST['ticket_id'] ?? 0);
$adminId  = (int)($_POST['admin_id']  ?? 0);
if (!$ticketId)                    jsonFail('ticket_id required');
if (!isset($_FILES['receipt']))    jsonFail('receipt file required');

$file = $_FILES['receipt'];
if ($file['error'] !== UPLOAD_ERR_OK) jsonFail('Upload failed (error ' . $file['error'] . ')');
if ($file['size']  <= 0)              jsonFail('Empty file');
if ($file['size']  > 5 * 1024 * 1024) jsonFail('File too large (max 5 MB)');

// ─── Validate MIME + extension ───────────────────────────────────────────────
$allowed = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
    'application/pdf' => 'pdf',
];
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime  = $finfo->file($file['tmp_name']) ?: '';
if (!isset($allowed[$mime])) jsonFail('Unsupported file type. Use JPG, PNG, WEBP, or PDF.');
$ext = $allowed[$mime];

// ─── Confirm the ticket exists and grab any existing receipt to delete ──────
try {
    $ticketCols = $pdo->query("SHOW COLUMNS FROM tickets")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('repair_receipt_path', $ticketCols, true)) {
        jsonFail('Database not migrated: run v3_migration.sql first.', 500);
    }
    $stmt = $pdo->prepare("SELECT ticket_code, repair_receipt_path FROM tickets WHERE id = :id");
    $stmt->execute([':id' => $ticketId]);
    $row = $stmt->fetch();
    if (!$row) jsonFail('Ticket not found', 404);
    $oldPath = $row['repair_receipt_path'] ?? '';
} catch (PDOException $e) { jsonFail('DB error: ' . $e->getMessage(), 500); }

// ─── Ensure destination directory exists ────────────────────────────────────
$rootDir = realpath(__DIR__ . '/..');           // csma_helpdesk/
if (!$rootDir) jsonFail('Bad server config', 500);
$destDir = $rootDir . '/assets/receipts';
if (!is_dir($destDir) && !mkdir($destDir, 0775, true)) {
    jsonFail('Cannot create receipts folder', 500);
}

// ─── Build a safe unique filename ───────────────────────────────────────────
$safeCode = preg_replace('/[^A-Za-z0-9_\-]/', '', (string)$row['ticket_code']) ?: ('t' . $ticketId);
$fname    = sprintf('%s_%s.%s', $safeCode, bin2hex(random_bytes(4)), $ext);
$destAbs  = $destDir . '/' . $fname;
$destRel  = 'assets/receipts/' . $fname;        // stored path for the DB

if (!move_uploaded_file($file['tmp_name'], $destAbs)) {
    jsonFail('Could not save file', 500);
}

// ─── Update the ticket row ──────────────────────────────────────────────────
try {
    $pdo->prepare("UPDATE tickets SET repair_receipt_path = :p WHERE id = :id")
        ->execute([':p' => $destRel, ':id' => $ticketId]);

    // Best-effort delete of previous file
    if ($oldPath && $oldPath !== $destRel) {
        $oldAbs = $rootDir . '/' . ltrim($oldPath, '/');
        if (is_file($oldAbs)) @unlink($oldAbs);
    }

    echo json_encode([
        'success' => true,
        'path'    => $destRel,
        'mime'    => $mime,
        'name'    => $file['name'],
        'size'    => $file['size'],
    ]);
} catch (PDOException $e) {
    @unlink($destAbs);
    jsonFail('DB error: ' . $e->getMessage(), 500);
}
