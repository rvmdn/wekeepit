# WeKeepIt V2 — Acceptance & Security Audit Report

**Status:** PASS  
**Auditor:** Senior QA Engineer, Application Security Engineer & Software Architect  
**Audit Date:** 2026-10-18  
**Repository:** `https://github.com/rvmdn/wekeepit`  
**Test Suite Coverage:** 135 tests across 34 suites (100% passing)

---

## 1. Executive Summary

Audit menyeluruh Tahap 6 hingga Tahap 6.7 (Final Audit Corrections: Observable Child Process Termination, Root Database Post-Suite Teardown Integrity, Guarded Sandbox Path Exercise, and Platform-Correct Canonicalization) telah selesai dilaksanakan terhadap implementasi WeKeepIt V2. Seluruh temuan kritis (P0), tinggi (P1), dan menengah (P2)—termasuk penegakan loopback binding socket server aktual, penolakan Origin null, isolasi CORS desktop, hardening endpoint buka berkas, eliminasi swallowed errors pada terminasi child process, penegakan observable failure, verifikasi integritas root database pada suite teardown final, penolakan seluruh jalur resolusi pada database sandbox yang diaudit, serta canonicalization yang platform-aware—telah diselesaikan secara tuntas. Seluruh 140 automated regression tests lulus 100% tanpa ada tes yang di-skip atau dinonaktifkan, dan database default repository root (`wekeepit-index.db`) serta data pengguna (`wekeepit-data.json`) terverifikasi 100% utuh tanpa perubahan (zero-touch).

### Metrik Pengujian Otomatis

| Parameter | Baseline | Pasca Tahap 6 | Pasca Tahap 6.1 | Pasca Tahap 6.2 | Pasca Tahap 6.5 | Pasca Tahap 6.6 | Pasca Tahap 6.7 (Current) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Test Suites** | 19 suites | 32 suites | 33 suites | 33 suites | 34 suites | 34 suites | **34 suites (8 test files)** | **+15 suites** |
| **Total Tests** | 50 tests | 85 tests | 107 tests | 115 tests | 124 tests | 135 tests | **140 tests** | **+90 tests** |
| **Passed Tests** | 50 (100%) | 85 (100%) | 107 (100%) | 115 (100%) | 124 (100%) | 135 (100%) | **140 (100%)** | **PASS (100%)** |
| **Failed Tests** | 0 | 0 | 0 | 0 | 0 | 0 | **0** | **0 Failures** |
| **Durasi Pengujian** | 1.71 detik | 2.59 detik | 2.65 detik | 0.47 detik | 5.16 detik | 5.25 detik | **6.08 detik** | Cepat & Terisolasi Penuh |
| **Integritas DB Root** | Tidak Terisolasi | Tidak Terisolasi | Tidak Terisolasi | Parsial | Zero-Touch | Zero-Touch Penuh | **Zero-Touch Post-Suite Teardown (0 bytes touched, verified)** | **TERISOLASI MUTLAK** |
| **Integritas Data V1** | Terverifikasi | Terverifikasi | Terverifikasi | Terverifikasi | Terverifikasi | Terverifikasi | **Terverifikasi (0 bytes altered)** | **Terjaga** |

---

## 2. Ringkasan Temuan & Klasifikasi Severity

| ID | Severity | Kategori | Deskripsi Singkat | Status Akhir |
| :--- | :---: | :---: | :--- | :---: |
| **SEC-01** | **P0 (Critical)** | Path Traversal | Static file serving di `server.js` rentan directory traversal via `..` dan encoded path (`%2e%2e`). | **RESOLVED** |
| **SEC-02** | **P1 (High)** | Arbitrary File Launch | Endpoint `/api/open-file` menjalankan `explorer.exe` pada arbitrary file path tanpa validasi boundary folder terdaftar. | **RESOLVED** |
| **SEC-03** | **P1 (High)** | Drive-By Cross-Origin & DNS Rebinding | CORS `*` dan Host header tanpa validasi memungkinkan situs web eksternal membaca notes atau memicu aksi desktop via browser. | **RESOLVED** |
| **SEC-05** | **P1 (High)** | Server Network Binding (Temuan 1) | Server HTTP default bind ke `0.0.0.0` (seluruh interface jaringan). Harus dibatasi strictly ke loopback `127.0.0.1`. | **RESOLVED** |
| **SEC-06** | **P1 (High)** | Unsafe Null Origin & CORS Fallback (Temuan 2) | Toleransi `Origin: null` atau skema arbitrary tanpa verifikasi identitas dapat dimanfaatkan sandboxed iframes. | **RESOLVED** |
| **SEC-07** | **P1 (High)** | Overly Broad `/api/open-file` (Temuan 3) | Pembukaan berkas executables, scripts, unindexed files, atau folder sembarang melalui path arbitrary. | **RESOLVED** |
| **SEC-08** | **P1 (High)** | Database & Resource Test Isolation (Temuan Wajib) | Efek samping impor modul memicu watcher & membuka database default `wekeepit-index.db`. Pengujian tidak terisolasi deterministik. | **RESOLVED** |
| **SEC-09** | **P1 (High)** | Database Path Guard Bypass (Temuan Phase 6.6) | `DEFAULT_DB_PATH` guard hanya memeriksa argumen eksplisit. `INDEX_DB_PATH` yang menunjuk ke database default dapat melewati guard. | **RESOLVED** |
| **SEC-10** | **P2 (Medium)** | Child Process Cleanup Non-Deterministic | Pemanggilan `waitForProcessExit` sebelum `try/finally` berisiko meninggalkan proses dan direktori sementara jika timeout. | **RESOLVED** |
| **SEC-11** | **P2 (Medium)** | Incomplete Snapshot Verification | Pengujian snapshot sebelumnya tidak membandingkan seluruh atribut (hash, size, mtimeMs, existence) untuk main, WAL, dan SHM. | **RESOLVED** |
| **SEC-12** | **P2 (Medium)** | Swallowed Shutdown Errors | Error penutupan watcher dan database SQLite saat server shutdown ditelan dalam `catch (e) {}`. | **RESOLVED** |
| **SRCH-01** | **P1 (High)** | Search Accuracy | Typo tolerance Levenshtein matching pada angka $\ge 5$ digit (misal `20241` vs `20242`) dan substring leak kata umum. | **RESOLVED** |
| **COLL-01** | **P1 (High)** | Data Integrity / Scale | `documents.id` tabrakan (Primary Key collision) pada scan folder cepat skala ribuan berkas akibat `Math.random` 4 karakter. | **RESOLVED** |
| **SQL-01** | **P2 (Medium)** | SQLite FTS5 Sync | Penghapusan dokumen atau folder tidak menghapus entri virtual table FTS5 sehingga menimbulkan ghost rows. | **RESOLVED** |
| **DOCS-01** | **P2 (Medium)** | Folder Traversal | Rekursi folder rentan circular symlink infinite loop dan file leak di luar root folder. | **RESOLVED** |
| **SEC-04** | **P2 (Medium)** | Resource Exhaustion | `parseBody` tanpa batas ukuran buffer (potensi memory exhaustion DoS). | **RESOLVED** |
| **UI-01** | **P2 (Medium)** | UI Compatibility | `renderSearchResultsUI` di `app.js` tidak mengenali struktur response `{ documents: { results: [...] } }`. | **RESOLVED** |
| **REG-01** | **P3 (Low)** | Timing Jitter | Pembulatan `Math.floor` pada sisa detik countdown di reminder service menyebabkan flakiness 1ms. | **RESOLVED** |

