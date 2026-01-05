const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const fsPromises = require('fs').promises;
const { saveUser, getUserByUsername, getUsers, saveMessage, getMessages, getUserById, updateUser, deleteMessage, deleteChatBetween, getMessagesByUser, deleteUser, blockUser, isUserBlocked, getNews, saveNews, deleteNews,
    appendAudit, getAudit, getFeatureFlags, saveFeatureFlag, getApiKeys, createApiKey, revokeApiKey,
    getTemplates, saveTemplate, listSessions, saveSessionMeta, killSession, getIPAllowlist, saveIPAllowlist, isIPAllowed,
    getPlugins, savePlugin, getSLAs, saveSLA, createBackup, listBackups, restoreBackup, setRetentionPolicy, enforceRetentionPolicies,
    listApprovals, createApproval, getApprovalById, approveApproval,
    getPrivacy, savePrivacy, deletePrivacy, getTerms, saveTerms, deleteTerms
    ,markMessageAsRead
} = require('./utils/database');

// scheduled messages storage
const scheduledFile = path.join(__dirname, 'data', 'scheduled.json');

async function loadScheduled() {
    try {
        const raw = await fsPromises.readFile(scheduledFile, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) {
        await fsPromises.mkdir(path.dirname(scheduledFile), { recursive: true }).catch(()=>{});
        try { await fsPromises.writeFile(scheduledFile, JSON.stringify([])); } catch(e){}
        return [];
    }
}

async function saveScheduledList(list) {
    try {
        await fsPromises.writeFile(scheduledFile, JSON.stringify(list, null, 2));
        return true;
    } catch (e) { console.error('saveScheduledList failed', e); return false; }
}

// Process scheduled messages every 30 seconds
setInterval(async () => {
    try {
        const list = await loadScheduled();
        const now = Date.now();
        const remaining = [];
        for (const item of list) {
            const sendAt = new Date(item.sendAt).getTime();
            if (!isNaN(sendAt) && sendAt <= now) {
                // send now
                if (item.broadcast) {
                    const users = await getUsers();
                    for (const u of users) {
                        const msg = { id: Date.now().toString() + '_' + Math.random().toString(36).slice(2,6), senderId: item.fromId || 'system', senderName: item.fromName || 'Admin', receiverId: u.id, content: item.content, timestamp: new Date().toISOString(), isRead: false };
                        await saveMessage(msg);
                        io.to(u.id).emit('receive-message', msg);
                    }
                    await appendAudit({ actor: item.fromName || 'admin', action: 'scheduled-broadcast-sent', detail: { id: item.id } });
                } else if (item.to) {
                    const msg = { id: Date.now().toString(), senderId: item.fromId || req?.session?.userId || 'admin', senderName: item.fromName || 'Admin', receiverId: item.to, content: item.content, timestamp: new Date().toISOString(), isRead: false };
                    await saveMessage(msg);
                    io.to(item.to).emit('receive-message', msg);
                    await appendAudit({ actor: item.fromName || 'admin', action: 'scheduled-message-sent', detail: { id: item.id, to: item.to } });
                }
            } else {
                remaining.push(item);
            }
        }
        if (remaining.length !== list.length) await saveScheduledList(remaining);
    } catch (e) {
        console.error('Scheduled processor error', e);
    }
}, 30 * 1000);


const JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-key';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Track online socket counts per user
const onlineCounts = {};
// Track last active timestamp per user (ms since epoch)
const lastActive = {};

// Compute account rankings (incoming message counts) and emit to all clients
async function computeAndEmitAccountRanks() {
    try {
        const users = await getUsers();
        const messages = await getMessages();

        // count incoming messages per user
        const incoming = {};
        for (const m of messages) {
            if (!m || !m.receiverId) continue;
            incoming[m.receiverId] = (incoming[m.receiverId] || 0) + 1;
        }

        const support = [];
        const business = [];
        for (const u of users) {
            const item = { id: u.id, name: u.name || u.username, role: u.role || 'member', incomingCount: incoming[u.id] || 0 };
            // attach online and lastActive info
            const online = !!onlineCounts[u.id];
            item.online = online;
            item.lastActive = lastActive[u.id] || null;
            if (u.role === 'superadmin' || u.role === 'owner') support.push(item);
            if (u.role === 'business') business.push(item);
        }

        // For support: sort by incomingCount desc
        support.sort((a,b) => b.incomingCount - a.incomingCount);

        // For business: online users first (recent activity), then by incomingCount
        business.sort((a,b) => {
            if (a.online && !b.online) return -1;
            if (!a.online && b.online) return 1;
            if (a.online && b.online) {
                // more recent first
                return (b.lastActive || 0) - (a.lastActive || 0);
            }
            return b.incomingCount - a.incomingCount;
        });

        io.emit('accounts-ranking', { support, business });
    } catch (e) {
        console.error('Failed to compute account ranks', e);
    }
}

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
// prefer Redis session store in production; fallback to file store then in-memory
let sessionStore = undefined;
function setupSessionStore() {
    // Use in-memory session store by default to avoid file permission/ENOENT issues.
    // If you prefer file-backed sessions, re-enable `session-file-store` and ensure
    // the `data/sessions_store` directory exists and is writable.
    sessionStore = undefined; // express default (in-memory) - not for production
    console.log('Using in-memory session store');
}

// Initialize session store and middleware synchronously so routes see `req.session`.
setupSessionStore();
app.use(session({
    secret: process.env.SESSION_SECRET || 'chat-secret-key',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { secure: false }
}));

// schedule retention enforcement every 6 hours
setInterval(() => { try { enforceRetentionPolicies(); } catch (e) { console.error('Retention cron error', e); } }, 6 * 60 * 60 * 1000);
// run once at startup
enforceRetentionPolicies().catch(()=>{});

// require superadmin middleware
function requireSuperAdmin(req, res, next) {
    const role = req.session && req.session.role;
    if (role === 'superadmin') return next();
    return res.status(403).json({ error: 'Super admin required' });
}

// Middleware untuk cek login
function requireLogin(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    // If request accepts JSON (API/fetch/XHR), respond with 401 instead of redirect
    const acceptsJson = req.headers['accept'] && req.headers['accept'].includes('application/json');
    if (acceptsJson || req.xhr || (req.path && req.path.startsWith('/api/'))) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/login.html');
}

// Routes
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

app.get('/chat.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/chat.html'));
});

