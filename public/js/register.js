document.getElementById('registerForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const name = document.getElementById('name').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    // Validasi
    if (password !== confirmPassword) {
        showMessage('Password tidak cocok', 'error');
        return;
    }
    
    if (password.length < 6) {
        showMessage('Password minimal 6 karakter', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, username, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('Pendaftaran berhasil! Mengalihkan ke login...', 'success');
            setTimeout(() => {
                window.location.href = '/html/login.html';
            }, 1500);
        } else {
            showMessage(data.error || 'Pendaftaran gagal', 'error');
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