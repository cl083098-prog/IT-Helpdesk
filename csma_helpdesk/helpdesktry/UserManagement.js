// UserManagement.js - IT Administrator User Management
// Wires UserManagement.html to api/user-management-data.php
// Handles: list/search/filter users, add user, edit user, delete (deactivate) user,
// reset password, and notifications.

(function () {
    'use strict';

    const API = '../api/user-management-data.php';

    // ===== AUTHENTICATION CHECK =====
    const rawUser = sessionStorage.getItem('currentUser');
    if (!rawUser) { window.location.href = 'Login.html'; return; }
    let currentUser;
    try { currentUser = JSON.parse(rawUser); }
    catch (e) { sessionStorage.removeItem('currentUser'); window.location.href = 'Login.html'; return; }
    if (!['admin','school_admin'].includes(currentUser.role)) { window.location.href = 'Login.html'; return; }

    const USER_ID   = currentUser.id;
    const USER_NAME = currentUser.name || 'IT Admin';
    const USER_ROLE = currentUser.role; // 'admin'
    // ===== END AUTHENTICATION CHECK =====

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    let allUsersCache = [];

    function openModal(id) {
        _filterSuppressed = true;
        document.getElementById(id)?.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    function closeModal(id) {
        document.getElementById(id)?.classList.remove('active');
        document.body.style.overflow = '';
        // Re-enable filters after layout settles (2 frames = safely after focus events)
        requestAnimationFrame(() => requestAnimationFrame(() => { _filterSuppressed = false; }));
    }

    function init() {
        applyRoleUI();
        initTheme();
        loadUsers();
        bindFilterEvents();
        bindAddUserModal();
        bindEditUserModal();
        bindResetPasswordModal();
        bindDetailModal();
        initModalBackdrops();
        initActivityLogSection();
    }

    function applyRoleUI() {
        const label = document.getElementById('currentRoleLabel');
        if (label) label.textContent = currentUser.role === 'school_admin' ? 'School Admin' : 'IT Admin';
        if (currentUser.role === 'school_admin') {
            // School Admin: restrict add-user role to IT Admin only
            const addRole = document.getElementById('addRole');
            if (addRole) {
                addRole.innerHTML = '<option value="IT Admin">IT Admin</option>';
                addRole.disabled  = true;
            }
            // Hide deactivate buttons (school admin can only view + reset IT admin pwd)
            document.querySelectorAll('.btn-delete-user').forEach(b => b.style.display='none');
        } else {
            // IT Admin sees all roles
            const addRole = document.getElementById('addRole');
            if (addRole) {
                addRole.innerHTML = `<option value="Faculty/Staff">Faculty / Staff</option>
                    <option value="Dept Head">Dept Head</option>
                    <option value="IT Admin">IT Admin</option>
                    <option value="School Admin">School Admin</option>`;
            }
        }
    }

    function initTheme() {
        const toggle = document.getElementById('themeSwitchCheckbox');
        const icon   = document.getElementById('themeIcon');
        const isDark = localStorage.getItem('theme') === 'dark';
        if (toggle) toggle.checked = isDark;
        document.body.classList.toggle('dark-mode', isDark);
        if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
        toggle?.addEventListener('change', e => {
            document.body.classList.toggle('dark-mode', e.target.checked);
            localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
            if (icon) icon.className = e.target.checked ? 'fas fa-sun' : 'fas fa-moon';
        });
    }

    function initModalBackdrops() {
        document.querySelectorAll('.um-modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', e => {
                // Use closeModal() not direct classList to ensure _filterSuppressed is reset
                if (e.target === overlay) closeModal(overlay.id);
            });
        });
        document.querySelectorAll('[data-close-modal]').forEach(btn => {
            btn.addEventListener('click', () => { closeModal(btn.dataset.closeModal); });
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') { document.querySelectorAll('.um-modal-overlay.active').forEach(m => m.classList.remove('active')); document.body.style.overflow=''; }
        });
    }

    function initActivityLogSection() {
        document.querySelectorAll('[data-section]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-section]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.um-section').forEach(s => s.classList.remove('active'));
                const sec = document.getElementById('section-' + btn.dataset.section);
                if (sec) sec.classList.add('active');
                if (btn.dataset.section === 'activity') loadActivityLog();
            });
        });

        ['logSearch','logDateFrom','logDateTo'].forEach(id =>
            document.getElementById(id)?.addEventListener('input', debounce(loadActivityLog, 350)));
        ['logModuleFilter','logStatusFilter'].forEach(id =>
            document.getElementById(id)?.addEventListener('change', loadActivityLog));
    }

    // ── Role label for display in activity log ───────────────────────────────
    function logRoleLabel(role) {
        const map = { admin:'IT Admin', school_admin:'School Admin', dept_head:'Dept Head', requester:'Faculty/Staff' };
        return map[role] || (role ? role.charAt(0).toUpperCase() + role.slice(1) : '—');
    }

    // ── Module label — make "ServiceRequest" human-readable ──────────────────
    function logModuleLabel(module) {
        const map = { ServiceRequest:'Service Requests', UserManagement:'User Management',
                      Login:'Authentication', Authentication:'Authentication', Inventory:'Inventory' };
        return map[module] || module || '—';
    }

    async function loadActivityLog() {
        const search   = document.getElementById('logSearch')?.value      || '';
        const module   = document.getElementById('logModuleFilter')?.value || 'all';
        const status   = document.getElementById('logStatusFilter')?.value || 'all';
        const dateFrom = document.getElementById('logDateFrom')?.value     || '';
        const dateTo   = document.getElementById('logDateTo')?.value       || '';
        const json = await apiFetch(`${API}?action=get_activity_log&${qs({search,module,status,date_from:dateFrom,date_to:dateTo})}`);
        const tbody = document.getElementById('activityLogBody');
        if (!tbody) return;
        if (!json?.success) {
            tbody.innerHTML = `<tr><td colspan="8" class="um-empty-row" style="color:#c62828;">
                Failed to load activity log: ${escHtml(json?.message || 'Server error')}</td></tr>`;
            return;
        }
        if (!json?.data?.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="um-empty-row">
                <i class="fas fa-history" style="display:block;font-size:2rem;color:#d0dae4;margin-bottom:10px;"></i>
                No activity logs yet.<br>
                <span style="font-size:0.78rem;color:#95a5a6;">Logs are recorded when users log in, add, edit, or reset accounts.</span>
            </td></tr>`;
            return;
        }
        const fmtDT = d => d ? new Date(d).toLocaleString('en-PH') : '—';
        tbody.innerHTML = json.data.map(log => `
            <tr>
                <td class="um-log-id">LOG-${String(log.id).padStart(4,'0')}</td>
                <td>${fmtDT(log.created_at)}</td>
                <td>${escHtml(log.user_name || '—')}</td>
                <td><span class="um-role-badge um-role-${escHtml(log.user_role)}">${escHtml(logRoleLabel(log.user_role))}</span></td>
                <td>${escHtml(logModuleLabel(log.module))}</td>
                <td>${escHtml(log.action || '—')}</td>
                <td><span class="um-status-badge um-status-${(log.status||'').toLowerCase()}">${escHtml(log.status || '—')}</span></td>
                <td><button type="button" class="um-action-btn um-btn-view" data-log='${JSON.stringify(log).replace(/'/g,"&apos;")}'>View</button></td>
            </tr>`).join('');
        tbody.querySelectorAll('[data-log]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                try { openLogDetail(JSON.parse(btn.dataset.log.replace(/&apos;/g, "'"))); }
                catch(err) { console.error('Log detail parse error:', err); }
            });
        });
    }

    function openLogDetail(log) {
        const body = document.getElementById('logDetailBody');
        const fmtDT = d => d ? new Date(d).toLocaleString('en-PH') : '—';
        if (body) body.innerHTML = `
            <div class="um-log-section">
                <div class="um-log-section-title">Log Information</div>
                <div class="um-log-detail-card">
                    <div class="um-log-detail-grid">
                        <div class="um-log-detail-item"><span class="um-log-detail-label">Log ID</span><span class="um-log-detail-val um-log-id">LOG-${String(log.id).padStart(4,'0')}</span></div>
                        <div class="um-log-detail-item"><span class="um-log-detail-label">Timestamp</span><span class="um-log-detail-val">${fmtDT(log.created_at)}</span></div>
                        <div class="um-log-detail-item"><span class="um-log-detail-label">Status</span><span class="um-log-detail-val"><span class="um-badge ${log.status==='Success'?'um-badge-active':log.status==='Failed'?'um-badge-inactive':'um-badge-warn'}">${escHtml(log.status)}</span></span></div>
                        <div class="um-log-detail-item"><span class="um-log-detail-label">IP Address</span><span class="um-log-detail-val">${escHtml(log.ip_address||'—')}</span></div>
                    </div>
                </div>
            </div>
            <div class="um-log-section">
                <div class="um-log-section-title">User Information</div>
                <div class="um-log-detail-card">
                    <div class="um-log-detail-grid">
                        <div class="um-log-detail-item"><span class="um-log-detail-label">User Name</span><span class="um-log-detail-val">${escHtml(log.user_name)}</span></div>
                        <div class="um-log-detail-item"><span class="um-log-detail-label">User Role</span><span class="um-log-detail-val"><span class="um-role-badge um-role-${escHtml(log.user_role)}">${escHtml(logRoleLabel(log.user_role))}</span></span></div>
                    </div>
                </div>
            </div>
            <div class="um-log-section">
                <div class="um-log-section-title">Activity Information</div>
                <div class="um-log-detail-card">
                    <div class="um-log-detail-item" style="margin-bottom:10px;"><span class="um-log-detail-label">Module</span><span class="um-log-detail-val">${escHtml(logModuleLabel(log.module))}</span></div>
                    <div class="um-log-detail-item" style="margin-bottom:10px;"><span class="um-log-detail-label">Action</span><span class="um-log-detail-val um-action-link">${escHtml(log.action)}</span></div>
                    ${log.detail ? `<div class="um-log-detail-item">
                        <span class="um-log-detail-label">Details</span>
                        <div class="um-log-detail-val um-log-detail-breakdown">
                            ${log.detail.split(' | ').map(part => `<div class="um-log-detail-part">${escHtml(part.trim())}</div>`).join('')}
                        </div>
                    </div>` : ''}
                </div>
            </div>`;
        openModal('logDetailModal');
    }

    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(()=>fn(...a),ms); }; }

    // ─── API helper ─────────────────────────────────────────────────────────
    async function apiFetch(url, options = {}) {
        try {
            const res  = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
            const json = await res.json();
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

    function withRequestor(params) {
        return { ...params, requestor_id: USER_ID, requestor_role: USER_ROLE };
    }
    function qs(params) {
        return new URLSearchParams(withRequestor(params)).toString();
    }

    // ─── Summary Cards ───────────────────────────────────────────────────────
    function renderSummaryCards(counts) {
        const totals = { all:0, admin:0, requester:0, dept_head:0, school_admin:0, active:0 };
        (counts || []).forEach(c => {
            totals.all      += parseInt(c.cnt) || 0;
            if (c.role in totals) totals[c.role] += parseInt(c.cnt) || 0;
            if (parseInt(c.is_active) === 1) totals.active += parseInt(c.cnt) || 0;
        });
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('cardTotal',       totals.all);
        set('cardActive',      totals.active);
        set('cardITAdmin',     totals.admin);
        set('cardFaculty',     totals.requester);
        set('cardDeptHead',    totals.dept_head);
        set('cardSchoolAdmin', totals.school_admin);
    }

    // ─── Users: list / search / filter ─────────────────────────────────────
    // _filterSuppressed prevents filter change events from firing while
    // a modal is open (selects can emit 'change' on focus-restore after modal close)
    let _filterSuppressed = false;

    function bindFilterEvents() {
        document.getElementById('roleFilter')?.addEventListener('change', () => {
            if (!_filterSuppressed) loadUsers();
        });
        document.getElementById('statusFilter')?.addEventListener('change', () => {
            if (!_filterSuppressed) loadUsers();
        });

        let searchTimer;
        document.getElementById('searchInput')?.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadUsers, 320);
        });

        document.getElementById('resetFiltersBtn')?.addEventListener('click', e => {
            e.stopPropagation();
            const roleF   = document.getElementById('roleFilter');
            const statF   = document.getElementById('statusFilter');
            const searchI = document.getElementById('searchInput');
            if (roleF)   roleF.value   = 'all';
            if (statF)   statF.value   = 'all';
            if (searchI) searchI.value = '';
            loadUsers();
        });
    }

    async function loadUsers() {
        const role   = document.getElementById('roleFilter')?.value   || 'all';
        const status = document.getElementById('statusFilter')?.value || 'all';
        const search = document.getElementById('searchInput')?.value  || '';

        const json = await apiFetch(`${API}?action=get_users&${qs({ role, status, search })}`);
        const tbody = document.getElementById('userTableBody');
        if (!tbody) return;

        if (!json?.success) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-msg">Failed to load users: ${escHtml(json?.message || 'Unknown error')}</td></tr>`;
            return;
        }

        allUsersCache = json.data || [];
        renderSummaryCards(json.counts || []);   // populate the stat cards

        if (!allUsersCache.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No users found.</td></tr>';
            return;
        }

        tbody.innerHTML = allUsersCache.map(u => `
            <tr>
                <td>${escHtml(u.employee_id || '—')}</td>
                <td><strong>${escHtml(u.full_name)}</strong></td>
                <td>${escHtml(u.email)}</td>
                <td>${escHtml(u.department || '—')}</td>
                <td><span class="role-tag role-tag-${escHtml(u.role)}">${escHtml(u.role_label)}</span></td>
                <td><span class="${u.is_active ? 'status-active' : 'status-inactive'}">${escHtml(u.status_text)}</span></td>
                <td>
                    <div class="action-buttons">
                        <button type="button" class="action-btn edit btn-view-user" data-id="${u.id}" title="View/Edit"><i class="fas fa-eye"></i></button>
                        <button type="button" class="action-btn reset btn-delete-user" data-id="${u.id}" data-name="${escHtml(u.full_name)}" title="Deactivate"><i class="fas fa-user-slash"></i></button>
                    </div>
                </td>
            </tr>`).join('');

        tbody.querySelectorAll('.btn-view-user').forEach(btn =>
            btn.addEventListener('click', e => { e.stopPropagation(); openUserDetail(Number(btn.dataset.id)); }));
        tbody.querySelectorAll('.btn-delete-user').forEach(btn =>
            btn.addEventListener('click', e => { e.stopPropagation(); pendingDeactivateId = Number(btn.dataset.id); const nm = document.getElementById('deleteConfirmName'); if(nm) nm.textContent = btn.dataset.name; openModal('deleteConfirmModal'); }));
    }

    // ─── Add User ───────────────────────────────────────────────────────────
    function bindAddUserModal() {
        const modal = document.getElementById('addUserModal');
        document.getElementById('addNewUserBtn')?.addEventListener('click', () => {
            document.getElementById('addUserForm')?.reset();
            // Reset role options in case applyRoleUI ran after modal was last opened
            if (currentUser.role !== 'school_admin') {
                const addRole = document.getElementById('addRole');
                if (addRole && !addRole.querySelector('option[value="Dept Head"]')) {
                    addRole.innerHTML = `<option value="Faculty/Staff">Faculty / Staff</option>
                        <option value="Dept Head">Dept Head</option>
                        <option value="IT Admin">IT Admin</option>
                        <option value="School Admin">School Admin</option>`;
                }
            }
            openModal('addUserModal');  // use openModal() to set _filterSuppressed
        });
        modal?.querySelectorAll('[data-close-modal="addUserModal"]').forEach(btn =>
            btn.addEventListener('click', () => closeModal('addUserModal')));
        modal?.addEventListener('click', e => { if (e.target === modal) closeModal('addUserModal'); });

        document.getElementById('addUserForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                action: 'add_user',
                requestor_id: USER_ID,
                requestor_role: USER_ROLE,
                requestor_name: USER_NAME,
                employee_id: document.getElementById('addEmpId')?.value.trim(),
                full_name:   document.getElementById('addFullName')?.value.trim(),
                email:       document.getElementById('addEmail')?.value.trim(),
                department:  document.getElementById('addDepartment')?.value,
                role:        document.getElementById('addRole')?.value,
                is_active:   document.getElementById('addStatus')?.value === 'Active' ? 1 : 0,
                default_password: document.getElementById('addDefaultPassword')?.value || 'default123',
            };
            if (!payload.full_name || !payload.email || !payload.department || !payload.role) {
                showToast('Please fill in all required fields.', true);
                return;
            }
            const json = await apiFetch(API, { method: 'POST', body: JSON.stringify(payload) });
            if (json?.success) {
                showToast(`✅ User created (Employee ID: ${json.employee_id || 'auto-generated'}).`);
                modal?.classList.remove('active');
                loadUsers();
            } else {
                showToast('Failed to create user: ' + (json?.message || 'Unknown error'), true);
            }
        });
    }

    // ─── Edit User ──────────────────────────────────────────────────────────
    let pendingResetUserId = null;

    function openEditModal(userId) {
        const u = allUsersCache.find(x => Number(x.id) === userId);
        if (!u) return;
        const modal = document.getElementById('editUserModal');
        document.getElementById('editUserId').value    = u.id;
        document.getElementById('editEmpId').value     = u.employee_id || '';
        document.getElementById('editFullName').value  = u.full_name || '';
        document.getElementById('editEmail').value     = u.email || '';
        if (document.getElementById('editDepartment')) document.getElementById('editDepartment').value = u.department || '';
        if (document.getElementById('editRole'))       document.getElementById('editRole').value       = u.role_label || 'Faculty/Staff';
        if (document.getElementById('editStatus'))     document.getElementById('editStatus').value     = u.status_text || 'Active';
        openModal('editUserModal');
    }

    function bindEditUserModal() {
        const modal = document.getElementById('editUserModal');
        modal?.querySelectorAll('[data-close-modal="editUserModal"]').forEach(btn =>
            btn.addEventListener('click', () => closeModal('editUserModal')));
        modal?.addEventListener('click', e => { if (e.target === modal) closeModal('editUserModal'); });

        document.getElementById('editUserForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                action: 'edit_user',
                requestor_id: USER_ID,
                requestor_role: USER_ROLE,
                requestor_name: USER_NAME,
                user_id:    Number(document.getElementById('editUserId').value),
                full_name:  document.getElementById('editFullName').value.trim(),
                email:      document.getElementById('editEmail').value.trim(),
                department: document.getElementById('editDepartment')?.value,
                role:       document.getElementById('editRole')?.value,
                is_active:  document.getElementById('editStatus')?.value === 'Active' ? 1 : 0,
            };
            const json = await apiFetch(API, { method: 'POST', body: JSON.stringify(payload) });
            if (json?.success) {
                showToast('✅ User updated successfully.');
                modal.classList.remove('active');
                loadUsers();
            } else {
                showToast('Update failed: ' + (json?.message || 'Unknown error'), true);
            }
        });

    // Reset password is triggered from userDetailModal via resetFromDetailBtn.
    // No wiring needed here — bindDetailModal() and bindResetPasswordModal() handle it.
    }

    // ─── Reset Password ─────────────────────────────────────────────────────
    function bindResetPasswordModal() {
        const modal = document.getElementById('resetPasswordModal');
        modal?.querySelectorAll('[data-close-modal="resetPasswordModal"]').forEach(btn =>
            btn.addEventListener('click', () => closeModal('resetPasswordModal')));
        modal?.addEventListener('click', e => { if (e.target === modal) closeModal('resetPasswordModal'); });

        // Live password match feedback as user types
        ['newPassword','confirmPassword'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                const pwd  = document.getElementById('newPassword')?.value;
                const conf = document.getElementById('confirmPassword')?.value;
                const hint = document.getElementById('pwdMatchHint');
                if (!hint || !conf) return;
                if (pwd === conf) {
                    hint.className   = 'um-hint hint-success';
                    hint.textContent = '✓ Passwords match';
                } else {
                    hint.className   = 'um-hint hint-error';
                    hint.textContent = '✗ Passwords do not match';
                }
            });
        });

        document.getElementById('confirmResetPasswordBtn')?.addEventListener('click', async () => {
            const newPwd  = document.getElementById('newPassword')?.value.trim();
            const confPwd = document.getElementById('confirmPassword')?.value.trim();
            const hint    = document.getElementById('pwdMatchHint');

            if (!newPwd || newPwd.length < 8) { showToast('Password must be at least 8 characters.', true); return; }
            if (newPwd !== confPwd) {
                if (hint) { hint.className = 'um-hint hint-error'; hint.textContent = '✗ Passwords do not match'; }
                showToast('Passwords do not match.', true);
                return;
            }
            const json = await apiFetch(API, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'reset_password',
                    requestor_id: USER_ID, requestor_role: USER_ROLE, requestor_name: USER_NAME,
                    user_id: pendingResetUserId, new_password: newPwd, confirm_password: confPwd,
                }),
            });
            if (json?.success) {
                showToast('✅ Password reset successfully.');
                modal?.classList.remove('active');
            } else {
                showToast('Reset failed: ' + (json?.message || 'Unknown error'), true);
            }
        });
    }

    // ─── Detail Modal (View / Reset / Edit triggers) ───────────────────────
    function bindDetailModal() {
        // "View" button in table → openUserDetail
        // This is called after each table render

        // "Reset Password" in detail modal footer
        document.getElementById('resetFromDetailBtn')?.addEventListener('click', () => {
            const u = currentDetailUser;
            if (!u) return;
            pendingResetUserId = u.id;
            document.getElementById('resetTargetName').textContent  = u.full_name || '—';
            document.getElementById('resetTargetEmail').textContent = u.email     || '—';
            const np = document.getElementById('newPassword');
            const cp = document.getElementById('confirmPassword');
            if (np) np.value = '';
            if (cp) cp.value = '';
            const hint = document.getElementById('pwdMatchHint');
            if (hint) hint.textContent = '';
            // Show role-appropriate title and note
            const titleEl = document.getElementById('resetModalTitle');
            const noteEl  = document.getElementById('resetSchoolAdminNote');
            if (titleEl) titleEl.textContent = currentUser.role === 'school_admin' ? 'Reset Password — IT Admin' : 'Reset Password';
            if (noteEl)  noteEl.style.display = currentUser.role === 'school_admin' ? 'flex' : 'none';
            closeModal('userDetailModal');
            openModal('resetPasswordModal');
        });

        // "Edit User" in detail modal footer
        document.getElementById('editFromDetailBtn')?.addEventListener('click', () => {
            if (currentDetailUser) openEditModal(currentDetailUser.id);
            closeModal('userDetailModal');
        });

        // Deactivate confirm modal
        document.getElementById('confirmDeleteBtn')?.addEventListener('click', async () => {
            if (!pendingDeactivateId) return;
            await deactivateUser(pendingDeactivateId);
            closeModal('deleteConfirmModal');
            pendingDeactivateId = null;
        });
        document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => closeModal('deleteConfirmModal'));
    }

    let currentDetailUser = null;
    let pendingDeactivateId = null;

    function openUserDetail(userId) {
        const u = allUsersCache.find(x => Number(x.id) === userId);
        if (!u) return;
        currentDetailUser = u;

        const isAdmin      = currentUser.role === 'admin';
        const isSchoolAdmin= currentUser.role === 'school_admin';
        const canReset     = isAdmin || (isSchoolAdmin && u.role === 'admin');
        const canEdit      = isAdmin;

        const body = document.getElementById('userDetailBody');
        if (body) {
            body.innerHTML = `
                <div class="um-detail-grid">
                    <div class="um-detail-item">
                        <span class="um-detail-label">Employee ID</span>
                        <span class="um-detail-val um-empid">${escHtml(u.employee_id || '—')}</span>
                    </div>
                    <div class="um-detail-item">
                        <span class="um-detail-label">Name</span>
                        <span class="um-detail-val">${escHtml(u.full_name)}</span>
                    </div>
                    <div class="um-detail-item">
                        <span class="um-detail-label">Email</span>
                        <span class="um-detail-val">${escHtml(u.email)}</span>
                    </div>
                    <div class="um-detail-item">
                        <span class="um-detail-label">Department</span>
                        <span class="um-detail-val">${escHtml(u.department || '—')}</span>
                    </div>
                    <div class="um-detail-item">
                        <span class="um-detail-label">Role</span>
                        <span class="um-detail-val">
                            <span class="um-role-badge um-role-${escHtml(u.role)}">${escHtml(u.role_label)}</span>
                        </span>
                    </div>
                    <div class="um-detail-item">
                        <span class="um-detail-label">Status</span>
                        <span class="um-detail-val">
                            <span class="um-badge ${u.is_active ? 'um-badge-active' : 'um-badge-inactive'}">${u.is_active ? 'Active' : 'Inactive'}</span>
                        </span>
                    </div>
                    <div class="um-detail-item um-detail-full">
                        <span class="um-detail-label">Date Joined</span>
                        <span class="um-detail-val">${u.created_at ? new Date(u.created_at).toLocaleDateString('en-PH') : '—'}</span>
                    </div>
                </div>`;
        }

        const resetBtn = document.getElementById('resetFromDetailBtn');
        const editBtn  = document.getElementById('editFromDetailBtn');
        if (resetBtn) resetBtn.style.display = canReset ? 'inline-flex' : 'none';
        if (editBtn)  editBtn.style.display  = canEdit  ? 'inline-flex' : 'none';

        openModal('userDetailModal');
    }

    // ─── Deactivate (soft-delete) ───────────────────────────────────────────


    async function deactivateUser(userId) {
        const json = await apiFetch(API, {
            method: 'POST',
            body: JSON.stringify({
                action: 'delete_user',
                requestor_id: USER_ID, requestor_role: USER_ROLE, requestor_name: USER_NAME,
                user_id: userId,
            }),
        });
        if (json?.success) { showToast('✅ User deactivated.'); loadUsers(); }
        else showToast('Failed: ' + (json?.message || 'Unknown error'), true);
    }

    // Notifications handled by admin-notifications.js

    // ─── Utilities ──────────────────────────────────────────────────────────
    function escHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
    }

    function showToast(msg, isError = false) {
        const t = document.getElementById('umToast');
        if (!t) return;
        t.textContent = msg;
        // Use um- prefixed classes that match UserManagement.css
        t.className = 'um-toast show ' + (isError ? 'um-toast-error' : 'um-toast-success');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.classList.remove('show'); }, 2800);
    }
})();
