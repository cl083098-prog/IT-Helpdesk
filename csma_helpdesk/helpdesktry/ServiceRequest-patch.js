// ServiceRequest.js — Workflow Fix Patch
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO APPLY:
//   1. Find the existing editTicket() function in ServiceRequest.js
//   2. Replace the entire editTicket() function with the new one below
//   3. Add the initCompletionModal() call inside initServiceRequest()
//   4. Add the HTML modal markup to ServiceRequest.html
// ─────────────────────────────────────────────────────────────────────────────

// ── NEW: Mark as Completed modal (matches Image 3 design) ────────────────────
// Add this HTML block to ServiceRequest.html, just before </body>:
/*
<div id="completionModal" class="modal-overlay completion-modal-overlay" style="display:none;">
    <div class="completion-modal-box">
        <div class="completion-modal-header">
            <h3><i class="fas fa-check-circle"></i> Mark Request as Completed</h3>
        </div>
        <div class="completion-modal-body">
            <div class="completion-note-banner">
                <i class="fas fa-info-circle"></i>
                <p><strong>Note:</strong> The requester will receive a confirmation request to verify
                that the issue has been resolved before the ticket is closed.</p>
            </div>
            <div class="completion-ticket-detail">
                <div class="completion-detail-row">
                    <span class="completion-detail-label">Ticket ID</span>
                    <span class="completion-detail-value" id="cmTicketId">—</span>
                </div>
                <div class="completion-detail-row">
                    <span class="completion-detail-label">Requester</span>
                    <span class="completion-detail-value" id="cmRequester">—</span>
                </div>
                <div class="completion-detail-row">
                    <span class="completion-detail-label">Issue</span>
                    <span class="completion-detail-value" id="cmIssue">—</span>
                </div>
            </div>
        </div>
        <div class="completion-modal-footer">
            <button class="btn-send-confirmation" id="btnSendConfirmation">
                <i class="fas fa-paper-plane"></i> Send Confirmation Request
            </button>
            <button class="btn-cancel-completion" id="btnCancelCompletion">Cancel</button>
        </div>
    </div>
</div>
*/

// ── REPLACE editTicket() with this version ────────────────────────────────────
function editTicket(ticketId) {
    const ticket = ticketsData.find(t => t.id === ticketId);
    if (!ticket) return;

    // FIX 3: If the admin wants to mark as Completed, show the confirmation
    // modal instead of directly setting the status.
    const currentStatus = ticket.status;
    const newStatus = prompt(
        `✏️ Edit status for ${ticket.id}\nCurrent: ${currentStatus}\n\nEnter: Pending / Ongoing\n\n` +
        `To mark as Completed, use the "Mark as Completed" action on the ticket row.`,
        currentStatus
    );
    if (newStatus === null) return;

    // Block admin from setting Completed/Closed/Pending Confirmation directly
    const blockedByAdmin = ['Completed', 'Closed', 'Pending Confirmation'];
    if (blockedByAdmin.includes(newStatus)) {
        showToast(
            'Use "Mark as Completed" to complete a ticket — the requester must confirm first.',
            'warning'
        );
        return;
    }

    if (!['Pending', 'Ongoing'].includes(newStatus)) {
        showToast('Invalid status. Must be Pending or Ongoing for direct edit.', 'error');
        return;
    }

    updateTicketStatusInDB(ticket.dbId, ticket.id, newStatus);
}

// ── NEW: Open the completion confirmation modal (Image 3) ────────────────────
function openCompletionModal(ticketId) {
    const ticket = ticketsData.find(t => t.id === ticketId);
    if (!ticket) return;

    // Populate modal fields
    document.getElementById('cmTicketId').textContent   = ticket.id;
    document.getElementById('cmRequester').textContent  = ticket.requester;
    document.getElementById('cmIssue').textContent      = ticket.title;

    // Store the dbId on the button so the handler can use it
    document.getElementById('btnSendConfirmation').dataset.dbId    = ticket.dbId;
    document.getElementById('btnSendConfirmation').dataset.display = ticket.id;

    document.getElementById('completionModal').style.display = 'flex';
}

