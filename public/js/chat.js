// Variabel global
let socket;
let currentUser = null;
let selectedUser = null;
let users = [];
// In-memory E2E keys per pair (not persisted)
const e2eKeys = {}; // key: pairId -> CryptoKey
let replyTarget = null; // { id, snippet }

// Inisialisasi
document.addEventListener('DOMContentLoaded', async function() {
    // Cek session
    await checkSession();
    
    // Inisialisasi Socket.IO
    socket = io();
    
    // Inisialisasi event listeners, then join room
    setupEventListeners();
    socket.emit('join', currentUser.id);
    
    // Load users dan messages
    await loadUsers();
    await loadMessages();

    // If URL contains ?to=USERID, auto-select that user after load
    const params = new URLSearchParams(window.location.search);
    const to = params.get('to');
    if (to) {
        setTimeout(async () => {
            // try to find existing list item
            const item = Array.from(document.querySelectorAll('li.user-item')).find(i => i.dataset.userId === to);
            if (item) {
                const nameEl = item.querySelector('.user-name');
                if (nameEl) nameEl.click();
                return;
            }
            // if not present in DOM (no prior chat), create selection and load messages directly
            try {
                // try to find user in loaded users
                const u = (users || []).find(x => x.id === to);
                selectedUser = { id: to, name: u ? (u.name || u.username) : to };
                document.getElementById('chatWithUser').textContent = `Chat dengan ${selectedUser.name}`;
                document.getElementById('messageInput').disabled = false;
                document.getElementById('sendBtn').disabled = false;
                document.getElementById('messageInput').focus();
                await loadUserMessages();
                ensureKeyForSelected().catch(err => console.warn('E2E key init failed', err));
            } catch (e) { console.warn('auto-select failed', e); }
        }, 300);
    }
});

