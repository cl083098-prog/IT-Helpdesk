// RequesterDashboard.js – PHP/MySQL Backend Version

(function () {
    'use strict';

    // ─── Config ──────────────────────────────────────────────────────────────
    const API_BASE = '../api';   // PHP api/ folder, one level up from helpdesktry/

    // ─── Constants ───────────────────────────────────────────────────────────
    const TICKET_STATUS = { PENDING: 'PENDING', ONGOING: 'ONGOING', COMPLETED: 'COMPLETED' };
    const PRIORITY      = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };
    const ACTIVITY_TYPES = {
        TICKET_CREATED:       'ticket_created',
        STATUS_CHANGED:       'status_changed',
        FOLLOWUP_ADDED:       'followup_added',
        TECHNICIAN_ASSIGNED:  'technician_assigned',
        APPROVAL_REQUESTED:   'approval_requested'
    };

    // ─── Auth ────────────────────────────────────────────────────────────────
    let currentUser = null;

    (function checkRequesterAuth() {
        const raw = sessionStorage.getItem('currentUser');
        if (!raw) { window.location.replace('Login.html'); return; }
        try {
            currentUser = JSON.parse(raw);
        } catch (e) {
            sessionStorage.removeItem('currentUser');
            window.location.replace('Login.html');
            return;
        }
        if (currentUser.role !== 'requester') {
            window.location.replace('Dashboard.html');
        }
    })();

    const USER_ID = currentUser ? (currentUser.id || currentUser.user_id) : null;

    // ─── State ───────────────────────────────────────────────────────────────
    let isInitialized    = false;
    let currentFilter    = 'all';
    let requesterTickets = [];
    let activitiesFeed   = [];
    let notifications    = [];

    // ─── SLA state (updated by updateSLAPreview) ──────────────────────────────
    let _currentSLA = { priority: 'Low', response_hours: 8, resolution_hours: 48 };

    // ─── PHP API helper ───────────────────────────────────────────────────────
    async function apiFetch(path, options = {}) {
        try {
            const res = await fetch(`${API_BASE}${path}`, {
                headers: { 'Content-Type': 'application/json' },
                ...options
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
            return json;
        } catch (err) {
            console.error('API error:', err.message);
            return null;
        }
    }

    // ─── Data loaders (PHP backend) ───────────────────────────────────────────

    async function loadTickets() {
        const json = await apiFetch(`/get_my_tickets.php?requester_id=${USER_ID}`);
        if (json && json.success && json.data) {
            requesterTickets = json.data.map(t => ({
                id:            t.ticket_code,
                request_id:    t.id,
                title:         t.title,
                priority:      t.priority,
                status:        t.status,
                date:          t.submitted_at ? t.submitted_at.slice(0, 10) : '',
                requester:     currentUser.name || 'Requester',
                category:      t.category,
                department:    t.department,
                equipmentItem: t.equipment_item,
                requestType:   t.request_type,
                location:      t.location || '',
                description:   t.description || '',
                conversations: (t.conversations || []).map(c => ({
                    author_name:  c.author_name,
                    message_text: c.message,
                    created_at:   c.created_at,
                    isRequester:  !!c.is_requester
                }))
            }));
        } else {
            requesterTickets = [];
        }
    }

    async function loadActivities() {
        // Built from ticket data — no separate PHP endpoint needed
        activitiesFeed = requesterTickets.slice(0, 10).map(t => ({
            id:          t.request_id,
            type:        ACTIVITY_TYPES.TICKET_CREATED,
            title:       `Request ${t.id} — ${t.status}`,
            description: t.title,
            time:        formatRelativeTime(t.date),
            ticketId:    t.id,
            priority:    t.priority,
            status:      t.status
        }));
    }

    async function loadNotifications() {
        // Built from recent tickets — no separate PHP endpoint needed
        notifications = requesterTickets.slice(0, 5).map(t => ({
            id:      t.request_id,
            title:   `Ticket ${t.id}`,
            message: `"${t.title}" is ${t.status}`,
            time:    formatDate(t.date),
            icon:    'fa-ticket-alt',
            read:    false
        }));
    }

    async function loadStats() {
        const total     = requesterTickets.length;
        const pending   = requesterTickets.filter(t => t.status === 'Pending').length;
        const ongoing   = requesterTickets.filter(t => t.status === 'Ongoing').length;
        const completed = requesterTickets.filter(t => t.status === 'Completed').length;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('totalRequests',  total);
        set('pendingCount',   pending);
        set('ongoingCount',   ongoing);
        set('completedCount', completed);
    }

    async function loadDepartments() {
        const json = await apiFetch('/get_departments.php');
        if (!json || !json.success) return;
        const select = document.getElementById('department');
        if (!select) return;
        select.innerHTML = '<option value="">Select department</option>';
        json.data.forEach(dept => {
            const opt       = document.createElement('option');
            opt.value       = dept.id;        // numeric DB id — sent as department_id
            opt.textContent = dept.name;
            select.appendChild(opt);
        });
    }

    // ─── SLA auto-preview ─────────────────────────────────────────────────────
    async function updateSLAPreview() {
        const category  = document.getElementById('category')?.value   || '';
        const reqType   = document.getElementById('requestType')?.value || '';
        const equipment = document.getElementById('equipmentItem')?.value || '';
        const display   = document.getElementById('priorityDisplay');

        if (!category || !reqType) {
            _currentSLA = { priority: 'Low', response_hours: 8, resolution_hours: 48 };
            if (display) { display.innerText = 'Low'; display.className = 'priority-badge-large low'; }
            return;
        }

        const json = await apiFetch('/get_sla.php', {
            method: 'POST',
            body:   JSON.stringify({ category, request_type: reqType, equipment })
        });

        if (json && json.success) {
            _currentSLA = json.sla;
            if (display) {
                display.innerText = json.sla.priority;
                display.className = `priority-badge-large ${json.sla.priority.toLowerCase()}`;
            }
        }
    }

    // Keep calculatePriority so existing event listeners still work
    function calculatePriority() {
        updateSLAPreview();
        return _currentSLA.priority;
    }

    // ─── Submit new request ───────────────────────────────────────────────────
    async function handleFormSubmit(e) {
        e.preventDefault();
        const category    = document.getElementById('category')?.value    || '';
        const department  = document.getElementById('department')?.value  || '';
        const equipItem   = document.getElementById('equipmentItem')?.value.trim() || '';
        const requestType = document.getElementById('requestType')?.value || '';
        const title       = document.getElementById('requestTitle')?.value.trim() || '';
        const description = document.getElementById('description')?.value.trim() || '';
        const location    = document.getElementById('location')?.value.trim() || '';
        const prefDate    = document.getElementById('preferredDate')?.value || null;

        if (!category)    { showToast('Please select a category.',        true); return; }
        if (!department)  { showToast('Please select a department.',      true); return; }
        if (!equipItem)   { showToast('Please enter an equipment/item.',  true); return; }
        if (!requestType) { showToast('Please select a request type.',    true); return; }
        if (!title)       { showToast('Please enter a request title.',    true); return; }

        const payload = {
            requester_id:   USER_ID,
            requester_name: currentUser.name || 'Requester',
            department_id:  department,        // numeric id from loadDepartments()
            title,
            description,
            category,
            request_type:   requestType,
            equipment_item: equipItem,
            location,
            preferred_date: prefDate
        };

        const data = await apiFetch('/submit_ticket.php', {
            method: 'POST',
            body:   JSON.stringify(payload)
        });

        if (!data || !data.success) {
            showToast('Submission failed: ' + (data?.message || 'Unknown error'), true);
            return;
        }

        const deptSelect = document.getElementById('department');
        const deptName   = deptSelect?.options[deptSelect.selectedIndex]?.text || department;
        closeRequestModal();
        showConfirmationModal(data.ticket_code, title, data.priority, deptName);
        showToast(`✓ Request ${data.ticket_code} submitted successfully!`);
        await refreshAllData();
    }

    // ─── Follow-up ────────────────────────────────────────────────────────────
    async function addFollowUp(requestId, ticketNumber) {
        const messageInput = document.getElementById('followUpMessage');
        const message      = messageInput?.value.trim();
        if (!message) { showToast('Please enter a message before sending.', true); return; }

        const data = await apiFetch('/add_followup.php', {
            method: 'POST',
            body:   JSON.stringify({
                ticket_id:   requestId,
                author_id:   USER_ID,
                author_name: currentUser.name || 'Requester',
                message
            })
        });

        if (!data || !data.success) {
            showToast('Could not send follow-up.', true);
            return;
        }

        showToast(`Follow-up added to #${ticketNumber}`);
        messageInput.value = '';

        // Reload tickets then re-open detail to refresh conversation thread
        await loadTickets();
        await showRequestDetail(requestId);
        await loadActivities();
        renderActivityTimeline();
    }

    // ─── Notifications (local only — no separate PHP endpoint) ────────────────
    async function markAllNotificationsRead() {
        notifications.forEach(n => n.read = true);
        renderNotifications();
        showToast('All notifications marked as read.');
    }

    // ─── Full UI refresh ──────────────────────────────────────────────────────
    async function refreshAllData() {
        await loadTickets();
        await Promise.all([loadActivities(), loadStats()]);
        renderTicketsPanel();
        renderActivityTimeline();
        const fullListModal = document.getElementById('fullListModal');
        if (fullListModal && fullListModal.classList.contains('active')) {
            renderFilteredTicketsInModal();
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────
    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        try { return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
        catch (e) { return dateStr; }
    }

    function formatRelativeTime(dateStr) {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1)   return 'Just now';
        if (mins < 60)  return `${mins} minute${mins > 1 ? 's' : ''} ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24)   return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7)   return `${days} day${days > 1 ? 's' : ''} ago`;
        return formatDate(dateStr);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function getIconForActivityType(type) {
        const icons = {
            ticket_created:      'fa-file-alt',
            status_changed:      'fa-exchange-alt',
            followup_added:      'fa-comment',
            technician_assigned: 'fa-user-cog',
            approval_requested:  'fa-clipboard-list'
        };
        return icons[type] || 'fa-bell';
    }

    function getPriorityClass(priority) {
        const p = (priority || '').toLowerCase();
        if (p === 'critical') return 'priority-critical';
        if (p === 'high')     return 'priority-high';
        if (p === 'medium')   return 'priority-medium';
        return 'priority-low';
    }

    function getPriorityBadgeClass(priority) {
        const p = (priority || '').toLowerCase();
        if (p === 'critical') return 'critical';
        if (p === 'high')     return 'high';
        if (p === 'medium')   return 'medium';
        return 'low';
    }

    function getStatusClass(status) {
        const s = (status || '').toLowerCase();
        if (s === 'pending')   return 'status-pending';
        if (s === 'ongoing')   return 'status-ongoing';
        return 'status-completed';
    }

    function showToast(message, isError = false) {
        const toast = document.getElementById('toastMsg');
        if (!toast) return;
        toast.innerText = message;
        toast.style.background = isError ? '#c62828' : '#2c4c6e';
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
    }

    // ─── Render: tickets panel (recent 4) ────────────────────────────────────
    function renderTicketsPanel() {
        const container = document.getElementById('myTicketsList');
        if (!container) return;

        if (requesterTickets.length === 0) {
            container.innerHTML = '<div style="padding:24px;text-align:center;color:#8aaec0;">No requests yet. Create one!</div>';
            return;
        }

        const sorted = [...requesterTickets].sort((a, b) => new Date(b.date) - new Date(a.date));
        const recent = sorted.slice(0, 4);

        container.innerHTML = recent.map(t => `
            <div class="ticket-item ${getPriorityClass(t.priority)}" data-ticket-id="${escapeHtml(t.id)}" data-request-id="${t.request_id}">
                <div class="ticket-id">#${escapeHtml(t.id)}<span class="priority-badge ${getPriorityBadgeClass(t.priority)}">${escapeHtml(t.priority)}</span></div>
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-meta">Status: ${escapeHtml(t.status)} · ${formatDate(t.date)}</div>
            </div>`).join('');

        container.querySelectorAll('.ticket-item[data-request-id]').forEach(el => {
            el.addEventListener('click', () => showRequestDetail(Number(el.dataset.requestId)));
        });
    }

    // ─── Render: activity timeline ────────────────────────────────────────────
    function renderActivityTimeline() {
        const container = document.getElementById('activitiesFeed');
        if (!container) return;

        if (activitiesFeed.length === 0) {
            container.innerHTML = `
                <div class="activities-empty">
                    <i class="fas fa-calendar-alt"></i>
                    <p>No recent activities</p>
                    <p style="font-size:0.75rem;margin-top:8px;">Activities appear as you interact with the system.</p>
                </div>`;
            return;
        }

        container.innerHTML = activitiesFeed.map(activity => `
            <div class="timeline-item" data-priority="${(activity.priority || 'low').toLowerCase()}">
                <div class="timeline-icon">
                    <i class="fas ${getIconForActivityType(activity.type)}"></i>
                </div>
                <div class="timeline-content">
                    <div class="timeline-header">
                        <span class="timeline-title">${escapeHtml(activity.title)}</span>
                        <span class="timeline-date">${escapeHtml(activity.time)}</span>
                    </div>
                    <div class="timeline-description">${escapeHtml(activity.description || '')}</div>
                    ${activity.status ? `<div class="timeline-badge ${getStatusClass(activity.status)}">${escapeHtml(activity.status)}</div>` : ''}
                </div>
                <div class="timeline-connector"></div>
            </div>
        `).join('');
    }

    // ─── Render: notifications ────────────────────────────────────────────────
    function renderNotifications() {
        const container = document.getElementById('notificationList');
        const badge     = document.getElementById('notificationBadge');
        const unread    = notifications.filter(n => !n.read).length;

        if (badge) {
            badge.innerText = unread;
            badge.style.display = unread > 0 ? 'inline-block' : 'none';
        }

        if (!container) return;
        if (notifications.length === 0) {
            container.innerHTML = '<div style="padding:40px;text-align:center;color:#8aa5bf;">No notifications</div>';
            return;
        }

        container.innerHTML = notifications.map(n => `
            <div class="notification-item ${!n.read ? 'unread' : ''}" data-id="${n.id}">
                <div class="notification-icon-small"><i class="fas ${n.icon || 'fa-bell'}"></i></div>
                <div class="notification-content">
                    <p><strong>${escapeHtml(n.title)}</strong><br>${escapeHtml(n.message)}</p>
                    <small>${escapeHtml(n.time)}</small>
                </div>
            </div>`).join('');

        container.querySelectorAll('.notification-item').forEach(el => {
            el.addEventListener('click', () => {
                const id    = Number(el.dataset.id);
                const notif = notifications.find(n => Number(n.id) === id);
                if (notif && !notif.read) {
                    notif.read = true;
                    renderNotifications();
                }
            });
        });
    }

    // ─── Detail modal ─────────────────────────────────────────────────────────
    async function showRequestDetail(requestId) {
        const modal     = document.getElementById('requestDetailModal');
        const modalBody = document.getElementById('detailModalBody');
        if (!modal || !modalBody) return;

        modalBody.innerHTML = '<div style="padding:40px;text-align:center;color:#8aa5bf;">Loading…</div>';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Find from local array — type-safe comparison
        const ticket = requesterTickets.find(t => Number(t.request_id) === Number(requestId)) || null;
        if (!ticket) {
            modalBody.innerHTML = '<div style="padding:40px;text-align:center;color:#c62828;">Could not load request details.</div>';
            return;
        }

        const slaDeadline = (ticket.priority === 'High' || ticket.priority === 'Critical')
            ? new Date(new Date(ticket.date).getTime() + 30 * 60000).toLocaleString()
            : 'Within 2 business days';

        const conversationsHtml = ticket.conversations && ticket.conversations.length > 0
            ? ticket.conversations.map(msg => `
                <div class="conversation-message">
                    <div class="message-author">
                        <strong class="author-name">${escapeHtml(msg.author_name)}</strong>
                        <span class="message-timestamp">${escapeHtml(formatDate(msg.created_at))}</span>
                    </div>
                    <div class="message-text">${escapeHtml(msg.message_text)}</div>
                </div>
            `).join('')
            : '<div style="text-align:center;padding:20px;color:#8aa5bf;">No messages yet.</div>';

        modalBody.innerHTML = `
            <div class="request-detail-card">
                <div class="request-header">
                    <h2 class="request-title">#${escapeHtml(ticket.id)}: ${escapeHtml(ticket.title)}</h2>
                    <span class="status-badge ${getStatusClass(ticket.status)}">${escapeHtml(ticket.status)}</span>
                </div>
                <div class="info-grid">
                    <div class="info-item"><span class="info-label"><i class="fas fa-calendar"></i> Submitted</span><span class="info-value">${formatDate(ticket.date)}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-chart-line"></i> Priority</span><span class="info-value">${escapeHtml(ticket.priority)}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-tag"></i> Category</span><span class="info-value">${escapeHtml(ticket.category || 'N/A')}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-building"></i> Department</span><span class="info-value">${escapeHtml(ticket.department || 'N/A')}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-desktop"></i> Equipment/Item</span><span class="info-value">${escapeHtml(ticket.equipmentItem || 'N/A')}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-map-marker-alt"></i> Location</span><span class="info-value">${escapeHtml(ticket.location || 'Not specified')}</span></div>
                </div>
                <div class="info-item" style="margin-bottom:20px;">
                    <span class="info-label"><i class="fas fa-align-left"></i> Issue Description</span>
                    <span class="info-value">${escapeHtml(ticket.description || 'No description provided.')}</span>
                </div>
                <div class="sla-card">
                    <div class="sla-row"><span class="sla-label"><i class="fas fa-hourglass-half"></i> Expected Resolution Time</span><span class="sla-value">${(ticket.priority === 'High' || ticket.priority === 'Critical') ? '30 minutes' : '2 business days'}</span></div>
                    <div class="sla-row"><span class="sla-label"><i class="fas fa-clock"></i> SLA Deadline</span><span class="sla-value">${slaDeadline}</span></div>
                </div>
                ${ticket.category === 'Consumable' ? `
                <div class="approval-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <div><strong>Approval Required:</strong> This request requires Department Head approval.</div>
                </div>` : ''}
            </div>
            <div class="follow-up-section">
                <h4 style="margin-bottom:16px;color:#1a4a6e;"><i class="fas fa-comments"></i> Conversation & Updates</h4>
                <div class="conversation-thread" id="conversationThread">${conversationsHtml}</div>
                <div class="follow-up-input">
                    <textarea id="followUpMessage" rows="2" placeholder="Add additional information or ask a question…"></textarea>
                    <button class="send-followup-btn" id="sendFollowUpBtn" data-request-id="${ticket.request_id}"><i class="fas fa-paper-plane"></i> Send</button>
                </div>
            </div>`;

        document.getElementById('sendFollowUpBtn')?.addEventListener('click', () => addFollowUp(ticket.request_id, ticket.id));
    }

    // ─── Full list modal ──────────────────────────────────────────────────────
    function renderFilteredTicketsInModal() {
        const gridContainer   = document.getElementById('allTicketsGrid');
        const resultsCountSpan = document.getElementById('resultsCount');
        if (!gridContainer) return;

        let filtered = [...requesterTickets];
        if (currentFilter !== 'all') {
            filtered = filtered.filter(t => t.status === currentFilter);
        }
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (resultsCountSpan) resultsCountSpan.innerText = `${filtered.length} request${filtered.length !== 1 ? 's' : ''}`;

        if (filtered.length === 0) {
            gridContainer.innerHTML = '<div class="empty-state"><i class="fas fa-inbox" style="font-size:2rem;margin-bottom:12px;display:block;"></i>No requests match the selected filter.</div>';
            return;
        }

        gridContainer.innerHTML = filtered.map(t => `
            <div class="ticket-item ${getPriorityClass(t.priority)}" data-request-id="${t.request_id}" data-status="${t.status}">
                <div class="ticket-id">#${escapeHtml(t.id)}<span class="priority-badge ${getPriorityBadgeClass(t.priority)}">${escapeHtml(t.priority)}</span></div>
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-meta">Status: ${t.status} · ${formatDate(t.date)} · ${escapeHtml(t.department || 'N/A')}</div>
            </div>
        `).join('');

        gridContainer.querySelectorAll('.ticket-item').forEach(el => {
            el.addEventListener('click', () => {
                const reqId = Number(el.dataset.requestId);
                closeFullListModal();
                setTimeout(() => showRequestDetail(reqId), 200);
            });
        });
    }

    function setupFilterButtons() {
        document.querySelectorAll('#ticketFilterBar .filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                currentFilter = chip.dataset.filter;
                document.querySelectorAll('#ticketFilterBar .filter-chip').forEach(c => c.classList.remove('filter-chip-active'));
                chip.classList.add('filter-chip-active');
                renderFilteredTicketsInModal();
            });
        });
    }

    function openFullListModal() {
        const fullModal = document.getElementById('fullListModal');
        if (!fullModal) return;
        currentFilter = 'all';
        document.querySelectorAll('#ticketFilterBar .filter-chip').forEach(c => {
            c.classList.toggle('filter-chip-active', c.dataset.filter === 'all');
        });
        renderFilteredTicketsInModal();
        fullModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeFullListModal() {
        const fullModal = document.getElementById('fullListModal');
        if (fullModal) { fullModal.classList.remove('active'); document.body.style.overflow = ''; }
    }

    // ─── Modal helpers ────────────────────────────────────────────────────────
    function openRequestModal() {
        const modal = document.getElementById('newRequestModal');
        if (modal) { modal.classList.add('active'); document.body.style.overflow = 'hidden'; calculatePriority(); }
    }

    function closeRequestModal() {
        const modal = document.getElementById('newRequestModal');
        if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; document.getElementById('serviceRequestForm')?.reset(); calculatePriority(); }
    }

    function closeConfirmationModal() {
        const modal = document.getElementById('confirmationModal');
        if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; }
    }

    function closeDetailModal() {
        const modal = document.getElementById('requestDetailModal');
        if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; }
    }

    function showConfirmationModal(ticketId, title, priority, department) {
        const modal = document.getElementById('confirmationModal');
        if (!modal) return;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('confirmTicketId', ticketId);
        set('confirmTitle',    title);
        set('confirmPriority', priority);
        set('confirmDept',     department);
        set('confirmDate',     new Date().toLocaleString());
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    // ─── Profile dropdown & dark mode ─────────────────────────────────────────
    function initProfileDropdown() {
        const profileDropdown = document.getElementById('profileDropdown');
        const profileBtn      = document.getElementById('profileBtn');
        const themeSwitch     = document.getElementById('themeSwitchCheckbox');
        const logoutBtn       = document.getElementById('logoutBtn');

        if (profileBtn && profileDropdown) {
            profileBtn.addEventListener('click', e => { e.stopPropagation(); profileDropdown.classList.toggle('open'); });
            document.addEventListener('click', e => { if (!profileDropdown.contains(e.target)) profileDropdown.classList.remove('open'); });
        }

        if (themeSwitch) {
            const isDark = localStorage.getItem('theme') === 'dark';
            themeSwitch.checked = isDark;
            if (isDark) { document.body.classList.add('dark-mode'); const icon = document.getElementById('themeIcon'); if (icon) icon.className = 'fas fa-sun'; }
            themeSwitch.addEventListener('change', e => {
                const dark = e.target.checked;
                document.body.classList.toggle('dark-mode', dark);
                localStorage.setItem('theme', dark ? 'dark' : 'light');
                const icon = document.getElementById('themeIcon');
                if (icon) icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
                showToast(dark ? 'Dark mode activated.' : 'Light mode activated.');
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                showToast('Logging out…');
                setTimeout(() => { sessionStorage.removeItem('currentUser'); window.location.href = 'Login.html'; }, 800);
            });
        }
    }

    // ─── Wire all event listeners ─────────────────────────────────────────────
    function setupEventListeners() {
        document.getElementById('openNewRequestBtn')?.addEventListener('click', openRequestModal);
        document.getElementById('closeModalBtn')?.addEventListener('click',    closeRequestModal);
        document.getElementById('cancelFormBtn')?.addEventListener('click',    closeRequestModal);
        document.getElementById('newRequestModal')?.addEventListener('click', e => { if (e.target === document.getElementById('newRequestModal')) closeRequestModal(); });

        document.getElementById('serviceRequestForm')?.addEventListener('submit', handleFormSubmit);
        document.getElementById('category')?.addEventListener('change',    updateSLAPreview);
        document.getElementById('requestType')?.addEventListener('change', updateSLAPreview);
        document.getElementById('equipmentItem')?.addEventListener('input', updateSLAPreview);

        document.getElementById('modalDoneBtn')?.addEventListener('click',      closeConfirmationModal);
        document.getElementById('modalNewRequestBtn')?.addEventListener('click', () => { closeConfirmationModal(); openRequestModal(); });
        document.getElementById('confirmationModal')?.addEventListener('click', e => { if (e.target === document.getElementById('confirmationModal')) closeConfirmationModal(); });

        document.getElementById('closeDetailModalBtn')?.addEventListener('click', closeDetailModal);
        document.getElementById('requestDetailModal')?.addEventListener('click', e => { if (e.target === document.getElementById('requestDetailModal')) closeDetailModal(); });

        // Notifications
        const bell  = document.getElementById('notificationBell');
        const panel = document.getElementById('notificationPanel');
        const wrap  = document.getElementById('notificationWrapper');
        if (bell && panel) {
            bell.addEventListener('click', e => { e.stopPropagation(); panel.classList.toggle('open'); });
            document.addEventListener('click', e => { if (wrap && !wrap.contains(e.target)) panel.classList.remove('open'); });
        }
        document.getElementById('markAllReadBtn')?.addEventListener('click', markAllNotificationsRead);

        // View All tickets
        document.getElementById('viewAllTicketsLink')?.addEventListener('click', e => { e.preventDefault(); openFullListModal(); });
        document.getElementById('closeFullListBtn')?.addEventListener('click', closeFullListModal);
        document.getElementById('fullListModal')?.addEventListener('click', e => { if (e.target === document.getElementById('fullListModal')) closeFullListModal(); });

        // Escape key
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (document.getElementById('newRequestModal')?.classList.contains('active'))   closeRequestModal();
            if (document.getElementById('confirmationModal')?.classList.contains('active'))  closeConfirmationModal();
            if (document.getElementById('requestDetailModal')?.classList.contains('active')) closeDetailModal();
            if (document.getElementById('fullListModal')?.classList.contains('active'))      closeFullListModal();
            document.getElementById('notificationPanel')?.classList.remove('open');
            document.getElementById('profileDropdown')?.classList.remove('open');
        });
    }

    // ─── Initialise ───────────────────────────────────────────────────────────
    async function init() {
        if (isInitialized) return;
        isInitialized = true;

        initProfileDropdown();
        setupEventListeners();
        setupFilterButtons();

        // 1. Load departments into dropdown first
        await loadDepartments();

        // 2. Load tickets — activities & notifications are derived from ticket data
        showToast('Loading your dashboard…');
        await loadTickets();
        await Promise.all([loadActivities(), loadNotifications(), loadStats()]);

        renderTicketsPanel();
        renderActivityTimeline();
        renderNotifications();

        console.log('Requester Dashboard (PHP/MySQL backend) initialised.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();