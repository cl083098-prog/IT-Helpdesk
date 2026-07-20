// Dashboard.js - Admin Dashboard with authentication, calendar, and live DB data

(function () {
    'use strict';

    const API_BASE = '../api';

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
        document.addEventListener('DOMContentLoaded', initDashboard);
    } else {
        initDashboard();
    }

    // Holds the live data fetched from the DB so modals (View All) can reuse it
    let dashboardData = { new_tickets: [], aging_tickets: [], activities: [] };

    async function initDashboard() {
        initCalendar();
        initThemeToggle();
        initTicketRowClicks();
        await loadDashboardData();
    }

    // ─── Open a ticket's "Request Details" overlay in place on the Dashboard ──
    // Reused by the New/Aging Tickets row clicks below and by the "View All"
    // modal row clicks (wired up in Dashboard.html). Dashboard.html also loads
    // ServiceRequest.js + ServiceRequest.css so window.openTicketDetails (the
    // exact same editable overlay used on the Service Request page — assign,
    // status, SLA, reply) is available without navigating away. Falls back to
    // navigating there directly only if that script somehow didn't load.
    function goToTicket(ticketId) {
        if (!ticketId) return;
        if (typeof window.openTicketDetails === 'function') {
            window.openTicketDetails(ticketId);
        } else {
            window.location.href = `ServiceRequest.html?view=${encodeURIComponent(String(ticketId).replace(/^#/, ''))}`;
        }
    }

    // ─── Click-to-view wiring for the merged tickets feed ─────────────────────
    // Delegated on the (persistent) list container rather than the individual
    // .ticket-item rows, since renderTicketsFeed() replaces innerHTML on every
    // refresh.
    function initTicketRowClicks() {
        const container = document.getElementById('ticketsFeedList');
        if (!container) return;
        container.addEventListener('click', e => {
            const item = e.target.closest('.ticket-item[data-ticket-id]');
            if (item) goToTicket(item.dataset.ticketId);
        });
    }

    // ─── Fetch live data from PHP/MySQL ───────────────────────────────────────
    async function loadDashboardData() {
        try {
            const res  = await fetch(`${API_BASE}/get_dashboard_data.php`);
            const json = await res.json();

            if (!json.success) {
                console.error('Dashboard data error:', json.message);
                showEmptyStates();
                return;
            }

            dashboardData = json;
            renderStats(json.stats);
            renderTicketsFeed(json.new_tickets, json.aging_tickets);
            renderActivities(json.activities);

        } catch (err) {
            console.error('Failed to load dashboard data:', err);
            showEmptyStates();
        }
    }

    // ─── Render: stat cards (top row + bottom row) ────────────────────────────
    function renderStats(stats) {
        const set = (selector, val) => {
            document.querySelectorAll(selector).forEach(el => { el.innerText = val; });
        };
        set('[data-stat="total"]',     stats.total_requests);
        set('[data-stat="pending"]',   stats.pending_requests);
        set('[data-stat="ongoing"]',   stats.ongoing_requests);
        set('[data-stat="completed"]', stats.completed_requests);
        set('[data-stat="lowstock"]',  stats.low_stock_items);
        set('[data-stat="invvalue"]',  formatCurrency(stats.total_inventory_value || 0));
    }

    // ─── Render: merged tickets feed (New Open + Aging) ────────────────────────
    // RESTYLED: New Open Tickets and Aging Tickets used to be two separate
    // panels/sections; now they're one flat list under a single "New open
    // tickets" header — new tickets first (ID + requester, green "Open" pill),
    // then aging tickets (title + "ID · priority", red day-count), each row
    // still carrying data-ticket-id for click-to-view. No data/logic change —
    // same `t` fields as before, just merged into one container/template pass.
    function renderTicketsFeed(newTickets, agingTickets) {
        const container = document.getElementById('ticketsFeedList');
        if (!container) return;

        const newRows = (newTickets || []).slice(0, 3).map(t => `
            <div class="ticket-item ticket-row-new ${getPriorityClass(t.priority)}" data-ticket-id="${escapeHtml(t.id)}">
                <div class="ticket-id">${escapeHtml(t.id)}</div>
                <div class="ticket-requester">${escapeHtml(t.requester)}</div>
                <span class="status-badge status-open">Open</span>
            </div>
        `);

        const agingRows = (agingTickets || []).slice(0, 3).map(t => `
            <div class="ticket-item ${getPriorityClass(t.priority)}" data-ticket-id="${escapeHtml(t.id)}">
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-id">${escapeHtml(t.id)} · ${escapeHtml(t.priority)}</div>
                <div class="ticket-meta">${escapeHtml(t.days)}</div>
            </div>
        `);

        const rows = newRows.concat(agingRows);
        container.innerHTML = rows.length
            ? rows.join('')
            : '<div class="empty-modal-message">No tickets to show right now.</div>';
    }

    // ─── Render: Recent Activities panel ───────────────────────────────────────
    // TEMPLATE TWEAK (approved): previously rendered one flat sentence per row.
    // Now best-effort splits the API's single combined `title` string
    // ("Ticket #ID: message") into a bold ticket ID + the message as its own
    // description line, plus a small event-count badge next to the panel
    // heading (#activitiesCount in Dashboard.html). No new data is fetched —
    // get_dashboard_data.php only ever returns {title, time, icon} per
    // activity. Two things this can't do without a backend change:
    //   1. A "by [Name]" actor line — the SQL query selects a.author_name but
    //      the PHP endpoint doesn't include it in the JSON response, so it's
    //      simply not available here. Omitted rather than faked.
    //   2. A guaranteed-accurate status field — there isn't one, so the status
    //      pill below is a HEURISTIC guess from keywords in the message text
    //      (closed/resolved, ongoing, pending/confirmation, approved). It can
    //      mis-classify messages that don't contain those words, and shows no
    //      pill at all rather than a wrong guess in that case.
    function renderActivities(activities) {
        const container = document.getElementById('activitiesList');
        if (!container) return;

        const countBadge = document.getElementById('activitiesCount');
        if (countBadge) {
            countBadge.textContent = (activities && activities.length) ? `${activities.length} events` : '';
        }

        if (!activities || activities.length === 0) {
            container.innerHTML = '<div class="empty-modal-message">No recent activity yet.</div>';
            return;
        }

        container.innerHTML = activities.slice(0, 4).map(a => {
            const match       = /^Ticket #(\S+):\s*(.*)$/.exec(a.title || '');
            const ticketId    = match ? match[1] : '';
            const description = match ? match[2] : (a.title || '');

            let statusLabel = '';
            let statusClass = '';
            if (/closed|resolved/i.test(description)) {
                statusLabel = 'Closed';    statusClass = 'activity-status-closed';
            } else if (/ongoing/i.test(description)) {
                statusLabel = 'Ongoing';   statusClass = 'activity-status-ongoing';
            } else if (/pending|confirmation/i.test(description)) {
                statusLabel = 'Pending';   statusClass = 'activity-status-pending';
            } else if (/approved/i.test(description)) {
                statusLabel = 'Approved';  statusClass = 'activity-status-approved';
            }

            return `
                <div class="activity-item">
                    <div class="activity-details">
                        <div class="activity-title">
                            ${ticketId ? `<strong>#${escapeHtml(ticketId)}</strong>` : ''}
                            ${statusLabel ? `<span class="activity-status-badge ${statusClass}">${statusLabel}</span>` : ''}
                        </div>
                        <div class="activity-desc">${escapeHtml(description)}</div>
                    </div>
                    <div class="activity-time">${escapeHtml(a.time)}</div>
                </div>
            `;
        }).join('');
    }

    function showEmptyStates() {
        const msg = '<div class="empty-modal-message">Could not load data. Check your connection.</div>';
        ['ticketsFeedList', 'activitiesList'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = msg;
        });
    }

    // ─── Currency helper (kept for future Inventory page use) ─────────────────
    function formatCurrency(amount) {
        return `\u20b1${Number(amount).toLocaleString('en-PH', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })}`;
    }

    // ─── Shared helpers (also used by modal "View All" handlers in Dashboard.html) ─
    function getPriorityClass(priority) {
        switch (priority) {
            case 'Critical': return 'priority-critical';
            case 'High':     return 'priority-high';
            case 'Medium':   return 'priority-medium';
            case 'Low':      return 'priority-low';
            default:         return 'priority-medium';
        }
    }

    function getPriorityBadgeClass(priority) {
        switch (priority) {
            case 'Critical': return 'critical';
            case 'High':     return 'high';
            case 'Medium':   return 'medium';
            case 'Low':      return 'low';
            default:         return 'medium';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function initCalendar() {
        const calendarDates = document.getElementById('calendarDates');
        if (!calendarDates) return;

        const today        = new Date();
        const currentYear  = today.getFullYear();
        const currentMonth = today.getMonth();
        const todayDate    = today.getDate();

        const monthNames = [
            'January','February','March','April','May','June',
            'July','August','September','October','November','December'
        ];

        const calendarMonth = document.getElementById('calendarMonth');
        if (calendarMonth) {
            calendarMonth.innerText = `${monthNames[currentMonth]} ${currentYear}`;
        }

        const firstDayOfMonth  = new Date(currentYear, currentMonth, 1);
        const startingDay      = firstDayOfMonth.getDay();
        const daysInMonth      = new Date(currentYear, currentMonth + 1, 0).getDate();
        const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();

        let html = '';

        // Previous-month filler days
        for (let i = startingDay - 1; i >= 0; i--) {
            html += `<span class="prev-month">${prevMonthLastDay - i}</span>`;
        }

        // Current month
        for (let i = 1; i <= daysInMonth; i++) {
            html += `<span${i === todayDate ? ' class="today"' : ''}>${i}</span>`;
        }

        // Next-month filler to complete 6 rows (42 cells)
        const totalCells    = 42;
        const remaining     = totalCells - (startingDay + daysInMonth);
        for (let i = 1; i <= remaining; i++) {
            html += `<span class="next-month">${i}</span>`;
        }

        calendarDates.innerHTML = html;
    }

    function initThemeToggle() {
        const themeSwitch = document.getElementById('themeSwitchCheckbox');
        const themeIcon = document.getElementById('themeIcon');
        if (!themeSwitch || !themeIcon) return;

        const savedTheme = localStorage.getItem('theme');
        const isDark = savedTheme === 'dark' ||
            (savedTheme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        themeSwitch.checked = isDark;
        document.body.classList.toggle('dark-mode', isDark);
        themeIcon.className = isDark ? 'ti ti-sun' : 'ti ti-moon';

        themeSwitch.addEventListener('change', e => {
            const dark = e.target.checked;
            document.body.classList.toggle('dark-mode', dark);
            localStorage.setItem('theme', dark ? 'dark' : 'light');
            themeIcon.className = dark ? 'ti ti-sun' : 'ti ti-moon';
        });
    }

    // Expose globally so inline scripts in Dashboard.html can use them
    window.formatCurrency        = formatCurrency;
    window.getDashboardData      = () => dashboardData;
    window.getPriorityClass      = getPriorityClass;
    window.getPriorityBadgeClass = getPriorityBadgeClass;
    window.escapeHtmlDashboard   = escapeHtml;
    window.goToTicket            = goToTicket;
    // Lets ServiceRequest.js's detail overlay (opened in place, see goToTicket
    // above) refresh these widgets on close so edits made there show up here
    // without a manual page reload.
    window.refreshDashboardWidgets = loadDashboardData;
})();