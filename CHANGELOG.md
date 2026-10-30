# Changelog

Semua perubahan penting pada proyek **WeKeepIt** akan dicatat dalam berkas ini.
Format ini mengacu pada [Keep a Changelog](https://keepachangelog.com/id/1.0.0/) dan mengikuti standar [Semantic Versioning](https://semver.org/).

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
