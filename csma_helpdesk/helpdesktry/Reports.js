/* =======================================================================
 * Reports.js  —  IT Administrator Reports module
 * -----------------------------------------------------------------------
 * Hooks the Reports.html form to /api/generate_report.php.
 *
 *   • Report Type + Date Range + Export Format  ->  Generate Report
 *   • PDF  : opens a new window with print-ready HTML (auto-print dialog)
 *   • Excel: triggers a native browser download (.xls)
 *   • CSV  : triggers a native browser download (.csv)
 *
 * Also loads the "Recent Reports" table from the API on page load.
 * ===================================================================== */

(function () {
    'use strict';

    const API_GENERATE = '../api/generate_report.php';

    // ===== AUTHENTICATION CHECK =====
    // Only IT Admin may reach this page. Everyone else gets bounced back.
    (function checkAdminAuth() {
        const raw = sessionStorage.getItem('currentUser');
        if (!raw) { window.location.replace('Login.html'); return; }
        try {
            const u = JSON.parse(raw);
            if (u.role !== 'admin') {
                const dest = {
                    school_admin: 'SchoolAdmin.html',
                    dept_head:    'DeptHeadDashboard.html',
                    requester:    'RequesterDashboard.html',
                };
                window.location.replace(dest[u.role] || 'Login.html');
            }
        } catch (e) {
            sessionStorage.removeItem('currentUser');
            window.location.replace('Login.html');
        }
    })();

    const CURRENT_USER = getCurrentUser();

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('generateReportBtn')
                ?.addEventListener('click', handleGenerate);
        document.getElementById('refreshReportsBtn')
                ?.addEventListener('click', loadRecentReports);
        loadRecentReports();

        // Live-refresh: whenever the user returns to this tab, reload the list.
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) loadRecentReports();
        });
        // Also poll every 15s while the page is visible.
        setInterval(() => { if (!document.hidden) loadRecentReports(); }, 15000);
    });

    /* --------------------------------------------------------------- */
    function getCurrentUser() {
        try {
            const raw = sessionStorage.getItem('currentUser')
                     || localStorage.getItem('currentUser');
            if (!raw) return { id: 0, role: 'admin' };
            const u = JSON.parse(raw);
            return { id: u.id || u.user_id || 0, role: u.role || 'admin' };
        } catch { return { id: 0, role: 'admin' }; }
    }

    /* --------------------------------------------------------------- */
    function handleGenerate(e) {
        const btn = e?.currentTarget || document.getElementById('generateReportBtn');
        if (btn?.disabled) return;                            // prevent double-submit

        const reportType   = document.getElementById('reportType').value;
        const startDate    = document.getElementById('startDate').value;
        const endDate      = document.getElementById('endDate').value;
        const exportFormat = document.getElementById('exportFormat').value;

        if (startDate && endDate && startDate > endDate) {
            showToast('⚠️ Start date must be before end date.', 'error');
            return;
        }

        const params = new URLSearchParams({
            report_type:   reportType,
            date_from:     startDate,
            date_to:       endDate,
            export_format: exportFormat.toUpperCase(),
            user_id:       CURRENT_USER.id || 0,
            role:          CURRENT_USER.role || 'admin',
        });

        const url = `${API_GENERATE}?${params.toString()}`;

        // Lock button briefly to prevent duplicate downloads / log rows.
        const originalHtml = btn ? btn.innerHTML : null;
        if (btn) {
            btn.disabled  = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
        }

        try {
            if (exportFormat.toUpperCase() === 'PDF') {
                // PDF renders in a new tab so the user can Save-as-PDF from the print dialog.
                const w = window.open(url, '_blank');
                if (!w) {
                    showToast('⚠️ Please allow pop-ups to view PDF reports.', 'error');
                    return;
                }
            } else {
                // Excel / CSV — trigger the browser's native download.
                const link = document.createElement('a');
                link.href = url;
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }

            showToast(`Requesting ${exportFormat} report…`);
            // Multiple refresh attempts in case the DB insert lags behind the download.
            setTimeout(loadRecentReports, 800);
            setTimeout(loadRecentReports, 2500);
            setTimeout(loadRecentReports, 5000);
        } finally {
            if (btn && originalHtml !== null) {
                setTimeout(() => { btn.disabled = false; btn.innerHTML = originalHtml; }, 1200);
            }
        }
    }

    /* --------------------------------------------------------------- */
    async function loadRecentReports() {
        const tbody = document.getElementById('recentReportsBody');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;">
            <i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>`;

        try {
            const res = await fetch(
                `${API_GENERATE}?action=recent&user_id=${CURRENT_USER.id || 0}&role=${encodeURIComponent(CURRENT_USER.role || 'admin')}`
            );
            const json = await res.json();
            const rows = json?.data || [];

            if (!rows.length) {
                tbody.innerHTML = `<tr class="empty-row">
                    <td colspan="4" style="text-align:center;padding:40px;">
                        <i class="fas fa-file-alt" style="font-size:2rem;color:#95a5a6;
                             margin-bottom:10px;display:block;"></i>
                        No reports generated yet. Configure and generate your first report above.
                    </td></tr>`;
                return;
            }

            tbody.innerHTML = rows.map(r => {
                const viewUrl = buildViewUrl(r);
                return `
                <tr>
                    <td>${escHtml(r.report_name)}</td>
                    <td>${formatDate(r.created_at)}</td>
                    <td><span class="format-badge format-${(r.export_format||'').toLowerCase()}">
                        <i class="fas ${iconFor(r.export_format)}"></i> ${escHtml(r.export_format)}
                    </span></td>
                    <td>
                        <button class="btn-view-report" data-url="${escHtml(viewUrl)}"
                                data-fmt="${escHtml((r.export_format||'PDF').toUpperCase())}"
                                title="View / Re-download this report">
                            <i class="fas fa-eye"></i> View
                        </button>
                    </td>
                </tr>`;
            }).join('');

            // Wire up View buttons
            tbody.querySelectorAll('.btn-view-report').forEach(btn => {
                btn.addEventListener('click', () => {
                    const url = btn.dataset.url;
                    const fmt = btn.dataset.fmt;
                    if (fmt === 'PDF') {
                        const w = window.open(url, '_blank');
                        if (!w) showToast('⚠️ Please allow pop-ups to view PDF reports.', 'error');
                    } else {
                        const link = document.createElement('a');
                        link.href = url; link.style.display = 'none';
                        document.body.appendChild(link); link.click();
                        document.body.removeChild(link);
                    }
                });
            });
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#c0392b;">
                Unable to load recent reports.</td></tr>`;
        }
    }

    /* --------------------------------------------------------------- */
    function buildViewUrl(r) {
        const p = new URLSearchParams({
            report_type:   r.report_type    || 'ServiceRequest',
            date_from:     r.date_from      || '',
            date_to:       r.date_to        || '',
            export_format: (r.export_format || 'PDF').toUpperCase(),
            user_id:       CURRENT_USER.id  || 0,
            role:          CURRENT_USER.role || 'admin',
            view:          '1',  // suppress duplicate log entry
        });
        return `${API_GENERATE}?${p.toString()}`;
    }

    /* --------------------------------------------------------------- */
    function iconFor(fmt) {
        const f = (fmt || '').toUpperCase();
        if (f === 'PDF')   return 'fa-file-pdf';
        if (f === 'EXCEL') return 'fa-file-excel';
        if (f === 'CSV')   return 'fa-file-csv';
        return 'fa-file';
    }

    function escHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c =>
            ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function formatDate(dt) {
        if (!dt) return '-';
        const d = new Date(dt.replace(' ', 'T'));
        if (isNaN(d)) return dt;
        return d.toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function showToast(msg, type = 'success') {
        const t = document.getElementById('toastMsg');
        if (!t) return;
        t.textContent = msg;
        t.className = 'toast-message show ' + (type === 'error' ? 'toast-error' : 'toast-success');
        setTimeout(() => t.classList.remove('show'), 3200);
    }
})();