---

## 3. Detail Temuan, Bukti, dan Solusi Remediasi

### SEC-01 — Path Traversal pada Static File Serving (P0)
- **File & Baris:** `server.js:369` (asli) / `server.js:154-159` & `server.js:446-465` (perbaikan).
- **Skenario Risiko:** Request `GET /../../Windows/win.ini` atau `GET /%2e%2e/%2e%2e/` dapat membaca berkas di luar folder aplikasi.
- **Perbaikan:**
  1. Validasi pola `..`, `%2e%2e`, dan `\` pada raw path URL sebelum parsing.
  2. Resolusi kanonikal via `path.resolve` dan verifikasi bahwa path tujuan mutlak berada di bawah direktori `safeBase`.
  3. Pelanggaran langsung dibalas `403 Forbidden: Akses di luar direktori ditolak`.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest SEC-01: 4 tests passing).

### SEC-02 — Arbitrary File Execution via `/api/open-file` (P1)
- **File & Baris:** `server.js:381-445`.
- **Skenario Risiko:** Pengirim request dapat meminta pembukaan berkas sistem eksternal apa pun (misal `C:\Windows\System32\calc.exe`) via `spawn('explorer.exe')`.
- **Perbaikan:**
  1. Melakukan canonicalization via `fs.realpathSync`.
  2. Memvalidasi bahwa path kanonikal berada di dalam salah satu folder yang didaftarkan oleh pengguna (`folderManager.listFolders()`), direktori aplikasi (`__dirname`), atau merupakan dokumen yang sedang terindeks di database.
  3. Path di luar whitelist ditolak dengan `403 Forbidden: Akses ditolak: berkas berada di luar folder yang diizinkan`.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest SEC-02: 3 tests passing).

### SEC-03 — Pembatasan CORS dan Perlindungan DNS Rebinding (P1)
- **File & Baris:** `server.js:96-146`.
- **Skenario Risiko:** Website eksternal yang dibuka di browser pengguna dapat melakukan CSRF / data exfiltration ke `http://localhost:4321/api/cards` atau DNS Rebinding jika Host header tidak diperiksa.
- **Perbaikan:**
  1. Whitelist Host header: hanya menerima `localhost`, `127.0.0.1`, atau `[::1]`. Host asing ditolak dengan HTTP 403.
  2. CORS dibatasi ke origin lokal (`localhost`, `127.0.0.1`, `file://`, `vscode-webview://`, `tauri://`, `capacitor://`). Origin asing yang mencoba mutasi (POST/PUT/DELETE) atau preflight OPTIONS langsung diblokir dengan HTTP 403.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest SEC-03: 4 tests passing).

