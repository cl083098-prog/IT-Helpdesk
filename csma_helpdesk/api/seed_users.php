<?php
require_once 'config.php';

// Clear existing users first
$pdo->exec("DELETE FROM users");

$users = [
    [
        'username'  => 'admin',
        'password'  => password_hash('admin123', PASSWORD_BCRYPT),
        'role'      => 'admin',
        'full_name' => 'Administrator',
        'email'     => 'admin@csma.edu.ph',
        'department'=> 'IT Department',
    ],
    [
        'username'  => 'requester',
        'password'  => password_hash('req123', PASSWORD_BCRYPT),
        'role'      => 'requester',
        'full_name' => 'Alex Rivera',
        'email'     => 'alex.rivera@csma.edu.ph',
        'department'=> 'Senior High School',
    ],
];

$sql  = "INSERT INTO users (username, password, role, full_name, email, department)
         VALUES (:username, :password, :role, :full_name, :email, :department)";
$stmt = $pdo->prepare($sql);

foreach ($users as $user) {
    $stmt->execute($user);
    echo "Inserted: " . $user['username'] . "<br>";
}

echo "<br><strong>Done! Users seeded successfully.</strong>";
echo "<br><a href='http://localhost/csma_helpdesk/helpdesktry/Login.html'>Go to Login</a>";