<?php
// api/sla_diag.php
// -----------------------------------------------------------------------------
// SLA diagnostic — shows the raw DB row for a ticket AND what each role's
// endpoint returns for the same ticket. If all four values match, the SLA is
// consistent by definition — any UI mismatch after this is a display bug in
// that specific role's dashboard, not a data problem.
//
// Usage: open in browser
//   http://localhost/csma_helpdesk/api/sla_diag.php?ticket_code=SR-0012
//   http://localhost/csma_helpdesk/api/sla_diag.php?ticket_id=42
// -----------------------------------------------------------------------------

require_once 'config.php';
header('Content-Type: text/html; charset=utf-8');

$code = trim($_GET['ticket_code'] ?? '');
$id   = (int)($_GET['ticket_id'] ?? 0);

echo '<!doctype html><meta charset="utf-8"><title>SLA diagnostic</title>';
echo '<style>
    body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;margin:24px;color:#1c4c6e;background:#f5f9fe;}
    h1{font-size:1.4rem;margin:0 0 6px;}
    .lookup{background:#fff;padding:14px 18px;border-radius:12px;border:1px solid #dbe6f0;margin-bottom:18px;}
    .lookup input{padding:6px 10px;border:1px solid #c9d8e6;border-radius:8px;margin:0 8px 0 4px;font-family:inherit;}
    .lookup button{padding:6px 16px;background:#1f6392;color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:inherit;}
    table{border-collapse:collapse;background:#fff;width:100%;max-width:900px;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
    th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #eef2f6;font-family:ui-monospace,Consolas,monospace;font-size:13px;}
    th{background:#eaf2fa;color:#1c4c6e;font-weight:600;}
    .ok{color:#1e7a4a;font-weight:600;}
    .bad{color:#c62828;font-weight:600;}
    .section{margin:22px 0 6px;font-weight:600;color:#1c4c6e;}
    .hint{color:#6b8399;font-size:12px;margin-top:4px;}
    pre{background:#0f2436;color:#dce7f3;padding:12px 16px;border-radius:10px;overflow:auto;font-size:12px;}
</style>';

echo '<h1>SLA diagnostic</h1>';
echo '<div class="hint">Reads the raw DB row and shows exactly what each role\'s API returns for the same ticket. If all match, the SLA is consistent; any UI mismatch after that is a display bug in that role\'s JS, not a data issue.</div>';

echo '<form class="lookup" method="get">';
echo '  Ticket code: <input name="ticket_code" value="'.htmlspecialchars($code).'" placeholder="SR-0012">';
echo '  or Ticket ID: <input name="ticket_id" value="'.($id ?: '').'" placeholder="42">';
echo '  <button type="submit">Look up</button>';
echo '</form>';

if (!$code && !$id) {
    echo '<div class="hint">Enter a ticket code (e.g. SR-0012) or a numeric ticket ID above.</div>';
    exit;
}

try {
    // ─── 1. Raw DB row (source of truth) ────────────────────────────────────
    $sql = "SELECT id, ticket_code, priority, status,
                   sla_response_hours, sla_resolution_hours,
                   sla_custom_hours,
                   submitted_at, response_due_at, resolution_due_at
            FROM tickets WHERE " . ($id ? "id = :key" : "ticket_code = :key") . " LIMIT 1";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([':key' => $id ?: $code]);
    $row = $stmt->fetch();
    if (!$row) { echo '<p class="bad">Ticket not found.</p>'; exit; }

    $ticketId    = (int)$row['id'];
    $ticketCode  = $row['ticket_code'];
    $dbResHours  = $row['sla_resolution_hours'];
    $dbDeadline  = $row['resolution_due_at'];

    echo '<div class="section">1. Raw DB row (the truth)</div>';
    echo '<table>';
    foreach ($row as $k => $v) {
        echo '<tr><th>'.htmlspecialchars($k).'</th><td>'.htmlspecialchars((string)$v).'</td></tr>';
    }
    echo '</table>';

    // ─── 2. get_my_tickets response for this row ────────────────────────────
    $stmt2 = $pdo->prepare("SELECT requester_id FROM tickets WHERE id=:id");
    $stmt2->execute([':id'=>$ticketId]);
    $reqId = (int)$stmt2->fetchColumn();

    $baseUrl = sprintf('%s://%s%s',
        (isset($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off')?'https':'http',
        $_SERVER['HTTP_HOST'] ?? 'localhost',
        rtrim(dirname($_SERVER['REQUEST_URI'] ?? ''), '/')
    );

    function fetchAndFind($url, $ticketId) {
        $ctx = stream_context_create(['http'=>['timeout'=>3]]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false) return ['error'=>'HTTP fetch failed for '.$url];
        $j = json_decode($raw, true);
        if (!$j || !$j['success']) return ['error'=>'Endpoint returned failure', 'raw'=>$raw];
        $arr = $j['data'] ?? $j['approvals'] ?? [$j['ticket'] ?? null];
        foreach ($arr as $t) if ($t && (int)$t['id'] === $ticketId) return $t;
        return ['error'=>'Ticket not in response'];
    }

    echo '<div class="section">2. Requester endpoint (get_my_tickets.php)</div>';
    $r = fetchAndFind("$baseUrl/get_my_tickets.php?requester_id=$reqId", $ticketId);
    $reqRes  = $r['sla_resolution_hours'] ?? null;
    $reqDead = $r['resolution_due_at']    ?? null;
    echo '<table>';
    echo '<tr><th>sla_resolution_hours</th><td>'.htmlspecialchars((string)$reqRes).' ' . ($reqRes == $dbResHours ? '<span class="ok">MATCHES DB</span>' : '<span class="bad">MISMATCH</span>').'</td></tr>';
    echo '<tr><th>resolution_due_at</th><td>'.htmlspecialchars((string)$reqDead).' ' . ($reqDead == $dbDeadline ? '<span class="ok">MATCHES DB</span>' : '<span class="bad">MISMATCH</span>').'</td></tr>';
    if (!empty($r['error'])) echo '<tr><th>error</th><td class="bad">'.htmlspecialchars($r['error']).'</td></tr>';
    echo '</table>';

    // ─── 3. School Admin endpoint ───────────────────────────────────────────
    echo '<div class="section">3. School Admin endpoint (school-admin-data.php)</div>';
    $r = fetchAndFind("$baseUrl/school-admin-data.php?action=get_ticket_detail&ticket_id=$ticketId", $ticketId);
    $saRes  = $r['sla_resolution_hours'] ?? null;
    $saDead = $r['resolution_due_at']    ?? null;
    echo '<table>';
    echo '<tr><th>sla_resolution_hours</th><td>'.htmlspecialchars((string)$saRes).' ' . ($saRes == $dbResHours ? '<span class="ok">MATCHES DB</span>' : '<span class="bad">MISMATCH</span>').'</td></tr>';
    echo '<tr><th>resolution_due_at</th><td>'.htmlspecialchars((string)$saDead).' ' . ($saDead == $dbDeadline ? '<span class="ok">MATCHES DB</span>' : '<span class="bad">MISMATCH</span>').'</td></tr>';
    if (!empty($r['error'])) echo '<tr><th>error</th><td class="bad">'.htmlspecialchars($r['error']).'</td></tr>';
    echo '</table>';

    // ─── Verdict ────────────────────────────────────────────────────────────
    echo '<div class="section">Verdict</div>';
    $allMatch = ($reqRes == $dbResHours && $reqDead == $dbDeadline &&
                 $saRes  == $dbResHours && $saDead  == $dbDeadline);
    if ($allMatch) {
        echo '<p class="ok">✓ All endpoints return the same SLA values that are in the DB.</p>';
        echo '<p class="hint">If any dashboard is STILL showing a different value, that dashboard\'s JS was not updated — clear the browser cache (Ctrl+Shift+R) or verify the JS file on disk contains <code>sla_resolution_hours</code>.</p>';
    } else {
        echo '<p class="bad">✗ At least one endpoint returned a different value from the DB. Check that the API files were replaced with the v6 versions.</p>';
    }

} catch (PDOException $e) {
    echo '<pre>DB error: '.htmlspecialchars($e->getMessage()).'</pre>';
}