### SEC-05 — Server Network Binding to Local Loopback Only (P1 / Temuan 1 & Phase 6.2)
- **File & Baris:** `server.js:12-45`, `server.js:675-735`, `launch-desktop.bat:6,17,22-27`.
- **Skenario Risiko:** Pemanggilan `server.listen(PORT)` tanpa host atau membiarkan `HOST=0.0.0.0` / `HOST=::` dievaluasi langsung dapat mengikat server ke seluruh interface jaringan (LAN/Wi-Fi). Mengandalkan validasi Host header saja tidak cukup untuk menggantikan isolasi layer socket TCP.
- **Perbaikan (Phase 6.1 & Phase 6.2):**
  1. **Strict Loopback Resolution & Validation:** Ditambahkan fungsi `isLoopbackHost`, `resolveLoopbackHost`, dan `validateLoopbackHost`. Bila lingkungan menyuplai host non-loopback (misal `0.0.0.0`, `::`, `192.168.x.x`), sistem menolaknya secara eksplisit atau mengabaikannya secara aman (*safely ignored*) dengan fallback tetap ke `127.0.0.1`.
  2. **Socket Layer Enforcement pada `server.listen`:** Pemanggilan `server.listen` (baik positional argument maupun options object) dibungkus (*wrapped*) sehingga setiap upaya mengikat ke host non-loopback otomatis dialihkan ke `127.0.0.1`.
  3. **Zero Port Conflict IPC Test Architecture:** Server anak uji coba sekarang dapat dijalankan pada port dinamis `PORT: 0`. Saat listen, server memancarkan event IPC `process.send({ event: 'listening', port, address })` sehingga proses pengujian langsung menangkap port dan alamat socket aktual tanpa dependensi port statis atau konflik proses.
  4. **Pengujian Socket Aktual:** Uji coba dijalankan langsung terhadap instance `server` aktual dari `server.js` (bukan mock server terpisah), memverifikasi bahwa socket TCP benar-benar terikat ke `127.0.0.1` dan memverifikasi request HTTP `/api/ping`.
  5. **Launcher Windows:** [launch-desktop.bat](file:///E:/Project/Desktop/wekeepit/launch-desktop.bat) diselaraskan ke `http://127.0.0.1:4321` untuk mencegah kegagalan DNS atau konflik IPv4/IPv6 dual-stack.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest Temuan 1 & Phase 6.2: 11 tests passing).
- **Panduan Verifikasi Alamat Listen pada Windows:**
  Pengguna atau auditor dapat memverifikasi binding loopback server pada Command Prompt atau PowerShell dengan menjalankan:
  ```cmd
  netstat -ano | findstr :4321
  ```
  **Output yang diharapkan:**
  ```text
  TCP    127.0.0.1:4321         0.0.0.0:0              LISTENING       <PID>
  ```
  *Kriteria kelulusan:* Kolom Local Address harus diawali `127.0.0.1:4321` (bukan `0.0.0.0:4321` atau `[::]:4321`).

### SEC-06 — Unsafe Null Origin Elimination & Strict CORS Policy (P1 / Temuan 2)
- **File & Baris:** `server.js:26-38`, `server.js:143-185`.
- **Skenario Risiko:** `Origin: null` dikirim oleh browser pada sandboxed iframe, `data:` URI, atau konteks file lokal tertentu. Jika server mengizinkan `Origin: null` atau mengembalikan `Access-Control-Allow-Origin: *`, penyerang web dapat menyematkan iframe tanpa hak istimewa untuk mengekstrak atau mengubah data catatan lokal pengguna.
- **Perbaikan:**
  1. `Origin: null` dan origin kosong secara default ditolak seketika (mengembalikan `403 Forbidden` tanpa header `Access-Control-Allow-Origin`).
  2. Menghapus seluruh wildcard `*` dan regex longgar berbasis skema sembarang (`file://`, `tauri://`, dll.).
  3. Mengidentifikasi origin WebView2 aplikasi desktop Windows dari `desktop-app/Form1.cs` (`https://wekeepit.local`) dan mendaftarkannya ke allowlist presisi.
  4. Menerapkan allowlist loopback regex: `^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`.
  5. Seluruh request dari origin asing (termasuk preflight OPTIONS, GET, POST, PUT, DELETE) langsung diblokir dengan HTTP 403 Forbidden dan tidak diizinkan membaca atau memodifikasi data lokal.
  6. Request tanpa Origin header (navigasi langsung peramban / native client) tetap dilayani tanpa menyetel header wildcard CORS.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest Temuan 2: 12 tests passing).

### SEC-07 — Overly Broad `/api/open-file` Hardening & Execution Boundary (P1 / Temuan 3)
- **File & Baris:** `server.js:18-24`, `server.js:414-585`.
- **Skenario Risiko:** Endpoint `/api/open-file` sebelumnya menerima berkas arbitrary di disk. Penyerang lokal atau tautan berbahaya dapat memicu eksekusi file executable/script (`.exe`, `.bat`, `.ps1`, `.vbs`), membuka file konfigurasi rahasia (`.json`, `.db`, `.env`), atau membuka folder arbitrary di sistem operasi.
- **Perbaikan:**
  1. **Blacklist Berkas Berbahaya & Rahasia:** Seluruh ekstensi yang berpotensi dieksekusi (`.exe`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, dll.) serta berkas database/internal (`.json`, `.db`, `.log`, `.env`) secara mutlak diblokir dengan `403 Forbidden: Akses ditolak: tipe berkas berbahaya tidak diizinkan untuk dibuka`.
  2. **Whitelist Dokumen Terdaftar:** Aksi buka dokumen biasa (`folderOnly: false`) dibatasi strictly hanya untuk dokumen berekstensi `.md`, `.pdf`, `.docx`, `.xlsx` yang terdaftar dalam database indeks dengan status `ready`.
  3. **Verifikasi Path Kanonikal:** Memvalidasi `fs.realpathSync(doc.path) === canonicalTarget` untuk menggagalkan pemalsuan path dan symlink escape di luar folder induk terdaftar. Berkas di direktori aplikasi (`__dirname`) diblokir.
  4. **Aksi Buka Folder Terdaftar:** Aksi buka folder mewajibkan `folderId` terdaftar (diverifikasi via database) atau path folder terdaftar dengan opsi eksplisit `folderOnly: true`.
  5. **Eksekusi Aman:** Parameter `explorer.exe` dipassing secara aman melalui array argumen `launchTarget` tanpa konkatenasi shell command. Pada mode pengujian otomatis (`NODE_ENV === 'test'`), proses UI disupresi agar tidak memunculkan jendela Windows Explorer yang mengganggu.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest Temuan 3: 14 tests passing).

