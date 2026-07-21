<?php
// api/cost_budget_common.php
// -----------------------------------------------------------------------------
// Shared logic for cost_analysis.php and budget_planning.php.
//
//   - fetchCostRows()        pulls every cost-bearing ticket once, already
//                             bucketed into repair / maintenance / replacement /
//                             consumable, with department + month + a guessed
//                             equipment category attached.
//   - linearRegression()     ordinary least-squares fit over (x,y) pairs.
//   - forecastNextMonths()   turns a "YYYY-MM" => total map into a forecast
//                             for the next N months using linear regression.
//   - classifyEquipmentCategory()  buckets free-text equipment names into the
//                             5 categories used across the report spec
//                             (Computers, Printers, Network Equipment,
//                             Displays, Other).
// -----------------------------------------------------------------------------

require_once 'config.php';

function jsonOk(array $data = [])   { echo json_encode(['success' => true] + $data); exit; }
function jsonFail(string $msg, int $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'message' => $msg]);
    exit;
}

function requireReadRole(string $role, array $allowed = ['admin', 'school_admin']): void {
    if (!in_array($role, $allowed, true)) {
        jsonFail('Forbidden: not authorized to view this data.', 403);
    }
}

// ─── Equipment category classifier ───────────────────────────────────────────
// Free-text equipment_item names get bucketed into the 5 categories the
// Cost Analysis dashboard reports on (matches the project's cost-analysis
// spec: Computers, Printers, Network Equipment, Displays, Other).
function classifyEquipmentCategory(?string $name): string {
    $n = strtolower((string)$name);
    if ($n === '') return 'Other';

    $printers = ['printer', 'scanner', 'photocopier', 'copier', 'ink', 'toner'];
    $network  = ['router', 'switch', 'access point', 'modem', 'network', 'wifi', 'wi-fi', 'firewall', 'server rack', 'lan', 'ethernet'];
    $displays = ['monitor', 'projector', 'display', 'tv', 'television', 'screen', 'smart board', 'smartboard'];
    $computers= ['laptop', 'desktop', 'computer', 'pc', 'cpu', 'workstation', 'chromebook', 'macbook', 'keyboard', 'mouse', 'ups'];

    foreach ($printers  as $k) if (str_contains($n, $k)) return 'Printers';
    foreach ($network   as $k) if (str_contains($n, $k)) return 'Network Equipment';
    foreach ($displays  as $k) if (str_contains($n, $k)) return 'Displays';
    foreach ($computers as $k) if (str_contains($n, $k)) return 'Computers';
    return 'Other';
}

// ─── Ordinary least squares linear regression ────────────────────────────────
// $points: array of [x, y]. Returns ['slope' => m, 'intercept' => b].
function linearRegression(array $points): array {
    $n = count($points);
    if ($n === 0) return ['slope' => 0.0, 'intercept' => 0.0];
    if ($n === 1) return ['slope' => 0.0, 'intercept' => (float)$points[0][1]];

    $sumX = $sumY = $sumXY = $sumXX = 0.0;
    foreach ($points as [$x, $y]) {
        $sumX  += $x;
        $sumY  += $y;
        $sumXY += $x * $y;
        $sumXX += $x * $x;
    }
    $denom = ($n * $sumXX) - ($sumX * $sumX);
    if (abs($denom) < 1e-9) {
        return ['slope' => 0.0, 'intercept' => $sumY / $n];
    }
    $slope     = (($n * $sumXY) - ($sumX * $sumY)) / $denom;
    $intercept = ($sumY - ($slope * $sumX)) / $n;
    return ['slope' => $slope, 'intercept' => $intercept];
}

// ─── Month helpers ────────────────────────────────────────────────────────────
function monthKey(string $dateStr): string {
    return substr($dateStr, 0, 7); // 'YYYY-MM'
}
function nextMonthKey(string $ym, int $offset): string {
    $t = strtotime($ym . '-01');
    $sign = $offset >= 0 ? '+' : '-';
    return date('Y-m', strtotime("$sign" . abs($offset) . " months", $t));
}

