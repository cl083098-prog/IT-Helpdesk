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
        loadTicketsFromDB();     // fetches live data from PHP/MySQL
        initFilters();
        initBulkActions();
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
                id:         '#' + t.ticket_code,
                dbId:       t.id,
                category:   t.category,
                requester:  t.requester,
                department: t.department,
                equipment:  t.equipment_item,
                assigned:   t.assigned_to,
                title:      t.title,
                priority:   t.priority,
                status:     t.status,
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
                t.id.toLowerCase().includes(term)         ||
                t.requester.toLowerCase().includes(term)  ||
                t.equipment.toLowerCase().includes(term)  ||
                t.title.toLowerCase().includes(term)
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

        tbody.innerHTML = filtered.map(ticket => {
            const priorityClass = getPriorityClass(ticket.priority);
            const statusClass   = `status-${ticket.status.toLowerCase()}`;
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
                    <td class="assigned-text">${escapeHtml(ticket.assigned)}</td>
                    <td>${escapeHtml(ticket.title)}</td>
                    <td><span class="priority-badge ${priorityClass}">${escapeHtml(ticket.priority)}</span></td>
                    <td><span class="status-badge ${statusClass}">${escapeHtml(ticket.status)}</span></td>
                    <td class="action-icons">
                        <i class="fas fa-edit   edit-ticket-icon"   title="Edit"   data-id="${escapeHtml(ticket.id)}"></i>
                        <i class="fas fa-eye    view-ticket-icon"   title="View"   data-id="${escapeHtml(ticket.id)}"></i>
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
        const newStatus = prompt(`Update status for ${count} selected ticket(s):\n\nEnter: Pending / Ongoing / Completed / Closed`, 'Ongoing');
        if (newStatus === null) return;
        if (!['Pending', 'Ongoing', 'Completed', 'Closed'].includes(newStatus)) {
            showToast('Invalid status. Must be Pending, Ongoing, Completed, or Closed.', 'error');
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
                const editIcon   = e.target.closest('.edit-ticket-icon');
                const viewIcon   = e.target.closest('.view-ticket-icon');
                const deleteIcon = e.target.closest('.delete-ticket-icon');
                const viewLink   = e.target.closest('.view-ticket-link');
                if (editIcon)   { e.preventDefault(); editTicket(editIcon.dataset.id); }
                else if (viewIcon)   { e.preventDefault(); viewTicket(viewIcon.dataset.id); }
                else if (deleteIcon) { e.preventDefault(); deleteTicket(deleteIcon.dataset.id); }
                else if (viewLink)   { e.preventDefault(); viewTicket(viewLink.dataset.id); }
            });
        }
    }

    // ─── Individual Ticket Actions ────────────────────────────────────────────

    function viewTicket(ticketId) {
        const t = ticketsData.find(t => t.id === ticketId);
        if (t) alert(`\ud83d\udccb Ticket Details\n\nID: ${t.id}\nTitle: ${t.title}\nRequester: ${t.requester}\nDepartment: ${t.department}\nEquipment: ${t.equipment}\nPriority: ${t.priority}\nStatus: ${t.status}\nAssigned To: ${t.assigned}`);
    }

    function editTicket(ticketId) {
        const ticket = ticketsData.find(t => t.id === ticketId);
        if (!ticket) return;
        const newStatus = prompt(`Edit status for ${ticket.id}\nCurrent: ${ticket.status}\n\nEnter: Pending / Ongoing / Completed / Closed`, ticket.status);
        if (newStatus === null) return;
        if (!['Pending', 'Ongoing', 'Completed', 'Closed'].includes(newStatus)) {
            showToast('Invalid status entered.', 'error');
            return;
        }
        updateTicketStatusInDB(ticket.dbId, ticket.id, newStatus);
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
                z-index: 2200;
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