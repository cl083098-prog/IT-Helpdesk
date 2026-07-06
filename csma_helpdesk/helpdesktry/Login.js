// Login.js - Authentication via PHP/MySQL backend
// Supports roles: admin | requester | dept_head

(function() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLogin);
    } else {
        initLogin();
    }

    function initLogin() {
        if (!document.getElementById('loginForm')) return;

        const currentUser = sessionStorage.getItem('currentUser');
        if (currentUser) {
            try {
                const user = JSON.parse(currentUser);
                redirectToDashboard(user.role);
            } catch (e) {
                sessionStorage.removeItem('currentUser');
            }
            return;
        }

        document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
        addDemoCredentialsHint();

        const rememberedUser = localStorage.getItem('rememberedUser');
        if (rememberedUser) {
            const usernameInput = document.getElementById('username');
            if (usernameInput) {
                usernameInput.value = rememberedUser;
                const rememberCheckbox = document.querySelector('input[name="remember"]');
                if (rememberCheckbox) rememberCheckbox.checked = true;
            }
        }
    }

    async function handleLogin(e) {
        e.preventDefault();

        const username   = document.getElementById('username').value.trim();
        const password   = document.getElementById('password').value;
        const rememberMe = document.querySelector('input[name="remember"]')?.checked || false;

        if (!username || !password) { showError('Please enter both username and password.'); return; }

        const submitBtn = document.querySelector('#loginForm button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in\u2026'; }

        try {
            const controller = new AbortController();
            const timeout    = setTimeout(() => controller.abort(), 10000);

            const res  = await fetch('../api/login.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                signal: controller.signal
            });
            clearTimeout(timeout);
            const json = await res.json();

            if (!json.success) {
                showError(json.message || 'Invalid username or password. Please try again.');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign in \u2192'; }
                return;
            }

            const sessionUser = {
                id:         json.user.id,
                username:   json.user.username,
                role:       json.user.role,
                name:       json.user.full_name,
                email:      json.user.email,
                department: json.user.department,
                loginTime:  new Date().toISOString()
            };

            if (rememberMe) {
                localStorage.setItem('rememberedUser', username);
            } else {
                localStorage.removeItem('rememberedUser');
            }

            sessionStorage.setItem('currentUser', JSON.stringify(sessionUser));
            showSuccess('Welcome back, ' + json.user.full_name + '! Redirecting\u2026');
            setTimeout(() => redirectToDashboard(json.user.role), 1000);

        } catch (err) {
            console.error('Login error:', err);
            const msg = err.name === 'AbortError'
                ? 'Request timed out. Make sure XAMPP is running.'
                : 'Could not connect to server. Make sure XAMPP is running.';
            showError(msg);
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign in \u2192'; }
        }
    }

    function redirectToDashboard(role) {
        const routes = {
            admin:        'Dashboard.html',
            dept_head:    'DeptHeadDashboard.html',
            school_admin: 'SchoolAdmin.html',
            requester:    'RequesterDashboard.html'
        };
        window.location.href = routes[role] || 'RequesterDashboard.html';
    }

    function showError(message) {
        let errorDiv = document.getElementById('loginError');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.id = 'loginError';
            errorDiv.style.cssText = 'background:#fde2e2;color:#c62828;padding:12px 16px;border-radius:16px;margin-bottom:20px;font-size:0.85rem;font-weight:500;text-align:center;border-left:4px solid #c62828;';
            const form = document.getElementById('loginForm');
            const card = document.querySelector('.login-card');
            if (card && form) card.insertBefore(errorDiv, form);
        }
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => { if (errorDiv) errorDiv.style.display = 'none'; }, 5000);
    }

    function showSuccess(message) {
        let successDiv = document.getElementById('loginSuccess');
        if (!successDiv) {
            successDiv = document.createElement('div');
            successDiv.id = 'loginSuccess';
            successDiv.style.cssText = 'background:#d5f5e3;color:#27ae60;padding:12px 16px;border-radius:16px;margin-bottom:20px;font-size:0.85rem;font-weight:500;text-align:center;border-left:4px solid #27ae60;';
            const form = document.getElementById('loginForm');
            const card = document.querySelector('.login-card');
            if (card && form) card.insertBefore(successDiv, form);
        }
        successDiv.textContent = message;
        successDiv.style.display = 'block';
    }

    function addDemoCredentialsHint() {
        const hintDiv = document.createElement('div');
        hintDiv.style.cssText = 'background:#eef3fc;border-radius:16px;padding:12px 16px;margin-top:16px;font-size:0.75rem;text-align:center;';
        hintDiv.innerHTML = [
            '<strong style="color:#1f6392;">Demo Accounts:</strong><br>',
            '<span style="color:#2c5a7a;"><strong>Admin:</strong> admin / admin123</span><br>',
            '<span style="color:#2c5a7a;"><strong>Dept Head:</strong> depthead / depthead123</span><br>',
            '<span style="color:#2c5a7a;"><strong>Requester:</strong> requester / req123</span>'
        ].join('');
        const card = document.querySelector('.login-card');
        if (card) card.appendChild(hintDiv);
    }

    window.performLogout = function() {
        sessionStorage.removeItem('currentUser');
        localStorage.removeItem('rememberedUser');
        window.location.href = 'Login.html';
    };
})();
