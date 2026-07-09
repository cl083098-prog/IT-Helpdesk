// Inventory.js — IT Admin inventory management, wired to /api/inventory.php
// Keeps all existing DOM IDs from Inventory.html and Inventory.css.

(function () {
    'use strict';

    // ─── Auth ────────────────────────────────────────────────────────────────
    const raw = sessionStorage.getItem('currentUser');
    if (!raw) { window.location.href = 'Login.html'; return; }
    let currentUser;
    try { currentUser = JSON.parse(raw); }
    catch (e) { sessionStorage.removeItem('currentUser'); window.location.href = 'Login.html'; return; }

    // Only IT Admin may use this page.  School Admin has its own view-only page.
    if (currentUser.role !== 'admin') {
        const dest = {
            school_admin: 'SchoolAdmin.html',
            dept_head:    'DeptHeadDashboard.html',
            requester:    'RequesterDashboard.html',
        };
        window.location.replace(dest[currentUser.role] || 'Login.html');
        return;
    }

    const API      = '../api/inventory.php';
    const USER_ID  = currentUser.id;
    const ROLE     = currentUser.role;
    const IS_ADMIN = ROLE === 'admin';

    // ─── State ───────────────────────────────────────────────────────────────
    let inventoryItems  = [];
    let allocatedItems  = [];
    let currentTab      = 'overall';   // overall|equipment|consumables|allocated
    let searchQuery     = '';
    let selectedItems   = new Set();

    // ─── Boot ────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else { init(); }

    async function init() {
        buildModals();
        wireStaticButtons();
        wireTabs();
        wireSearch();
        await refreshAll();
    }

    // ─── API helpers ─────────────────────────────────────────────────────────
    async function apiGet(action, params = {}) {
        const qs  = new URLSearchParams({ action, user_role: ROLE, user_id: USER_ID, ...params });
        const url = `${API}?${qs}`;
        try {
            const r    = await fetch(url);
            const text = await r.text();
            let j;
            try { j = JSON.parse(text); }
            catch (e) {
                console.error('[Inventory] Non-JSON response from', url, '\n', text);
                showToast(`Server returned non-JSON (HTTP ${r.status}). See console.`, true);
                return { success: false, message: 'Bad JSON' };
            }
            if (!j.success) {
                console.warn('[Inventory] API failure:', action, j);
                showToast(j.message || `Request failed (HTTP ${r.status})`, true);
            }
            return j;
        } catch (err) {
            console.error('[Inventory] Network error on', url, err);
            showToast(`Network error: ${err.message}`, true);
            return { success: false, message: err.message };
        }
    }

    async function apiPost(action, body = {}) {
        const url     = `${API}?action=${encodeURIComponent(action)}`;
        const payload = { action, user_role: ROLE, user_id: USER_ID, ...body };
        try {
            const r    = await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload),
            });
            const text = await r.text();
            let j;
            try { j = JSON.parse(text); }
            catch (e) {
                console.error('[Inventory] Non-JSON response from', url, '\nPayload:', payload, '\nResponse:', text);
                showToast(`Server returned non-JSON (HTTP ${r.status}). Open console to see the response.`, true);
                return { success: false, message: 'Bad JSON' };
            }
            if (!j.success) {
                console.warn('[Inventory] API failure:', action, 'payload:', payload, 'response:', j);
                showToast(j.message || `Request failed (HTTP ${r.status})`, true);
            }
            return j;
        } catch (err) {
            console.error('[Inventory] Network error on', url, err);
            showToast(`Network error: ${err.message}`, true);
            return { success: false, message: err.message };
        }
    }

    // ─── Data load ───────────────────────────────────────────────────────────
    async function refreshAll() {
        await Promise.all([loadItems(), loadSummary(), loadAllocations()]);
        renderInventoryTable();
        renderAllocatedTable();
        renderLowStockCards();
    }

    async function loadItems() {
        const params = {};
        if (currentTab === 'equipment')   params.tab = 'equipment';
        if (currentTab === 'consumables') params.tab = 'consumable';
        if (searchQuery) params.search = searchQuery;
        const j = await apiGet('list_items', params);
        inventoryItems = j.items || [];
    }

    async function loadSummary() {
        const j = await apiGet('get_summary');
        if (!j.success) return;
        const s   = j.summary || {};
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        const setHtml = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML  = v; };
        setHtml('totalInventoryValue', formatCurrency(s.total_value));
        setHtml('equipmentValue',      formatCurrency(s.equipment_value));
        setHtml('consumableValue',     formatCurrency(s.consumable_value));
        set('equipmentCount',          `${s.equipment_units || 0} units`);
        set('consumableCount',         `${s.consumable_units || 0} units`);
        set('totalUnits',              s.total_units       || 0);
        set('totalItems',              s.total_items       || 0);
        set('equipmentTypeCount',      s.equipment_count   || 0);
        set('consumableTypeCount',     s.consumable_count  || 0);
        set('lowStockCount',           s.low_stock         || 0);
        set('oversupplyCount',         s.oversupply        || 0);
    }

    async function loadAllocations() {
        const j = await apiGet('list_allocations');
        allocatedItems = j.allocations || [];
    }

    // ─── Formatting ──────────────────────────────────────────────────────────
    function formatCurrency(amount) {
        const n = Number(amount) || 0;
        return `\u20b1${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    }

    // ─── Render: inventory table ─────────────────────────────────────────────
    function renderInventoryTable() {
        const tbody = document.getElementById('inventoryTableBody');
        if (!tbody) return;

        // Hide/show the Actions column depending on tab (Overall = no actions).
        const showActions = currentTab !== 'overall';
        const table = document.getElementById('inventoryTable');
        if (table) {
            const headers = table.querySelectorAll('thead th');
            const lastTh = headers[headers.length - 1];
            if (lastTh) lastTh.style.display = showActions ? '' : 'none';
        }

        if (!inventoryItems.length) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="${showActions ? 10 : 9}">No inventory items found.</td></tr>`;
            return;
        }

        tbody.innerHTML = inventoryItems.map(item => {
            const statusClass = item.status === 'Low Stock' ? 'status-badge-lowstock'
                              : item.status === 'Oversupply' ? 'status-badge-lowstock'
                              : 'status-badge-instock';
            const isSel = selectedItems.has(item.id);
            const actionsCell = showActions ? `
                    <td class="row-actions">
                        <button class="row-action-btn edit"   data-action="edit"   data-id="${item.id}"><i class="fas fa-edit"></i></button>
                        <button class="row-action-btn delete" data-action="delete" data-id="${item.id}"><i class="fas fa-trash-alt"></i></button>
                    </td>` : '';
            return `
                <tr class="${isSel ? 'selected' : ''}" data-id="${item.id}">
                    <td><input type="checkbox" class="item-checkbox" data-id="${item.id}" ${isSel ? 'checked' : ''}></td>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${escapeHtml(item.type)}</td>
                    <td>${escapeHtml(item.category)}</td>
                    <td>${item.quantity}</td>
                    <td>${item.low_stock_pct}%</td>
                    <td>${formatCurrency(item.price_unit)}</td>
                    <td>${formatCurrency(item.total_value)}</td>
                    <td><span class="${statusClass}">${escapeHtml(item.status)}</span></td>${actionsCell}
                </tr>`;
        }).join('');

        tbody.querySelectorAll('.item-checkbox').forEach(cb => {
            cb.addEventListener('change', e => {
                const id = parseInt(e.target.dataset.id, 10);
                if (e.target.checked) selectedItems.add(id); else selectedItems.delete(id);
                e.target.closest('tr').classList.toggle('selected', e.target.checked);
                updateBulkBar();
            });
        });

        tbody.querySelectorAll('.row-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id, 10);
                if (btn.dataset.action === 'edit')   openEditModal(id);
                if (btn.dataset.action === 'delete') deleteItem(id);
            });
        });
    }

    // ─── Render: allocated items table ───────────────────────────────────────
    function renderAllocatedTable() {
        const cont = document.getElementById('allocatedItemsContainer');
        if (!cont) return;
        if (!allocatedItems.length) {
            cont.innerHTML = '<div class="empty-state">No allocated items yet.</div>';
            return;
        }
        cont.innerHTML = `
            <div class="inventory-table-wrapper">
                <table class="inventory-table">
                    <thead><tr>
                        <th>Department</th><th>Item Name</th><th>Type</th>
                        <th>Quantity</th><th>Date Allocated</th><th>Action</th>
                    </tr></thead>
                    <tbody>
                        ${allocatedItems.map(a => `
                            <tr>
                                <td>${escapeHtml(a.department)}</td>
                                <td>${escapeHtml(a.item_name)}</td>
                                <td>${escapeHtml(a.type)}</td>
                                <td>${a.quantity}</td>
                                <td>${escapeHtml(a.date_allocated)}</td>
                                <td>${escapeHtml(a.action_type)}${a.from_department ? ' (from ' + escapeHtml(a.from_department) + ')' : ''}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    // ─── Render: low-stock cards (matches Inventory.css classes) ─────────────
    function renderLowStockCards() {
        const container = document.getElementById('lowstockCardsContainer');
        if (container) {
            const low = inventoryItems.filter(i => i.status === 'Low Stock' && i.type === 'Consumable');
            if (!low.length) {
                container.innerHTML = '<div class="empty-state">No consumables are below their low-stock threshold.</div>';
            } else {
                container.innerHTML = low.map(i => `
                    <div class="lowstock-item-card">
                        <div class="lowstock-info">
                            <h4>${escapeHtml(i.name)}</h4>
                            <p>${escapeHtml(i.category)}</p>
                        </div>
                        <div class="lowstock-qty">Qty: ${i.quantity}</div>
                        <button class="reorder-btn" data-reorder-id="${i.id}">Reorder</button>
                    </div>`).join('');
                container.querySelectorAll('[data-reorder-id]').forEach(b => {
                    b.addEventListener('click', () => openReorderModal(+b.dataset.reorderId));
                });
            }
        }

        // Also render the "Low Stock Items by Department" grid.
        const grid = document.getElementById('deptLowstockGrid');
        if (!grid) return;

        const lowAll = inventoryItems.filter(i => i.status === 'Low Stock');
        if (!lowAll.length) {
            grid.innerHTML = '<div class="empty-state">No low-stock items across departments.</div>';
            return;
        }
        // Group by department
        const byDept = {};
        lowAll.forEach(i => {
            const d = i.department || 'General';
            (byDept[d] ||= []).push(i);
        });
        grid.innerHTML = Object.keys(byDept).sort().map(dept => `
            <div class="dept-card">
                <h4>${escapeHtml(dept)}</h4>
                ${byDept[dept].map(i => `
                    <div class="dept-item">
                        <div class="dept-item-info">
                            <span>${escapeHtml(i.name)}</span>
                            <small>${escapeHtml(i.type)} · ${escapeHtml(i.category)}</small>
                        </div>
                        <span class="lowstock-qty">${i.quantity}</span>
                    </div>`).join('')}
            </div>`).join('');
    }

    // Reorder = open Add Stock modal with the item preselected.
    function openReorderModal(itemId) {
        openAddStockModal();
        const sel = document.getElementById('stockItemSelect');
        if (sel) sel.value = String(itemId);
    }

    // ─── Tabs / search / static buttons ──────────────────────────────────────
    function wireTabs() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', async function () {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentTab = this.dataset.tab;
                selectedItems.clear();
                updateBulkBar();
                toggleTabViews();
                if (currentTab === 'allocated') {
                    await loadAllocations();
                    renderAllocatedTable();
                } else {
                    await loadItems();
                    renderInventoryTable();
                }
            });
        });
    }

    function toggleTabViews() {
        const tableWrap = document.querySelector('.inventory-table-wrapper');
        const allocCont = document.getElementById('allocatedItemsContainer');
        const selectRow = document.querySelector('.select-all-row');
        const lowSec    = document.getElementById('lowstockSection');
        const isAlloc   = currentTab === 'allocated';

        if (tableWrap) tableWrap.style.display = isAlloc ? 'none'  : 'block';
        if (allocCont) allocCont.style.display = isAlloc ? 'block' : 'none';
        if (selectRow) selectRow.style.display = isAlloc ? 'none'  : 'flex';
        if (lowSec)    lowSec.style.display    = isAlloc ? 'none'  : 'block';
    }

    function wireSearch() {
        const input = document.getElementById('inventorySearch');
        if (!input) return;
        let t;
        input.addEventListener('input', e => {
            clearTimeout(t);
            searchQuery = e.target.value.trim();
            t = setTimeout(async () => {
                await loadItems();
                renderInventoryTable();
            }, 250);
        });
    }

    function wireStaticButtons() {
        document.getElementById('addNewItemBtn')?.addEventListener('click', openAddModal);
        document.getElementById('addStockBtn')?.addEventListener('click', openAddStockModal);
        document.getElementById('allocateItemBtn')?.addEventListener('click', () => openAllocateModal('Allocate'));
        document.getElementById('viewAllItemsBtn')?.addEventListener('click', async () => {
            searchQuery = '';
            const inp = document.getElementById('inventorySearch');
            if (inp) inp.value = '';
            await loadItems();
            renderInventoryTable();
        });
        document.getElementById('bulkDeleteBtn')?.addEventListener('click', bulkDelete);
        document.getElementById('bulkCancelBtn')?.addEventListener('click', () => { selectedItems.clear(); updateBulkBar(); renderInventoryTable(); });

        const selAll = id => document.getElementById(id)?.addEventListener('change', e => {
            selectedItems = e.target.checked ? new Set(inventoryItems.map(i => i.id)) : new Set();
            renderInventoryTable();
            updateBulkBar();
        });
        selAll('selectAllCheckbox');
        selAll('selectAllHeaderCheckbox');
    }

    function updateBulkBar() {
        const bar   = document.getElementById('bulkActionsBar');
        const count = document.getElementById('selectedCount');
        if (count) count.textContent = selectedItems.size;
        if (bar)   bar.style.display = selectedItems.size ? 'flex' : 'none';
    }

    // ─── Modals ──────────────────────────────────────────────────────────────
    function buildModals() {
        if (document.getElementById('invModalHost')) return;
        const host = document.createElement('div');
        host.id = 'invModalHost';
        host.innerHTML = `
            <!-- Add / Edit Item -->
            <div class="modal-overlay" id="invItemModal">
                <div class="edit-modal">
                    <div class="modal-header">
                        <h3 id="invItemTitle"><i class="fas fa-box"></i> Add New Item</h3>
                        <button class="modal-close" data-close>&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="edit-form">
                            <input type="hidden" id="invItemId">

                            <div class="form-group">
                                <label for="invItemType">Category (Type)</label>
                                <select id="invItemType" class="form-input">
                                    <option value="Equipment">Equipment</option>
                                    <option value="Consumable">Consumable</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label for="invItemName">Product Name</label>
                                <input type="text" id="invItemName" class="form-input" placeholder="e.g. Dell Monitor 24&quot;">
                            </div>

                            <div class="form-group">
                                <label for="invItemCategory">Classification / Category</label>
                                <input type="text" id="invItemCategory" class="form-input" placeholder="e.g. Display, Ink, Paper">
                            </div>

                            <div class="form-row">
                                <div class="form-group">
                                    <label for="invItemQty">Quantity</label>
                                    <input type="number" id="invItemQty" class="form-input" min="0" value="0">
                                </div>
                                <div class="form-group">
                                    <label for="invItemPrice">Price (per unit)</label>
                                    <input type="number" id="invItemPrice" class="form-input" min="0" step="0.01" value="0">
                                </div>
                            </div>

                            <div class="form-row">
                                <div class="form-group">
                                    <label for="invItemLowPct">Low-stock %</label>
                                    <input type="number" id="invItemLowPct" class="form-input" min="0" max="100" value="15">
                                    <small class="form-hint">Percent of oversupply threshold</small>
                                </div>
                                <div class="form-group">
                                    <label for="invItemOverT">Oversupply threshold</label>
                                    <input type="number" id="invItemOverT" class="form-input" min="1" value="100">
                                </div>
                            </div>

                            <div class="form-group">
                                <label for="invItemDept">Department</label>
                                <select id="invItemDept" class="form-input">
                                    <option>Elementary</option>
                                    <option>Junior High School</option>
                                    <option>Senior High School</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel-modal" data-close>Cancel</button>
                        <button class="btn-save-modal" id="invItemSaveBtn">Save Changes</button>
                    </div>
                </div>
            </div>

            <!-- Add Stock -->
            <div class="modal-overlay" id="invAddStockModal">
                <div class="edit-modal">
                    <div class="modal-header">
                        <h3><i class="fas fa-plus-circle"></i> Add Stock</h3>
                        <button class="modal-close" data-close>&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="edit-form">
                            <div class="form-group">
                                <label for="stockItemSelect">Item Name</label>
                                <select id="stockItemSelect" class="form-input"></select>
                            </div>
                            <div class="form-group">
                                <label for="stockQty">Quantity to Add</label>
                                <input type="number" id="stockQty" class="form-input" min="1" value="1">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel-modal" data-close>Cancel</button>
                        <button class="btn-save-modal" id="stockSaveBtn">Add Stock</button>
                    </div>
                </div>
            </div>

            <!-- Allocate / Transfer -->
            <div class="modal-overlay" id="invAllocateModal">
                <div class="allocate-modal">
                    <div class="modal-header">
                        <h3 id="invAllocateTitle"><i class="fas fa-exchange-alt"></i> Allocate Item</h3>
                        <button class="modal-close" data-close>&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="allocate-form">
                            <div class="action-type-group">
                                <label>Action Type</label>
                                <div class="action-options">
                                    <label class="action-option">
                                        <input type="radio" name="allocAction" value="Allocate" checked>
                                        <span>Allocate (From Inventory)</span>
                                    </label>
                                    <label class="action-option">
                                        <input type="radio" name="allocAction" value="Transfer">
                                        <span>Transfer (Between Departments)</span>
                                    </label>
                                </div>
                            </div>

                            <div class="form-group">
                                <label for="allocItemSelect">Select Item</label>
                                <select id="allocItemSelect" class="form-input"></select>
                            </div>

                            <div class="form-group" id="allocFromRow" style="display:none;">
                                <label for="allocFromDept">From Department</label>
                                <select id="allocFromDept" class="form-input"></select>
                            </div>

                            <div class="form-group">
                                <label for="allocToDept">To Department</label>
                                <select id="allocToDept" class="form-input">
                                    <option>Elementary</option>
                                    <option>Junior High School</option>
                                    <option>Senior High School</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label for="allocQty">Quantity to Allocate</label>
                                <input type="number" id="allocQty" class="form-input" min="1" value="1">
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel-modal" data-close>Cancel</button>
                        <button class="btn-save-modal" id="allocSaveBtn">Allocate Item</button>
                    </div>
                </div>
            </div>

            <!-- Confirm Delete -->
            <div class="modal-overlay" id="invConfirmModal">
                <div class="edit-modal cd-modal">
                    <div class="modal-header">
                        <h3 id="invConfirmTitle">Confirm Delete</h3>
                        <button class="modal-close" data-cd-cancel>&times;</button>
                    </div>
                    <div class="modal-body">
                        <p id="invConfirmMsg" class="cd-msg">Are you sure you want to delete this item from inventory?</p>
                        <div id="invConfirmItemCard" class="cd-item-card"></div>
                        <p class="cd-warning">This action cannot be undone.</p>
                    </div>
                    <div class="modal-footer cd-footer">
                        <button class="btn-danger" id="invConfirmBtn">Delete Item</button>
                        <button class="btn-cancel-modal" data-cd-cancel>Cancel</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(host);

        // Minimal supplementary styles — only for things the system's CSS
        // doesn't already provide (radio action-type row, confirm-delete card,
        // toast, empty state). All modal chrome (colors, pill buttons, form
        // inputs) is inherited from Inventory.css.
        if (!document.getElementById('invModalStyles')) {
            const st = document.createElement('style');
            st.id = 'invModalStyles';
            st.textContent = `
                #invModalHost .modal-header h3 i{color:#1f6392;margin-right:6px;}
                #invModalHost .form-hint{display:block;font-size:.7rem;color:#95a5a6;margin-top:4px;}

                /* Toast */
                .inv-toast{position:fixed;bottom:24px;right:24px;background:#0f172a;color:#fff;
                    padding:12px 18px;border-radius:8px;font-family:'Inter',sans-serif;font-size:.9rem;
                    box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:10000;opacity:0;transition:opacity .2s;
                    pointer-events:none;}
                .inv-toast.show{opacity:1;}
                .inv-toast.error{background:#b91c1c;}
                .empty-state{padding:24px;text-align:center;color:#7f8c8d;
                    font-family:'Inter',sans-serif;font-size:.85rem;}

                /* Confirm Delete — themed to match reference */
                #invModalHost .cd-modal{max-width:460px;}
                #invModalHost .cd-msg{margin:0 0 16px;font-size:.9rem;color:#2c5a7a;line-height:1.5;}
                body.dark-mode #invModalHost .cd-msg{color:#cbd5e1;}
                #invModalHost .cd-item-card{background:#fef9e7;border:1px solid #f8e6a0;
                    border-radius:16px;padding:14px 18px;margin-bottom:14px;}
                body.dark-mode #invModalHost .cd-item-card{background:#3a3418;border-color:#665a2a;}
                #invModalHost .cd-item-name{font-weight:700;font-size:1rem;margin-bottom:8px;color:#1c4c6e;}
                body.dark-mode #invModalHost .cd-item-name{color:#f1f5f9;}
                #invModalHost .cd-item-line{font-size:.85rem;line-height:1.55;color:#2c5a7a;}
                body.dark-mode #invModalHost .cd-item-line{color:#cbd5e1;}
                #invModalHost .cd-warning{margin:0;color:#c62828;font-size:.85rem;font-weight:500;}
                #invModalHost .cd-footer{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
                #invModalHost .btn-danger{padding:10px 24px;border-radius:40px;border:none;
                    background:#e74c3c;color:#fff;font-weight:600;font-size:.85rem;cursor:pointer;
                    font-family:'Inter',sans-serif;transition:all .2s;}
                #invModalHost .btn-danger:hover{background:#c0392b;transform:translateY(-1px);}
            `;
            document.head.appendChild(st);
        }

        // Close handlers
        host.addEventListener('click', e => {
            if (e.target.matches('[data-close]') || e.target.classList.contains('modal-overlay')) {
                closeAllModals();
            }
        });

        document.getElementById('invItemSaveBtn').addEventListener('click', saveItem);
        document.getElementById('stockSaveBtn').addEventListener('click',   saveStock);
        document.getElementById('allocSaveBtn').addEventListener('click',   saveAllocation);
        // Wire the radio-button action type
        document.querySelectorAll('input[name="allocAction"]').forEach(r =>
            r.addEventListener('change', updateAllocateFormMode));
    }

    function closeAllModals() {
        ['invItemModal','invAddStockModal','invAllocateModal','invConfirmModal']
            .forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('active'); });
    }

    // ─── Add / Edit ──────────────────────────────────────────────────────────
    function openAddModal() {
        document.getElementById('invItemTitle').innerHTML = '<i class="fas fa-box"></i> Add New Item';
        document.getElementById('invItemSaveBtn').textContent = 'Add Item';
        document.getElementById('invItemId').value       = '';
        document.getElementById('invItemName').value     = '';
        document.getElementById('invItemType').value     = 'Equipment';
        document.getElementById('invItemCategory').value = '';
        document.getElementById('invItemQty').value      = 0;
        document.getElementById('invItemPrice').value    = 0;
        document.getElementById('invItemLowPct').value   = 15;
        document.getElementById('invItemOverT').value    = 100;
        document.getElementById('invItemDept').value     = 'Elementary';
        document.getElementById('invItemModal').classList.add('active');
    }

    function openEditModal(id) {
        const it = inventoryItems.find(i => Number(i.id) === Number(id));
        if (!it) return;
        document.getElementById('invItemTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Item';
        document.getElementById('invItemSaveBtn').textContent = 'Save Changes';
        document.getElementById('invItemId').value       = it.id;
        document.getElementById('invItemName').value     = it.name;
        document.getElementById('invItemType').value     = it.type;
        document.getElementById('invItemCategory').value = it.category;
        document.getElementById('invItemQty').value      = it.quantity;
        document.getElementById('invItemPrice').value    = it.price_unit;
        document.getElementById('invItemLowPct').value   = it.low_stock_pct;
        document.getElementById('invItemOverT').value    = it.oversupply_threshold;

        // If the saved department isn't one of the three canonical options
        // (e.g. legacy "Computer Science"), inject it so the value is preserved.
        const deptSel = document.getElementById('invItemDept');
        const known = Array.from(deptSel.options).map(o => o.value);
        if (it.department && !known.includes(it.department)) {
            const opt = document.createElement('option');
            opt.value = it.department;
            opt.textContent = `${it.department} (legacy)`;
            deptSel.appendChild(opt);
        }
        deptSel.value = it.department || 'Elementary';
        document.getElementById('invItemModal').classList.add('active');
    }

    async function saveItem() {
        const payload = {
            id:                   document.getElementById('invItemId').value,
            name:                 document.getElementById('invItemName').value.trim(),
            type:                 document.getElementById('invItemType').value,
            category:             document.getElementById('invItemCategory').value.trim() || 'General',
            quantity:             +document.getElementById('invItemQty').value    || 0,
            price_unit:           +document.getElementById('invItemPrice').value  || 0,
            low_stock_pct:        +document.getElementById('invItemLowPct').value || 15,
            oversupply_threshold: +document.getElementById('invItemOverT').value  || 100,
            department:           document.getElementById('invItemDept').value.trim() || 'Elementary',
        };
        if (!payload.name) { showToast('Product name is required.', true); return; }

        const isEdit = payload.id !== '' && payload.id !== '0';
        const j = isEdit
            ? await apiPost('update_item', payload)
            : await apiPost('add_item',    payload);
        if (!j.success) return;
        showToast(isEdit ? 'Item updated.' : 'Item added.');
        closeAllModals();
        await refreshAll();
    }

    async function deleteItem(id) {
        const item = inventoryItems.find(i => Number(i.id) === Number(id));
        const ok = await confirmDelete({
            title: 'Confirm Delete',
            message: 'Are you sure you want to delete this item from inventory?',
            item,
            confirmLabel: 'Delete Item',
        });
        if (!ok) return;
        const j = await apiPost('delete_item', { id });
        if (!j.success) return;
        selectedItems.delete(Number(id));
        showToast('Item deleted.');
        await refreshAll();
        updateBulkBar();
    }

    async function bulkDelete() {
        if (!selectedItems.size) return;
        const ok = await confirmDelete({
            title: 'Confirm Delete',
            message: `Are you sure you want to delete ${selectedItems.size} selected item(s) from inventory?`,
            confirmLabel: `Delete ${selectedItems.size} Item(s)`,
        });
        if (!ok) return;
        for (const id of selectedItems) { await apiPost('delete_item', { id }); }
        selectedItems.clear();
        showToast('Selected items deleted.');
        await refreshAll();
        updateBulkBar();
    }

    // Themed replacement for browser confirm(). Returns a Promise<boolean>.
    function confirmDelete({ title, message, item, confirmLabel = 'Delete Item' }) {
        return new Promise(resolve => {
            const overlay = document.getElementById('invConfirmModal');
            document.getElementById('invConfirmTitle').textContent = title;
            document.getElementById('invConfirmMsg').textContent   = message;

            const card = document.getElementById('invConfirmItemCard');
            if (item) {
                const total = (Number(item.price_unit) || 0) * (Number(item.quantity) || 0);
                card.style.display = 'block';
                card.innerHTML = `
                    <div class="cd-item-name">${escapeHtml(item.name)}</div>
                    <div class="cd-item-line">Category: <strong>${escapeHtml(item.category)}</strong></div>
                    <div class="cd-item-line">Quantity: <strong>${item.quantity} units</strong></div>
                    <div class="cd-item-line">Value: <strong>${formatCurrency(total)}</strong></div>
                `;
            } else {
                card.style.display = 'none';
                card.innerHTML = '';
            }

            const btnConfirm = document.getElementById('invConfirmBtn');
            btnConfirm.textContent = confirmLabel;

            overlay.classList.add('active');

            const done = (v) => {
                overlay.classList.remove('active');
                btnConfirm.removeEventListener('click', onOK);
                overlay.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', onKey);
                resolve(v);
            };
            const onOK     = () => done(true);
            const onCancel = (e) => {
                if (e.target.matches('[data-cd-cancel]') || e.target === overlay) done(false);
            };
            const onKey    = (e) => { if (e.key === 'Escape') done(false); };

            btnConfirm.addEventListener('click', onOK);
            overlay.addEventListener('click', onCancel);
            document.addEventListener('keydown', onKey);
        });
    }


    // ─── Add stock ───────────────────────────────────────────────────────────
    function openAddStockModal() {
        const sel = document.getElementById('stockItemSelect');
        sel.innerHTML = inventoryItems
            .map(i => `<option value="${i.id}">${escapeHtml(i.name)} (qty ${i.quantity})</option>`)
            .join('');
        document.getElementById('stockQty').value = 1;
        document.getElementById('invAddStockModal').classList.add('active');
    }
    async function saveStock() {
        const id  = +document.getElementById('stockItemSelect').value;
        const qty = +document.getElementById('stockQty').value;
        if (!id || qty <= 0) { showToast('Pick an item and enter a positive quantity.', true); return; }
        const j = await apiPost('add_stock', { id, quantity: qty });
        if (!j.success) return;
        showToast(`+${qty} units added.`);
        closeAllModals();
        await refreshAll();
    }

    // Small helper — read the selected radio value for action type.
    function getAllocAction() {
        const r = document.querySelector('input[name="allocAction"]:checked');
        return r ? r.value : 'Allocate';
    }

    // ─── Allocate / Transfer ─────────────────────────────────────────────────
    function openAllocateModal() {
        const sel = document.getElementById('allocItemSelect');
        sel.innerHTML = inventoryItems
            .map(i => `<option value="${i.id}">${escapeHtml(i.name)} (in stock ${i.quantity})</option>`)
            .join('');
        const allocRadio = document.querySelector('input[name="allocAction"][value="Allocate"]');
        if (allocRadio) allocRadio.checked = true;
        document.getElementById('allocQty').value = 1;
        updateAllocateFormMode();
        document.getElementById('invAllocateModal').classList.add('active');
    }
    function updateAllocateFormMode() {
        const isTransfer = getAllocAction() === 'Transfer';
        document.getElementById('invAllocateTitle').innerHTML = isTransfer
            ? '<i class="fas fa-exchange-alt"></i> Transfer Item'
            : '<i class="fas fa-exchange-alt"></i> Allocate Item';
        document.getElementById('allocSaveBtn').textContent = isTransfer ? 'Transfer Item' : 'Allocate Item';
        document.getElementById('allocFromRow').style.display = isTransfer ? 'block' : 'none';

        if (isTransfer) {
            const depts = [...new Set(allocatedItems.map(a => a.department))];
            const from = document.getElementById('allocFromDept');
            from.innerHTML = depts.length
                ? depts.map(d => `<option>${escapeHtml(d)}</option>`).join('')
                : '<option value="">— no allocations yet —</option>';
            // Item list restricted to items that have allocations
            const allocIds = new Set(allocatedItems.map(a => Number(a.item_id)));
            const items = inventoryItems.filter(i => allocIds.has(Number(i.id)));
            document.getElementById('allocItemSelect').innerHTML =
                items.map(i => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join('')
                || '<option value="">— no allocated items —</option>';
        } else {
            document.getElementById('allocItemSelect').innerHTML =
                inventoryItems.map(i => `<option value="${i.id}">${escapeHtml(i.name)} (in stock ${i.quantity})</option>`).join('');
        }
    }
    async function saveAllocation() {
        const isTransfer = getAllocAction() === 'Transfer';
        const itemId = +document.getElementById('allocItemSelect').value;
        const toDept = document.getElementById('allocToDept').value;
        const qty    = +document.getElementById('allocQty').value;
        if (!itemId || !toDept || qty <= 0) {
            showToast('Please complete all fields.', true); return;
        }

        let j;
        if (isTransfer) {
            const fromDept = document.getElementById('allocFromDept').value;
            if (!fromDept) { showToast('Choose a source department.', true); return; }
            j = await apiPost('transfer_item', {
                item_id: itemId, from_department: fromDept, to_department: toDept, quantity: qty,
            });
        } else {
            j = await apiPost('allocate_item', {
                item_id: itemId, to_department: toDept, quantity: qty,
            });
        }
        if (!j.success) return;
        showToast(isTransfer ? 'Transfer recorded.' : 'Allocation recorded.');
        closeAllModals();
        await refreshAll();
    }

    // ─── Toast ───────────────────────────────────────────────────────────────
    function showToast(msg, isError = false) {
        let t = document.getElementById('invToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'invToast';
            t.className = 'inv-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.toggle('error', !!isError);
        t.classList.add('show');
        clearTimeout(showToast._h);
        showToast._h = setTimeout(() => t.classList.remove('show'), 2600);
    }
})();