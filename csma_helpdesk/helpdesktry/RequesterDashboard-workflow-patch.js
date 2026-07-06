// RequesterDashboard-workflow-patch.js
// ─────────────────────────────────────────────────────────────────────────────
// Changes to make in RequesterDashboard.js to complete the workflow fixes.
// Apply these changes in VS Code to the full RequesterDashboard.js file.
// ─────────────────────────────────────────────────────────────────────────────

// ── CHANGE 1: After successful form submission, show approval notice ──────────
// Find the handleFormSubmit() success block and REPLACE it with:

/*   FIND this in handleFormSubmit():
        closeRequestModal();
        showConfirmationModal(data.ticket_code, title, data.priority, deptName);
        showToast(`✓ Request ${data.ticket_code} submitted successfully!`);
        await refreshAllData();

     REPLACE WITH: */

function applySubmitSuccessHandler(data, title, deptName) {
    closeRequestModal();

    // FIX 1: Show approval notice if this category requires dept head approval
    if (data.needs_approval) {
        showApprovalNotice(data.ticket_code, title, data.priority, deptName);
    } else {
        showConfirmationModal(data.ticket_code, title, data.priority, deptName);
    }
    showToast(`✓ Request ${data.ticket_code} submitted.`);
}

// ── CHANGE 2: Add showApprovalNotice() function ───────────────────────────────
// Add this new function to RequesterDashboard.js:

function showApprovalNotice(ticketCode, title, priority, department) {
    // Reuse the confirmation modal but add the approval warning banner
    const modal = document.getElementById('confirmationModal');
    if (!modal) return;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('confirmTicketId', ticketCode);
    set('confirmTitle',    title);
    set('confirmPriority', priority);
    set('confirmDept',     department);
    set('confirmDate',     new Date().toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }));

    // Inject approval banner inside the modal if it doesn't exist yet
    const existingBanner = document.getElementById('approvalNoticeBanner');
    if (!existingBanner) {
        const summaryCard = modal.querySelector('.request-summary-card');
        if (summaryCard) {
            const banner = document.createElement('div');
            banner.id = 'approvalNoticeBanner';
            banner.className = 'approval-notice-banner';
            banner.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <div>
                    <strong>Approval Required</strong>
                    <p>This request requires Department Head approval before it can be processed by the IT team.
                    Your Department Head will review and approve this request.</p>
                </div>`;
            summaryCard.parentNode.insertBefore(banner, summaryCard);
        }
    } else {
        existingBanner.style.display = 'flex';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// ── CHANGE 3: getStatusClass() — add Pending Confirmation ─────────────────────
// FIND getStatusClass() and ADD this case:

function getStatusClassUpdated(s) {
    const lc = (s || '').toLowerCase().replace(' ', '-');
    const map = {
        'pending':              'status-pending',
        'ongoing':              'status-ongoing',
        'completed':            'status-completed',
        'pending-confirmation': 'status-pending-confirmation',
        'closed':               'status-closed',
    };
    return map[lc] || 'status-pending';
}

// ── CHANGE 4: showRequestDetail() — add resolve button for Pending Confirmation
// FIND the resolveBtn variable in showRequestDetail() and REPLACE with:

/*   FIND:
        const resolveBtn = ticket.status === 'Completed'
            ? `<button ...>Confirm Issue Resolved</button>` : '';

     REPLACE WITH: */

function buildResolveButtonHtml(ticket) {
    // FIX 3: The resolve button now appears when status is 'Pending Confirmation'
    // (IT Admin has sent the confirmation request) instead of when 'Completed'.
    // This matches Image 4 — the requester sees the confirmation dialog after
    // the IT Admin clicks "Send Confirmation Request".
    if (ticket.status === 'Pending Confirmation') {
        return `<button class="btn-confirm-resolve-trigger" id="showResolveConfirmBtn"
                        data-id="${ticket.request_id}" data-code="${ticket.id}">
                    <i class="fas fa-check-double"></i> Confirm Issue Resolved
                </button>`;
    }
    return '';
}

// ── CHANGE 5: CSS additions for approval notice banner ────────────────────────
// Add to RequesterDashboard.css:
/*
.approval-notice-banner {
    display: flex; gap: 14px; align-items: flex-start;
    background: #fff9e6; border: 1.5px solid #f0c040; border-radius: 14px;
    padding: 14px 18px; margin-bottom: 16px;
}
.approval-notice-banner i { color: #c97a2e; font-size: 1.2rem; flex-shrink: 0; margin-top: 2px; }
.approval-notice-banner strong { display: block; font-size: 0.85rem; color: #7a4a0a; margin-bottom: 4px; }
.approval-notice-banner p { font-size: 0.78rem; color: #5a4a1e; line-height: 1.5; margin: 0; }
.status-pending-confirmation { background: #f0e6ff; color: #7c3aed; }
*/