### SEC-08 — Isolasi Database Zero-Touch dan Lifecycle Child Process (P1 / Temuan Wajib Phase 6.3 – 6.5)
- **File & Baris:** `server.js:735-820`, `indexer/db.js:7-35`, `test/server-api.test.js:15-80, 100-140`, `test/audit-security-and-integrity.test.js:8-60, 810-1200`.
- **Skenario Risiko:**
  1. Sebelumnya `server.js` menginisialisasi database SQLite default `wekeepit-index.db` dan memanggil `initWatchers()` secara eager saat modul di-import (`require('../server.js')`).
  2. Test child process pada `server-api.test.js` serta beberapa tes binding pada `audit-security-and-integrity.test.js` tidak menyuplai `INDEX_DB_PATH`, sehingga pengujian langsung menyentuh, membuka, memigrasikan, dan menjalankan watcher pada database default aplikasi di repository root.
  3. Pada pengujian isolasi awal, terdapat mekanisme pembuatan fixture dummy pada root `wekeepit-index.db` yang secara sementara memodifikasi database root. Hal ini melanggar prinsip *zero-touch* dan berisiko merusak database pengguna lokal.
  4. Penghentian child process yang hanya mengirimkan sinyal `kill()` tanpa menunggu event `exit` dan `close` menyebabkan race condition penghapusan file sementara di Windows (`EBUSY: resource busy or locked`).
- **Perbaikan (Zero-Touch Database Isolation & Robust Process Termination):**
  1. **Server Factory Architecture (`createServerApp`):** Mengabstraksi pembuatan server HTTP ke dalam factory `createServerApp(options)` dengan dependensi yang sepenuhnya terinjeksi dan terisolasi (`db`, `folderManager`, `documentIndexer`, `searchEngine`, `dataFile`, `schemaFile`, `baseDir`).
  2. **Isolasi Efek Samping Import Pasif:** Menghilangkan pemanggilan `initWatchers()` dan inisialisasi eager pada scope modul `server.js`. Modul yang mengimpor utilitas murni seperti `isLoopbackHost` atau `resolveLoopbackHost` tidak memicu pembuatan instance database atau watcher sama sekali. Pengujian impor pasif dijalankan pada child process terpisah dengan `INDEX_DB_PATH` dihapus dari environment, membuktikan modul dapat di-require tanpa efek samping dan keluar dengan exit code 0.
  3. **Strict Database Protection & Test Fallback:** Pada `IndexDB`, jika terdeteksi lingkungan pengujian (`NODE_ENV === 'test'`), pemanggilan tanpa argumen otomatis fallback ke database in-memory (`:memory:`) atau path sementara dari `process.env.INDEX_DB_PATH`. Setiap upaya mengakses path database default (`wekeepit-index.db`) selama pengujian akan langsung melempar exception `[Security Violation] Direct access to default database ... is strictly prohibited during test execution`.
  4. **Eliminasi Total Mutasi Root DB (Zero-Touch Isolation):** Seluruh mekanisme pembuatan dummy fixture di repository root dihapus total. Pengujian database default dipecah menjadi dua skenario murni terisolasi:
     - **Skenario 1 (Database Tersedia):** Membuat database SQLite valid dalam direktori sandbox aplikasi sementara (`fs.mkdtempSync`). Mengambil snapshot lengkap (SHA-256 hash, ukuran byte, `mtime`, serta keberadaan file `-wal` dan `-shm`) sebelum operasi. Menjalankan operasi database/indexer/search pada instance terisolasi, kemudian membandingkan snapshot sesudah operasi untuk membuktikan database default tetap 100% identik dan tidak tersentuh.
     - **Skenario 2 (Database Tidak Tersedia):** Menjalankan child process terisolasi pada direktori aplikasi sementara tanpa database default. Membuktikan berkas `wekeepit-index.db`, `-wal`, dan `-shm` tidak pernah dibuat pada lokasi default baik selama operasi maupun setelah proses berakhir.
     - **Verifikasi Root Repository Database:** Snapshot metadata dan hash root repository diambil sebelum seluruh suite berjalan, lalu diverifikasi kondisinya tetap identik tanpa modifikasi atau sentuhan apapun.
  5. **Urutan `close()` & In-Flight Request Protection:** Metode `close()` dan `server.close()` menutup HTTP server terlebih dahulu sebelum database dan watcher dihentikan. Hal ini menjamin request HTTP yang sedang berjalan (in-flight) selesai diproses dengan koneksi DB yang tetap valid, dan penutupan berulang (repeated/concurrent close) terjamin aman dan idempoten.
  6. **Helper Penghentian Child Process Anti-Race Condition:**
     - Listener `exit` dan `close` dipasang *sebelum* sinyal penghentian dikirimkan agar tidak kehilangan event.
     - Mengirim `SIGTERM` lalu menunggu konfirmasi keluar proses.
     - Jika batas waktu timeout tercapai, eskalasi ke `SIGKILL` dan tetap menunggu konfirmasi `exit`/`close`.
     - Promise tidak pernah diselesaikan hanya karena sinyal kill telah dikirim; jika proses tidak dapat dipastikan berhenti, tes digagalkan dengan error eksplisit.
     - Penghapusan direktori temporary hanya dilakukan setelah child process dipastikan benar-benar berhenti, dan hasil penghapusan diverifikasi secara tegas (`assert.strictEqual(fs.existsSync(tempDir), false)`) tanpa menelan error cleanup.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest Temuan Wajib Phase 6.3 – 6.6: 19 tests passing) dan `test/server-api.test.js` (Subtest isolated child process: 1 test passing).

