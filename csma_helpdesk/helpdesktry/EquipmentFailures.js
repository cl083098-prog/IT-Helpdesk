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

    // ===== SAMPLE DATA =====
    let failuresData = [
        { id: 1, equipment: "HP LaserJet Printer", department: "Computer Science", failureDate: "2026-03-10", issue: "Paper jam and fuser error", action: "Replaced fuser assembly", resolutionDate: "2026-03-12", cost: 2450, status: "Resolved" },
        { id: 2, equipment: "Dell Optiplex 3070", department: "Engineering", failureDate: "2026-03-15", issue: "Motherboard capacitor blown", action: "Replaced motherboard", resolutionDate: "2026-03-18", cost: 5800, status: "Resolved" },
        { id: 3, equipment: "Epson Projector", department: "Business", failureDate: "2026-04-01", issue: "Lamp failure, overheating", action: "Lamp replaced, cleaned vents", resolutionDate: "2026-04-05", cost: 3200, status: "Resolved" },
        { id: 4, equipment: "Cisco Switch", department: "Computer Science", failureDate: "2026-04-10", issue: "Port failure, intermittent connectivity", action: "Replaced faulty switch module", resolutionDate: "", cost: 0, status: "Pending" },
        { id: 5, equipment: "Interactive Whiteboard", department: "Mathematics", failureDate: "2026-04-18", issue: "Touch calibration lost, dead pixels", action: "Diagnostics pending", resolutionDate: "", cost: 0, status: "Pending" },
        { id: 6, equipment: "Server UPS", department: "Engineering", failureDate: "2026-04-22", issue: "Battery failure, alerts", action: "Battery replaced", resolutionDate: "2026-04-24", cost: 9500, status: "Resolved" },
        { id: 7, equipment: "Lab Desktop PC", department: "Arts & Sciences", failureDate: "2026-04-25", issue: "SSD failure, won't boot", action: "SSD replaced, data restored", resolutionDate: "2026-04-28", cost: 4200, status: "Resolved" }
    ];
    let nextId = 8;

    // DOM Elements
    let tbody = document.getElementById('failuresTableBody');
    let searchInput = document.getElementById('searchEquipment');
    let deptFilter = document.getElementById('filterDepartment');
    let dateFrom = document.getElementById('dateFrom');
    let dateTo = document.getElementById('dateTo');
    let resetBtn = document.getElementById('resetFiltersBtn');
    let addBtn = document.getElementById('addFailureBtn');
    let modal = document.getElementById('failureModal');
    let closeModal = document.getElementById('closeModalBtn');
    let cancelModal = document.getElementById('cancelModalBtn');
    let saveBtn = document.getElementById('saveFailureBtn');
    let modalTitle = document.getElementById('modalTitle');
    let editIdField = document.getElementById('editId');
    let equipName = document.getElementById('equipmentName');
    let deptSelect = document.getElementById('deptSelect');
    let failureDate = document.getElementById('failureDate');
    let issueDesc = document.getElementById('issueDesc');
    let actionTaken = document.getElementById('actionTaken');
    let resolutionDate = document.getElementById('resolutionDate');
    let costAmount = document.getElementById('costAmount');

    // ===== HELPER FUNCTIONS =====
    function formatCurrency(amount) {
        return `₱${parseFloat(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            if (m === "'") return '&#39;';
            return m;
        });
    }

    function calcResolutionDays(failureDateStr, resolutionDateStr) {
        if (!resolutionDateStr || resolutionDateStr.trim() === '') return null;
        let start = new Date(failureDateStr);
        let end = new Date(resolutionDateStr);
        let diff = Math.ceil((end - start) / (1000 * 3600 * 24));
        return diff > 0 ? diff : 0;
    }

    function showToast(message, type = 'info') {
        let toast = document.querySelector('.failure-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'failure-toast';
            document.body.appendChild(toast);
        }
        const colours = { success: '#27ae60', error: '#c62828', warning: '#e67e22', info: '#1f6392' };
        toast.style.background = colours[type] || '#1f6392';
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ===== UPDATE SUMMARY CARDS =====
    function updateSummaryCards() {
        let total = failuresData.length;
        let totalRepair = failuresData.reduce((sum, f) => sum + (f.cost || 0), 0);
        let resolvedWithDays = failuresData.filter(f => f.resolutionDate && f.resolutionDate.trim() !== '');
        let totalDays = resolvedWithDays.reduce((sum, f) => {
            let days = calcResolutionDays(f.failureDate, f.resolutionDate);
            return sum + (days || 0);
        }, 0);
        let avgDays = resolvedWithDays.length > 0 ? (totalDays / resolvedWithDays.length).toFixed(1) : 0;
        
        document.getElementById('totalFailures').innerText = total;
        document.getElementById('totalCost').innerHTML = formatCurrency(totalRepair);
        document.getElementById('avgResolution').innerText = avgDays;
    }

    // ===== RENDER TABLE WITH FILTERS =====
    function renderFailures() {
        let searchTerm = searchInput.value.trim().toLowerCase();
        let department = deptFilter.value;
        let fromDate = dateFrom.value;
        let toDate = dateTo.value;

        let filtered = failuresData.filter(f => {
            if (searchTerm && !f.equipment.toLowerCase().includes(searchTerm)) return false;
            if (department !== 'all' && f.department !== department) return false;
            if (fromDate && f.failureDate < fromDate) return false;
            if (toDate && f.failureDate > toDate) return false;
            return true;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No equipment failure records found. Click "Report Failure" to add one.</td></tr>';
            updateSummaryCards();
            return;
        }

        tbody.innerHTML = filtered.map(f => {
            let statusClass = f.status === 'Resolved' ? 'badge-resolved' : 'badge-pending';
            let resolutionDisplay = f.resolutionDate && f.resolutionDate.trim() !== '' ? f.resolutionDate : '—';
            let costDisplay = formatCurrency(f.cost);
            return `<tr data-id="${f.id}">
                <td><strong>${escapeHtml(f.equipment)}</strong></td>
                <td>${escapeHtml(f.department)}</td>
                <td>${f.failureDate}</td>
                <td>${escapeHtml(f.issue)}</td>
                <td>${escapeHtml(f.action || '—')}</td>
                <td>${resolutionDisplay}</td>
                <td>${costDisplay}</td>
                <td><span class="${statusClass}">${f.status}</span></td>
                <td class="action-icons">
                    <i class="fas fa-edit edit-failure" data-id="${f.id}" title="Edit"></i>
                    <i class="fas fa-trash-alt delete-failure" data-id="${f.id}" title="Delete"></i>
                </td>
            </tr>`;
        }).join('');

        // Attach edit/delete event listeners
        document.querySelectorAll('.edit-failure').forEach(icon => {
            icon.addEventListener('click', (e) => {
                let id = parseInt(icon.dataset.id);
                openEditModal(id);
                e.stopPropagation();
            });
        });
        document.querySelectorAll('.delete-failure').forEach(icon => {
            icon.addEventListener('click', (e) => {
                let id = parseInt(icon.dataset.id);
                if (confirm('Delete this failure record? This action cannot be undone.')) {
                    failuresData = failuresData.filter(f => f.id !== id);
                    renderFailures();
                    updateSummaryCards();
                    showToast('Record deleted successfully', 'success');
                }
                e.stopPropagation();
            });
        });
        updateSummaryCards();
    }

    // ===== MODAL CONTROLS =====
    function resetForm() {
        editIdField.value = '';
        equipName.value = '';
        deptSelect.value = 'Computer Science';
        failureDate.value = '';
        issueDesc.value = '';
        actionTaken.value = '';
        resolutionDate.value = '';
        costAmount.value = '0';
        modalTitle.innerHTML = '<i class="fas fa-tools"></i> Report Equipment Failure';
    }

    function openEditModal(id) {
        let record = failuresData.find(f => f.id === id);
        if (record) {
            editIdField.value = record.id;
            equipName.value = record.equipment;
            deptSelect.value = record.department;
            failureDate.value = record.failureDate;
            issueDesc.value = record.issue;
            actionTaken.value = record.action || '';
            resolutionDate.value = record.resolutionDate || '';
            costAmount.value = record.cost;
            modalTitle.innerHTML = '<i class="fas fa-edit"></i> Edit Failure Record';
            modal.classList.add('active');
        }
    }

    function closeModalPanel() {
        modal.classList.remove('active');
        resetForm();
    }

    function saveFailure() {
        let name = equipName.value.trim();
        let dept = deptSelect.value;
        let failDt = failureDate.value;
        let issue = issueDesc.value.trim();
        let action = actionTaken.value.trim();
        let resDt = resolutionDate.value;
        let cost = parseFloat(costAmount.value) || 0;

        if (!name || !failDt || !issue) {
            showToast('Please fill equipment name, failure date and issue description.', 'error');
            return;
        }

        let status = (resDt && resDt.trim() !== '') ? 'Resolved' : 'Pending';
        let editId = editIdField.value;

        if (editId) {
            // Update existing record
            let idx = failuresData.findIndex(f => f.id == editId);
            if (idx !== -1) {
                failuresData[idx] = {
                    ...failuresData[idx],
                    equipment: name,
                    department: dept,
                    failureDate: failDt,
                    issue: issue,
                    action: action,
                    resolutionDate: resDt,
                    cost: cost,
                    status: status
                };
                showToast('Failure record updated successfully', 'success');
            }
        } else {
            // Create new record
            let newRecord = {
                id: nextId++,
                equipment: name,
                department: dept,
                failureDate: failDt,
                issue: issue,
                action: action,
                resolutionDate: resDt,
                cost: cost,
                status: status
            };
            failuresData.push(newRecord);
            showToast('New failure reported successfully', 'success');
        }
        closeModalPanel();
        renderFailures();
    }

    // ===== RESET FILTERS =====
    function resetFilters() {
        searchInput.value = '';
        deptFilter.value = 'all';
        dateFrom.value = '';
        dateTo.value = '';
        renderFailures();
    }

    // ===== SIDEBAR MOBILE TOGGLE =====
    function initMobileSidebar() {
        const menuToggle = document.getElementById('menuToggle');
        const sidebar = document.getElementById('mainSidebar');
        if (menuToggle && sidebar) {
            menuToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                sidebar.classList.toggle('active-mobile');
                let overlay = document.querySelector('.sidebar-overlay');
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.className = 'sidebar-overlay';
                    document.body.appendChild(overlay);
                    overlay.addEventListener('click', function() {
                        sidebar.classList.remove('active-mobile');
                        overlay.classList.remove('active');
                    });
                }
                overlay.classList.toggle('active');
            });
        }
    }

    // ===== LOGOUT HANDLER =====
    function initLogout() {
        const logoutBtn = document.getElementById('sidebarLogoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function() {
                sessionStorage.removeItem('currentUser');
                localStorage.removeItem('rememberedUser');
                window.location.href = 'Login.html';
            });
        }
    }

    // ===== INITIALIZATION =====
    function init() {
        renderFailures();
        
        // Event Listeners
        if (searchInput) searchInput.addEventListener('input', renderFailures);
        if (deptFilter) deptFilter.addEventListener('change', renderFailures);
        if (dateFrom) dateFrom.addEventListener('change', renderFailures);
        if (dateTo) dateTo.addEventListener('change', renderFailures);
        if (resetBtn) resetBtn.addEventListener('click', resetFilters);
        if (addBtn) addBtn.addEventListener('click', () => { resetForm(); modal.classList.add('active'); });
        if (closeModal) closeModal.addEventListener('click', closeModalPanel);
        if (cancelModal) cancelModal.addEventListener('click', closeModalPanel);
        if (saveBtn) saveBtn.addEventListener('click', saveFailure);
        if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModalPanel(); });

        initMobileSidebar();
        initLogout();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();