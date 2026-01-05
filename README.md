# Room Chat

Ringkasan
--
Room Chat adalah aplikasi percakapan sederhana dengan antarmuka web dan dukungan API eksternal. Proyek menyediakan:
- Client-side end-to-end encryption (E2E) untuk pesan
- UI web (login, chat, profil, admin)
- API berbasis JWT untuk klien non-browser
- Fitur admin: audit, approvals, session management, backup

Fitur utama
--
- E2E: enkripsi/dekripsi di klien menggunakan `public/js/crypto.js` (AES-GCM)
- Autentikasi: sesi berbasis cookie (web) dan JWT untuk API eksternal
- Pengiriman/terima pesan via Socket.IO
- Penghapusan pesan / penghapusan chat
- Pesan terjadwal (scheduler)
- Dukungan 2FA TOTP (opsional)

Persyaratan
--
- Node.js (>= 16)
- npm

Instalasi
--
1. Install dependensi:

```bash
npm install
```

Menjalankan aplikasi
--
- Jalankan server di lingkungan development:

```bash
npm start
```

- Default port: `3000` (override dengan `PORT`), contoh:

```bash
PORT=4000 npm start
```

Environment variables penting
--
- `PORT` — port HTTP (default 3000)
- `JWT_SECRET` — secret untuk menandatangani token JWT
- `SESSION_SECRET` — secret untuk session cookies

Menjalankan tes
--
Tes unit menggunakan Mocha:

```bash
npm test
```

API singkat (eksternal, JWT)
--
- `POST /api/token` — terbitkan JWT dari username/password (lihat contoh di bawah)
- `POST /api/send-message` — kirim pesan (gunakan `Authorization: Bearer <JWT>`)
- `POST /api/delete-message` — hapus pesan (hanya pengirim)
- `POST /api/delete-chat` — hapus seluruh chat antara dua user

Contoh: ambil token (curl)

```bash
curl -X POST http://localhost:3000/api/token \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret"}'
```

Contoh: kirim pesan via API

```bash
curl -X POST http://localhost:3000/api/send-message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"receiverId":"<otherUserId>","content":"Hello from API","isEncrypted":false}'
```

UI Web
--
- Buka `http://localhost:3000/login.html` lalu masuk untuk memakai UI chat. Halaman yang tersedia ada di `public/html`.

Struktur proyek (ringkasan)
--
- `server.js` — server Express + Socket.IO dan API
- `public/` — aset klien (HTML, JS, CSS, images)
- `data/` — penyimpanan JSON untuk data runtime (users, messages, settings)
- `utils/database.js` — helper penyimpanan dan abstraksi data
- `scripts/` — test dan utilitas pengembangan
- `package.json` — metadata & perintah npm

Catatan keamanan & operasional
--
- Saat ini sesi default menggunakan store in-memory; jangan gunakan ini di produksi. Pertimbangkan `session-file-store` atau Redis.
- Simpan `JWT_SECRET` dan `SESSION_SECRET` di environment (tidak di repositori).
- E2E saat ini berbasis passphrase per pasangan chat — sharing passphrase harus dilakukan out-of-band.

Kontribusi
--
- Periksa `scripts/` untuk contoh test. Buat branch, buat PR, sertakan test untuk fungsionalitas baru.

Lisensi
--
ISC

Catatan terakhir
--
Jika ingin saya perbarui README dengan detail tambahan (diagram arsitektur, contoh payload lebih lengkap, atau panduan deploy ke production), beri tahu saya fitur mana yang ingin ditambahkan.

Total files in repository: 55
