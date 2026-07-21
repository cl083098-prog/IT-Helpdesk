// BudgetPlanning.js
// IT Administrator — Budget & Financial Planning dashboard.
// Predictive reports (Linear Regression time-series forecasting) sourced
// from api/budget_planning.php: procurement needs, forecast summary cards,
// predicted maintenance costs chart, and predicted budget by department.

(function () {
    'use strict';

    const API = '../api/budget_planning.php';

    // ═══ AUTHENTICATION — Budget Planning is IT Admin only ═══════════════════
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
    function priorityBadge(p) {
        const cls = p === 'High' ? 'priority-high' : p === 'Medium' ? 'priority-medium' : 'priority-low';
        return `<span class="priority-badge ${cls}">${esc(p)}</span>`;
    }

    async function apiGet(action, extra = {}) {
        const params = new URLSearchParams({ action, user_role: USER_ROLE, ...extra });
        const res = await fetch(`${API}?${params.toString()}`);
        return res.json();
    }

    let maintenanceChart = null;
    let deptChart = null;

    function renderProcurementTable(items) {
        const tbody = $('procurementTableBody');
        if (!tbody) return;
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No procurement needs forecasted right now.</td></tr>';
            return;
        }
        tbody.innerHTML = items.map(it => `
            <tr>
                <td>${esc(it.item)}</td>
                <td>${priorityBadge(it.priority)}</td>
                <td>${fmtPeso(it.estimated_cost)}</td>
                <td>${esc(it.reason)}</td>
                <td>${esc(it.timeline)}</td>
            </tr>`).join('');
    }

    function renderSummary(summary) {
        $('totalProcurementCost').textContent = fmtPeso(summary.total_procurement_cost);
        $('equipmentForecast').textContent    = fmtPeso(summary.equipment_forecast);
        $('consumablesForecast').textContent  = fmtPeso(summary.consumables_forecast);
        $('maintenanceForecast').textContent  = fmtPeso(summary.maintenance_forecast);
    }

    function renderMaintenanceChart(chartData) {
        const ctx = document.getElementById('maintenanceChart');
        if (!ctx) return;
        const labels = chartData.map(d => d.month);
        const actual   = chartData.map(d => d.actual);
        const forecast = chartData.map(d => d.forecast);

        if (maintenanceChart) maintenanceChart.destroy();
        maintenanceChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Actual',
                        data: actual,
                        borderColor: '#1f6392',
                        backgroundColor: 'rgba(31, 99, 146, 0.12)',
                        fill: true,
                        tension: 0.3,
                        spanGaps: false,
                    },
                    {
                        label: 'Forecast (Linear Regression)',
                        data: forecast,
                        borderColor: '#e67e22',
                        backgroundColor: 'rgba(230, 126, 34, 0.12)',
                        borderDash: [6, 4],
                        fill: true,
                        tension: 0.3,
                        spanGaps: false,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmtPeso(v) } } }
            }
        });
    }

    function renderDeptChart(deptBudget) {
        const ctx = document.getElementById('departmentBudgetChart');
        if (!ctx) return;
        const labels = deptBudget.map(d => d.department);

        if (deptChart) deptChart.destroy();
        deptChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Current Budget',   data: deptBudget.map(d => d.current_budget),   backgroundColor: '#1f6392' },
                    { label: 'Predicted Budget', data: deptBudget.map(d => d.predicted_budget), backgroundColor: '#e67e22' },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
                scales: { y: { beginAtZero: true, ticks: { callback: (v) => fmtPeso(v) } } }
            }
        });
    }

    function renderDeptTable(deptBudget, totals) {
        const tbody = $('departmentBudgetBody');
        const tfoot = $('departmentBudgetFooter');
        if (!tbody) return;

        if (!deptBudget.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-msg">No department data yet.</td></tr>';
            if (tfoot) tfoot.innerHTML = '';
            return;
        }

        tbody.innerHTML = deptBudget.map(d => {
            const trendCls = d.trend_pct > 0 ? 'positive' : (d.trend_pct < 0 ? 'negative' : 'neutral');
            const sign = d.trend_pct > 0 ? '+' : '';
            return `<tr>
                <td>${esc(d.department)}</td>
                <td>${fmtPeso(d.current_budget)}</td>
                <td>${fmtPeso(d.predicted_budget)}</td>
                <td><span class="trend-pct ${trendCls}">${sign}${d.trend_pct}%</span></td>
            </tr>`;
        }).join('');

        if (tfoot && totals) {
            tfoot.innerHTML = `<tr>
                <td><strong>Total</strong></td>
                <td><strong>${fmtPeso(totals.current_budget)}</strong></td>
                <td><strong>${fmtPeso(totals.predicted_budget)}</strong></td>
                <td></td>
            </tr>`;
        }
    }

    async function loadDashboard() {
        try {
            const json = await apiGet('get_dashboard');
            if (!json?.success) {
                console.error('Budget Planning load failed:', json?.message);
                return;
            }
            renderSummary(json.summary);
            renderProcurementTable(json.procurement || []);
            renderMaintenanceChart(json.maintenance_chart || []);
            renderDeptChart(json.department_budget || []);
            renderDeptTable(json.department_budget || [], json.department_totals);
        } catch (e) {
            console.error('Budget Planning error:', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadDashboard);
    } else {
        loadDashboard();
    }
})();
