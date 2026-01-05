document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('Login berhasil! Mengalihkan...', 'success');
            const role = data.user && data.user.role;
            setTimeout(() => {
                if (role === 'owner' || role === 'superadmin') {
                    window.location.href = '/admin/dashboard.html';
                } else {
                    window.location.href = '/chat.html';
                }
            }, 800);
        } else {
            showMessage(data.error || 'Login gagal', 'error');
        }
    } catch (error) {
        showMessage('Terjadi kesalahan', 'error');
    }
});

function showMessage(text, type) {
    const messageDiv = document.getElementById('message');
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
}