// Build a continuous "YYYY-MM" => total series between the earliest month
// with data and the current month (fills gaps with 0 so the regression sees
// true month spacing rather than only the months that had activity).
function buildContinuousSeries(array $monthTotals, int $minMonths = 6): array {
    if (empty($monthTotals)) {
        // No data at all — synthesize an empty trailing window so the UI
        // still has an axis to draw.
        $out = [];
        $end = date('Y-m');
        for ($i = $minMonths - 1; $i >= 0; $i--) {
            $out[nextMonthKey($end, -$i)] = 0.0;
        }
        return $out;
    }
    ksort($monthTotals);
    $keys  = array_keys($monthTotals);
    $start = reset($keys);
    $end   = date('Y-m'); // always extend up to the current month
    if (strcmp($end, end($keys)) < 0) $end = end($keys);

    // Guarantee at least $minMonths of history for a meaningful trend line.
    $span = (strtotime($end . '-01') - strtotime($start . '-01')) / (30 * 86400);
    if ($span < $minMonths - 1) {
        $start = nextMonthKey($end, -($minMonths - 1));
    }

    $out = [];
    $cursor = $start;
    $guard = 0;
    while (strcmp($cursor, $end) <= 0 && $guard < 60) {
        $out[$cursor] = (float)($monthTotals[$cursor] ?? 0);
        $cursor = nextMonthKey($cursor, 1);
        $guard++;
    }
    return $out;
}

// Forecast the next $monthsAhead months from a "YYYY-MM" => total series.
// Returns ['history' => [...], 'forecast' => [...], 'slope' => .., 'trend_pct' => ..]
function forecastNextMonths(array $monthTotals, int $monthsAhead = 3, int $minMonths = 6): array {
    $series = buildContinuousSeries($monthTotals, $minMonths);
    $keys   = array_keys($series);
    $points = [];
    foreach (array_values($series) as $i => $v) $points[] = [$i, $v];

    $fit   = linearRegression($points);
    $n     = count($points);
    $lastX = $n - 1;

    $forecast = [];
    for ($i = 1; $i <= $monthsAhead; $i++) {
        $x  = $lastX + $i;
        $ym = nextMonthKey(end($keys), $i);
        $y  = $fit['slope'] * $x + $fit['intercept'];
        $forecast[$ym] = max(0.0, round($y, 2));
    }

    // Trend %: compare average of forecast window vs average of last window
    // of the same length taken from history (or overall average if history
    // is shorter than the forecast window).
    $histVals = array_values($series);
    $lookback = min($monthsAhead, count($histVals));
    $recentAvg = $lookback > 0 ? array_sum(array_slice($histVals, -$lookback)) / $lookback : 0;
    $forecastAvg = array_sum($forecast) / max(1, count($forecast));
    $trendPct = $recentAvg > 0 ? round((($forecastAvg - $recentAvg) / $recentAvg) * 100, 1) : ($forecastAvg > 0 ? 100.0 : 0.0);

    return [
        'history'   => $series,
        'forecast'  => $forecast,
        'slope'     => round($fit['slope'], 4),
        'trend_pct' => $trendPct,
    ];
}

// ─── Feature-detect optional ticket columns (mirrors equipment_failures.php) ──
function detectTicketColumns(PDO $pdo): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM tickets")->fetchAll(PDO::FETCH_COLUMN);
    } catch (PDOException $e) {
        $cols = [];
    }
    $cache = [
        'has_repair_total' => in_array('repair_total_cost',    $cols, true),
        'has_completed_at' => in_array('completed_at',         $cols, true),
        'has_equip_item'   => in_array('equipment_item',       $cols, true),
        'has_consumable'   => in_array('consumable_item_id',   $cols, true) && in_array('consumable_qty_needed', $cols, true),
    ];
    return $cache;
}