// ── NEW: Wire up the modal buttons ────────────────────────────────────────────
function initCompletionModal() {
    const modal      = document.getElementById('completionModal');
    const sendBtn    = document.getElementById('btnSendConfirmation');
    const cancelBtn  = document.getElementById('btnCancelCompletion');

    cancelBtn?.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });

    sendBtn?.addEventListener('click', async () => {
        const dbId      = Number(sendBtn.dataset.dbId);
        const displayId = sendBtn.dataset.display;
        const cu        = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

        sendBtn.disabled    = true;
        sendBtn.textContent = 'Sending…';

        try {
            const res  = await fetch('../api/update_ticket.php', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    action:      'send_confirmation',   // FIX 3 trigger
                    ticket_id:   dbId,
                    admin_id:    cu.id,
                    admin_name:  cu.name || 'IT Admin',
                })
            });
            const json = await res.json();

            modal.style.display = 'none';

            if (json.success) {
                showToast(`✅ ${displayId} is now Pending Confirmation — requester notified.`, 'success');
                loadTicketsFromDB();
            } else {
                showToast('Failed: ' + (json.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            modal.style.display = 'none';
            showToast('Network error.', 'error');
        } finally {
            sendBtn.disabled    = false;
            sendBtn.innerHTML   = '<i class="fas fa-paper-plane"></i> Send Confirmation Request';
        }
    });
}

// ── NEW: Render table needs a "Mark as Completed" button ────────────────────
// Add this to your existing renderTable() function where action buttons appear.
// Find where the edit/delete buttons are rendered and add:
//   ${ticket.status === 'Ongoing' ? `<button class="btn-mark-complete" data-id="${ticket.id}" onclick="openCompletionModal('${ticket.id}')"><i class='fas fa-check'></i> Mark Complete</button>` : ''}
//
// Also add 'Pending Confirmation' to the valid status display classes:
//   'Pending Confirmation' → 'status-pending-confirmation'
// And ensure loadTicketsFromDB() handles this status.

// ── CSS to add to ServiceRequest.css ─────────────────────────────────────────
/*
.completion-modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    z-index: 3000; padding: 20px;
}
.completion-modal-box {
    background: white; border-radius: 20px; width: 100%; max-width: 480px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.15); overflow: hidden;
}
.completion-modal-header {
    padding: 20px 24px; border-bottom: 1px solid #eef2f5;
    font-size: 1rem; font-weight: 700; color: #1c4c6e;
    display: flex; align-items: center; gap: 10px;
}
.completion-modal-header i { color: #2a7a55; }
.completion-modal-body { padding: 20px 24px; }
.completion-note-banner {
    display: flex; gap: 12px; align-items: flex-start;
    background: #fff9e6; border: 1.5px solid #f0c040; border-radius: 12px;
    padding: 14px 16px; margin-bottom: 18px;
}
.completion-note-banner i { color: #c97a2e; font-size: 1rem; flex-shrink: 0; margin-top: 2px; }
.completion-note-banner p { font-size: 0.82rem; color: #5a4a1e; line-height: 1.5; margin: 0; }
.completion-detail-row {
    display: flex; flex-direction: column; gap: 3px; margin-bottom: 14px;
}
.completion-detail-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6c86a0; }
.completion-detail-value { font-size: 0.9rem; font-weight: 600; color: #1c4c6e; }
.completion-modal-footer {
    display: flex; gap: 12px; padding: 16px 24px;
    border-top: 1px solid #eef2f5; justify-content: flex-end;
}
.btn-send-confirmation {
    background: #1a4a6e; color: white; border: none;
    padding: 11px 22px; border-radius: 40px;
    font-weight: 700; font-size: 0.85rem; font-family: 'Inter',sans-serif;
    cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s;
}
.btn-send-confirmation:hover { background: #0f3d5a; }
.btn-send-confirmation:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-cancel-completion {
    background: #f4f6f9; border: 1.5px solid #dee4ea;
    padding: 11px 20px; border-radius: 40px;
    font-weight: 500; font-size: 0.85rem; font-family: 'Inter',sans-serif;
    color: #6c86a0; cursor: pointer; transition: all 0.2s;
}
.btn-cancel-completion:hover { border-color: #c62828; color: #c62828; }
.btn-mark-complete {
    background: #e2f0ea; border: none; padding: 5px 12px; border-radius: 30px;
    font-size: 0.75rem; font-weight: 600; font-family: 'Inter',sans-serif;
    color: #2a7a55; cursor: pointer; transition: all 0.2s; margin-left: 4px;
}
.btn-mark-complete:hover { background: #2a7a55; color: white; }
.status-pending-confirmation { background: #f0e6ff; color: #7c3aed; }
*/
