# WeKeepIt 📌

**WeKeepIt** adalah aplikasi personal work board dan knowledge retrieval yang ringan, lokal, modular, dan cepat.

Aplikasi ini mengintegrasikan dua domain utama dalam satu antarmuka yang bersih:
1. **📋 Work Board (V1)** — Papan kerja pribadi untuk menyimpan informasi kecil yang sering dibutuhkan (kartu catatan, link akses, multi-tag filter, metadata dinamis, checklist harian, pengingat otomatis, dan mode widget).
2. **📁 Document Library & Search (V2)** — Mesin pengindeksan dan pencarian teks penuh lokal untuk dokumen **`.md`**, **`.pdf`**, **`.docx`**, dan **`.xlsx`** dengan SQLite FTS5, pelestarian lokasi sumber (halaman, heading, sheet, sel), dan toleransi pencarian kalimat tanpa urutan kata yang kaku.

---

## ✨ Fitur Utama

### A. Work Board (Fitur V1 yang Dipertahankan Penuh)
- **Kartu Catatan & Papan Sematan**: Catatan fleksibel dengan warna aksen kustom, badge pin, dan tag berwarna.
- **Filter Multi-Tag Lanjutan (`link+role`)**:
  - Operator **AND** dengan simbol `+` (contoh: `link+role` memfilter kartu yang memiliki kedua tag).
  - Operator **OR** dengan simbol koma `,` (contoh: `link, role`).
  - Quick tag bar interaktif untuk menggabungkan tag secara langsung.
- **Metadata Dinamis**: Konfigurasi skema field tanpa hardcode melalui antarmuka (Link/URL, Role, Dropdown Environment, Prioritas, PIC).
- **Daily Checklist & Reminders**: Checklist to-do harian dengan bilah persentase, live countdown, notifikasi desktop, dan synthesizer audio Web Audio API.
- **Mode Tampilan**: Grid normal, mode kompak, tema dark solid, tema dark acrylic (glassmorphism), dan mode widget ringkas.
- **Penyimpanan Lokal & Backup**: Data tersimpan ke `wekeepit-data.json`, didukung ekspor dan impor file JSON.

### B. Document Library & Search (Fitur Baru V2)
- **Format Dokumen yang Didukung**:
  - 📄 **Markdown (`.md`)**: Ekstraksi hierarki heading (`H1`, `H2`, `H3`), paragraf teks, nomor baris, dan breadcrumb lokasi.
  - 📕 **PDF (`.pdf`)**: Ekstraksi teks per halaman dengan nomor halaman akurat (`Hal 1`, `Hal 2`), penanganan aman untuk PDF hasil scan (notifikasi OCR belum tersedia).
  - 📘 **Word (`.docx`)**: Ekstraksi paragraf, heading, dan tabel dokumen OpenXML.
  - 📊 **Excel (`.xlsx`)**: Ekstraksi nilai teks sel dengan koordinat sheet dan sel (`Sheet: Ringkasan, Sel: B2`) serta pengelompokan baris data, dengan isolasi sheet tersembunyi.
- **Mode Pencarian**:
  - **Mode A — Exact Phrase (Frasa Tepat)**: Menemukan kalimat yang memuat urutan kata persis sama (contoh: `"personal work board"`).
  - **Mode B — All Terms Unordered (Semua Kata dalam 1 Kalimat)**: Menemukan kalimat atau unit teks yang memuat seluruh kata kunci tanpa memandang urutan kata, dilengkapi toleransi saltik (Levenshtein distance $\le 1$).
    > *Contoh:* Query `weekeepit cocok` menemukan kalimat:
    > *"WeKeepIt lebih cocok sebagai personal work information board."*
    > *Catatan Integritas:* Kata-kata yang dicari wajib cocok pada unit teks atau kalimat yang sama; sistem **tidak** menggabungkan kata yang tersebar di halaman berbeda.
- **Search Scope**:
  - 🌐 **Semua (`all`)**: Mencari di kartu Work Board dan seluruh dokumen lokal sekaligus.
  - 📋 **Board (`board`)**: Khusus memfilter kartu Work Board.
  - 📁 **Dokumen (`documents`)**: Khusus mencari isi berkas dokumen lokal.
