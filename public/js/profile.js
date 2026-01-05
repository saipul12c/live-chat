document.addEventListener('DOMContentLoaded', async () => {
    const usernameEl = document.getElementById('username');
    const nameEl = document.getElementById('name');
    const passwordEl = document.getElementById('password');
    const confirmEl = document.getElementById('confirmPassword');
    const messageDiv = document.getElementById('message');
    const avatarInput = document.getElementById('avatarInput');
    const avatarPreview = document.getElementById('avatarPreview');
    const saveBtn = document.getElementById('saveBtn');
    const passwordFields = document.getElementById('passwordFields');
    const businessSection = document.getElementById('businessSection');
    const companyNameEl = document.getElementById('companyName');
    const businessDescEl = document.getElementById('businessDesc');
    const businessContactEl = document.getElementById('businessContact');

    let currentUserId = null;
    let avatarData = null; // base64 data URL

    // helper to get query param
    function getQueryParam(name) {
        const params = new URLSearchParams(window.location.search);
        return params.get(name);
    }

    const viewId = getQueryParam('id');

    try {
        let res, data;
        if (viewId) {
            // lihat profil user lain
            res = await fetch(`/api/profile/${viewId}`);
            data = await res.json();
            if (res.ok) {
                usernameEl.value = data.username;
                nameEl.value = data.name || '';
                if (data.avatar) avatarPreview.src = data.avatar;
                // show verification badge if exists
                if (data.verification) {
                    const badgeWrap = document.getElementById('profileBadge');
                    const badgeIcon = document.getElementById('profileBadgeIcon');
                    badgeWrap.style.display = 'block';
                    badgeIcon.className = `user-badge user-badge-${data.verification.type}`;
                    const sym = data.verification.type === 'blue' ? '✔' : (data.verification.type === 'green' ? '✔' : '★');
                    badgeIcon.textContent = sym;
                    badgeIcon.addEventListener('click', function(e) {
                        e.stopPropagation();
                        showProfileBadgePopup(data.verification);
                    });
                }
                // disable editing
                nameEl.disabled = true;
                passwordFields.style.display = 'none';
                avatarInput.style.display = 'none';
                saveBtn.style.display = 'none';
                // show business info if any
                if (data.business) {
                    businessSection.style.display = 'block';
                    companyNameEl.value = data.business.companyName || '';
                    businessDescEl.value = data.business.description || '';
                    businessContactEl.value = data.business.contact || '';
                }
            } else {
                showMessage(data.error || 'Gagal memuat profil', 'error');
            }
        } else {
            res = await fetch('/api/profile');
            data = await res.json();
            if (res.ok) {
                usernameEl.value = data.username;
                nameEl.value = data.name || '';
                currentUserId = data.id;
                if (data.avatar) avatarPreview.src = data.avatar;
                // show business section for business role
                if (data.role === 'business' || data.role === 'owner' || data.role === 'superadmin') {
                    businessSection.style.display = 'block';
                    if (data.business) {
                        companyNameEl.value = data.business.companyName || '';
                        businessDescEl.value = data.business.description || '';
                        businessContactEl.value = data.business.contact || '';
                    }
                }
            } else {
                showMessage(data.error || 'Gagal memuat profil', 'error');
            }
        }
    } catch (e) {
        showMessage('Terjadi kesalahan saat memuat data', 'error');
    }

    document.getElementById('profileForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = nameEl.value.trim();
        const password = passwordEl.value;
        const confirm = confirmEl.value;

        if (password && password !== confirm) {
            showMessage('Password tidak cocok', 'error');
            return;
        }

        try {
            const body = { name };
            if (password) body.password = password;
            if (avatarData) body.avatar = avatarData;
            // include business info if visible
            if (businessSection.style.display !== 'none') {
                body.business = {
                    companyName: companyNameEl.value.trim(),
                    description: businessDescEl.value.trim(),
                    contact: businessContactEl.value.trim()
                };
            }

            const res = await fetch('/api/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showMessage('Profil berhasil diperbarui', 'success');
                setTimeout(() => { window.location.href = '/chat.html'; }, 1000);
            } else {
                showMessage(data.error || 'Gagal memperbarui profil', 'error');
            }
        } catch (e) {
            showMessage('Terjadi kesalahan', 'error');
        }
    });

    // avatar file input -> preview and convert to base64
    if (avatarInput) {
        avatarInput.addEventListener('change', function () {
            const f = this.files && this.files[0];
            if (!f) return;
            if (f.size > 1024 * 1024) { // 1MB limit
                showMessage('File terlalu besar (maks 1MB)', 'error');
                this.value = '';
                return;
            }
            const reader = new FileReader();
            reader.onload = function (ev) {
                avatarPreview.src = ev.target.result;
                avatarData = ev.target.result; // data URL
            };
            reader.readAsDataURL(f);
        });
    }

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = `message ${type}`;
    }

    // Dark mode toggle handling (client-side preference)
    const darkToggle = document.getElementById('darkModeToggle');
    function applyDarkMode(val) {
        if (val) document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode');
    }
    // load saved pref
    try {
        const saved = localStorage.getItem(`rc_dark_mode_${currentUserId}`);
        const enabled = saved === '1';
        if (darkToggle) darkToggle.checked = enabled;
        applyDarkMode(enabled);
    } catch (e) {}
    if (darkToggle) {
        darkToggle.addEventListener('change', function() {
            const on = !!this.checked;
            applyDarkMode(on);
            try { if (currentUserId) localStorage.setItem(`rc_dark_mode_${currentUserId}`, on ? '1' : '0'); } catch (e) {}
        });
    }
    
    function showProfileBadgePopup(verification) {
        const popup = document.getElementById('badgeInfoPopup');
        popup.innerHTML = `<div class="badge-popup"><strong>${(verification.type||'').toUpperCase()} verification</strong><div class="small">${verification.info||''}</div></div>`;
        popup.style.display = 'block';
        // hide on outside click
        setTimeout(() => {
            document.addEventListener('click', hideProfileBadgePopup, { once: true });
        }, 10);
    }

    function hideProfileBadgePopup() {
        const popup = document.getElementById('badgeInfoPopup');
        popup.style.display = 'none';
        popup.innerHTML = '';
    }
});