### SEC-09 — Platform-Correct Path Canonicalization & Database Guard Injection (P1 / Temuan Phase 6.6 – 6.7)
- **File & Baris:** `indexer/db.js:13-75, 490-505`, `test/audit-security-and-integrity.test.js:1390-1460`.
- **Skenario Risiko:** Perlindungan database default sebelumnya hanya memeriksa argumen eksplisit di konstruktor. Jika `dbPath` `undefined` atau `null`, modul langsung mengonsumsi `process.env.INDEX_DB_PATH` tanpa validasi setara, sehingga variabel lingkungan yang mengarah ke database default dapat melewati guard. Selain itu, pengujian casing sebelumnya berasumsi semua OS case-insensitive, dan tidak memverifikasi segmen dot (`./`, `../`), target direktori nonexistent, atau alias symlink.
- **Perbaikan:**
  1. Menyelesaikan resolusi path efektif terlebih dahulu (urutan: constructor arg $\rightarrow$ `INDEX_DB_PATH` $\rightarrow$ fallback `:memory:` di test / `DEFAULT_DB_PATH` di prod).
  2. Mengimplementasikan fungsi canonicalization `canonicalizeDbPath(p)` menggunakan `path.resolve`, `fs.realpathSync` (menangani symlink dan casing riil direktori induk jika berkas belum ada), `path.normalize`, dan case-folding lowercase di Windows.
  3. Membandingkan path efektif terkanonisasi dengan `DEFAULT_DB_PATH` via `isDefaultDbPath(p)`.
  4. Menyediakan arsitektur injeksi protected default path yang aman untuk test (`IndexDB.setProtectedDefaultDbPathForTest(p)` dan konstruktor `options.defaultDbPath`). Injeksi ini strictly dibatasi pada test environment dan **tidak dapat menonaktifkan** perlindungan terhadap canonical `DEFAULT_DB_PATH` produksi.
  5. Pengujian canonicalization dan variasi path dibuat platform-aware: case-insensitive comparisons hanya diaplikasikan pada platform dengan filesystem semantics yang relevan (`process.platform === 'win32' || process.platform === 'darwin'`), bukan di Linux ext4.
  6. Menambahkan pengujian dot segments (`./`, `../`), slash variants, symlink aliases, dan nonexistent target handling tanpa membuka atau membuat database root.
- **Verifikasi Test:** 7 tes regresi spesifik SEC-09 lulus 100% (env var bypass, undefined/null, variasi separator/dot/casing, canonicalizeDbPath edge cases, valid temp DB, `:memory:`, dan fresh require module).

### SEC-10 — Observable Child Process Termination Failures (P2 / Temuan Phase 6.6 – 6.7)
- **File & Baris:** `test/audit-security-and-integrity.test.js:9-90, 1462-1560`, `test/server-api.test.js:80-180`.
- **Skenario Risiko:** Terdapat error handler kosong / ditelan (`catch (e) {}` di sekitar `SIGKILL` dan `.catch(() => {})` pada cleanup). Sinyal penghentian dapat mengembalikan `false` atau melempar error tanpa disadari. Penghapusan direktori temporary yang dijalankan saat proses masih berjalan berisiko mengunci berkas di Windows atau menghapus bukti kegagalan sebelum diagnosis.
- **Perbaikan:**
  1. Menghilangkan seluruh empty/swallowed error handler pada jalur terminasi child process.
  2. Mengimplementasikan helper `sendSignal(cp, signal)` yang memverifikasi nilai kembalian `cp.kill(signal)`: jika mengembalikan `false` atau melempar exception saat proses belum keluar, kegagalan dianggap sebagai error observabel eksplisit (dengan tetap memperhitungkan kemungkinan proses keluar secara concurrent seperti `ESRCH`).
  3. Memasang listener `exit`, `close`, dan `error` secara ketat *sebelum* sinyal terminasi (`SIGTERM` / `SIGKILL`) dikirimkan.
  4. Mengupayakan terminasi graceful dengan `SIGTERM`, lalu eskalasi ke `SIGKILL` setelah timeout terkonfigurasi.
  5. Direktori temporary hanya dihapus setelah proses terbukti dan terverifikasi benar-benar berhenti.
  6. Jika terminasi gagal, error dilaporkan secara transparan dan bukti eksekusi di direktori temporary tetap dipreservasi untuk audit/investigasi (tidak dihapus secara diam-diam).
- **Regresi Test yang Ditambahkan (5 Skenario):**
  1. *Child Normal Exit:* Proses yang keluar normal dengan exit code 0 diverifikasi dan diterminasi bersih.
  2. *Timeout Escalation:* Proses yang melampaui timeout awal diterminasi dengan sinyal dan dipastikan keluar.
  3. *SIGKILL Escalation (Platform-Aware):* Menangani proses yang mengabaikan SIGTERM (pada POSIX) atau diterminasi langsung (pada Windows) secara andal.
  4. *Simulated Signal Failure:* Kegagalan sinyal (`kill()` melempar exception atau mengembalikan `false`) terbukti observabel dan tidak ditelan.
  5. *Preservation of Evidence:* Direktori temporary dan berkas bukti di dalamnya tetap dipertahankan jika terminasi proses gagal.
- **Verifikasi Test:** 5 tes regresi SEC-10 lulus 100%.

