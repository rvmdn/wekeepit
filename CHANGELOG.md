# Changelog

Semua perubahan penting pada proyek **WeKeepIt** akan dicatat dalam berkas ini.
Format ini mengacu pada [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan mengikuti standar [Semantic Versioning](https://semver.org/).

---

## [2.4.0] - 2026-11-26

### Ditambahkan (Added)
- **Arsitektur Multi-User Role & Adaptive RBAC (Admin, Editor, Viewer)**: Dukungan multi-pengguna adaptif untuk transisi deployment dari desktop Windows lokal ke server Linux terpusat (RHEL / Rocky / Ubuntu / Docker).
  - **Mode Desktop Bebas Hambatan (Zero-Friction)**: Saat berjalan secara lokal pada Windows (`AUTH_ENABLED=false` bawaan), aplikasi tidak meminta kredensial apa pun dan langsung dapat digunakan sebagai pemilik tunggal secara mulus.
  - **Mode Server Terautentikasi (`AUTH_ENABLED=true`)**: Mengaktifkan modal login modern bertema dark acrylic, manajemen token sesi aman berbasis cookie HTTP-Only, dan pemetaan peran pengguna (*Role-Based Access Control*):
    - `Admin`: Akses penuh mencakup mutasi kartu, skema metadata, indexing folder dokumen, dan manajemen akun pengguna.
    - `Editor`: Hak baca, tambah, dan edit catatan, alur kerja Kanban, checklist, dan komentar.
    - `Viewer`: Mode pratinjau baca-saja (*read-only*), memblokir mutasi penambahan/pengubahan data, menonaktifkan aksi drag-and-drop, dan menampilkan banner pratinjau di bagian atas halaman.
  - **Kriptografi Password Standar Native**: Menggunakan algoritma hash PBKDF2 dengan salt 16-byte (100.000 iterasi SHA-512) dari pustaka inti Node.js (`crypto`), tanpa ketergantungan library eksternal C++ yang rentan gagal kompilasi pada server Linux.
  - **Akun Bawaan Siap Pakai**: Otomatis menginisialisasi akun `admin` (admin123), `editor` (editor123), dan `viewer` (viewer123) saat pertama kali server dijalankan.
- **Paket Konfigurasi Deployment Server RHEL / Linux (`deploy/`)**:
  - `deploy/wekeepit.service`: Unit file Systemd untuk manajemen service otomatis, restart on-failure, dan isolasi pengguna `wekeepit`.
  - `deploy/nginx-wekeepit.conf`: Template reverse proxy Nginx siap pakai dengan konfigurasi WebSocket, buffering, dan limit body file besar (50MB).
  - `deploy/.env.example`: Contoh konfigurasi environment variabel produksi server.
  - `deploy/README-SERVER-DEPLOYMENT.md`: Dokumentasi panduan komprehensif deployment dari instalasi Node.js, kompilasi C++ SQLite, firewalld, hingga konfigurasi SELinux di RHEL.
- **Table / Database View (Notion-Style Spreadsheet)**: Sudut pandang ke-4 pada alur kerja (`📑 Tabel`) berbentuk tabel data padat dengan kolom *Judul Tugas*, *Status*, *Prioritas*, *Tenggat / Waktu*, *Checklist*, *Tags*, dan *Aksi*. Dilengkapi pengurutan interaktif (klik header untuk sortir naik/turun dengan indikator ▲/▼) serta filter pencarian instan pada tabel.
- **Kotak Arsip & Sampah (Soft Delete & Restore)**: Mencegah kehilangan data catatan penting akibat klik hapus tidak sengaja. Klik tombol 🗑️ kini memindahkan kartu secara aman ke Kotak Arsip & Sampah (`archived: true`). Pengguna dapat membuka modal `📦 Arsip` melalui tombol header untuk memulihkan kartu (*Restore*), menghapus secara permanen, atau mengosongkan semua sampah (*Empty Trash*).
- **Indikator Prioritas First-Class (Trello/Notion Style)**: Menambahkan tingkat prioritas visual (`🔥 Urgent / P0`, `⚡ High / P1`, `📌 Medium / P2`, `☕ Low / P3`) dengan badge berkode warna di header kartu, penanda garis aksen 3.5px di sisi kiri kartu, indikator pada sidebar Timeline Gantt, dan chip Kalender.
- **Selector Prioritas Terintegrasi**: Dropdown pemilihan prioritas langsung di modal editor kartu untuk Catatan Notice Board maupun Tugas Kanban Flow, dengan sinkronisasi otomatis ke skema metadata tanpa duplikasi tampilan baris.
- **Checklist Progress Bar Visual (Trello-Style)**: Bilah progres checklist modern dengan track 6px, transisi halus, badge persentase penyelesaian (`☑️ 3/5 (60%)`), dan indikator hijau emerald (`✅ 5/5`) saat semua item checklist rampung.
- **Pemisahan Domain Notice Board & Kanban Flow**: Memisahkan secara tegas catatan referensi murni (`📌 Notice Board`) dari tugas alur kerja (`⚡ Kanban Flow`). Catatan referensi Notice Board tidak lagi tercampur atau dipaksa memiliki status `todo`.
- **Kanban Board View (Notion-style)**: 5 swimlane status alur kerja (`Backlog`, `To Do`, `In Progress`, `Review`, `Done`) dengan interaksi drag-and-drop native HTML5 yang intuitif, sinkronisasi posisi otomatis, dan penghitung kartu per kolom.
- **Timeline Gantt Chart View (`📊 Timeline`)**: Visualisasi rentang waktu pengerjaan tugas (`startDate` s.d. `dueDate`) dengan sliding window 14 hari, bilah horizontal interaktif berkode warna status, penanda hari ini (*today indicator*), serta tombol navigasi tanggal (*Hari Ini*, *Mundur*, *Maju*).
- **Monthly Calendar Grid View (`📅 Kalender`)**: Tampilan kalender bulanan 7-hari dengan chip tugas ber-status, indikator tanggal hari ini, dan kemampuan klik langsung pada tanggal untuk membuat tugas baru dengan tanggal mulai terisi otomatis.
- **Form Pemilih Domain & Rentang Tanggal**: Pada modal tambah/edit kartu, pengguna dapat memilih sasaran kartu (`📌 Catatan Notice Board` vs `⚡ Tugas Kanban Flow`), memilih status awal, serta menentukan `Tanggal Mulai` dan `Tenggat Waktu` secara opsional.
- **Empty State & Quick Actions**: Menyediakan panduan visual dan tombol *Buat Tugas Baru* di tampilan Kanban, Timeline, dan Kalender saat belum ada tugas aktif.

---

## [2.2.0] - 2026-11-26

### Diperbaiki (Fixed)
- **Dynamic Centering & Viewport Containment Modal**: Menghapus `backdrop-filter: blur(28px)` pada `body.theme-acrylic` yang memicu W3C CSS containing block bug (di mana fixed overlay melebar mengikuti tinggi total dokumen ribuan piksel).
- **Penetapan Viewport Modal Overlay**: Memastikan `.modal-overlay` menggunakan ukuran pasti `100vw` dan `100vh` dengan `max-height: 100vh`, `overflow: hidden`, dan `display: flex; align-items: center; justify-content: center;` untuk pemusatan pixel-perfect di semua resolusi layar (laptop, desktop, ultrawide).
- **Pencegahan Scroll Jump Saat Modal Buka**: Menambahkan `{ preventScroll: true }` pada pemanggilan `.focus()` saat modal dibuka agar halaman latar belakang tidak melompat.
- **Hoisting Helper Modal ke Global Module Scope**: Mengangkat fungsi `showModalOverlay()`, `hideModalOverlay()`, dan `triggerStaticModal()` ke module scope teratas di `app.js` untuk mencegah `ReferenceError` saat pembukaan modal.
- **Pembersihan Metadata URL pada Catatan**: Menormalkan skema kartu agar tautan URL tersimpan rapi di field `metadata.url` tanpa mengotori teks isi catatan.

---

## [2.1.1] - 2026-11-09

### Diperbaiki (Fixed)
- **Tampilan Field Judul Catatan**: Memperbaiki bug pada modal card editor di mana input judul (*formTitle*) terjepit dan mengecil secara drastis akibat konflik flexbox dengan container sematkan (*pin*). Input judul kini tampil lebar penuh (100%) simetris dengan textarea isi catatan, dengan checkbox `📌 Pin` diposisikan secara rapi dan selaras di baris header label kanan (`.form-label-row`).
- **Scroll & Overflow Modal Card Editor**: Memperbaiki bug di mana opsi tambahan (*Metadata Kustom*, *Lampiran Dokumen*, *Checklist*, dan *Pengingat*) terpotong di bagian bawah tanpa memunculkan bilah scroll (*no scrollbar*). Masalah ini diselesaikan dengan menerapkan `flex-shrink: 0` pada elemen anak `.modal-body` dan `.form-group-collapsible` guna mencegah Flexbox menciutkan kontainer yang meluap, menaikkan batas `max-height` modal menjadi `min(92vh, 800px)` agar lebih lega di layar modern, serta meningkatkan kontras indikator scrollbar visual.
- **Auto Smooth Scroll Kategori**: Menambahkan navigasi *auto smooth scroll* saat pengguna memilih tipe catatan tertentu pada dropdown "Mau simpan apa?" sehingga antarmuka otomatis bergeser menampilkan bagian form collapsible yang relevan.
- **Kekokohan Form Row Flexbox**: Memperbaiki deklarasi `.form-row > .form-group` dan `.form-row > .flex-1` secara global dengan `width: auto` dan `min-width: 0` untuk mencegah regresi penyusutan input pada baris form lainnya.

---

## [2.1.0] - 2026-10-30

### Ditambahkan (Added)
- **Mode Kanvas Bebas (Free Canvas)**: Kartu pada Work Board sekarang dapat diaktifkan dalam mode bebas (`🖐️ Bebas`) untuk di-drag dan diacak posisinya secara leluasa di atas kanvas kerja. Posisi koordinat tiap kartu otomatis tersimpan secara persisten di penyimpanan lokal.
- **Tombol Rapikan Kartu**: Tombol `🧹 Rapikan` di samping tombol mode bebas untuk mengembalikan semua kartu yang berserakan kembali ke grid masonry yang rapi dan seimbang dengan animasi transisi CSS halus.
- **Penjelajah Dokumen Lokal (File Explorer 3-Mode)**: Bagian Dokumen Lokal kini dilengkapi file explorer interaktif dengan 3 pilihan sudut pandang:
  - **Detail**: Tampilan tabel kolom yang rapi dengan indikator ukuran, ekstensi, unit terindeks, waktu indeks, dan pengurutan (*sorting*).
  - **Tree View**: Pohon direktori hierarkis folder dengan interaksi *expand* / *collapse* dan penanda cabang folder.
  - **Card / Grid**: Kartu pratinjau dokumen visual lengkap dengan cuplikan (*snippet*) teks berkas dan tombol peluncur native Explorer.
- **Pencarian & Breadcrumbs Dokumen**: Filter pencarian instan pada File Explorer dokumen lokal serta navigasi hierarki berbasis breadcrumbs.
- **Delegasi Browser Bawaan Windows**: Klik pada tombol tautan (*Buka Link*) kini otomatis meluncurkan peramban default pengguna di Windows (Chrome, Edge, Firefox, dsb.) secara eksternal melalui shell Windows, menggantikan browser WebView2 yang terisolasi.
- **Parameterisasi Otomatis Versi Build**: Skrip `installer/build-installer.ps1` kini membaca versi aplikasi secara dinamis langsung dari `package.json`, sehingga otomatis menghasilkan installer dan paket portabel sesuai versi aktif tanpa modifikasi manual.

### Diperbaiki (Fixed)
- **Ukuran Textarea Isi Catatan Dinamis**: Kotak isian deskripsi catatan pada modal tambah/edit catatan telah disesuaikan menjadi lebar 100% penuh mengikuti ukuran modal input lain, serta dilengkapi fitur *auto-grow* tinggi teks responsif.
- **Stabilitas Backend SQLite & Node.js v22**: Memperbaiki kegagalan native crash (*exitCode 3221225477*) saat server lokal WeKeepIt dijalankan di Windows dengan Node.js v22 dengan menyematkan binary stabil `better-sqlite3@11.8.1`.
- **Parameterisasi Mesin Pencarian Metadata**: Memperbaiki pencarian teks agar mencakup label field metadata kustom secara fleksibel tanpa nilai hardcoded.

---

## [2.0.0] - 2026-10-29

### Ditambahkan (Added)
- **Mesin Pengindeksan Dokumen Lokal (SQLite FTS5)**: Pencarian teks penuh (*Full-Text Search*) pada berkas dokumen lokal (`.md`, `.pdf`, `.docx`, `.xlsx`) menggunakan server backend lokal Node.js.
- **Windows Installer Resmi**: Paket installer Windows berbasis Inno Setup dengan isolasi penyimpanan data per-pengguna di direktori aman `%APPDATA%\WeKeepIt\`.
- **Dukungan Tema Baru**: Tema tampilan Daylight Snow dan Warm Cream dengan opsi cosmetic titlebar native.
- **Otomatisasi Server Desktop**: Peluncuran otomatis (*auto-spawn*) server backend Node.js di latar belakang saat aplikasi desktop .NET dibuka, dengan deteksi port dinamis.
- **Folder Picker Dialog Native**: Dialog pemilih folder Windows bawaan untuk memilih direktori lokal yang ingin diindeks.

---

## [1.2.0] - 2026-10-09

### Ditambahkan (Added)
- **Dropdown "Mau Simpan Apa?"**: Selektor kategori catatan dinamis pada modal untuk menyederhanakan antarmuka input berdasarkan jenis catatan (Tautan & Akses, Kredensial & Akun, Snippet Perintah & Kode, Catatan Bebas).
- Pengaturan metadata preset otomatis untuk peran akun, tautan PIC, dan tag relevan.

---

## [1.1.0] - 2026-10-09

### Ditambahkan (Added)
- **Aplikasi Desktop WeKeepIt**: Wrapper desktop mandiri menggunakan Windows Forms dan Microsoft Edge WebView2.
- **Pipeline CI/CD**: Otomatisasi build dan rilis menggunakan GitHub Actions.
