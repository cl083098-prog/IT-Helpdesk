// ServiceRequest.js - Manage Service Requests with filtering, bulk actions, and auth check

(function () {
    'use strict';

    // ===== AUTHENTICATION CHECK =====
    function checkAdminAuth() {
        const currentUser = sessionStorage.getItem('currentUser');
        if (!currentUser) {
            window.location.href = 'Login.html';
            return false;
        }
        const user = JSON.parse(currentUser);
        if (user.role !== 'admin') {
            window.location.href = 'RequesterDashboard.html';
            return false;
        }
        return true;
    }

    if (!checkAdminAuth()) return;
    // ===== END AUTHENTICATION CHECK =====

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initServiceRequest);
    } else {
        initServiceRequest();
    }

    // ─── Data ────────────────────────────────────────────────────────────────

    // Populated from the database via loadTicketsFromDB()
    let ticketsData = [];

    // ─── State ───────────────────────────────────────────────────────────────

    let currentFilter     = 'all';
    let currentPriority   = 'all';
    let currentDepartment = 'all';
    let currentSearch     = '';
    let selectedTickets   = new Set();

    // ─── Init ────────────────────────────────────────────────────────────────

    function initServiceRequest() {
        injectStyles();
        initTheme();
        initFilters();
        initBulkActions();
        initCompletionModal();
        // If the URL doesn't request a specific tab, do the normal initial load.
        // applyFilterFromURL() already triggers its own load (via the tab's
        // real click handler) when it finds a match, so skip the duplicate fetch.
        if (!applyFilterFromURL()) {
            loadTicketsFromDB();
        }
    }

    // NEW: lets the Dashboard's stat cards deep-link here pre-filtered, e.g.
    // ServiceRequest.html?filter=Pending. Reuses applyStatusFilter() (defined
    // near initFilters() below) so this stays in sync with a manual dropdown
    // change instead of a separate/duplicate filtering implementation.
    function applyFilterFromURL() {
        const filter = new URLSearchParams(window.location.search).get('filter');
        if (!filter) return false;
        const select = document.getElementById('statusFilterSelect');
        if (!select || ![...select.options].some(o => o.value === filter)) return false;
        applyStatusFilter(filter);
        return true;
    }

    // NEW: lets the Dashboard's ticket rows (New Open Tickets / Aging Tickets,
    // including their "View All" modals) deep-link straight into the same
    // Request Details overlay their own row's "View" link opens, e.g.
    // ServiceRequest.html?view=SR-0008. Called from loadTicketsFromDB() once
    // ticketsData is populated (viewTicket() needs it to resolve dbId), and
    // guarded so it only ever fires once per page load — loadTicketsFromDB()
    // runs again later for filters/bulk actions and shouldn't reopen it.
    let viewParamHandled = false;
    function applyViewFromURL() {
        if (viewParamHandled) return;
        viewParamHandled = true;
        const viewId = new URLSearchParams(window.location.search).get('view');
        if (!viewId) return;
        const target = viewId.startsWith('#') ? viewId : '#' + viewId;
        const t = ticketsData.find(t => t.id === target);
        if (t) viewTicket(t.id);
    }

    function initTheme() {
        const toggle = document.getElementById('themeSwitchCheckbox');
        const icon   = document.getElementById('themeIcon');
        const isDark = localStorage.getItem('theme') === 'dark';
        if (toggle) toggle.checked = isDark;
        document.body.classList.toggle('dark-mode', isDark);
        if (icon) icon.className = isDark ? 'ti ti-sun' : 'ti ti-moon';
        toggle?.addEventListener('change', e => {
            const dark = e.target.checked;
            document.body.classList.toggle('dark-mode', dark);
            localStorage.setItem('theme', dark ? 'dark' : 'light');
            if (icon) icon.className = dark ? 'ti ti-sun' : 'ti ti-moon';
        });
    }

    // ─── DB: fetch all tickets ────────────────────────────────────────────────

    async function loadTicketsFromDB() {
        try {
            const statusParam = currentFilter !== 'all' ? `&status=${encodeURIComponent(currentFilter)}` : '';
            const searchParam = currentSearch.trim() ? `&search=${encodeURIComponent(currentSearch.trim())}` : '';
            const res  = await fetch(`../api/get_tickets.php?_=${Date.now()}${statusParam}${searchParam}`);
            const json = await res.json();
            if (!json.success) return;

            ticketsData = json.data.map(t => ({
                id:              '#' + t.ticket_code,
                dbId:            t.id,
                category:        t.category,
                requester:       t.requester,
                department:      t.department,
                equipment:       t.equipment_item,
                assigned:        t.assigned_to,
                title:           t.title,
                priority:        t.priority,
                status:          t.status,
                approvalStatus:  t.approval_status || 'Not Required',
                submittedAt:     t.submitted_at || null,
                completedAt:     t.completed_at || null,
                resolutionDueAt: t.resolution_due_at || null,
            }));

            renderTable();

            const c = json.counts || {};
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
            set('statTotal',     json.total   || 0);
            set('statPending',   c['Pending']   || 0);
            set('statOngoing',   c['Ongoing']   || 0);
            set('statCompleted', c['Completed'] || 0);
            set('statClosed',    c['Closed']    || 0);

            applyViewFromURL();

        } catch (err) {
            console.error('Failed to load tickets:', err);
            showToast('Could not load tickets. Check your connection.', 'error');
        }
    }

    // ─── DB: delete ticket ────────────────────────────────────────────────────

    async function deleteTicketFromDB(dbId, displayId) {
        if (!confirm(`Delete ${displayId}? This cannot be undone.`)) return;
        try {
            const res  = await fetch('../api/delete_ticket.php', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ ticket_id: dbId })
            });
            const json = await res.json();
            if (json.success) {
                selectedTickets.delete(displayId);
                showToast(`${displayId} deleted.`, 'success');
                loadTicketsFromDB();
            } else {
                showToast('Delete failed: ' + (json.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            showToast('Network error during delete.', 'error');
        }
    }

    // ─── DB: update ticket status ─────────────────────────────────────────────

    async function updateTicketStatusInDB(dbId, displayId, newStatus) {
        const cu = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        try {
            const res  = await fetch('../api/update_ticket.php', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    ticket_id:  dbId,
                    status:     newStatus,
                    admin_id:   cu.id,
                    admin_name: cu.name || 'Admin',
                })
            });
            const json = await res.json();
            if (json.success) {
                showToast(`${displayId} updated to "${newStatus}".`, 'success');
                loadTicketsFromDB();
            } else {
                showToast('Update failed: ' + (json.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            showToast('Network error during update.', 'error');
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function getPriorityClass(priority) {
        const map = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' };
        return map[priority] || 'medium';
    }

    function getFilteredTickets() {
        let tickets = [...ticketsData];
        if (currentFilter !== 'all') tickets = tickets.filter(t => t.status === currentFilter);
        if (currentPriority !== 'all') tickets = tickets.filter(t => t.priority === currentPriority);
        if (currentDepartment !== 'all') tickets = tickets.filter(t => t.department === currentDepartment);
        if (currentSearch.trim()) {
            const term = currentSearch.trim().toLowerCase();
            tickets = tickets.filter(t =>
                (t.id       || '').toLowerCase().includes(term) ||
                (t.requester|| '').toLowerCase().includes(term) ||
                (t.equipment|| '').toLowerCase().includes(term) ||
                (t.title    || '').toLowerCase().includes(term)
            );
        }
        return tickets;
    }

    // ─── Render ───────────────────────────────────────────────────────────────

    function renderTable() {
        const filtered = getFilteredTickets();
        const tbody    = document.getElementById('tableBody');
        if (!tbody) return;

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="12">No service requests found.</td></tr>';
            updateStats();
            updateSelectAllCheckboxes();
            updateBulkActionBar();
            return;
        }

        const fmtDateShort = d => d ? new Date(d).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}) : '—';

        tbody.innerHTML = filtered.map(ticket => {
            const priorityClass = getPriorityClass(ticket.priority);
            const statusClass   = getStatusClass(ticket.status);
            const isSelected    = selectedTickets.has(ticket.id);
            const isClosed      = ticket.status === 'Closed';
            // Closed tickets are read-only: no bulk-select checkbox, no delete icon.
            const checkboxCell = isClosed
                ? `<i class="fas fa-lock" title="Closed — read-only" style="color:#95a5a6;font-size:0.8rem;"></i>`
                : `<input type="checkbox" class="ticket-checkbox" data-id="${escapeHtml(ticket.id)}" ${isSelected ? 'checked' : ''}>`;
            const deleteBtn = isClosed
                ? ''
                : `<i class="fas fa-trash-alt delete-ticket-icon" title="Delete" data-id="${escapeHtml(ticket.id)}"></i>`;
            return `
                <tr class="${isSelected ? 'selected' : ''}${isClosed ? ' ticket-closed' : ''}" data-id="${escapeHtml(ticket.id)}">
                    <td style="text-align:center;">${checkboxCell}</td>
                    <td><a href="#" class="ticket-id-link view-ticket-link" data-id="${escapeHtml(ticket.id)}">${escapeHtml(ticket.id)}</a></td>
                    <td>${escapeHtml(ticket.category)}</td>
                    <td>${escapeHtml(ticket.requester)}</td>
                    <td>${escapeHtml(ticket.department)}</td>
                    <td>${escapeHtml(ticket.equipment)}</td>
                    <td>${escapeHtml(ticket.title)}</td>
                    <td><span class="priority-badge ${priorityClass}">${escapeHtml(ticket.priority)}</span></td>
                    <td><span class="status-badge ${statusClass}">${escapeHtml(ticket.status)}</span></td>
                    <td>${fmtDateShort(ticket.submittedAt)}</td>
                    <td>${ticket.completedAt ? fmtDateShort(ticket.completedAt) : '—'}</td>
                    <td class="action-icons">
                        <button class="sr-view-btn view-ticket-link" data-id="${escapeHtml(ticket.id)}">
                            <i class="fas fa-eye"></i> View
                        </button>
                        ${deleteBtn}
                    </td>
                </tr>`;
        }).join('');

        // Checkbox listeners
        tbody.querySelectorAll('.ticket-checkbox').forEach(cb => {
            cb.addEventListener('change', handleCheckboxChange);
        });

        updateStats();
        updateSelectAllCheckboxes();
        updateBulkActionBar();
    }

    function handleCheckboxChange(e) {
        const id = e.target.getAttribute('data-id');
        if (e.target.checked) selectedTickets.add(id);
        else                  selectedTickets.delete(id);
        updateRowHighlight();
        updateSelectAllCheckboxes();
        updateBulkActionBar();
    }

    function updateRowHighlight() {
        document.querySelectorAll('#tableBody tr').forEach(row => {
            row.classList.toggle('selected', selectedTickets.has(row.getAttribute('data-id')));
        });
    }

    function updateSelectAllCheckboxes() {
        // Closed tickets are read-only and can't be part of a bulk operation.
        const editable   = getFilteredTickets().filter(t => t.status !== 'Closed');
        const total      = editable.length;
        const selected   = editable.filter(t => selectedTickets.has(t.id)).length;
        const allChosen  = total > 0 && selected === total;
        const sh = document.getElementById('selectAllHeaderCheckbox');
        const sr = document.getElementById('selectAllCheckbox');
        if (sh) sh.checked = allChosen;
        if (sr) sr.checked = allChosen;
    }

    function selectAll(checked) {
        getFilteredTickets().forEach(t => {
            if (t.status === 'Closed') return;   // never bulk-select closed tickets
            if (checked) selectedTickets.add(t.id);
            else         selectedTickets.delete(t.id);
        });
        updateBulkActionBar();
        renderTable();
    }

    function updateBulkActionBar() {
        const bar   = document.getElementById('bulkActionsBar');
        const span  = document.getElementById('selectedCount');
        const count = selectedTickets.size;
        if (bar) {
            bar.style.display = count > 0 ? 'block' : 'none';
            if (span) span.innerText = count;
        }
    }

    function clearSelectedItems() {
        selectedTickets.clear();
        updateBulkActionBar();
        renderTable();
        showToast('Selection cleared.');
    }

    function updateStats() {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('statTotal',     ticketsData.length);
        set('statPending',   ticketsData.filter(t => t.status === 'Pending').length);
        set('statOngoing',   ticketsData.filter(t => t.status === 'Ongoing').length);
        set('statCompleted', ticketsData.filter(t => t.status === 'Completed').length);
        set('statClosed',    ticketsData.filter(t => t.status === 'Closed').length);
    }

    // ─── Bulk Actions ─────────────────────────────────────────────────────────

    async function bulkDeleteItems() {
        const count = selectedTickets.size;
        if (count === 0) { showToast('No tickets selected.', 'warning'); return; }
        if (!confirm(`Delete ${count} ticket(s)? This cannot be undone.`)) return;

        const toDelete = [...selectedTickets];
        let ok = 0;
        for (const displayId of toDelete) {
            const ticket = ticketsData.find(t => t.id === displayId);
            if (!ticket) continue;
            try {
                const res  = await fetch('../api/delete_ticket.php', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body:   JSON.stringify({ ticket_id: ticket.dbId })
                });
                if ((await res.json()).success) ok++;
            } catch (e) { console.error(e); }
        }
        selectedTickets.clear();
        updateBulkActionBar();
        showToast(`${ok} ticket(s) deleted.`, 'success');
        loadTicketsFromDB();
    }

    async function bulkUpdateStatus() {
        const count = selectedTickets.size;
        if (count === 0) { showToast('No tickets selected.', 'warning'); return; }
        const newStatus = prompt(`Update status for ${count} selected ticket(s):\n\nEnter: Pending or Ongoing\n(Use Mark as Completed in the detail view to complete individual tickets)`, 'Ongoing');
        if (newStatus === null) return;
        if (!['Pending', 'Ongoing'].includes(newStatus)) {
            showToast('Invalid status. Bulk update only supports Pending or Ongoing. Use Mark as Completed for completion flow.', 'error');
            return;
        }
        const cu = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        const toUpdate = [...selectedTickets];
        let ok = 0;
        for (const displayId of toUpdate) {
            const ticket = ticketsData.find(t => t.id === displayId);
            if (!ticket) continue;
            try {
                const res  = await fetch('../api/update_ticket.php', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body:   JSON.stringify({ ticket_id: ticket.dbId, status: newStatus,
                                            admin_id: cu.id, admin_name: cu.name || 'Admin' })
                });
                if ((await res.json()).success) ok++;
            } catch (e) { console.error(e); }
        }
        selectedTickets.clear();
        updateBulkActionBar();
        showToast(`${ok} ticket(s) updated to "${newStatus}".`, 'success');
        loadTicketsFromDB();
    }

    // ─── Filter & Search ──────────────────────────────────────────────────────

    // Status is filtered server-side (loadTicketsFromDB() passes it to the
    // API), so changing it re-fetches. Priority/department are filtered
    // client-side against the already-loaded ticketsData (see
    // getFilteredTickets()), so those just re-render.
    function applyStatusFilter(value) {
        currentFilter = value;
        const select = document.getElementById('statusFilterSelect');
        if (select) select.value = value;
        selectedTickets.clear();
        updateBulkActionBar();
        loadTicketsFromDB();
    }

    function initFilters() {
        const statusSelect = document.getElementById('statusFilterSelect');
        if (statusSelect) {
            statusSelect.addEventListener('change', () => applyStatusFilter(statusSelect.value));
        }

        const prioritySelect = document.getElementById('priorityFilterSelect');
        if (prioritySelect) {
            prioritySelect.addEventListener('change', () => {
                currentPriority = prioritySelect.value;
                renderTable();
            });
        }

        const deptSelect = document.getElementById('deptFilterSelect');
        if (deptSelect) {
            deptSelect.addEventListener('change', () => {
                currentDepartment = deptSelect.value;
                renderTable();
            });
        }
    }

    // ─── Bulk-action & select-all wiring ─────────────────────────────────────

    function initBulkActions() {
        const sh = document.getElementById('selectAllHeaderCheckbox');
        const sr = document.getElementById('selectAllCheckbox');
        if (sh) sh.addEventListener('change', e => selectAll(e.target.checked));
        if (sr) sr.addEventListener('change', e => selectAll(e.target.checked));

        const bulkDeleteBtn      = document.getElementById('bulkDeleteBtn');
        const bulkUpdateStatusBtn= document.getElementById('bulkUpdateStatusBtn');
        const bulkCancelBtn      = document.getElementById('bulkCancelBtn');
        if (bulkDeleteBtn)       bulkDeleteBtn.addEventListener('click',       bulkDeleteItems);
        if (bulkUpdateStatusBtn) bulkUpdateStatusBtn.addEventListener('click', bulkUpdateStatus);
        if (bulkCancelBtn)       bulkCancelBtn.addEventListener('click',       clearSelectedItems);

        // Event delegation for row actions
        const tbody = document.getElementById('tableBody');
        if (tbody) {
            tbody.addEventListener('click', e => {
                const deleteIcon = e.target.closest('.delete-ticket-icon');
                const viewLink   = e.target.closest('.view-ticket-link');
                if (deleteIcon) { e.preventDefault(); deleteTicket(deleteIcon.dataset.id); }
                else if (viewLink) { e.preventDefault(); viewTicket(viewLink.dataset.id); }
            });
        }
    }

    // ─── Individual Ticket Actions ────────────────────────────────────────────

    // ── Request Details Overlay ────────────────────────────────────────────────
    async function viewTicket(ticketId) {
        const t = ticketsData.find(t => t.id === ticketId);
        if (!t) return;
        _openDetailOverlay();
        try {
            const res  = await fetch(`../api/get_ticket_detail.php?ticket_id=${t.dbId}&_=${Date.now()}`);
            const json = await res.json();
            if (!json.success) { showToast('Could not load ticket.', 'error'); _closeDetailOverlay(); return; }
            _renderDetail(json.ticket);
        } catch (err) {
            showToast('Network error loading ticket.', 'error');
            _closeDetailOverlay();
        }
    }

    function _openDetailOverlay() {
        let ov = document.getElementById('tdOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'tdOverlay';
            ov.className = 'td-overlay';
            ov.innerHTML = `<div class="td-panel" id="tdPanel">
                <div class="td-header">
                    <div class="td-header-titles">
                        <div class="td-header-icon"><i class="ti ti-file-text"></i></div>
                        <h2 class="td-title">Request Details</h2>
                        <div class="td-header-meta">
                            <span class="td-header-code" id="tdHeaderCode">—</span>
                            <span class="td-badge-status" id="tdHeaderStatus">—</span>
                        </div>
                    </div>
                    <button class="td-close-btn" id="tdCloseBtn"><i class="ti ti-x"></i></button>
                </div>
                <div class="td-body" id="tdBody"><div class="td-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div></div>
            </div>`;
            document.body.appendChild(ov);
            document.getElementById('tdCloseBtn').addEventListener('click', _closeDetailOverlay);
            ov.addEventListener('click', e => { if (e.target === ov) _closeDetailOverlay(); });
        }
        ov.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function _closeDetailOverlay() {
        const ov = document.getElementById('tdOverlay');
        if (ov) { ov.classList.remove('active'); document.body.style.overflow = ''; }
        const imgOv = document.getElementById('tdImgViewerOverlay');
        if (imgOv) imgOv.style.display = 'none';
        // When this overlay was opened from the Dashboard (via window.openTicketDetails
        // below) rather than this page, Dashboard.js exposes this hook so its widgets
        // pick up any status/assignment/SLA change made while the overlay was open.
        if (typeof window.refreshDashboardWidgets === 'function') window.refreshDashboardWidgets();
    }

    function _renderDetail(tk) {
        const body = document.getElementById('tdBody');
        if (!body) return;
        const cu          = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        const fmtDate     = d => d ? new Date(d).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}) : 'Not completed';
        const fmtDT       = d => d ? new Date(d).toLocaleString('en-PH') : '—';
        const statusClass = s => `td-badge-status td-status-${(s||'pending').toLowerCase().replace(/ /g,'-')}`;
        const apprClass   = a => `td-badge-appr td-appr-${(a||'not-required').toLowerCase().replace(/ /g,'-')}`;

        // Mirror ticket code + status into the sticky header so both stay
        // visible while scrolling through the form below.
        const headerCode = document.getElementById('tdHeaderCode');
        if (headerCode) headerCode.textContent = '#' + tk.ticket_code;
        const headerStatus = document.getElementById('tdHeaderStatus');
        if (headerStatus) { headerStatus.className = statusClass(tk.status); headerStatus.textContent = tk.status; }

        const officerOpts = (tk.it_officers||[]).map(o =>
            `<option value="${escapeHtml(o.full_name)}" ${tk.assigned_to===o.full_name?'selected':''}>${escapeHtml(o.full_name)}</option>`
        ).join('');
        const invOpts = (tk.inventory_items||[]).map(i =>
            `<option value="${i.id}" ${tk.consumable_item_id==i.id?'selected':''}>${escapeHtml(i.name)} (Qty:${i.quantity})</option>`
        ).join('');
        const deptOpts = (tk.departments||[]).map(d =>
            `<option value="${d.id}" ${tk.consumable_dept_id==d.id?'selected':''}>${escapeHtml(d.name)}</option>`
        ).join('');

        const approvalBlock = (tk.approval_status && tk.approval_status !== 'Not Required') ? `
            <div class="td-section td-callout">
                <div class="td-section-title"><i class="ti ti-user-check"></i> Department Head Approval</div>
                <div class="td-approval-row"><span class="td-field-label">Approval Status</span>
                    <span class="${apprClass(tk.approval?.decision||tk.approval_status)}">${escapeHtml(tk.approval?.decision||tk.approval_status)}</span></div>
                ${tk.approval?.decided_by?`<div class="td-approval-row"><span class="td-field-label">Decided By</span><span>${escapeHtml(tk.approval.decided_by)}</span></div>`:''}
                ${tk.approval?.rejection_note?`<div class="td-approval-row"><span class="td-field-label">Rejection Note</span><span class="td-rejection-note">${escapeHtml(tk.approval.rejection_note)}</span></div>`:''}
                <p class="td-approval-note">This request requires department head approval before proceeding with repairs or replacements.</p>
            </div>` : '';

        const consumableBlock = tk.category === 'Consumable' ? `
            <div class="td-section">
                <div class="td-section-title"><i class="ti ti-box"></i> Consumable Item Selection</div>
                <div class="td-field-group"><label class="td-field-label">Select Consumable Item</label>
                    <select class="td-select" id="tdConsItem"><option value="">Select an item…</option>${invOpts}</select></div>
                <div class="td-field-group"><label class="td-field-label">Quantity Needed</label>
                    <input type="number" class="td-input" id="tdConsQty" min="1" value="${tk.consumable_qty_needed||''}"></div>
                <div class="td-field-group"><label class="td-field-label">Department</label>
                    <select class="td-select" id="tdConsDept"><option value="">Select department…</option>${deptOpts}</select></div>
                <div class="td-info-note"><i class="ti ti-info-circle"></i> This consumable item will be allocated to the selected department upon request completion.</div>
            </div>` : '';

        // External Repair & Maintenance only applies to Equipment tickets —
        // there's nothing to repair on a consumable request. Same reasoning
        // as Consumable Item Selection only appearing for Consumable tickets.
        const extRepairBlock = tk.category === 'Equipment' ? `
            <div class="td-section">
                <div class="td-section-title"><i class="ti ti-tool"></i> External Repair &amp; Maintenance</div>
                <label class="td-checkbox-label"><input type="checkbox" id="tdExtRepairChk" ${tk.external_repair?'checked':''}>
                    <span>Equipment requires external repair/maintenance</span></label>
                <div class="td-repair-costs" id="tdRepairCosts" style="display:${tk.external_repair?'block':'none'};">
                    <div class="td-cost-grid">
                        <div class="td-cost-field"><label class="td-field-label">External Repair Service</label>
                            <input type="number" class="td-input" id="tdSvcCost" min="0" step="0.01" value="${tk.repair_service_cost||''}"></div>
                        <div class="td-cost-field"><label class="td-field-label">Replacement Parts</label>
                            <input type="number" class="td-input" id="tdPartsCost" min="0" step="0.01" value="${tk.repair_parts_cost||''}"></div>
                        <div class="td-cost-field"><label class="td-field-label">Service Fee</label>
                            <input type="number" class="td-input" id="tdSvcFee" min="0" step="0.01" value="${tk.repair_service_fee||''}"></div>
                        <div class="td-cost-field"><label class="td-field-label">Total Maintenance Cost</label>
                            <input type="text" class="td-input td-input-readonly" id="tdRepTotal" readonly
                                value="${tk.repair_total_cost?parseFloat(tk.repair_total_cost).toFixed(2):'0.00'}"></div>
                    </div>
                    <div class="td-cost-field" style="margin-top:8px;"><label class="td-field-label">Remarks</label>
                        <textarea class="td-input td-textarea" id="tdRepRemarks">${escapeHtml(tk.repair_remarks||'')}</textarea></div>
                    ${(() => {
                        // v27: repair-receipt upload UI (restored from the v3
                        // Equipment Failure work). Uploads a JPG/PNG/WEBP/PDF
                        // to api/upload_receipt.php, which stores it under
                        // assets/receipts/ and writes the path to
                        // tickets.repair_receipt_path.
                        const receiptExists = !!tk.repair_receipt_path;
                        const receiptUrl    = receiptExists ? '../' + tk.repair_receipt_path : '';
                        const receiptIsPdf  = receiptExists && /\.pdf$/i.test(tk.repair_receipt_path);
                        const receiptPreview = !receiptExists
                            ? '<div class="td-receipt-empty" id="tdReceiptPreview">No receipt uploaded yet.</div>'
                            : (receiptIsPdf
                                ? `<div class="td-receipt-preview" id="tdReceiptPreview"><i class="ti ti-file-type-pdf" style="font-size:1.4rem;color:#b23434;margin-right:6px;"></i><a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener">View PDF receipt</a></div>`
                                : `<div class="td-receipt-preview" id="tdReceiptPreview"><a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(receiptUrl)}" alt="Receipt" style="max-width:120px;max-height:120px;border-radius:8px;border:1px solid #e2e8ed;"></a></div>`
                            );
                        return `
                        <div class="td-cost-field" style="margin-top:10px;">
                            <label class="td-field-label">Repair Receipt</label>
                            ${receiptPreview}
                            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;">
                                <input type="file" id="tdReceiptFile" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" style="display:none;">
                                <button type="button" class="td-btn-secondary" id="tdReceiptUploadBtn"><i class="ti ti-upload"></i> ${receiptExists ? 'Replace receipt' : 'Upload receipt'}</button>
                                <span class="td-hint" id="tdReceiptStatus">JPG / PNG / WEBP / PDF, max 5 MB.</span>
                            </div>
                        </div>`;
                    })()}
                </div>
            </div>` : '';

        const convHtml = (tk.conversations||[]).map(c => {
            const isAdmin = c.message_type==='reply'||c.message_type==='status_change';
            return `<div class="td-conv-item ${isAdmin?'td-conv-admin':'td-conv-requester'}">
                <div class="td-conv-author">${escapeHtml(c.author_name)} ${isAdmin?'(Technician)':'(Requester)'}
                    <span class="td-conv-time">${fmtDT(c.created_at)}</span></div>
                <div class="td-conv-msg">${escapeHtml(c.message)}</div></div>`;
        }).join('') || '<div class="td-conv-empty">No conversation history yet.</div>';

        body.innerHTML = `
        <div class="td-two-col">
          <div class="td-col-left">
            <div class="td-section">
                <div class="td-section-title"><i class="ti ti-file-text"></i> Request Information</div>
                <div class="td-field-row"><span class="td-field-label">Ticket ID</span><span class="td-ticket-code">${escapeHtml(tk.ticket_code)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Category</span><span class="td-field-val">${escapeHtml(tk.category)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Requester</span><span class="td-field-val">${escapeHtml(tk.requester_name)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Department</span><span class="td-field-val">${escapeHtml(tk.department_name)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Equipment</span><span class="td-field-val">${escapeHtml(tk.equipment_item)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Priority</span><span class="priority-badge ${getPriorityClass(tk.priority)}">${escapeHtml(tk.priority)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Status</span><span class="${statusClass(tk.status)}">${escapeHtml(tk.status)}</span></div>
            </div>
            <div class="td-section">
                <div class="td-section-title"><i class="ti ti-clock-hour-4"></i> Timeline</div>
                <div class="td-field-row"><span class="td-field-label">Date Created</span><span class="td-field-val">${fmtDate(tk.submitted_at)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Date Completed</span><span class="td-field-val">${fmtDate(tk.completed_at)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Duration</span><span class="td-field-val">${escapeHtml(tk.duration_text)}</span></div>
            </div>
            <div class="td-section td-callout">
                <div class="td-section-title"><i class="ti ti-shield-check"></i> Service Level Agreement (SLA)</div>
                ${(() => {
                    // v8: Stock badge is INFORMATIONAL. IT Admin can always edit
                    // SLA. Auto-extension for Out of Stock / Low Stock items
                    // happens at submission time in submit_ticket.php.
                    const stock = tk.stock_status || 'N/A';
                    const stockBadgeCls = stock === 'Out of Stock' ? 'td-stock-out'
                                        : stock === 'Low Stock'    ? 'td-stock-low'
                                        : stock === 'In Stock'     ? 'td-stock-ok'
                                                                   : 'td-stock-na';
                    const stockLabel = stock === 'N/A' ? 'Not tracked'
                                     : `${stock}${tk.stock_quantity !== null && tk.stock_quantity !== undefined ? ` · ${tk.stock_quantity} on hand` : ''}`;
                    const autoExtendedNote = (stock === 'Out of Stock' || stock === 'Low Stock')
                        ? `<div class="td-sla-auto-note"><i class="ti ti-info-circle"></i> SLA was auto-extended at submission because the item is <strong>${escapeHtml(stock)}</strong>.</div>`
                        : '';
                    return `
                <div class="td-field-row">
                    <span class="td-field-label">Item Stock Status</span>
                    <span class="td-field-val">
                        <span class="td-stock-badge ${stockBadgeCls}">${escapeHtml(stockLabel)}</span>
                        ${tk.stock_item_name ? `<span class="td-stock-name">${escapeHtml(tk.stock_item_name)}</span>` : ''}
                    </span>
                </div>
                ${autoExtendedNote}
                <div class="td-field-row">
                    <span class="td-field-label">Expected Resolution Time</span>
                    <span class="td-field-val" id="tdSlaDisplayText">${tk.sla_custom_hours?tk.sla_custom_hours+' hour(s)':tk.sla_resolution_hours?tk.sla_resolution_hours+' hour(s)':'—'}</span>
                </div>
                <div class="td-sla-edit" id="tdSlaEditRow" style="display:none;">
                    <input type="number" class="td-input td-input-sm" id="tdSlaHoursInput" min="0.5" step="0.5" value="${tk.sla_custom_hours||tk.sla_resolution_hours||''}">
                    <span style="margin:0 4px;font-size:0.78rem;color:var(--gray-muted);">hour(s)</span>
                    <button class="td-btn-sla-save" id="tdSlaSaveBtn">Apply</button>
                    <button class="td-btn-sla-cancel" id="tdSlaCancelBtn">Cancel</button>
                </div>
                `;
                })()}
                <div class="td-sla-warn">
                    <span class="td-sla-warn-text">SLA deadline: ${fmtDT(tk.resolution_due_at)}</span>
                    <button class="td-edit-sla-btn" id="tdEditSlaBtn"><i class="ti ti-pencil"></i> Edit SLA</button>
                </div>
            </div>
            ${approvalBlock}
          </div>
          <div class="td-col-right">
            <div class="td-section">
                <div class="td-section-title"><i class="ti ti-info-circle"></i> Issue Details</div>
                <div class="td-field-group"><span class="td-field-label">Title</span><p class="td-issue-title">${escapeHtml(tk.title)}</p></div>
                <div class="td-field-group"><span class="td-field-label">Issue Description</span><p class="td-issue-desc">${escapeHtml(tk.description||'No description.')}</p></div>
                ${(() => {
                    // v28: photos attached by the requester at submit time.
                    const atts = tk.attachments || [];
                    if (!atts.length) return '';
                    const thumbs = atts.map(a => {
                        const url = '../' + a.file_path;
                        const name = escapeHtml(a.original_name || 'attachment');
                        return `<button type="button" class="td-view-img-btn" data-src="${escapeHtml(url)}" data-name="${name}" title="View ${name}">
                            <i class="ti ti-photo"></i> ${name}
                        </button>`;
                    }).join('');
                    return `<div class="td-field-group" style="margin-top:8px;">
                        <span class="td-field-label"><i class="ti ti-photo"></i> Attached Photos (${atts.length})</span>
                        <div class="td-attachment-row">${thumbs}</div>
                    </div>`;
                })()}
            </div>
            <div class="td-section">
                <div class="td-section-title"><i class="ti ti-user-cog"></i> Assignment &amp; Actions</div>
                <div class="td-field-row"><span class="td-field-label">Assigned IT Officer</span>
                    <span class="td-field-val">${tk.assigned_to?escapeHtml(tk.assigned_to):'<span class="td-warn-badge">Awaiting assigned IT Officer</span>'}</span></div>
                <div class="td-field-group" style="margin-top:8px;"><label class="td-field-label">Update Status</label>
                    ${(tk.status==='Pending' || tk.status==='Ongoing') ? `
                        <select class="td-select" id="tdStatusSelect" data-original="${escapeHtml(tk.status)}">
                            <option value="Pending" ${tk.status==='Pending'?'selected':''}>Pending</option>
                            <option value="Ongoing" ${tk.status==='Ongoing'?'selected':''}>Ongoing</option>
                        </select>
                    ` : `
                        <div class="td-status-locked">
                            <span class="td-status-badge td-status-${(tk.status||'').toLowerCase().replace(/\s+/g,'-')}">${escapeHtml(tk.status)}</span>
                            <span class="td-status-lock-note"><i class="ti ti-lock"></i> Locked — status cannot be changed here</span>
                        </div>
                    `}
                </div>
                <div class="td-field-group" style="margin-top:8px;"><label class="td-field-label">Assign IT Officer</label>
                    <select class="td-select" id="tdAssignSelect"><option value="">Select an item…</option>${officerOpts}</select></div>
                ${tk.status==='Ongoing'?`<button class="td-btn-complete" id="tdMarkCompleteBtn"
                    data-dbid="${tk.id}" data-code="${escapeHtml(tk.ticket_code)}"
                    data-requester="${escapeHtml(tk.requester_name)}" data-issue="${escapeHtml(tk.title)}">
                    <i class="ti ti-circle-check"></i> Mark as Completed</button>`:''}
            </div>
            ${extRepairBlock}
            ${consumableBlock}
            <div class="td-section">
                <div class="td-section-title"><i class="ti ti-messages"></i> Conversation &amp; Follow-ups</div>
                <div class="td-conv-thread">${convHtml}</div>
                <div class="td-reply-area">
                    <div class="td-field-label">Add Reply / Update</div>
                    <textarea class="td-textarea td-reply-input" id="tdReplyInput" placeholder="Type your reply or update here…"></textarea>
                    <button class="td-btn-reply" id="tdSendReplyBtn"><i class="ti ti-send"></i> Send Reply</button>
                </div>
            </div>
          </div>
        </div>
        <div class="td-footer">
            <button class="td-btn-save" id="tdSaveChangesBtn" data-dbid="${tk.id}"><i class="ti ti-device-floppy"></i> Save Changes</button>
            <button class="td-btn-cancel" id="tdCancelBtn"><i class="ti ti-x"></i> Close</button>
        </div>`;

        document.getElementById('tdCancelBtn')?.addEventListener('click', _closeDetailOverlay);
        const imgBtns = document.querySelectorAll('.td-view-img-btn');
        imgBtns.forEach(btn => {
            btn.addEventListener('click', () => openTdImageViewer(btn.dataset.src, btn.dataset.name));
        });
        document.getElementById('tdExtRepairChk')?.addEventListener('change', e => {
            document.getElementById('tdRepairCosts').style.display = e.target.checked ? 'block' : 'none';
        });
        ['tdSvcCost','tdPartsCost','tdSvcFee'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                const tot = document.getElementById('tdRepTotal');
                if (tot) tot.value = (['tdSvcCost','tdPartsCost','tdSvcFee'].reduce((s,i)=>s+(parseFloat(document.getElementById(i)?.value)||0),0)).toFixed(2);
            });
        });

        // v27: receipt upload — click the button, pick a file, POST it.
        document.getElementById('tdReceiptUploadBtn')?.addEventListener('click', () => {
            document.getElementById('tdReceiptFile')?.click();
        });
        document.getElementById('tdReceiptFile')?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const statusEl = document.getElementById('tdReceiptStatus');
            if (file.size > 5 * 1024 * 1024) {
                if (statusEl) { statusEl.textContent = 'File too large — 5 MB max.'; statusEl.style.color = '#b23434'; }
                return;
            }
            const cu = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            const fd = new FormData();
            fd.append('ticket_id', tk.id);
            fd.append('admin_id',  cu.id || 0);
            fd.append('receipt',   file);
            if (statusEl) { statusEl.textContent = 'Uploading…'; statusEl.style.color = '#585858'; }
            try {
                const res  = await fetch('../api/upload_receipt.php', { method: 'POST', body: fd });
                const json = await res.json();
                if (!json.success) throw new Error(json.message || 'upload failed');
                if (statusEl) { statusEl.textContent = 'Receipt uploaded successfully.'; statusEl.style.color = '#1e7a4a'; }
                // refresh the ticket detail so the new receipt preview shows
                await _openDetailOverlay(tk.id);
            } catch (err) {
                if (statusEl) { statusEl.textContent = 'Upload failed: ' + err.message; statusEl.style.color = '#b23434'; }
            }
        });
        document.getElementById('tdEditSlaBtn')?.addEventListener('click', () => {
            document.getElementById('tdSlaDisplayText').style.display='none';
            document.getElementById('tdSlaEditRow').style.display='flex';
        });
        document.getElementById('tdSlaCancelBtn')?.addEventListener('click', () => {
            document.getElementById('tdSlaDisplayText').style.display='';
            document.getElementById('tdSlaEditRow').style.display='none';
        });
        document.getElementById('tdSlaSaveBtn')?.addEventListener('click', () => {
            const h = parseFloat(document.getElementById('tdSlaHoursInput')?.value);
            if (!h||h<0.5) { showToast('Enter valid hours (min 0.5)', 'error'); return; }
            document.getElementById('tdSlaDisplayText').childNodes[0].textContent = h + ' hour(s) ';
            document.getElementById('tdSlaDisplayText').style.display='';
            document.getElementById('tdSlaEditRow').style.display='none';
        });

        // ── Mark as Completed → save current edits, then show confirmation modal ─
        document.getElementById('tdMarkCompleteBtn')?.addEventListener('click', async e => {
            const btn = e.currentTarget;
            // Persist any in-flight edits FIRST. Without this, closing the
            // detail overlay would throw away whatever the user changed in the
            // form (assigned officer, cost fields, SLA, etc.).
            btn.disabled = true;
            const saved = await _saveDetail(tk.id, cu, { silent: true, closeAfter: false, reloadList: true });
            btn.disabled = false;
            if (!saved) return;                         // save already surfaced an error toast

            document.getElementById('cmTicketId').textContent  = '#' + btn.dataset.code;
            document.getElementById('cmRequester').textContent = btn.dataset.requester;
            document.getElementById('cmIssue').textContent     = btn.dataset.issue;
            const sendBtn = document.getElementById('btnSendConfirmation');
            sendBtn.dataset.dbId    = btn.dataset.dbid;
            sendBtn.dataset.display = '#' + btn.dataset.code;
            _closeDetailOverlay();                       // close detail after successful save
            document.getElementById('completionModal').style.display = 'flex';
        });

        document.getElementById('tdSaveChangesBtn')?.addEventListener('click', () => _saveDetail(tk.id, cu));
        document.getElementById('tdSendReplyBtn')?.addEventListener('click', () => _sendReply(tk.id, cu));
        // Enter sends the reply; Shift+Enter still inserts a newline, matching
        // the usual chat-input convention.
        document.getElementById('tdReplyInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendReply(tk.id, cu);
            }
        });

        // ── Closed tickets are read-only ─────────────────────────────────────
        // Disable every editable control in the overlay, hide the reply/save
        // actions, and prepend a banner explaining why. Delete + bulk actions
        // for closed rows are already blocked in renderTable / selectAll.
        if (tk.status === 'Closed') {
            _applyClosedReadOnly();
        }
    }

    function _applyClosedReadOnly() {
        const body = document.getElementById('tdBody');
        if (!body) return;

        // Disable every form control inside the detail overlay.
        body.querySelectorAll('input, select, textarea, button').forEach(el => {
            // Keep the outer Close/Cancel button usable, and keep attachment
            // "view image" buttons usable — viewing a photo is read-only and
            // should still work on closed tickets.
            if (el.id === 'tdCancelBtn') return;
            if (el.classList.contains('td-view-img-btn')) return;
            el.disabled = true;
        });

        // Hide the buttons that mutate the ticket entirely.
        ['tdSaveChangesBtn', 'tdSendReplyBtn', 'tdMarkCompleteBtn',
         'tdEditSlaBtn',    'tdSlaSaveBtn',   'tdSlaCancelBtn']
            .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

        // Hide the reply composer wrapper — no point showing an empty textarea.
        const replyArea = body.querySelector('.td-reply-area');
        if (replyArea) replyArea.style.display = 'none';

        // Prepend a read-only banner at the top of the body so it's obvious.
        if (!body.querySelector('.td-closed-banner')) {
            const banner = document.createElement('div');
            banner.className = 'td-closed-banner';
            banner.style.cssText = 'background:#fef3c7;border:1.5px solid #fcd34d;border-radius:12px;'
                + 'padding:12px 16px;margin-bottom:16px;display:flex;gap:10px;align-items:center;'
                + 'color:#7c5215;font-size:0.85rem;font-family:Inter,sans-serif;';
            banner.innerHTML = '<i class="ti ti-lock" style="color:#b8860b;font-size:1rem;"></i>'
                + '<div><strong>This ticket is closed and cannot be edited.</strong>'
                + '<div style="font-size:0.78rem;margin-top:2px;opacity:0.85;">'
                + 'Closed tickets are locked for historical accuracy.</div></div>';
            body.prepend(banner);
        }
    }

    async function _saveDetail(ticketId, cu, opts = {}) {
        const { silent = false, closeAfter = true, reloadList = true } = opts;
        // v7: only include `status` in payload if the select is present AND
        // the value actually differs from the ticket's original status.
        // Prevents the "select falls back to Pending on a Pending Confirmation
        // ticket → Save Changes downgrades it" bug at the source.
        const statusEl = document.getElementById('tdStatusSelect');
        const payload = {
            ticket_id: ticketId, admin_id: cu.id, admin_name: cu.name||'IT Admin',
            ...(statusEl && statusEl.value && statusEl.value !== statusEl.dataset.original
                ? { status: statusEl.value }
                : {}),
            assigned_to:         document.getElementById('tdAssignSelect')?.value,
            external_repair:     document.getElementById('tdExtRepairChk')?.checked ? 1 : 0,
            repair_service_cost: document.getElementById('tdSvcCost')?.value||null,
            repair_parts_cost:   document.getElementById('tdPartsCost')?.value||null,
            repair_service_fee:  document.getElementById('tdSvcFee')?.value||null,
            repair_remarks:      document.getElementById('tdRepRemarks')?.value||null,
            consumable_item_id:  document.getElementById('tdConsItem')?.value||null,
            consumable_qty_needed: document.getElementById('tdConsQty')?.value||null,
            consumable_dept_id:  document.getElementById('tdConsDept')?.value||null,
            sla_custom_hours:    document.getElementById('tdSlaHoursInput')?.value||null,
        };
        try {
            const res  = await fetch('../api/save_ticket_detail.php', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
            const json = await res.json();
            if (json.success) {
                if (!silent)     showToast('Changes saved.', 'success');
                if (reloadList)  loadTicketsFromDB();
                if (closeAfter)  _closeDetailOverlay();
                return true;
            }
            showToast('Save failed: ' + json.message, 'error');
            return false;
        } catch {
            showToast('Network error.', 'error');
            return false;
        }
    }

    async function _sendReply(ticketId, cu) {
        const reply = document.getElementById('tdReplyInput')?.value.trim();
        if (!reply) { showToast('Please type a reply first.', 'warning'); return; }

        // Persist any in-flight edits to the detail form BEFORE sending the
        // reply. Without this step, the reply POST would come back, we'd
        // re-fetch the ticket, and the re-render would wipe out whatever the
        // user had typed into status/assignee/repair costs/consumable/SLA.
        // We save silently: no toast, no close, no list reload — the reply
        // handler handles the visible feedback and the re-open below.
        await _saveDetail(ticketId, cu, { silent: true, closeAfter: false, reloadList: false });

        try {
            const res  = await fetch('../api/save_ticket_detail.php', {method:'POST',headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ticket_id:ticketId, admin_id:cu.id, admin_name:cu.name||'IT Admin', reply})});
            const json = await res.json();
            if (json.success) {
                document.getElementById('tdReplyInput').value = '';
                showToast('Reply sent.', 'success');
                loadTicketsFromDB();
                const t = ticketsData.find(t => t.dbId === ticketId);
                if (t) viewTicket(t.id);
            } else showToast('Failed: ' + json.message, 'error');
        } catch { showToast('Network error.', 'error'); }
    }

    // editTicket removed — status changes are handled inside the detail overlay

    // ── FIX 3: Completion confirmation modal (matches Image 3) ────────────────
    function openCompletionModal(ticketId) {
        const ticket = ticketsData.find(t => t.id === ticketId);
        if (!ticket) return;

        document.getElementById('cmTicketId').textContent  = ticket.id;
        document.getElementById('cmRequester').textContent = ticket.requester;
        document.getElementById('cmIssue').textContent     = ticket.title;

        const sendBtn = document.getElementById('btnSendConfirmation');
        sendBtn.dataset.dbId    = ticket.dbId;
        sendBtn.dataset.display = ticket.id;

        document.getElementById('completionModal').style.display = 'flex';
    }

    function initCompletionModal() {
        const modal     = document.getElementById('completionModal');
        const sendBtn   = document.getElementById('btnSendConfirmation');
        const cancelBtn = document.getElementById('btnCancelCompletion');
        if (!modal || !sendBtn) return;

        cancelBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

        sendBtn.addEventListener('click', async () => {
            const dbId      = Number(sendBtn.dataset.dbId);
            const displayId = sendBtn.dataset.display;
            const cu        = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

            sendBtn.disabled  = true;
            sendBtn.innerHTML = 'Sending…';

            try {
                const res  = await fetch('../api/update_ticket.php', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        action:     'send_confirmation',   // FIX 3 trigger — sets status to 'Pending Confirmation'
                        ticket_id:  dbId,
                        admin_id:   cu.id,
                        admin_name: cu.name || 'IT Admin',
                    })
                });
                const json = await res.json();
                modal.style.display = 'none';

                if (json.success) {
                    showToast(`✅ ${displayId} is now Pending Confirmation — requester notified.`, 'success');
                    loadTicketsFromDB();
                    _showCompletionFeedbackPanel(displayId);  // show feedback panel
                } else {
                    showToast('Failed: ' + (json.message || 'Unknown error'), 'error');
                }
            } catch (err) {
                modal.style.display = 'none';
                showToast('Network error.', 'error');
            } finally {
                sendBtn.disabled  = false;
                sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Confirmation Request';
            }
        });
    }

    // ── FIX 3: status class helper — sanitizes spaces so "Pending Confirmation"
    // becomes a valid single CSS class instead of breaking into two tokens.
    function getStatusClass(status) {
        const key = (status || '').toLowerCase().replace(/\s+/g, '-');
        return `status-${key}`;
    }

    // ── Completion Feedback Panel ────────────────────────────────────────────
    // After "Send Confirmation Request" succeeds, the detail overlay closes and
    // this lightweight panel replaces it — matching the image design exactly.
    function _showCompletionFeedbackPanel(displayId) {
        let panel = document.getElementById('completionFeedbackPanel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'completionFeedbackPanel';
            panel.className = 'cfp-overlay';
            panel.innerHTML = `
                <div class="cfp-box">
                    <button class="cfp-close" id="cfpCloseBtn">&times;</button>
                    <div class="cfp-icon"><i class="fas fa-check-circle"></i></div>
                    <h3 class="cfp-title">Marked as Completed</h3>
                    <p class="cfp-sub" id="cfpSubText">A confirmation request has been sent to the requester.</p>
                    <div class="cfp-detail-card" id="cfpDetailCard"></div>
                    <button class="cfp-done-btn" id="cfpDoneBtn">Done</button>
                </div>`;
            document.body.appendChild(panel);
            document.getElementById('cfpCloseBtn').addEventListener('click', () => panel.classList.remove('active'));
            document.getElementById('cfpDoneBtn').addEventListener('click', () => panel.classList.remove('active'));
            panel.addEventListener('click', e => { if (e.target === panel) panel.classList.remove('active'); });
        }

        const ticket = ticketsData.find(t => t.id === displayId);
        const card   = document.getElementById('cfpDetailCard');
        if (card && ticket) {
            card.innerHTML = `
                <div class="cfp-row"><span class="cfp-label">Ticket ID</span><span class="cfp-val">${escapeHtml(ticket.id)}</span></div>
                <div class="cfp-row"><span class="cfp-label">Requester</span><span class="cfp-val">${escapeHtml(ticket.requester)}</span></div>
                <div class="cfp-row"><span class="cfp-label">Issue</span><span class="cfp-val">${escapeHtml(ticket.title)}</span></div>
                <div class="cfp-row"><span class="cfp-label">Status</span><span class="cfp-val cfp-status-badge">Pending Confirmation</span></div>`;
        }

        panel.classList.add('active');
    }

    function deleteTicket(ticketId) {
        const ticket = ticketsData.find(t => t.id === ticketId);
        if (!ticket) return;
        deleteTicketFromDB(ticket.dbId, ticket.id);
    }

    // ─── Attachment Image Viewer (same behavior as School Admin) ──────────────
    function openTdImageViewer(src, name) {
        if (!src) { showToast('No image source found for this attachment.', 'error'); return; }
        let overlay = document.getElementById('tdImgViewerOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'tdImgViewerOverlay';
            overlay.innerHTML = `
                <div class="td-img-viewer-box">
                    <div class="td-img-viewer-header">
                        <span id="tdImgViewerName" class="td-img-viewer-title"></span>
                        <button id="tdImgViewerClose" class="td-modal-close" title="Close"><i class="ti ti-x"></i></button>
                    </div>
                    <div class="td-img-viewer-body">
                        <img id="tdImgViewerImg" src="" alt="Attachment" style="max-width:100%;max-height:70vh;border-radius:8px;display:block;margin:auto;">
                        <div id="tdImgViewerError" style="display:none;color:#c62828;font-size:0.85rem;padding:20px;">
                            <i class="ti ti-alert-triangle"></i> Could not load this image. The file may be missing on the server.
                        </div>
                    </div>
                    <div class="td-img-viewer-footer">
                        <a id="tdImgViewerDownload" href="" download class="td-btn-download" style="display:inline-flex;align-items:center;gap:6px;">
                            <i class="ti ti-download"></i> Download
                        </a>
                    </div>
                </div>`;
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.querySelector('.td-img-viewer-box').style.cssText = 'background:#fff;border-radius:20px;max-width:860px;width:100%;box-shadow:0 1px 2px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.03);overflow:hidden;';
            overlay.querySelector('.td-img-viewer-header').style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #eef3f8;';
            overlay.querySelector('.td-img-viewer-body').style.cssText = 'padding:20px;text-align:center;background:#f8fbfe;';
            overlay.querySelector('.td-img-viewer-footer').style.cssText = 'padding:12px 20px;border-top:1px solid #eef3f8;text-align:right;';
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
            document.getElementById('tdImgViewerClose').addEventListener('click', () => overlay.style.display = 'none');
            document.getElementById('tdImgViewerImg').addEventListener('error', function () {
                this.style.display = 'none';
                const errEl = document.getElementById('tdImgViewerError');
                if (errEl) errEl.style.display = 'block';
                console.error('ServiceRequest: attachment image failed to load:', this.src);
            });
        }
        const imgEl = document.getElementById('tdImgViewerImg');
        const errEl = document.getElementById('tdImgViewerError');
        imgEl.style.display = 'block';
        if (errEl) errEl.style.display = 'none';
        document.getElementById('tdImgViewerName').textContent = name || 'Image';
        imgEl.src = src;
        document.getElementById('tdImgViewerDownload').href = src;
        document.getElementById('tdImgViewerDownload').download = name || 'attachment';
        overlay.style.display = 'flex';
    }

        // ─── Toast ───────────────────────────────────────────────────────────────

    function showToast(message, type = 'info') {
        let toast = document.getElementById('customToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id        = 'customToast';
            toast.className = 'custom-toast';
            document.body.appendChild(toast);
        }
        const colours = { success: '#27ae60', error: '#c62828', warning: '#e67e22' };
        toast.style.background = colours[type] || '#1f6392';
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ─── Dynamic Styles ───────────────────────────────────────────────────────

    function injectStyles() {
        if (document.getElementById('serviceRequestStyles')) return;
        const style = document.createElement('style');
        style.id = 'serviceRequestStyles';
        style.textContent = `
            .requests-table tr.selected { background: #eef3fc; }
            .bulk-actions-bar {
                background: #1f6392;
                border-radius: 16px;
                padding: 12px 24px;
                margin-bottom: 20px;
                animation: slideDown 0.3s ease;
            }
            @keyframes slideDown {
                from { opacity: 0; transform: translateY(-20px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .bulk-actions-content {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 100%;
                color: white;
                font-weight: 600;
                font-size: 0.9rem;
            }
            .bulk-action-buttons { display: flex; gap: 12px; }
            .bulk-delete-btn, .bulk-update-btn, .bulk-cancel-btn {
                padding: 6px 16px;
                border-radius: 30px;
                border: none;
                font-weight: 600;
                font-size: 0.8rem;
                cursor: pointer;
                font-family: 'Inter', sans-serif;
            }
            .bulk-delete-btn  { background: #c62828; color: white; }
            .bulk-delete-btn:hover  { background: #b71c1c; }
            .bulk-update-btn  { background: #27ae60; color: white; }
            .bulk-update-btn:hover  { background: #219a52; }
            .bulk-cancel-btn  { background: rgba(255,255,255,0.2); color: white; }
            .bulk-cancel-btn:hover  { background: rgba(255,255,255,0.3); }
            .select-all-row {
                display: flex;
                justify-content: flex-end;
                margin-bottom: 12px;
                padding: 0 8px;
            }
            .checkbox-label {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.8rem;
                font-weight: 500;
                color: #1c4c6e;
                cursor: pointer;
            }
            .requests-table input[type="checkbox"] {
                width: 18px;
                height: 18px;
                cursor: pointer;
                accent-color: #1f6392;
            }
            .custom-toast {
                position: fixed;
                bottom: 30px;
                right: 30px;
                color: white;
                padding: 12px 24px;
                border-radius: 40px;
                font-weight: 600;
                font-size: 0.9rem;
                z-index: 9100;  /* above td-overlay(3000) and cfp-overlay(4000) */
                opacity: 0;
                transform: translateY(20px);
                transition: all 0.3s ease;
                pointer-events: none;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            .custom-toast.show { opacity: 1; transform: translateY(0); }
            @media (max-width: 768px) {
                .bulk-actions-content { flex-direction: column; gap: 10px; }
                .bulk-action-buttons  { flex-wrap: wrap; justify-content: center; }
            }
        `;
        document.head.appendChild(style);
    }

    // ─── Cross-page embed: Dashboard.html loads this same script + ServiceRequest.css
    // so it can pop the exact "Request Details" overlay in place instead of navigating
    // away. Dashboard.js's ticket rows call this. Falls back to a fresh
    // loadTicketsFromDB() if ticketsData hasn't populated yet — e.g. the admin clicks
    // within the first moment after Dashboard.html loads, before this script's own
    // background get_tickets.php fetch has resolved.
    window.openTicketDetails = async function (ticketCode) {
        if (!ticketCode) return;
        const target = String(ticketCode).startsWith('#') ? String(ticketCode) : '#' + ticketCode;
        let t = ticketsData.find(t => t.id === target);
        if (!t) { await loadTicketsFromDB(); t = ticketsData.find(t => t.id === target); }
        if (t) viewTicket(t.id);
        else showToast('Could not find that ticket.', 'error');
    };

})();