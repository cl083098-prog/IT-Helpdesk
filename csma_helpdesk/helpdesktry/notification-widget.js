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
            'approval_approved'   : 'fa-circle-check',
            'approval_rejected'   : 'fa-circle-xmark',
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

    // ── Data load ──────────────────────────────────────────────────────────
    async function pollUnread() {
        try {
            const res  = await fetch(`${API}?action=unread_count&user_id=${USER_ID}&user_role=${encodeURIComponent(USER_ROLE)}`);
            const json = await res.json();
            if (!json.success) return;
            renderBadge(json.unread || 0);
        } catch (e) { /* silent */ }
    }

    async function load() {
        try {
            const res  = await fetch(`${API}?action=get&user_id=${USER_ID}&user_role=${encodeURIComponent(USER_ROLE)}`);
            const json = await res.json();
            if (!json.success) return;
            renderBadge(json.unread || 0);
            renderList(json.data || []);
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
        setInterval(pollUnread, POLL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
