// SchoolAdmin.js
// Single-page application controller for the School Admin portal.
// View-only access: no create/edit/delete except IT Admin password reset.

(function () {
    'use strict';

    const API = '../api/school-admin-data.php';

    // ─── Auth ─────────────────────────────────────────────────────────────────
    let currentUser = null;
    (function checkAuth() {
        const raw = sessionStorage.getItem('currentUser');
        if (!raw) { window.location.replace('Login.html'); return; }
        try { currentUser = JSON.parse(raw); } catch (e) { sessionStorage.removeItem('currentUser'); window.location.replace('Login.html'); return; }
        if (currentUser.role !== 'school_admin') {
            const dest = { admin:'Dashboard.html', dept_head:'DeptHeadDashboard.html', requester:'RequesterDashboard.html' };
            window.location.replace(dest[currentUser.role] || 'Login.html');
        }
    })();
    const USER_ID   = currentUser?.id;
    const USER_NAME = currentUser?.name || 'School Admin';

    // ─── State ────────────────────────────────────────────────────────────────
    let currentSection    = 'dashboard';
    let srStatusFilter    = 'all';
    let invTabFilter      = 'all';
    let umSubTab          = 'users';
    let selectedExportFmt = 'PDF';
    let pendingResetUserId = null;

    // ─── Boot ─────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }

    async function init() {
        applyUserInfo();
        initTheme();
        initNavigation();
        initModalCloseHandlers();
        initNotifBell();
        initServiceRequestFilters();
        initInventoryFilters();
        initFeedbackFilters();
        initUserManagementFilters();
        initReportsSection();
        initShortcutTiles();
        initMarkAllRead();

        await navigateTo('dashboard');
        loadNotifications();
    }

    // ─── User info ────────────────────────────────────────────────────────────
    function applyUserInfo() {
        const el = document.getElementById('sidebarUserName');
        if (el) el.textContent = USER_NAME;
    }

    // ─── Theme ────────────────────────────────────────────────────────────────
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

    // ─── Navigation ───────────────────────────────────────────────────────────
    function initNavigation() {
        document.querySelectorAll('.nav-item[data-section]').forEach(link => {
            link.addEventListener('click', e => { e.preventDefault(); navigateTo(link.dataset.section); });
        });
        document.getElementById('sidebarLogoutBtn')?.addEventListener('click', doLogout);
    }

    async function navigateTo(section) {
        currentSection = section;
        document.querySelectorAll('.sa-section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-item[data-section]').forEach(l => l.classList.remove('active'));
        const sectionEl = document.getElementById(`section-${section}`);
        const navEl     = document.querySelector(`.nav-item[data-section="${section}"]`);
        if (sectionEl) sectionEl.classList.add('active');
        if (navEl)     navEl.classList.add('active');

        const titles = { dashboard:'Dashboard', 'service-requests':'Service Requests', inventory:'Inventory',
            'cost-analysis':'Cost Analysis', feedback:'Feedback Monitoring', reports:'Reports',
            'user-management':'User Management', notifications:'Notifications' };
        const titleEl = document.getElementById('pageTitle');
        if (titleEl) titleEl.textContent = titles[section] || section;

        const loaders = {
            dashboard:          loadDashboard,
            'service-requests': loadServiceRequests,
            inventory:          loadInventory,
            'cost-analysis':    loadCostAnalysis,
            feedback:           loadFeedback,
            reports:            loadReports,
            'user-management':  loadUserManagement,
            notifications:      loadNotificationsPage,
        };
        if (loaders[section]) await loaders[section]();
    }

    function initShortcutTiles() {
        document.querySelectorAll('.shortcut-tile[data-goto]').forEach(tile => {
            tile.addEventListener('click', () => navigateTo(tile.dataset.goto));
        });
    }

    // ─── Dashboard ────────────────────────────────────────────────────────────
    async function loadDashboard() {
        const json = await apiFetch(`${API}?action=get_dashboard`);
        if (!json?.success) return;

        const s = json.stats;
        const setAll = (attr, val) => document.querySelectorAll(`[data-stat="${attr}"]`).forEach(el => el.textContent = val);
        setAll('total',     s.total);
        setAll('pending',   s.pending);
        setAll('ongoing',   s.ongoing);
        setAll('completed', s.completed);
        setAll('low_stock', s.low_stock);
        setAll('inv_value', formatPeso(s.inv_value));

        const container = document.getElementById('dashboardActivityList');
        if (!container) return;
        if (!json.recent_activities?.length) { container.innerHTML = '<div class="empty-msg">No recent activities logged.</div>'; return; }
        container.innerHTML = json.recent_activities.map(a => `
            <div class="activity-item">
                <div class="activity-icon"><i class="fas fa-history"></i></div>
                <div class="activity-details">
                    <div class="activity-action">${escHtml(a.action)}</div>
                    <div class="activity-meta">${escHtml(a.user_name)} · ${escHtml(a.module)} · ${formatDate(a.created_at)}</div>
                </div>
            </div>`).join('');
    }

    // ─── Service Requests ─────────────────────────────────────────────────────
    function initServiceRequestFilters() {
        document.querySelectorAll('.tab-btn[data-filter-status]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn[data-filter-status]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                srStatusFilter = btn.dataset.filterStatus;
                loadServiceRequests();
            });
        });
        ['srDeptFilter','srPriorityFilter'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', loadServiceRequests);
        });
        let srSearchTimer;
        document.getElementById('srSearch')?.addEventListener('input', e => {
            clearTimeout(srSearchTimer);
            srSearchTimer = setTimeout(loadServiceRequests, 320);
        });
    }

    async function loadServiceRequests() {
        const dept     = document.getElementById('srDeptFilter')?.value     || 'all';
        const priority = document.getElementById('srPriorityFilter')?.value || 'all';
        const search   = document.getElementById('srSearch')?.value         || '';
        const params   = new URLSearchParams({ action:'get_service_requests', status:srStatusFilter, department:dept, priority, search });
        const json     = await apiFetch(`${API}?${params}`);
        if (!json?.success) return;

        // Summary cards
        const c = json.counts || {};
        const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s('srTotal', json.total); s('srPending', c.Pending||0); s('srOngoing', c.Ongoing||0);
        s('srCompleted', c.Completed||0); s('srClosed', c.Closed||0);

        const tbody = document.getElementById('srTableBody');
        if (!tbody) return;
        if (!json.data?.length) { tbody.innerHTML = `<tr><td colspan="11" class="empty-msg">No service requests found.</td></tr>`; return; }

        tbody.innerHTML = json.data.map(t => `
            <tr>
                <td><strong style="color:#1f6392;">#${escHtml(t.ticket_code)}</strong></td>
                <td>${escHtml(t.requester)}</td>
                <td>${escHtml(t.department)}</td>
                <td>${escHtml(t.category)}</td>
                <td><span class="badge badge-${(t.priority||'').toLowerCase()}">${escHtml(t.priority)}</span></td>
                <td><span class="badge badge-${(t.status||'').toLowerCase()}">${escHtml(t.status)}</span></td>
                <td>${formatDate(t.submitted_at)}</td>
                <td>${t.status==='Completed'||t.status==='Closed' ? formatDate(t.updated_at) : '—'}</td>
                <td>${t.status==='Closed' ? formatDate(t.closed_at) : '—'}</td>
                <td>${escHtml(t.assigned_to||'Awaiting')}</td>
                <td><button class="btn-view" data-ticket-id="${t.id}">View</button></td>
            </tr>`).join('');

        tbody.querySelectorAll('.btn-view[data-ticket-id]').forEach(btn => {
            btn.addEventListener('click', () => openTicketDetail(Number(btn.dataset.ticketId)));
        });
    }

    async function openTicketDetail(ticketId) {
        const modal = document.getElementById('ticketDetailModal');
        const body  = document.getElementById('ticketDetailBody');
        if (!modal || !body) return;
        body.innerHTML = '<div class="loading-msg">Loading…</div>';
        modal.classList.add('active');

        const json = await apiFetch(`${API}?action=get_ticket_detail&ticket_id=${ticketId}`);
        if (!json?.success) { body.innerHTML = '<div class="empty-msg">Could not load ticket.</div>'; return; }
        const t = json.ticket;

        const convHtml = t.conversations?.length ? t.conversations.map(c => `
            <div class="conv-item">
                <div class="conv-author">${escHtml(c.author_name)} <span class="conv-time">${formatDate(c.created_at)}</span></div>
                <div class="conv-msg">${escHtml(c.message)}</div>
            </div>`).join('') : '<div class="empty-msg">No conversation history.</div>';

        const approvalHtml = t.approval ? `
            <div class="detail-section-title">Department Head Approval</div>
            <div class="approval-block">
                <div class="detail-grid">
                    <div class="detail-item"><span class="detail-label">Status</span><span class="detail-value"><span class="badge badge-${(t.approval.decision||'').toLowerCase().replace(' ','-')}">${escHtml(t.approval.decision)}</span></span></div>
                    <div class="detail-item"><span class="detail-label">Decided By</span><span class="detail-value">${escHtml(t.approval.decided_by)}</span></div>
                    <div class="detail-item"><span class="detail-label">Decided At</span><span class="detail-value">${formatDate(t.approval.decided_at)}</span></div>
                    ${t.approval.estimated_cost ? `<div class="detail-item"><span class="detail-label">Estimated Cost</span><span class="detail-value">${formatPeso(t.approval.estimated_cost)}</span></div>` : ''}
                    ${t.approval.rejection_note ? `<div class="detail-item"><span class="detail-label">Rejection Note</span><span class="detail-value">${escHtml(t.approval.rejection_note)}</span></div>` : ''}
                </div>
            </div>` : '';

        body.innerHTML = `
            <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">Ticket ID</span><span class="detail-value">#${escHtml(t.ticket_code)}</span></div>
                <div class="detail-item"><span class="detail-label">Status</span><span class="detail-value"><span class="badge badge-${(t.status||'').toLowerCase()}">${escHtml(t.status)}</span></span></div>
                <div class="detail-item"><span class="detail-label">Priority</span><span class="detail-value"><span class="badge badge-${(t.priority||'').toLowerCase()}">${escHtml(t.priority)}</span></span></div>
                <div class="detail-item"><span class="detail-label">Category</span><span class="detail-value">${escHtml(t.category)}</span></div>
                <div class="detail-item"><span class="detail-label">Equipment/Item</span><span class="detail-value">${escHtml(t.equipment_item)}</span></div>
                <div class="detail-item"><span class="detail-label">Requester</span><span class="detail-value">${escHtml(t.requester)}</span></div>
                <div class="detail-item"><span class="detail-label">Department</span><span class="detail-value">${escHtml(t.department)}</span></div>
                <div class="detail-item"><span class="detail-label">Assigned To</span><span class="detail-value">${escHtml(t.assigned_to||'Awaiting')}</span></div>
                <div class="detail-item"><span class="detail-label">Date Submitted</span><span class="detail-value">${formatDate(t.submitted_at)}</span></div>
                <div class="detail-item"><span class="detail-label">Approval Status</span><span class="detail-value"><span class="badge badge-${(t.approval_status||'').toLowerCase().replace(' ','-')}">${escHtml(t.approval_status||'Not Required')}</span></span></div>
            </div>
            <div class="detail-section-title">Issue Details</div>
            <div class="detail-item"><span class="detail-label">Title</span><span class="detail-value">${escHtml(t.title)}</span></div>
            <div class="detail-item" style="margin-top:8px;"><span class="detail-label">Description</span><span class="detail-value">${escHtml(t.description||'—')}</span></div>
            <div class="sla-block" style="margin-top:16px;">
                <div class="sla-row"><span class="sla-lbl"><i class="fas fa-hourglass-half"></i> Expected Resolution</span><span class="sla-val">${t.priority==='High'||t.priority==='Critical' ? '30 min' : '2 business days'}</span></div>
                <div class="sla-row"><span class="sla-lbl"><i class="fas fa-clock"></i> SLA Deadline</span><span class="sla-val">${t.resolution_due_at ? formatDate(t.resolution_due_at) : '—'}</span></div>
            </div>
            ${approvalHtml}
            <div class="detail-section-title">Conversation &amp; Follow-ups</div>
            ${convHtml}`;
    }

    // ─── Inventory ────────────────────────────────────────────────────────────
    function initInventoryFilters() {
        document.querySelectorAll('.tab-btn[data-inv-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn[data-inv-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active'); invTabFilter = btn.dataset.invTab; loadInventory();
            });
        });
        let invTimer;
        document.getElementById('invSearch')?.addEventListener('input', () => { clearTimeout(invTimer); invTimer = setTimeout(loadInventory, 320); });
    }

    async function loadInventory() {
        const search = document.getElementById('invSearch')?.value || '';
        const params = new URLSearchParams({ action:'get_inventory', tab:invTabFilter, search });
        const json   = await apiFetch(`${API}?${params}`);
        if (!json?.success) return;

        const sm = json.summary || {};
        const s  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s('invEquipQty',   sm.equip_qty   || 0);
        s('invConsQty',    sm.cons_qty    || 0);
        s('invEquipTypes', sm.equip_types || 0);
        s('invConsTypes',  sm.cons_types  || 0);
        s('invLowStock',   sm.low_stock   || 0);
        s('invOversupply', sm.oversupply  || 0);

        const tbody = document.getElementById('invTableBody');
        if (!tbody) return;

        if (invTabFilter === 'allocated') {
            if (!json.data?.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">No allocated items.</td></tr>'; return; }
            tbody.innerHTML = json.data.map(a => `
                <tr>
                    <td>${escHtml(a.item_name)}</td><td>${escHtml(a.type)}</td><td>—</td>
                    <td>${a.quantity}</td><td>—</td><td>—</td>
                    <td>${escHtml(a.department)}</td>
                    <td><span class="badge badge-ongoing">Allocated</span></td>
                </tr>`).join('');
            return;
        }

        if (!json.data?.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">No inventory items found.</td></tr>'; return; }
        tbody.innerHTML = json.data.map(i => {
            const statusBadge = i.stock_status === 'Low Stock' ? 'badge-critical' : i.stock_status === 'Oversupply' ? 'badge-high' : 'badge-completed';
            return `<tr>
                <td><strong>${escHtml(i.name)}</strong></td>
                <td>${escHtml(i.type)}</td><td>${escHtml(i.category)}</td>
                <td>${i.quantity}</td>
                <td>${formatPeso(i.price_unit)}</td>
                <td>${formatPeso(i.total_value)}</td>
                <td>${escHtml(i.department)}</td>
                <td><span class="badge ${statusBadge}">${escHtml(i.stock_status)}</span></td>
            </tr>`;
        }).join('');
    }

    // ─── Cost Analysis ────────────────────────────────────────────────────────
    async function loadCostAnalysis() {
        const json = await apiFetch(`${API}?action=get_cost_analysis`);
        if (!json?.success) return;

        const t = json.totals || {};
        const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s('caRepair',      formatPeso(t.repair     || 0));
        s('caMaintenance', formatPeso(t.maintenance || 0));
        s('caReplacement', formatPeso(t.replacement || 0));
        s('caGrandTotal',  formatPeso(t.grand_total || 0));

        // Dept table
        const deptBody = document.getElementById('caDeptBody');
        if (deptBody) {
            deptBody.innerHTML = json.by_department?.length
                ? json.by_department.map(d => `<tr>
                    <td>${escHtml(d.department)}</td>
                    <td>${formatPeso(d.repair_cost)}</td>
                    <td>${formatPeso(d.maintenance_cost)}</td>
                    <td><strong>${formatPeso(d.total_cost)}</strong></td>
                  </tr>`).join('')
                : '<tr><td colspan="4" class="empty-msg">No cost data yet.</td></tr>';
        }

        // Cat table
        const catBody = document.getElementById('caCatBody');
        if (catBody) {
            const grandTotal = parseFloat(t.grand_total || 1) || 1;
            catBody.innerHTML = json.by_category?.length
                ? json.by_category.map(c => `<tr>
                    <td>${escHtml(c.category)}</td>
                    <td>${formatPeso(c.total_cost)}</td>
                    <td>${c.ticket_count}</td>
                    <td>${((parseFloat(c.total_cost)||0)/grandTotal*100).toFixed(1)}%</td>
                  </tr>`).join('')
                : '<tr><td colspan="4" class="empty-msg">No cost data yet.</td></tr>';
        }

        // Monthly trend — simple bar-style using CSS flex (no external chart lib required)
        const chartWrapper = document.getElementById('caChartWrapper');
        if (chartWrapper && json.monthly_trend?.length) {
            const maxVal = Math.max(...json.monthly_trend.map(m => parseFloat(m.total)||0), 1);
            chartWrapper.innerHTML = `<div style="display:flex;gap:12px;align-items:flex-end;height:140px;padding:0 8px;">
                ${json.monthly_trend.map(m => {
                    const pct = ((parseFloat(m.total)||0)/maxVal*100).toFixed(1);
                    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;">
                        <span style="font-size:0.68rem;color:#6c86a0;font-weight:600;">${formatPeso(m.total)}</span>
                        <div style="width:100%;background:#1f6392;border-radius:6px 6px 0 0;height:${pct}%;min-height:4px;transition:height 0.4s;" title="${m.month}: ${formatPeso(m.total)}"></div>
                        <span style="font-size:0.7rem;color:#95a5a6;">${m.month?.slice(5)}</span>
                    </div>`;
                }).join('')}
            </div>`;
        } else if (chartWrapper) {
            chartWrapper.innerHTML = '<div class="empty-msg">No expense trend data yet.</div>';
        }
    }

    // ─── Feedback ─────────────────────────────────────────────────────────────
    function initFeedbackFilters() {
        ['fbRatingFilter','fbDeptFilter','fbRespondedFilter','fbDateFrom','fbDateTo'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', loadFeedback);
        });
    }

    async function loadFeedback() {
        const rating    = document.getElementById('fbRatingFilter')?.value  || '0';
        const dept      = document.getElementById('fbDeptFilter')?.value    || 'all';
        const responded = document.getElementById('fbRespondedFilter')?.value || 'all';
        const dateFrom  = document.getElementById('fbDateFrom')?.value      || '';
        const dateTo    = document.getElementById('fbDateTo')?.value        || '';
        const params    = new URLSearchParams({ action:'get_feedback', rating, department:dept, responded, date_from:dateFrom, date_to:dateTo });
        const json      = await apiFetch(`${API}?${params}`);
        if (!json?.success) return;

        const sm = json.summary || {};
        const s  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s('fbAvgRating', sm.avg_rating ? Number(sm.avg_rating).toFixed(1) + ' ★' : '—');
        s('fbTotal',    sm.total    || 0);
        s('fbPositive', sm.positive || 0);
        s('fbNegative', sm.negative || 0);

        const tbody = document.getElementById('fbTableBody');
        if (!tbody) return;
        if (!json.data?.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No feedback found.</td></tr>'; return; }

        tbody.innerHTML = json.data.map(f => `
            <tr>
                <td>${escHtml(f.requester_name)}</td>
                <td>#${escHtml(f.ticket_code)}</td>
                <td>${'★'.repeat(f.rating)}${'☆'.repeat(5-f.rating)}</td>
                <td>${escHtml((f.comment||'—').substring(0,60))}${(f.comment||'').length>60?'…':''}</td>
                <td>${escHtml(f.department)}</td>
                <td>${formatDate(f.submitted_at)}</td>
                <td><button class="btn-view" data-fb='${JSON.stringify(f).replace(/'/g,"&apos;")}'>View</button></td>
            </tr>`).join('');

        tbody.querySelectorAll('.btn-view[data-fb]').forEach(btn => {
            btn.addEventListener('click', () => {
                try { openFeedbackDetail(JSON.parse(btn.dataset.fb)); } catch(e) {}
            });
        });
    }

    function openFeedbackDetail(f) {
        const modal = document.getElementById('feedbackDetailModal');
        const body  = document.getElementById('feedbackDetailBody');
        if (!modal||!body) return;
        body.innerHTML = `
            <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">Requester</span><span class="detail-value">${escHtml(f.requester_name)}</span></div>
                <div class="detail-item"><span class="detail-label">Email</span><span class="detail-value">${escHtml(f.requester_email||'—')}</span></div>
                <div class="detail-item"><span class="detail-label">Department</span><span class="detail-value">${escHtml(f.department)}</span></div>
                <div class="detail-item"><span class="detail-label">Ticket Reference</span><span class="detail-value">#${escHtml(f.ticket_code)}: ${escHtml(f.ticket_title)}</span></div>
            </div>
            <div class="detail-section-title">Rating</div>
            <div class="star-display" style="font-size:1.4rem;margin-bottom:12px;">${'<i class="fas fa-star filled"></i>'.repeat(f.rating)}${'<i class="fas fa-star"></i>'.repeat(5-f.rating)}</div>
            <div class="detail-section-title">Comment</div>
            <div class="detail-value" style="background:#f8fafc;padding:14px;border-radius:12px;">${escHtml(f.comment||'No comment provided.')}</div>
            <div class="detail-section-title">Submission</div>
            <div class="detail-value">Date Submitted: ${formatDate(f.submitted_at)}</div>`;
        modal.classList.add('active');
    }

    // ─── Reports ──────────────────────────────────────────────────────────────
    function initReportsSection() {
        document.querySelectorAll('.export-btn[data-fmt]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.export-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedExportFmt = btn.dataset.fmt;
            });
        });

        document.getElementById('generateReportBtn')?.addEventListener('click', async () => {
            const reportType = document.getElementById('reportType')?.value     || 'ServiceRequest';
            const dateFrom   = document.getElementById('reportDateFrom')?.value || '';
            const dateTo     = document.getElementById('reportDateTo')?.value   || '';
            const reportName = `${reportType} Report${dateFrom ? ` (${dateFrom} to ${dateTo||'now'})` : ''} — ${selectedExportFmt}`;

            showToast(`Generating ${reportName}…`);

            // Log the report generation
            await apiFetch(API, {
                method: 'POST',
                body: JSON.stringify({ action:'log_report', user_id:USER_ID, report_name:reportName,
                    report_type:reportType, date_from:dateFrom, date_to:dateTo, export_format:selectedExportFmt })
            });

            // In a full implementation, generate and download the actual file here.
            // For now we show a confirmation and refresh the recent reports list.
            showToast(`✅ ${reportName} logged. Implement file generation for production.`);
            await loadReports();
        });
    }

    async function loadReports() {
        const json = await apiFetch(`${API}?action=get_recent_reports&user_id=${USER_ID}`);
        const tbody = document.getElementById('recentReportsBody');
        if (!tbody) return;
        if (!json?.data?.length) { tbody.innerHTML = '<tr><td colspan="3" class="empty-msg">No reports generated yet.</td></tr>'; return; }
        tbody.innerHTML = json.data.map(r => `
            <tr>
                <td>${escHtml(r.report_name)}</td>
                <td>${formatDate(r.created_at)}</td>
                <td><span class="badge badge-${r.export_format==='PDF'?'high':r.export_format==='Excel'?'completed':'ongoing'}">${escHtml(r.export_format)}</span></td>
            </tr>`).join('');
    }

    // ─── User Management ──────────────────────────────────────────────────────
    function initUserManagementFilters() {
        ['umRoleFilter','umStatusFilter'].forEach(id => document.getElementById(id)?.addEventListener('change', loadUsers));
        let umTimer; document.getElementById('umSearch')?.addEventListener('input', () => { clearTimeout(umTimer); umTimer = setTimeout(loadUsers, 320); });

        document.querySelectorAll('.tab-btn[data-um-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn[data-um-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active'); umSubTab = btn.dataset.umTab;
                document.getElementById('umUsersSection').style.display  = umSubTab==='users'  ? '' : 'none';
                document.getElementById('umAuditSection').style.display  = umSubTab==='audit'  ? '' : 'none';
                if (umSubTab==='audit') loadAuditLog();
            });
        });
        ['auditModuleFilter','auditRoleFilter','auditDateFrom','auditDateTo'].forEach(id =>
            document.getElementById(id)?.addEventListener('change', loadAuditLog));
        let auditTimer; document.getElementById('auditSearch')?.addEventListener('input', () => { clearTimeout(auditTimer); auditTimer = setTimeout(loadAuditLog, 320); });
    }

    async function loadUserManagement() {
        await loadUsers();
        await loadAuditSummary();
    }

    async function loadAuditSummary() {
        const json = await apiFetch(`${API}?action=get_audit_log`);
        if (!json?.success) return;
        const sm = json.summary || {};
        const s  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        s('auditTotal',    sm.total           || 0);
        s('auditAdminAct', sm.it_admin_actions || 0);
        s('auditUserAct',  sm.user_actions     || 0);
        s('auditToday',    sm.today            || 0);
    }

    async function loadUsers() {
        const role   = document.getElementById('umRoleFilter')?.value   || 'all';
        const status = document.getElementById('umStatusFilter')?.value || 'all';
        const search = document.getElementById('umSearch')?.value       || '';
        const json   = await apiFetch(`${API}?action=get_users&role=${role}&status=${status}&search=${encodeURIComponent(search)}`);
        const tbody  = document.getElementById('umTableBody');
        if (!tbody) return;
        if (!json?.data?.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No users found.</td></tr>'; return; }

        tbody.innerHTML = json.data.map(u => {
            const isItAdmin = u.role === 'admin';
            const resetBtn  = isItAdmin
                ? `<button class="btn-reset-pwd" data-uid="${u.id}" data-uname="${escHtml(u.full_name)}">Reset Pwd</button>`
                : '';
            return `<tr>
                <td>${u.id}</td>
                <td><strong>${escHtml(u.full_name)}</strong></td>
                <td>${escHtml(u.email)}</td>
                <td><span class="badge ${u.role==='admin'?'badge-ongoing':u.role==='school_admin'?'badge-required':'badge-completed'}">${roleLabel(u.role)}</span></td>
                <td><span class="badge ${u.is_active?'badge-completed':'badge-closed'}">${u.is_active?'Active':'Inactive'}</span></td>
                <td>${formatDate(u.created_at)}</td>
                <td>
                    <button class="btn-view" data-user='${JSON.stringify(u).replace(/'/g,"&apos;")}'>View</button>
                    ${resetBtn}
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('.btn-view[data-user]').forEach(btn => {
            btn.addEventListener('click', () => { try { openUserDetail(JSON.parse(btn.dataset.user)); } catch(e){} });
        });
        tbody.querySelectorAll('.btn-reset-pwd[data-uid]').forEach(btn => {
            btn.addEventListener('click', () => { pendingResetUserId = Number(btn.dataset.uid); openUserDetail({id:btn.dataset.uid, full_name:btn.dataset.uname, role:'admin'}, true); });
        });
    }

    function openUserDetail(u, showReset = false) {
        const modal = document.getElementById('userDetailModal');
        const body  = document.getElementById('userDetailBody');
        if (!modal||!body) return;
        const resetSection = (showReset || u.role==='admin') ? `
            <div class="detail-section-title">Reset Password (IT Admin only)</div>
            <div class="pwd-reset-form">
                <input type="password" id="newPwdInput" placeholder="New password (min 6 chars)">
                <button class="btn-primary-sa" style="padding:10px 20px;margin-top:0;" id="doResetPwdBtn">Reset</button>
            </div>` : '';
        body.innerHTML = `
            <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">ID</span><span class="detail-value">${u.id}</span></div>
                <div class="detail-item"><span class="detail-label">Full Name</span><span class="detail-value">${escHtml(u.full_name)}</span></div>
                <div class="detail-item"><span class="detail-label">Email</span><span class="detail-value">${escHtml(u.email||'—')}</span></div>
                <div class="detail-item"><span class="detail-label">Role</span><span class="detail-value">${roleLabel(u.role)}</span></div>
                <div class="detail-item"><span class="detail-label">Status</span><span class="detail-value">${u.is_active?'Active':'Inactive'}</span></div>
                <div class="detail-item"><span class="detail-label">Date Joined</span><span class="detail-value">${formatDate(u.created_at)}</span></div>
            </div>
            ${resetSection}`;
        modal.classList.add('active');

        document.getElementById('doResetPwdBtn')?.addEventListener('click', async () => {
            const newPwd = document.getElementById('newPwdInput')?.value.trim();
            if (!newPwd || newPwd.length < 6) { showToast('Password must be at least 6 characters.', true); return; }
            const json = await apiFetch(API, { method:'POST', body:JSON.stringify({ action:'reset_admin_password', user_id:u.id, new_password:newPwd, requestor_name:USER_NAME }) });
            if (json?.success) { showToast('✅ Password reset successfully.'); closeModal('userDetailModal'); }
            else showToast('Reset failed: ' + (json?.message||'Unknown error'), true);
        });
    }

    async function loadAuditLog() {
        const module   = document.getElementById('auditModuleFilter')?.value || 'all';
        const role     = document.getElementById('auditRoleFilter')?.value   || 'all';
        const search   = document.getElementById('auditSearch')?.value       || '';
        const dateFrom = document.getElementById('auditDateFrom')?.value     || '';
        const dateTo   = document.getElementById('auditDateTo')?.value       || '';
        const params   = new URLSearchParams({ action:'get_audit_log', module, role, search, date_from:dateFrom, date_to:dateTo });
        const json     = await apiFetch(`${API}?${params}`);

        const tbody = document.getElementById('auditTableBody');
        if (!tbody) return;
        if (!json?.data?.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">No activity logs found.</td></tr>'; return; }

        tbody.innerHTML = json.data.map(a => `
            <tr>
                <td>${a.id}</td>
                <td>${formatDate(a.created_at)}</td>
                <td>${escHtml(a.user_name)}</td>
                <td>${escHtml(a.user_role)}</td>
                <td>${escHtml(a.module)}</td>
                <td>${escHtml(a.action)}</td>
                <td><span class="badge ${a.status==='Success'?'badge-completed':a.status==='Failed'?'badge-critical':'badge-high'}">${escHtml(a.status)}</span></td>
                <td><button class="btn-view" data-audit='${JSON.stringify(a).replace(/'/g,"&apos;")}'>View</button></td>
            </tr>`).join('');

        tbody.querySelectorAll('.btn-view[data-audit]').forEach(btn => {
            btn.addEventListener('click', () => { try { openAuditDetail(JSON.parse(btn.dataset.audit)); } catch(e){} });
        });
    }

    function openAuditDetail(a) {
        const modal = document.getElementById('auditDetailModal');
        const body  = document.getElementById('auditDetailBody');
        if (!modal||!body) return;
        body.innerHTML = `
            <div class="detail-section-title">Log Information</div>
            <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">Log ID</span><span class="detail-value">${a.id}</span></div>
                <div class="detail-item"><span class="detail-label">Timestamp</span><span class="detail-value">${formatDate(a.created_at)}</span></div>
                <div class="detail-item"><span class="detail-label">Status</span><span class="detail-value"><span class="badge ${a.status==='Success'?'badge-completed':'badge-critical'}">${escHtml(a.status)}</span></span></div>
                <div class="detail-item"><span class="detail-label">IP Address</span><span class="detail-value">${escHtml(a.ip_address||'—')}</span></div>
            </div>
            <div class="detail-section-title">User Information</div>
            <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">User Name</span><span class="detail-value">${escHtml(a.user_name)}</span></div>
                <div class="detail-item"><span class="detail-label">User Role</span><span class="detail-value">${roleLabel(a.user_role)}</span></div>
            </div>
            <div class="detail-section-title">Activity Information</div>
            <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">Module</span><span class="detail-value">${escHtml(a.module)}</span></div>
                <div class="detail-item"><span class="detail-label">Action</span><span class="detail-value">${escHtml(a.action)}</span></div>
            </div>
            ${a.detail ? `<div class="detail-section-title">Details</div><div class="detail-value" style="background:#f8fafc;padding:12px;border-radius:10px;">${escHtml(a.detail)}</div>` : ''}`;
        modal.classList.add('active');
    }

    // ─── Notifications ────────────────────────────────────────────────────────
    async function loadNotifications() {
        const json = await apiFetch(`${API}?action=get_notifications&user_id=${USER_ID}`);
        if (!json?.success) return;
        const notifs = json.data || [];
        const unread = notifs.filter(n => !n.is_read).length;
        const badge  = document.getElementById('notifBadge');
        if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'inline-block' : 'none'; }

        const list = document.getElementById('notifList');
        if (list) {
            list.innerHTML = notifs.length === 0 ? '<div class="notif-empty">No notifications</div>'
                : notifs.slice(0,6).map(n => `
                <div class="notif-item ${n.is_read?'':'unread'}">
                    <div class="notif-item-title">${escHtml(n.title)}</div>
                    <div class="notif-item-desc">${escHtml(n.description||'')}</div>
                    <div class="notif-item-time">${formatDate(n.created_at)}</div>
                </div>`).join('');
        }
    }

    async function loadNotificationsPage() {
        const json = await apiFetch(`${API}?action=get_notifications&user_id=${USER_ID}`);
        const container = document.getElementById('notifFullList');
        if (!container) return;
        if (!json?.data?.length) { container.innerHTML = '<div class="empty-msg">No notifications yet.</div>'; return; }
        container.innerHTML = json.data.map(n => `
            <div class="notif-full-item ${n.is_read?'':'unread'}">
                <div class="notif-full-item-title">${escHtml(n.title)}</div>
                ${n.description ? `<div class="notif-full-item-desc">${escHtml(n.description)}</div>` : ''}
                <div class="notif-full-item-time">${formatDate(n.created_at)}</div>
            </div>`).join('');
    }

    function initMarkAllRead() {
        const handler = async () => {
            await apiFetch(API, { method:'POST', body:JSON.stringify({ action:'mark_notifications_read', user_id:USER_ID }) });
            loadNotifications();
            if (currentSection === 'notifications') loadNotificationsPage();
        };
        document.getElementById('markAllReadBtn')?.addEventListener('click', handler);
        document.getElementById('markAllReadPageBtn')?.addEventListener('click', handler);
    }

    // ─── Notification bell dropdown ───────────────────────────────────────────
    function initNotifBell() {
        const bell     = document.getElementById('notifBell');
        const dropdown = document.getElementById('notifDropdown');
        bell?.addEventListener('click', e => { e.stopPropagation(); dropdown?.classList.toggle('open'); });
        document.addEventListener('click', e => { if (!e.target.closest('#notifWrapper')) dropdown?.classList.remove('open'); });
    }

    // ─── Modals ───────────────────────────────────────────────────────────────
    function initModalCloseHandlers() {
        [['closeTicketModal','ticketDetailModal'],['closeUserModal','userDetailModal'],
         ['closeAuditModal','auditDetailModal'],['closeFeedbackModal','feedbackDetailModal']].forEach(([btnId, modalId]) => {
            document.getElementById(btnId)?.addEventListener('click', () => closeModal(modalId));
        });
        document.querySelectorAll('.sa-modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('active'); });
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') document.querySelectorAll('.sa-modal-overlay.active').forEach(m => m.classList.remove('active'));
        });
    }
    function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

    // ─── Logout ───────────────────────────────────────────────────────────────
    function doLogout() {
        const toast = document.getElementById('logoutToast');
        if (toast) { toast.classList.add('show'); }
        sessionStorage.removeItem('currentUser');
        setTimeout(() => window.location.href = 'Login.html', 1200);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    async function apiFetch(url, options = {}) {
        try {
            const res  = await fetch(url, { headers:{'Content-Type':'application/json'}, ...options });
            const json = await res.json();
            // FIX: don't discard the backend's real message on non-2xx responses.
            if (!res.ok) {
                console.error('API error:', json?.message || `HTTP ${res.status}`);
                return json ?? { success: false, message: `HTTP ${res.status}` };
            }
            return json;
        } catch (err) { console.error('API error:', err.message); return { success: false, message: 'Network error or invalid server response.' }; }
    }

    function showToast(msg, isError = false) {
        let t = document.getElementById('saToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'saToast';
            t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);padding:10px 24px;border-radius:40px;font-size:0.82rem;font-weight:600;z-index:9999;opacity:0;transition:opacity 0.2s;pointer-events:none;font-family:Inter,sans-serif;';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.background = isError ? '#c62828' : '#1f6392';
        t.style.color = 'white';
        t.style.opacity = '1';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2800);
    }

    function formatDate(str) {
        if (!str) return '—';
        try { return new Date(str).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
        catch { return str; }
    }

    function formatPeso(val) {
        const n = parseFloat(val) || 0;
        return '₱' + n.toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
    }

    function escHtml(str) {
        if (!str && str !== 0) return '';
        return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    function roleLabel(role) {
        return { admin:'IT Administrator', dept_head:'Department Head', requester:'Faculty / Staff', school_admin:'School Admin' }[role] || role;
    }

})();
