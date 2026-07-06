<?php
require_once 'config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

try {
    // ── FIX 2: IT Admin dashboard must only reflect tickets it is allowed to
    //    action — same rule as get_tickets.php. Tickets awaiting or rejected
    //    by the Department Head stay out of these stats/lists entirely.
    $adminVisibleSQL = "approval_status IN ('Not Required', 'Approved')";

    // ── 1. Ticket status counts ─────────────────────────────────────────────
    $counts = ['Pending' => 0, 'Ongoing' => 0, 'Completed' => 0, 'Pending Confirmation' => 0, 'Closed' => 0];
    foreach ($pdo->query("SELECT status, COUNT(*) AS cnt FROM tickets WHERE $adminVisibleSQL GROUP BY status")->fetchAll() as $r) {
        $counts[$r['status']] = (int)$r['cnt'];
    }
    $totalTickets = array_sum($counts);

    // ── 2. New Open Tickets (most recently submitted, still Pending) ───────
    $newTicketsStmt = $pdo->query(
        "SELECT t.ticket_code, t.title, u.full_name AS requester, t.priority, t.submitted_at
         FROM tickets t
         JOIN users u ON u.id = t.requester_id
         WHERE t.status = 'Pending' AND $adminVisibleSQL
         ORDER BY t.submitted_at DESC
         LIMIT 6"
    );
    $newTickets = array_map(function ($row) {
        return [
            'id'        => '#' . $row['ticket_code'],
            'title'     => $row['title'],
            'requester' => $row['requester'],
            'priority'  => $row['priority'],
            'time'      => relativeTime($row['submitted_at']),
        ];
    }, $newTicketsStmt->fetchAll());

    // ── 3. Aging Tickets (oldest still-open tickets: Pending or Ongoing) ───
    $agingStmt = $pdo->query(
        "SELECT t.ticket_code, t.title, u.full_name AS requester, t.priority, t.submitted_at,
                DATEDIFF(NOW(), t.submitted_at) AS days_open
         FROM tickets t
         JOIN users u ON u.id = t.requester_id
         WHERE t.status IN ('Pending', 'Ongoing') AND $adminVisibleSQL
         ORDER BY t.submitted_at ASC
         LIMIT 6"
    );
    $agingTickets = array_map(function ($row) {
        $days = (int)$row['days_open'];
        return [
            'id'        => '#' . $row['ticket_code'],
            'title'     => $row['title'],
            'requester' => $row['requester'],
            'priority'  => $row['priority'],
            'days'      => $days === 0 ? 'Today' : ($days === 1 ? '1 day' : "$days days"),
        ];
    }, $agingStmt->fetchAll());

    // ── 4. Recent Activities (latest ticket_activity entries, newest first) ─
    $activityStmt = $pdo->query(
        "SELECT a.message, a.author_name, a.created_at, t.ticket_code
         FROM ticket_activity a
         JOIN tickets t ON t.id = a.ticket_id
         ORDER BY a.created_at DESC
         LIMIT 7"
    );
    $activities = array_map(function ($row) {
        return [
            'title' => $row['ticket_code']
                ? "Ticket #{$row['ticket_code']}: {$row['message']}"
                : $row['message'],
            'time'  => relativeTime($row['created_at']),
            'icon'  => 'fa-ticket-alt',
        ];
    }, $activityStmt->fetchAll());

    // ── 5. Inventory stats (Low Stock count + Total Inventory Value) ────────
    // Wrapped separately: if the inventory table doesn't exist yet, the rest
    // of the dashboard (tickets, activities) still loads fine.
    $lowStockCount = 0;
    $totalInvValue = 0.0;
    try {
        $invStmt = $pdo->query(
            "SELECT
                SUM(quantity * price_unit) AS total_value,
                SUM(CASE WHEN quantity <= (low_stock_pct / 100) * oversupply_threshold THEN 1 ELSE 0 END) AS low_stock_count
             FROM inventory"
        );
        $inv = $invStmt->fetch();
        $lowStockCount = (int)($inv['low_stock_count'] ?? 0);
        $totalInvValue = (float)($inv['total_value'] ?? 0);
    } catch (PDOException $e) {
        // inventory table not created yet — keep zeros, don't fail the whole request
    }

    echo json_encode([
        'success' => true,
        'stats' => [
            'total_requests'      => $totalTickets,
            'pending_requests'    => $counts['Pending'],
            'ongoing_requests'    => $counts['Ongoing'],
            'completed_requests'  => $counts['Completed'],
            'low_stock_items'     => $lowStockCount,
            'total_inventory_value' => $totalInvValue,
        ],
        'new_tickets'    => $newTickets,
        'aging_tickets'  => $agingTickets,
        'activities'     => $activities,
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
}

// ── Helper: convert a MySQL datetime into "x minutes/hours/days ago" ────────
function relativeTime($datetime) {
    if (!$datetime) return '';
    $then = strtotime($datetime);
    $diff = time() - $then;

    if ($diff < 60)    return 'just now';
    if ($diff < 3600)  return floor($diff / 60) . ' min ago';
    if ($diff < 86400) return floor($diff / 3600) . ' hour' . (floor($diff / 3600) > 1 ? 's' : '') . ' ago';
    if ($diff < 172800) return 'Yesterday';
    return floor($diff / 86400) . ' days ago';
}
