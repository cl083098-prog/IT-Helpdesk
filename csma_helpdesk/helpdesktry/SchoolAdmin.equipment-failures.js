// SchoolAdmin.equipment-failures.js
// ============================================================================
// Read-only Equipment Failures section for the School Admin SPA.
// Includes an Actions column with a View button that opens a view-only
// Failure Record Details modal.
//
// Include AFTER SchoolAdmin.js in SchoolAdmin.html:
//   <script src="SchoolAdmin.js"></script>
//   <script src="SchoolAdmin.equipment-failures.js"></script>
// ============================================================================

(function () {
    'use strict';

    const API = '../api/equipment_failures.php';

    function getUser() {
        try { return JSON.parse(sessionStorage.getItem('currentUser') || '{}'); }
        catch (e) { return {}; }
    }
    const user = getUser();
    if (user.role !== 'school_admin') return; // this add-on runs only in SA context

    const USER_ID = user.id || 0;

    // ─── Helpers ────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id);
    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>"']/g, (m) =>
            ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    }
    function peso(v) {
        return '₱' + parseFloat(v || 0).toLocaleString('en-PH',
            { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function badge(s) {
        const cls = s === 'Resolved'    ? 'badge-resolved'
                  : s === 'In Progress' ? 'badge-inprogress'
                                        : 'badge-pending';
        const inlineFallback = ({
            'badge-resolved'   : 'background:#e0f5e9;color:#1e7a4a;',
            'badge-inprogress' : 'background:#e0efff;color:#1f6392;',
            'badge-pending'    : 'background:#fff4e0;color:#b56c00;'
        })[cls];
        return `<span class="${cls}" style="${inlineFallback}display:inline-block;padding:4px 12px;border-radius:20px;font-size:0.78rem;font-weight:600;">${esc(s)}</span>`;
    }
    function formatDateTime(dt) {
        if (!dt) return '—';
        const s = String(dt).replace('T', ' ');
        return s.length >= 16 ? s.substring(0, 16) : s;
    }

    async function api(action, extra = {}) {
        const params = new URLSearchParams({
            action, user_role: 'school_admin', user_id: String(USER_ID), ...extra
        });
        const res  = await fetch(`${API}?${params.toString()}`);
        const json = await res.json().catch(() => ({ success: false, message: 'Bad response' }));
        if (!json.success) throw new Error(json.message || 'Request failed');
        return json;
    }

    // ─── Loaders ────────────────────────────────────────────────────────────
    async function loadSummary() {
        try {
            const j = await api('get_summary');
            $('efTotal')     && ($('efTotal').textContent      = j.summary.total_failures);
            $('efTotalCost') && ($('efTotalCost').textContent  = peso(j.summary.total_cost));
            $('efAvgDays')   && ($('efAvgDays').textContent    = j.summary.avg_resolution_days);
            $('efPending')   && ($('efPending').textContent    = j.summary.pending);
            $('efInProgress')&& ($('efInProgress').textContent = j.summary.in_progress);
            $('efResolved')  && ($('efResolved').textContent   = j.summary.resolved);
        } catch (e) { console.warn('[EF] summary:', e.message); }
    }

    async function loadTable() {
        const body = $('efTableBody');
        if (!body) return;
        body.innerHTML = '<tr><td colspan="9" class="loading-msg">Loading…</td></tr>';
        try {
            const extra = {
                search:     $('efSearch')?.value.trim() || '',
                department: $('efDept')?.value          || 'all',
                status:     $('efStatus')?.value        || 'all',
                date_from:  $('efFrom')?.value          || '',
                date_to:    $('efTo')?.value            || '',
            };
            const j = await api('list_failures', extra);
            const rows = j.failures || [];
            if (!rows.length) {
                body.innerHTML = '<tr><td colspan="9" class="empty-msg">No equipment failure records found.</td></tr>';
                return;
            }
            body.innerHTML = rows.map(f => `
                <tr>
                    <td><strong>${esc(f.equipment_name)}</strong>${f.inventory_name ? `<div style="font-size:0.75rem;color:#6b8399;">Linked: ${esc(f.inventory_name)}</div>` : ''}</td>
                    <td>${esc(f.department)}</td>
                    <td>${esc(f.failure_date)}</td>
                    <td>${esc(f.issue)}</td>
                    <td>${esc(f.action_taken || '—')}</td>
                    <td>${f.resolution_date ? esc(f.resolution_date) : '—'}</td>
                    <td>${peso(f.cost)}</td>
                    <td>${badge(f.status)}</td>
                    <td style="text-align:center;">
                        <button class="btn-view" data-id="${f.id}" title="View details">
                            <i class="fas fa-eye"></i> View
                        </button>
                    </td>
                </tr>
            `).join('');

            body.querySelectorAll('.btn-view').forEach(btn => {
                btn.addEventListener('click', () => openDetail(parseInt(btn.dataset.id, 10)));
            });
        } catch (e) {
            body.innerHTML = `<tr><td colspan="9" class="empty-msg">Failed to load: ${esc(e.message)}</td></tr>`;
        }
    }

    // ─── View-only Detail modal ─────────────────────────────────────────────
    async function openDetail(id) {
        const modal = $('efDetailModal');
        const body  = $('efDetailBody');
        if (!modal || !body) return;
        body.innerHTML = '<p style="text-align:center;color:#6b8399;">Loading…</p>';
        modal.classList.add('active');
        try {
            const j = await api('get_failure', { id: String(id) });
            const f = j.failure;
            body.innerHTML = `
                <div class="detail-grid">
                    <div class="detail-field">
                        <label>Equipment Name</label>
                        <div class="detail-value">${esc(f.equipment_name)}</div>
                    </div>
                    <div class="detail-field">
                        <label>Department</label>
                        <div class="detail-value">${esc(f.department)}</div>
                    </div>
                    <div class="detail-field">
                        <label>Linked Inventory Item</label>
                        <div class="detail-value">${f.inventory_name ? esc(f.inventory_name) + (f.inventory_category ? ' (' + esc(f.inventory_category) + ')' : '') : '<em>Not linked</em>'}</div>
                    </div>
                    <div class="detail-field">
                        <label>Status</label>
                        <div class="detail-value">${badge(f.status)}</div>
                    </div>
                    <div class="detail-field">
                        <label>Date of Failure</label>
                        <div class="detail-value">${esc(f.failure_date)}</div>
                    </div>
                    <div class="detail-field">
                        <label>Resolution Date</label>
                        <div class="detail-value">${f.resolution_date ? esc(f.resolution_date) : '—'}</div>
                    </div>
                    <div class="detail-field full">
                        <label>Issue</label>
                        <div class="detail-value">${esc(f.issue)}</div>
                    </div>
                    <div class="detail-field full">
                        <label>Action Taken</label>
                        <div class="detail-value">${esc(f.action_taken || '—')}</div>
                    </div>
                    <div class="detail-field">
                        <label>Repair Cost</label>
                        <div class="detail-value">${peso(f.cost)}</div>
                    </div>
                    <div class="detail-field">
                        <label>Recorded</label>
                        <div class="detail-value">${esc(formatDateTime(f.created_at))}</div>
                    </div>
                </div>
            `;
        } catch (e) {
            body.innerHTML = `<p style="color:#c62828;">Failed to load: ${esc(e.message)}</p>`;
        }
    }
    function closeDetail() { $('efDetailModal')?.classList.remove('active'); }

    async function refresh() {
        await Promise.all([loadSummary(), loadTable()]);
    }

    // ─── Wiring ─────────────────────────────────────────────────────────────
    function wireFilters() {
        let t;
        $('efSearch')?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadTable, 250); });
        ['efDept','efStatus','efFrom','efTo'].forEach(id => {
            $(id)?.addEventListener('change', loadTable);
        });
    }
    function wireDetailModal() {
        const modal = $('efDetailModal');
        $('efDetailCloseX')?.addEventListener('click', closeDetail);
        $('efDetailCloseBtn')?.addEventListener('click', closeDetail);
        modal?.addEventListener('click', (e) => { if (e.target === modal) closeDetail(); });
    }
    function wireNavigation() {
        document.querySelectorAll('.nav-item[data-section="equipment-failures"]').forEach(link => {
            link.addEventListener('click', () => {
                setTimeout(async () => {
                    const titleEl = document.getElementById('pageTitle');
                    if (titleEl) titleEl.textContent = 'Equipment Failures';
                    document.querySelectorAll('.sa-section').forEach(s => s.classList.remove('active'));
                    document.getElementById('section-equipment-failures')?.classList.add('active');
                    document.querySelectorAll('.nav-item[data-section]').forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                    await refresh();
                }, 0);
            });
        });
    }

    function init() {
        wireFilters();
        wireDetailModal();
        wireNavigation();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
