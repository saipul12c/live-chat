document.addEventListener('DOMContentLoaded', async () => {
  try {
  const res = await fetch('/api/news', { credentials: 'same-origin' });
    if (!res.ok) return;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return;

    const now = Date.now();
    // filter active items by start/end if provided
    const active = items.filter(it => {
      const s = it.startAt ? new Date(it.startAt).getTime() : null;
      const e = it.endAt ? new Date(it.endAt).getTime() : null;
      if (s && now < s) return false;
      if (e && now > e) return false;
      return true;
    });
    if (active.length === 0) return;

    // show latest by createdAt or id
    active.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
    const latest = active[0];

    // respect dismissal if dismissible
    if (latest.dismissible) {
      const dismissed = localStorage.getItem('news:dismissed:' + latest.id);
      if (dismissed) return;
    }

    showNewsPopup(latest);
  } catch (e) {
    console.warn('news load failed', e);
  }
});

function showNewsPopup(item) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.background = 'rgba(0,0,0,0.5)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '9999';

  const box = document.createElement('div');
  box.style.background = '#fff';
  box.style.padding = '18px';
  box.style.borderRadius = '8px';
  box.style.maxWidth = '720px';
  box.style.width = '90%';
  box.style.boxShadow = '0 6px 24px rgba(0,0,0,0.2)';

  const title = document.createElement('h3');
  title.textContent = item.title || 'Pengumuman';
  title.style.marginTop = '0';

  const msg = document.createElement('div');
  msg.innerHTML = (item.message || '').replace(/\n/g, '<br>');
  msg.style.margin = '8px 0 12px';

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.gap = '8px';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Tutup';
  closeBtn.className = 'btn';
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  footer.appendChild(closeBtn);

  if (item.dismissible) {
    const dontShow = document.createElement('button');
    dontShow.textContent = "Jangan tampilkan lagi";
    dontShow.className = 'btn';
    dontShow.addEventListener('click', () => {
      localStorage.setItem('news:dismissed:' + item.id, '1');
      document.body.removeChild(overlay);
    });
    footer.appendChild(dontShow);
  }

  box.appendChild(title);
  box.appendChild(msg);
  box.appendChild(footer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
