// Inventory.js - Full inventory management with auth, edit modal, and allocation system

(function () {
    'use strict';

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
        document.addEventListener('DOMContentLoaded', initInventory);
    } else {
        initInventory();
    }

    // ─── Data ────────────────────────────────────────────────────────────────

    let inventoryItems = [
        { id: 1,  name: 'Dell Monitor 24"',        type: 'Equipment',  category: 'Display',      quantity: 45,  lowStockPct: 10, oversupplyThreshold: 120, priceUnit: 250,  totalValue: 11250, status: 'In Stock',  department: 'Computer Science' },
        { id: 2,  name: 'HP Laptop',               type: 'Equipment',  category: 'Computer',     quantity: 8,   lowStockPct: 20, oversupplyThreshold: 100, priceUnit: 850,  totalValue: 6800,  status: 'Low Stock', department: 'Computer Science' },
        { id: 3,  name: 'Epson Projector',         type: 'Equipment',  category: 'Presentation', quantity: 15,  lowStockPct: 15, oversupplyThreshold: 80,  priceUnit: 650,  totalValue: 9750,  status: 'In Stock',  department: 'Engineering' },
        { id: 4,  name: 'Logitech Keyboard',       type: 'Equipment',  category: 'Peripheral',   quantity: 5,   lowStockPct: 12, oversupplyThreshold: 100, priceUnit: 45,   totalValue: 225,   status: 'Low Stock', department: 'Mathematics' },
        { id: 5,  name: 'Cisco Switch',            type: 'Equipment',  category: 'Network',      quantity: 22,  lowStockPct: 20, oversupplyThreshold: 60,  priceUnit: 320,  totalValue: 7040,  status: 'In Stock',  department: 'Computer Science' },
        { id: 6,  name: 'HDMI Cable',              type: 'Equipment',  category: 'Cable',        quantity: 68,  lowStockPct: 15, oversupplyThreshold: 200, priceUnit: 12,   totalValue: 816,   status: 'In Stock',  department: 'Engineering' },
        { id: 7,  name: 'Wireless Mouse',          type: 'Equipment',  category: 'Peripheral',   quantity: 32,  lowStockPct: 15, oversupplyThreshold: 150, priceUnit: 25,   totalValue: 800,   status: 'In Stock',  department: 'Business' },
        { id: 8,  name: 'Dell Desktop PC',         type: 'Equipment',  category: 'Computer',     quantity: 28,  lowStockPct: 20, oversupplyThreshold: 80,  priceUnit: 720,  totalValue: 20160, status: 'In Stock',  department: 'Arts & Sciences' },
        { id: 9,  name: 'Black Ink Cartridge HP',  type: 'Consumable', category: 'Ink',          quantity: 24,  lowStockPct: 10, oversupplyThreshold: 100, priceUnit: 45,   totalValue: 1080,  status: 'In Stock',  department: 'General' },
        { id: 10, name: 'Color Ink Cartridge HP',  type: 'Consumable', category: 'Ink',          quantity: 12,  lowStockPct: 10, oversupplyThreshold: 80,  priceUnit: 55,   totalValue: 660,   status: 'In Stock',  department: 'General' },
        { id: 11, name: 'Printer Toner Canon',     type: 'Consumable', category: 'Toner',        quantity: 3,   lowStockPct: 15, oversupplyThreshold: 50,  priceUnit: 120,  totalValue: 360,   status: 'Low Stock', department: 'Computer Science' },
        { id: 12, name: 'A4 Bond Paper',           type: 'Consumable', category: 'Paper',        quantity: 250, lowStockPct: 20, oversupplyThreshold: 500, priceUnit: 8,    totalValue: 2000,  status: 'In Stock',  department: 'General' }
    ];

    let allocatedItems = [
        { id: 1, itemId: 9,  itemName: 'Black Ink Cartridge HP', type: 'Consumable', department: 'Computer Science', quantity: 8,  dateAllocated: '2026-03-15', status: 'Allocated' },
        { id: 2, itemId: 12, itemName: 'A4 Bond Paper',          type: 'Consumable', department: 'Computer Science', quantity: 25, dateAllocated: '2026-03-10', status: 'Allocated' },
        { id: 3, itemId: 9,  itemName: 'Black Ink Cartridge HP', type: 'Consumable', department: 'Mathematics',      quantity: 5,  dateAllocated: '2026-03-12', status: 'Allocated' },
        { id: 4, itemId: 12, itemName: 'A4 Bond Paper',          type: 'Consumable', department: 'Mathematics',      quantity: 20, dateAllocated: '2026-03-12', status: 'Allocated' },
        { id: 5, itemId: -1, itemName: 'Bond Paper Legal (Ream)',type: 'Consumable', department: 'Mathematics',      quantity: 10, dateAllocated: '2026-03-12', status: 'Allocated' }
    ];

    // ─── State ───────────────────────────────────────────────────────────────

    let currentTab                        = 'overall';
    let searchQuery                       = '';
    let selectedItems                     = new Set();
    let currentEditingItem                = null;
    let currentSelectedItemForAllocation  = null;

    // ─── Init ────────────────────────────────────────────────────────────────

    function initInventory() {
        renderAllStats();
        renderInventoryTable();
        renderLowStockCards();
        renderDepartmentLowStock();
        createEditModal();
        createAllocateModal();

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentTab = this.getAttribute('data-tab');
                selectedItems.clear();
                updateBulkActionBar();

                const tableWrapper      = document.querySelector('.inventory-table-wrapper');
                const allocatedCont     = document.getElementById('allocatedItemsContainer');
                const selectAllRow      = document.querySelector('.select-all-row');
                const searchWrapper     = document.querySelector('.search-wrapper');
                const filterWrapper     = document.querySelector('.filter-btn-wrapper');
                const lowStockSection   = document.getElementById('lowstockSection');

                if (currentTab === 'allocated') {
                    if (tableWrapper)    tableWrapper.style.display    = 'none';
                    if (selectAllRow)    selectAllRow.style.display    = 'none';
                    if (searchWrapper)   searchWrapper.style.display   = 'none';
                    if (filterWrapper)   filterWrapper.style.display   = 'none';
                    if (lowStockSection) lowStockSection.style.display = 'none';
                    if (allocatedCont) {
                        allocatedCont.style.display = 'block';
                        renderAllocatedItemsTable();
                    }
                } else {
                    if (tableWrapper)    tableWrapper.style.display    = 'block';
                    if (selectAllRow)    selectAllRow.style.display    = 'flex';
                    if (searchWrapper)   searchWrapper.style.display   = 'flex';
                    if (filterWrapper)   filterWrapper.style.display   = 'flex';
                    if (lowStockSection) lowStockSection.style.display = 'block';
                    if (allocatedCont)   allocatedCont.style.display   = 'none';
                    renderInventoryTable();
                }
            });
        });

        // Search
        const searchInput = document.getElementById('inventorySearch');
        if (searchInput) {
            searchInput.addEventListener('input', e => {
                searchQuery = e.target.value.toLowerCase();
                selectedItems.clear();
                updateBulkActionBar();
                renderInventoryTable();
            });
        }

        // Buttons
        const addNewBtn   = document.getElementById('addNewItemBtn');
        if (addNewBtn)   addNewBtn.addEventListener('click',   () => showToast('Add new item feature coming soon!'));

        const addStockBtn = document.getElementById('addStockBtn');
        if (addStockBtn) addStockBtn.addEventListener('click', () => showToast('Add stock feature coming soon!'));

        const filterToggle = document.getElementById('filterToggleBtn');
        if (filterToggle) filterToggle.addEventListener('click', () => showToast('Advanced filters — coming soon!'));

        const viewAllBtn  = document.getElementById('viewAllItemsBtn');
        if (viewAllBtn)  viewAllBtn.addEventListener('click', viewAllItems);

        const allocateBtn = document.getElementById('allocateItemBtn');
        if (allocateBtn) allocateBtn.addEventListener('click', openAllocateModal);

        // Bulk actions
        const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
        if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', bulkDeleteItems);

        const bulkUpdateBtn = document.getElementById('bulkUpdateBtn');
        if (bulkUpdateBtn) bulkUpdateBtn.addEventListener('click', bulkUpdateStock);

        const bulkCancelBtn = document.getElementById('bulkCancelBtn');
        if (bulkCancelBtn) bulkCancelBtn.addEventListener('click', clearSelectedItems);

        // Select-all checkboxes
        const selectAllHeader = document.getElementById('selectAllHeaderCheckbox');
        const selectAllRow    = document.getElementById('selectAllCheckbox');
        if (selectAllHeader) selectAllHeader.addEventListener('change', e => selectAll(e.target.checked));
        if (selectAllRow)    selectAllRow.addEventListener('change',    e => selectAll(e.target.checked));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function formatCurrency(amount) {
        return `\u20b1${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function computeStatus(quantity, lowStockPct, oversupplyThreshold) {
        const threshold = (lowStockPct / 100) * oversupplyThreshold;
        return quantity <= threshold ? 'Low Stock' : 'In Stock';
    }

    // ─── Stats ───────────────────────────────────────────────────────────────

    function renderAllStats() {
        const equip    = inventoryItems.filter(i => i.type === 'Equipment');
        const cons     = inventoryItems.filter(i => i.type === 'Consumable');
        const totalVal = inventoryItems.reduce((s, i) => s + i.totalValue, 0);
        const equipVal = equip.reduce((s, i) => s + i.totalValue, 0);
        const consVal  = cons.reduce((s, i) => s + i.totalValue, 0);
        const equipUnits = equip.reduce((s, i) => s + i.quantity, 0);
        const consUnits  = cons.reduce((s, i) => s + i.quantity, 0);

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        const setHtml = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

        setHtml('totalInventoryValue', formatCurrency(totalVal));
        setHtml('equipmentValue',      formatCurrency(equipVal));
        setHtml('consumableValue',     formatCurrency(consVal));
        set('equipmentCount',          `${equipUnits} units`);
        set('consumableCount',         `${consUnits} units`);
        set('totalUnits',              equipUnits + consUnits);
        set('totalItems',              inventoryItems.length);
        set('equipmentTypeCount',      equip.length);
        set('consumableTypeCount',     cons.length);
        set('lowStockCount',           inventoryItems.filter(i => i.status === 'Low Stock').length);
        set('oversupplyCount',         inventoryItems.filter(i => i.quantity > (i.oversupplyThreshold || 100)).length);
    }

    // ─── Table ───────────────────────────────────────────────────────────────

    function getFilteredItems() {
        let items = [...inventoryItems];
        if (currentTab === 'equipment')   items = items.filter(i => i.type === 'Equipment');
        if (currentTab === 'consumables') items = items.filter(i => i.type === 'Consumable');
        if (searchQuery) {
            items = items.filter(i =>
                i.name.toLowerCase().includes(searchQuery) ||
                i.category.toLowerCase().includes(searchQuery)
            );
        }
        return items;
    }

    function renderInventoryTable() {
        const items = getFilteredItems();
        const tbody = document.getElementById('inventoryTableBody');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="10">No inventory items found.</td></tr>';
            updateSelectAllCheckboxes();
            return;
        }

        tbody.innerHTML = items.map(item => {
            const statusClass = item.status === 'Low Stock' ? 'status-badge-lowstock' : 'status-badge-instock';
            const isSelected  = selectedItems.has(item.id);
            return `
                <tr class="${isSelected ? 'selected' : ''}" data-id="${item.id}">
                    <td><input type="checkbox" class="item-checkbox" data-id="${item.id}" ${isSelected ? 'checked' : ''}></td>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${item.type}</td>
                    <td>${escapeHtml(item.category)}</td>
                    <td>${item.quantity}</td>
                    <td>${item.lowStockPct}%</td>
                    <td>${formatCurrency(item.priceUnit)}</td>
                    <td>${formatCurrency(item.totalValue)}</td>
                    <td><span class="${statusClass}">${item.status}</span></td>
                    <td class="row-actions">
                        <button class="row-action-btn view"   data-action="view"   data-id="${item.id}"><i class="fas fa-eye"></i></button>
                        <button class="row-action-btn edit"   data-action="edit"   data-id="${item.id}"><i class="fas fa-edit"></i></button>
                        <button class="row-action-btn delete" data-action="delete" data-id="${item.id}"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>`;
        }).join('');

        // Checkbox listeners
        tbody.querySelectorAll('.item-checkbox').forEach(cb => {
            cb.addEventListener('change', e => {
                const id = parseInt(e.target.dataset.id);
                if (e.target.checked) selectedItems.add(id);
                else                  selectedItems.delete(id);
                updateBulkActionBar();
                updateRowHighlight();
                updateSelectAllCheckboxes();
            });
        });

        // Action button delegation
        tbody.querySelectorAll('.row-action-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault();
                const id     = parseInt(btn.dataset.id);
                const action = btn.dataset.action;
                if (action === 'view')   viewItem(id);
                if (action === 'edit')   openEditModal(id);
                if (action === 'delete') deleteItem(id);
            });
        });

        updateSelectAllCheckboxes();
    }

    function updateRowHighlight() {
        document.querySelectorAll('#inventoryTableBody tr').forEach(row => {
            const id = parseInt(row.dataset.id);
            row.classList.toggle('selected', selectedItems.has(id));
        });
    }

    function updateSelectAllCheckboxes() {
        const filtered  = getFilteredItems();
        const total     = filtered.length;
        const selected  = filtered.filter(i => selectedItems.has(i.id)).length;
        const allChosen = total > 0 && selected === total;
        const sh = document.getElementById('selectAllHeaderCheckbox');
        const sr = document.getElementById('selectAllCheckbox');
        if (sh) sh.checked = allChosen;
        if (sr) sr.checked = allChosen;
    }

    function selectAll(checked) {
        getFilteredItems().forEach(item => {
            if (checked) selectedItems.add(item.id);
            else         selectedItems.delete(item.id);
        });
        updateBulkActionBar();
        renderInventoryTable();
    }

    function updateBulkActionBar() {
        const bar   = document.getElementById('bulkActionsBar');
        const span  = document.getElementById('selectedCount');
        const count = selectedItems.size;
        if (bar) {
            bar.style.display = count > 0 ? 'block' : 'none';
            if (span) span.innerText = count;
        }
    }

    function clearSelectedItems() {
        selectedItems.clear();
        updateBulkActionBar();
        renderInventoryTable();
        showToast('Selection cleared.');
    }

    function bulkDeleteItems() {
        const count = selectedItems.size;
        if (count === 0) { showToast('No items selected.', 'warning'); return; }
        if (confirm(`Delete ${count} item(s)? This cannot be undone.`)) {
            inventoryItems = inventoryItems.filter(i => !selectedItems.has(i.id));
            selectedItems.clear();
            updateBulkActionBar();
            renderAllStats();
            renderInventoryTable();
            renderLowStockCards();
            renderDepartmentLowStock();
            showToast(`${count} item(s) deleted.`, 'success');
        }
    }

    function bulkUpdateStock() {
        const count = selectedItems.size;
        if (count === 0) { showToast('No items selected.', 'warning'); return; }
        const input = prompt(`Enter new quantity for ${count} selected item(s):`);
        if (input === null) return; // cancelled
        const qty = parseInt(input, 10);
        if (isNaN(qty) || qty < 0) { showToast('Invalid quantity entered.', 'error'); return; }
        inventoryItems = inventoryItems.map(i => {
            if (!selectedItems.has(i.id)) return i;
            const newTotal  = qty * i.priceUnit;
            const newStatus = computeStatus(qty, i.lowStockPct, i.oversupplyThreshold);
            return { ...i, quantity: qty, totalValue: newTotal, status: newStatus };
        });
        selectedItems.clear();
        updateBulkActionBar();
        renderAllStats();
        renderInventoryTable();
        renderLowStockCards();
        renderDepartmentLowStock();
        showToast(`Stock updated to ${qty} for ${count} item(s).`, 'success');
    }

    // ─── Item Actions ─────────────────────────────────────────────────────────

    window.viewItem = function (id) {
        const item = inventoryItems.find(i => i.id === id);
        if (item) alert(`\ud83d\udce6 ${item.name}\nType: ${item.type}\nCategory: ${item.category}\nQuantity: ${item.quantity}\nPrice: ${formatCurrency(item.priceUnit)}\nTotal: ${formatCurrency(item.totalValue)}\nDepartment: ${item.department}`);
    };

    window.deleteItem = function (id) {
        const item = inventoryItems.find(i => i.id === id);
        if (item && confirm(`Delete "${item.name}"? This cannot be undone.`)) {
            inventoryItems = inventoryItems.filter(i => i.id !== id);
            selectedItems.delete(id);
            renderAllStats();
            renderInventoryTable();
            renderLowStockCards();
            renderDepartmentLowStock();
            updateBulkActionBar();
            showToast(`"${item.name}" deleted.`, 'success');
        }
    };

    // ─── Edit Modal ──────────────────────────────────────────────────────────

    function createEditModal() {
        if (document.getElementById('editItemModal')) return;

        const html = `
            <div class="modal-overlay" id="editItemModal">
                <div class="edit-modal">
                    <div class="modal-header">
                        <h3><i class="fas fa-edit"></i> Edit Item</h3>
                        <button class="modal-close" id="closeEditModalBtn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="edit-form">
                            <div class="form-group">
                                <label>Product Name</label>
                                <input type="text" id="editItemName" class="form-input" placeholder="Enter product name">
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>Category</label>
                                    <input type="text" id="editCategory" class="form-input" placeholder="Category">
                                </div>
                                <div class="form-group">
                                    <label>Department</label>
                                    <input type="text" id="editDepartment" class="form-input" placeholder="Department">
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label>Price (per unit)</label>
                                    <input type="number" id="editPriceUnit" class="form-input" step="0.01" min="0" placeholder="Price per unit">
                                </div>
                                <div class="form-group">
                                    <label>Low Stock Threshold (%)</label>
                                    <input type="number" id="editLowStockPct" class="form-input" min="0" max="100" placeholder="e.g. 15">
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Oversupply Threshold (units)</label>
                                <input type="number" id="editOversupplyThreshold" class="form-input" min="0" placeholder="Alert when stock exceeds this">
                                <small class="form-hint">Alert raised when stock exceeds this quantity.</small>
                            </div>
                            <div class="form-divider"></div>
                            <div class="current-details">
                                <h4>Current Details:</h4>
                                <div class="details-row">
                                    <span>Quantity: <strong id="currentQuantity">0</strong> units</span>
                                    <span>Total Value: <strong id="currentTotalValue">\u20b10.00</strong></span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel-modal" id="cancelEditModalBtn">Cancel</button>
                        <button class="btn-save-modal"   id="saveEditBtn">Save Changes</button>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
        document.getElementById('cancelEditModalBtn').addEventListener('click', closeEditModal);
        document.getElementById('saveEditBtn').addEventListener('click', saveEditChanges);

        // Close on backdrop click
        document.getElementById('editItemModal').addEventListener('click', e => {
            if (e.target === document.getElementById('editItemModal')) closeEditModal();
        });
    }

    window.openEditModal = function (itemId) {
        const item = inventoryItems.find(i => i.id === itemId);
        if (!item) return;
        currentEditingItem = item;

        document.getElementById('editItemName').value           = item.name;
        document.getElementById('editCategory').value           = item.category;
        document.getElementById('editDepartment').value         = item.department;
        document.getElementById('editPriceUnit').value          = item.priceUnit;
        document.getElementById('editLowStockPct').value        = item.lowStockPct;
        document.getElementById('editOversupplyThreshold').value= item.oversupplyThreshold || 100;
        document.getElementById('currentQuantity').innerText    = item.quantity;
        document.getElementById('currentTotalValue').innerHTML  = formatCurrency(item.totalValue);

        document.getElementById('editItemModal').classList.add('active');
    };

    window.closeEditModal = function () {
        const modal = document.getElementById('editItemModal');
        if (modal) modal.classList.remove('active');
        currentEditingItem = null;
    };

    function saveEditChanges() {
        if (!currentEditingItem) return;

        const newName                = document.getElementById('editItemName').value.trim();
        const newCategory            = document.getElementById('editCategory').value.trim();
        const newDepartment          = document.getElementById('editDepartment').value.trim();
        const newPriceUnit           = parseFloat(document.getElementById('editPriceUnit').value);
        const newLowStockPct         = parseInt(document.getElementById('editLowStockPct').value, 10);
        const newOversupplyThreshold = parseInt(document.getElementById('editOversupplyThreshold').value, 10);

        if (!newName)                                                      { showToast('Product name is required.',                     'error'); return; }
        if (isNaN(newPriceUnit) || newPriceUnit < 0)                       { showToast('A valid price is required.',                    'error'); return; }
        if (isNaN(newLowStockPct) || newLowStockPct < 0 || newLowStockPct > 100) { showToast('Low stock threshold must be 0–100.', 'error'); return; }
        if (isNaN(newOversupplyThreshold) || newOversupplyThreshold < 0)  { showToast('A valid oversupply threshold is required.',     'error'); return; }

        const newTotal  = currentEditingItem.quantity * newPriceUnit;
        const newStatus = computeStatus(currentEditingItem.quantity, newLowStockPct, newOversupplyThreshold);

        const index = inventoryItems.findIndex(i => i.id === currentEditingItem.id);
        inventoryItems[index] = {
            ...currentEditingItem,
            name: newName,
            category: newCategory,
            department: newDepartment,
            priceUnit: newPriceUnit,
            lowStockPct: newLowStockPct,
            oversupplyThreshold: newOversupplyThreshold,
            totalValue: newTotal,
            status: newStatus
        };

        closeEditModal();
        renderAllStats();
        renderInventoryTable();
        renderLowStockCards();
        renderDepartmentLowStock();
        showToast(`\u2705 "${newName}" updated successfully.`, 'success');
    }

    // ─── Allocate Modal ───────────────────────────────────────────────────────

    function createAllocateModal() {
        if (document.getElementById('allocateModal')) return;

        const itemOptions = inventoryItems
            .filter(i => i.quantity > 0)
            .map(i => `<option value="${i.id}">${escapeHtml(i.name)} (Available: ${i.quantity})</option>`)
            .join('');

        const html = `
            <div class="modal-overlay" id="allocateModal">
                <div class="allocate-modal">
                    <div class="modal-header">
                        <h3><i class="fas fa-exchange-alt"></i> Allocate / Transfer Item</h3>
                        <button class="modal-close" id="closeAllocateModalBtn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="allocate-form">
                            <div class="action-type-group">
                                <label>Action Type</label>
                                <div class="action-options">
                                    <label class="action-option"><input type="radio" name="actionType" value="allocate" checked> <span>Allocate (From Inventory)</span></label>
                                    <label class="action-option"><input type="radio" name="actionType" value="transfer"> <span>Transfer (Between Departments)</span></label>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Select Item</label>
                                <select id="allocateItemSelect" class="form-input">
                                    <option value="">-- Select an item --</option>
                                    ${itemOptions}
                                </select>
                            </div>
                            <div id="itemDetailsPanel" class="item-details-card" style="display:none;">
                                <h4>Item Details:</h4>
                                <div class="detail-row"><span class="label">Item:</span><span class="value" id="detailItemName">-</span></div>
                                <div class="detail-row"><span class="label">Type:</span><span class="value" id="detailItemType">-</span></div>
                                <div class="detail-row"><span class="label">Available Quantity:</span><span class="value" id="detailAvailableQty">0</span> units</div>
                                <div class="detail-row"><span class="label">Price per Unit:</span><span class="value" id="detailPriceUnit">\u20b10.00</span></div>
                            </div>
                            <div class="form-group">
                                <label>To Department</label>
                                <select id="allocateDepartment" class="form-input">
                                    <option value="">-- Select department --</option>
                                    <option value="Computer Science">Computer Science</option>
                                    <option value="Engineering">Engineering</option>
                                    <option value="Mathematics">Mathematics</option>
                                    <option value="Business">Business</option>
                                    <option value="Arts &amp; Sciences">Arts &amp; Sciences</option>
                                    <option value="General">General</option>
                                    <option value="Library">Library</option>
                                    <option value="Registrar">Registrar</option>
                                </select>
                            </div>
                            <div class="quantity-input-group">
                                <label>Quantity to Allocate</label>
                                <input type="number" id="allocateQuantity" class="quantity-input" value="0" min="1">
                                <small class="quantity-hint" id="quantityHint">Maximum available: 0 units</small>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel-modal" id="cancelAllocateModalBtn">Cancel</button>
                        <button class="btn-save-modal"   id="confirmAllocateBtn">Allocate Item</button>
                    </div>
                </div>
            </div>`;

        document.body.insertAdjacentHTML('beforeend', html);

        document.getElementById('closeAllocateModalBtn').addEventListener('click',  closeAllocateModal);
        document.getElementById('cancelAllocateModalBtn').addEventListener('click', closeAllocateModal);
        document.getElementById('confirmAllocateBtn').addEventListener('click',     confirmAllocation);

        document.getElementById('allocateModal').addEventListener('click', e => {
            if (e.target === document.getElementById('allocateModal')) closeAllocateModal();
        });

        document.getElementById('allocateItemSelect').addEventListener('change', function () {
            const itemId = parseInt(this.value, 10);
            const item   = inventoryItems.find(i => i.id === itemId);
            const panel  = document.getElementById('itemDetailsPanel');
            if (item) {
                currentSelectedItemForAllocation = item;
                panel.style.display = 'block';
                document.getElementById('detailItemName').innerText  = item.name;
                document.getElementById('detailItemType').innerText  = item.type;
                document.getElementById('detailAvailableQty').innerText = item.quantity;
                document.getElementById('detailPriceUnit').innerHTML = formatCurrency(item.priceUnit);
                document.getElementById('quantityHint').innerText    = `Maximum available: ${item.quantity} units`;
                document.getElementById('allocateQuantity').max      = item.quantity;
                document.getElementById('allocateQuantity').value    = 1;
            } else {
                currentSelectedItemForAllocation = null;
                panel.style.display = 'none';
            }
        });

        document.getElementById('allocateQuantity').addEventListener('input', function () {
            const max = parseInt(this.max, 10);
            if (parseInt(this.value, 10) > max) {
                this.value = max;
                showToast(`Maximum quantity is ${max}.`, 'warning');
            }
        });
    }

    window.openAllocateModal = function () {
        const modal = document.getElementById('allocateModal');
        if (!modal) return;
        document.getElementById('allocateItemSelect').value  = '';
        document.getElementById('allocateDepartment').value  = '';
        document.getElementById('allocateQuantity').value    = 0;
        document.getElementById('itemDetailsPanel').style.display = 'none';
        currentSelectedItemForAllocation = null;
        modal.classList.add('active');
    };

    window.closeAllocateModal = function () {
        const modal = document.getElementById('allocateModal');
        if (modal) modal.classList.remove('active');
    };

    function confirmAllocation() {
        const itemSelect  = document.getElementById('allocateItemSelect');
        const department  = document.getElementById('allocateDepartment').value;
        const quantity    = parseInt(document.getElementById('allocateQuantity').value, 10);

        if (!itemSelect.value)                { showToast('Please select an item.',          'error'); return; }
        if (!department)                      { showToast('Please select a department.',     'error'); return; }
        if (isNaN(quantity) || quantity <= 0) { showToast('Please enter a valid quantity.',  'error'); return; }

        const item = inventoryItems.find(i => i.id === parseInt(itemSelect.value, 10));
        if (!item)                            { showToast('Item not found.',                 'error'); return; }
        if (quantity > item.quantity)         { showToast(`Only ${item.quantity} units available.`, 'error'); return; }

        const newQuantity = item.quantity - quantity;
        const newStatus   = computeStatus(newQuantity, item.lowStockPct, item.oversupplyThreshold);
        const index       = inventoryItems.findIndex(i => i.id === item.id);
        inventoryItems[index] = { ...item, quantity: newQuantity, totalValue: newQuantity * item.priceUnit, status: newStatus };

        allocatedItems.push({
            id:            allocatedItems.length + 1,
            itemId:        item.id,
            itemName:      item.name,
            type:          item.type,
            department:    department,
            quantity:      quantity,
            dateAllocated: new Date().toISOString().split('T')[0],
            status:        'Allocated'
        });

        closeAllocateModal();
        renderAllStats();
        renderInventoryTable();
        if (currentTab === 'allocated') renderAllocatedItemsTable();
        renderLowStockCards();
        renderDepartmentLowStock();
        showToast(`\u2705 ${quantity} \u00d7 "${item.name}" allocated to ${department}.`, 'success');
    }

    // ─── Allocated Items Table ────────────────────────────────────────────────

    function renderAllocatedItemsTable() {
        const container = document.getElementById('allocatedItemsContainer');
        if (!container) return;

        if (allocatedItems.length === 0) {
            container.innerHTML = "<div style='text-align:center;padding:40px;color:#95a5a6;'><i class='fas fa-box-open'></i><br>No allocated items. Click 'Allocate Item' to get started.</div>";
            return;
        }

        const grouped = {};
        allocatedItems.forEach(item => {
            if (!grouped[item.department]) grouped[item.department] = [];
            grouped[item.department].push(item);
        });

        container.innerHTML = Object.entries(grouped).map(([dept, items]) => `
            <div class="dept-allocated-group">
                <div class="dept-allocated-header">
                    <h4><i class="fas fa-building"></i> ${escapeHtml(dept)}</h4>
                </div>
                <div class="allocated-table-wrapper">
                    <table class="allocated-table">
                        <thead>
                            <tr><th>Item Name</th><th>Type</th><th>Quantity</th><th>Date Allocated</th><th style="width:80px;">Action</th></tr>
                        </thead>
                        <tbody>
                            ${items.map(item => `
                                <tr>
                                    <td><strong>${escapeHtml(item.itemName)}</strong></td>
                                    <td>${escapeHtml(item.type)}</td>
                                    <td>${item.quantity}</td>
                                    <td>${escapeHtml(item.dateAllocated)}</td>
                                    <td><button class="return-btn" data-alloc-id="${item.id}">Return</button></td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`).join('');

        // Attach return buttons via delegation
        container.querySelectorAll('.return-btn').forEach(btn => {
            btn.addEventListener('click', () => returnAllocatedItem(parseInt(btn.dataset.allocId, 10)));
        });
    }

    window.returnAllocatedItem = function (allocationId) {
        const allocation = allocatedItems.find(a => a.id === allocationId);
        if (!allocation) return;

        if (confirm(`Return ${allocation.quantity} \u00d7 "${allocation.itemName}" back to inventory?`)) {
            const itemIndex = inventoryItems.findIndex(i => i.id === allocation.itemId);
            if (itemIndex !== -1) {
                const item        = inventoryItems[itemIndex];
                const newQuantity = item.quantity + allocation.quantity;
                inventoryItems[itemIndex] = { ...item, quantity: newQuantity, totalValue: newQuantity * item.priceUnit, status: computeStatus(newQuantity, item.lowStockPct, item.oversupplyThreshold) };
            }

            allocatedItems = allocatedItems.filter(a => a.id !== allocationId);
            renderAllocatedItemsTable();
            renderAllStats();
            renderInventoryTable();
            renderLowStockCards();
            renderDepartmentLowStock();
            showToast(`\u2705 ${allocation.quantity} \u00d7 "${allocation.itemName}" returned to inventory.`, 'success');
        }
    };

    // ─── Low-Stock Panels ─────────────────────────────────────────────────────

    function renderLowStockCards() {
        const low       = inventoryItems.filter(i => i.status === 'Low Stock' && i.type === 'Consumable');
        const container = document.getElementById('lowstockCardsContainer');
        if (!container) return;

        if (low.length === 0) {
            container.innerHTML = '<p>No low stock consumables.</p>';
            return;
        }

        container.innerHTML = low.map(item => `
            <div class="lowstock-item-card">
                <div class="lowstock-info">
                    <h4>${escapeHtml(item.name)}</h4>
                    <p>${escapeHtml(item.category)}</p>
                </div>
                <div class="lowstock-qty">Qty: ${item.quantity}</div>
                <button class="edit-stock-btn" data-id="${item.id}">Edit Stock</button>
            </div>`).join('');

        container.querySelectorAll('.edit-stock-btn').forEach(btn => {
            btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id, 10)));
        });
    }

    function renderDepartmentLowStock() {
        const low    = inventoryItems.filter(i => i.status === 'Low Stock');
        const grouped = {};
        low.forEach(i => {
            const d = i.department || 'General';
            if (!grouped[d]) grouped[d] = [];
            grouped[d].push(i);
        });

        const grid = document.getElementById('deptLowstockGrid');
        if (!grid) return;

        if (Object.keys(grouped).length === 0) {
            grid.innerHTML = '<p>No low stock items by department.</p>';
            return;
        }

        grid.innerHTML = Object.entries(grouped).map(([dept, items]) => `
            <div class="dept-card">
                <h4>${escapeHtml(dept)}</h4>
                ${items.map(i => `
                    <div class="dept-item">
                        <div class="dept-item-info">
                            <span>${escapeHtml(i.name)}</span>
                            <small>${i.type} \u2022 Qty: ${i.quantity}</small>
                        </div>
                        <button class="edit-stock-small" data-id="${i.id}">Edit Stock</button>
                    </div>`).join('')}
            </div>`).join('');

        grid.querySelectorAll('.edit-stock-small').forEach(btn => {
            btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id, 10)));
        });
    }

    // ─── View-All Modal ───────────────────────────────────────────────────────

    window.viewAllItems = function () {
        let modal = document.getElementById('viewAllModal');
        if (!modal) {
            document.body.insertAdjacentHTML('beforeend', `
                <div class="modal-overlay" id="viewAllModal">
                    <div class="view-all-modal">
                        <div class="modal-header">
                            <h3><i class="fas fa-boxes"></i> All Inventory Items</h3>
                            <button class="modal-close" id="closeViewAllBtn">&times;</button>
                        </div>
                        <div class="modal-body">
                            <div class="modal-stats">
                                <div class="modal-stat"><span>Total Items</span><strong id="modalTotalItems">0</strong></div>
                                <div class="modal-stat"><span>Equipment</span><strong id="modalEquipmentCount">0</strong></div>
                                <div class="modal-stat"><span>Consumables</span><strong id="modalConsumableCount">0</strong></div>
                                <div class="modal-stat"><span>Low Stock</span><strong id="modalLowStockCount">0</strong></div>
                                <div class="modal-stat"><span>Total Value</span><strong id="modalTotalValue">\u20b10.00</strong></div>
                            </div>
                            <div class="modal-table-wrapper">
                                <table class="modal-table">
                                    <thead><tr>
                                        <th>Item Name</th><th>Type</th><th>Category</th>
                                        <th>Qty</th><th>Price/Unit</th><th>Total Value</th>
                                        <th>Status</th><th>Department</th>
                                    </tr></thead>
                                    <tbody id="modalInventoryBody"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>`);
            modal = document.getElementById('viewAllModal');
            document.getElementById('closeViewAllBtn').addEventListener('click', closeViewAllModal);
            modal.addEventListener('click', e => { if (e.target === modal) closeViewAllModal(); });
        }

        const all = [...inventoryItems];
        document.getElementById('modalTotalItems').innerText     = all.length;
        document.getElementById('modalEquipmentCount').innerText = all.filter(i => i.type === 'Equipment').length;
        document.getElementById('modalConsumableCount').innerText= all.filter(i => i.type === 'Consumable').length;
        document.getElementById('modalLowStockCount').innerText  = all.filter(i => i.status === 'Low Stock').length;
        document.getElementById('modalTotalValue').innerHTML     = formatCurrency(all.reduce((s, i) => s + i.totalValue, 0));

        const tbody = document.getElementById('modalInventoryBody');
        if (tbody) {
            tbody.innerHTML = all.map(i => `
                <tr>
                    <td><strong>${escapeHtml(i.name)}</strong></td>
                    <td>${i.type}</td>
                    <td>${escapeHtml(i.category)}</td>
                    <td>${i.quantity}</td>
                    <td>${formatCurrency(i.priceUnit)}</td>
                    <td>${formatCurrency(i.totalValue)}</td>
                    <td><span class="${i.status === 'Low Stock' ? 'status-badge-lowstock' : 'status-badge-instock'}">${i.status}</span></td>
                    <td>${escapeHtml(i.department)}</td>
                </tr>`).join('');
        }

        setTimeout(() => modal.classList.add('active'), 10);
    };

    window.closeViewAllModal = function () {
        const modal = document.getElementById('viewAllModal');
        if (modal) modal.classList.remove('active');
    };

    // ─── Toast ───────────────────────────────────────────────────────────────

    function showToast(msg, type) {
        let toast = document.getElementById('customToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id        = 'customToast';
            toast.className = 'custom-toast';
            document.body.appendChild(toast);
        }
        const colours = { success: '#27ae60', error: '#c62828', warning: '#e67e22' };
        toast.style.background = colours[type] || '#1f6392';
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

})();