- **Kutipan & Lokasi Sumber Akurat**:
  - Snippet cuplikan teks dengan penanda highlight `<mark class="search-highlight">kata</mark>`.
  - Lokasi sumber yang jelas (nomor halaman PDF, heading Markdown/DOCX, atau nama sheet dan sel Excel).
  - Tombol aksi langsung: **📂 Buka Berkas** (membuka file pada aplikasi default) dan **📍 Buka Folder** (menampilkan lokasi berkas di Windows Explorer).
- **Manajemen Folder Terindeks**:
  - Tambah folder lokal secara manual dengan pemindaian rekonsiliasi rekursif.
  - Pengaturan daftar pengecualian folder/berkas (default: `.git`, `node_modules`, `bin`, `obj`, `temp`).
  - Sakelar aktifkan/nonaktifkan folder tanpa menghapus data indeks.
  - Pemindaian rekonsiliasi inkremental: mendeteksi berkas baru, berkas berubah (berdasarkan ukuran, mtime, dan hash SHA-256), berkas dihapus, dan berkas tidak berubah. Berkas yang tidak berubah **tidak akan diproses ulang**.
  - Perlindungan berkas: Berkas asli pada disk bersifat *read-only* bagi indexer dan **tidak pernah diubah atau dihapus**.

---

## 🏗️ Prinsip Arsitektur

- **Local-first & Privacy-first**: Data kartu, database indeks dokumen, dan pencarian berjalan 100% lokal di komputer pengguna tanpa mengirim teks dokumen ke API cloud eksternal.
- **Pemisahan Penyimpanan Data**:
  - Data kartu Work Board disimpan terpisah di `wekeepit-data.json`.
  - Indeks teks dokumen dan metadata pencarian disimpan di database SQLite lokal berkecepatan tinggi `wekeepit-index.db` dengan WAL (*Write-Ahead Logging*) dan FTS5 (*Full-Text Search*).
  - Isi teks lengkap dokumen tidak pernah disalin berulang ke dalam `wekeepit-data.json`.
- **Isolasi Error & Fault Tolerance**: Kegagalan ekstraksi pada satu berkas (misal file terkunci atau arsip rusak) dicatat pada status dokumen dan tidak akan menghentikan pemindaian berkas-berkas lainnya.
- **Ketersediaan Konkurensi**: Pencarian dokumen tetap dapat dilakukan secara bersamaan saat proses pemindaian folder di latar belakang sedang berjalan.

---

## 🚀 Panduan Menjalankan

### Persyaratan Sistem
- Windows 10/11
- Node.js versi 18+ (direkomendasikan Node.js 20 atau 22)

### Instalasi Dependensi
Jalankan perintah berikut di folder proyek untuk menginstal dependensi SQLite lokal:
```bash
npm install
```

### Menjalankan Server Lokal & Aplikasi
```bash
npm start
```
Buka peramban (browser) di alamat: **`http://localhost:4321`**

### Menjalankan Mode Desktop Windows
Cukup klik ganda salah satu file skrip:
- **`launch-desktop.bat`**: Membuka server dan menjalankan jendela aplikasi desktop tanpa bilah URL browser.
- **`launch-silent.vbs`**: Menjalankan aplikasi secara hening di latar belakang.

---

## 🧪 Pengujian Otomatis (Automated Testing)

WeKeepIt V2 dilengkapi dengan rangkaian tes unit, integrasi, regresi V1, dan benchmark performa menggunakan runner bawaan `node:test`:

```bash
npm test
```

### Lingkup Pengujian:
1. **`v1-regression.test.js`**:
   - Integritas query parsing multi-tag (`link+role`, `link, role`).
   - Logika reminder, snooze, advance countdown, dan checklist status.
   - Integritas file data `wekeepit-data.json` dan `metadata-schema.json`.
