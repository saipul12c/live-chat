const fs = require('fs').promises;
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const accountsDir = path.join(dataDir, 'accounts');
const newsFile = path.join(dataDir, 'news.json');
const auditFile = path.join(dataDir, 'audit.json');
const featureFlagsFile = path.join(dataDir, 'feature_flags.json');
const apiKeysFile = path.join(dataDir, 'api_keys.json');
const templatesFile = path.join(dataDir, 'templates.json');
const sessionsFile = path.join(dataDir, 'sessions.json');
const ipAllowFile = path.join(dataDir, 'ip_allowlist.json');
const pluginsFile = path.join(dataDir, 'plugins.json');
const slasFile = path.join(dataDir, 'slas.json');
const backupsDir = path.join(dataDir, 'backups');
const sessionsStoreDir = path.join(dataDir, 'sessions_store');
const approvalsFile = path.join(dataDir, 'approvals.json');
const privacyFile = path.join(dataDir, 'privacy.json');
const termsFile = path.join(dataDir, 'terms.json');

// Pastikan folder data dan file JSON ada
async function initializeDatabase() {
    try {
        await fs.mkdir(dataDir, { recursive: true });
        
        // ensure accounts directory exists for per-account JSON files
        await fs.mkdir(accountsDir, { recursive: true });

        // ensure news file exists
        try {
            await fs.access(newsFile);
        } catch {
            await fs.writeFile(newsFile, JSON.stringify([]));
        }
        // ensure auxiliary files exist
        try { await fs.access(auditFile); } catch { await fs.writeFile(auditFile, JSON.stringify([])); }
        try { await fs.access(featureFlagsFile); } catch { await fs.writeFile(featureFlagsFile, JSON.stringify({})); }
        try { await fs.access(apiKeysFile); } catch { await fs.writeFile(apiKeysFile, JSON.stringify([])); }
        try { await fs.access(templatesFile); } catch { await fs.writeFile(templatesFile, JSON.stringify([])); }
        try { await fs.access(sessionsFile); } catch { await fs.writeFile(sessionsFile, JSON.stringify([])); }
        try { await fs.access(ipAllowFile); } catch { await fs.writeFile(ipAllowFile, JSON.stringify({ allow: [], block: [] })); }
        try { await fs.access(pluginsFile); } catch { await fs.writeFile(pluginsFile, JSON.stringify([])); }
        try { await fs.access(slasFile); } catch { await fs.writeFile(slasFile, JSON.stringify([])); }
        try { await fs.access(approvalsFile); } catch { await fs.writeFile(approvalsFile, JSON.stringify([])); }
        try { await fs.access(privacyFile); } catch { await fs.writeFile(privacyFile, JSON.stringify({ content: '' })); }
        try { await fs.access(termsFile); } catch { await fs.writeFile(termsFile, JSON.stringify({ content: '' })); }
        await fs.mkdir(backupsDir, { recursive: true });
        // ensure sessions_store exists for session-file-store
        await fs.mkdir(sessionsStoreDir, { recursive: true });
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

// Fungsi untuk membaca users dari per-account files
async function getUsers() {
    try {
        const filenames = await fs.readdir(accountsDir);
        const users = [];
        for (const f of filenames) {
            if (!f.endsWith('.json')) continue;
            try {
                const data = await fs.readFile(path.join(accountsDir, f), 'utf8');
                const acct = JSON.parse(data);
                // Expose user fields but not messages by default
                const { messages, ...user } = acct;
                users.push(user);
            } catch (e) {
                // skip malformed
            }
        }
        return users;
    } catch (error) {
        console.error('Error reading users from accounts dir:', error);
        return [];
    }
}

// Fungsi untuk mencari user by username
async function getUserByUsername(username) {
    const users = await getUsers();
    return users.find(user => user.username === username);
}

// Fungsi untuk menyimpan user baru
async function saveUser(user) {
    // create per-account file only (accounts dir is source of truth)
    try {
        const existing = await getUserByUsername(user.username);
        if (existing) throw new Error('Username exists');
    } catch (e) {
        if (e.message === 'Username exists') throw e;
    }
    const acct = Object.assign({}, user);
    acct.messages = [];
    await writeAccount(acct);
}

// Per-account helpers
function accountFilePath(userId) {
    return path.join(accountsDir, `${userId}.json`);
}

async function readAccount(userId) {
    try {
        const p = accountFilePath(userId);
        const data = await fs.readFile(p, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return null;
    }
}

async function writeAccount(account) {
    const p = accountFilePath(account.id);
    await fs.writeFile(p, JSON.stringify(account, null, 2));
}

// Fungsi untuk membaca messages
async function getMessages() {
    // Aggregate messages from all account files (deduplicate by id)
    try {
        const filenames = await fs.readdir(accountsDir);
        const all = [];
        const seen = new Set();
        for (const f of filenames) {
            if (!f.endsWith('.json')) continue;
            try {
                const data = await fs.readFile(path.join(accountsDir, f), 'utf8');
                const acct = JSON.parse(data);
                if (Array.isArray(acct.messages)) {
                    for (const m of acct.messages) {
                        if (!m || !m.id) continue;
                        if (!seen.has(m.id)) {
                            seen.add(m.id);
                            all.push(m);
                        }
                    }
                }
            } catch (e) {
                // skip
            }
        }
        return all;
    } catch (error) {
        console.error('Error aggregating messages from accounts:', error);
        return [];
    }
}

// Fungsi untuk menyimpan message baru
async function saveMessage(message) {
    // Append message to sender and receiver account files
    try {
        // ensure message has id and timestamp
        if (!message.id) message.id = Date.now().toString();
        if (!message.timestamp) message.timestamp = new Date().toISOString();

        const senderAcct = await readAccount(message.senderId);
        if (senderAcct) {
            if (!Array.isArray(senderAcct.messages)) senderAcct.messages = [];
            senderAcct.messages.push(message);
            await writeAccount(senderAcct);
        }

        const receiverAcct = await readAccount(message.receiverId);
        if (receiverAcct) {
            if (!Array.isArray(receiverAcct.messages)) receiverAcct.messages = [];
            receiverAcct.messages.push(message);
            await writeAccount(receiverAcct);
        }
    } catch (e) {
        console.error('Failed to write message to per-account files:', e);
        throw e;
    }
}

// Inisialisasi database saat module dimuat
initializeDatabase();
// Tambahan: fungsi untuk mendapatkan user by id dan update user
async function getUserById(id) {
    // try reading per-account file
    const acct = await readAccount(id);
    if (acct) return acct;
    // fallback to scanning accounts
    const users = await getUsers();
    return users.find(u => u.id === id);
}

async function updateUser(updatedUser) {
    // Update per-account file while preserving messages
    const acct = await readAccount(updatedUser.id);
    if (!acct) throw new Error('User not found');
    const msgs = acct.messages || [];
    const merged = Object.assign({}, updatedUser);
    merged.messages = msgs;
    await writeAccount(merged);
}

// Delete a single message by id
async function deleteMessage(messageId) {
    // Remove from all account files
    try {
        const filenames = await fs.readdir(accountsDir);
        for (const f of filenames) {
            if (!f.endsWith('.json')) continue;
            const p = path.join(accountsDir, f);
            try {
                const data = await fs.readFile(p, 'utf8');
                const acct = JSON.parse(data);
                if (Array.isArray(acct.messages)) {
                    const newMsgs = acct.messages.filter(m => m.id !== messageId);
                    if (newMsgs.length !== acct.messages.length) {
                        acct.messages = newMsgs;
                        await fs.writeFile(p, JSON.stringify(acct, null, 2));
                    }
                }
            } catch (e) {
                // skip
            }
        }
    } catch (e) {
        console.error('Failed to remove message from per-account files:', e);
    }
}

// Delete all messages between two users
async function deleteChatBetween(userA, userB) {
    // Remove messages that are between userA and userB from all account files
    try {
        const filenames = await fs.readdir(accountsDir);
        for (const f of filenames) {
            if (!f.endsWith('.json')) continue;
            const p = path.join(accountsDir, f);
            try {
                const data = await fs.readFile(p, 'utf8');
                const acct = JSON.parse(data);
                if (Array.isArray(acct.messages)) {
                    const newMsgs = acct.messages.filter(m => !(
                        (m.senderId === userA && m.receiverId === userB) ||
                        (m.senderId === userB && m.receiverId === userA)
                    ));
                    if (newMsgs.length !== acct.messages.length) {
                        acct.messages = newMsgs;
                        await fs.writeFile(p, JSON.stringify(acct, null, 2));
                    }
                }
            } catch (e) {
                // skip
            }
        }
    } catch (e) {
        console.error('Failed to delete chat in per-account files:', e);
    }
}

// Mark a message as read by id (set isRead=true in all account files where present)
async function markMessageAsRead(messageId) {
    try {
        let senderId = null;
        const filenames = await fs.readdir(accountsDir);
        for (const f of filenames) {
            if (!f.endsWith('.json')) continue;
            const p = path.join(accountsDir, f);
            try {
                const data = await fs.readFile(p, 'utf8');
                const acct = JSON.parse(data);
                let changed = false;
                if (Array.isArray(acct.messages)) {
                    for (const m of acct.messages) {
                        if (m && m.id === messageId) {
                            if (!senderId && m.senderId) senderId = m.senderId;
                            if (!m.isRead) { m.isRead = true; changed = true; }
                        }
                    }
                }
                if (changed) {
                    await fs.writeFile(p, JSON.stringify(acct, null, 2));
                }
            } catch (e) {
                // skip
            }
        }
        return senderId;
    } catch (e) {
        console.error('markMessageAsRead failed', e);
        return null;
    }
}

// Get all messages where the user is sender or receiver
async function getMessagesByUser(userId) {
    try {
        const acct = await readAccount(userId);
        if (acct && Array.isArray(acct.messages)) return acct.messages;
    } catch (e) {
        // fallback to scanning accounts
    }
    const messages = await getMessages();
    return messages.filter(m => m.senderId === userId || m.receiverId === userId);
}

// Delete a user by id and remove related messages
async function deleteUser(userId) {
    // Remove account file
    try {
        const p = accountFilePath(userId);
        await fs.unlink(p).catch(()=>{});
    } catch (e) {
        console.error('Failed to delete account file:', e);
    }

    // Remove any messages referencing this user from other accounts
    try {
        const filenames = await fs.readdir(accountsDir);
        for (const f of filenames) {
            if (!f.endsWith('.json')) continue;
            const p = path.join(accountsDir, f);
            try {
                const data = await fs.readFile(p, 'utf8');
                const acct = JSON.parse(data);
                if (Array.isArray(acct.messages)) {
                    const newMsgs = acct.messages.filter(m => m.senderId !== userId && m.receiverId !== userId);
                    if (newMsgs.length !== acct.messages.length) {
                        acct.messages = newMsgs;
                        await fs.writeFile(p, JSON.stringify(acct, null, 2));
                    }
                }
            } catch (e) {
                // skip
            }
        }
    } catch (e) {
        console.error('Failed to cleanup messages after user deletion:', e);
    }
}

// Block a user
async function blockUser(blockerId, blockedId) {
    const acct = await readAccount(blockerId);
    if (!acct) throw new Error('Blocker not found');
    if (!acct.blockedUsers) acct.blockedUsers = [];
    if (!acct.blockedUsers.includes(blockedId)) {
        acct.blockedUsers.push(blockedId);
        await writeAccount(acct);
    }
}

// Check if a user is blocked
async function isUserBlocked(senderId, receiverId) {
    const receiver = await readAccount(receiverId);
    if (!receiver) return false;
    return receiver.blockedUsers && receiver.blockedUsers.includes(senderId);
}

// News helpers
async function getNews() {
    try {
        const data = await fs.readFile(newsFile, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('Failed to read news.json', e);
        return [];
    }
}

async function saveNews(item) {
    try {
        const all = await getNews();
        if (!item.id) item.id = Date.now().toString();
        item.createdAt = new Date().toISOString();
        all.push(item);
        await fs.writeFile(newsFile, JSON.stringify(all, null, 2));
        return item;
    } catch (e) {
        throw e;
    }
}

async function deleteNews(id) {
    try {
        const all = await getNews();
        const filtered = all.filter(n => n.id !== id);
        await fs.writeFile(newsFile, JSON.stringify(filtered, null, 2));
        return true;
    } catch (e) {
        throw e;
    }
}

// --- New helpers for extended admin features ---

async function appendAudit(entry) {
    try {
        const raw = await fs.readFile(auditFile, 'utf8');
        const all = JSON.parse(raw || '[]');
        entry.id = entry.id || Date.now().toString();
        entry.timestamp = new Date().toISOString();
        all.push(entry);
        await fs.writeFile(auditFile, JSON.stringify(all, null, 2));
        return entry;
    } catch (e) {
        console.error('appendAudit failed', e);
        throw e;
    }
}

async function getAudit(filterFn) {
    try {
        const raw = await fs.readFile(auditFile, 'utf8');
        const all = JSON.parse(raw || '[]');
        if (typeof filterFn === 'function') return all.filter(filterFn);
        return all;
    } catch (e) {
        return [];
    }
}

async function getFeatureFlags() {
    try {
        const raw = await fs.readFile(featureFlagsFile, 'utf8');
        return JSON.parse(raw || '{}');
    } catch (e) { return {}; }
}

async function saveFeatureFlag(key, value) {
    try {
        const flags = await getFeatureFlags();
        // Support dotted keys (e.g. 'memberFeatures.editMessages') to set nested objects
        if (typeof key === 'string' && key.includes('.')) {
            const parts = key.split('.');
            let cur = flags;
            for (let i = 0; i < parts.length - 1; i++) {
                const p = parts[i];
                if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
                cur = cur[p];
            }
            cur[parts[parts.length - 1]] = value;
        } else if (typeof key === 'string' && value && typeof value === 'object' && !Array.isArray(value)) {
            // If saving a whole object (e.g. key='memberFeatures'), merge with existing object
            flags[key] = Object.assign({}, flags[key] || {}, value);
        } else {
            flags[key] = value;
        }

        await fs.writeFile(featureFlagsFile, JSON.stringify(flags, null, 2));
        return flags;
    } catch (e) { throw e; }
}

async function getApiKeys(ownerId) {
    try {
        const raw = await fs.readFile(apiKeysFile, 'utf8');
        const all = JSON.parse(raw || '[]');
        if (ownerId) return all.filter(k => k.ownerId === ownerId);
        return all;
    } catch (e) { return []; }
}

async function createApiKey(data) {
    try {
        const all = await getApiKeys();
        const key = Object.assign({}, data);
        key.id = 'key_' + Date.now().toString();
        key.createdAt = new Date().toISOString();
        all.push(key);
        await fs.writeFile(apiKeysFile, JSON.stringify(all, null, 2));
        return key;
    } catch (e) { throw e; }
}

async function revokeApiKey(keyId) {
    try {
        const all = await getApiKeys();
        const filtered = all.filter(k => k.id !== keyId);
        await fs.writeFile(apiKeysFile, JSON.stringify(filtered, null, 2));
        return true;
    } catch (e) { throw e; }
}

async function getTemplates() {
    try {
        const raw = await fs.readFile(templatesFile, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) { return []; }
}

async function saveTemplate(t) {
    try {
        const all = await getTemplates();
        t.id = t.id || Date.now().toString();
        t.createdAt = new Date().toISOString();
        all.push(t);
        await fs.writeFile(templatesFile, JSON.stringify(all, null, 2));
        return t;
    } catch (e) { throw e; }
}

async function listSessions() {
    try {
        const raw = await fs.readFile(sessionsFile, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) { return []; }
}

async function saveSessionMeta(s) {
    try {
        const all = await listSessions();
        s.id = s.id || ('sess_' + Date.now().toString());
        s.createdAt = s.createdAt || new Date().toISOString();
        all.push(s);
        await fs.writeFile(sessionsFile, JSON.stringify(all, null, 2));
        return s;
    } catch (e) { throw e; }
}

async function killSession(sessionId) {
    try {
        const all = await listSessions();
        const filtered = all.filter(x => x.id !== sessionId);
        await fs.writeFile(sessionsFile, JSON.stringify(filtered, null, 2));
        return true;
    } catch (e) { throw e; }
}

async function getIPAllowlist() {
    try {
        const raw = await fs.readFile(ipAllowFile, 'utf8');
        return JSON.parse(raw || '{"allow":[],"block":[]}');
    } catch (e) { return { allow: [], block: [] }; }
}

async function saveIPAllowlist(listObj) {
    try {
        await fs.writeFile(ipAllowFile, JSON.stringify(listObj || { allow: [], block: [] }, null, 2));
        return listObj;
    } catch (e) { throw e; }
}

async function isIPAllowed(ip) {
    try {
        const l = await getIPAllowlist();
        if (Array.isArray(l.block) && l.block.includes(ip)) return false;
        if (Array.isArray(l.allow) && l.allow.length > 0) return l.allow.includes(ip);
        return true;
    } catch (e) { return true; }
}

async function getPlugins() {
    try {
        const raw = await fs.readFile(pluginsFile, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) { return []; }
}

async function savePlugin(p) {
    try {
        const list = await getPlugins();
        p.id = p.id || ('plugin_' + Date.now().toString());
        p.createdAt = new Date().toISOString();
        list.push(p);
        await fs.writeFile(pluginsFile, JSON.stringify(list, null, 2));
        return p;
    } catch (e) { throw e; }
}

async function getSLAs() {
    try {
        const raw = await fs.readFile(slasFile, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) { return []; }
}

async function saveSLA(sla) {
    try {
        const list = await getSLAs();
        sla.id = sla.id || ('sla_' + Date.now().toString());
        sla.createdAt = new Date().toISOString();
        list.push(sla);
        await fs.writeFile(slasFile, JSON.stringify(list, null, 2));
        return sla;
    } catch (e) { throw e; }
}

async function createBackup(name) {
    try {
        const fname = (name || 'backup') + '_' + Date.now().toString() + '.zip';
        const dest = path.join(backupsDir, fname);
        // simple backup: copy the entire data dir to a timestamped folder (not zipped to keep simple)
        const folder = path.join(backupsDir, fname.replace('.zip',''));
        await fs.mkdir(folder, { recursive: true });
        const files = await fs.readdir(dataDir);
        for (const f of files) {
            const src = path.join(dataDir, f);
            const stat = await fs.stat(src);
            if (stat.isFile()) {
                const destf = path.join(folder, f);
                const content = await fs.readFile(src);
                await fs.writeFile(destf, content);
            }
        }
        return { path: folder };
    } catch (e) { throw e; }
}

async function listBackups() {
    try {
        const files = await fs.readdir(backupsDir);
        return files;
    } catch (e) { return []; }
}

async function restoreBackup(folderName) {
    try {
        const folder = path.join(backupsDir, folderName);
        const files = await fs.readdir(folder);
        for (const f of files) {
            const src = path.join(folder, f);
            const dest = path.join(dataDir, f);
            const content = await fs.readFile(src);
            await fs.writeFile(dest, content);
        }
        return true;
    } catch (e) { throw e; }
}

// Privacy & Terms helpers
async function getPrivacy() {
    try {
        const raw = await fs.readFile(privacyFile, 'utf8');
        return JSON.parse(raw || '{"content":""}');
    } catch (e) { return { content: '' }; }
}

async function savePrivacy(obj) {
    try {
        obj.updatedAt = new Date().toISOString();
        await fs.writeFile(privacyFile, JSON.stringify(obj, null, 2));
        return obj;
    } catch (e) { throw e; }
}

async function deletePrivacy() {
    try { await fs.writeFile(privacyFile, JSON.stringify({ content: '' }, null, 2)); return true; } catch (e) { throw e; }
}

async function getTerms() {
    try {
        const raw = await fs.readFile(termsFile, 'utf8');
        return JSON.parse(raw || '{"content":""}');
    } catch (e) { return { content: '' }; }
}

async function saveTerms(obj) {
    try {
        obj.updatedAt = new Date().toISOString();
        await fs.writeFile(termsFile, JSON.stringify(obj, null, 2));
        return obj;
    } catch (e) { throw e; }
}

async function deleteTerms() {
    try { await fs.writeFile(termsFile, JSON.stringify({ content: '' }, null, 2)); return true; } catch (e) { throw e; }
}

// retention policy: set on user account object under 'retentionPolicy'
async function setRetentionPolicy(userId, policy) {
    try {
        const acct = await readAccount(userId);
        if (!acct) throw new Error('User not found');
        acct.retentionPolicy = policy;
        await writeAccount(acct);
        return acct;
    } catch (e) { throw e; }
}

// enforce retention: simple sweep that deletes messages older than policy days per account
async function enforceRetentionPolicies() {
    try {
        const filenames = await fs.readdir(accountsDir);
        for (const f of filenames) {
            if (!f.endsWith('.json')) continue;
            const p = path.join(accountsDir, f);
            const data = await fs.readFile(p, 'utf8');
            const acct = JSON.parse(data);
            if (acct && acct.retentionPolicy && acct.retentionPolicy.days) {
                const days = Number(acct.retentionPolicy.days) || 0;
                if (days > 0 && Array.isArray(acct.messages)) {
                    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
                    const newMsgs = acct.messages.filter(m => new Date(m.timestamp).getTime() >= cutoff);
                    if (newMsgs.length !== acct.messages.length) {
                        acct.messages = newMsgs;
                        await fs.writeFile(p, JSON.stringify(acct, null, 2));
                    }
                }
            }
        }
        return true;
    } catch (e) { console.error('enforceRetentionPolicies failed', e); return false; }
}

// Approvals (two-person approval flow)
async function listApprovals() {
    try {
        const raw = await fs.readFile(approvalsFile, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) { return []; }
}

async function createApproval(req) {
    try {
        const all = await listApprovals();
        const a = Object.assign({}, req);
        a.id = a.id || ('appr_' + Date.now().toString());
        a.status = 'pending';
        a.approvals = [];
        a.required = a.required || 2;
        a.createdAt = new Date().toISOString();
        all.push(a);
        await fs.writeFile(approvalsFile, JSON.stringify(all, null, 2));
        return a;
    } catch (e) { throw e; }
}

async function getApprovalById(id) {
    const all = await listApprovals();
    return all.find(x => x.id === id);
}

async function approveApproval(id, approver) {
    try {
        const all = await listApprovals();
        const idx = all.findIndex(x => x.id === id);
        if (idx === -1) throw new Error('Not found');
        const item = all[idx];
        if (item.status !== 'pending') return item;
        // avoid duplicate approver
        if (!Array.isArray(item.approvals)) item.approvals = [];
        if (item.approvals.find(a => a.approverId === approver.approverId)) return item;
        item.approvals.push({ approverId: approver.approverId, approverName: approver.approverName, at: new Date().toISOString() });
        if (item.approvals.length >= (item.required || 2)) {
            item.status = 'approved';
            item.approvedAt = new Date().toISOString();
        }
        all[idx] = item;
        await fs.writeFile(approvalsFile, JSON.stringify(all, null, 2));
        return item;
    } catch (e) { throw e; }
}

module.exports = {
    getUsers,
    getUserByUsername,
    getUserById,
    saveUser,
    updateUser,
    getMessages,
    getMessagesByUser,
    saveMessage,
    deleteMessage,
    deleteChatBetween,
    deleteUser,
    blockUser,
    isUserBlocked
    ,getNews, saveNews, deleteNews,
    // extended helpers
    appendAudit, getAudit,
    getFeatureFlags, saveFeatureFlag,
    getApiKeys, createApiKey, revokeApiKey,
    getTemplates, saveTemplate,
    listSessions, saveSessionMeta, killSession,
    getIPAllowlist, saveIPAllowlist, isIPAllowed,
    getPlugins, savePlugin,
    getSLAs, saveSLA,
    createBackup, listBackups, restoreBackup,
    setRetentionPolicy, enforceRetentionPolicies,
    listApprovals, createApproval, getApprovalById, approveApproval,
    getPrivacy, savePrivacy, deletePrivacy, getTerms, saveTerms, deleteTerms
    ,markMessageAsRead
};