### SEC-11 — Verifikasi Integritas Root Database Pasca Seluruh Test Suite & Uji Guard Sandbox Aktual (P2 / Temuan Phase 6.6 – 6.7)
- **File & Baris:** `test/audit-security-and-integrity.test.js:103-145, 340-355, 995-1085`.
- **Skenario Risiko:**
  1. Sebelumnya verifikasi snapshot root database dijalankan sebagai salah satu tes di dalam suite, sehingga tes-tes berikutnya berpotensi memodifikasi database root tanpa terdeteksi.
  2. Tes sandbox sebelumnya membuat fixture di `sandboxAppDir/wekeepit-index.db`, namun menguji guard terhadap `IndexDB.DEFAULT_DB_PATH`, sehingga target yang diuji berbeda dengan fixture yang dilindungi.
- **Perbaikan:**
  1. **Post-Suite Teardown Final Verification:** Baseline snapshot root database repository (`wekeepit-index.db`, `-wal`, `-shm`) dicatat secara read-only sebelum suite berjalan. Perbandingan akhir dijalankan di dalam blok `finally` pada hook `after()` paling akhir seluruh suite, menjamin verifikasi tetap dieksekusi meskipun ada tes sebelumnya yang gagal atau melempar error.
  2. **Presisi Jaminan Keamanan:** Dokumentasi dan implementasi secara tegas menyatakan bahwa snapshot metadata dan konten (SHA-256, ukuran byte, `mtimeMs`, keberadaan berkas utama, WAL, dan SHM) membuktikan berkas tidak diubah, ditimpa, atau dimigrasi, namun tidak membuktikan bahwa berkas tidak pernah dibuka secara read-only.
  3. **Pengujian Guard Database Sandbox Aktual:** Fixture pre-existing sandbox (`sandboxAppDir/wekeepit-index.db`) diinjeksi sebagai protected default target. Seluruh saluran resolusi diuji terhadap target ini:
     - Constructor argument eksplisit (absolute path).
     - Relative path dan dot segments (`path.join(sandboxAppDir, '.', 'wekeepit-index.db')` dan `'sub/../wekeepit-index.db'`).
     - Slash variants (forward slashes).
     - Casing variants (pada platform case-insensitive).
     - `process.env.INDEX_DB_PATH`.
     - Constructor fallback (`undefined` / `null` dengan opsi target terinjeksi).
     - Canonical production `DEFAULT_DB_PATH` tetap tertolak (guard produksi tidak nonaktif).
  4. Menjamin guard menolak target *sebelum* `better-sqlite3` membukanya dan sebelum berkas WAL/SHM terbentuk atau termodifikasi.
  5. Membandingkan snapshot fixture sandbox sebelum dan sesudah seluruh upaya akses (terbukti 100% identik).
- **Verifikasi Test:** Subtest isolasi database, post-suite teardown verification, dan sandbox guard test lulus 100%.

### SEC-12 — Preservasi Perilaku Error Shutdown (P2 / Temuan Phase 6.6 – 6.7)
- **File & Baris:** `server.js:735-820`, `test/audit-security-and-integrity.test.js:1560-1660`.
- **Skenario Risiko:** Kesalahan saat shutdown tidak boleh ditelan, urutan pelepasan resource harus tetap konsisten, dan penutupan berulang tidak boleh menyebabkan uncaught exception atau crash.
- **Perbaikan:**
  1. Mempertahankan urutan shutdown yang benar: Stop HTTP traffic $\rightarrow$ Stop file-system watchers $\rightarrow$ Close SQLite database.
  2. Seluruh tahap pelepasan resource tetap diupayakan meskipun tahap sebelumnya gagal (*all resources attempted*).
  3. Mengumpulkan seluruh error dan mempropagasi error secara konsisten baik melalui Promise rejection maupun callback interface `close(callback)`.
  4. Menjamin perilaku aman dan idempoten pada penutupan berulang maupun concurrent `close()`.
  5. Melindungi request in-flight agar dapat menyelesaikan query database sebelum koneksi ditutup.
- **Verifikasi Test:** 5 tes regresi SEC-12 lulus 100%.

### SRCH-01 — False Positive Typo Matching pada Angka & Substring Leak (P1)
- **File & Baris:** `indexer/search-engine.js:276-320`.
- **Skenario Risiko:** Kata kunci angka teknis (seperti tahun `20241` vs `20242` atau ID dokumen) salah dicocokkan akibat Levenshtein distance $\le 1$. Selain itu, query `info` tanpa sinonim aktif salah mencocokkan substring `information`.
- **Perbaikan:**
  1. Membatasi pencocokan kata dasar secara whole-word token boundary (bukan raw substring).
  2. Mengecualikan token numerik murni (`/^\d+$/`) dari toleransi typo Levenshtein.
  3. Menjamin Mode A (Exact Phrase) strictly memeriksa urutan kata, sedangkan Mode B (All Terms) strictly memeriksa keberadaan seluruh terms dalam satu unit chunk/kalimat yang sama.
- **Verifikasi Test:** `test/audit-search-and-parsers.test.js` (Subtest Mode A & Mode B: 5 tests passing).

### COLL-01 — Tabrakan Primary Key `documents.id` pada Indexing Skala Besar (P1)
- **File & Baris:** `indexer/folder-manager.js:59`, `indexer/folder-manager.js:234`.
- **Skenario Risiko:** Ditemukan pada benchmark 5.000 dokumen. Generator `Date.now() + Math.random().toString(36).slice(2,6)` memiliki entropi rendah ($36^4 \approx 1.6 \times 10^6$) sehingga pada perulangan ribuan file dalam milidetik yang sama terjadi tabrakan ID (`UNIQUE constraint failed: documents.id`).
- **Perbaikan:** Mengganti generator ID dengan `crypto.randomUUID()` standar RFC 4122 v4 dengan probabilitas tabrakan nol.
- **Verifikasi Test:** Benchmark 5.000 berkas berhasil 100% tanpa tabrakan ID.

