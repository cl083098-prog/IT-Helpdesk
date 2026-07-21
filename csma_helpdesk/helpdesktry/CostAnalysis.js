// CostAnalysis.js
// IT Administrator — Cost Analysis dashboard.
// Pulls aggregated cost data from api/cost_analysis.php and renders the
// summary cards, line chart (expense trend), pie chart (by equipment
// category), department bar chart + table, and category table.

(function () {
    'use strict';

    const API = '../api/cost_analysis.php';

    // ═══ AUTHENTICATION ══════════════════════════════════════════════════════
    let currentUser = null;
    (function checkAuth() {
        const raw = sessionStorage.getItem('currentUser');
        if (!raw) { window.location.href = 'Login.html'; return; }
        try { currentUser = JSON.parse(raw); }
        catch (e) { sessionStorage.removeItem('currentUser'); window.location.href = 'Login.html'; return; }
        if (currentUser.role !== 'admin') {
            const dest = {
                school_admin: 'SchoolAdmin.html',
                dept_head:    'DeptHeadDashboard.html',
                requester:    'RequesterDashboard.html'
            };
            window.location.href = dest[currentUser.role] || 'Login.html';
        }
    })();
    const USER_ROLE = currentUser?.role || '';

    const $ = (id) => document.getElementById(id);

    function fmtPeso(v) {
        return `\u20b1${parseFloat(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, (m) => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[m]));
    }
    function trendLabel(trend, suffix) {
        if (!trend) return '';
        const arrow = trend.dir === 'positive' ? '+' : (trend.dir === 'negative' ? '' : '');
        return `${arrow}${trend.pct}% ${suffix}`;
    }
    function trendClass(trend) {
        return trend?.dir === 'negative' ? 'negative' : (trend?.dir === 'positive' ? 'positive' : 'neutral');
    }

    async function apiGet(action, extra = {}) {
        const params = new URLSearchParams({ action, user_role: USER_ROLE, ...extra });
        const res = await fetch(`${API}?${params.toString()}`);
        return res.json();
    }

    let lineChart = null;
    let pieChart  = null;
    let deptChart = null;

    const CATEGORY_COLORS = {
        'Computers':          '#1f6392',
        'Printers':           '#e67e22',
        'Network Equipment':  '#27ae60',
        'Displays':           '#9b59b6',
        'Other':              '#95a5a6',
    };

    function renderSummary(summary) {
        $('totalRepairCost').textContent      = fmtPeso(summary.total_repair_cost);
        $('totalReplacementCost').textContent = fmtPeso(summary.total_replacement_cost);
        $('totalMaintenanceCost').textContent = fmtPeso(summary.total_maintenance_cost);
        $('totalConsumableCost').textContent  = fmtPeso(summary.total_consumable_cost);

        const repairTrendEl = $('repairTrend');
        if (repairTrendEl) {
            repairTrendEl.textContent = trendLabel(summary.repair_trend, 'from last quarter');
            repairTrendEl.className   = `card-trend ${trendClass(summary.repair_trend)}`;
        }
        const replTrendEl = $('replacementTrend');
        if (replTrendEl) {
            replTrendEl.textContent = trendLabel(summary.replacement_trend, 'from last quarter');
            replTrendEl.className   = `card-trend ${trendClass(summary.replacement_trend)}`;
        }
    }

    function renderLineChart(monthlyTrend) {
        const ctx = document.getElementById('expenseTrendChart');
        if (!ctx) return;
        const labels = monthlyTrend.map(m => m.month);
        const data   = monthlyTrend.map(m => m.total);

        if (lineChart) lineChart.destroy();
        lineChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Maintenance & Repair Expenses',
                    data,
                    borderColor: '#1f6392',
                    backgroundColor: 'rgba(31, 99, 146, 0.12)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { callback: (v) => fmtPeso(v) } }
                }
            }
        });

        const subtitle = document.querySelector('.line-chart-container .chart-subtitle');
        if (subtitle && labels.length) subtitle.textContent = `${labels[0]} \u2013 ${labels[labels.length - 1]}`;
    }

    function renderPieChart(byCategory) {
        const ctx = document.getElementById('categoryPieChart');
        if (!ctx) return;
        const labels = byCategory.map(c => c.category);
        const data   = byCategory.map(c => c.total_cost);
        const colors = labels.map(l => CATEGORY_COLORS[l] || '#95a5a6');

        if (pieChart) pieChart.destroy();
        pieChart = new Chart(ctx, {
            type: 'pie',
            data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
                    tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtPeso(c.raw)}` } }
                }
            }
        });
    }

    function renderDeptChart(byDept) {
        const ctx = document.getElementById('departmentBarChart');
        if (!ctx) return;
        const labels = byDept.map(d => d.department);

        if (deptChart) deptChart.destroy();
        deptChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Repair',      data: byDept.map(d => d.repair),      backgroundColor: '#1f6392' },
                    { label: 'Replacement', data: byDept.map(d => d.replacement), backgroundColor: '#7db6de' },
                    { label: 'Maintenance', data: byDept.map(d => d.maintenance), backgroundColor: '#27ae60' },
                    { label: 'Consumable',  data: byDept.map(d => d.consumable),  backgroundColor: '#9b59b6' },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: {
                    x: { stacked: true },
                    y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtPeso(v) } }
                }
            }
        });
    }

    function renderDeptTable(byDept) {
        const tbody = $('departmentTableBody');
        const tfoot = $('departmentTableFooter');
        if (!tbody) return;

        if (!byDept.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No cost data yet.</td></tr>';
            if (tfoot) tfoot.innerHTML = '';
            return;
        }

        tbody.innerHTML = byDept.map(d => `
            <tr>
                <td>${esc(d.department)}</td>
                <td>${fmtPeso(d.repair)}</td>
                <td>${fmtPeso(d.replacement)}</td>
                <td>${fmtPeso(d.maintenance)}</td>
                <td>${fmtPeso(d.consumable)}</td>
                <td><strong>${fmtPeso(d.total)}</strong></td>
            </tr>`).join('');

        if (tfoot) {
            const totals = byDept.reduce((acc, d) => {
                acc.repair += d.repair; acc.replacement += d.replacement;
                acc.maintenance += d.maintenance; acc.consumable += d.consumable; acc.total += d.total;
                return acc;
            }, { repair: 0, replacement: 0, maintenance: 0, consumable: 0, total: 0 });
            tfoot.innerHTML = `<tr>
                <td><strong>Grand Total</strong></td>
                <td><strong>${fmtPeso(totals.repair)}</strong></td>
                <td><strong>${fmtPeso(totals.replacement)}</strong></td>
                <td><strong>${fmtPeso(totals.maintenance)}</strong></td>
                <td><strong>${fmtPeso(totals.consumable)}</strong></td>
                <td><strong>${fmtPeso(totals.total)}</strong></td>
            </tr>`;
        }
    }

    function renderCategoryTable(byCategory) {
        const tbody = $('categoryTableBody');
        const tfoot = $('categoryTableFooter');
        if (!tbody) return;

        if (!byCategory.length) {
            tbody.innerHTML = '<tr><td colspan="3" class="empty-msg">No cost data yet.</td></tr>';
            if (tfoot) tfoot.innerHTML = '';
            return;
        }

        tbody.innerHTML = byCategory.map(c => `
            <tr>
                <td>${esc(c.category)}</td>
                <td>${fmtPeso(c.total_cost)}</td>
                <td>${c.percentage}%</td>
            </tr>`).join('');

        const grand = byCategory.reduce((s, c) => s + c.total_cost, 0);
        if (tfoot) {
            tfoot.innerHTML = `<tr>
                <td><strong>Total</strong></td>
                <td><strong>${fmtPeso(grand)}</strong></td>
                <td><strong>100%</strong></td>
            </tr>`;
        }
    }

    async function loadDashboard() {
        try {
            const json = await apiGet('get_dashboard', { months: 6 });
            if (!json?.success) {
                console.error('Cost Analysis load failed:', json?.message);
                return;
            }
            renderSummary(json.summary);
            renderLineChart(json.monthly_trend || []);
            renderPieChart(json.by_category || []);
            renderDeptChart(json.by_department || []);
            renderDeptTable(json.by_department || []);
            renderCategoryTable(json.by_category || []);
        } catch (e) {
            console.error('Cost Analysis error:', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDashboard);
    } else {
        loadDashboard();
    }
})();