// Schedule message handling
document.addEventListener('DOMContentLoaded', function() {
    const scheduleBtn = document.getElementById('scheduleMsgBtn');
    const scheduleAt = document.getElementById('scheduleAt');
    if (scheduleBtn && scheduleAt) {
        scheduleBtn.addEventListener('click', async function() {
            if (!selectedUser) return alert('Pilih user untuk menjadwalkan pesan');
            const allowed = (currentUser.features && currentUser.features.scheduledMessages) || (currentUser.adminFeatures && currentUser.adminFeatures.scheduledMessages) || (currentUser.role === 'owner' || currentUser.role === 'superadmin');
            if (!allowed) return alert('Fitur jadwal pesan tidak tersedia untuk akun Anda');
            const at = scheduleAt.value;
            if (!at) return alert('Pilih waktu pengiriman');
            const content = document.getElementById('messageInput').value.trim();
            if (!content) return alert('Isi pesan diperlukan untuk dijadwalkan');
            try {
                const body = { to: selectedUser.id, content, sendAt: at, broadcast: false };
                const res = await fetch('/api/admin/schedule-message', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
                if (!res.ok) { const d = await res.json(); return alert(d.error || 'Gagal menjadwalkan'); }
                alert('Pesan dijadwalkan');
                document.getElementById('messageInput').value = '';
                scheduleAt.value = '';
            } catch (e) { alert('Gagal menjadwalkan pesan'); }
        });
    }
    // show/hide schedule controls based on features (may be set earlier during session check)
    setTimeout(()=>{
        try {
            const scheduleBtn = document.getElementById('scheduleMsgBtn');
            const scheduleAt = document.getElementById('scheduleAt');
            if (!scheduleBtn || !scheduleAt) return;
            const allowed = (currentUser && ((currentUser.features && currentUser.features.scheduledMessages) || (currentUser.adminFeatures && currentUser.adminFeatures.scheduledMessages) || currentUser.role === 'owner' || currentUser.role === 'superadmin'));
            if (allowed) { scheduleBtn.style.display = 'inline-block'; scheduleAt.style.display = 'inline-block'; }
            else { scheduleBtn.style.display = 'none'; scheduleAt.style.display = 'none'; }
        } catch (e) {}
    }, 300);
});

// Render helper: Support Contact list (data from server: {id,name,role,incomingCount})
function renderSupportList(items) {
    const el = document.getElementById('supportList');
    if (!el) return;
    el.innerHTML = '';
    items.forEach(u => {
        const li = document.createElement('li');
        li.className = 'support-item';
        li.dataset.userId = u.id;
        const onlineDot = u.online ? '<span style="display:inline-block;width:8px;height:8px;background:#2ecc71;border-radius:50%;margin-right:8px;vertical-align:middle"></span>' : '<span style="display:inline-block;width:8px;height:8px;background:#bdc3c7;border-radius:50%;margin-right:8px;vertical-align:middle"></span>';
        const last = u.lastActive ? ` <small style="color:#999;margin-left:8px">${new Date(u.lastActive).toLocaleString()}</small>` : '';
        li.innerHTML = `${onlineDot}<span class="user-name">${u.name || u.id}</span> <small style="color:#666;margin-left:8px">(${u.incomingCount} chats)</small>${last}`;
        li.addEventListener('click', () => {
            // select this user in-page instead of navigating
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
            li.classList.add('active');
            selectedUser = { id: u.id, name: u.name || u.id };
            document.getElementById('chatWithUser').textContent = `Chat dengan ${selectedUser.name}`;
            document.getElementById('messageInput').disabled = false;
            document.getElementById('sendBtn').disabled = false;
            document.getElementById('messageInput').focus();
            loadUserMessages();
            ensureKeyForSelected().catch(err => console.warn('E2E key init failed', err));
        });
        el.appendChild(li);
    });
}

// Render helper: Business accounts list (data from server)
function renderBusinessList(items) {
    const el = document.getElementById('businessList');
    if (!el) return;
    el.innerHTML = '';
    items.forEach(u => {
        const li = document.createElement('li');
        li.className = 'business-item';
        li.dataset.userId = u.id;
        const onlineDot = u.online ? '<span style="display:inline-block;width:8px;height:8px;background:#2ecc71;border-radius:50%;margin-right:8px;vertical-align:middle"></span>' : '<span style="display:inline-block;width:8px;height:8px;background:#bdc3c7;border-radius:50%;margin-right:8px;vertical-align:middle"></span>';
        const last = u.lastActive ? ` <small style="color:#999;margin-left:8px">${new Date(u.lastActive).toLocaleString()}</small>` : '';
        li.innerHTML = `${onlineDot}<span class="user-name">${u.name || u.id}</span> <small style="color:#666;margin-left:8px">(${u.incomingCount} chats)</small>${last}`;
        li.addEventListener('click', () => {
            // select this business user in-page instead of navigating
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
            li.classList.add('active');
            selectedUser = { id: u.id, name: u.name || u.id };
            document.getElementById('chatWithUser').textContent = `Chat dengan ${selectedUser.name}`;
            document.getElementById('messageInput').disabled = false;
            document.getElementById('sendBtn').disabled = false;
            document.getElementById('messageInput').focus();
            loadUserMessages();
            ensureKeyForSelected().catch(err => console.warn('E2E key init failed', err));
        });
        el.appendChild(li);
    });
}

// Render helper: Online users list (real-time). Accepts array of user objects {id,name,role,online,lastActive}.
function renderOnlineUsers(onlineList) {
    const el = document.getElementById('usersList');
    if (!el) return;
    // Build a map of known users
    const usersById = {};
    (users || []).forEach(u => usersById[u.id] = u);

    el.innerHTML = '';
    // onlineList may be array of objects or ids
    const list = Array.isArray(onlineList) ? onlineList : [];
    // Filter to only same role as current user (show same-tier users)
    const filtered = list.filter(x => {
        try {
            const role = (x && x.role) || (usersById[x] && usersById[x].role) || 'member';
            return currentUser && role === currentUser.role;
        } catch (e) { return false; }
    });

    filtered.forEach(item => {
        const id = item.id || item;
        const userMeta = usersById[id] || (typeof item === 'object' ? item : { id });
        const li = document.createElement('li');
        li.className = 'user-item';
        li.dataset.userId = userMeta.id;
        li.dataset.userName = userMeta.name || userMeta.username || userMeta.id;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        nameSpan.textContent = userMeta.name || userMeta.username || userMeta.id;
        nameSpan.addEventListener('click', function() {
            // reuse selection logic
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
            li.classList.add('active');
            selectedUser = { id: li.dataset.userId, name: li.dataset.userName };
            document.getElementById('chatWithUser').textContent = `Chat dengan ${selectedUser.name}`;
            document.getElementById('messageInput').disabled = false;
            document.getElementById('sendBtn').disabled = false;
            document.getElementById('messageInput').focus();
            loadUserMessages();
            ensureKeyForSelected().catch(err => console.warn('E2E key init failed', err));
        });

        const profileBtn = document.createElement('button');
        profileBtn.className = 'btn-view-profile';
        profileBtn.textContent = 'Profil';
        profileBtn.addEventListener('click', function(e) { e.stopPropagation(); window.location.href = `/profile.html?id=${userMeta.id}`; });

        // online indicator
        const onlineDot = (item && item.online) || userMeta.online ? '<span style="display:inline-block;width:8px;height:8px;background:#2ecc71;border-radius:50%;margin-right:8px;vertical-align:middle"></span>' : '<span style="display:inline-block;width:8px;height:8px;background:#bdc3c7;border-radius:50%;margin-right:8px;vertical-align:middle"></span>';
        li.innerHTML = onlineDot;
        li.appendChild(nameSpan);
        li.appendChild(profileBtn);
        el.appendChild(li);
    });
}

async function checkSession() {
    try {
        const response = await fetch('/api/profile');
        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        const data = await response.json();
        currentUser = { id: data.id, name: data.name, role: data.role || 'member' };
        document.getElementById('currentUserName').textContent = currentUser.name;

        // Show dashboard button only for superadmin or owner
        const dashboardBtn = document.getElementById('dashboardBtn');
        if (dashboardBtn) {
            if (data.role === 'superadmin' || data.role === 'owner') {
                dashboardBtn.style.display = 'inline-block';
                dashboardBtn.addEventListener('click', function() {
                    window.location.href = '/admin/dashboard.html';
                });
            } else {
                dashboardBtn.style.display = 'none';
            }
        }

            // Load effective features for this user's role
            try {
                const ffRes = await fetch('/api/features-for-role');
                if (ffRes.ok) {
                    const ff = await ffRes.json();
                    // expose to currentUser for feature gating in UI
                    currentUser.features = ff.memberFeatures || {};
                    currentUser.adminFeatures = ff.adminFeatures || {};
                    currentUser.recommendedFeatures = ff.recommendedFeatures || [];
                    currentUser.enforcements = ff.enforcements || {};
                    window.featureFlags = ff;

                    // Show/hide attach image button based on feature
                    const attachBtn = document.getElementById('attachImageBtn');
                    const imageInput = document.getElementById('imageInput');
                    if (attachBtn && imageInput) {
                        if ((currentUser.features && currentUser.features.imageUpload) || (currentUser.adminFeatures && currentUser.adminFeatures.imageUpload)) {
                            attachBtn.style.display = 'inline-block';
                        } else {
                            attachBtn.style.display = 'none';
                            imageInput.style.display = 'none';
                        }
                    }
                } else {
                    currentUser.features = {};
                    window.featureFlags = { betaFeatures: false, memberFeatures: {} };
                }
            } catch (e) {
                console.warn('Failed to load feature flags', e);
                currentUser.features = currentUser.features || {};
                window.featureFlags = window.featureFlags || { betaFeatures: false, memberFeatures: {} };
            }
    } catch (error) {
        console.error('Session error:', error);
        window.location.href = '/login.html';
    }
}

function setupEventListeners() {
    // Logout button
    document.getElementById('logoutBtn').addEventListener('click', async function() {
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login.html';
        } catch (error) {
            console.error('Logout error:', error);
        }
    });

    // Profile button
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) {
        profileBtn.addEventListener('click', function() {
            window.location.href = '/profile.html';
        });
    }
    
    // Send message
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Socket events
    socket.on('receive-message', async function(message) {
        if (message.senderId === selectedUser?.id || message.receiverId === selectedUser?.id) {
            await displayMessageAsync(message);
            scrollToBottom();
            // refresh user list to show new chats
            await loadMessages();
        }
    });
    
    socket.on('message-sent', async function(message) {
        await displayMessageAsync(message);
        scrollToBottom();
        // refresh user list to show new chats
        await loadMessages();
    });

    // Real-time online users update
    socket.on('online-users', function(list) {
        try { renderOnlineUsers(Array.isArray(list) ? list : []); } catch (e) { console.warn('online-users render failed', e); }
    });

    // Account rankings for Support Contact and Bisnis Akun
    socket.on('accounts-ranking', function(data) {
        try {
            if (data && data.support) renderSupportList(data.support);
            if (data && data.business) renderBusinessList(data.business);
        } catch (e) { console.warn('accounts-ranking render failed', e); }
    });

    socket.on('message-deleted', function(data) {
        const id = data.id;
        const el = document.querySelector(`[data-msg-id="${id}"]`);
        if (el) {
            // replace content with deleted notice
            const content = el.querySelector('.message-content');
            if (content) content.innerHTML = '<i>Pesan dihapus</i>';
        }
    });

    socket.on('chat-deleted', function(data) {
        if (!selectedUser) return;
        const other = data.with;
        if (other === selectedUser.id) {
            const messagesContainer = document.getElementById('messagesContainer');
            messagesContainer.innerHTML = '';
            // clear reply preview and state
            clearReply();
        }
    });

    // Delete chat button
    const deleteChatBtn = document.getElementById('deleteChatBtn');
    if (deleteChatBtn) {
        deleteChatBtn.addEventListener('click', function() {
            if (!selectedUser) return alert('Pilih obrolan dulu');
            if (!confirm(`Hapus semua pesan dengan ${selectedUser.name}?`)) return;
            socket.emit('delete-chat', { userA: currentUser.id, userB: selectedUser.id });
        });
    }

    // Cancel reply
    const cancelReplyBtn = document.getElementById('cancelReplyBtn');
    if (cancelReplyBtn) {
        cancelReplyBtn.addEventListener('click', function() {
            clearReply();
        });
    }

    // Update message status
    socket.on('message-status', function(data) {
        const { id, status } = data;
        const el = document.querySelector(`[data-msg-id="${id}"]`);
        if (el) {
            const statusEl = el.querySelector('.message-status');
            if (statusEl) {
                if (status === 'read') {
                    statusEl.textContent = '✔✔';
                    statusEl.style.color = 'blue';
                } else if (status === 'delivered') {
                    statusEl.textContent = '✔✔';
                    statusEl.style.color = 'gray';
                } else if (status === 'blocked') {
                    statusEl.textContent = '✖';
                    statusEl.style.color = 'red';
                } else {
                    statusEl.textContent = '✔';
                    statusEl.style.color = 'gray';
                }
            }
        }
    });
}