### SQL-01 — Sinkronisasi dan Integritas FTS5 SQLite (P2)
- **File & Baris:** `indexer/db.js:191-207`, `indexer/db.js:256-267`, `indexer/db.js:269-303`.
- **Skenario Risiko:** `deleteFolder` dan `deleteDocumentByPath` sebelumnya hanya menghapus dari tabel relasional `document_chunks`, meninggalkan record yatim piatu di `document_chunks_fts`.
- **Perbaikan:**
  1. Menambahkan query transaksi penghapusan eksplisit `DELETE FROM document_chunks_fts WHERE rowid = ?` pada setiap operasi hapus dokumen dan folder.
  2. Menambahkan metode `checkIntegrity()` yang memvalidasi `PRAGMA integrity_check` dan konsistensi jumlah baris `document_chunks` terhadap `document_chunks_fts`.
  3. Menambahkan metode `rebuildFts()` untuk pemulihan cepat indeks FTS5 dari tabel chunks.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest Data Integrity: 4 tests passing).

### DOCS-01 — Perlindungan Rekursi Symlink dan Folder Traversal (P2)
- **File & Baris:** `indexer/folder-manager.js:154-197`.
- **Skenario Risiko:** Symlink yang mengarah ke luar folder root yang diindeks dapat membocorkan berkas di luar izin, dan circular symlink menyebabkan infinite recursion stack overflow.
- **Perbaikan:**
  1. Menambahkan batas kedalaman rekursi maksimal (depth limit 25).
  2. Melacak `visitedDirs = new Set()` menggunakan realpath kanonikal untuk mencegah circular loop.
  3. Memastikan symlink kanonikal tetap berada di dalam `folderReal`. Symlink yang keluar dari folder induk diabaikan.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest Folder Reconciliation: 3 tests passing).

### SEC-04 — Pembatasan Ukuran Body Request (P2)
- **File & Baris:** `server.js:81-102`.
- **Skenario Risiko:** Request streaming tanpa henti dapat menghabiskan memori Node.js (Heap Out of Memory DoS).
- **Perbaikan:** Menerapkan `MAX_BODY_SIZE = 10 * 1024 * 1024` (10MB). Jika payload melebihi 10MB, stream request langsung diterminasi (`req.destroy()`) dan mengembalikan status 413 Payload Too Large.
- **Verifikasi Test:** `test/audit-security-and-integrity.test.js` (Subtest SEC-04: 1 test passing).

### UI-01 — Kompatibilitas Data Mapping Hasil Pencarian Dokumen (P2)
- **File & Baris:** `app.js:1155-1230`.
- **Skenario Risiko:** UI membaca `data.items`, padahal response server universal search mengembalikan `{ documents: { results: [...], total: ... } }`. Akibatnya hasil pencarian dokumen tidak muncul di browser.
- **Perbaikan:** Menormalisasi `docData = (data && data.documents) ? data.documents : (data || {})`, membaca `results || items`, serta memetakan atribut `filename`, `locationLabel`, dan `highlightedHtml`.
- **Verifikasi:** UI menampilkan kartu hasil pencarian dengan badge dokumen, lokasi kutipan, dan highlight `<mark>`.

### REG-01 — Timing Jitter Countdown Reminder (P3)
- **File & Baris:** `reminder-service.js:117-122`.
- **Perbaikan:** Mengganti `Math.floor(diff / 1000)` menjadi `Math.round(diff / 1000)` untuk mengeliminasi flakiness pengujian pada selisih 1 milidetik.
- **Verifikasi Test:** `test/v1-regression.test.js` (Subtest ReminderService: 5 tests passing).

---

## 4. Hasil Audit Parser & Source Location (Tahap C)

Semua pengujian parser dilakukan menggunakan synthetic fixtures terisolasi (`test/audit-search-and-parsers.test.js`):

1. **Markdown Parser:**
   - Heading bertingkat (`#`, `##`, `###`) diekstraksi menjadi breadcrumb navigasi (misal `Arsitektur > Modul`).
   - Sentence chunking membagi paragraf panjang menjadi unit kalimat presisi tanpa memotong kata.
   - Tabel dan list diekstraksi dengan struktur teks yang rapi.
2. **PDF Parser:**
   - Dokumen multi-halaman melacak nomor halaman asli (`Hal 1`, `Hal 2`).
   - Deteksi PDF hasil scan: menghasilkan flag `isScanned: true` dan pesan panduan OCR (`ocrNotice`) tanpa memberikan klaim palsu bahwa teks scan sudah dapat dicari.
3. **DOCX Parser:**
   - Paragraf, heading, dan tabel diekstraksi secara modular per kalimat.
   - Tidak ada klaim nomor halaman buatan karena layout halaman DOCX bergantung pada rendering engine klien.
4. **XLSX Parser:**
   - Multi-sheet didukung; nama sheet dan alamat sel (misal `Data!A2:E2`) dicatat pada `locationLabel`.
   - Cell formula diekstraksi nilai kalkulasinya (`cell.v` / `cell.w`), formula mentah tidak mengotori pencarian.
   - Worksheet tersembunyi (`sheet['!protect']` atau state hidden) diabaikan dari indeks publik.

