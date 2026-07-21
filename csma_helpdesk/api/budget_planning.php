<?php
// api/budget_planning.php
// -----------------------------------------------------------------------------
// Read-only Budget & Financial Planning dashboard for the IT Administrator only.
// Uses Time-Series Forecasting with (ordinary least squares) Linear Regression
// over monthly historical costs — see cost_budget_common.php::forecastNextMonths().
//
// GET ?action=get_dashboard&user_role=admin
// -----------------------------------------------------------------------------

require_once 'cost_budget_common.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$action = trim($_GET['action']    ?? '');
$role   = trim($_GET['user_role'] ?? '');

if ($action === '') jsonFail('Missing action.');
requireReadRole($role, ['admin']); // Budget Planning is IT Admin only

try {
    switch ($action) {

        case 'get_dashboard': {
            $rows = fetchCostRows($pdo);

            // ── Monthly series per bucket, forecast next quarter (3 months) ──
            $monthlyByBucket = ['repair' => [], 'maintenance' => [], 'replacement' => [], 'consumable' => []];
            foreach ($rows as $r) {
                $monthlyByBucket[$r['bucket']][$r['month']] = ($monthlyByBucket[$r['bucket']][$r['month']] ?? 0) + $r['cost'];
            }

            $fEquipment   = forecastNextMonths($monthlyByBucket['replacement'], 3); // new/replacement gear
            $fConsumables = forecastNextMonths($monthlyByBucket['consumable'], 3);
            $fMaintenance = forecastNextMonths(
                sumSeries($monthlyByBucket['repair'], $monthlyByBucket['maintenance']), 3
            );

            $equipmentForecast   = round(array_sum($fEquipment['forecast']), 2);
            $consumablesForecast = round(array_sum($fConsumables['forecast']), 2);
            $maintenanceForecast = round(array_sum($fMaintenance['forecast']), 2);

            // ── Maintenance chart: history + forecast, one combined series ──
            $maintChart = [];
            foreach ($fMaintenance['history'] as $ym => $val) {
                $maintChart[] = ['month' => $ym, 'actual' => round($val, 2), 'forecast' => null];
            }
            $lastActual = null;
            $histKeys = array_keys($fMaintenance['history']);
            if (!empty($histKeys)) $lastActual = end($fMaintenance['history']);
            $first = true;
            foreach ($fMaintenance['forecast'] as $ym => $val) {
                $entry = ['month' => $ym, 'actual' => null, 'forecast' => round($val, 2)];
                if ($first && $lastActual !== null) {
                    // bridge the line visually by echoing the last actual point
                    $maintChart[count($maintChart) - 1]['forecast'] = round($lastActual, 2);
                    $first = false;
                }
                $maintChart[] = $entry;
            }

            // ── Predicted budget by department (current quarter vs next quarter) ──
            $deptMonthly = []; // department => [month => total]
            foreach ($rows as $r) {
                $deptMonthly[$r['department']][$r['month']] = ($deptMonthly[$r['department']][$r['month']] ?? 0) + $r['cost'];
            }
            // Make sure all known departments show up even with zero history.
            try {
                $deptNames = $pdo->query("SELECT name FROM departments ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
            } catch (PDOException $e) { $deptNames = array_keys($deptMonthly); }
            foreach ($deptNames as $dn) if (!isset($deptMonthly[$dn])) $deptMonthly[$dn] = [];

            $thisMonth  = date('Y-m');
            $curQStart  = nextMonthKey($thisMonth, -2);

            $deptForecast = [];
            $grandCurrent = 0.0; $grandPredicted = 0.0;
            foreach ($deptMonthly as $dept => $series) {
                $f = forecastNextMonths($series, 3);
                $current = 0.0;
                foreach ($series as $ym => $val) {
                    if (strcmp($ym, $curQStart) >= 0) $current += $val;
                }
                $predicted = array_sum($f['forecast']);
                $grandCurrent   += $current;
                $grandPredicted += $predicted;
                $deptForecast[] = [
                    'department'       => $dept,
                    'current_budget'   => round($current, 2),
                    'predicted_budget' => round($predicted, 2),
                    'trend_pct'        => $f['trend_pct'],
                ];
            }
            usort($deptForecast, fn($a, $b) => $b['predicted_budget'] <=> $a['predicted_budget']);

            // ── Forecasted IT procurement needs table ──
            $procurement = buildProcurementForecast($pdo, $rows);
            $totalProcurement = round(array_sum(array_column($procurement, 'estimated_cost')), 2);

            jsonOk([
                'summary' => [
                    'equipment_forecast'   => $equipmentForecast,
                    'consumables_forecast' => $consumablesForecast,
                    'maintenance_forecast' => $maintenanceForecast,
                    'total_procurement_cost' => $totalProcurement,
                ],
                'maintenance_chart'  => $maintChart,
                'department_budget'  => $deptForecast,
                'department_totals'  => [
                    'current_budget'   => round($grandCurrent, 2),
                    'predicted_budget' => round($grandPredicted, 2),
                ],
                'procurement' => $procurement,
            ]);
        }

        default:
            jsonFail("Unknown action: $action", 400);
    }
} catch (PDOException $e) {
    jsonFail('Database error: ' . $e->getMessage(), 500);
}

// ─── Helpers local to this endpoint ───────────────────────────────────────────

function sumSeries(array $a, array $b): array {
    $out = $a;
    foreach ($b as $k => $v) $out[$k] = ($out[$k] ?? 0) + $v;
    return $out;
}

// Builds the "Forecasted IT Procurement Needs" table from two signals:
//   1. Inventory items at/near Low Stock — reorder quantity projected from
//      linear-regression consumption trend, cost = shortfall * unit price.
//   2. Equipment with recurring failures and a rising repair-cost trend —
//      flagged for replacement.
function buildProcurementForecast(PDO $pdo, array $costRows): array {
    $out = [];

    // ── Signal 1: low-stock / at-risk inventory ──
    try {
        $items = $pdo->query(
            "SELECT id, name, type, category, quantity, price_unit,
                    low_stock_pct, oversupply_threshold, department
             FROM inventory"
        )->fetchAll();
    } catch (PDOException $e) { $items = []; }

    foreach ($items as $it) {
        $threshold = ((int)$it['low_stock_pct'] / 100) * (int)$it['oversupply_threshold'];
        $qty       = (int)$it['quantity'];
        if ($qty > $threshold) continue; // not low stock

        // Reorder just enough to clear the low-stock line with a small buffer
        // (1.5x the threshold), capped so equipment with a high oversupply
        // ceiling doesn't generate an unrealistically large one-shot order.
        $target    = max($threshold * 1.5, $qty + 1);
        $shortfall = max(1, (int)ceil($target - $qty));
        $cost      = round($shortfall * (float)$it['price_unit'], 2);
        $priority  = $qty <= 0 ? 'High' : ($qty <= $threshold * 0.5 ? 'High' : 'Medium');

        $out[] = [
            'item'        => $it['name'],
            'priority'    => $priority,
            'estimated_cost' => $cost,
            'reason'      => $qty <= 0
                ? 'Out of stock — immediate replenishment needed'
                : 'Stock at or below the low-stock threshold',
            'timeline'    => $qty <= 0 ? 'Immediate' : 'Next 30 days',
        ];
    }

    // ── Signal 2: recurring equipment failures with a rising cost trend ──
    $byEquip = []; // equipment_item => ['count'=>n, 'monthly'=>[ym=>cost], 'dept'=>...]
    foreach ($costRows as $r) {
        if ($r['bucket'] !== 'repair') continue;
        $key = $r['equipment_item'];
        if (!isset($byEquip[$key])) $byEquip[$key] = ['count' => 0, 'monthly' => [], 'dept' => $r['department']];
        $byEquip[$key]['count']++;
        $byEquip[$key]['monthly'][$r['month']] = ($byEquip[$key]['monthly'][$r['month']] ?? 0) + $r['cost'];
    }
    foreach ($byEquip as $name => $info) {
        if ($info['count'] < 3) continue; // not "recurring" yet
        $f = forecastNextMonths($info['monthly'], 3, 4);
        if ($f['slope'] <= 0) continue; // cost trend isn't rising — repairs still viable

        $estCost = round(max(array_sum($info['monthly']) / max(1, count($info['monthly'])), 1000) * 1.5, 2);
        $out[] = [
            'item'           => $name,
            'priority'       => $info['count'] >= 5 ? 'High' : 'Medium',
            'estimated_cost' => $estCost,
            'reason'         => "Recurring failures ({$info['count']}x) with rising repair costs — replacement recommended",
            'timeline'       => 'Next quarter',
        ];
    }

    usort($out, function ($a, $b) {
        $rank = ['High' => 0, 'Medium' => 1, 'Low' => 2];
        $pa = $rank[$a['priority']] ?? 3; $pb = $rank[$b['priority']] ?? 3;
        if ($pa !== $pb) return $pa <=> $pb;
        return $b['estimated_cost'] <=> $a['estimated_cost'];
    });

    return $out;
}