// ─── Core data pull: every cost-bearing ticket, bucketed ────────────────────
// Returns a flat array of rows:
//   ['id','department','category','request_type','equipment_item',
//    'equip_category','month','date','cost','bucket']
// bucket is one of: repair | maintenance | replacement | consumable
function fetchCostRows(PDO $pdo, string $dateFrom = '', string $dateTo = ''): array {
    $cols        = detectTicketColumns($pdo);
    $repairCol   = $cols['has_repair_total'] ? 't.repair_total_cost' : 'NULL';
    $equipCol    = $cols['has_equip_item']   ? 't.equipment_item'    : "''";

    $consumableJoin = '';
    $consumableCostExpr = 'NULL';
    if ($cols['has_consumable']) {
        $consumableJoin = "LEFT JOIN inventory inv ON inv.id = t.consumable_item_id";
        $consumableCostExpr = "(t.consumable_qty_needed * inv.price_unit)";
    }

    $where = [];
    $params = [];
    if ($dateFrom !== '') { $where[] = 'DATE(t.submitted_at) >= :df'; $params[':df'] = $dateFrom; }
    if ($dateTo   !== '') { $where[] = 'DATE(t.submitted_at) <= :dt'; $params[':dt'] = $dateTo; }
    $whereSql = $where ? ('AND ' . implode(' AND ', $where)) : '';

    $sql = "
        SELECT
            t.id,
            COALESCE(d.name, 'Unassigned') AS department,
            t.category,
            t.request_type,
            COALESCE(NULLIF($equipCol, ''), t.title) AS equipment_item,
            DATE(t.submitted_at) AS submitted_date,
            COALESCE($repairCol, ta.estimated_cost, $consumableCostExpr, 0) AS cost
        FROM tickets t
        LEFT JOIN departments d ON d.id = t.department_id
        LEFT JOIN (
            SELECT ticket_id, MAX(estimated_cost) AS estimated_cost
            FROM ticket_approvals
            WHERE decision = 'Approved' AND estimated_cost IS NOT NULL
            GROUP BY ticket_id
        ) ta ON ta.ticket_id = t.id
        $consumableJoin
        WHERE 1=1 $whereSql
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $raw = $stmt->fetchAll();

    $rows = [];
    foreach ($raw as $r) {
        $cost = (float)$r['cost'];
        if ($cost <= 0) continue; // no cost recorded for this ticket yet

        $rt  = (string)($r['request_type'] ?? '');
        $cat = (string)($r['category'] ?? '');

        if ($cat === 'Consumable') {
            $bucket = 'consumable';
        } elseif ($rt === 'Hardware Issue') {
            $bucket = 'repair';
        } elseif ($rt === 'Maintenance') {
            $bucket = 'maintenance';
        } elseif ($rt === 'Replacement' || $rt === 'Installation') {
            $bucket = 'replacement';
        } else {
            $bucket = 'maintenance'; // Network Issue / General Request fallback
        }

        $rows[] = [
            'id'             => (int)$r['id'],
            'department'     => (string)$r['department'],
            'category'       => $cat,
            'request_type'   => $rt,
            'equipment_item' => (string)$r['equipment_item'],
            'equip_category' => classifyEquipmentCategory((string)$r['equipment_item']),
            'month'          => monthKey((string)$r['submitted_date']),
            'date'           => (string)$r['submitted_date'],
            'cost'           => $cost,
            'bucket'         => $bucket,
        ];
    }
    return $rows;
}

function sumBy(array $rows, callable $keyFn, callable $valFn = null): array {
    $out = [];
    foreach ($rows as $r) {
        $k = $keyFn($r);
        $v = $valFn ? $valFn($r) : (float)$r['cost'];
        $out[$k] = ($out[$k] ?? 0) + $v;
    }
    return $out;
}