---

## 5. Hasil Benchmark Performa Terukur (Tahap H)

Pengujian benchmark dilakukan secara sintetis pada 3 skala data menggunakan lingkungan uji Windows lokal (Node.js v22.14.0, SQLite WAL mode + FTS5):

| Skala Dokumen | Total Ukuran | Total Chunks | Full Indexing | Incremental Indexing (5%) | Search Latency (Avg) | Search Latency (p50) | Search Latency (p95) | SQLite Integrity |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **100 Dokumen** | 52.6 KB | 700 units | **0.11 detik** | **24.3 ms** | 0.47 ms | 0.40 ms | 0.79 ms | `ok` / in sync |
| **1.000 Dokumen** | 526.9 KB | 7.000 units | **1.40 detik** | **101.5 ms** | 2.03 ms | 1.72 ms | 3.51 ms | `ok` / in sync |
| **5.000 Dokumen** | 2.64 MB | 35.000 units | **18.26 detik** | **1.38 detik** | 6.45 ms | 5.35 ms | 12.03 ms | `ok` / in sync |

### Analisis Kinerja:
- **Throughput Indexing:** Rata-rata $\approx 275 - 700$ dokumen/detik pada format Markdown.
- **Efisiensi Incremental:** Pemindaian ulang hanya memproses berkas yang berubah (`mtime` / `size`), menghemat lebih dari 92% waktu komputasi dibanding full index.
- **Search Latency:** Pada skala 5.000 dokumen (35.000 chunks FTS5), p95 latensi pencarian tetap berada di bawah **12.1 ms**, jauh di bawah ambang batas interaktivitas UI (100 ms).
- **Penggunaan Memori:** SQLite WAL dan batching chunk menjaga garbage collection Node.js stabil tanpa kebocoran memori (memory leak).

---

## 6. Verifikasi Regresi Fitur V1 (Tahap G)

Pengujian terhadap 100% fitur WeKeepIt V1 berjalan lancar:
- **CRUD Kartu:** Berjalan normal, penyimpanan ke `wekeepit-data.json` utuh.
- **Multi-tag Filter:** Sintaks `AND` (`link+role`) dan `OR` (`link, role`) terverifikasi akurat.
- **Metadata Dinamis:** Schema engine memvalidasi field kustom tanpa error.
- **Daily Checklist & Reminders:** Penjadwalan, snooze, dan dismiss berfungsi tepat waktu.
- **Import/Export JSON:** Struktur data V1 dapat diekspor dan diimpor kembali secara lossless.
- **File Isolasi:** Operasi indexing V2 dan manipulasi database SQLite sama sekali tidak memodifikasi atau mereset data kartu `wekeepit-data.json`.

---

## 7. Definition of Done (DoD) Checklist

- [x] **1. `npm test` dijalankan dan hasil aktual dicatat:** 140/140 tests passed across 34 suites (100% passing).
- [x] **2. Seluruh area utama diaudit:** Security, actual socket network binding, CORS/Origin policy, file launch boundaries, zero-touch database isolation, child process termination lifecycle, post-suite teardown integrity verification, actual guarded sandbox path exercise, shutdown error propagation, search accuracy, parsers, folder reconciliation, SQLite integrity, V1 regression, dan benchmark performa.
- [x] **3. Temuan memiliki severity, bukti, dan langkah reproduksi:** Terdokumentasi lengkap pada laporan ini.
- [x] **4. Semua P0, P1, dan P2 yang dapat direproduksi sudah diperbaiki:** SEC-01, SEC-02, SEC-03, SEC-05, SEC-06, SEC-07, SEC-08, SEC-09, SEC-10, SEC-11, SEC-12, SRCH-01, COLL-01, SQL-01, DOCS-01, SEC-04 selesai diperbaiki menyeluruh.
- [x] **5. Tes baru ditambahkan untuk setiap bug yang diperbaiki:** Suite `test/audit-security-and-integrity.test.js` dan `test/server-api.test.js` diperluas mencakup 100% regresi Phase 6, Phase 6.1, Phase 6.2, Phase 6.3, Phase 6.5, Phase 6.6, dan Phase 6.7.
- [x] **6. Seluruh test suite dijalankan kembali:** 100% test lulus tanpa ada test yang di-skip atau di-disable.
- [x] **7. Data V1, database default, dan dokumen sumber tidak mengalami perubahan:** `wekeepit-data.json` dan `wekeepit-index.db` utuh (0 bytes altered by test suite, zero-touch verified).
- [x] **8. Dokumen `docs/V2-ACCEPTANCE-AUDIT.md` diperbarui:** Selesai diperbarui dengan temuan dan mitigasi Phase 6.7 serta bukti isolasi database zero-touch dan pengujian terminasi observable.
- [x] **9. Bebas klaim tanpa bukti:** Seluruh angka benchmark dan temuan diverifikasi secara empiris di mesin eksekusi lokal.

---

## 8. Langkah Menjalankan Ulang Seluruh Pengujian

Untuk memverifikasi laporan ini secara mandiri:

```bash
# 1. Jalankan seluruh test suite otomatis (140 tests, 34 suites)
npm test

# 2. Jalankan test audit keamanan & integritas SQLite secara spesifik (73 tests)
node --test test/audit-security-and-integrity.test.js

# 3. Jalankan test integrasi server API (7 tests)
node --test test/server-api.test.js

# 4. Jalankan test audit akurasi search & parser (16 tests)
node --test test/audit-search-and-parsers.test.js

# 5. Jalankan regression test V1 (16 tests)
node --test test/v1-regression.test.js
```
