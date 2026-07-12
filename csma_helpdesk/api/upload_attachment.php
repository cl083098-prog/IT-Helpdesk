<?php
// api/upload_attachment.php
// Multipart POST — attach a photo of the issue to a ticket.
//   ticket_id (int)  required
//   uploader_id (int) optional
//   file (file)      required. JPG/PNG/WEBP up to 5 MB.
// Stored under assets/attachments/, path saved to ticket_attachments.

require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

function fail(string $m, int $c = 400): void {
    http_response_code($c);
    echo json_encode(['success' => false, 'message' => $m]);
    exit;
}

$ticketId = (int)($_POST['ticket_id'] ?? 0);
$uploader = (int)($_POST['uploader_id'] ?? 0);
if (!$ticketId)                 fail('ticket_id required');
if (!isset($_FILES['file']))    fail('file required');

$f = $_FILES['file'];
if ($f['error'] !== UPLOAD_ERR_OK)    fail('Upload error ' . $f['error']);
if ($f['size']  <= 0)                  fail('Empty file');
if ($f['size']  > 5 * 1024 * 1024)     fail('File too large (max 5 MB)');

$allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
$finfo   = new finfo(FILEINFO_MIME_TYPE);
$mime    = $finfo->file($f['tmp_name']) ?: '';
if (!isset($allowed[$mime])) fail('Unsupported file type. Use JPG, PNG, or WEBP.');
$ext = $allowed[$mime];

$dir = __DIR__ . '/../assets/attachments';
if (!is_dir($dir) && !@mkdir($dir, 0775, true)) fail('Server storage unavailable.', 500);

// idempotent-ish table
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS ticket_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY, ticket_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL, original_name VARCHAR(200) DEFAULT NULL,
        mime_type VARCHAR(80) DEFAULT NULL, file_size INT DEFAULT NULL,
        uploaded_by INT DEFAULT NULL, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_att_ticket (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
} catch (PDOException $e) { fail('DB error: ' . $e->getMessage(), 500); }

$rand   = bin2hex(random_bytes(4));
$fname  = "ticket_{$ticketId}_" . time() . "_$rand.$ext";
$target = "$dir/$fname";
if (!@move_uploaded_file($f['tmp_name'], $target)) fail('Could not save file.', 500);
@chmod($target, 0664);

$relPath = 'assets/attachments/' . $fname;
try {
    $stmt = $pdo->prepare(
        "INSERT INTO ticket_attachments (ticket_id, file_path, original_name, mime_type, file_size, uploaded_by)
         VALUES (:tid, :fp, :on, :mt, :fs, :ub)"
    );
    $stmt->execute([
        ':tid' => $ticketId, ':fp' => $relPath,
        ':on' => $f['name'] ?? null, ':mt' => $mime,
        ':fs' => (int)$f['size'], ':ub' => $uploader ?: null,
    ]);
    $id = (int)$pdo->lastInsertId();
} catch (PDOException $e) {
    @unlink($target);
    fail('DB error: ' . $e->getMessage(), 500);
}

echo json_encode(['success' => true, 'id' => $id, 'path' => $relPath, 'mime' => $mime]);
