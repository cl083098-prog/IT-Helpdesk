<?php
// api/cleanup_cost_budget_sample.php
// ============================================================================
// Removes the sample data that seed_cost_budget_sample.php generated for
// testing Cost Analysis / Budget Planning.
//
// Run this ONCE by visiting:
//   http://localhost/csma_helpdesk/api/cleanup_cost_budget_sample.php
//
// It only ever deletes rows it can positively identify as sample data:
//   - tickets with ticket_code LIKE 'SMP-%'  (and their ticket_approvals)
//   - the 'sample_requester' / 'sample_depthead' users, IF they have no
//     other real tickets tied to them
//   - the sample inventory items, by exact name, IF their quantity/price
//     still match what the seeder created (so it won't touch an item you
//     since renamed or restocked with real data)
//
// Your real tickets, users, and inventory are never touched.
//
// DELETE this file after running it.
// ============================================================================

require_once 'config.php';

$results = [];

function step(array &$results, string $label, callable $fn) {
    try {
        $count = $fn();
        $results[] = "&#9989; $label" . ($count !== null ? " ($count removed)" : '');
    } catch (PDOException $e) {
        $results[] = "&#8505;&#65039; $label &mdash; skipped: " . htmlspecialchars($e->getMessage());
    }
}

// ── 1. Remove sample tickets (and their approvals via FK cascade or explicit delete) ──
$removedTickets = 0;
step($results, 'Sample tickets (ticket_code LIKE \'SMP-%\')', function () use ($pdo, &$removedTickets) {
    $ids = $pdo->query("SELECT id FROM tickets WHERE ticket_code LIKE 'SMP-%'")->fetchAll(PDO::FETCH_COLUMN);
    if (!$ids) return 0;
    $in = implode(',', array_map('intval', $ids));
    try { $pdo->exec("DELETE FROM ticket_approvals WHERE ticket_id IN ($in)"); } catch (PDOException $e) {}
    try { $pdo->exec("DELETE FROM ticket_activity  WHERE ticket_id IN ($in)"); } catch (PDOException $e) {}
    $pdo->exec("DELETE FROM tickets WHERE id IN ($in)");
    $removedTickets = count($ids);
    return $removedTickets;
});

// ── 2. Remove the sample requester/dept_head users — only if they now own no tickets ──
step($results, 'Sample users (sample_requester / sample_depthead, if unused)', function () use ($pdo) {
    $removed = 0;
    foreach (['sample_requester', 'sample_depthead'] as $uname) {
        $u = $pdo->prepare("SELECT id FROM users WHERE username = :u LIMIT 1");
        $u->execute([':u' => $uname]);
        $id = $u->fetchColumn();
        if (!$id) continue;

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM tickets WHERE requester_id = :id");
        $countStmt->execute([':id' => $id]);
        $ticketCount = (int)$countStmt->fetchColumn();

        $approvalCountStmt = $pdo->prepare("SELECT COUNT(*) FROM ticket_approvals WHERE dept_head_id = :id");
        $approvalCountStmt->execute([':id' => $id]);
        $approvalCount = (int)$approvalCountStmt->fetchColumn();

        if ($ticketCount === 0 && $approvalCount === 0) {
            $pdo->prepare("DELETE FROM users WHERE id = :id")->execute([':id' => $id]);
            $removed++;
        }
    }
    return $removed;
});

// ── 3. Remove the sample inventory items — only if untouched since seeding ──
step($results, 'Sample inventory items (untouched since seeding)', function () use ($pdo) {
    // name => [type, category, original_quantity, original_price]
    $seeded = [
        'Dell OptiPlex Desktop'  => [6,  32000],
        'HP LaserJet Printer'    => [2,  14500],
        'TP-Link Wi-Fi Router'   => [3,   4200],
        'Epson Projector'        => [1,  28000],
        'Interactive Whiteboard' => [4,  55000],
        'Printer Ink Cartridge'  => [15,   950],
        'A4 Bond Paper (ream)'   => [20,   260],
    ];
    $removed = 0;
    foreach ($seeded as $name => [$qty, $price]) {
        $s = $pdo->prepare(
            "SELECT id FROM inventory WHERE name = :n AND quantity = :q AND price_unit = :p LIMIT 1"
        );
        $s->execute([':n' => $name, ':q' => $qty, ':p' => $price]);
        $id = $s->fetchColumn();
        if ($id) {
            // Don't delete if something has since allocated/transferred this item.
            $allocCount = 0;
            try {
                $a = $pdo->prepare("SELECT COUNT(*) FROM inventory_allocations WHERE item_id = :id");
                $a->execute([':id' => $id]);
                $allocCount = (int)$a->fetchColumn();
            } catch (PDOException $e) {}
            if ($allocCount === 0) {
                $pdo->prepare("DELETE FROM inventory WHERE id = :id")->execute([':id' => $id]);
                $removed++;
            }
        }
    }
    return $removed;
});

?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Cost & Budget Sample Data Cleanup</title>
    <style>
        body { font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
        h1 { font-size: 1.4rem; }
        ul { line-height: 1.9; }
        a.btn { display: inline-block; margin-top: 18px; padding: 10px 18px; background: #1f6392; color: #fff; border-radius: 8px; text-decoration: none; }
    </style>
</head>
<body>
    <h1>Cost Analysis &amp; Budget Planning &mdash; Sample Data Cleanup</h1>
    <ul>
        <?php foreach ($results as $r) echo "<li>$r</li>"; ?>
    </ul>
    <p>Sample data has been removed. Cost Analysis and Budget Planning will now
       reflect only your real ticket/inventory data.</p>
    <a class="btn" href="../helpdesktry/Login.html">Go to Login</a>
    <p style="margin-top:24px;font-size:0.85rem;color:#777;">Delete this file once you're done.</p>
</body>
</html>
