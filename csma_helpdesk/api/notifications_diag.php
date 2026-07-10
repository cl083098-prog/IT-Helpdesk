<?php
// api/notifications_diag.php
// Diagnostic — dumps the raw DB state so you can prove read/unread persists.
// Open in the browser:  http://localhost/csma_helpdesk/api/notifications_diag.php?user_id=NN
// Optional: &role=admin | school_admin | dept_head | requester

require_once 'config.php';
header('Content-Type: text/html; charset=utf-8');

$userId = (int)($_GET['user_id'] ?? 0);
$role   = trim($_GET['role'] ?? '');

echo '<!doctype html><meta charset="utf-8"><title>Notifications diagnostic</title>';
echo '<style>
    body{font:14px/1.4 -apple-system,Segoe UI,sans-serif;margin:24px;color:#1c4c6e;background:#f5f9fe;}
    h1{font-size:1.3rem;margin:0 0 6px;}
    .lookup{background:#fff;padding:14px 18px;border-radius:12px;border:1px solid #dbe6f0;margin-bottom:18px;}
    .lookup input,.lookup select{padding:6px 10px;border:1px solid #c9d8e6;border-radius:8px;margin:0 8px 0 4px;font-family:inherit;}
    .lookup button{padding:6px 16px;background:#1f6392;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;}
    table{border-collapse:collapse;background:#fff;width:100%;max-width:1100px;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
    th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eef2f6;font-family:ui-monospace,Consolas,monospace;font-size:12px;}
    th{background:#eaf2fa;color:#1c4c6e;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;}
    tr.unread td{background:#fff9ec;}
    tr.read td{color:#6b8399;}
    .pill{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;}
    .pill.unread{background:#fbe4e4;color:#b23434;}
    .pill.read{background:#e0f5e9;color:#1e7a4a;}
    .hint{color:#6b8399;font-size:12px;margin-top:4px;}
</style>';

echo '<h1>Notifications diagnostic</h1>';
echo '<div class="hint">Raw view of the notifications table filtered for one user + optional role. Read status shown as it is stored in the DB right now — no browser cache, no JS state.</div>';

echo '<form class="lookup" method="get">';
echo '  user_id: <input name="user_id" type="number" value="'.($userId?:'').'" placeholder="42">';
echo '  role: <select name="role"><option value="">(any)</option>';
foreach (['admin','school_admin','dept_head','requester'] as $r) {
    $sel = $r === $role ? ' selected' : '';
    echo "<option value=\"$r\"$sel>$r</option>";
}
echo '</select>';
echo '  <button type="submit">Look up</button>';
echo '</form>';

if (!$userId) { echo '<div class="hint">Enter a user_id above.</div>'; exit; }

try {
    // User summary
    $u = $pdo->prepare("SELECT id, full_name, role FROM users WHERE id = :id");
    $u->execute([':id' => $userId]);
    $ur = $u->fetch();
    if (!$ur) { echo '<p style="color:#b23434;">User not found.</p>'; exit; }
    echo '<p><strong>User:</strong> '.htmlspecialchars($ur['full_name']).' (id='.$ur['id'].', role='.$ur['role'].')</p>';

    $sql = "SELECT id, target_role, target_user, event_type, title, description,
                   is_read, created_at
            FROM notifications
            WHERE target_user = :uid";
    $params = [':uid' => $userId];
    if ($role !== '') {
        $sql .= " OR target_role = :role";
        $params[':role'] = $role;
    } else {
        $sql .= " OR target_role = :urole";
        $params[':urole'] = $ur['role'];
    }
    $sql .= " ORDER BY created_at DESC LIMIT 60";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $unread = 0; foreach ($rows as $r) if (!$r['is_read']) $unread++;
    echo '<p><strong>Total shown:</strong> '.count($rows).' &nbsp;&nbsp; <strong>Unread:</strong> '.$unread.'</p>';

    if (!$rows) {
        echo '<p class="hint">No notifications match this filter.</p>'; exit;
    }

    echo '<table><thead><tr>';
    foreach (['id','is_read','event_type','target_role','target_user','title','description','created_at'] as $c) {
        echo '<th>'.$c.'</th>';
    }
    echo '</tr></thead><tbody>';
    foreach ($rows as $r) {
        $cls = $r['is_read'] ? 'read' : 'unread';
        $pill = $r['is_read']
            ? '<span class="pill read">read</span>'
            : '<span class="pill unread">UNREAD</span>';
        echo "<tr class=\"$cls\">";
        echo '<td>'.$r['id'].'</td>';
        echo '<td>'.$pill.'</td>';
        echo '<td>'.htmlspecialchars((string)$r['event_type']).'</td>';
        echo '<td>'.htmlspecialchars((string)$r['target_role']).'</td>';
        echo '<td>'.htmlspecialchars((string)$r['target_user']).'</td>';
        echo '<td>'.htmlspecialchars((string)$r['title']).'</td>';
        echo '<td>'.htmlspecialchars(mb_strimwidth((string)$r['description'],0,80,'…')).'</td>';
        echo '<td>'.htmlspecialchars((string)$r['created_at']).'</td>';
        echo '</tr>';
    }
    echo '</tbody></table>';

    echo '<p class="hint" style="margin-top:16px;">If you click "mark all read" in the UI and the corresponding rows above still show UNREAD after refreshing this page, the write is not persisting. If they show read, the notification is persisted correctly and any UI showing it as unread is caching stale data (hard-reload with Ctrl+Shift+R).</p>';

} catch (PDOException $e) {
    echo '<pre style="color:#b23434">DB error: '.htmlspecialchars($e->getMessage()).'</pre>';
}
