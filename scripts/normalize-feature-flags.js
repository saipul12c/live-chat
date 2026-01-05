const fs = require('fs').promises;
const path = require('path');

async function main() {
  const file = path.join(__dirname, '..', 'data', 'feature_flags.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const src = JSON.parse(raw || '{}');

    // Build normalized object: process non-dotted keys first, then dotted keys to allow overrides
    const normalized = {};

    const entries = Object.entries(src);
    for (const [k, v] of entries.filter(([k]) => !k.includes('.'))) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        normalized[k] = Object.assign({}, normalized[k] || {}, v);
      } else {
        normalized[k] = v;
      }
    }

    function setNested(obj, keyPath, value) {
      const parts = keyPath.split('.');
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
      cur[parts[parts.length - 1]] = value;
    }

    for (const [k, v] of entries.filter(([k]) => k.includes('.'))) {
      setNested(normalized, k, v);
    }

    // Backup original
    const bakPath = file + '.bak.' + Date.now().toString();
    await fs.writeFile(bakPath, JSON.stringify(src, null, 2));
    console.log('Backup written to', bakPath);

    // Write normalized
    await fs.writeFile(file, JSON.stringify(normalized, null, 2));
    console.log('Normalized feature flags written to', file);
    console.log('Done.');
  } catch (e) {
    console.error('Migration failed', e);
    process.exit(1);
  }
}

if (require.main === module) main();
