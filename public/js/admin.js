document.addEventListener('DOMContentLoaded', async () => {
  const adminName = document.getElementById('adminName');
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // Helper: escape HTML for safe insertion into DOM (used by multiple functions)
  function escapeHtml(s) {
    return (s + '').replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Helper wrapper for admin API calls: request JSON and include same-origin credentials
  function apiFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    if (!opts.credentials) opts.credentials = 'same-origin';
    return fetch(path, opts);
  }

  // load current admin info
  try {
    const res = await fetch('/api/profile');
    const me = await res.json();
    if (res.ok) adminName.textContent = me.name || me.username;
  } catch (e) { adminName.textContent = 'Admin'; }

  // load all users
  async function loadUsers() {
    const res = await apiFetch('/api/admin/users');
    const users = await res.json();
    const table = document.getElementById('usersTable');
    table.innerHTML = `<tr style="text-align:left;font-weight:600;border-bottom:1px solid #ddd"><td>Avatar</td><td>Nama</td><td>Username</td><td>Role</td><td>Actions</td></tr>`;
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:8px"><img src="${u.avatar||'/images/default-avatar.svg'}" width="40" style="border-radius:20px"></td>
        <td style="padding:8px">${u.name||''}</td>
        <td style="padding:8px">${u.username||''}</td>
        <td style="padding:8px">${u.role||'member'}</td>
        <td style="padding:8px">
          <select data-id="${u.id}">
            <option value="member">member</option>
            <option value="business">business</option>
            <option value="superadmin">superadmin</option>
            <option value="owner">owner</option>
          </select>
          <button class="btn-set-role" data-id="${u.id}">Set</button>
          <button class="btn-chat" data-id="${u.id}">Chat</button>
          <button class="btn-view-chats" data-id="${u.id}">Lihat Obrolan</button>
          <button class="btn-delete" data-id="${u.id}" style="color:#b22222">Hapus</button>
        </td>`;
      table.appendChild(tr);
      // set select to current role
      const selElem = tr.querySelector(`select[data-id="${u.id}"]`);
      if (selElem) selElem.value = u.role || 'member';
    });

    // attach events
    document.querySelectorAll('.btn-set-role').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.dataset.id;
        const sel = document.querySelector(`select[data-id="${id}"]`);
        const role = sel.value;
        const res = await apiFetch('/api/admin/set-role', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: id, role }) });
        const d = await res.json();
        if (res.ok) alert('Role updated'); else alert(d.error||'Failed');
        loadUsers();
      });
    });

    document.querySelectorAll('.btn-chat').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.dataset.id;
        // open chat and preselect user
        window.location.href = `/chat.html?to=${id}`;
      });
    });
    
    // view chats
    document.querySelectorAll('.btn-view-chats').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        try {
          const res = await apiFetch(`/api/admin/user/${id}/messages`);
          if (!res.ok) throw new Error('Failed to load');
          const msgs = await res.json();
            const modal = document.getElementById('modal');
            const content = document.getElementById('modalContent');
            // Build message list with search, export and reply capability
            let html = `<h3>Obrolan untuk user ${id} (${msgs.length} pesan)</h3>`;
            html += `<div style="margin:8px 0;display:flex;gap:8px;align-items:center"><input id="msgSearch" placeholder="Cari pesan..." style="flex:1;padding:6px"/> <button id="exportMsgs" class="btn">Export</button></div>`;
            html += `<div id="msgsContainer">`;
            msgs.forEach(m => {
              html += `<div class="admin-msg" data-id="${m.id}" data-sender="${m.senderId}" style="border-bottom:1px solid #eee;padding:8px">
                <div style="font-weight:600">${escapeHtml(m.senderName||m.senderId)} <small style="color:#666">→ ${escapeHtml(m.receiverId||'')}</small></div>
                <div style="margin-top:6px">${escapeHtml(m.content||'')}</div>
                <small style=\"color:#666\">${m.timestamp||''}</small>
                <div style="margin-top:8px">
                  <textarea class="replyBox" placeholder="Balas pesan ini..." rows="2" style="width:100%"></textarea>
                  <div style="margin-top:6px;text-align:right"><button class="btn-reply btn" data-id="${m.id}" data-target="${m.senderId}">Kirim Balasan</button></div>
                </div>
              </div>`;
            });
            html += `</div>`;
            html += `<div style="margin-top:12px;text-align:right"><button id="closeModalBtn" class="btn">Tutup</button></div>`;
            content.innerHTML = html;

            // hook up search
            const msgsContainer = content.querySelector('#msgsContainer');
            const searchInput = content.querySelector('#msgSearch');
            searchInput.addEventListener('input', () => {
              const q = (searchInput.value || '').toLowerCase().trim();
              Array.from(msgsContainer.querySelectorAll('.admin-msg')).forEach(el => {
                const txt = el.textContent || '';
                el.style.display = q ? (txt.toLowerCase().includes(q) ? 'block' : 'none') : 'block';
              });
            });

            // export
            content.querySelector('#exportMsgs').addEventListener('click', async () => {
              try {
                const r = await apiFetch(`/api/admin/user/${id}/export`);
                if (!r.ok) { const d = await r.json(); return alert(d.error||'Export gagal'); }
                const d = await r.json();
                const url = d.file || (`/data/exports/${d.name}`);
                // open download in new tab
                window.open(url, '_blank');
                alert('Export dibuat: ' + (d.name || d.file));
              } catch (e) { alert('Export gagal'); }
            });

            // reply handlers
            Array.from(content.querySelectorAll('.btn-reply')).forEach(b => {
              b.addEventListener('click', async () => {
                const mid = b.dataset.id;
                const target = b.dataset.target; // user id to reply to
                const area = b.closest('.admin-msg').querySelector('.replyBox');
                const text = (area.value||'').trim();
                if (!text) return alert('Isi jawaban diperlukan');
                try {
                  const r = await apiFetch(`/api/admin/user/${target}/message`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ content: text, replyTo: mid }) });
                  if (!r.ok) { const d = await r.json(); return alert(d.error||'Gagal mengirim'); }
                  const resd = await r.json();
                  // append sent reply to UI
                  const sent = resd.message;
                  const sentEl = document.createElement('div');
                  sentEl.style.borderTop = '1px dashed #ddd';
                  sentEl.style.paddingTop = '8px';
                  sentEl.innerHTML = `<div style="font-weight:600">${escapeHtml(sent.senderName||sent.senderId)} <small style="color:#666">→ ${escapeHtml(sent.receiverId||'')}</small></div><div style="margin-top:6px">${escapeHtml(sent.content||'')}</div><small style=\"color:#666\">${sent.timestamp||''}</small>`;
                  b.closest('.admin-msg').appendChild(sentEl);
                  area.value = '';
                } catch (e) { alert('Gagal mengirim'); }
              });
            });

            // close
            content.querySelector('#closeModalBtn').addEventListener('click', () => { modal.style.display = 'none'; });
            modal.style.display = 'flex';
        } catch (e) {
          alert('Gagal memuat obrolan');
        }
      });
    });

    // delete user
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Yakin hapus user ini? Semua obrolannya juga akan dihapus.')) return;
        try {
          const res = await apiFetch(`/api/admin/user/${id}`, { method: 'DELETE' });
          const d = await res.json();
          if (res.ok) {
            alert('User dihapus');
            loadUsers();
          } else {
            alert(d.error || 'Gagal menghapus');
          }
        } catch (e) {
          alert('Gagal menghapus');
        }
      });
    });

    // (uses global escapeHtml)
  }

  loadUsers();
  // refresh all helper
  document.getElementById('refreshAll')?.addEventListener('click', async ()=>{
    loadUsers(); loadNews(); loadFeatureFlags(); loadMemberFeatures(); loadApiKeys(); loadSessions(); loadBackups(); loadApprovals(); loadPlugins(); loadSlas(); loadTemplates(); loadAudit();
    alert('Refreshed');
  });

  // toggles for card lists (make collapsed UI friendly)
  document.querySelectorAll('.toggle').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const target = btn.dataset.target;
      const el = document.getElementById(target);
      if(!el) return;
      if(el.style.display === 'none' || !el.style.display){ el.style.display = 'block'; btn.textContent = 'Sembunyikan'; }
      else { el.style.display = 'none'; btn.textContent = 'Tampilkan'; }
    });
  });
  // NEWS management
  async function loadNews() {
    try {
      const res = await fetch('/api/news');
      if (!res.ok) return;
      const items = await res.json();
      const container = document.getElementById('newsList');
      container.innerHTML = '';
      if (!items || items.length === 0) return;
      items.sort((a,b)=> new Date(b.createdAt||0)-new Date(a.createdAt||0));
      items.forEach(n => {
        const el = document.createElement('div');
        el.style.borderBottom = '1px solid #eee';
        el.style.padding = '8px';
        el.innerHTML = `<strong>${n.title||''}</strong> <small style="color:#666;margin-left:8px">${n.createdAt||''}</small><div style="margin-top:6px">${escapeHtml(n.message||'')}</div>`;
        const actions = document.createElement('div');
        actions.style.marginTop = '6px';
        const del = document.createElement('button');
        del.textContent = 'Hapus';
        del.className = 'btn';
        del.style.color = '#b22222';
        del.addEventListener('click', async ()=>{
          if (!confirm('Hapus pengumuman ini?')) return;
          const r = await apiFetch('/api/admin/news/' + n.id, { method: 'DELETE' });
          if (r.ok) { loadNews(); alert('Dihapus'); } else { alert('Gagal'); }
        });
        actions.appendChild(del);
        el.appendChild(actions);
        container.appendChild(el);
      });
    } catch (e) { console.warn('loadNews failed', e); }
  }

  document.getElementById('createNewsBtn')?.addEventListener('click', async ()=>{
    const title = document.getElementById('newsTitle').value.trim();
    const message = document.getElementById('newsMessage').value.trim();
    const startAt = document.getElementById('newsStart').value || null;
    const endAt = document.getElementById('newsEnd').value || null;
    const dismissible = document.getElementById('newsDismissible').checked;
    if (!title || !message) return alert('Judul dan pesan diperlukan');
    try {
      const res = await apiFetch('/api/admin/news', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title, message, startAt, endAt, dismissible }) });
      if (!res.ok) { const d = await res.json(); return alert(d.error||'Gagal'); }
      document.getElementById('newsTitle').value = '';
      document.getElementById('newsMessage').value = '';
      document.getElementById('newsStart').value = '';
      document.getElementById('newsEnd').value = '';
      document.getElementById('newsDismissible').checked = false;
      loadNews();
      alert('Pengumuman dibuat');
    } catch (e) { alert('Gagal membuat'); }
  });

  // initialize news list
  loadNews();

  // --- admin tools actions ---
  async function loadFeatureFlags() {
    try {
      const res = await apiFetch('/api/admin/feature-flags');
      if (!res.ok) return;
      const flags = await res.json();
      document.getElementById('flagsList').textContent = JSON.stringify(flags, null, 2);
    } catch (e) { console.warn(e); }
  }

  document.getElementById('saveFlag')?.addEventListener('click', async ()=>{
    const key = document.getElementById('flagKey').value.trim();
    const val = document.getElementById('flagVal').value.trim();
    if (!key) return alert('Key required');
    await apiFetch('/api/admin/feature-flag', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key, value: val }) });
    document.getElementById('flagKey').value=''; document.getElementById('flagVal').value='';
    loadFeatureFlags();
  });

  // Member features UI loader & saver
  async function loadMemberFeatures() {
    try {
      const res = await apiFetch('/api/admin/feature-flags');
      if (!res.ok) return;
      const flags = await res.json();
      const list = flags.memberFeatures || {};
      const container = document.getElementById('memberFeaturesList');
      if (!container) return;
      container.innerHTML = '';
      Object.keys(list).forEach(k => {
        const val = !!list[k];
        const row = document.createElement('div');
        row.style.padding = '6px';
        row.innerHTML = `<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-key="${k}" ${val? 'checked':''}/> <strong style="min-width:220px">${k}</strong> <span style="color:#666;margin-left:8px">${val? 'Enabled':'Disabled'}</span></label>`;
        container.appendChild(row);
      });
    } catch (e) { console.warn('loadMemberFeatures failed', e); }
  }

  // Admin features UI loader & saver
  async function loadAdminFeatures() {
    try {
      const res = await apiFetch('/api/admin/feature-flags');
      if (!res.ok) return;
      const flags = await res.json();
      const list = flags.adminFeatures || {};
      const container = document.getElementById('adminFeaturesList');
      if (!container) return;
      container.innerHTML = '';
      Object.keys(list).forEach(k => {
        const val = !!list[k];
        const row = document.createElement('div');
        row.style.padding = '6px';
        row.innerHTML = `<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-key="${k}" ${val? 'checked':''}/> <strong style="min-width:220px">${k}</strong> <span style="color:#666;margin-left:8px">${val? 'Enabled':'Disabled'}</span></label>`;
        container.appendChild(row);
      });
    } catch (e) { console.warn('loadAdminFeatures failed', e); }
  }

  document.getElementById('saveAdminFeaturesBtn')?.addEventListener('click', async ()=>{
    const container = document.getElementById('adminFeaturesList'); if (!container) return alert('Panel fitur admin tidak ditemukan');
    const updates = {};
    Array.from(container.querySelectorAll('input[type="checkbox"][data-key]')).forEach(cb => { updates[cb.dataset.key] = !!cb.checked; });
    try {
      // Persist adminFeatures object
      await apiFetch('/api/admin/feature-flag', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key: 'adminFeatures', value: updates }) });
      loadFeatureFlags(); loadAdminFeatures();
      alert('Perubahan fitur admin disimpan');
    } catch (e) { alert('Gagal menyimpan fitur admin'); }
  });

  document.getElementById('saveMemberFeaturesBtn')?.addEventListener('click', async ()=>{
    const container = document.getElementById('memberFeaturesList'); if (!container) return alert('Panel fitur tidak ditemukan');
    const updates = {};
    Array.from(container.querySelectorAll('input[type="checkbox"][data-key]')).forEach(cb => { updates[cb.dataset.key] = !!cb.checked; });
    try {
      // Send the entire memberFeatures object in one request to avoid dotted-key storage
      await apiFetch('/api/admin/feature-flag', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key: 'memberFeatures', value: updates }) });
      loadFeatureFlags(); loadMemberFeatures();
      alert('Perubahan fitur member disimpan');
    } catch (e) { alert('Gagal menyimpan fitur member'); }
  });

  async function loadApiKeys() {
    try {
      const res = await apiFetch('/api/admin/api-keys');
      if (!res.ok) return;
      const keys = await res.json();
      document.getElementById('apiKeysList').textContent = JSON.stringify(keys, null, 2);
    } catch (e) { console.warn(e); }
  }

  document.getElementById('createApiKey')?.addEventListener('click', async ()=>{
    const ownerId = document.getElementById('apiOwner').value.trim();
    const scopes = (document.getElementById('apiScopes').value||'').split(',').map(s=>s.trim()).filter(Boolean);
    if (!ownerId) return alert('ownerId required');
    const res = await apiFetch('/api/admin/api-keys', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ownerId, scopes }) });
    if (!res.ok) { alert('Failed'); return; }
    document.getElementById('apiOwner').value=''; document.getElementById('apiScopes').value='';
    loadApiKeys();
  });

  async function loadSessions() {
    try {
      const res = await apiFetch('/api/admin/sessions');
      if (!res.ok) return;
      const s = await res.json();
      document.getElementById('sessionsList').textContent = JSON.stringify(s, null, 2);
    } catch (e) { console.warn(e); }
  }

  document.getElementById('refreshSessions')?.addEventListener('click', loadSessions);

  async function loadBackups() {
    try {
      const res = await apiFetch('/api/admin/backups');
      if (!res.ok) return;
      const b = await res.json();
      document.getElementById('backupsList').textContent = JSON.stringify(b, null, 2);
    } catch (e) { console.warn(e); }
  }

  document.getElementById('createBackupBtn')?.addEventListener('click', async ()=>{
    const name = document.getElementById('backupName').value.trim();
    const res = await apiFetch('/api/admin/backups/create', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
    if (!res.ok) { alert('Gagal membuat backup'); return; }
    document.getElementById('backupName').value = '';
    loadBackups();
  });

  // initial loads for admin tools
  loadFeatureFlags(); loadMemberFeatures(); loadAdminFeatures(); loadApiKeys(); loadSessions(); loadBackups();
  // IP allowlist
  async function loadIPAllow() {
    try {
      const res = await apiFetch('/api/admin/ip-allowlist'); if (!res.ok) return; const data = await res.json(); document.getElementById('ipAllowList').textContent = JSON.stringify(data, null, 2); document.getElementById('ipAllowText').value = (data.allow||[]).join('\n');
    } catch (e) { console.warn(e); }
  }
  document.getElementById('saveIpAllow')?.addEventListener('click', async ()=>{
    const lines = (document.getElementById('ipAllowText').value||'').split('\n').map(s=>s.trim()).filter(Boolean);
    const obj = { allow: lines, block: [] };
    const res = await apiFetch('/api/admin/ip-allowlist', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(obj) });
    if (res.ok) { loadIPAllow(); alert('Saved'); } else alert('Failed');
  });
  loadIPAllow();

  // Retention editor
  document.getElementById('saveRetention')?.addEventListener('click', async ()=>{
    const userId = document.getElementById('retUserId').value.trim();
    const days = Number(document.getElementById('retDays').value);
    if (!userId || !days) return alert('userId and days required');
    const res = await apiFetch('/api/admin/retention', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId, policy: { days } }) });
    if (res.ok) { alert('Saved'); } else { alert('Failed'); }
  });

  // Approvals
  async function loadApprovals() {
    try {
      const res = await apiFetch('/api/admin/approvals'); if (!res.ok) return; const list = await res.json(); document.getElementById('approvalsList').textContent = JSON.stringify(list, null, 2);
    } catch (e) { console.warn(e); }
  }
  document.getElementById('createApproval')?.addEventListener('click', async ()=>{
    const action = document.getElementById('apprAction').value.trim();
    const target = document.getElementById('apprTarget').value.trim();
    if (!action || !target) return alert('action and target required');
    const res = await apiFetch('/api/admin/approvals', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action, payload: { userId: target }, required: 2 }) });
    if (res.ok) { document.getElementById('apprAction').value=''; document.getElementById('apprTarget').value=''; loadApprovals(); alert('Request dibuat'); } else alert('Gagal');
  });
  // quick approve by selecting id in input (use browser console to call approve)
  loadApprovals();

  // Impersonation
  document.getElementById('impersonateBtn')?.addEventListener('click', async ()=>{
    const id = document.getElementById('impersonateUserId').value.trim(); if (!id) return alert('userId required');
    const res = await apiFetch('/api/admin/impersonate/' + id, { method: 'POST' });
    if (res.ok) { alert('Sekarang impersonating ' + id); } else { const d = await res.json(); alert(d.error||'Failed'); }
  });
  document.getElementById('stopImpersonateBtn')?.addEventListener('click', async ()=>{
    const res = await apiFetch('/api/admin/impersonate/stop', { method: 'POST' });
    if (res.ok) alert('Kembali ke akun asli'); else alert('Failed');
  });

  // Plugins, SLAs, Templates, Audit, 2FA
  async function loadPlugins() { try { const res = await apiFetch('/api/admin/plugins'); if (!res.ok) return; const p = await res.json(); document.getElementById('pluginsList').textContent = JSON.stringify(p, null, 2); } catch (e) { console.warn(e); } }
  document.getElementById('savePlugin')?.addEventListener('click', async ()=>{ const name = document.getElementById('pluginName').value.trim(); if (!name) return alert('name'); const res = await apiFetch('/api/admin/plugins', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) }); if (res.ok) { document.getElementById('pluginName').value=''; loadPlugins(); } else alert('Failed'); });
  loadPlugins();

  async function loadSlas() { try { const res = await apiFetch('/api/admin/slas'); if (!res.ok) return; const s = await res.json(); document.getElementById('slasList').textContent = JSON.stringify(s, null, 2); } catch (e) { console.warn(e); } }
  document.getElementById('saveSla')?.addEventListener('click', async ()=>{ const name = document.getElementById('slaName').value.trim(); if (!name) return alert('name'); const res = await apiFetch('/api/admin/slas', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name }) }); if (res.ok) { document.getElementById('slaName').value=''; loadSlas(); } else alert('Failed'); });
  loadSlas();

  async function loadTemplates() { try { const res = await apiFetch('/api/admin/templates'); if (!res.ok) return; const t = await res.json(); document.getElementById('templatesList').textContent = JSON.stringify(t, null, 2); } catch (e) { console.warn(e); } }
  document.getElementById('saveTemplate')?.addEventListener('click', async ()=>{ const title = document.getElementById('templateName').value.trim(); if (!title) return alert('title'); const res = await apiFetch('/api/admin/templates', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, body: '' }) }); if (res.ok) { document.getElementById('templateName').value=''; loadTemplates(); } else alert('Failed'); });
  loadTemplates();

  async function loadAudit() { try { const res = await apiFetch('/api/admin/audit'); if (!res.ok) return; const a = await res.json(); document.getElementById('auditList').textContent = JSON.stringify(a.slice().reverse().slice(0,200), null, 2); } catch (e) { console.warn(e); } }
  document.getElementById('refreshAudit')?.addEventListener('click', loadAudit);
  loadAudit();

  document.getElementById('set2fa')?.addEventListener('click', async ()=>{
    const id = document.getElementById('2faUserId').value.trim();
    const secret = document.getElementById('2faSecret').value.trim();
    const enabled = !!document.getElementById('2faEnable').checked;
    if (!id) return alert('userId required');
    const res = await apiFetch('/api/admin/2fa/user/' + id, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ enabled, secret }) });
    if (res.ok) { alert('2FA updated'); } else alert('Failed');
  });
  document.getElementById('generate2fa')?.addEventListener('click', async ()=>{
    const id = document.getElementById('2faUserId').value.trim();
    if (!id) return alert('userId required');
    const res = await apiFetch('/api/admin/2fa/generate/' + id, { method: 'POST' });
    if (!res.ok) { const d = await res.json(); return alert(d.error||'Failed'); }
    const data = await res.json();
    // show QR in modal
    const modal = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    content.innerHTML = `<h3>QR for ${id}</h3><img src="${data.qr}" style="max-width:240px"/><div style="margin-top:8px">Secret: <code>${data.secret}</code></div>`;
    const close = document.createElement('button'); close.textContent='Tutup'; close.addEventListener('click', ()=>{ modal.style.display='none'; }); content.appendChild(close);
    modal.style.display = 'flex';
  });
  // Privacy & Terms management
  async function loadPolicies() {
    try {
      const p = await apiFetch('/api/admin/policy/privacy');
      if (p.ok) { const d = await p.json(); document.getElementById('privacyEditor').value = d.content || ''; }
    } catch(e){}
    try {
      const t = await apiFetch('/api/admin/policy/terms');
      if (t.ok) { const d = await t.json(); document.getElementById('termsEditor').value = d.content || ''; }
    } catch(e){}
  }
  document.getElementById('savePrivacyBtn')?.addEventListener('click', async ()=>{
    const content = document.getElementById('privacyEditor').value;
    const res = await apiFetch('/api/admin/policy/privacy', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content }) });
    if (res.ok) alert('Saved'); else alert('Failed');
    loadPolicies();
  });
  document.getElementById('delPrivacyBtn')?.addEventListener('click', async ()=>{
     if (!confirm('Hapus privacy policy?')) return; const res = await apiFetch('/api/admin/policy/privacy', { method: 'DELETE' }); if (res.ok) { alert('Deleted'); loadPolicies(); } else alert('Failed');
  });
  document.getElementById('saveTermsBtn')?.addEventListener('click', async ()=>{
    const content = document.getElementById('termsEditor').value;
    const res = await apiFetch('/api/admin/policy/terms', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content }) });
    if (res.ok) alert('Saved'); else alert('Failed');
    loadPolicies();
  });
  document.getElementById('delTermsBtn')?.addEventListener('click', async ()=>{
    if (!confirm('Hapus terms?')) return; const res = await apiFetch('/api/admin/policy/terms', { method: 'DELETE' }); if (res.ok) { alert('Deleted'); loadPolicies(); } else alert('Failed');
  });
  loadPolicies();

  // Broadcast / Scheduler handlers
  async function loadScheduled() {
    try {
      const res = await apiFetch('/api/admin/scheduled'); if (!res.ok) return; const list = await res.json();
      const container = document.getElementById('scheduledList'); if (!container) return;
      container.innerHTML = '';
      if (!list || list.length === 0) { container.textContent = 'Tidak ada pesan terjadwal'; return; }
      list.sort((a,b)=> new Date(a.sendAt)-new Date(b.sendAt));
      list.forEach(s => {
        const el = document.createElement('div'); el.style.borderBottom='1px solid #eee'; el.style.padding='6px';
        el.innerHTML = `<div style="font-weight:600">${escapeHtml(s.content.slice(0,100))}</div><small style="color:#666">Kirim: ${s.sendAt} | Broadcast: ${s.broadcast? 'ya':'tidak'}</small> <div style="text-align:right;margin-top:6px"><button class="btn-cancel" data-id="${s.id}">Batal</button></div>`;
        container.appendChild(el);
      });
      container.querySelectorAll('.btn-cancel').forEach(b=>{ b.addEventListener('click', async ()=>{ const id=b.dataset.id; if(!confirm('Batalkan jadwal ini?')) return; const r=await apiFetch('/api/admin/scheduled/cancel',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) }); if (r.ok) { alert('Dibatalkan'); loadScheduled(); } else { const d=await r.json(); alert(d.error||'Gagal'); } }); });
    } catch (e) { console.warn('loadScheduled failed', e); }
  }

  document.getElementById('sendBroadcastBtn')?.addEventListener('click', async ()=>{
    const content = (document.getElementById('broadcastContent').value||'').trim(); if (!content) return alert('Isi diperlukan');
    if (!confirm('Kirim broadcast ke semua pengguna sekarang?')) return;
    try {
      const r = await apiFetch('/api/admin/broadcast', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content }) });
      if (!r.ok) { const d = await r.json(); return alert(d.error||'Gagal'); }
      alert('Broadcast dikirim'); document.getElementById('broadcastContent').value='';
    } catch (e) { alert('Gagal'); }
  });

  document.getElementById('scheduleMsgBtn')?.addEventListener('click', async ()=>{
    const content = (document.getElementById('broadcastContent').value||'').trim(); const sendAt = document.getElementById('scheduleAt').value;
    if (!content || !sendAt) return alert('Isi dan waktu diperlukan');
    try {
      const r = await apiFetch('/api/admin/schedule-message', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ content, sendAt, broadcast: true }) });
      if (!r.ok) { const d = await r.json(); return alert(d.error||'Gagal'); }
      alert('Pesan dijadwalkan'); document.getElementById('broadcastContent').value=''; document.getElementById('scheduleAt').value=''; loadScheduled();
    } catch (e) { alert('Gagal'); }
  });

  // Cancel scheduled (simple POST endpoint)
  // create endpoint handler in server: POST /api/admin/scheduled/cancel
  loadScheduled();
});
