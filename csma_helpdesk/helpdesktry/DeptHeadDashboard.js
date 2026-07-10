// DeptHeadDashboard.js
// Department Head portal — auth, approval workflow, own ticket management,
// follow-up, resolution confirmation, and feedback rating.

(function () {
    'use strict';

    const API_BASE  = '../api';
    const DEPT_API  = `${API_BASE}/dept-head-data.php`;
    const TICKET_API = `${API_BASE}/submit_ticket.php`;

    // ─── Auth ─────────────────────────────────────────────────────────────────
    let currentUser = null;

    (function checkDeptHeadAuth() {
        const raw = sessionStorage.getItem('currentUser');
        if (!raw) { window.location.replace('Login.html'); return; }
        try {
            currentUser = JSON.parse(raw);
        } catch (e) {
            sessionStorage.removeItem('currentUser');
            window.location.replace('Login.html');
            return;
        }
        if (currentUser.role !== 'dept_head') {
            const redirect = currentUser.role === 'admin' ? 'Dashboard.html' : 'RequesterDashboard.html';
            window.location.replace(redirect);
        }
    })();

    const USER_ID = currentUser?.id;

    // ─── State ────────────────────────────────────────────────────────────────
    let approvalTickets     = [];
    let myTickets           = [];
    let approvalFilter      = 'all';
    let myTicketFilter      = 'all';
    let fullListFilter      = 'all';
    let pendingResolveId    = null;   // ticket id waiting for resolve confirmation
    let pendingRejectId     = null;   // ticket id waiting for reject confirmation
    let pendingFeedbackId   = null;   // ticket id waiting for feedback
    let selectedStarRating  = 0;
    let _currentSLA = { priority: 'Low', response_hours: 8, resolution_hours: 48 };

    // ─── Init ─────────────────────────────────────────────────────────────────
    async function init() {
        applyUserInfo();
        initThemeToggle();
        initProfileDropdown();
        initNotificationBell();
        initModalCloseHandlers();
        initFormListeners();
        initApprovalTabs();
        initMyRequestTabs();
        initFullListFilters();
        initStarRating();

        await refreshAll();
    }

    function applyUserInfo() {
        const name = currentUser?.name || 'Department Head';
        const dept = currentUser?.department || '';
        const el = document.getElementById('welcomeName');
        if (el) el.textContent = name.split(' ')[0];
        const profileEl = document.getElementById('profileName');
        if (profileEl) profileEl.textContent = `${name} (${dept})`;
        const deptLabel = document.getElementById('deptLabel');
        if (deptLabel && dept) deptLabel.textContent = dept;
    }

    async function refreshAll() {
        await loadStats();
        await loadApprovals();
        await loadMyTickets();
        buildNotifications();
    }

    // ─── API helpers ──────────────────────────────────────────────────────────
    async function apiFetch(url, options = {}) {
        try {
            const res  = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
            const json = await res.json();
            // FIX: previously this threw away `json` and returned null on any
            // non-2xx response, so the real backend message (e.g. a DB error)
            // never reached the toast — callers only ever saw "Unknown error".
            // Return the parsed body either way so json.message survives.
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

    // ─── Stats ────────────────────────────────────────────────────────────────
    async function loadStats() {
        const json = await apiFetch(`${DEPT_API}?action=get_stats&dept_head_id=${USER_ID}`);
        if (!json?.success) return;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('pendingApprovalsCount', json.pending_approvals);
        set('totalRequests',         json.my_total);
        set('pendingCount',          json.my_pending);
        set('ongoingCount',          json.my_ongoing);
        set('completedCount',        json.my_completed);
    }

    // ─── Approval Requests ────────────────────────────────────────────────────
    async function loadApprovals() {
        const json = await apiFetch(`${DEPT_API}?action=get_pending_approvals&dept_head_id=${USER_ID}&filter=${approvalFilter}`);
        const container = document.getElementById('approvalCardsList');
        if (!json?.success) {
            if (container) container.innerHTML = '<div class="empty-state">Could not load approval requests.</div>';
            return;
        }
        approvalTickets = json.approvals || [];
        renderApprovalCards(container);
    }

    function renderApprovalCards(container) {
        if (!container) return;
        if (approvalTickets.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-check" style="font-size:2rem;color:#dee4ea;margin-bottom:12px;display:block;"></i>No requests ${approvalFilter === 'all' ? '' : `with status "${approvalFilter}"`} to review.</div>`;
            return;
        }

        container.innerHTML = approvalTickets.map(t => {
            const statusClass = { 'Pending Approval': 'badge-pending', 'Approved': 'badge-approved', 'Rejected': 'badge-rejected' }[t.approval_status] || 'badge-pending';
            const costDisplay = t.estimated_cost ? `<div class="card-estimated-cost"><i class="fas fa-peso-sign"></i> Est. Cost: ₱${Number(t.estimated_cost).toLocaleString('en-PH', {minimumFractionDigits:2})}</div>` : '';
            const actions = t.approval_status === 'Pending Approval' ? `
                <div class="approval-card-actions">
                    <button class="btn-approve" data-id="${t.id}" data-code="${escapeHtml(t.ticket_code)}">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button class="btn-reject-card" data-id="${t.id}" data-code="${escapeHtml(t.ticket_code)}">
                        <i class="fas fa-times"></i> Reject
                    </button>
                </div>` : `<p style="font-size:0.72rem;color:#8aa5bf;margin-top:4px;">${t.decided_at ? 'Decided: ' + formatDate(t.decided_at) : ''}</p>`;

            return `
                <div class="approval-card" data-ticket-id="${t.id}">
                    <div class="approval-card-header">
                        <span class="approval-card-id">#${escapeHtml(t.ticket_code)}</span>
                        <span class="approval-status-badge ${statusClass}">${escapeHtml(t.approval_status)}</span>
                    </div>
                    <div class="approval-card-title">${escapeHtml(t.title)}</div>
                    <div class="approval-card-meta">
                        <span><i class="fas fa-user"></i> ${escapeHtml(t.requester_name)}</span>
                        <span><i class="fas fa-desktop"></i> ${escapeHtml(t.equipment_item)}</span>
                        <span><i class="fas fa-calendar"></i> ${formatDate(t.submitted_at)}</span>
                    </div>
                    ${costDisplay}
                    ${actions}
                </div>`;
        }).join('');

        // Card click → detail modal
        container.querySelectorAll('.approval-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.approval-card-actions')) return;
                const ticketId = Number(card.dataset.ticketId);
                const ticket = approvalTickets.find(t => Number(t.id) === ticketId);
                if (ticket) openApprovalDetailModal(ticket);
            });
        });

        // Approve button
        container.querySelectorAll('.btn-approve').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ticketId = Number(btn.dataset.id);
                const ticketCode = btn.dataset.code;
                openApproveFlow(ticketId, ticketCode);
            });
        });

        // Reject button
        container.querySelectorAll('.btn-reject-card').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                pendingRejectId = Number(btn.dataset.id);
                document.getElementById('rejectTicketCode').textContent = '#' + btn.dataset.code;
                document.getElementById('rejectionNote').value = '';
                openModal('rejectModal');
            });
        });
    }

    function openApproveFlow(ticketId, ticketCode) {
        // Inline approve with optional cost — no separate modal needed
        const cost = prompt(`Approve #${ticketCode}\n\nEnter estimated cost in ₱ (or leave blank):`);
        if (cost === null) return; // cancelled
        submitApproval(ticketId, cost ? parseFloat(cost) : null);
    }

    async function submitApproval(ticketId, estimatedCost) {
        const json = await apiFetch(`${DEPT_API}?action=approve_ticket`, {
            method: 'POST',
            body: JSON.stringify({ ticket_id: ticketId, dept_head_id: USER_ID, dept_head_name: currentUser?.name, estimated_cost: estimatedCost })
        });
        if (json?.success) {
            showToast('✅ Request approved.');
            await refreshAll();
        } else {
            showToast('Approval failed: ' + (json?.message || 'Unknown error'), true);
        }
    }

    // ─── Approval Detail Modal ────────────────────────────────────────────────
    function openApprovalDetailModal(ticket) {
        const body = document.getElementById('approvalDetailBody');
        if (!body) return;

        const statusClass = { 'Pending Approval': 'badge-pending', 'Approved': 'badge-approved', 'Rejected': 'badge-rejected' }[ticket.approval_status] || 'badge-pending';
        const slaResolutionH = Number(ticket.sla_resolution_hours) || 0;
        const slaResText     = ticket.resolution_due_at ? formatDate(ticket.resolution_due_at) : '—';

        body.innerHTML = `
            <div class="approval-detail-header">
                <div class="approval-detail-title">${escapeHtml(ticket.title)}</div>
                <span class="approval-status-badge ${statusClass}">${escapeHtml(ticket.approval_status)}</span>
            </div>
            <div class="info-grid">
                <div class="info-item"><span class="info-label"><i class="fas fa-hashtag"></i> Ticket ID</span><span class="info-value">#${escapeHtml(ticket.ticket_code)}</span></div>
                <div class="info-item"><span class="info-label"><i class="fas fa-user"></i> Requester</span><span class="info-value">${escapeHtml(ticket.requester_name)}</span></div>
                <div class="info-item"><span class="info-label"><i class="fas fa-building"></i> Department</span><span class="info-value">${escapeHtml(ticket.department_name)}</span></div>
                <div class="info-item"><span class="info-label"><i class="fas fa-calendar"></i> Submitted</span><span class="info-value">${formatDate(ticket.submitted_at)}</span></div>
                <div class="info-item"><span class="info-label"><i class="fas fa-chart-line"></i> Priority</span><span class="info-value">${escapeHtml(ticket.priority)}</span></div>
                <div class="info-item"><span class="info-label"><i class="fas fa-desktop"></i> Equipment/Item</span><span class="info-value">${escapeHtml(ticket.equipment_item)}</span></div>
            </div>
            <div class="info-item" style="margin-bottom:16px;">
                <span class="info-label"><i class="fas fa-align-left"></i> Issue Description</span>
                <span class="info-value" style="margin-top:6px;display:block;">${escapeHtml(ticket.description || 'No description.')}</span>
            </div>
            <div class="sla-card">
                <div class="sla-row"><span class="sla-label"><i class="fas fa-hourglass-half"></i> Expected Resolution Time</span><span class="sla-value">${slaResolutionH > 0 ? (slaResolutionH < 1 ? Math.round(slaResolutionH * 60) + ' min' : slaResolutionH + ' hour(s)') : '—'}</span></div>
                <div class="sla-row"><span class="sla-label"><i class="fas fa-clock"></i> SLA Deadline</span><span class="sla-value">${slaResText}</span></div>
            </div>
            ${ticket.estimated_cost ? `<div class="card-estimated-cost" style="margin-bottom:12px;"><i class="fas fa-peso-sign"></i> Estimated Cost: ₱${Number(ticket.estimated_cost).toLocaleString('en-PH',{minimumFractionDigits:2})}</div>` : ''}
            ${ticket.rejection_note ? `<div class="approval-warning" style="margin-bottom:12px;"><i class="fas fa-info-circle"></i> <div><strong>Rejection Note:</strong> ${escapeHtml(ticket.rejection_note)}</div></div>` : ''}
            ${ticket.approval_status === 'Pending Approval' ? `
            <div class="estimated-cost-input-row">
                <label for="detailEstCost">Estimated Cost (₱)</label>
                <input type="number" id="detailEstCost" placeholder="Optional" min="0" step="0.01">
            </div>
            <div class="approval-actions-row">
                <button class="btn-reject-detail" id="detailRejectBtn" data-id="${ticket.id}" data-code="${escapeHtml(ticket.ticket_code)}">
                    <i class="fas fa-times"></i> Reject Request
                </button>
                <button class="btn-approve-detail" id="detailApproveBtn" data-id="${ticket.id}">
                    <i class="fas fa-check"></i> Approve Request
                </button>
            </div>` : ''}
        `;

        // Wire detail modal action buttons
        document.getElementById('detailApproveBtn')?.addEventListener('click', async () => {
            const cost = parseFloat(document.getElementById('detailEstCost')?.value || '') || null;
            await submitApproval(ticket.id, cost);
            closeModal('approvalDetailModal');
        });
        document.getElementById('detailRejectBtn')?.addEventListener('click', () => {
            pendingRejectId = Number(ticket.id);
            document.getElementById('rejectTicketCode').textContent = '#' + ticket.ticket_code;
            document.getElementById('rejectionNote').value = '';
            closeModal('approvalDetailModal');
            openModal('rejectModal');
        });

        openModal('approvalDetailModal');
    }

    // ─── My Tickets ───────────────────────────────────────────────────────────
    async function loadMyTickets() {
        const json = await apiFetch(`${DEPT_API}?action=get_my_tickets&dept_head_id=${USER_ID}`);
        const container = document.getElementById('myTicketsList');
        if (!json?.success) {
            if (container) container.innerHTML = '<div class="empty-state">Could not load tickets.</div>';
            return;
        }
        myTickets = json.data || [];
        renderMyTickets();
    }

    function renderMyTickets() {
        const container = document.getElementById('myTicketsList');
        if (!container) return;

        const filtered = myTicketFilter === 'all' ? myTickets : myTickets.filter(t => t.status === myTicketFilter);
        if (filtered.length === 0) {
            container.innerHTML = `<div class="empty-state">No ${myTicketFilter === 'all' ? '' : myTicketFilter + ' '}requests yet.</div>`;
            return;
        }

        container.innerHTML = filtered.slice(0, 5).map(t => {
            const priority = t.priority || 'Low';
            const status   = t.status   || 'Pending';
            return `
            <div class="ticket-item ${getPriorityClass(priority)}" data-request-id="${t.id}">
                <div class="ticket-id-row">
                    <span class="ticket-id-text">#${escapeHtml(t.ticket_code)}</span>
                    <span class="priority-badge ${priority.toLowerCase()}">${escapeHtml(priority)}</span>
                </div>
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-meta">
                    <span class="status-chip status-${status.toLowerCase()}">${escapeHtml(status)}</span>
                    &nbsp;· ${formatDate(t.submitted_at)}
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.ticket-item[data-request-id]').forEach(el => {
            el.addEventListener('click', () => openMyRequestDetail(Number(el.dataset.requestId)));
        });
    }

    function openMyRequestDetail(requestId) {
        const ticket = myTickets.find(t => Number(t.id) === requestId);
        if (!ticket) return;

        const modal     = document.getElementById('requestDetailModal');
        const modalBody = document.getElementById('detailModalBody');
        if (!modal || !modalBody) return;

        const convHtml = ticket.conversations?.length > 0
            ? ticket.conversations.map(c => `
                <div class="conversation-message">
                    <div class="message-author">
                        <strong class="author-name">${escapeHtml(c.author_name)}</strong>
                        <span class="message-timestamp">${formatDate(c.created_at)}</span>
                    </div>
                    <div class="message-text">${escapeHtml(c.message)}</div>
                </div>`).join('')
            : '<div style="text-align:center;padding:16px;color:#8aa5bf;">No messages yet.</div>';

        const resolveBtn = ticket.status === 'Completed'
            ? `<button class="btn-confirm-resolved" id="showResolveBtn" style="margin-top:16px;" data-id="${ticket.id}" data-code="${ticket.ticket_code}"><i class="fas fa-check-double"></i> Confirm Issue Resolved</button>` : '';

        modalBody.innerHTML = `
            <div class="request-detail-card">
                <div class="request-header">
                    <h2 class="request-title">#${escapeHtml(ticket.ticket_code)}: ${escapeHtml(ticket.title)}</h2>
                    <span class="status-badge status-${ticket.status.toLowerCase()}">${escapeHtml(ticket.status)}</span>
                </div>
                <div class="info-grid">
                    <div class="info-item"><span class="info-label"><i class="fas fa-calendar"></i> Submitted</span><span class="info-value">${formatDate(ticket.submitted_at)}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-chart-line"></i> Priority</span><span class="info-value">${escapeHtml(ticket.priority)}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-tag"></i> Category</span><span class="info-value">${escapeHtml(ticket.category)}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-building"></i> Department</span><span class="info-value">${escapeHtml(ticket.department)}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-desktop"></i> Equipment/Item</span><span class="info-value">${escapeHtml(ticket.equipment_item)}</span></div>
                    <div class="info-item"><span class="info-label"><i class="fas fa-map-marker-alt"></i> Location</span><span class="info-value">${escapeHtml(ticket.location || 'Not specified')}</span></div>
                </div>
                <div class="info-item" style="margin-bottom:16px;">
                    <span class="info-label"><i class="fas fa-align-left"></i> Issue Description</span>
                    <span class="info-value" style="margin-top:6px;display:block;">${escapeHtml(ticket.description || '—')}</span>
                </div>
                <div class="sla-card">
                    <div class="sla-row"><span class="sla-label"><i class="fas fa-hourglass-half"></i> Expected Resolution Time</span><span class="sla-value">${(() => { const h = Number(ticket.sla_resolution_hours) || 0; return h > 0 ? (h < 1 ? Math.round(h*60) + ' min' : h + ' hour(s)') : '—'; })()}</span></div>
                    <div class="sla-row"><span class="sla-label"><i class="fas fa-clock"></i> SLA Deadline</span><span class="sla-value">${ticket.resolution_due_at ? formatDate(ticket.resolution_due_at) : '—'}</span></div>
                </div>
                ${resolveBtn}
            </div>
            <div class="follow-up-section">
                <h4 style="margin-bottom:16px;color:#1a4a6e;font-size:0.95rem;"><i class="fas fa-comments"></i> Conversation &amp; Updates</h4>
                <div class="conversation-thread">${convHtml}</div>
                <div class="follow-up-input">
                    <textarea id="followUpMessage" rows="2" placeholder="Add a follow-up message…"></textarea>
                    <button class="send-followup-btn" id="sendFollowUpBtn"><i class="fas fa-paper-plane"></i> Send</button>
                </div>
            </div>`;

        // Resolve confirmation
        document.getElementById('showResolveBtn')?.addEventListener('click', () => {
            pendingResolveId = ticket.id;
            document.getElementById('resolveTicketCode').textContent = '#' + ticket.ticket_code;
            closeModal('requestDetailModal');
            openModal('resolveConfirmModal');
        });

        // Follow-up send
        document.getElementById('sendFollowUpBtn')?.addEventListener('click', () => sendFollowUp(ticket.id));

        openModal('requestDetailModal');
    }

    // ─── Follow-up ────────────────────────────────────────────────────────────
    async function sendFollowUp(ticketId) {
        const input   = document.getElementById('followUpMessage');
        const message = input?.value.trim();
        if (!message) { showToast('Please type a message first.', true); return; }

        const json = await apiFetch(`${API_BASE}/add_followup.php`, {
            method: 'POST',
            body: JSON.stringify({ ticket_id: ticketId, author_id: USER_ID, author_name: currentUser?.name || 'Dept Head', message })
        });
        if (json?.success) {
            showToast('Follow-up sent!');
            input.value = '';
            await loadMyTickets();
            closeModal('requestDetailModal');
            openMyRequestDetail(ticketId);
        } else {
            showToast('Could not send follow-up.', true);
        }
    }

    // ─── Resolution & Feedback ────────────────────────────────────────────────
    function initResolveConfirm() {
        document.getElementById('confirmResolvedBtn')?.addEventListener('click', async () => {
            if (!pendingResolveId) return;
            const json = await apiFetch(`${DEPT_API}?action=confirm_resolved`, {
                method: 'POST',
                body: JSON.stringify({ ticket_id: pendingResolveId, user_id: USER_ID, user_name: currentUser?.name })
            });
            if (json?.success) {
                closeModal('resolveConfirmModal');
                showToast('Ticket closed. Thank you!');
                pendingFeedbackId = pendingResolveId;
                pendingResolveId  = null;
                openModal('feedbackModal');
                await refreshAll();
            } else {
                showToast('Could not close ticket: ' + (json?.message || ''), true);
            }
        });

        document.getElementById('reopenTicketBtn')?.addEventListener('click', async () => {
            if (!pendingResolveId) return;
            const json = await apiFetch(`${DEPT_API}?action=reopen_ticket`, {
                method: 'POST',
                body: JSON.stringify({ ticket_id: pendingResolveId, user_id: USER_ID, user_name: currentUser?.name })
            });
            if (json?.success) {
                closeModal('resolveConfirmModal');
                pendingResolveId = null;
                showToast('Ticket re-opened for IT team.');
                await refreshAll();
            } else {
                showToast('Could not re-open ticket.', true);
            }
        });
    }

    // ─── Feedback ─────────────────────────────────────────────────────────────
    function initStarRating() {
        const stars = document.querySelectorAll('#starRating i');
        stars.forEach(star => {
            star.addEventListener('click', () => {
                selectedStarRating = Number(star.dataset.value);
                highlightStars(selectedStarRating);
                const cnt = document.getElementById('starCount');
                if (cnt) cnt.textContent = `${selectedStarRating} / 5`;
            });
            star.addEventListener('mouseenter', () => highlightStars(Number(star.dataset.value)));
            star.addEventListener('mouseleave', () => highlightStars(selectedStarRating));
        });

        document.getElementById('submitFeedbackBtn')?.addEventListener('click', async () => {
            if (!pendingFeedbackId) { closeModal('feedbackModal'); return; }
            if (selectedStarRating < 1) { showToast('Please select a star rating.', true); return; }
            const comment = document.getElementById('feedbackComment')?.value.trim() || '';
            const json = await apiFetch(`${DEPT_API}?action=submit_feedback`, {
                method: 'POST',
                body: JSON.stringify({ ticket_id: pendingFeedbackId, user_id: USER_ID, rating: selectedStarRating, comment })
            });
            if (json?.success) {
                closeModal('feedbackModal');
                pendingFeedbackId  = null;
                selectedStarRating = 0;
                highlightStars(0);
                showToast('Feedback submitted. Thank you!');
            } else {
                showToast('Could not submit feedback.', true);
            }
        });

        document.getElementById('skipFeedbackBtn')?.addEventListener('click', () => {
            closeModal('feedbackModal');
            pendingFeedbackId = null;
        });
    }

    function highlightStars(count) {
        document.querySelectorAll('#starRating i').forEach(s => {
            s.classList.toggle('active', Number(s.dataset.value) <= count);
        });
    }

    // ─── Reject Flow ──────────────────────────────────────────────────────────
    function initRejectModal() {
        document.getElementById('confirmRejectBtn')?.addEventListener('click', async () => {
            if (!pendingRejectId) return;
            const note = document.getElementById('rejectionNote')?.value.trim() || '';
            const json = await apiFetch(`${DEPT_API}?action=reject_ticket`, {
                method: 'POST',
                body: JSON.stringify({ ticket_id: pendingRejectId, dept_head_id: USER_ID, dept_head_name: currentUser?.name, rejection_note: note })
            });
            if (json?.success) {
                closeModal('rejectModal');
                pendingRejectId = null;
                showToast('Request rejected.');
                await refreshAll();
            } else {
                showToast('Rejection failed: ' + (json?.message || ''), true);
            }
        });
        document.getElementById('cancelRejectBtn')?.addEventListener('click', () => closeModal('rejectModal'));
    }

    // ─── New Request Form ─────────────────────────────────────────────────────
    function initFormListeners() {
        document.getElementById('openNewRequestBtn')?.addEventListener('click', openRequestModal);
        document.getElementById('closeModalBtn')?.addEventListener('click', closeRequestModal);
        document.getElementById('cancelFormBtn')?.addEventListener('click', closeRequestModal);

        ['category','requestType','equipmentItem'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', updateSLAPreview);
            document.getElementById(id)?.addEventListener('input', updateSLAPreview);
        });

        loadDepartments();

        document.getElementById('serviceRequestForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const category    = document.getElementById('category').value;
            const department  = document.getElementById('department').value;
            const equipItem   = document.getElementById('equipmentItem').value.trim();
            const requestType = document.getElementById('requestType').value;
            const title       = document.getElementById('requestTitle').value.trim();
            const description = document.getElementById('description').value.trim();
            const location    = document.getElementById('location').value.trim();
            const prefDate    = document.getElementById('preferredDate').value || null;

            if (!category || !department || !equipItem || !requestType || !title) {
                showToast('Please fill in all required fields.', true); return;
            }

            const payload = {
                requester_id:   USER_ID,
                requester_name: currentUser?.name || 'Dept Head',
                department_id:  department,
                category, request_type: requestType, equipment_item: equipItem,
                title, description, location, preferred_date: prefDate
            };

            const json = await apiFetch(TICKET_API, { method: 'POST', body: JSON.stringify(payload) });
            if (json?.success) {
                const deptSelect = document.getElementById('department');
                const deptName   = deptSelect?.options[deptSelect.selectedIndex]?.text || '';
                closeRequestModal();
                populateConfirmModal(json.ticket_code, title, json.priority, deptName);
                openModal('confirmationModal');
                document.getElementById('serviceRequestForm')?.reset();
                await refreshAll();
            } else {
                showToast('Submission failed: ' + (json?.message || 'Unknown error'), true);
            }
        });

        document.getElementById('modalDoneBtn')?.addEventListener('click', () => closeModal('confirmationModal'));
        document.getElementById('modalNewRequestBtn')?.addEventListener('click', () => {
            closeModal('confirmationModal');
            openRequestModal();
        });
    }

    function openRequestModal()  { openModal('newRequestModal'); }
    function closeRequestModal() { closeModal('newRequestModal'); }

    function populateConfirmModal(code, title, priority, dept) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('confirmTicketId', code);
        set('confirmTitle',    title);
        set('confirmPriority', priority);
        set('confirmDept',     dept);
        set('confirmDate',     new Date().toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }));
    }

    async function loadDepartments() {
        const json = await apiFetch(`${API_BASE}/get_departments.php`);
        if (!json?.success) return;
        const select = document.getElementById('department');
        if (!select) return;
        select.innerHTML = '<option value="">Select department</option>';
        json.data.forEach(dept => {
            const opt = document.createElement('option');
            opt.value = dept.id;
            opt.textContent = dept.name;
            select.appendChild(opt);
        });
    }

    async function updateSLAPreview() {
        const category  = document.getElementById('category')?.value   || '';
        const reqType   = document.getElementById('requestType')?.value || '';
        const equipment = document.getElementById('equipmentItem')?.value || '';
        const display   = document.getElementById('priorityDisplay');
        const preview   = document.getElementById('slaPreview');

        if (!category || !reqType) {
            _currentSLA = { priority: 'Low', response_hours: 8, resolution_hours: 48 };
            if (display) { display.textContent = 'Low'; display.className = 'priority-badge-large low'; }
            if (preview) preview.style.display = 'none';
            return;
        }

        const json = await apiFetch(`${API_BASE}/get_sla.php`, { method: 'POST', body: JSON.stringify({ category, request_type: reqType, equipment }) });
        if (json?.success) {
            _currentSLA = json.sla;
            const p = json.sla.priority;
            if (display) { display.textContent = p; display.className = `priority-badge-large ${p.toLowerCase()}`; }
            if (preview) {
                preview.style.display = 'flex';
                const rh = json.sla.response_hours;
                const resh = json.sla.resolution_hours;
                const fmtH = h => h < 1 ? Math.round(h * 60) + ' min' : h + ' hour(s)';
                const rt = document.getElementById('slaResponseTime');
                const rest = document.getElementById('slaResolutionTime');
                if (rt)   rt.textContent   = fmtH(rh);
                if (rest) rest.textContent = fmtH(resh);
            }
        }
    }

    // ─── Tabs ─────────────────────────────────────────────────────────────────
    function initApprovalTabs() {
        document.querySelectorAll('.approval-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.approval-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                approvalFilter = btn.dataset.filter;
                loadApprovals();
            });
        });
    }

    function initMyRequestTabs() {
        document.querySelectorAll('.my-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.my-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                myTicketFilter = btn.dataset.filter;
                renderMyTickets();
            });
        });

        document.getElementById('viewAllTicketsLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            renderFullList('all');
            openModal('fullListModal');
        });
    }

    function initFullListFilters() {
        document.querySelectorAll('#ticketFilterBar .filter-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#ticketFilterBar .filter-chip').forEach(b => b.classList.remove('filter-chip-active'));
                btn.classList.add('filter-chip-active');
                fullListFilter = btn.dataset.filter;
                renderFullList(fullListFilter);
            });
        });
    }

    function renderFullList(filter) {
        const grid = document.getElementById('allTicketsGrid');
        const counter = document.getElementById('resultsCount');
        if (!grid) return;
        const filtered = filter === 'all' ? myTickets : myTickets.filter(t => t.status === filter);
        if (counter) counter.textContent = `${filtered.length} request${filtered.length !== 1 ? 's' : ''}`;
        if (filtered.length === 0) { grid.innerHTML = '<div class="empty-state">No requests found.</div>'; return; }
        grid.innerHTML = filtered.map(t => {
            const priority = t.priority || 'Low';
            const status   = t.status   || 'Pending';
            return `
            <div class="ticket-item ${getPriorityClass(priority)}" data-request-id="${t.id}" style="cursor:pointer;">
                <div class="ticket-id-row">
                    <span class="ticket-id-text">#${escapeHtml(t.ticket_code)}</span>
                    <span class="priority-badge ${priority.toLowerCase()}">${escapeHtml(priority)}</span>
                </div>
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-meta">
                    <span class="status-chip status-${status.toLowerCase()}">${escapeHtml(status)}</span>
                    &nbsp;· ${formatDate(t.submitted_at)}
                </div>
            </div>`;
        }).join('');
        grid.querySelectorAll('.ticket-item').forEach(el => {
            el.addEventListener('click', () => {
                closeModal('fullListModal');
                openMyRequestDetail(Number(el.dataset.requestId));
            });
        });
    }

    // ─── Notifications (built from data, no separate endpoint) ───────────────
    function buildNotifications() {
        const pending = approvalTickets.filter(t => t.approval_status === 'Pending Approval');
        const notifs  = [
            ...pending.map(t => ({ icon: 'fa-clipboard-check', title: 'Approval Needed', message: `#${t.ticket_code}: ${t.title}`, read: false })),
            ...myTickets.filter(t => t.status === 'Completed').map(t => ({ icon: 'fa-check-circle', title: 'Ticket Completed', message: `#${t.ticket_code} is ready for your review.`, read: false }))
        ];
        const badge = document.getElementById('notificationBadge');
        if (badge) { badge.textContent = notifs.length; badge.style.display = notifs.length > 0 ? 'inline-block' : 'none'; }
        const list = document.getElementById('notificationList');
        if (list) {
            list.innerHTML = notifs.length === 0
                ? '<div class="empty-state" style="padding:24px;">No new notifications.</div>'
                : notifs.map(n => `
                    <div class="notification-item ${n.read ? '' : 'unread'}">
                        <div class="notification-icon-small"><i class="fas ${n.icon}"></i></div>
                        <div class="notification-content"><p><strong>${escapeHtml(n.title)}</strong><br>${escapeHtml(n.message)}</p></div>
                    </div>`).join('');
        }
        // NOTE: 'Mark all read' click handler is bound once in initNotificationBell(),
        // NOT here. Previously this function re-bound it on every refreshAll(), so the
        // handler ran N times per click after N refreshes.
    }

    // ─── UI helpers ───────────────────────────────────────────────────────────
    function initNotificationBell() {
        document.getElementById('notificationBell')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = document.getElementById('notificationPanel');
            panel?.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#notificationWrapper')) {
                document.getElementById('notificationPanel')?.classList.remove('open');
            }
        });
        // Bind 'Mark all read' exactly once — buildNotifications() used to bind
        // it on every refresh, which produced N handlers after N refreshes.
        document.getElementById('markAllReadBtn')?.addEventListener('click', () => {
            document.querySelectorAll('.notification-item.unread').forEach(el => el.classList.remove('unread'));
            const badge = document.getElementById('notificationBadge');
            if (badge) badge.style.display = 'none';
        });
    }

    function initProfileDropdown() {
        document.getElementById('profileBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = document.getElementById('dropdownMenu');
            menu?.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#profileDropdown')) {
                document.getElementById('dropdownMenu')?.classList.remove('open');
            }
        });
        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            sessionStorage.removeItem('currentUser');
            window.location.href = 'Login.html';
        });
    }

    function initThemeToggle() {
        const toggle = document.getElementById('themeSwitchCheckbox');
        const icon   = document.getElementById('themeIcon');
        const isDark = localStorage.getItem('theme') === 'dark';
        if (toggle) toggle.checked = isDark;
        document.body.classList.toggle('dark-mode', isDark);
        if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';

        toggle?.addEventListener('change', (e) => {
            const dark = e.target.checked;
            document.body.classList.toggle('dark-mode', dark);
            localStorage.setItem('theme', dark ? 'dark' : 'light');
            if (icon) icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
        });
    }

    function initModalCloseHandlers() {
        document.getElementById('closeApprovalDetailBtn')?.addEventListener('click', () => closeModal('approvalDetailModal'));
        document.getElementById('closeDetailModalBtn')?.addEventListener('click', () => closeModal('requestDetailModal'));
        document.getElementById('closeResolveModalBtn')?.addEventListener('click',  () => closeModal('resolveConfirmModal'));
        document.getElementById('closeFeedbackModalBtn')?.addEventListener('click', () => closeModal('feedbackModal'));
        document.getElementById('closeRejectModalBtn')?.addEventListener('click',   () => closeModal('rejectModal'));
        document.getElementById('closeFullListBtn')?.addEventListener('click',      () => closeModal('fullListModal'));

        // Close on overlay click
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active'); });
        });

        // ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
        });

        initResolveConfirm();
        initRejectModal();
    }

    function openModal(id)  { document.getElementById(id)?.classList.add('active'); }
    function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

    function showToast(message, isError = false) {
        const toast = document.getElementById('toastMsg');
        if (!toast) return;
        toast.textContent = message;
        toast.style.background = isError ? '#c23a3a' : '#2c4c6e';
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
    }

    // ─── Formatting helpers ───────────────────────────────────────────────────
    function formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        try { return new Date(dateStr).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }); }
        catch { return dateStr; }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    }

    function getPriorityClass(p) {
        return { Critical:'priority-critical', High:'priority-high', Medium:'priority-medium', Low:'priority-low' }[p] || 'priority-low';
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
