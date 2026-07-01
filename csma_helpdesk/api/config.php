<?php
define('DB_HOST', 'localhost');
define('DB_NAME', 'csma_helpdesk');
define('DB_USER', 'root');
define('DB_PASS', '');            // leave blank for default XAMPP
define('DB_CHARSET', 'utf8mb4');

$dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Connection failed']);
    exit;
}