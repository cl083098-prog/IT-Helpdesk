// EquipmentFailures.js
// v3: Records are DERIVED from service request tickets (Equipment category).
// This page is purely a report — no create/edit/delete. Detail modal shows
// full failure info and the repair receipt (if any) inline.

(function () {
    'use strict';

    const API = '../api/equipment_failures.php';

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
    const USER_ID   = currentUser?.id || 0;
    const USER_ROLE = currentUser?.role || '';

    // ═══ DOM ═════════════════════════════════════════════════════════════════
    const $ = (id) => document.getElementById(id);
    const tbody         = $('failuresTableBody');
    const searchInput   = $('searchEquipment');
    const deptFilter    = $('filterDepartment');
    const statusFilter  = $('filterStatus');
    const dateFrom      = $('dateFrom');
    const dateTo        = $('dateTo');
    const resetBtn      = $('resetFiltersBtn');

    const detailModal   = $('detailModal');
    const closeDetail   = $('closeDetailBtn');
    const detailBody    = $('detailBody');
    const detailCloseBtn= $('detailCloseBtn');

    // ═══ HELPERS ═════════════════════════════════════════════════════════════
    function fmtPeso(v) {
        return `${parseFloat(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, (m) => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[m]));
    }
    function badge(s) {
        const cls = s === 'Resolved'    ? 'badge-resolved'
                  : s === 'In Progress' ? 'badge-inprogress'
                  : s === 'Cancelled'   ? 'badge-pending'
                                        : 'badge-pending';
        return `<span class="${cls}">${esc(s)}</span>`;
    }
    function fmtDT(dt) {
        if (!dt) return '—';
        const s = String(dt).replace('T', ' ');
        return s.length >= 16 ? s.substring(0, 16) : s;
    }
    function toast(message, type = 'info') {
        let t = document.querySelector('.failure-toast');
        if (!t) { t = document.createElement('div'); t.className = 'failure-toast'; document.body.appendChild(t); }
        const colours = { success: '#27ae60', error: '#c62828', warning: '#e67e22', info: '#1f6392' };
        t.style.background = colours[type] || '#1f6392';
        t.textContent = message;
        t.classList.add('show');
        clearTimeout(t._hideTimer);
        t._hideTimer = setTimeout(() => t.classList.remove('show'), 3000);
    }

    // ═══ API ═════════════════════════════════════════════════════════════════
    async function apiGet(action, extra = {}) {
        const params = new URLSearchParams({
            action, user_role: USER_ROLE, user_id: String(USER_ID), ...extra
        });
        const res  = await fetch(`${API}?${params.toString()}`);
        const json = await res.json().catch(() => ({ success: false, message: 'Bad server response' }));
        if (!json.success) throw new Error(json.message || 'Request failed');
        return json;
    }

    // ═══ SUMMARY ═════════════════════════════════════════════════════════════
    async function loadSummary() {
        try {
            const json = await apiGet('get_summary');
            $('totalFailures').innerText = json.summary.total_failures;
            $('totalCost').innerText     = fmtPeso(json.summary.total_cost);
            $('avgResolution').innerText = json.summary.avg_resolution_days;
        } catch (e) { toast(e.message, 'error'); }
    }

    // ═══ TABLE ═══════════════════════════════════════════════════════════════
    async function loadFailures() {
        try {
            const json = await apiGet('list_failures', {
                search:     searchInput.value.trim(),
                department: deptFilter.value,
                status:     statusFilter.value,
                date_from:  dateFrom.value,
                date_to:    dateTo.value,
            });
            renderTable(json.failures || []);
            await loadSummary();
        } catch (e) { toast(e.message, 'error'); }
    }

    function renderTable(rows) {
        if (!rows.length) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="9" style="text-align:center;padding:32px;color:#6b8399;">No equipment failure records found. Records appear here automatically when a Service Request in the Equipment category is submitted.</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(f => `
            <tr data-id="${f.id}">
                <td>
                    <strong>${esc(f.equipment_name)}</strong>
                    <div style="font-size:0.75rem;color:#6b8399;">
                        ${f.ticket_code ? '#' + esc(f.ticket_code) : ''}
                    </div>
                </td>
                <td>${esc(f.department || '—')}</td>
                <td>${esc(f.failure_date)}</td>
                <td>${esc(f.issue)}</td>
                <td>${esc(f.action_taken || '—')}</td>
                <td>${f.resolution_date ? esc(f.resolution_date) : '—'}</td>
                <td>${fmtPeso(f.cost)}</td>
                <td>${badge(f.status)}</td>
                <td class="action-cell">
                    <button class="btn-view" data-id="${f.id}" title="View details">
                        <i class="fas fa-eye"></i> View
                    </button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openDetailModal(parseInt(btn.dataset.id, 10));
            });
        });
    }

    // ═══ VIEW-ONLY DETAIL MODAL ══════════════════════════════════════════════
    function renderReceipt(path) {
        if (!path) return '<em>No receipt uploaded.</em>';
        const url = '../' + path;
        const isPdf = /\.pdf$/i.test(path);
        if (isPdf) {
            return `<a href="${esc(url)}" target="_blank" rel="noopener" class="btn-view" style="text-decoration:none;">
                        <i class="fas fa-file-pdf"></i> Open receipt (PDF)
                    </a>`;
        }
        return `<a href="${esc(url)}" target="_blank" rel="noopener" style="display:inline-block;">
                    <img src="${esc(url)}" alt="Receipt" style="max-width:100%;max-height:280px;border-radius:12px;border:1px solid #dbe6f0;">
                </a>`;
    }

    async function openDetailModal(id) {
        try {
            const json = await apiGet('get_failure', { id: String(id) });
            const f = json.failure;

            detailBody.innerHTML = `
                <div class="detail-grid">
                    <div class="detail-field">
                        <label>Equipment Name</label>
                        <div class="detail-value">${esc(f.equipment_name)}</div>
                    </div>
                    <div class="detail-field">
                        <label>Department</label>
                        <div class="detail-value">${esc(f.department || '—')}</div>
                    </div>
                    <div class="detail-field">
                        <label>Source Ticket</label>
                        <div class="detail-value">${f.ticket_code ? '#' + esc(f.ticket_code) : '—'}</div>
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
                        <label>Action Taken / Repair Remarks</label>
                        <div class="detail-value">${esc(f.action_taken || '—')}</div>
                    </div>
                    <div class="detail-field">
                        <label>Repair Cost</label>
                        <div class="detail-value">${fmtPeso(f.cost)}</div>
                    </div>
                    <div class="detail-field">
                        <label>Priority</label>
                        <div class="detail-value">${esc(f.priority || '—')}</div>
                    </div>
                    <div class="detail-field">
                        <label>Reported By</label>
                        <div class="detail-value">${esc(f.requester_name || '—')}</div>
                    </div>
                    <div class="detail-field">
                        <label>Submitted</label>
                        <div class="detail-value">${esc(fmtDT(f.submitted_at))}</div>
                    </div>
                    <div class="detail-field full">
                        <label>Repair Receipt</label>
                        <div class="detail-value">${renderReceipt(f.receipt_path)}</div>
                    </div>
                </div>
            `;
            detailModal.classList.add('active');
        } catch (e) { toast(e.message, 'error'); }
    }
    function closeDetailModal() { detailModal.classList.remove('active'); }

    // ═══ FILTERS ═════════════════════════════════════════════════════════════
    function resetFilters() {
        searchInput.value  = '';
        deptFilter.value   = 'all';
        statusFilter.value = 'all';
        dateFrom.value     = '';
        dateTo.value       = '';
        loadFailures();
    }

    // ═══ SIDEBAR / LOGOUT ════════════════════════════════════════════════════
    function initMobileSidebar() {
        const menuToggle = $('menuToggle');
        const sidebar    = $('mainSidebar');
        if (!menuToggle || !sidebar) return;
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('active-mobile');
            let overlay = document.querySelector('.sidebar-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'sidebar-overlay';
                document.body.appendChild(overlay);
                overlay.addEventListener('click', () => {
                    sidebar.classList.remove('active-mobile');
                    overlay.classList.remove('active');
                });
            }
            overlay.classList.toggle('active');
        });
    }
    // Logout is handled by Sidebar.js's shared showLogoutModal() (binds to
    // #sidebarLogoutBtn on every admin page) — this page used to also bind
    // its own direct click handler here that skipped the confirmation modal
    // and logged out immediately, racing Sidebar.js's handler on every click.
    // Removed so this page behaves the same as every other module.

    // ═══ INIT ════════════════════════════════════════════════════════════════
    async function init() {
        let searchTimer;
        searchInput?.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadFailures, 250);
        });
        deptFilter?.addEventListener('change', loadFailures);
        statusFilter?.addEventListener('change', loadFailures);
        dateFrom?.addEventListener('change', loadFailures);
        dateTo?.addEventListener('change', loadFailures);
        resetBtn?.addEventListener('click', resetFilters);

        closeDetail?.addEventListener('click', closeDetailModal);
        detailCloseBtn?.addEventListener('click', closeDetailModal);
        detailModal?.addEventListener('click', (e) => { if (e.target === detailModal) closeDetailModal(); });

        initMobileSidebar();

        await loadFailures();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
