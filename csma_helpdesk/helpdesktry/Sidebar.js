// Sidebar functionality for both pages
(function() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        const menuToggle = document.getElementById('menuToggle');
        const sidebar = document.getElementById('mainSidebar');
        
        if (menuToggle && sidebar) {
            const newMenuToggle = menuToggle.cloneNode(true);
            if (menuToggle.parentNode) {
                menuToggle.parentNode.replaceChild(newMenuToggle, menuToggle);
            }
            
            newMenuToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                sidebar.classList.toggle('active-mobile');
                createOverlay(sidebar);
            });
        }
        
        const logoutBtn = document.getElementById('sidebarLogoutBtn');
        if (logoutBtn) {
            const newLogoutBtn = logoutBtn.cloneNode(true);
            if (logoutBtn.parentNode) {
                logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
            }
            
            newLogoutBtn.addEventListener('click', function(e) {
                e.preventDefault();
                showLogoutModal();
            });
        }
        
        document.querySelectorAll('.nav-item[href="#"]').forEach(link => {
            link.addEventListener('click', (e) => e.preventDefault());
        });
        
        applySavedTheme();
        initThemeToggle();
        setActiveNavItem();
    }
    
    function getPreferredTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') return true;
        if (savedTheme === 'light') return false;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function applySavedTheme() {
        const currentPage = window.location.pathname.split('/').pop();
        if (currentPage === 'Dashboard.html') return;

        const isDark = getPreferredTheme();
        document.body.classList.toggle('dark-mode', isDark);

        const themeSwitch = document.getElementById('themeSwitchCheckbox');
        if (themeSwitch) {
            themeSwitch.checked = isDark;
        }

        const themeIcon = document.getElementById('themeIcon');
        if (themeIcon) {
            themeIcon.className = isDark ? 'ti ti-sun' : 'ti ti-moon';
        }
    }

    function initThemeToggle() {
        const themeSwitch = document.getElementById('themeSwitchCheckbox');
        const themeIcon = document.getElementById('themeIcon');
        if (!themeSwitch || !themeIcon) return;

        const isDark = getPreferredTheme();
        themeSwitch.checked = isDark;
        themeIcon.className = isDark ? 'ti ti-sun' : 'ti ti-moon';

        themeSwitch.addEventListener('change', e => {
            const dark = e.target.checked;
            document.body.classList.toggle('dark-mode', dark);
            localStorage.setItem('theme', dark ? 'dark' : 'light');
            themeIcon.className = dark ? 'ti ti-sun' : 'ti ti-moon';
        });
    }
    
    function createOverlay(sidebar) {
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);
            
            overlay.addEventListener('click', function() {
                if (sidebar) {
                    sidebar.classList.remove('active-mobile');
                }
                overlay.classList.remove('active');
            });
        }
        
        if (sidebar && sidebar.classList.contains('active-mobile')) {
            overlay.classList.add('active');
        } else if (overlay) {
            overlay.classList.remove('active');
        }
    }
    
    function setActiveNavItem() {
        const currentPath = window.location.pathname;
        let currentPage = currentPath.split('/').pop() || 'Dashboard.html';
        
        document.querySelectorAll('.nav-item').forEach(item => {
            const href = item.getAttribute('href');
            item.classList.remove('active');
            
            if (href === currentPage) {
                item.classList.add('active');
            } else if (href && currentPage.startsWith(href.replace('.html', ''))) {
                if (currentPage === 'Inventory' && href === 'Inventory.html') item.classList.add('active');
                else if (currentPage === 'ServiceRequest' && href === 'ServiceRequest.html') item.classList.add('active');
                else if (currentPage === 'Dashboard' && href === 'Dashboard.html') item.classList.add('active');
            }
        });
    }
    
    function showLogoutModal() {
        const existingModal = document.querySelector('.logout-modal-overlay');
        if (existingModal) {
            existingModal.classList.add('active');
            return;
        }
        
        const modalHTML = `
            <div class="logout-modal-overlay" id="logoutModal">
                <div class="logout-modal">
                    <div class="modal-header">
                        <i class="ti ti-logout"></i>
                        <h3>Confirm Logout</h3>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to logout from IT Helpdesk?</p>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel" id="cancelLogoutBtn">Cancel</button>
                        <button class="btn-confirm" id="confirmLogoutBtn">Logout</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('logoutModal');
        
        setTimeout(() => {
            if (modal) modal.classList.add('active');
        }, 10);
        
        const cancelBtn = document.getElementById('cancelLogoutBtn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (modal) {
                    modal.classList.remove('active');
                    setTimeout(() => {
                        if (modal && modal.remove) modal.remove();
                    }, 300);
                }
            });
        }
        
        const confirmBtn = document.getElementById('confirmLogoutBtn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                redirectToLogin();
            });
        }
        
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                    setTimeout(() => {
                        if (modal && modal.remove) modal.remove();
                    }, 300);
                }
            });
        }
    }
    
    // Expose showLogoutModal globally so SchoolAdmin.js (and other pages)
    // can call it without duplicating the implementation.
    window.showLogoutModal = showLogoutModal;

    function redirectToLogin() {
        const modal = document.getElementById('logoutModal');
        if (modal) {
            modal.classList.remove('active');
        }

        // Clear session so auto-redirect doesn't loop back
        sessionStorage.removeItem('currentUser');

        window.location.href = "Login.html";
    }
})();