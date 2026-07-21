<?php
// api/cost_analysis.php
// -----------------------------------------------------------------------------
// Read-only Cost Analysis dashboard data for IT Administrator (CostAnalysis.html)
// and School Admin (SchoolAdmin.html "Cost Analysis" section).
//
// GET ?action=get_dashboard&user_role=admin|school_admin
//   -> summary cards, monthly expense trend, cost-by-equipment-category,
//      cost-by-department (table + chart data)
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
requireReadRole($role);

try {
    switch ($action) {

        case 'get_dashboard': {
            $months = max(1, (int)($_GET['months'] ?? 6)); // window for the trend line
            $rows   = fetchCostRows($pdo);

            // ── Summary totals (all-time) with previous-quarter comparison ──
            $totals = ['repair' => 0.0, 'maintenance' => 0.0, 'replacement' => 0.0, 'consumable' => 0.0];
            foreach ($rows as $r) $totals[$r['bucket']] += $r['cost'];

            $thisMonth = date('Y-m');
            $curQStart = nextMonthKey($thisMonth, -2);
            $prevQStart = nextMonthKey($thisMonth, -5);
            $prevQEnd   = nextMonthKey($thisMonth, -3);

            $curQ = ['repair' => 0.0, 'maintenance' => 0.0, 'replacement' => 0.0, 'consumable' => 0.0];
            $prevQ = ['repair' => 0.0, 'maintenance' => 0.0, 'replacement' => 0.0, 'consumable' => 0.0];
            foreach ($rows as $r) {
                if (strcmp($r['month'], $curQStart) >= 0) {
                    $curQ[$r['bucket']] += $r['cost'];
                } elseif (strcmp($r['month'], $prevQStart) >= 0 && strcmp($r['month'], $prevQEnd) <= 0) {
                    $prevQ[$r['bucket']] += $r['cost'];
                }
            }
            $trendPct = function (float $cur, float $prev): array {
                if ($prev <= 0) return ['pct' => $cur > 0 ? 100.0 : 0.0, 'dir' => $cur > 0 ? 'positive' : 'neutral'];
                $pct = round((($cur - $prev) / $prev) * 100, 1);
                return ['pct' => $pct, 'dir' => $pct > 0 ? 'positive' : ($pct < 0 ? 'negative' : 'neutral')];
            };

            $summary = [
                'total_repair_cost'      => round($totals['repair'], 2),
                'total_maintenance_cost' => round($totals['maintenance'], 2),
                'total_replacement_cost' => round($totals['replacement'], 2),
                'total_consumable_cost'  => round($totals['consumable'], 2),
                'grand_total'            => round(array_sum($totals), 2),
                'repair_trend'      => $trendPct($curQ['repair'], $prevQ['repair']),
                'maintenance_trend' => $trendPct($curQ['maintenance'], $prevQ['maintenance']),
                'replacement_trend' => $trendPct($curQ['replacement'], $prevQ['replacement']),
                'consumable_trend'  => $trendPct($curQ['consumable'], $prevQ['consumable']),
            ];

            // ── Monthly expense trend (maintenance-related = repair+maintenance) ──
            $monthlyAll = sumBy($rows, fn($r) => $r['month']);
            $series = buildContinuousSeries($monthlyAll, $months);
            $trend = [];
            foreach ($series as $ym => $val) $trend[] = ['month' => $ym, 'total' => round($val, 2)];

            // ── Cost by equipment category (pie) ──
            $byCatSum = sumBy($rows, fn($r) => $r['equip_category']);
            arsort($byCatSum);
            $grand = array_sum($byCatSum) ?: 1;
            $byCategory = [];
            foreach ($byCatSum as $cat => $val) {
                $byCategory[] = [
                    'category'   => $cat,
                    'total_cost' => round($val, 2),
                    'percentage' => round(($val / $grand) * 100, 1),
                ];
            }

            // ── Cost by department (bar + table) ──
            $deptAgg = [];
            foreach ($rows as $r) {
                $d = $r['department'];
                if (!isset($deptAgg[$d])) {
                    $deptAgg[$d] = ['department' => $d, 'repair' => 0.0, 'replacement' => 0.0, 'maintenance' => 0.0, 'consumable' => 0.0];
                }
                $deptAgg[$d][$r['bucket']] += $r['cost'];
            }
            $byDepartment = [];
            foreach ($deptAgg as $d) {
                $total = $d['repair'] + $d['replacement'] + $d['maintenance'] + $d['consumable'];
                $byDepartment[] = [
                    'department'  => $d['department'],
                    'repair'      => round($d['repair'], 2),
                    'replacement' => round($d['replacement'], 2),
                    'maintenance' => round($d['maintenance'], 2),
                    'consumable'  => round($d['consumable'], 2),
                    'total'       => round($total, 2),
                ];
            }
            usort($byDepartment, fn($a, $b) => $b['total'] <=> $a['total']);

            jsonOk([
                'summary'       => $summary,
                'monthly_trend' => $trend,
                'by_category'   => $byCategory,
                'by_department' => $byDepartment,
            ]);
        }

        default:
            jsonFail("Unknown action: $action", 400);
    }
} catch (PDOException $e) {
    jsonFail('Database error: ' . $e->getMessage(), 500);
}
