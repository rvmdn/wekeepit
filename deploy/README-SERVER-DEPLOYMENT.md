# Panduan Deployment WeKeepIt ke Server RHEL / CentOS / Rocky Linux

Panduan ini menjelaskan langkah demi langkah memigrasikan **WeKeepIt** dari lingkungan desktop lokal Windows ke server Linux (Red Hat Enterprise Linux / Rocky / AlmaLinux / Ubuntu) sebagai aplikasi tim kolaboratif terpusat, termasuk prosedur **update kode tanpa kehilangan data** dan **backup**.

---

## 1. Prasyarat Sistem

- **OS**: RHEL 8/9, Rocky Linux 8/9, AlmaLinux, atau Debian/Ubuntu LTS.
- **Node.js**: Versi LTS (v18.x, v20.x, atau v22.x).
- **Build Tools**: Diperlukan untuk kompilasi modul C++ SQLite native (`better-sqlite3`):
  ```bash
  # RHEL / Rocky / AlmaLinux:
  sudo dnf groupinstall "Development Tools" -y
  sudo dnf install python3 -y

  # Ubuntu / Debian:
  sudo apt update && sudo apt install build-essential python3 -y
  ```

---

## 2. Pemasangan Node.js di RHEL

Gunakan NodeSource RPM repository:
```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node -v # Pastikan >= 20.x
npm -v
```

---

## 3. Menyiapkan Direktori & Pengguna Sistem

Pisahkan direktori **kode aplikasi** (`/opt/wekeepit`) dari **data persisten** (`/var/lib/wekeepit`) agar pembaruan kode tidak pernah menimpa data tim:

```bash
sudo useradd -r -s /sbin/nologin wekeepit
sudo mkdir -p /opt/wekeepit
sudo mkdir -p /var/lib/wekeepit
sudo chown -R wekeepit:wekeepit /opt/wekeepit
sudo chown -R wekeepit:wekeepit /var/lib/wekeepit
```

---

## 4. Deploy Source Code & Rebuild SQLite

Salin berkas aplikasi ke `/opt/wekeepit`:
```bash
cd /opt/wekeepit
git clone https://github.com/rvmdn/wekeepit.git .
# Opsional: checkout ke tag rilis stabil terbaru, atau tetap di branch main
git checkout v2.5.0

# Install dependensi dan kompilasi modul better-sqlite3 native untuk Linux
npm ci --production
npm rebuild better-sqlite3

# Jalankan test suite untuk memastikan semua fungsi berjalan normal
npm test
```

---

## 5. Konfigurasi Multi-User & Systemd Service

Berkas [`wekeepit.service`](wekeepit.service) sudah mengonfigurasi environment produksi (`AUTH_ENABLED=true`, `ALLOW_REMOTE_HOST=true`, serta path penyimpanan di `/var/lib/wekeepit`).

1. Salin berkas unit systemd:
   ```bash
   sudo cp deploy/wekeepit.service /etc/systemd/system/wekeepit.service
   sudo systemctl daemon-reload
   ```

2. Aktifkan dan jalankan service:
   ```bash
   sudo systemctl enable --now wekeepit
   sudo systemctl status wekeepit
   ```

3. Pantau log real-time:
   ```bash
   sudo journalctl -u wekeepit -f
   ```

---

## 6. Konfigurasi Firewall & Nginx Reverse Proxy

1. Buka port di firewalld (jika diakses langsung tanpa Nginx):
   ```bash
   sudo firewall-cmd --permanent --add-port=4321/tcp
   sudo firewall-cmd --reload
   ```

2. Atau gunakan Nginx Reverse Proxy (Direkomendasikan):
   ```bash
   sudo dnf install nginx -y
   sudo cp deploy/nginx-wekeepit.conf /etc/nginx/conf.d/wekeepit.conf
   sudo nginx -t
   sudo systemctl enable --now nginx
   ```

   Jika SELinux aktif pada RHEL:
   ```bash
   sudo setsebool -P httpd_can_network_connect 1
   ```

   Pastikan port HTTP/HTTPS dibuka jika melalui firewalld:
   ```bash
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --permanent --add-service=https
   sudo firewall-cmd --reload
   ```

---

## 7. Akun Bawaan & Manajemen Pengguna

Saat `AUTH_ENABLED=true`, sistem hanya menginisialisasi **1 akun Administrator** bawaan di `/var/lib/wekeepit/users.json` (single-seed):
- **Username**: `admin`
- **Password awal**: `admin123`
- **Hak akses**: Penuh (kelola pengguna, skema metadata, indexing, folder, kartu/Kanban, dan arsip).

Akun **Editor** dan **Viewer** tidak dibuat secara otomatis. Setelah login sebagai `admin`, gunakan tombol **Manajemen Pengguna (`👥`)** di header untuk menambahkan akun anggota tim:
- **Editor**: Menambah dan mengubah catatan/tugas Kanban, checklist, komentar, serta assign tugas.
- **Viewer**: *Read-only* (melihat catatan, tugas, kalender, timeline, dan dokumen).

> [!IMPORTANT]
> Segera ganti password default `admin` sebelum server dibuka ke tim. Caranya:
> 1. Login sebagai `admin` (`admin123`), buka **Manajemen Pengguna (`👥`)**, lalu klik tombol **🔑 Password** pada baris `admin`.
> 2. Atau lewat API `PUT /api/auth/users/admin`:
> ```bash
> # 1. Login untuk mendapatkan token sesi
> TOKEN=$(curl -s -X POST http://127.0.0.1:4321/api/auth/login \
>   -H "Content-Type: application/json" \
>   -d '{"username":"admin","password":"admin123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")
>
> # 2. Ganti password admin
> curl -s -X PUT http://127.0.0.1:4321/api/auth/users/admin \
>   -H "Content-Type: application/json" \
>   -H "Authorization: Bearer $TOKEN" \
>   -d '{"password":"GANTI_DENGAN_PASSWORD_KUAT"}'
> ```

---

## 8. Prosedur Update Kode (Tanpa Kehilangan Data)

Karena data tersimpan di `/var/lib/wekeepit` (terpisah dari `/opt/wekeepit`), pembaruan kode tidak akan menghapus data catatan, user, maupun indeks dokumen:

```bash
cd /opt/wekeepit

# 1. Tarik kode terbaru
sudo -u wekeepit git pull origin main

# 2. (Opsional) Jika package.json berubah
sudo -u wekeepit npm ci --production
sudo -u wekeepit npm rebuild better-sqlite3

# 3. Jalankan test sebelum restart
sudo -u wekeepit npm test

# 4. Restart service (downtime ~2–3 detik, data tetap aman dengan atomic write)
sudo systemctl restart wekeepit
sudo systemctl status wekeepit
```

> [!NOTE]
> `server.js` dan `auth.js` sudah menggunakan **atomic write** (`.tmp` → `.bak` → `rename`) dan auto-recovery dari `.bak` apabila file utama korup saat terjadi crash mendadak.

---

## 9. Backup & Pemulihan Data

Seluruh data produksi berada di `/var/lib/wekeepit`:
- `wekeepit-data.json` (dan `wekeepit-data.json.bak`) — catatan & tugas Kanban
- `users.json` (dan `users.json.bak`) — daftar akun & hash password
- `metadata-schema.json` — skema metadata & palet tag
- `index.db` — indeks pencarian dokumen SQLite

Contoh backup harian sederhana ke `/var/backups/wekeepit`:
```bash
sudo mkdir -p /var/backups/wekeepit
sudo tar -czf /var/backups/wekeepit/wekeepit-$(date +%F).tar.gz -C /var/lib/wekeepit .
```