2. **`parsers.test.js`**:
   - Ekstraksi Markdown (heading hierarchy, breadcrumbs, nomor baris).
   - Ekstraksi PDF (halaman teks akurat, deteksi PDF hasil scan).
   - Ekstraksi DOCX (paragraf, heading, tabel).
   - Ekstraksi XLSX (sheet, koordinat sel, row grouping, isolasi hidden sheet).
3. **`database-and-folders.test.js`**:
   - Migrasi skema SQLite dan inisialisasi tabel FTS5.
   - Rekonsiliasi folder inkremental (berkas baru, berubah, dihapus, tidak berubah).
   - Pengecualian direktori sistem, aplikasi, dan daftar kecualian pengguna.
4. **`search-engine.test.js`**:
   - Pencarian Mode A (Exact Phrase matching).
   - Pencarian Mode B (All Terms Unordered strictly in the same sentence/chunk).
   - Toleransi saltik (*Levenshtein distance* $\le 1$).
   - Pembuatan snippet aman dari serangan XSS.
5. **`server-api.test.js`**:
   - Pengujian integrasi endpoint REST API: `/api/cards`, `/api/folders`, `/api/indexer/status`, `/api/indexer/scan`, `/api/search`, `/api/open-file`.
6. **`document-indexer.test.js`**:
   - Isolasi kegagalan parser (berkas rusak tidak menghentikan antrean).
   - Penanganan berkas kosong (0-byte).
   - Benchmark throughput pengindeksan dan latensi pencarian (< 50ms).

---

## 📂 Struktur Repositori

```
wekeepit/
├── index.html                     # Antarmuka V2: Work Board, Document Library & Search
├── style.css                      # Tema dark modern, styling card, tabs, table, highlight
├── app.js                         # Frontend controller: V1 board & V2 document/search views
├── server.js                      # Server HTTP backend lokal & REST API
│
├── indexer/                       # Modul Pencarian & Pengindeksan Dokumen (V2)
│   ├── db.js                      # Abstraksi database SQLite (WAL, migrasi, FTS5)
│   ├── folder-manager.js          # Pemindaian direktori, rekonsiliasi & watcher
│   ├── document-indexer.js        # Antrean indexing, progress emitter & error isolation
│   ├── search-engine.js           # Mesin pencari Mode A & B, snippet & highlighter
│   └── parsers/                   # Adapter parser per format dokumen
│       ├── index.js               # Registry parser adapter
│       ├── markdown-parser.js     # Parser berkas .md
│       ├── pdf-parser.js          # Parser berkas .pdf (via PDF.js)
│       ├── docx-parser.js         # Parser berkas .docx (via Mammoth)
│       └── xlsx-parser.js         # Parser berkas .xlsx (via SheetJS)
│
├── lib/                           # Library client/offline bundle
│   ├── pdf.min.js                 # PDF.js runtime
│   ├── mammoth.browser.min.js     # Mammoth runtime
│   └── xlsx.mini.min.js           # SheetJS runtime
│
├── docs/                          # Dokumentasi Arsitektur
│   └── V2-IMPLEMENTATION-PLAN.md  # Spesifikasi teknis & audit V2
│
├── test/                          # Rangkaian Automated Tests
│   ├── database-and-folders.test.js
│   ├── document-indexer.test.js
│   ├── parsers.test.js
│   ├── search-engine.test.js
│   ├── server-api.test.js
│   └── v1-regression.test.js
│
├── metadata-schema.json           # Skema metadata kartu dinamis
├── wekeepit-data.json             # Berkas penyimpanan kartu Work Board
├── package.json                   # Konfigurasi npm & test script
├── launch-desktop.bat             # Peluncur desktop Windows
└── launch-silent.vbs              # Peluncur hening di latar belakang
```

---

## 🔒 Privasi & Keamanan Data

- Seluruh pemrosesan teks, pembuatan token, dan indeks dokumen berjalan secara lokal di perangkat Anda.
- Tidak ada data dokumen yang dikirim ke jaringan internet atau cloud API.
- Proses indexing hanya memiliki izin baca (*read-only*) terhadap file dokumen asli Anda.
