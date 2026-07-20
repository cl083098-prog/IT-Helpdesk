// notification-widget.js
// -----------------------------------------------------------------------------
// Drop-in notification bell for any page.
//
// Usage: include AFTER Sidebar.js on any Requester or Dept Head page:
//   <link rel="stylesheet" href="notification-widget.css">
//   <script src="notification-widget.js"></script>
//
// The widget:
//   • Reads currentUser from sessionStorage.
//   • Injects a bell + dropdown next to .theme-toggle-wrapper if one exists,
//     otherwise appends to .user-actions.
//   • Reads from ../api/notifications.php (?action=get&user_id=..&user_role=..).
//   • Marks individual notifs as read on click; supports "Mark all read".
//   • Polls every 45s (light unread_count endpoint), does a full refresh on
//     open.
//   • Skips itself entirely for IT Admin and School Admin, whose pages already
//     have their own bells wired.
// -----------------------------------------------------------------------------

(function () {
    'use strict';

    const API      = '../api/notifications.php';
    const POLL_MS  = 45000;

    // ── Guards ─────────────────────────────────────────────────────────────
    let currentUser = null;
    try { currentUser = JSON.parse(sessionStorage.getItem('currentUser') || 'null'); }
    catch (e) { currentUser = null; }
    if (!currentUser || !currentUser.id) return;

    // Skip for admin / school_admin — they already have their own widgets.
    // (Also skip if the page already has an admin-notif or SA-notif bell.)
    if (currentUser.role === 'admin' || currentUser.role === 'school_admin') return;

    const USER_ID   = Number(currentUser.id);
    const USER_ROLE = String(currentUser.role || '');

    // ── Helpers ────────────────────────────────────────────────────────────
    function $(id)  { return document.getElementById(id); }
    function esc(s) {
        return String(s || '').replace(/[&<>"']/g,
            m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }
    function fmtRel(dateStr) {
        if (!dateStr) return '';
        const diff = Math.floor((Date.now() - new Date(dateStr.replace(' ', 'T'))) / 1000);
        if (isNaN(diff))    return '';
        if (diff < 60)      return 'Just now';
        if (diff < 3600)    return Math.floor(diff / 60)   + ' min ago';
        if (diff < 86400)   return Math.floor(diff / 3600) + ' hr ago';
        if (diff < 604800)  return Math.floor(diff / 86400)+ ' days ago';
        return new Date(dateStr.replace(' ', 'T')).toLocaleDateString();
    }
    function iconForEvent(t) {
        // Font-Awesome class for the notif dot icon
        return ({
            'ticket_submitted'    : 'fa-paper-plane',
            'approval_needed'     : 'fa-clipboard-check',
            'approval_approved'   : 'fa-check-circle',
            'approval_rejected'   : 'fa-times-circle',
            'status_change'       : 'fa-sync-alt',
            'confirmation_needed' : 'fa-user-check',
            'sla_change'          : 'fa-clock',
            'assigned'            : 'fa-user-plus',
            'assigned_to_you'     : 'fa-user-plus',
            'reply'               : 'fa-reply',
            'ticket_closed'       : 'fa-check-circle',
            'ticket_reopened'     : 'fa-undo',
        })[t] || 'fa-bell';
    }

    // ── DOM injection ──────────────────────────────────────────────────────
    function inject() {
        if ($('nwWrapper')) return; // already there

        const themeWrap = document.querySelector('.theme-toggle-wrapper');
        const userAct   = document.querySelector('.user-actions');
        const anchor    = themeWrap || userAct;
        if (!anchor) return;

        const wrap = document.createElement('div');
        wrap.id        = 'nwWrapper';
        wrap.className = 'nw-wrapper';
        wrap.innerHTML = `
            <button class="nw-bell" id="nwBell" title="Notifications" aria-label="Notifications">
                <i class="fas fa-bell"></i>
                <span class="nw-badge" id="nwBadge" style="display:none;">0</span>
            </button>
            <div class="nw-dropdown" id="nwDropdown" role="dialog">
                <div class="nw-header">
                    <span><i class="fas fa-bell"></i> Notifications</span>
                    <button class="nw-mark-all" id="nwMarkAll">Mark all read</button>
                </div>
                <div class="nw-list" id="nwList">
                    <div class="nw-empty">Loading…</div>
                </div>
            </div>`;

        if (themeWrap) themeWrap.parentNode.insertBefore(wrap, themeWrap);
        else           anchor.appendChild(wrap);

        // Open/close
        $('nwBell').addEventListener('click', e => {
            e.stopPropagation();
            const dd = $('nwDropdown');
            dd.classList.toggle('open');
            if (dd.classList.contains('open')) load(); // refresh contents on open
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('#nwWrapper')) $('nwDropdown')?.classList.remove('open');
        });

        // Mark all read
        $('nwMarkAll').addEventListener('click', async () => {
            // v11: verify the server actually persisted the write before
            // touching the UI. Silent-failure was the reason "read"
            // notifications came back unread after re-login.
            let ok = false;
            try {
                const res = await fetch(`${API}?action=mark_all_read`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ user_id: USER_ID, user_role: USER_ROLE, action: 'mark_all_read' })
                });
                const json = await res.json();
                ok = !!json.success;
                if (!ok) console.warn('[nw] mark_all_read failed:', json.message);
            } catch (e) { console.warn('[nw] mark_all_read network error:', e.message); }

            if (ok) {
                await load();
            } else {
                const list = $('nwList');
                if (list) list.insertAdjacentHTML('afterbegin',
                    '<div class="nw-empty" style="color:#b23434;">Could not mark all as read — please try again.</div>');
            }
        });
    }

    // ── Toast notification ─────────────────────────────────────────────────
    let _toastTimer = null;

    function showNwToast(title, description) {
        let toast = $('nwToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'nwToast';
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
                    <i class="fas fa-comment-dots" style="font-size:0.95rem;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div id="nwToastTitle" style="font-weight:700;font-size:0.85rem;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
                    <div id="nwToastDesc" style="font-size:0.78rem;opacity:0.82;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;"></div>
                </div>
                <button id="nwToastClose" style="background:none;border:none;color:rgba(255,255,255,0.6);font-size:1.1rem;cursor:pointer;flex-shrink:0;padding:0;line-height:1;">&times;</button>`;
            document.body.appendChild(toast);
            toast.addEventListener('click', e => {
                if (e.target.id !== 'nwToastClose' && !e.target.closest('#nwToastClose')) {
                    // Open notification bell dropdown on click
                    const dd = $('nwDropdown');
                    if (dd) { dd.classList.add('open'); load(); }
                }
                hideNwToast();
            });
            $('nwToastClose')?.addEventListener('click', e => { e.stopPropagation(); hideNwToast(); });
        }

        $('nwToastTitle').textContent = title;
        $('nwToastDesc').textContent  = description || '';
        toast.style.pointerEvents = 'auto';
        // Trigger show
        requestAnimationFrame(() => {
            toast.style.opacity   = '1';
            toast.style.transform = 'translateY(0)';
        });

        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(hideNwToast, 5000);
    }

    function hideNwToast() {
        const toast = $('nwToast');
        if (!toast) return;
        toast.style.opacity   = '0';
        toast.style.transform = 'translateY(16px)';
        toast.style.pointerEvents = 'none';
    }

    // ── Data load ──────────────────────────────────────────────────────────
    // Track previously seen unread IDs so we can detect truly new notifications
    let _seenIds = new Set();
    let _firstLoad = true;

    async function pollUnread() {
        try {
            const res  = await fetch(`${API}?action=get&user_id=${USER_ID}&user_role=${encodeURIComponent(USER_ROLE)}`);
            const json = await res.json();
            if (!json.success) return;

            const unread = (json.data || []).filter(n => !n.is_read);
            renderBadge(unread.length);

            // On first load, seed _seenIds without showing toasts
            if (_firstLoad) {
                unread.forEach(n => _seenIds.add(n.id));
                _firstLoad = false;
                return;
            }

            // Find genuinely new unread notifications
            const newOnes = unread.filter(n => !_seenIds.has(n.id));
            if (newOnes.length > 0) {
                // Update seen set
                newOnes.forEach(n => _seenIds.add(n.id));

                // Show a toast for new message/reply notifications first; fallback to any new one
                const msgNotif = newOnes.find(n => n.event_type === 'reply') || newOnes[0];
                showNwToast(msgNotif.title, msgNotif.description);

                // Refresh bell dropdown if it's open
                if ($('nwDropdown')?.classList.contains('open')) renderList(json.data || []);
            }
        } catch (e) { /* silent */ }
    }

    async function load() {
        try {
            const res  = await fetch(`${API}?action=get&user_id=${USER_ID}&user_role=${encodeURIComponent(USER_ROLE)}`);
            const json = await res.json();
            if (!json.success) return;
            const unread = (json.data || []).filter(n => !n.is_read).length;
            renderBadge(unread);
            renderList(json.data || []);
            // Keep seenIds in sync when bell is manually opened
            (json.data || []).filter(n => !n.is_read).forEach(n => _seenIds.add(n.id));
            _firstLoad = false;
        } catch (e) { /* silent */ }
    }

    function renderBadge(n) {
        const b = $('nwBadge');
        if (!b) return;
        b.textContent   = n > 9 ? '9+' : String(n);
        b.style.display = n > 0 ? 'inline-block' : 'none';
    }

    function renderList(rows) {
        const list = $('nwList');
        if (!list) return;
        if (!rows.length) {
            list.innerHTML = '<div class="nw-empty">No notifications yet.</div>';
            return;
        }
        list.innerHTML = rows.slice(0, 20).map(n => `
            <div class="nw-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
                <div class="nw-dot ${n.is_read ? '' : 'unread'}">
                    <i class="fas ${iconForEvent(n.event_type)}"></i>
                </div>
                <div class="nw-body">
                    <div class="nw-title">${esc(n.title)}</div>
                    ${n.description ? `<div class="nw-desc">${esc(n.description)}</div>` : ''}
                    <div class="nw-time">${fmtRel(n.created_at)}</div>
                </div>
            </div>`).join('');

        list.querySelectorAll('.nw-item.unread[data-id]').forEach(el => {
            el.addEventListener('click', async () => {
                if (!el.classList.contains('unread')) return;
                // v11: verify server persisted the write; roll back UI on failure.
                let ok = false;
                try {
                    const res = await fetch(`${API}?action=mark_one`, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ action: 'mark_one', notif_id: el.dataset.id, user_id: USER_ID })
                    });
                    const json = await res.json();
                    ok = !!json.success;
                    if (!ok) console.warn('[nw] mark_one failed:', json.message);
                } catch (e) { console.warn('[nw] mark_one network error:', e.message); }

                if (!ok) return; // leave visually unread — user can retry

                el.classList.remove('unread');
                el.querySelector('.nw-dot')?.classList.remove('unread');

                const badge = $('nwBadge');
                if (badge && badge.style.display !== 'none') {
                    const cur = Math.max(0, parseInt(badge.textContent, 10) - 1);
                    if (cur === 0) badge.style.display = 'none';
                    else            badge.textContent = cur > 9 ? '9+' : String(cur);
                }
            });
        });
    }

    // ── Boot ───────────────────────────────────────────────────────────────
    function boot() {
        inject();
        load();
        // Poll every 20s for new notifications (triggers toast for new messages)
        setInterval(pollUnread, 20000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
