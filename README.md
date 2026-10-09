# WeKeepIt - Desktop Card Notepad & Notice Board 📌

Aplikasi desktop super ringan bergaya **Card / Papan Pengumuman** dengan dukungan **multi-tag filtering**, **metadata dinamis (tidak hardcoded)**, **checklist aktivitas harian**, dan **pengingat (reminder) otomatis**.

---

## ✨ Fitur Utama

1. **Format Card / Notepad Fleksibel**
   - Setiap catatan berbentuk card elegan dengan warna aksen kustom, badge pin, dan tag berwarna.
   - Papan Pengumuman (Pinned Board): sematkan catatan penting di bagian atas agar selalu terlihat.
   - Mode Kompak & Mode Widget Layar: dapat diubah menjadi widget ramping yang nyaman diletakkan di sudut layar saat bekerja di latar belakang.

2. **Filter Multi-Tag Lanjutan (`link+role`)**
   - Mendukung pencarian kombinasi tag dengan operator **AND** menggunakan simbol `+`:
     - Contoh: `link+role` -> hanya menampilkan kartu yang memiliki tag `link` **dan** tag `role`.
     - Contoh: `link+role+vpn` -> memfilter 3 tag sekaligus.
   - Mendukung operator **OR** dengan tanda koma `,`: `link, role`.
   - Baris Tag Interaktif: klik tag apa saja untuk otomatis menggabungkannya ke dalam kolom pencarian.

3. **Metadata Dinamis (Tidak Hardcode)**
   - Struktur metadata kartu bersifat dinamis dan diekspansi melalui file skema `metadata-schema.json`.
   - Mendukung tipe field beragam:
     - 🔗 **URL / Link**: tombol otomatis buka browser.
     - 👤 **Role / Akses**: badge permission/role.
     - 🌐 **Select Option**: Environment (Dev, Staging, Prod), Prioritas (Low, High, Critical).
     - 🏷️ **Teks / PIC**: Nama PIC, host DB, dll.
   - Tombol **⚙️ Kelola Metadata**: Anda dapat menambah atau menghapus field baru langsung dari antarmuka tanpa menyentuh kode program!

4. **Reminder & Aktivitas Harian (Daily Checklist)**
   - Waktu pengingat dengan live countdown (*"Dalam 2j"*, *"Terlewat 15m lalu"*).
   - Opsi pengulangan Harian (*Daily*) atau Sekali Saja.
   - Audio chime synthesizer bawaan (Web Audio API) + Notifikasi Desktop Windows.
   - Checklist to-do interaktif lengkap dengan bilah progres persentase.

5. **Super Ringan & Penyimpanan Lokal**
   - Menggunakan server bawaan Node.js tanpa dependensi eksternal (`npm install` tidak diperlukan!).
   - Data otomatis tersimpan ke file `wekeepit-data.json` di komputer Anda secara real-time.
   - Konsumsi RAM sangat minim (~15MB-30MB).
   - Tersedia tombol ekspor & impor JSON cadangan.

---

## 🚀 Cara Menjalankan

### Cara 1: Sekali Klik (Rekomendasi untuk Desktop)
Cukup klik ganda salah satu file berikut di Windows Explorer:
- **`launch-desktop.bat`**: Menjalankan server dan membuka jendela aplikasi desktop (berjalan seperti aplikasi native tanpa tab browser).
- **`launch-silent.vbs`**: Menjalankan aplikasi secara hening di latar belakang tanpa jendela hitam command prompt.

### Cara 2: Lewat Terminal / Command Prompt
```bash
node server.js
```
Lalu buka browser di: **`http://localhost:4321`**

---

## 📁 Struktur Berkas

```
wekeepit/
├── index.html            # Antarmuka utama aplikasi
├── style.css             # Tema dark modern & estetika card board
├── app.js                # Logika utama aplikasi & manajemen card
├── metadata-engine.js    # Parser query multi-tag (link+role) & mesin skema
├── reminder-service.js   # Background ticker, audio synthesizer chime & reminder
├── server.js             # Server HTTP lokal ringan (zero dependencies)
├── metadata-schema.json  # Definisi field metadata dinamis
├── wekeepit-data.json    # Berkas penyimpanan data kartu lokal
├── launch-desktop.bat    # Script peluncur jendela desktop mandiri
├── launch-silent.vbs     # Peluncur hening tanpa console window
└── package.json          # Metadata paket proyek
```