// Halaman Profil
app.get('/profile.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/profile.html'));
});

// Serve /login.html directly
app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/login.html'));
});

// API: ambil profil user saat ini
app.get('/api/profile', requireLogin, async (req, res) => {
    try {
        const user = await getUserById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ id: user.id, username: user.username, name: user.name, avatar: user.avatar || null, verification: user.verification || null, role: user.role || 'member', business: user.business || null });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// API: ambil profil user lain berdasarkan id (public)
app.get('/api/profile/:id', requireLogin, async (req, res) => {
    try {
        const user = await getUserById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        // Hanya kirim informasi publik
        res.json({ id: user.id, username: user.username, name: user.name, avatar: user.avatar || null, verification: user.verification || null, role: user.role || 'member', business: user.business || null });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get profile' });
    }
});

// API: update profil (nama dan/atau password)
app.post('/api/profile', requireLogin, async (req, res) => {
    try {
        const { name, password, avatar, business } = req.body;
        const user = await getUserById(req.session.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (name) user.name = name;
        if (password) {
            const hashed = await bcrypt.hash(password, 10);
            user.password = hashed;
        }

        // Jika ada avatar (base64 data URL), simpan
        if (avatar) {
            if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
                user.avatar = avatar;
            }
        }

        // Jika ada objek bisnis (hanya untuk akun yang berperan sebagai business)
        if (business && typeof business === 'object') {
            user.business = {
                companyName: business.companyName || '',
                description: business.description || '',
                contact: business.contact || ''
            };
        }

        await updateUser(user);

        // Update session name jika berubah
        if (name) req.session.name = name;

        res.json({ success: true, user: { id: user.id, username: user.username, name: user.name } });
    } catch (e) {
        console.error('Profile update error', e);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// API Routes
app.post('/api/register', async (req, res) => {
    try {
        const { username, password, name } = req.body;
        
        // Cek jika username sudah ada
        const existingUser = await getUserByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Simpan user baru (default role: member)
        const user = {
            id: Date.now().toString(),
            username,
            password: hashedPassword,
            name,
            role: 'member',
            createdAt: new Date().toISOString()
        };
        
        await saveUser(user);
        res.json({ success: true, message: 'Registration successful' });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Cari user
        const user = await getUserByUsername(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Verifikasi password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 2FA enforcement: check feature flags and user setting (TOTP via speakeasy)
        try {
            const flags = await getFeatureFlags();
            const enforceKey = `enforce2FAForRole_${user.role}`;
            const force = flags[enforceKey] === true;
            const userRequires = user.twoFactorEnabled === true;
            if (force || userRequires) {
                const code = req.body.twoFactorCode || null;
                if (!user.twoFactorSecret || !code) {
                    return res.status(403).json({ error: '2FA required or invalid code' });
                }
                const ok2 = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token: String(code), window: 1 });
                if (!ok2) return res.status(403).json({ error: 'Invalid 2FA code' });
            }
        } catch (e) { /* ignore */ }
        
        // Set session (include role)
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.name = user.name;
        req.session.role = user.role || 'member';

        // save session metadata for admin session management and auditing
        try {
            await saveSessionMeta({ sessionId: req.sessionID, userId: user.id, username: user.username, role: req.session.role, ip: req.ip });
            await appendAudit({ actor: user.username, actorId: user.id, action: 'login', detail: { ip: req.ip } });
        } catch (e) { /* non-fatal */ }

        res.json({ 
            success: true, 
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role || 'member'
            }
        });
    } catch (error) {
        console.error('Login error', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Admin: audit trail
app.get('/api/admin/audit', requireLogin, requireAdmin, async (req, res) => {
    try {
        const data = await getAudit();
        res.json(data);
    } catch (e) { res.status(500).json({ error: 'Failed to load audit' }); }
});

// Approvals endpoints
app.get('/api/admin/approvals', requireLogin, requireAdmin, async (req, res) => {
    try {
        const a = await listApprovals(); res.json(a);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/approvals', requireLogin, requireAdmin, async (req, res) => {
    try {
        const body = req.body;
        const created = await createApproval(Object.assign({}, body, { createdBy: req.session.username, createdById: req.session.userId }));
        await appendAudit({ actor: req.session.username, action: 'create-approval', detail: created });
        res.json(created);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/approvals/:id/approve', requireLogin, requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const approver = { approverId: req.session.userId, approverName: req.session.username };
        const updated = await approveApproval(id, approver);
        await appendAudit({ actor: req.session.username, action: 'approve-approval', detail: { id, updated } });
        // if approved, attempt to execute mapped action
        if (updated.status === 'approved' && updated.action && updated.payload) {
            try {
                // Expanded approval action map
                const act = updated.action;
                const payload = updated.payload || {};
                if (act === 'delete-user' && payload.userId) {
                    await deleteUser(payload.userId);
                } else if (act === 'ban-user' && payload.userId) {
                    const u = await getUserById(payload.userId);
                    if (u) { u.isBanned = true; await updateUser(u); }
                } else if (act === 'reset-password' && payload.userId) {
                    const u = await getUserById(payload.userId);
                    if (u) {
                        const temp = 'tmp_' + Math.random().toString(36).slice(2,10);
                        const hashed = await bcrypt.hash(temp, 10);
                        u.password = hashed;
                        await updateUser(u);
                        // include temp password in approval record (audit only)
                        await appendAudit({ actor: 'system', action: 'reset-password-executed', detail: { userId: payload.userId, temp } });
                    }
                } else if (act === 'disable-user' && payload.userId) {
                    const u = await getUserById(payload.userId);
                    if (u) { u.isDisabled = true; await updateUser(u); }
                } else if (act === 'promote-to-owner' && payload.userId) {
                    const u = await getUserById(payload.userId);
                    if (u) { u.role = 'owner'; await updateUser(u); }
                } else if (act === 'demote-to-member' && payload.userId) {
                    const u = await getUserById(payload.userId);
                    if (u) { u.role = 'member'; await updateUser(u); }
                } else if (act === 'export-user-data' && payload.userId) {
                    try {
                        const u = await getUserById(payload.userId);
                        const msgs = await getMessagesByUser(payload.userId);
                        const exportObj = { user: u, messages: msgs };
                        const exportsDir = path.join(__dirname, 'data', 'exports');
                        await fsPromises.mkdir(exportsDir, { recursive: true });
                        const fname = `export_${payload.userId}_${Date.now()}.json`;
                        await fsPromises.writeFile(path.join(exportsDir, fname), JSON.stringify(exportObj, null, 2));
                        await appendAudit({ actor: 'system', action: 'export-user-data', detail: { userId: payload.userId, file: fname } });
                    } catch (e) { console.error('export failed', e); }
                }
            } catch (e) { console.error('Execute approval action failed', e); }
        }
        res.json(updated);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Impersonation (Super Admin only)
app.post('/api/admin/impersonate/:id', requireLogin, requireSuperAdmin, async (req, res) => {
    try {
        const targetId = req.params.id;
        const target = await getUserById(targetId);
        if (!target) return res.status(404).json({ error: 'User not found' });
        // store original if not impersonating yet
        if (!req.session._original) {
            req.session._original = { userId: req.session.userId, username: req.session.username, name: req.session.name, role: req.session.role };
        }
        req.session.userId = target.id;
        req.session.username = target.username;
        req.session.name = target.name;
        req.session.role = target.role || 'member';
        await appendAudit({ actor: req.session._original.username || 'superadmin', action: 'impersonate', detail: { targetId } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/admin/impersonate/stop', requireLogin, async (req, res) => {
    try {
        if (req.session._original) {
            const orig = req.session._original;
            req.session.userId = orig.userId;
            req.session.username = orig.username;
            req.session.name = orig.name;
            req.session.role = orig.role;
            delete req.session._original;
            await appendAudit({ actor: req.session.username, action: 'impersonate-stop', detail: {} });
            return res.json({ success: true });
        }
        res.status(400).json({ error: 'Not impersonating' });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Admin: feature flags
app.get('/api/admin/feature-flags', requireLogin, requireAdmin, async (req, res) => {
    const f = await getFeatureFlags(); res.json(f);
});
app.post('/api/admin/feature-flag', requireLogin, requireAdmin, async (req, res) => {
    const { key, value } = req.body; if (!key) return res.status(400).json({ error: 'key required' });
    try { const flags = await saveFeatureFlag(key, value); await appendAudit({ actor: req.session.username, action: 'feature-flag', detail: { key, value } }); res.json(flags); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Admin: API keys
app.get('/api/admin/api-keys', requireLogin, requireAdmin, async (req, res) => { const keys = await getApiKeys(); res.json(keys); });
app.post('/api/admin/api-keys', requireLogin, requireAdmin, async (req, res) => { try { const key = await createApiKey(req.body); await appendAudit({ actor: req.session.username, action: 'create-api-key', detail: key }); res.json(key); } catch (e) { res.status(500).json({ error: 'Failed' }); } });
app.delete('/api/admin/api-keys/:id', requireLogin, requireAdmin, async (req, res) => { try { await revokeApiKey(req.params.id); await appendAudit({ actor: req.session.username, action: 'revoke-api-key', detail: { id: req.params.id } }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Failed' }); } });

// Admin: sessions
app.get('/api/admin/sessions', requireLogin, requireAdmin, async (req, res) => { const s = await listSessions(); res.json(s); });
app.post('/api/admin/sessions/kill', requireLogin, requireAdmin, async (req, res) => { const { sessionId } = req.body; if (!sessionId) return res.status(400).json({ error: 'sessionId required' }); await killSession(sessionId); await appendAudit({ actor: req.session.username, action: 'kill-session', detail: { sessionId } }); res.json({ success: true }); });

// Admin: backups
app.get('/api/admin/backups', requireLogin, requireAdmin, async (req, res) => { const b = await listBackups(); res.json(b); });
app.post('/api/admin/backups/create', requireLogin, requireAdmin, async (req, res) => { const { name } = req.body; const out = await createBackup(name); await appendAudit({ actor: req.session.username, action: 'create-backup', detail: out }); res.json(out); });
app.post('/api/admin/backups/restore', requireLogin, requireAdmin, async (req, res) => { const { folder } = req.body; if (!folder) return res.status(400).json({ error: 'folder required' }); await restoreBackup(folder); await appendAudit({ actor: req.session.username, action: 'restore-backup', detail: { folder } }); res.json({ success: true }); });

// Admin: templates
app.get('/api/admin/templates', requireLogin, requireAdmin, async (req, res) => { const t = await getTemplates(); res.json(t); });
app.post('/api/admin/templates', requireLogin, requireAdmin, async (req, res) => { const saved = await saveTemplate(req.body); await appendAudit({ actor: req.session.username, action: 'save-template', detail: saved }); res.json(saved); });

// Admin: retention
app.post('/api/admin/retention', requireLogin, requireAdmin, async (req, res) => { const { userId, policy } = req.body; if (!userId || !policy) return res.status(400).json({ error: 'userId and policy required' }); const out = await setRetentionPolicy(userId, policy); await appendAudit({ actor: req.session.username, action: 'set-retention', detail: { userId, policy } }); res.json(out); });
app.post('/api/admin/enforce-retention', requireLogin, requireAdmin, async (req, res) => { const ok = await enforceRetentionPolicies(); await appendAudit({ actor: req.session.username, action: 'enforce-retention' }); res.json({ success: ok }); });

// Admin: IP allowlist
app.get('/api/admin/ip-allowlist', requireLogin, requireAdmin, async (req, res) => { res.json(await getIPAllowlist()); });
app.post('/api/admin/ip-allowlist', requireLogin, requireAdmin, async (req, res) => { const list = req.body; await saveIPAllowlist(list); await appendAudit({ actor: req.session.username, action: 'update-ip-allowlist', detail: list }); res.json({ success: true }); });

// Admin: plugins and SLAs
app.get('/api/admin/plugins', requireLogin, requireAdmin, async (req, res) => { res.json(await getPlugins()); });
app.post('/api/admin/plugins', requireLogin, requireAdmin, async (req, res) => { const p = await savePlugin(req.body); await appendAudit({ actor: req.session.username, action: 'save-plugin', detail: p }); res.json(p); });
app.get('/api/admin/slas', requireLogin, requireAdmin, async (req, res) => { res.json(await getSLAs()); });
app.post('/api/admin/slas', requireLogin, requireAdmin, async (req, res) => { const s = await saveSLA(req.body); await appendAudit({ actor: req.session.username, action: 'save-sla', detail: s }); res.json(s); });

// Admin: 2FA management per user
app.post('/api/admin/2fa/user/:id', requireLogin, requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { enabled, secret } = req.body;
        const u = await getUserById(id);
        if (!u) return res.status(404).json({ error: 'User not found' });
        u.twoFactorEnabled = !!enabled;
        if (secret) u.twoFactorSecret = secret;
        await updateUser(u);
        await appendAudit({ actor: req.session.username, action: 'set-2fa', detail: { id, enabled: u.twoFactorEnabled } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/users', requireLogin, async (req, res) => {
    try {
        const q = (req.query.search || '').toLowerCase().trim();
        const users = await getUsers();
        // Hanya kirim field publik and optionally filter by search
        let publicUsers = users
            .filter(user => user.id !== req.session.userId)
            .map(u => ({ id: u.id, username: u.username, name: u.name, avatar: u.avatar || null, verification: u.verification || null, role: u.role || 'member' }));
        if (q) {
            publicUsers = publicUsers.filter(u => (u.name && u.name.toLowerCase().includes(q)) || (u.username && u.username.toLowerCase().includes(q)) || u.id === q);
        }
        // attach online / lastActive if available
        publicUsers = publicUsers.map(u => ({ ...u, online: !!onlineCounts[u.id], lastActive: lastActive[u.id] || null }));
        res.json(publicUsers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Admin API: get all users (full data) - admin only
app.get('/api/admin/users', requireLogin, requireAdmin, async (req, res) => {
    try {
        const users = await getUsers();
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Admin API: set role for a user (owner/superadmin)
app.post('/api/admin/set-role', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { userId, role } = req.body;
        if (!userId || !role) return res.status(400).json({ error: 'userId and role required' });
        const user = await getUserById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.role = role;
        await updateUser(user);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to set role' });
    }
});

// Admin dashboard page
app.get('/admin/dashboard.html', requireLogin, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/html/admin_dashboard.html'));
});

// Admin: lihat semua pesan yang terkait dengan user tertentu
app.get('/api/admin/user/:id/messages', requireLogin, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const messages = await getMessagesByUser(userId);
        res.json(messages);
    } catch (e) {
        console.error('Failed to get user messages', e);
        res.status(500).json({ error: 'Failed to get user messages' });
    }
});

// Admin: send a message to a user (superadmin/owner/admin)
app.post('/api/admin/user/:id/message', requireLogin, requireAdmin, async (req, res) => {
    try {
        const targetId = req.params.id;
        const { content, replyTo } = req.body;
        if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
        const message = {
            id: Date.now().toString(),
            senderId: req.session.userId,
            senderName: req.session.username || req.session.name || 'admin',
            receiverId: targetId,
            content: content,
            isEncrypted: false,
            replyTo: replyTo || null,
            timestamp: new Date().toISOString(),
            isRead: false
        };

        await saveMessage(message);
        // emit to the target user if online
        io.to(targetId).emit('receive-message', message);
        // also emit to admin's rooms for UI consistency
        io.to(req.session.userId).emit('message-sent', message);
        await appendAudit({ actor: req.session.username || req.session.name || 'admin', action: 'admin-send-message', detail: { to: targetId, id: message.id } });
        res.json({ success: true, message });
    } catch (e) {
        console.error('Admin send message failed', e);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Admin: schedule a message (to single user or broadcast)
app.post('/api/admin/schedule-message', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { to, content, sendAt, broadcast } = req.body;
        if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
        if (!sendAt) return res.status(400).json({ error: 'sendAt required' });
        const list = await loadScheduled();
        const item = { id: 'sched_' + Date.now().toString(), to: to || null, content, sendAt, broadcast: !!broadcast, fromId: req.session.userId, fromName: req.session.username || req.session.name };
        list.push(item);
        await saveScheduledList(list);
        await appendAudit({ actor: req.session.username || req.session.name || 'admin', action: 'schedule-message', detail: item });
        res.json({ success: true, scheduled: item });
    } catch (e) { console.error('schedule-message failed', e); res.status(500).json({ error: 'Failed to schedule' }); }
});

// Admin: list scheduled messages
app.get('/api/admin/scheduled', requireLogin, requireAdmin, async (req, res) => {
    try {
        const list = await loadScheduled();
        res.json(list);
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Admin: cancel scheduled item
app.post('/api/admin/scheduled/cancel', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'id required' });
        const list = await loadScheduled();
        const filtered = (list || []).filter(x => x.id !== id);
        await saveScheduledList(filtered);
        await appendAudit({ actor: req.session.username || req.session.name || 'admin', action: 'cancel-scheduled', detail: { id } });
        res.json({ success: true });
    } catch (e) { console.error('cancel scheduled failed', e); res.status(500).json({ error: 'Failed' }); }
});

// Admin: immediate broadcast (send to all users now)
app.post('/api/admin/broadcast', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
        const users = await getUsers();
        for (const u of users) {
            const msg = { id: Date.now().toString() + '_' + Math.random().toString(36).slice(2,6), senderId: req.session.userId, senderName: req.session.username || req.session.name, receiverId: u.id, content, timestamp: new Date().toISOString(), isRead: false };
            await saveMessage(msg);
            io.to(u.id).emit('receive-message', msg);
        }
        await appendAudit({ actor: req.session.username || req.session.name || 'admin', action: 'broadcast', detail: { count: users.length } });
        res.json({ success: true, sentTo: users.length });
    } catch (e) { console.error('broadcast failed', e); res.status(500).json({ error: 'Failed' }); }
});

// Admin: export user data (messages + profile) for administrative review
app.get('/api/admin/user/:id/export', requireLogin, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const u = await getUserById(userId);
        if (!u) return res.status(404).json({ error: 'User not found' });
        const msgs = await getMessagesByUser(userId);
        const exportObj = { user: u, messages: msgs };
        const exportsDir = path.join(__dirname, 'data', 'exports');
        await fsPromises.mkdir(exportsDir, { recursive: true });
        const fname = `export_${userId}_${Date.now()}.json`;
        const full = path.join(exportsDir, fname);
        await fsPromises.writeFile(full, JSON.stringify(exportObj, null, 2));
        await appendAudit({ actor: req.session.username || req.session.name || 'admin', action: 'export-user-data-admin', detail: { userId, file: fname } });
        res.json({ success: true, file: `/data/exports/${fname}`, name: fname });
    } catch (e) {
        console.error('Export user data failed', e);
        res.status(500).json({ error: 'Failed to export' });
    }
});

// Serve exported files to admins only (simple direct download)
app.get('/data/exports/:name', requireLogin, requireAdmin, async (req, res) => {
    try {
        const name = req.params.name;
        const full = path.join(__dirname, 'data', 'exports', name);
        return res.sendFile(full);
    } catch (e) {
        console.error('Serving export failed', e);
        res.status(404).send('Not found');
    }
});

// Admin: ban a user (super admin/owner only)
app.post('/api/admin/ban-user', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID is required' });

        const user = await getUserById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.isBanned = true;
        await updateUser(user);
        res.json({ success: true, message: 'User has been banned' });
    } catch (e) {
        console.error('Failed to ban user', e);
        res.status(500).json({ error: 'Failed to ban user' });
    }
});

// Admin: delete a user (super admin/owner only)
app.delete('/api/admin/delete-user/:id', requireLogin, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await getUserById(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        await deleteUser(userId);
        res.json({ success: true, message: 'User has been deleted' });
    } catch (e) {
        console.error('Failed to delete user', e);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.get('/api/messages', requireLogin, async (req, res) => {
    try {
        const messages = await getMessages();
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// API: get news/announcements (visible to logged-in users)
app.get('/api/news', requireLogin, async (req, res) => {
    try {
        const news = await getNews();
        res.json(news);
    } catch (e) {
        console.error('Failed to get news', e);
        res.status(500).json({ error: 'Failed to get news' });
    }
});

// Public API: get feature flags (sanitized) for non-admin clients
app.get('/api/feature-flags', requireLogin, async (req, res) => {
    try {
        const flags = await getFeatureFlags();
        // Only expose non-admin flags to regular clients
        const out = {
            betaFeatures: !!flags.betaFeatures,
            // memberFeatures may be namespaced in file; provide default
            memberFeatures: flags.memberFeatures || {}
        };
        res.json(out);
    } catch (e) {
        console.error('Failed to load feature flags (public)', e);
        res.json({ betaFeatures: false, memberFeatures: {} });
    }
});

// Public API: get effective features for the current user's role
app.get('/api/features-for-role', requireLogin, async (req, res) => {
    try {
        const flags = await getFeatureFlags();
        const role = (req.session && req.session.role) || 'member';
        const out = {
            registration: !!flags.registration,
            maintenanceMode: !!flags.maintenanceMode,
            betaFeatures: !!flags.betaFeatures,
            memberFeatures: flags.memberFeatures || {},
            recommendedFeatures: flags.recommendedFeatures || []
        };

        // attach admin-level features for owner/superadmin/business if available
        if (role === 'owner' || role === 'superadmin' || role === 'business') {
            out.adminFeatures = flags.adminFeatures || {};
        }

        // role-specific enforcement flags (like 2FA per role)
        out.enforcements = {
            enforce2FA: !!flags.enforce2FA,
            enforce2FAForRole: flags[`enforce2FAForRole_${role}`] === true
        };

        res.json(out);
    } catch (e) {
        console.error('Failed to compute features for role', e);
        res.status(500).json({ error: 'Failed to compute features' });
    }
});

// Admin: create news (superadmin or owner)
app.post('/api/admin/news', requireLogin, requireSuperAdminOrOwner, async (req, res) => {
    try {
        const { title, message, startAt, endAt, dismissible } = req.body;
        if (!title || !message) return res.status(400).json({ error: 'title and message required' });
        const item = { title, message, startAt: startAt || null, endAt: endAt || null, dismissible: !!dismissible };
        const saved = await saveNews(item);
        res.json(saved);
    } catch (e) {
        console.error('Failed to create news', e);
        res.status(500).json({ error: 'Failed to create news' });
    }
});

// Admin: delete news
app.delete('/api/admin/news/:id', requireLogin, requireSuperAdminOrOwner, async (req, res) => {
    try {
        const id = req.params.id;
        await deleteNews(id);
        res.json({ success: true });
    } catch (e) {
        console.error('Failed to delete news', e);
        res.status(500).json({ error: 'Failed to delete news' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('New client connected');
    // helper to emit rich online-users list
    async function emitOnlineUsers() {
        try {
            const ids = Object.keys(onlineCounts);
            const out = [];
            for (const id of ids) {
                try {
                    const u = await getUserById(id);
                    out.push({ id, name: (u && (u.name || u.username)) || id, role: (u && u.role) || 'member', online: true, lastActive: lastActive[id] || Date.now() });
                } catch (e) {
                    out.push({ id, name: id, role: 'member', online: true, lastActive: lastActive[id] || Date.now() });
                }
            }
            io.emit('online-users', out);
        } catch (e) { console.error('emitOnlineUsers failed', e); }
    }
    
    // Join room berdasarkan user ID
    socket.on('join', (userId) => {
        socket.join(userId);
        // track online counts
        socket.userId = userId;
        onlineCounts[userId] = (onlineCounts[userId] || 0) + 1;
        lastActive[userId] = Date.now();
        // emit list of online user ids
        emitOnlineUsers().catch(()=>{});
        // send updated account rankings as well
        computeAndEmitAccountRanks().catch(()=>{});
    });
    
    // Kirim pesan
    socket.on('send-message', async (data) => {
        try {
            const isBlocked = await isUserBlocked(data.senderId, data.receiverId);
            if (isBlocked) {
                socket.emit('message-status', { id: data.id, status: 'blocked' });
                return;
            }

            const message = {
                id: Date.now().toString(),
                senderId: data.senderId,
                senderName: data.senderName,
                receiverId: data.receiverId,
                content: data.content,
                isEncrypted: data.isEncrypted || false,
                replyTo: data.replyTo || null,
                timestamp: new Date().toISOString(),
                isRead: false
            };

            await saveMessage(message);

            // update last active for sender
            try { lastActive[data.senderId] = Date.now(); emitOnlineUsers().catch(()=>{}); } catch(e) {}

            // Notify receiver if online
            io.to(data.receiverId).emit('receive-message', message);

            // Notify sender of delivery status
            socket.emit('message-status', { id: message.id, status: 'delivered' });

            // Recompute and broadcast account rankings (incoming counts)
            computeAndEmitAccountRanks().catch(()=>{});
        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('message-status', { id: data.id, status: 'failed' });
        }
    });

    // Delete a message (authorized: message owner or admin only)
    socket.on('delete-message', async (messageId) => {
        try {
            if (!messageId) return;
            const messages = await getMessages();
            const target = messages.find(m => m.id === messageId);
            if (!target) {
                socket.emit('delete-message-response', { id: messageId, success: false, error: 'not_found' });
                return;
            }

            const requesterId = socket.userId || null;
            let requester = null;
            if (requesterId) requester = await getUserById(requesterId);

            const isOwner = requesterId && target.senderId === requesterId;
            const isAdmin = requester && (requester.role === 'owner' || requester.role === 'superadmin');

            if (!isOwner && !isAdmin) {
                socket.emit('delete-message-response', { id: messageId, success: false, error: 'unauthorized' });
                return;
            }

            // Remove from DB
            await deleteMessage(messageId);

            // Notify all clients about deletion
            io.emit('message-deleted', { id: messageId });
            socket.emit('delete-message-response', { id: messageId, success: true });
        } catch (e) {
            console.error('Error deleting message', e);
            socket.emit('delete-message-response', { id: messageId, success: false, error: 'server_error' });
        }
    });

    // Delete entire chat between two users
    socket.on('delete-chat', async (data) => {
        try {
            const { userA, userB } = data;
            await deleteChatBetween(userA, userB);
            // Notify both users to refresh/clear chat
            io.to(userA).emit('chat-deleted', { with: userB });
            io.to(userB).emit('chat-deleted', { with: userA });
        } catch (e) {
            console.error('Error deleting chat', e);
        }
    });
    
    // Tanda pesan dibaca
    // Expects a single messageId (string) or an array of ids
    socket.on('mark-as-read', async (messageIdOrArray) => {
        try {
            const ids = Array.isArray(messageIdOrArray) ? messageIdOrArray : [messageIdOrArray];
            for (const id of ids) {
                if (!id) continue;
                const senderId = await markMessageAsRead(id);
                // Notify sender clients that message was read
                if (senderId) {
                    io.to(senderId).emit('message-status', { id, status: 'read' });
                }
                // Also notify the requesting socket for local UI update
                socket.emit('message-status', { id, status: 'read' });
            }
        } catch (e) {
            console.error('Error marking as read', e);
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
        // decrement onlineCounts and emit update
        const u = socket.userId;
        if (u) {
            onlineCounts[u] = (onlineCounts[u] || 1) - 1;
            if (onlineCounts[u] <= 0) delete onlineCounts[u];
            // emit richer online users list
            (async () => { try { const ids = Object.keys(onlineCounts); const out = []; for (const id of ids) { try { const uu = await getUserById(id); out.push({ id, name: (uu && (uu.name || uu.username)) || id, role: (uu && uu.role) || 'member', online: true, lastActive: lastActive[id] || Date.now() }); } catch(e) { out.push({ id, name: id, role: 'member', online: true, lastActive: lastActive[id] || Date.now() }); } } io.emit('online-users', out); } catch(e) { console.error('emit online-users on disconnect failed', e); } })();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Issue JWT token for external clients
app.post('/api/token', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await getUserByUsername(username);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });
        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token });
    } catch (e) {
        res.status(500).json({ error: 'Token issuance failed' });
    }
});

// Middleware for Bearer token auth
function verifyToken(req, res, next) {
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
    const token = auth.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        req.apiUser = payload;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Middleware: require role admin (owner or superadmin)
function requireAdmin(req, res, next) {
    const role = req.session && req.session.role;
    if (role === 'owner' || role === 'superadmin') return next();
    return res.status(403).json({ error: 'Admin access required' });
}

// Middleware: require role super admin or owner
function requireSuperAdminOrOwner(req, res, next) {
    const role = req.session && req.session.role;
    if (role === 'superadmin' || role === 'owner') return next();
    return res.status(403).json({ error: 'Super admin or owner access required' });
}

// External API: send message using JWT auth
app.post('/api/send-message', verifyToken, async (req, res) => {
    try {
        const data = req.body;
        // Ensure sender matches token
        const senderId = req.apiUser.id;
        const message = {
            id: Date.now().toString(),
            senderId: senderId,
            senderName: req.apiUser.name,
            receiverId: data.receiverId,
            content: data.content,
            isEncrypted: data.isEncrypted || false,
            replyTo: data.replyTo || null,
            replySnippet: data.replySnippet || null,
            timestamp: new Date().toISOString(),
            isRead: false
        };

        await saveMessage(message);
        io.to(message.receiverId).emit('receive-message', message);
        // Optionally notify sender's clients
        io.to(senderId).emit('message-sent', message);
        res.json({ success: true, message });
    } catch (e) {
        console.error('API send-message error', e);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// External API: delete message
app.post('/api/delete-message', verifyToken, async (req, res) => {
    try {
        const { messageId } = req.body;
        const messages = await getMessages();
        const msg = messages.find(m => m.id === messageId);
        if (!msg) return res.status(404).json({ error: 'Message not found' });
        if (msg.senderId !== req.apiUser.id) return res.status(403).json({ error: 'Not allowed' });

        await deleteMessage(messageId);
        io.emit('message-deleted', { id: messageId });
        res.json({ success: true });
    } catch (e) {
        console.error('API delete-message error', e);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

// External API: delete chat between two users
app.post('/api/delete-chat', verifyToken, async (req, res) => {
    try {
        const { otherUserId } = req.body;
        const me = req.apiUser.id;
        if (!otherUserId) return res.status(400).json({ error: 'otherUserId required' });
        // only allow if requester is one of the participants
        await deleteChatBetween(me, otherUserId);
        io.to(me).emit('chat-deleted', { with: otherUserId });
        io.to(otherUserId).emit('chat-deleted', { with: me });
        res.json({ success: true });
    } catch (e) {
        console.error('API delete-chat error', e);
        res.status(500).json({ error: 'Failed to delete chat' });
    }
});

// Admin: create a news announcement (only owner or superadmin)
app.post('/api/admin/news', requireLogin, requireSuperAdminOrOwner, async (req, res) => {
    try {
        const { title, message, startAt, endAt, dismissible } = req.body;
        if (!title || !message) return res.status(400).json({ error: 'title and message required' });
        const item = {
            title,
            message,
            startAt: startAt || null,
            endAt: endAt || null,
            dismissible: dismissible !== undefined ? !!dismissible : true
        };
        const saved = await saveNews(item);
        res.json({ success: true, news: saved });
    } catch (e) {
        console.error('Failed to save news', e);
        res.status(500).json({ error: 'Failed to save news' });
    }
});

// Admin: delete a news announcement
app.delete('/api/admin/news/:id', requireLogin, requireSuperAdminOrOwner, async (req, res) => {
    try {
        const id = req.params.id;
        await deleteNews(id);
        res.json({ success: true });
    } catch (e) {
        console.error('Failed to delete news', e);
        res.status(500).json({ error: 'Failed to delete news' });
    }
});

// Admin: generate TOTP secret and QR for a user
app.post('/api/admin/2fa/generate/:id', requireLogin, requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const user = await getUserById(id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const secret = speakeasy.generateSecret({ length: 20, name: `RoomChat:${user.username}` });
        // store base32 secret but do not enable until admin toggles
        user.twoFactorSecret = secret.base32;
        // do not automatically enable; leave twoFactorEnabled false until admin sets
        await updateUser(user);
        const otpauth = secret.otpauth_url;
        const qr = await qrcode.toDataURL(otpauth);
        await appendAudit({ actor: req.session.username, action: 'generate-2fa', detail: { userId: id } });
        res.json({ secret: secret.base32, otpauth, qr });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Failed' }); }
});

// Public policy pages API
app.get('/api/policy/privacy', async (req, res) => {
    try { const p = await getPrivacy(); res.json(p); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/policy/terms', async (req, res) => {
    try { const t = await getTerms(); res.json(t); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Admin: manage policies (owner or superadmin)
app.get('/api/admin/policy/privacy', requireLogin, requireSuperAdminOrOwner, async (req, res) => { try { const p = await getPrivacy(); res.json(p); } catch (e) { res.status(500).json({ error: 'Failed' }); } });
app.post('/api/admin/policy/privacy', requireLogin, requireSuperAdminOrOwner, async (req, res) => { try { const saved = await savePrivacy(req.body); await appendAudit({ actor: req.session.username, action: 'save-privacy', detail: { id: req.session.userId } }); res.json(saved); } catch (e) { res.status(500).json({ error: 'Failed' }); } });
app.delete('/api/admin/policy/privacy', requireLogin, requireSuperAdminOrOwner, async (req, res) => { try { await deletePrivacy(); await appendAudit({ actor: req.session.username, action: 'delete-privacy' }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Failed' }); } });

app.get('/api/admin/policy/terms', requireLogin, requireSuperAdminOrOwner, async (req, res) => { try { const p = await getTerms(); res.json(p); } catch (e) { res.status(500).json({ error: 'Failed' }); } });
app.post('/api/admin/policy/terms', requireLogin, requireSuperAdminOrOwner, async (req, res) => { try { const saved = await saveTerms(req.body); await appendAudit({ actor: req.session.username, action: 'save-terms', detail: { id: req.session.userId } }); res.json(saved); } catch (e) { res.status(500).json({ error: 'Failed' }); } });
app.delete('/api/admin/policy/terms', requireLogin, requireSuperAdminOrOwner, async (req, res) => { try { await deleteTerms(); await appendAudit({ actor: req.session.username, action: 'delete-terms' }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Failed' }); } });