// Image attach handling
let pendingImageData = null;
document.addEventListener('DOMContentLoaded', function() {
    const attachBtn = document.getElementById('attachImageBtn');
    const imageInput = document.getElementById('imageInput');
    if (attachBtn && imageInput) {
        attachBtn.addEventListener('click', function() {
            imageInput.click();
        });
        imageInput.addEventListener('change', async function(e) {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            if (!f.type.startsWith('image/')) return alert('Hanya file gambar diperbolehkan');
            try {
                const reader = new FileReader();
                reader.onload = function(ev) {
                    pendingImageData = ev.target.result; // data URL
                    // show small preview in replyPreview area temporarily
                    const preview = document.getElementById('replyPreview');
                    const replyText = document.getElementById('replyText');
                    if (preview && replyText) {
                        replyText.textContent = 'Gambar siap dilampirkan';
                        preview.style.display = 'block';
                    }
                };
                reader.readAsDataURL(f);
            } catch (err) { console.warn('image read failed', err); }
        });
    }
});

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        users = await response.json();
        // Do not display here — messages determine which users are shown
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function displayUsers(users) {
    const usersList = document.getElementById('usersList');
    usersList.innerHTML = '';
    
    users.forEach(user => {
        const li = document.createElement('li');
        li.className = 'user-item';
        li.dataset.userId = user.id;
        li.dataset.userName = user.name || user.username;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        nameSpan.textContent = user.name || user.username;

        // verification badge (if any)
        let badgeEl = null;
        if (user.verification && user.verification.type) {
            badgeEl = document.createElement('span');
            badgeEl.className = `user-badge user-badge-${user.verification.type}`;
            // simple symbol per type
            const sym = user.verification.type === 'blue' ? '✔' : (user.verification.type === 'green' ? '✔' : '★');
            badgeEl.textContent = sym;
            badgeEl.title = user.verification.info || '';
            badgeEl.addEventListener('click', function(e) {
                e.stopPropagation();
                showBadgePopup(badgeEl, user.verification);
            });
        }

        nameSpan.addEventListener('click', function() {
            // Set active user
            document.querySelectorAll('.user-item').forEach(item => {
                item.classList.remove('active');
            });
            li.classList.add('active');

            // Set selected user
            selectedUser = {
                id: li.dataset.userId,
                name: li.dataset.userName
            };

            // Update UI
            document.getElementById('chatWithUser').textContent = `Chat dengan ${selectedUser.name}`;
            document.getElementById('messageInput').disabled = false;
            document.getElementById('sendBtn').disabled = false;
            document.getElementById('messageInput').focus();

            // Load messages dengan user ini
            loadUserMessages();
            // Ensure an E2E key is available for this pair (prompts user)
            ensureKeyForSelected().catch(err => console.warn('E2E key init failed', err));
        });

        const profileBtn = document.createElement('button');
        profileBtn.className = 'btn-view-profile';
        profileBtn.textContent = 'Profil';
        profileBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            window.location.href = `/profile.html?id=${user.id}`;
        });

        li.appendChild(nameSpan);
        if (badgeEl) li.appendChild(badgeEl);
        li.appendChild(profileBtn);
        usersList.appendChild(li);
    });

    // Global click to hide popup
    document.addEventListener('click', function () { hideBadgePopup(); });
}

