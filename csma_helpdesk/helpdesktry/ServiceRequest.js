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

    let currentFilter   = 'all';
    let currentSearch   = '';
    let selectedTickets = new Set();

    // ─── Init ────────────────────────────────────────────────────────────────

    function initServiceRequest() {
        injectStyles();
        initTheme();
        loadTicketsFromDB();
        initFilters();
        initBulkActions();
        initCompletionModal();
    }

    function initTheme() {
        const toggle = document.getElementById('themeSwitchCheckbox');
        const icon   = document.getElementById('themeIcon');
        const isDark = localStorage.getItem('theme') === 'dark';
        if (toggle) toggle.checked = isDark;
        document.body.classList.toggle('dark-mode', isDark);
        if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        toggle?.addEventListener('change', e => {
            const dark = e.target.checked;
            document.body.classList.toggle('dark-mode', dark);
            localStorage.setItem('theme', dark ? 'dark' : 'light');
            if (icon) icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
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
            tbody.innerHTML = '<tr class="empty-row"><td colspan="11">No service requests found.</td></tr>';
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
            return `
                <tr class="${isSelected ? 'selected' : ''}" data-id="${escapeHtml(ticket.id)}">
                    <td style="text-align:center;">
                        <input type="checkbox" class="ticket-checkbox" data-id="${escapeHtml(ticket.id)}" ${isSelected ? 'checked' : ''}>
                    </td>
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
                        <i class="fas fa-trash-alt delete-ticket-icon" title="Delete" data-id="${escapeHtml(ticket.id)}"></i>
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
        const total      = getFilteredTickets().length;
        const selected   = getFilteredTickets().filter(t => selectedTickets.has(t.id)).length;
        const allChosen  = total > 0 && selected === total;
        const sh = document.getElementById('selectAllHeaderCheckbox');
        const sr = document.getElementById('selectAllCheckbox');
        if (sh) sh.checked = allChosen;
        if (sr) sr.checked = allChosen;
    }

    function selectAll(checked) {
        getFilteredTickets().forEach(t => {
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

    function initFilters() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.getAttribute('data-filter');
                selectedTickets.clear();
                updateBulkActionBar();
                loadTicketsFromDB();     // re-fetch from DB with new filter
            });
        });

        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', e => {
                currentSearch = e.target.value;
                selectedTickets.clear();
                updateBulkActionBar();
                clearTimeout(searchInput._debounce);
                searchInput._debounce = setTimeout(loadTicketsFromDB, 300);
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
                    <h2 class="td-title"><i class="fas fa-clipboard-list"></i> Request Details</h2>
                    <button class="td-close-btn" id="tdCloseBtn">&times;</button>
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
    }

    function _renderDetail(tk) {
        const body = document.getElementById('tdBody');
        if (!body) return;
        const cu          = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        const fmtDate     = d => d ? new Date(d).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}) : 'Not completed';
        const fmtDT       = d => d ? new Date(d).toLocaleString('en-PH') : '—';
        const statusClass = s => `td-badge-status td-status-${(s||'pending').toLowerCase().replace(/ /g,'-')}`;
        const apprClass   = a => `td-badge-appr td-appr-${(a||'not-required').toLowerCase().replace(/ /g,'-')}`;

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
            <div class="td-section td-approval-section">
                <div class="td-section-title"><i class="fas fa-user-check"></i> Department Head Approval</div>
                <div class="td-approval-row"><span class="td-field-label">Approval Status</span>
                    <span class="${apprClass(tk.approval?.decision||tk.approval_status)}">${escapeHtml(tk.approval?.decision||tk.approval_status)}</span></div>
                ${tk.approval?.decided_by?`<div class="td-approval-row"><span class="td-field-label">Decided By</span><span>${escapeHtml(tk.approval.decided_by)}</span></div>`:''}
                ${tk.approval?.rejection_note?`<div class="td-approval-row"><span class="td-field-label">Rejection Note</span><span class="td-rejection-note">${escapeHtml(tk.approval.rejection_note)}</span></div>`:''}
                <p class="td-approval-note">This request requires department head approval before proceeding with repairs or replacements.</p>
            </div>` : '';

        const consumableBlock = tk.category === 'Consumable' ? `
            <div class="td-section">
                <div class="td-section-title"><i class="fas fa-box-open"></i> Consumable Item Selection</div>
                <div class="td-field-group"><label class="td-field-label">Select Consumable Item</label>
                    <select class="td-select" id="tdConsItem"><option value="">Select an item…</option>${invOpts}</select></div>
                <div class="td-field-group"><label class="td-field-label">Quantity Needed</label>
                    <input type="number" class="td-input" id="tdConsQty" min="1" value="${tk.consumable_qty_needed||''}"></div>
                <div class="td-field-group"><label class="td-field-label">Department</label>
                    <select class="td-select" id="tdConsDept"><option value="">Select department…</option>${deptOpts}</select></div>
                <div class="td-info-note"><i class="fas fa-info-circle"></i> This consumable item will be allocated to the selected department upon request completion.</div>
            </div>` : '';

        const extRepairBlock = `
            <div class="td-section">
                <div class="td-section-title"><i class="fas fa-tools"></i> External Repair &amp; Maintenance</div>
                <label class="td-checkbox-label"><input type="checkbox" id="tdExtRepairChk" ${tk.external_repair?'checked':''}>
                    <span>Equipment requires external repair/maintenance</span></label>
                <div class="td-repair-costs" id="tdRepairCosts" style="display:${tk.external_repair?'block':'none'};">
                    <div class="td-cost-grid">
                        <div class="td-cost-field"><label class="td-field-label">External Repair Service (₱)</label>
                            <input type="number" class="td-input" id="tdSvcCost" min="0" step="0.01" value="${tk.repair_service_cost||''}"></div>
                        <div class="td-cost-field"><label class="td-field-label">Replacement Parts (₱)</label>
                            <input type="number" class="td-input" id="tdPartsCost" min="0" step="0.01" value="${tk.repair_parts_cost||''}"></div>
                        <div class="td-cost-field"><label class="td-field-label">Service Fee (₱)</label>
                            <input type="number" class="td-input" id="tdSvcFee" min="0" step="0.01" value="${tk.repair_service_fee||''}"></div>
                        <div class="td-cost-field"><label class="td-field-label">Total Maintenance Cost</label>
                            <input type="text" class="td-input td-input-readonly" id="tdRepTotal" readonly
                                value="${tk.repair_total_cost?'₱'+parseFloat(tk.repair_total_cost).toFixed(2):'₱0.00'}"></div>
                    </div>
                    <div class="td-cost-field" style="margin-top:12px;"><label class="td-field-label">Remarks</label>
                        <textarea class="td-input td-textarea" id="tdRepRemarks">${escapeHtml(tk.repair_remarks||'')}</textarea></div>
                </div>
            </div>`;

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
                <div class="td-section-title">Request Information</div>
                <div class="td-field-row"><span class="td-field-label">Ticket ID</span><span class="td-ticket-code">${escapeHtml(tk.ticket_code)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Category</span><span class="td-field-val">${escapeHtml(tk.category)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Requester</span><span class="td-field-val">${escapeHtml(tk.requester_name)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Department</span><span class="td-field-val">${escapeHtml(tk.department_name)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Equipment</span><span class="td-field-val">${escapeHtml(tk.equipment_item)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Priority</span><span class="td-field-val">${escapeHtml(tk.priority)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Status</span><span class="${statusClass(tk.status)}">${escapeHtml(tk.status)}</span></div>
            </div>
            <div class="td-section">
                <div class="td-section-title">Timeline</div>
                <div class="td-field-row"><span class="td-field-label">Date Created</span><span class="td-field-val">${fmtDate(tk.submitted_at)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Date Completed</span><span class="td-field-val">${fmtDate(tk.completed_at)}</span></div>
                <div class="td-field-row"><span class="td-field-label">Duration</span><span class="td-field-val">${escapeHtml(tk.duration_text)}</span></div>
            </div>
            <div class="td-section td-sla-section">
                <div class="td-section-title"><i class="fas fa-clock"></i> Service Level Agreement (SLA)</div>
                <div class="td-field-row">
                    <span class="td-field-label">Expected Resolution Time</span>
                    <span class="td-field-val" id="tdSlaDisplayText">
                        ${tk.sla_custom_hours?tk.sla_custom_hours+' hour(s)':tk.sla_resolution_hours?tk.sla_resolution_hours+' hour(s)':'—'}
                        <button class="td-edit-sla-btn" id="tdEditSlaBtn"><i class="fas fa-pencil-alt"></i> Edit SLA</button>
                    </span>
                </div>
                <div class="td-sla-edit" id="tdSlaEditRow" style="display:none;">
                    <input type="number" class="td-input td-input-sm" id="tdSlaHoursInput" min="0.5" step="0.5" value="${tk.sla_custom_hours||tk.sla_resolution_hours||''}">
                    <span style="margin:0 4px;font-size:0.78rem;color:#6c86a0;">hour(s)</span>
                    <button class="td-btn-sla-save" id="tdSlaSaveBtn">Apply</button>
                    <button class="td-btn-sla-cancel" id="tdSlaCancelBtn">Cancel</button>
                </div>
                <div class="td-field-row"><span class="td-field-label">SLA Deadline</span><span class="td-field-val">${fmtDT(tk.resolution_due_at)}</span></div>
            </div>
            ${approvalBlock}
          </div>
          <div class="td-col-right">
            <div class="td-section">
                <div class="td-section-title">Issue Details</div>
                <div class="td-field-group"><span class="td-field-label">Title</span><p class="td-issue-title">${escapeHtml(tk.title)}</p></div>
                <div class="td-field-group"><span class="td-field-label">Issue Description</span><p class="td-issue-desc">${escapeHtml(tk.description||'No description.')}</p></div>
            </div>
            <div class="td-section">
                <div class="td-section-title">Assignment &amp; Actions</div>
                <div class="td-field-row"><span class="td-field-label">Assigned IT Officer</span>
                    <span class="td-field-val ${!tk.assigned_to?'td-warn-text':''}">${tk.assigned_to?escapeHtml(tk.assigned_to):'<i class="fas fa-exclamation-triangle"></i> Awaiting assigned IT Officer'}</span></div>
                <div class="td-field-group" style="margin-top:12px;"><label class="td-field-label">Update Status</label>
                    <select class="td-select" id="tdStatusSelect">
                        <option value="Pending" ${tk.status==='Pending'?'selected':''}>Pending</option>
                        <option value="Ongoing" ${tk.status==='Ongoing'?'selected':''}>Ongoing</option>
                    </select></div>
                <div class="td-field-group" style="margin-top:12px;"><label class="td-field-label">Assign IT Officer</label>
                    <select class="td-select" id="tdAssignSelect"><option value="">Select an item…</option>${officerOpts}</select></div>
                ${tk.status==='Ongoing'?`<button class="td-btn-complete" id="tdMarkCompleteBtn"
                    data-dbid="${tk.id}" data-code="${escapeHtml(tk.ticket_code)}"
                    data-requester="${escapeHtml(tk.requester_name)}" data-issue="${escapeHtml(tk.title)}">
                    <i class="fas fa-check"></i> Mark as Completed</button>`:''}
            </div>
            ${extRepairBlock}
            ${consumableBlock}
            <div class="td-section">
                <div class="td-section-title"><i class="fas fa-comments"></i> Conversation &amp; Follow-ups</div>
                <div class="td-conv-thread">${convHtml}</div>
                <div class="td-reply-area">
                    <div class="td-field-label">Add Reply / Update</div>
                    <textarea class="td-textarea td-reply-input" id="tdReplyInput" placeholder="Type your reply or update here…"></textarea>
                    <button class="td-btn-reply" id="tdSendReplyBtn"><i class="fas fa-paper-plane"></i> Send Reply</button>
                </div>
            </div>
          </div>
        </div>
        <div class="td-footer">
            <button class="td-btn-save" id="tdSaveChangesBtn" data-dbid="${tk.id}"><i class="fas fa-save"></i> Save Changes</button>
            <button class="td-btn-cancel" id="tdCancelBtn"><i class="fas fa-times"></i> Close</button>
        </div>`;

        document.getElementById('tdCancelBtn')?.addEventListener('click', _closeDetailOverlay);
        document.getElementById('tdExtRepairChk')?.addEventListener('change', e => {
            document.getElementById('tdRepairCosts').style.display = e.target.checked ? 'block' : 'none';
        });
        ['tdSvcCost','tdPartsCost','tdSvcFee'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                const tot = document.getElementById('tdRepTotal');
                if (tot) tot.value = '₱' + (['tdSvcCost','tdPartsCost','tdSvcFee'].reduce((s,i)=>s+(parseFloat(document.getElementById(i)?.value)||0),0)).toFixed(2);
            });
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

        // ── Mark as Completed → show confirmation modal then close overlay ────
        document.getElementById('tdMarkCompleteBtn')?.addEventListener('click', e => {
            const btn = e.currentTarget;
            document.getElementById('cmTicketId').textContent  = '#' + btn.dataset.code;
            document.getElementById('cmRequester').textContent = btn.dataset.requester;
            document.getElementById('cmIssue').textContent     = btn.dataset.issue;
            const sendBtn = document.getElementById('btnSendConfirmation');
            sendBtn.dataset.dbId    = btn.dataset.dbid;
            sendBtn.dataset.display = '#' + btn.dataset.code;
            _closeDetailOverlay();                           // close detail first
            document.getElementById('completionModal').style.display = 'flex';
        });

        document.getElementById('tdSaveChangesBtn')?.addEventListener('click', () => _saveDetail(tk.id, cu));
        document.getElementById('tdSendReplyBtn')?.addEventListener('click', () => _sendReply(tk.id, cu));
    }

    async function _saveDetail(ticketId, cu) {
        const payload = {
            ticket_id: ticketId, admin_id: cu.id, admin_name: cu.name||'IT Admin',
            status:              document.getElementById('tdStatusSelect')?.value,
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
            if (json.success) { showToast('Changes saved.', 'success'); loadTicketsFromDB(); _closeDetailOverlay(); }
            else showToast('Save failed: ' + json.message, 'error');
        } catch { showToast('Network error.', 'error'); }
    }

    async function _sendReply(ticketId, cu) {
        const reply = document.getElementById('tdReplyInput')?.value.trim();
        if (!reply) { showToast('Please type a reply first.', 'warning'); return; }
        try {
            const res  = await fetch('../api/save_ticket_detail.php', {method:'POST',headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ticket_id:ticketId, admin_id:cu.id, admin_name:cu.name||'IT Admin', reply})});
            const json = await res.json();
            if (json.success) {
                document.getElementById('tdReplyInput').value = '';
                showToast('Reply sent.', 'success');
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

})();