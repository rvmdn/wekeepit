# Panduan Deployment WeKeepIt ke Server RHEL / CentOS / Rocky Linux

Panduan ini menjelaskan langkah demi langkah memigrasikan **WeKeepIt** dari lingkungan desktop lokal Windows ke server Linux (Red Hat Enterprise Linux / Rocky / CentOS / Ubuntu) sebagai aplikasi tim kolaboratif terpusat.

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

Buat pengguna sistem non-root khusus untuk menjalankan layanan:
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
# Clone dari remote repository atau salin bundle v2.4.0
git clone https://github.com/rvmdn/wekeepit.git .
git checkout v2.4.0

# Install dependensi dan kompilasi modul better-sqlite3 native untuk Linux
npm ci --production
npm rebuild better-sqlite3

# Jalankan test suite untuk memastikan semua fungsi berjalan normal
npm test
```

---

## 5. Konfigurasi Multi-User & Systemd Service

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

1. Buka port di firewalld (jika tanpa Nginx):
   ```bash
   sudo firewall-cmd --permanent --add-port=4321/tcp
   sudo firewall-cmd --reload
   ```

2. Atau gunakan Nginx Reverse Proxy (Direkomendasikan):
   ```bash
   sudo dnf install nginx -y
   sudo cp deploy/nginx-wekeepit.conf /etc/nginx/conf.d/wekeepit.conf
   sudo systemctl enable --now nginx
   ```

   Jika SELinux aktif pada RHEL:
   ```bash
   sudo setsebool -P httpd_can_network_connect 1
   ```

---

## 7. Akun Bawaan & Akses Pengguna

Saat `AUTH_ENABLED=true`, sistem otomatis menginisialisasi akun bawaan di `/var/lib/wekeepit/users.json`:
- **Administrator**:
  - Username: `admin`
  - Password: `admin123`
  - Hak akses: Penuh (kelola pengguna, skema metadata, indexing, folder, kartu, dan arsip).
- **Editor**:
  - Username: `editor`
  - Password: `editor123`
  - Hak akses: Menambah, mengubah catatan/tugas kanban, checklist, komentar.
- **Viewer**:
  - Username: `viewer`
  - Password: `viewer123`
  - Hak akses: *Read-only* (melihat catatan, tugas, kalender, timeline, dan dokumen).

> [!IMPORTANT]
> Segera ganti password akun `admin` setelah berhasil masuk di lingkungan produksi.