// show floating popup near element with verification info
function showBadgePopup(el, verification) {
    hideBadgePopup();
    const popup = document.createElement('div');
    popup.className = 'badge-popup';
    popup.innerHTML = `<strong>${(verification.type||'').toUpperCase()} verification</strong><div class="small">${verification.info||''}</div>`;
    document.body.appendChild(popup);
    const r = el.getBoundingClientRect();
    popup.style.position = 'absolute';
    popup.style.left = (r.right + 8) + 'px';
    popup.style.top = (r.top) + 'px';
    // stop clicks inside popup from closing immediately
    popup.addEventListener('click', function(e){ e.stopPropagation(); });
}

function hideBadgePopup() {
    const existing = document.querySelector('.badge-popup');
    if (existing) existing.remove();
}

async function loadMessages() {
    try {
        const response = await fetch('/api/messages');
        const messages = await response.json();
        
        // Cari semua user yang pernah chat dengan current user
        const chatUsers = new Set();
        messages.forEach(msg => {
            if (msg.senderId === currentUser.id) {
                chatUsers.add(msg.receiverId);
            } else if (msg.receiverId === currentUser.id) {
                chatUsers.add(msg.senderId);
            }
        });
        
        // Tampilkan user-user ini di list
        const usersResponse = await fetch('/api/users');
        const allUsers = await usersResponse.json();
        
        // Only include users that have chat history with current user
        const filteredUsers = allUsers.filter(user => chatUsers.has(user.id));
        displayUsers(filteredUsers);
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

async function loadUserMessages() {
    try {
        const response = await fetch('/api/messages');
        const messages = await response.json();
        
        const filteredMessages = messages.filter(msg => 
            (msg.senderId === currentUser.id && msg.receiverId === selectedUser.id) ||
            (msg.senderId === selectedUser.id && msg.receiverId === currentUser.id)
        );
        
        // Sort by timestamp
        filteredMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        // Clear messages container
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.innerHTML = '';
        
        // Display pinned messages first (client-side pins stored per pair)
        const pid = pairId(currentUser.id, selectedUser.id);
        const pinnedKey = `rc_pinned_${pid}`;
        const pinnedList = JSON.parse(localStorage.getItem(pinnedKey) || '[]');

        // Render pinned messages first in order of pinnedList
        for (const mid of pinnedList) {
            const m = filteredMessages.find(x => x.id === mid);
            if (m) await displayMessageAsync(m);
        }

        // Then render the rest (excluding pinned)
        for (const msg of filteredMessages) {
            if (pinnedList.includes(msg.id)) continue;
            await displayMessageAsync(msg);
        }
        
        scrollToBottom();
        // Mark unread messages as read (notify server)
        try {
            const unreadIds = filteredMessages
                .filter(m => m.receiverId === currentUser.id && !m.isRead)
                .map(m => m.id)
                .filter(Boolean);
            if (unreadIds.length > 0) {
                socket.emit('mark-as-read', unreadIds);
            }
        } catch (e) { console.warn('mark-as-read emit failed', e); }
    } catch (error) {
        console.error('Error loading user messages:', error);
    }
}

// Append message with status
function appendMessage(message, textContent) {
    const messagesContainer = document.getElementById('messagesContainer');
    const isSent = message.senderId === currentUser.id;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    if (message.id) messageDiv.setAttribute('data-msg-id', message.id);

    const time = new Date(message.timestamp).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });

    let statusHtml = '';
    if (isSent) {
        if (message.isRead) {
            statusHtml = '<span class="message-status" style="color:blue">✔✔</span>';
        } else {
            statusHtml = '<span class="message-status">✔</span>';
        }
    }

    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-text">${textContent}</div>
            <div class="message-time">${time} ${statusHtml}</div>
        </div>
    `;

    messagesContainer.appendChild(messageDiv);

    // Attach actions area based on feature flags
    try {
        const actions = document.createElement('div');
        actions.className = 'message-actions';

        // Reply button (available to everyone for now)
        const btnReply = document.createElement('button');
        btnReply.className = 'btn-reply';
        btnReply.textContent = 'Balas';
        btnReply.addEventListener('click', async function() {
            const snippet = textContent.length > 200 ? textContent.slice(0, 197) + '...' : textContent;
            replyTarget = { id: message.id, snippet };
            showReplyPreview(snippet);
        });
        actions.appendChild(btnReply);

        // Pin / Unpin (client-side) when feature enabled or admin
        const canPin = (currentUser && (currentUser.role === 'superadmin' || currentUser.role === 'owner')) || (currentUser && ((currentUser.features && currentUser.features.pinMessages) || (currentUser.adminFeatures && currentUser.adminFeatures.pinMessages)));
        if (canPin) {
            const pid = pairId(currentUser.id, selectedUser ? selectedUser.id : (message.receiverId === currentUser.id ? message.senderId : message.receiverId));
            const pinnedKey = `rc_pinned_${pid}`;
            const pinnedList = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
            const isPinned = pinnedList.includes(message.id);
            const btnPin = document.createElement('button');
            btnPin.className = 'btn-pin';
            btnPin.textContent = isPinned ? 'Unpin' : 'Pin';
            btnPin.addEventListener('click', function() {
                let arr = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
                if (arr.includes(message.id)) {
                    arr = arr.filter(x => x !== message.id);
                    btnPin.textContent = 'Pin';
                } else {
                    arr.unshift(message.id);
                    btnPin.textContent = 'Unpin';
                }
                localStorage.setItem(pinnedKey, JSON.stringify(arr));
                // refresh messages view to show pinned order
                loadUserMessages().catch(()=>{});
            });
            actions.appendChild(btnPin);
        }

        // Delete button: shown when user is allowed to delete (owner/superadmin OR feature enabled for member and message sender)
        const canDeleteForAll = currentUser && (currentUser.role === 'superadmin' || currentUser.role === 'owner');
        const canDeleteOwn = currentUser && currentUser.features && currentUser.features.deleteMessages;
        if (canDeleteForAll || (canDeleteOwn && message.senderId === currentUser.id)) {
            const btnDelete = document.createElement('button');
            btnDelete.className = 'btn-delete';
            btnDelete.style.color = '#b22222';
            btnDelete.textContent = 'Hapus';
            btnDelete.addEventListener('click', function() {
                if (!confirm('Hapus pesan ini?')) return;
                if (!message.id) return;
                socket.emit('delete-message', message.id);
            });
            actions.appendChild(btnDelete);
        }

        messageDiv.appendChild(actions);
    } catch (e) { console.warn('attach actions failed', e); }
}

function showReplyPreview(snippet) {
    const preview = document.getElementById('replyPreview');
    const replyText = document.getElementById('replyText');
    if (preview && replyText) {
        replyText.textContent = snippet;
        preview.style.display = 'block';
    }
}

function clearReply() {
    replyTarget = null;
    const preview = document.getElementById('replyPreview');
    const replyText = document.getElementById('replyText');
    if (preview && replyText) {
        replyText.textContent = '';
        preview.style.display = 'none';
    }
}

// Stable pair identifier for two user IDs (order-independent)
function pairId(a, b) {
    return [String(a), String(b)].sort().join(':');
}

// Ensure an E2E key exists for the currently selected user.
// If not present, prompt the user for a passphrase to derive one.
async function ensureKeyForSelected() {
    if (!selectedUser || !currentUser) return null;
    const id = pairId(currentUser.id, selectedUser.id);
    if (e2eKeys[id]) return e2eKeys[id];

    // Prompt user for passphrase (user may cancel)
    try {
        const pass = prompt(`Masukkan passphrase untuk obrolan dengan ${selectedUser.name} (kosong untuk batal):`);
        if (!pass) return null;

        // Compute salt and derive AES key
        const salt = await window.E2E.computeSaltForPair(currentUser.id, selectedUser.id);
        const key = await window.E2E.deriveKey(pass, salt);
        e2eKeys[id] = key;
        return key;
    } catch (e) {
        console.warn('ensureKeyForSelected failed', e);
        return null;
    }
}

async function displayMessageAsync(message) {
    try {
        let text = message.content;
        if (message.isEncrypted) {
            const id = pairId(message.senderId, message.receiverId);
            const key = e2eKeys[id];
            if (key) {
                try {
                    text = await window.E2E.decryptText(message.content, key);
                } catch (e) {
                    text = '[Encrypted message — decryption failed]';
                }
            } else {
                text = '[Encrypted message — no key available]';
            }
        }

        appendMessage(message, text);
    } catch (error) {
        console.error('Error displaying message', error);
    }
}

function sendMessage() {
    (async () => {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();

        if (!selectedUser) return;
        // allow sending image-only messages
        if (!content && !pendingImageData) return;

        const message = {
            senderId: currentUser.id,
            senderName: currentUser.name,
            receiverId: selectedUser.id,
            content: content,
            timestamp: new Date().toISOString()
        };

        // attach image if present and allowed
        if (pendingImageData) {
            // ensure feature allowed
            const allowed = (currentUser.features && currentUser.features.imageUpload) || (currentUser.adminFeatures && currentUser.adminFeatures.imageUpload);
            if (allowed) {
                message.image = pendingImageData;
            } else {
                alert('Fitur unggah gambar tidak diizinkan untuk akun Anda');
                pendingImageData = null;
            }
        }

        // Attach reply info if present
        if (replyTarget) {
            message.replyTo = replyTarget.id;
            message.replySnippet = replyTarget.snippet;
        }

        // Try to encrypt if key available (or prompt for passphrase)
        try {
            const key = await ensureKeyForSelected();
            if (key) {
                const cipher = await window.E2E.encryptText(content, key);
                message.content = cipher;
                message.isEncrypted = true;
            } else {
                message.isEncrypted = false;
            }
        } catch (e) {
            console.warn('Encryption failed, sending plaintext', e);
            message.isEncrypted = false;
        }

        // Kirim via socket
        socket.emit('send-message', message);

        // Clear input
        input.value = '';
        pendingImageData = null;
        input.focus();
        // clear reply after sending
        clearReply();
    })();
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}

// Real-time search handler
document.addEventListener('DOMContentLoaded', function () {
    const search = document.getElementById('userSearchInput');
    if (search) {
        let timer = null;
        search.addEventListener('input', function (e) {
            const q = (e.target.value || '').trim();
            clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    if (!q) {
                        // reload recent chat users
                        await loadMessages();
                        return;
                    }
                    const res = await fetch(`/api/users?search=${encodeURIComponent(q)}`);
                    if (res.ok) {
                        const found = await res.json();
                        displayUsers(found);
                    }
                } catch (err) { console.warn('search error', err); }
            }, 200);
        });
    }
});