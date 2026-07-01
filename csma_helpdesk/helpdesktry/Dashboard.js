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
        await loadDashboardData();
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
            renderNewTickets(json.new_tickets);
            renderAgingTickets(json.aging_tickets);
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

    // ─── Render: New Open Tickets panel ────────────────────────────────────────
    function renderNewTickets(tickets) {
        const container = document.getElementById('newTicketsList');
        if (!container) return;

        if (!tickets || tickets.length === 0) {
            container.innerHTML = '<div class="empty-modal-message">No pending tickets. All caught up!</div>';
            return;
        }

        container.innerHTML = tickets.slice(0, 3).map(t => `
            <div class="ticket-item ${getPriorityClass(t.priority)}">
                <div class="ticket-id">${escapeHtml(t.id)} <span class="priority-badge ${getPriorityBadgeClass(t.priority)}">${escapeHtml(t.priority)}</span></div>
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-meta">Requester: ${escapeHtml(t.requester)} · ${escapeHtml(t.time)}</div>
            </div>
        `).join('');
    }

    // ─── Render: Aging Tickets panel ───────────────────────────────────────────
    function renderAgingTickets(tickets) {
        const container = document.getElementById('agingTicketsList');
        if (!container) return;

        if (!tickets || tickets.length === 0) {
            container.innerHTML = '<div class="empty-modal-message">No aging tickets right now.</div>';
            return;
        }

        container.innerHTML = tickets.slice(0, 3).map(t => `
            <div class="ticket-item ${getPriorityClass(t.priority)}">
                <div class="ticket-id">${escapeHtml(t.id)} <span class="priority-badge ${getPriorityBadgeClass(t.priority)}">${escapeHtml(t.priority)}</span></div>
                <div class="ticket-desc">${escapeHtml(t.title)}</div>
                <div class="ticket-meta">Requester: ${escapeHtml(t.requester)} · ${escapeHtml(t.days)}</div>
            </div>
        `).join('');
    }

    // ─── Render: Recent Activities panel ───────────────────────────────────────
    function renderActivities(activities) {
        const container = document.getElementById('activitiesList');
        if (!container) return;

        if (!activities || activities.length === 0) {
            container.innerHTML = '<div class="empty-modal-message">No recent activity yet.</div>';
            return;
        }

        container.innerHTML = activities.slice(0, 4).map(a => `
            <div class="activity-item">
                <div class="activity-icon"><i class="fas ${a.icon}"></i></div>
                <div class="activity-details">
                    <div class="activity-title">${escapeHtml(a.title)}</div>
                    <div class="activity-time">${escapeHtml(a.time)}</div>
                </div>
            </div>
        `).join('');
    }

    function showEmptyStates() {
        const msg = '<div class="empty-modal-message">Could not load data. Check your connection.</div>';
        ['newTicketsList', 'agingTicketsList', 'activitiesList'].forEach(id => {
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

        const isDark = localStorage.getItem('theme') === 'dark';
        themeSwitch.checked = isDark;
        document.body.classList.toggle('dark-mode', isDark);
        themeIcon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';

        themeSwitch.addEventListener('change', e => {
            const dark = e.target.checked;
            document.body.classList.toggle('dark-mode', dark);
            localStorage.setItem('theme', dark ? 'dark' : 'light');
            themeIcon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
        });
    }

    // Expose globally so inline scripts in Dashboard.html can use them
    window.formatCurrency        = formatCurrency;
    window.getDashboardData      = () => dashboardData;
    window.getPriorityClass      = getPriorityClass;
    window.getPriorityBadgeClass = getPriorityBadgeClass;
    window.escapeHtmlDashboard   = escapeHtml;
})();