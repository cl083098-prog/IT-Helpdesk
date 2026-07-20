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
                <i class="ti ti-bell"></i>
                <span class="admin-notif-badge" id="adminNotifBadge" style="display:none;">0</span>
            </button>
            <div class="admin-notif-dropdown" id="adminNotifDropdown">
                <div class="admin-notif-header">
                    <span><i class="ti ti-bell"></i> Notifications</span>
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
            // v11: check server response; only update UI on real success.
            // Previous version had an empty catch that swallowed errors
            // silently, so a failed mark-read still stripped the .unread
            // class visually — user thought it was read but the DB wasn't
            // touched, and the notification returned on next login.
            let ok = false;
            try {
                const res  = await fetch(`${API_BASE}/admin-notifications.php?action=mark_all_read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: cu.id })
                });
                const json = await res.json();
                ok = !!json.success;
                if (!ok) console.warn('[notifs] mark_all_read failed:', json.message);
            } catch (e) {
                console.warn('[notifs] mark_all_read network error:', e.message);
            }
            if (ok) {
                loadAdminNotifications();
            } else {
                // Show a small transient message inside the dropdown so the user knows
                const list = document.getElementById('adminNotifList');
                if (list) list.insertAdjacentHTML('afterbegin',
                    '<div class="admin-notif-empty" style="color:#b23434;">Could not mark all as read — please try again.</div>');
            }
        });
    }

    // ── Toast notification for new messages ─────────────────────────────────
    let _adminToastTimer = null;
    let _adminSeenIds    = new Set();
    let _adminFirstLoad  = true;

    function showAdminToast(title, description) {
        let toast = document.getElementById('adminNwToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'adminNwToast';
            toast.style.cssText = [
                'position:fixed', 'bottom:24px', 'right:24px', 'z-index:10000',
                'background:#1a3a52', 'color:#fff', 'border-radius:12px',
                'box-shadow:0 6px 24px rgba(0,0,0,0.28)', 'padding:14px 18px',
                'max-width:320px', 'min-width:220px', 'display:flex', 'align-items:flex-start',
                'gap:12px', 'cursor:pointer', 'transition:opacity 0.3s,transform 0.3s',
                'opacity:0', 'transform:translateY(16px)', 'pointer-events:none'
            ].join(';');
            toast.innerHTML = `
                <div style="flex-shrink:0;width:34px;height:34px;background:rgba(255,255,255,0.12);border-radius:50%;display:flex;align-items:center;justify-content:center;">
                    <i class="ti ti-message-circle" style="font-size:0.95rem;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div id="adminNwToastTitle" style="font-weight:700;font-size:0.85rem;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
                    <div id="adminNwToastDesc" style="font-size:0.78rem;opacity:0.82;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;"></div>
                </div>
                <button id="adminNwToastClose" style="background:none;border:none;color:rgba(255,255,255,0.6);font-size:1.1rem;cursor:pointer;flex-shrink:0;padding:0;line-height:1;">&times;</button>`;
            document.body.appendChild(toast);

            const hideToast = () => {
                toast.style.opacity   = '0';
                toast.style.transform = 'translateY(16px)';
                toast.style.pointerEvents = 'none';
            };
            toast.addEventListener('click', e => {
                if (!e.target.closest('#adminNwToastClose')) {
                    // Open notification dropdown on click
                    document.getElementById('adminNotifDropdown')?.classList.add('open');
                    loadAdminNotifications();
                }
                hideToast();
            });
            document.getElementById('adminNwToastClose')?.addEventListener('click', e => {
                e.stopPropagation();
                hideToast();
            });
        }

        document.getElementById('adminNwToastTitle').textContent = title;
        document.getElementById('adminNwToastDesc').textContent  = description || '';
        toast.style.pointerEvents = 'auto';
        requestAnimationFrame(() => {
            toast.style.opacity   = '1';
            toast.style.transform = 'translateY(0)';
        });
        clearTimeout(_adminToastTimer);
        _adminToastTimer = setTimeout(() => {
            toast.style.opacity   = '0';
            toast.style.transform = 'translateY(16px)';
            toast.style.pointerEvents = 'none';
        }, 5000);
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

        const unread = data.filter(n => !n.is_read);
        const unreadCount = unread.length;
        const badge  = document.getElementById('adminNotifBadge');
        if (badge) {
            badge.textContent    = unreadCount > 9 ? '9+' : unreadCount;
            badge.style.display  = unreadCount > 0 ? 'inline-block' : 'none';
        }

        // ── Toast for genuinely new notifications ──────────────────────────
        if (_adminFirstLoad) {
            unread.forEach(n => _adminSeenIds.add(n.id));
            _adminFirstLoad = false;
        } else {
            const newOnes = unread.filter(n => !_adminSeenIds.has(n.id));
            if (newOnes.length > 0) {
                newOnes.forEach(n => _adminSeenIds.add(n.id));
                // Prefer reply/message notifications; fallback to any new one
                const pick = newOnes.find(n => n.event_type === 'reply') || newOnes[0];
                showAdminToast(pick.title, pick.description);
            }
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
                // v11: only strip the .unread class if the server confirms the write.
                let ok = false;
                try {
                    const res  = await fetch(`${API_BASE}/admin-notifications.php?action=mark_one`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ notif_id: el.dataset.id, user_id: cu.id })
                    });
                    const json = await res.json();
                    ok = !!json.success;
                    if (!ok) console.warn('[notifs] mark_one failed:', json.message);
                } catch (e) {
                    console.warn('[notifs] mark_one network error:', e.message);
                }
                if (!ok) return; // leave it visually unread — user can retry
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
        // Poll every 20 seconds for new notifications (enables timely message toasts)
        setInterval(loadAdminNotifications, 20000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
