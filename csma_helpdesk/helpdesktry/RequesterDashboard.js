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
    let _pendingAttachments = []; // v28: File objects queued for upload after submit

    // ─── My Requests tab filter ───────────────────────────────────────────────
    let myRequestsTabFilter = 'all';

    // ─── Resolve / Feedback state ─────────────────────────────────────────────
    let pendingResolveId    = null;
    let pendingFeedbackId   = null;
    let selectedStarRating  = 0;

    // ─── PHP API helper ───────────────────────────────────────────────────────
    async function apiFetch(path, options = {}) {
        try {
            const res = await fetch(`${API_BASE}${path}`, {
                headers: { 'Content-Type': 'application/json' },
                ...options
            });
            const json = await res.json();
            // FIX: don't discard the backend's real message on non-2xx responses.
            if (!res.ok) {
                console.error('API error:', json?.message || `HTTP ${res.status}`);
                return json ?? { success: false, message: `HTTP ${res.status}` };
            }
            return json;
        } catch (err) {
            console.error('API error:', err.message);
            return { success: false, message: 'Network error or invalid server response.' };
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
                approvalStatus: t.approval_status || 'Not Required',
                rejectionNote:  t.rejection_note || '',
                date:          t.submitted_at ? t.submitted_at.slice(0, 10) : '',
                requester:     currentUser.name || 'Requester',
                category:      t.category,
                department:    t.department,
                equipmentItem: t.equipment_item,
                requestType:   t.request_type,
                location:      t.location || '',
                description:   t.description || '',
                // SLA fields — MUST flow through untouched. If they get dropped
                // here the render code reads undefined and the SLA row goes
                // blank while IT Admin's edit never appears to propagate.
                sla_response_hours:   t.sla_response_hours,
                sla_resolution_hours: t.sla_resolution_hours,
                response_due_at:      t.response_due_at,
                resolution_due_at:    t.resolution_due_at,
                submitted_at:         t.submitted_at,
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
        // v11: Read from the notifications table (via ../api/notifications.php),
        // not from local requesterTickets. The old code hard-coded `read:false`
        // on every notification and re-created the array on every page load —
        // that's why every login made everything unread again.
        try {
            const res  = await fetch(`../api/notifications.php?action=get&user_id=${currentUser.id}&user_role=requester`);
            const json = await res.json();
            if (json.success) {
                notifications = (json.data || []).map(n => ({
                    id:      n.id,
                    title:   n.title,
                    message: n.description || '',
                    time:    n.created_at,
                    icon:    ({
                        'ticket_submitted':    'fa-paper-plane',
                        'approval_needed':     'fa-clipboard-check',
                        'approval_approved':   'fa-circle-check',
                        'approval_rejected':   'fa-circle-xmark',
                        'status_change':       'fa-sync-alt',
                        'confirmation_needed': 'fa-user-check',
                        'sla_change':          'fa-clock',
                        'assigned':            'fa-user-plus',
                        'reply':               'fa-reply',
                        'ticket_closed':       'fa-check-circle',
                        'ticket_reopened':     'fa-undo',
                    }[n.event_type] || 'fa-bell'),
                    read:    !!parseInt(n.is_read, 10)
                }));
                return;
            }
        } catch (e) { /* fall through to fallback */ }

        // Fallback (shows nothing if the endpoint is unavailable)
        notifications = [];
    }

    async function loadStats() {
        const total     = requesterTickets.length;
        const pending   = requesterTickets.filter(t => t.status === 'Pending').length;
        const ongoing   = requesterTickets.filter(t => t.status === 'Ongoing').length;
        const completed = requesterTickets.filter(t => t.status === 'Completed').length;
        const closed    = requesterTickets.filter(t => t.status === 'Closed').length;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('totalRequests',  total);
        set('pendingCount',   pending);
        set('ongoingCount',   ongoing);
        set('completedCount', completed);
        set('closedCount',    closed);
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

        // v25: match by numeric department_id first (most reliable —
        // survives renames, whitespace differences, case changes).
        // Fall back to text-name match for older session data that
        // predates login.php returning department_id.
        // If both fail, unlock the field so the user can still pick.
        const myId   = currentUser?.department_id ? String(currentUser.department_id) : '';
        const myName = (currentUser?.department || '').trim().toLowerCase();
        let matched  = false;

        if (myId) {
            const optById = Array.from(select.options).find(o => o.value === myId);
            if (optById) { select.value = optById.value; matched = true; }
        }
        if (!matched && myName) {
            const optByName = Array.from(select.options).find(o =>
                o.textContent.trim().toLowerCase() === myName
            );
            if (optByName) { select.value = optByName.value; matched = true; }
        }

        if (matched) {
            select.setAttribute('disabled', 'disabled');
            select.setAttribute('title', 'Auto-filled from your user profile');
        } else {
            select.removeAttribute('disabled');
            select.setAttribute('title', currentUser?.department
                ? "Your profile department \u201C" + currentUser.department + "\u201D wasn't found — please pick one"
                : 'Please pick a department');
        }
    }

    // ─── v15: Category-driven request-type + inventory-item dropdowns ─────────
    const REQUEST_TYPES_BY_CATEGORY = {
        'Equipment':      ['Hardware Issue', 'Maintenance', 'Installation', 'Replacement'],
        'Consumable':     ['Replenishment', 'Refill'],
        'Network':        ['Network Issue'],
        'Other':          ['General Request']
    };

    function updateRequestTypesForCategory(category) {
        const sel = document.getElementById('requestType');
        if (!sel) return;
        const types = REQUEST_TYPES_BY_CATEGORY[category] || [];
        sel.innerHTML = '<option value="">' + (types.length ? 'Select type' : 'Select category first') + '</option>';
        types.forEach(t => {
            const opt       = document.createElement('option');
            opt.value       = t;
            opt.textContent = t;
            sel.appendChild(opt);
        });
    }

    async function updateEquipmentItemsForCategory(category) {
        const selectEl = document.getElementById('equipmentItemSelect');
        const inputEl  = document.getElementById('equipmentItem');
        if (!selectEl || !inputEl) return;

        // Only Equipment / Consumable draw from inventory. Other categories
        // keep the free-text input (there's no catalogue for software titles etc.).
        if (category !== 'Equipment' && category !== 'Consumable') {
            selectEl.style.display = 'none';
            inputEl.style.display  = '';
            inputEl.value          = '';
            selectEl.innerHTML     = '<option value="">Select item</option>';
            return;
        }

        selectEl.style.display = '';
        inputEl.style.display  = 'none';
        inputEl.value          = '';
        selectEl.innerHTML     = '<option value="">Loading items…</option>';

        try {
            const res  = await fetch('../api/get_inventory_items.php?category=' + encodeURIComponent(category));
            const json = await res.json();
            const items = json?.success ? (json.data || []) : [];
            if (!items.length) {
                // Nothing catalogued — fall back to free text so the user can still submit.
                selectEl.style.display = 'none';
                inputEl.style.display  = '';
                selectEl.innerHTML     = '<option value="">Select item</option>';
                return;
            }
            selectEl.innerHTML =
                '<option value="">Select item</option>' +
                items.map(i => {
                    const label = i.name + (i.category ? ' — ' + i.category : '');
                    return '<option value="' + escapeHtml(i.name) + '">' + escapeHtml(label) + '</option>';
                }).join('');
        } catch (e) {
            selectEl.style.display = 'none';
            inputEl.style.display  = '';
            selectEl.innerHTML     = '<option value="">Select item</option>';
        }
    }

    function currentEquipmentValue() {
        const selectEl = document.getElementById('equipmentItemSelect');
        const inputEl  = document.getElementById('equipmentItem');
        if (selectEl && selectEl.style.display !== 'none' && selectEl.value) return selectEl.value;
        return (inputEl?.value || '').trim();
    }

    // ─── SLA auto-preview ─────────────────────────────────────────────────────
    async function updateSLAPreview() {
        const category  = document.getElementById('category')?.value    || '';
        const reqType   = document.getElementById('requestType')?.value || '';
        const equipment = currentEquipmentValue();
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
            const slaSection = document.getElementById('slaPreviewSection');
            if (slaSection) {
                slaSection.style.display = 'block';
                const fmtHours = h => h < 1 ? `${Math.round(h * 60)} min` : `${h} hour${h > 1 ? 's' : ''}`;
                const resp = document.getElementById('slaResponsePreview');
                const reso = document.getElementById('slaResolutionPreview');
                if (resp) resp.textContent = fmtHours(json.sla.response_hours);
                if (reso) reso.textContent = fmtHours(json.sla.resolution_hours);

                // v15: show WHY the SLA is what it is when stock affected it.
                // Uses a small info line inside the SLA card. Same values the
                // ticket will be persisted with — no drift between preview and
                // storage because get_sla and submit_ticket call one shared PHP
                // function to compute the numbers.
                let noteEl = document.getElementById('slaExtensionNote');
                if (!noteEl) {
                    noteEl = document.createElement('div');
                    noteEl.id = 'slaExtensionNote';
                    noteEl.className = 'sla-preview-row';
                    noteEl.style.cssText = 'margin-top:8px;padding:8px 12px;background:#fff8e6;border-left:3px solid #d4a017;border-radius:6px;font-size:0.78rem;color:#7c5215;line-height:1.4;';
                    slaSection.appendChild(noteEl);
                }
                if (json.sla.sla_extended_reason) {
                    noteEl.innerHTML = '<i class="fas fa-info-circle" style="margin-right:6px;color:#d4a017;"></i>' + escapeHtml(json.sla.sla_extended_reason);
                    noteEl.style.display = 'flex';
                } else {
                    noteEl.style.display = 'none';
                }
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
        const equipItem   = currentEquipmentValue();
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

        // v28: upload any selected attachments to the new ticket_id.
        if (_pendingAttachments.length && data.ticket_id) {
            const statusEl = document.getElementById('attachmentStatus');
            let done = 0, failed = 0;
            for (const file of _pendingAttachments) {
                try {
                    const fd = new FormData();
                    fd.append('ticket_id',   data.ticket_id);
                    fd.append('uploader_id', USER_ID);
                    fd.append('file',        file);
                    const res  = await fetch('../api/upload_attachment.php', { method: 'POST', body: fd });
                    const j    = await res.json();
                    if (j.success) done++; else failed++;
                } catch (e) { failed++; }
            }
            _pendingAttachments = [];
            if (failed > 0) showToast(`${done} photo(s) uploaded, ${failed} failed.`, true);
        }

        const deptSelect = document.getElementById('department');
        const deptName   = deptSelect?.options[deptSelect.selectedIndex]?.text || department;
        closeRequestModal();

        // FIX 1: Equipment/Consumable requests need Dept Head approval — show the
        // approval notice instead of the normal "submitted" confirmation.
        if (data.needs_approval) {
            showApprovalNotice(data.ticket_code, title, data.priority, deptName);
        } else {
            showConfirmationModal(data.ticket_code, title, data.priority, deptName);
        }
        showToast(`✓ Request ${data.ticket_code} submitted successfully!`);
        await refreshAllData();
    }

    // FIX 1: Approval-required notice — reuses the confirmation modal and injects
    // a warning banner explaining the request is pending Department Head review.
    function showApprovalNotice(ticketCode, title, priority, department) {
        const modal = document.getElementById('confirmationModal');
        if (!modal) return;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('confirmTicketId', ticketCode);
        set('confirmTitle',    title);
        set('confirmPriority', priority);
        set('confirmDept',     department);
        set('confirmDate',     new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }));

        let banner = document.getElementById('approvalNoticeBanner');
        if (!banner) {
            const summaryCard = modal.querySelector('.request-summary-card');
            if (summaryCard) {
                banner = document.createElement('div');
                banner.id = 'approvalNoticeBanner';
                banner.className = 'approval-notice-banner';
                banner.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <div>
                        <strong>Approval Required</strong>
                        <p>This request requires Department Head approval before it can be processed by the IT team.
                        Your Department Head will review and approve this request.</p>
                    </div>`;
                summaryCard.parentNode.insertBefore(banner, summaryCard);
            }
        } else {
            banner.style.display = 'flex';
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
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

    // ─── Notifications ────────────────────────────────────────────────────────
    async function markAllNotificationsRead() {
        // v11: persist to DB, verify server acknowledged, then refresh.
        // The old code only updated local `notifications[].read` which was
        // wiped on the next page load — that's why notifs came back unread
        // on re-login.
        let ok = false;
        try {
            const res  = await fetch(`../api/notifications.php?action=mark_all_read`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ user_id: currentUser.id, user_role: 'requester', action: 'mark_all_read' })
            });
            const json = await res.json();
            ok = !!json.success;
        } catch (e) { /* fall through */ }

        if (!ok) {
            showToast('Could not mark all as read — please try again.', 'error');
            return;
        }
        await loadNotifications();
        renderNotifications();
        showToast('All notifications marked as read.');
    }

    async function markOneNotificationRead(notifId) {
        // v11: called when a requester clicks an individual notification.
        try {
            const res = await fetch(`../api/notifications.php?action=mark_one`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ action: 'mark_one', notif_id: notifId, user_id: currentUser.id })
            });
            const json = await res.json();
            if (!json.success) return false;
        } catch (e) { return false; }
        const n = notifications.find(x => String(x.id) === String(notifId));
        if (n) n.read = true;
        renderNotifications();
        return true;
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

    // ─── Detail modal ─────────────────────────────────────────────────────────
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

        gridContainer.innerHTML = filtered.map(t => {
            const disp = getDisplayStatus(t);
            return `
            <div class="ticket-item ${getPriorityClass(t.priority)}" data-request-id="${t.request_id}" data-status="${t.status}">
                <div class="ticket-id">#${escapeHtml(t.id)}<span class="priority-badge ${getPriorityBadgeClass(t.priority)}">${escapeHtml(t.priority)}</span></div>
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-meta">Status: ${escapeHtml(disp.label)} · ${formatDate(t.date)} · ${escapeHtml(t.department || 'N/A')}</div>
            </div>
        `;
        }).join('');

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
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            document.getElementById('serviceRequestForm')?.reset();
            calculatePriority();

            // v25: restore auto-fill by numeric id first, text as fallback.
            const deptSel = document.getElementById('department');
            const myId    = currentUser?.department_id ? String(currentUser.department_id) : '';
            const myName  = (currentUser?.department || '').trim().toLowerCase();
            if (deptSel) {
                let match = null;
                if (myId)   match = Array.from(deptSel.options).find(o => o.value === myId);
                if (!match && myName) match = Array.from(deptSel.options).find(o =>
                    o.textContent.trim().toLowerCase() === myName);
                if (match) deptSel.value = match.value;
            }
            updateRequestTypesForCategory('');
            updateEquipmentItemsForCategory('');
            const noteEl = document.getElementById('slaExtensionNote');
            if (noteEl) noteEl.style.display = 'none';

            // v28: clear queued attachments and reset the preview.
            _pendingAttachments = [];
            const prev = document.getElementById('attachmentPreview');
            if (prev) prev.innerHTML = '';
            const st = document.getElementById('attachmentStatus');
            if (st) st.textContent = '';
        }
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
    // ─── Apply user info to page elements ───────────────────────────────────────
    function applyUserInfo() {
        const name = currentUser?.name || 'Requester';
        const dept = currentUser?.department || '';
        const el = document.getElementById('profileDisplayName');
        if (el) el.textContent = dept ? `${name} (${dept})` : name;
        const wn = document.getElementById('welcomeFirstName');
        if (wn) wn.textContent = name.split(' ')[0];
    }

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

        // v29: drop-zone triggers the picker; also supports drag-and-drop.
        const dropZone  = document.getElementById('attachmentDropZone');
        const fileInput = document.getElementById('attachmentFileInput');
        const preview   = document.getElementById('attachmentPreview');
        const statusEl  = document.getElementById('attachmentStatus');

        function acceptFiles(files) {
            for (const f of files) {
                if (_pendingAttachments.length >= 5) { if (statusEl) statusEl.textContent = 'Max 5 files.'; break; }
                if (f.size > 5 * 1024 * 1024)         { if (statusEl) statusEl.textContent = `"${f.name}" too large (5 MB max).`; continue; }
                if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { if (statusEl) statusEl.textContent = `"${f.name}" unsupported.`; continue; }
                _pendingAttachments.push(f);
            }
            renderAttachmentPreviews();
            if (statusEl && _pendingAttachments.length) statusEl.textContent = `${_pendingAttachments.length} photo(s) selected — will upload after submit`;
        }

        function renderAttachmentPreviews() {
            if (!preview) return;
            preview.innerHTML = '';
            _pendingAttachments.forEach((f, idx) => {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'position:relative;width:80px;height:80px;border-radius:10px;overflow:hidden;border:1px solid #dbe6f0;';
                const img = document.createElement('img');
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                img.src = URL.createObjectURL(f);
                wrap.appendChild(img);
                const x = document.createElement('button');
                x.type = 'button';
                x.textContent = '×';
                x.style.cssText = 'position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,0.65);color:#fff;font-size:16px;line-height:20px;cursor:pointer;padding:0;';
                x.addEventListener('click', (e) => {
                    e.stopPropagation();
                    _pendingAttachments.splice(idx, 1);
                    renderAttachmentPreviews();
                    if (statusEl) statusEl.textContent = _pendingAttachments.length ? `${_pendingAttachments.length} photo(s) selected` : '';
                });
                wrap.appendChild(x);
                preview.appendChild(wrap);
            });
        }

        dropZone?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', (e) => {
            acceptFiles(Array.from(e.target.files || []));
            fileInput.value = '';
        });
        // Drag-and-drop
        ['dragenter','dragover'].forEach(ev => dropZone?.addEventListener(ev, e => {
            e.preventDefault(); e.stopPropagation();
            dropZone.style.background = '#e6effa';
            dropZone.style.borderColor = '#1f6392';
        }));
        ['dragleave','drop'].forEach(ev => dropZone?.addEventListener(ev, e => {
            e.preventDefault(); e.stopPropagation();
            dropZone.style.background = '#f5f9fe';
            dropZone.style.borderColor = '#b8cfe3';
        }));
        dropZone?.addEventListener('drop', e => {
            acceptFiles(Array.from(e.dataTransfer?.files || []));
        });
        document.getElementById('category')?.addEventListener('change', async e => {
            const cat = e.target.value;
            updateRequestTypesForCategory(cat);        // v15: request types depend on category
            await updateEquipmentItemsForCategory(cat); // v15: item list depends on category
            updateSLAPreview();
        });
        document.getElementById('requestType')?.addEventListener('change', updateSLAPreview);
        document.getElementById('equipmentItem')?.addEventListener('input',  updateSLAPreview);
        document.getElementById('equipmentItemSelect')?.addEventListener('change', updateSLAPreview);

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

    // ─── Helpers ─────────────────────────────────────────────────────────────
    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        try { return new Date(dateStr).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }); }
        catch (e) { return dateStr; }
    }

    function formatRelativeTime(dateStr) {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1)  return 'Just now';
        if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24)  return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7)  return `${days} day${days > 1 ? 's' : ''} ago`;
        return formatDate(dateStr);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    }

    function getPriorityClass(p) {
        return { Critical:'priority-critical', High:'priority-high', Medium:'priority-medium', Low:'priority-low' }[p] || 'priority-low';
    }

    function getPriorityBadgeClass(p) {
        return { Critical:'critical', High:'high', Medium:'medium', Low:'low' }[p] || 'low';
    }

    function getStatusClass(s) {
        const lc = (s || '').toLowerCase();
        if (lc === 'pending')               return 'status-pending';
        if (lc === 'ongoing')               return 'status-ongoing';
        if (lc === 'completed')             return 'status-completed';
        // FIX 3: requester must see "awaiting your confirmation" as its own state,
        // not silently fall back to Pending.
        if (lc === 'pending confirmation')  return 'status-pending-confirmation';
        if (lc === 'closed')                return 'status-closed';
        return 'status-pending';
    }

    // FIX: a ticket closed because the Dept Head rejected it should read
    // "Rejected" to the requester, not a bare "Closed" — same underlying
    // status column, different label/class so it's clear what happened.
    function getDisplayStatus(ticket) {
        if (ticket.status === 'Closed' && ticket.approvalStatus === 'Rejected') {
            return { label: 'Rejected', cls: 'status-rejected' };
        }
        return { label: ticket.status, cls: getStatusClass(ticket.status) };
    }

    function showToast(message, isError = false) {
        const toast = document.getElementById('toastMsg');
        if (!toast) return;
        toast.textContent = message;
        toast.style.background = isError ? '#c62828' : '#2c4c6e';
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
    }

    // ─── Render: tickets panel ────────────────────────────────────────────────
    function renderTicketsPanel() {
        const container = document.getElementById('myTicketsList');
        if (!container) return;

        let filtered = [...requesterTickets];
        if (myRequestsTabFilter !== 'all') {
            filtered = filtered.filter(t => t.status === myRequestsTabFilter);
        }
        const sorted = filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
        const recent = sorted.slice(0, 6);

        if (recent.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-inbox" style="font-size:2rem;color:#dee4ea;margin-bottom:12px;display:block;"></i>No ${myRequestsTabFilter === 'all' ? '' : myRequestsTabFilter + ' '}requests yet.</div>`;
            return;
        }

        container.innerHTML = recent.map(t => {
            const disp = getDisplayStatus(t);
            return `
            <div class="ticket-item ${getPriorityClass(t.priority)}" data-request-id="${t.request_id}">
                <div class="ticket-id">#${escapeHtml(t.id)}<span class="priority-badge ${getPriorityBadgeClass(t.priority)}">${escapeHtml(t.priority)}</span></div>
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-meta">
                    <span class="status-chip ${disp.cls}">${escapeHtml(disp.label)}</span>
                    &nbsp;·&nbsp;${formatDate(t.date)}
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.ticket-item[data-request-id]').forEach(el => {
            el.addEventListener('click', () => showRequestDetail(Number(el.dataset.requestId)));
        });
    }

    // ─── Render: activity timeline ────────────────────────────────────────────
    function renderActivityTimeline() {
        const container = document.getElementById('activitiesFeed');
        if (!container) return;
        if (activitiesFeed.length === 0) {
            container.innerHTML = '<div class="empty-state">No recent activity.</div>'; return;
        }
        container.innerHTML = activitiesFeed.map(a => `
            <div class="timeline-item">
                <div class="timeline-icon"><i class="fas fa-ticket-alt"></i></div>
                <div class="timeline-content">
                    <div class="timeline-title">${escapeHtml(a.title)}</div>
                    <div class="timeline-description">${escapeHtml(a.description)}</div>
                    <div class="timeline-date">${escapeHtml(a.time)}</div>
                </div>
            </div>`).join('');
    }

    // ─── Render: notifications ────────────────────────────────────────────────
    function renderNotifications() {
        const container = document.getElementById('notificationList');
        const badge     = document.getElementById('notificationBadge');
        const unread    = notifications.filter(n => !n.read).length;

        if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'inline-block' : 'none'; }

        if (!container) return;
        if (notifications.length === 0) {
            container.innerHTML = '<div style="padding:24px;text-align:center;color:#8aa5bf;">No notifications</div>'; return;
        }
        container.innerHTML = notifications.map(n => `
            <div class="notification-item ${!n.read ? 'unread' : ''}" data-id="${n.id}">
                <div class="notif-icon"><i class="fas ${n.icon || 'fa-bell'}"></i></div>
                <div class="notif-content">
                    <p><strong>${escapeHtml(n.title)}</strong><br>${escapeHtml(n.message)}</p>
                    <small>${escapeHtml(formatDate(n.time))}</small>
                </div>
            </div>`).join('');

        container.querySelectorAll('.notification-item').forEach(el => {
            el.addEventListener('click', async () => {
                // v11: was local-only (`notif.read = true`); now persists.
                const id = el.dataset.id;
                const notif = notifications.find(n => String(n.id) === String(id));
                if (notif && !notif.read) {
                    await markOneNotificationRead(id);
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

        const ticket = requesterTickets.find(t => Number(t.request_id) === Number(requestId)) || null;
        if (!ticket) {
            modalBody.innerHTML = '<div style="padding:40px;text-align:center;color:#c62828;">Could not load request details.</div>';
            return;
        }

        // SLA — read the ACTUAL backend fields; never fabricate from priority.
        const slaHoursRaw = Number(ticket.sla_resolution_hours) || 0;
        const slaExpected = slaHoursRaw > 0
            ? (slaHoursRaw < 1 ? Math.round(slaHoursRaw * 60) + ' min' : slaHoursRaw + ' hour(s)')
            : '—';
        const slaDeadline = ticket.resolution_due_at
            ? formatDate(ticket.resolution_due_at)
            : '—';

        const convHtml = ticket.conversations && ticket.conversations.length > 0
            ? ticket.conversations.map(msg => `
                <div class="conversation-message">
                    <div class="message-author">
                        <strong class="author-name">${escapeHtml(msg.author_name)}</strong>
                        <span class="message-timestamp">${formatDate(msg.created_at)}</span>
                    </div>
                    <div class="message-text">${escapeHtml(msg.message_text)}</div>
                </div>`).join('')
            : '<div style="text-align:center;padding:20px;color:#8aa5bf;">No messages yet.</div>';

        // FIX 3: The IT Admin no longer sets status straight to 'Completed' — it
        // goes to 'Pending Confirmation' first (see update_ticket.php send_confirmation
        // action) and only the requester's own confirmation moves it to 'Closed'.
        const resolveBtn = ticket.status === 'Pending Confirmation'
            ? `<button class="btn-confirm-resolve-trigger" id="showResolveConfirmBtn" data-id="${ticket.request_id}" data-code="${escapeHtml(ticket.id)}">
                   <i class="fas fa-check-double"></i> Confirm Issue Resolved
               </button>` : '';

        const disp = getDisplayStatus(ticket);

        // FIX: surface the Dept Head's rejection reason directly on the ticket,
        // not just buried in the conversation feed.
        const rejectionBanner = ticket.approvalStatus === 'Rejected'
            ? `<div class="approval-notice-banner" style="background:#fdeaea;border-color:#e08a8a;">
                   <i class="fas fa-ban" style="color:#c62828;"></i>
                   <div>
                       <strong style="color:#8a1f1f;">Request Rejected</strong>
                       <p style="color:#7a3a3a;">Your Department Head rejected this request and it has been closed.
                       ${ticket.rejectionNote ? `Reason: ${escapeHtml(ticket.rejectionNote)}` : ''}</p>
                   </div>
               </div>`
            : '';

        modalBody.innerHTML = `
            <div class="request-detail-card">
                <div class="request-header">
                    <h2 class="request-title">#${escapeHtml(ticket.id)}: ${escapeHtml(ticket.title)}</h2>
                    <span class="status-badge ${disp.cls}">${escapeHtml(disp.label)}</span>
                </div>
                ${rejectionBanner}
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
                    <div class="sla-row"><span class="sla-label"><i class="fas fa-hourglass-half"></i> Expected Resolution Time</span><span class="sla-value">${slaExpected}</span></div>
                    <div class="sla-row"><span class="sla-label"><i class="fas fa-clock"></i> SLA Deadline</span><span class="sla-value">${slaDeadline}</span></div>
                </div>
                ${resolveBtn}
            </div>
            <div class="follow-up-section">
                <h4 style="margin-bottom:16px;color:#1a4a6e;"><i class="fas fa-comments"></i> Conversation &amp; Updates</h4>
                <div class="conversation-thread" id="conversationThread">${convHtml}</div>
                <div class="follow-up-input">
                    <textarea id="followUpMessage" rows="2" placeholder="Add additional information or ask a question…"></textarea>
                    <button class="send-followup-btn" id="sendFollowUpBtn"><i class="fas fa-paper-plane"></i> Send</button>
                </div>
            </div>`;

        document.getElementById('sendFollowUpBtn')?.addEventListener('click', () => addFollowUp(ticket.request_id, ticket.id));
        document.getElementById('showResolveConfirmBtn')?.addEventListener('click', () => {
            pendingResolveId = ticket.request_id;
            document.getElementById('resolveTicketCode').textContent = '#' + ticket.id;
            closeDetailModal();
            document.getElementById('resolveConfirmModal')?.classList.add('active');
        });
    }

    // ─── Issue Resolution Confirmation ────────────────────────────────────────
    function initResolveConfirm() {
        document.getElementById('closeResolveModalBtn')?.addEventListener('click', () => {
            document.getElementById('resolveConfirmModal')?.classList.remove('active');
            pendingResolveId = null;
        });

        document.getElementById('confirmResolvedBtn')?.addEventListener('click', async () => {
            if (!pendingResolveId) return;
            const json = await apiFetch('/dept-head-data.php?action=confirm_resolved', {
                method: 'POST',
                body:   JSON.stringify({ ticket_id: pendingResolveId, user_id: USER_ID, user_name: currentUser?.name })
            });
            document.getElementById('resolveConfirmModal')?.classList.remove('active');
            if (json?.success) {
                showToast('Ticket closed. Thank you!');
                pendingFeedbackId = pendingResolveId;
                pendingResolveId  = null;
                await refreshAllData();
                // Show feedback modal after a short delay
                setTimeout(() => {
                    if (pendingFeedbackId) openFeedbackModal(pendingFeedbackId);
                }, 400);
            } else {
                showToast('Could not close ticket: ' + (json?.message || ''), true);
                pendingResolveId = null;
            }
        });

        document.getElementById('reopenTicketBtn')?.addEventListener('click', async () => {
            if (!pendingResolveId) return;
            const json = await apiFetch('/dept-head-data.php?action=reopen_ticket', {
                method: 'POST',
                body:   JSON.stringify({ ticket_id: pendingResolveId, user_id: USER_ID, user_name: currentUser?.name })
            });
            document.getElementById('resolveConfirmModal')?.classList.remove('active');
            pendingResolveId = null;
            if (json?.success) { showToast('Ticket re-opened for IT team.'); await refreshAllData(); }
            else showToast('Could not re-open ticket.', true);
        });
    }

    // ─── Feedback Modal ───────────────────────────────────────────────────────
    function openFeedbackModal(ticketId) {
        const ticket = requesterTickets.find(t => Number(t.request_id) === Number(ticketId));
        const ref    = document.getElementById('feedbackTicketRef');
        if (ref && ticket) {
            // Matches image: "Request #SR-229: Printer out of toner"
            ref.textContent = `Request #${ticket.id}: ${ticket.title}`;
        }
        selectedStarRating = 0;
        highlightStars(0);
        const comment = document.getElementById('feedbackComment');
        if (comment) comment.value = '';
        document.getElementById('feedbackModal')?.classList.add('active');
    }

    function highlightStars(count) {
        document.querySelectorAll('#starRatingRow .star-icon').forEach(s => {
            const filled = Number(s.dataset.value) <= count;
            s.classList.toggle('star-active', filled);
            // Switch between hollow (far) and filled (fas) to match image
            s.classList.toggle('fas', filled);
            s.classList.toggle('far', !filled);
        });
    }

    function initFeedback() {
        document.querySelectorAll('#starRatingRow .star-icon').forEach(star => {
            star.addEventListener('click', () => {
                selectedStarRating = Number(star.dataset.value);
                highlightStars(selectedStarRating);
                const lbl = document.getElementById('starCountLabel');
                if (lbl) lbl.textContent = `${selectedStarRating} / 5`;
            });
            star.addEventListener('mouseenter', () => highlightStars(Number(star.dataset.value)));
            star.addEventListener('mouseleave', () => highlightStars(selectedStarRating));
        });

        document.getElementById('skipFeedbackBtn')?.addEventListener('click', () => {
            document.getElementById('feedbackModal')?.classList.remove('active');
            pendingFeedbackId = null;
        });

        document.getElementById('closeFeedbackModalBtn')?.addEventListener('click', () => {
            document.getElementById('feedbackModal')?.classList.remove('active');
            pendingFeedbackId = null;
        });

        document.getElementById('submitFeedbackBtn')?.addEventListener('click', async () => {
            if (selectedStarRating < 1) { showToast('Please select a star rating.', true); return; }
            if (!pendingFeedbackId) { document.getElementById('feedbackModal')?.classList.remove('active'); return; }
            const comment = document.getElementById('feedbackComment')?.value.trim() || '';
            const json = await apiFetch('/dept-head-data.php?action=submit_feedback', {
                method: 'POST',
                body:   JSON.stringify({ ticket_id: pendingFeedbackId, user_id: USER_ID, rating: selectedStarRating, comment })
            });
            if (json?.success) {
                document.getElementById('feedbackModal')?.classList.remove('active');
                pendingFeedbackId  = null;
                selectedStarRating = 0;
                showToast('Feedback submitted. Thank you!');
            } else {
                showToast('Could not submit feedback.', true);
            }
        });
    }

    // ─── My Requests tab bar ──────────────────────────────────────────────────
    function initMyRequestsTabs() {
        document.querySelectorAll('#requestStatusTabs .req-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('#requestStatusTabs .req-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                myRequestsTabFilter = tab.dataset.status;
                renderTicketsPanel();
            });
        });
    }

    // ─── Initialise ───────────────────────────────────────────────────────────
    async function init() {
        if (isInitialized) return;
        isInitialized = true;

        applyUserInfo();
        initProfileDropdown();
        setupEventListeners();
        setupFilterButtons();
        initMyRequestsTabs();
        initResolveConfirm();
        initFeedback();

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
