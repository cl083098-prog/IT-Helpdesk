// admin-notifications.js
// Shared notification bell functionality for ALL IT Administrator pages.
// Include after Sidebar.js on every IT Admin HTML page:
//   <script src="admin-notifications.js"></script>

(function () {
    'use strict';

    const API_BASE = '../api';

    // ── Build the notification widget in the top-bar ────────────────────────
    // Call this once the DOM is ready to inject the bell into .user-actions
    // or alongside the theme toggle.
    function injectNotificationBell() {
        // Avoid double-injection if Dashboard.html already has one
        if (document.getElementById('adminNotifWrapper')) return;

        // Find the theme toggle wrapper — insert bell just before it
        const themeWrapper = document.querySelector('.theme-toggle-wrapper');
        if (!themeWrapper) return;

        const wrapper = document.createElement('div');
        wrapper.id        = 'adminNotifWrapper';
        wrapper.className = 'admin-notif-wrapper';
        wrapper.innerHTML = `
            <button class="notification-icon admin-notif-bell" id="adminNotifBell" title="Notifications">
                <i class="fas fa-bell"></i>
                <span class="admin-notif-badge" id="adminNotifBadge" style="display:none;">0</span>
            </button>
            <div class="admin-notif-dropdown" id="adminNotifDropdown">
                <div class="admin-notif-header">
                    <span><i class="fas fa-bell"></i> Notifications</span>
                    <button class="admin-notif-mark-read" id="adminMarkAllReadBtn">Mark all read</button>
                </div>
                <div class="admin-notif-list" id="adminNotifList">
                    <div class="admin-notif-empty">Loading…</div>
                </div>
                <a href="Dashboard.html" class="admin-notif-footer-link">View Dashboard →</a>
            </div>`;

        // Insert before the theme toggle
        themeWrapper.parentNode.insertBefore(wrapper, themeWrapper);

        // Wire click-outside close
        document.getElementById('adminNotifBell')?.addEventListener('click', e => {
            e.stopPropagation();
            document.getElementById('adminNotifDropdown')?.classList.toggle('open');
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('#adminNotifWrapper')) {
                document.getElementById('adminNotifDropdown')?.classList.remove('open');
            }
        });

        // Mark all read
        document.getElementById('adminMarkAllReadBtn')?.addEventListener('click', async () => {
            const cu = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            await fetch(`${API_BASE}/admin-notifications.php?action=mark_all_read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: cu.id })
            });
            loadAdminNotifications();
        });
    }

    // ── Load notifications from API ─────────────────────────────────────────
    async function loadAdminNotifications() {
        const cu = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        if (!cu.id) return;

        let data = [];
        try {
            const res  = await fetch(`${API_BASE}/admin-notifications.php?action=get&user_id=${cu.id}`);
            const json = await res.json();
            if (json.success) data = json.data || [];
        } catch (e) {
            // Network error — degrade gracefully
            return;
        }

        const unread = data.filter(n => !n.is_read).length;
        const badge  = document.getElementById('adminNotifBadge');
        if (badge) {
            badge.textContent    = unread > 9 ? '9+' : unread;
            badge.style.display  = unread > 0 ? 'inline-block' : 'none';
        }

        const list = document.getElementById('adminNotifList');
        if (!list) return;

        if (data.length === 0) {
            list.innerHTML = '<div class="admin-notif-empty">No new notifications</div>';
            return;
        }

        list.innerHTML = data.slice(0, 6).map(n => `
            <div class="admin-notif-item${n.is_read ? '' : ' unread'}" data-id="${n.id}">
                <div class="admin-notif-dot"></div>
                <div class="admin-notif-text">
                    <div class="admin-notif-title">${escHtml(n.title)}</div>
                    <div class="admin-notif-desc">${escHtml(n.description || '')}</div>
                    <div class="admin-notif-time">${formatRelTime(n.created_at)}</div>
                </div>
            </div>`).join('');

        // Mark as read on click
        list.querySelectorAll('.admin-notif-item[data-id]').forEach(el => {
            el.addEventListener('click', async () => {
                if (!el.classList.contains('unread')) return;
                const cu = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
                try {
                    await fetch(`${API_BASE}/admin-notifications.php?action=mark_one`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ notif_id: el.dataset.id, user_id: cu.id })
                    });
                } catch {}
                el.classList.remove('unread');
                const badge = document.getElementById('adminNotifBadge');
                if (badge) {
                    const cur = parseInt(badge.textContent) - 1;
                    if (cur <= 0) { badge.style.display = 'none'; }
                    else { badge.textContent = cur > 9 ? '9+' : cur; }
                }
            });
        });
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    function escHtml(s) {
        return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    function formatRelTime(dateStr) {
        if (!dateStr) return '';
        const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
        if (diff < 60)    return 'Just now';
        if (diff < 3600)  return `${Math.floor(diff/60)} min ago`;
        if (diff < 86400) return `${Math.floor(diff/3600)} hr ago`;
        return `${Math.floor(diff/86400)} days ago`;
    }

    // ── Boot ────────────────────────────────────────────────────────────────
    function init() {
        // Run for IT Admin on all IT Admin pages
        // (SchoolAdmin pages use their own initSaNotifBell() in SchoolAdmin.js)
        try {
            const cu = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            if (cu.role !== 'admin') return;
        } catch { return; }

        injectNotificationBell();
        loadAdminNotifications();
        // Poll every 60 seconds for new notifications
        setInterval(loadAdminNotifications, 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
