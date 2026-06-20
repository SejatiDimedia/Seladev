# Walkthrough — Monorepo Bootstrap

Dokumen ini mencatat langkah-langkah pengembangan yang telah diselesaikan untuk inisialisasi basis kode monorepo **SELADEV Internal Developer Platform (IDP)**.

---

## 1. Struktur Monorepo (pnpm Workspace & Turborepo)
Kami telah menyiapkan konfigurasi monorepo untuk mengelola aplikasi backend, frontend, serta pustaka kode bersama (shared packages).

- **[pnpm-workspace.yaml](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/pnpm-workspace.yaml)**: Mendefinisikan ruang kerja untuk aplikasi (`apps/*`) dan paket bersama (`packages/*`).
- **[package.json](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/package.json)** (Root): Menambahkan dependensi manajemen (TypeScript, Turborepo, ESLint) dan skrip global (`dev`, `build`, `lint`, `test`).
- **[tsconfig.base.json](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/tsconfig.base.json)**: Menyediakan konfigurasi compiler TypeScript bersama dengan mode strict (`strict: true`, `noImplicitAny: true`, `skipLibCheck: true`) dan pemetaan path (`@seladev/*`).
- **[turbo.json](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/turbo.json)**: Mengatur pipeline build task caching.
- **[docker-compose.yml](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/docker-compose.yml)**: Mengonfigurasi container local dev untuk MongoDB (v7.0) dan Redis (v7.2).

---

## 2. Shared Packages (`packages/`)
Paket-paket ini berfungsi sebagai dependensi lokal yang diimpor oleh aplikasi API dan Web secara type-safe.

- **[@seladev/types](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/packages/types/src/index.ts)**: Menyediakan semua tipe TypeScript entitas sistem (User, Org, Project, Environment, Secret, ApiKey, Deployment, Webhook, AuditLog, Notification, RBAC).
- **[@seladev/validators](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/packages/validators/src/index.ts)**: Menyediakan schema validasi Zod untuk sisi backend (request validation) dan frontend (form schemas).
- **[@seladev/utils](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/packages/utils/src/index.ts)**: Kumpulan utility pure-function (byte/duration formatting, masking secrets, array helpers, dan sistem konstanta).

---

## 3. Aplikasi Backend API (`apps/api/`)
Sebuah API server berbasis Express.js dengan TypeScript yang mengikuti standard Clean Architecture.

- **[apps/api/package.json](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/package.json)**: Menyertakan dependensi Express, Mongoose, Redis, BullMQ, Socket.IO, JWT, dan Bcrypt.
- **[src/config/index.ts](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/src/config/index.ts)**: Melakukan parsing dan validasi ketat environment variables (`process.env`) menggunakan Zod.
- **src/config/database.ts & src/config/redis.ts**: Handler koneksi Mongoose MongoDB & Redis dengan event monitoring.
- **[src/config/socket.ts](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/src/config/socket.ts)**: Inisialisator adapter Socket.IO.
- **[src/lib/errors.ts](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/src/lib/errors.ts)**: Implementasi hierarki Error Class kustom (`BaseError`, `NotFoundError`, `ValidationError`, dll.).
- **[src/middleware/error-handler.ts](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/src/middleware/error-handler.ts)**: Global error formatter untuk standardisasi respons client.
- **[src/middleware/validate-request.ts](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/src/middleware/validate-request.ts)**: Factory middleware validasi request params/query/body.
- **[src/app.ts](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/src/app.ts)**: Inisialisasi Express app dengan middleware keamanan (Helmet, CORS) dan endpoints `/health` & `/health/ready`.
- **[src/server.ts](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/src/server.ts)**: Titik masuk utama server untuk bootstrapping database dan shutdown handler secara anggun (graceful shutdown).
- **[.env.example & .env](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/.env)**: Konfigurasi default lokal.

---

## 4. Aplikasi Frontend Web (`apps/web/`)
Single Page Application (SPA) berbasis React yang di-bundle menggunakan Vite.

- **Vite & Tailwind config**: Penyiapan aliases path (`@/*`), dark-mode, dan desain token HSL di [tailwind.config.js](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/web/tailwind.config.js).
- **[src/index.css](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/web/src/index.css)**: Integrasi Tailwind dan penambahan custom style helper (glassmorphism dan custom scrollbar).
- **[src/main.tsx](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/web/src/main.tsx)**: React root entry wrapper untuk `QueryClientProvider` dan `BrowserRouter`.
- **[src/app/App.tsx](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/web/src/app/App.tsx)**: Desain halaman dashboard inisiasi premium untuk membuktikan integrasi CSS dan komponen berjalan dengan baik.

---

## 5. Modul Identity & Access (Auth, Orgs, dan RBAC)
Kami telah menerapkan infrastruktur keamanan tingkat lanjut untuk identitas pengguna dan kontrol akses organisasi.

- **Mongoose Models**:
  - `user.model.ts`: Skema data pengguna dengan metode JSON transformer untuk menyembunyikan password hash dan data MFA.
  - `organization.model.ts`: Skema data tenant penyewa dengan pembatasan rencana (plan) dan kuota maksimum.
  - `membership.model.ts`: Pemetaan relasi User ↔ Organization ↔ Role dengan indeks komposit unik.
  - `refresh-token.model.ts`: Model penyimpan refresh token hash dengan indeks waktu kedaluwarsa (TTL index) untuk pembersihan otomatis.
- **Kriptografi & JWT (RS256)**:
  - `lib/crypto.ts`: Utilitas untuk enkripsi password bcrypt (12 rounds), hashing SHA-256 untuk token, dan penurunan kunci organisasi deterministik (HKDF).
  - `lib/jwt.ts`: Pembangkit dan verifikator token akses menggunakan algoritma kunci asimetris RS256. Dilengkapi fitur *self-healing* yang otomatis memproduksi pasangan kunci RSA baru secara lokal jika kunci `.env` masih dummy.
- **Fitur Autentikasi (`src/features/auth/`)**:
  - Menyediakan workflow registrasi (`/register`), masuk (`/login`), keluar (`/logout`), perputaran token (`/refresh`), dan penggantian password (`/password`).
  - Menerapkan **Refresh Token Rotation (RTR)** secara penuh dengan pengawasan pemakaian ulang (*reuse detection*) yang secara otomatis membatalkan seluruh keluarga token (*token family*) jika terindikasi adanya serangan pemutaran ulang token.
- **Fitur Organisasi (`src/features/organizations/`)**:
  - Menyediakan layanan pembentukan organisasi, pencarian data org, undangan anggota, pembaruan hak akses, dan pemecatan anggota.
  - Memproteksi hak pencipta agar tidak bisa menghapus diri sendiri jika merupakan satu-satunya owner aktif (*sole owner validation*).
- **Middlewares Keamanan (`src/middleware/`)**:
  - `authenticate-jwt.ts`: Memvalidasi JWT di header Authorization dan memeriksa daftar cekkal (*blocklist*) sesi aktif di Redis.
  - `authorize-rbac.ts`: Middleware dinamis untuk memvalidasi tingkatan akses pengguna pada dua tingkat (organisasi dan proyek).

### 5.1 Multi-Factor Authentication (MFA / TOTP)
Kami menambahkan lapisan pengamanan tambahan menggunakan **TOTP (RFC 6238)** dan backup recovery codes:
- **AES-256-GCM Encryption**: Rahasia TOTP (*TOTP secret*) disimpan dalam kondisi terenkripsi di database menggunakan algoritma AES-256-GCM. Kunci enkripsi diturunkan secara deterministik dari master key dan organizationId (atau platform default key jika user belum terasosiasi organisasi).
- **Setup & Aktivasi**:
  - `POST /auth/mfa/setup`: Membuat TOTP secret baru, memformat URI `otpauth://`, dan menghasilkan QR Code dalam format Data URL (base64) untuk ditampilkan di frontend.
  - `POST /auth/mfa/activate`: Memverifikasi kode OTP pertama dari pengguna. Jika valid, sistem akan menghasilkan **8 buah backup recovery codes** (masing-masing 10 karakter heksadesimal) yang di-hash menggunakan bcrypt untuk disimpan di DB dan hanya ditampilkan satu kali ke pengguna.
- **Login Flow Integration**:
  - `POST /auth/login` dimodifikasi: jika pengguna mengaktifkan MFA, server tidak langsung mengembalikan token akses melainkan mengembalikan response `{ requiresMfa: true, mfaToken }` dengan token sementara berumur 3 menit (`mfa_pending`).
  - `POST /auth/login/mfa`: Endpoint khusus untuk memverifikasi kode OTP (atau backup recovery code) bersama dengan token sementara untuk menyelesaikan proses masuk.
- **Org-level MFA Enforcement**:
  - Jika suatu organisasi mengaktifkan pengaturan `settings.mfaRequired: true`, middleware `authenticateJwt` akan secara otomatis memblokir request pengguna yang belum mengaktifkan MFA dengan respon `403 Forbidden` (`MFA_REQUIRED`), kecuali untuk rute-rute autentikasi akun sendiri agar mereka tetap bisa melakukan setup MFA.

### 5.2 Projects, Environments, dan Project Memberships (Phase 1.2)
Kami merancang dan mengimplementasikan modul inti manajemen proyek dan isolasi konfigurasi sesuai dengan spesifikasi teknis:
- **Project CRUD & Auto-provisioning**:
  - `POST /api/v1/organizations/:orgIdOrSlug/projects`: Membuat proyek baru. Slugs proyek unik per organisasi (melalui compound unique index `{ organizationId: 1, slug: 1 }`).
  - Secara otomatis memicu inisialisasi **3 default environments**: `development` (tidak proteksi), `staging` (tidak proteksi), dan `production` (`isProtected: true` secara bawaan).
  - Mendaftarkan pembuat proyek sebagai administrator proyek (`admin` role) dalam tabel `projectMembers`.
  - Memvalidasi pembatasan jumlah proyek maksimum berdasarkan konfigurasi limit organisasi (`settings.maxProjects`).
- **Isolasi Environments & Variables**:
  - Menyediakan endpoint pembuatan custom environment dengan inferensi otomatis tipe environment berdasarkan penamaan (`development` | `staging` | `production`).
  - Menyimpan variabel konfigurasi non-sensitif secara terbenam (*embedded array*) di dalam dokumen environment untuk mempercepat pembacaan data konfigurasi dalam satu kueri tunggal (*avoiding additional database joins*).
  - Melindungi data pada environment sensitif/protected: perubahan variabel di production memerlukan status kepemilikan administrator (`project:admin` atau `org:admin/owner`).
  - Mencegah penghapusan environment bertipe `production` atau yang memiliki flag proteksi (`isProtected`).
- **Manajemen Keanggotaan Proyek (Project Membership)**:
  - Menyediakan workflow penambahan, pembaruan peran (*role*), dan penghapusan anggota dari proyek.
  - Memvalidasi agar pengguna harus merupakan anggota aktif organisasi induk sebelum ditambahkan ke proyek.
  - Melindungi integritas kepemimpinan proyek dengan melarang penggantian peran atau penghapusan administrator proyek tunggal (*sole project admin safety validation*).
- **Pengujian Terotomatisasi (Vitest Suite)**:
  - Membuat 13 skenario tes integrasi menyeluruh di `src/features/projects/__tests__/projects.test.ts` untuk memvalidasi limit proyek, tabrakan slug, inisialisasi default env, proteksi variabel, serta konsistensi administrator tunggal. Seluruh skenario tes berhasil lulus cleanly.

---


## 6. Resolusi Hambatan Kompilasi (Build Fixes)
Kami menyelesaikan beberapa hambatan kompilasi TypeScript agar seluruh workspace monorepo terkompilasi bersih tanpa error:
- **Konfigurasi Path Monorepo (`TS6059`)**: Mengarahkan pemetaan `paths` di `apps/api/tsconfig.json` ke file deklarasi compiled `.d.ts` di dalam folder `dist` paket lokal, alih-alih mengarah langsung ke sumber `.ts` asli yang berada di luar direktori `rootDir`.
- **Deklarasi Tipe Aplikasi (`TS2742`)**: Menonaktifkan pembuatan file `.d.ts` (`declaration: false`) untuk aplikasi server `apps/api`, karena file deklarasi tipe tidak diperlukan untuk aplikasi leaf node (non-pustaka). Ini menghilangkan error tipe portabilitas router Express.
- **Konstrain Serialisasi Mongoose (`TS2790`)**: Melakukan casting `ret as any` pada transformer `.toJSON()` model `User`, `Organization`, `Membership`, dan `RefreshToken` untuk menghindari kesalahan typescript saat melakukan perintah `delete` pada properti wajib/opsional.
- **Penyelarasan Tipe Tanggal Mongoose**: Mengecualikan properti `lastLoginAt` dan `joinedAt` dari pewarisan tipe package dan mendeklarasikannya sebagai objek `Date | null` di tingkat Model Document agar selaras dengan tipe runtime Mongoose.
- **Keselarasan ValidationError & Dummy Credentials**: Menyesuaikan parameter argumen instansiasi `ValidationError` dan mengganti inisialisasi dummy UUID webcrypto dengan dummy ObjectId 24-karakter heksadesimal standar agar lolos validasi database.

---

### 5.3 Secrets Management & Secret Versioning (Phase 1.3 & Phase 2.3)
Kami merancang dan mengimplementasikan fitur manajemen rahasia terenkripsi (Secrets) dan pelacakan versi rahasia (Secret Versioning) secara terisolasi dan aman:
- **Enkripsi Kunci Turunan Organisasi (Per-Org Derived Keys)**:
  - Secrets dienkripsi dengan algoritma **AES-256-GCM**.
  - Kunci enkripsi diturunkan secara dinamis menggunakan **HMAC-SHA256** dari `MASTER_ENCRYPTION_KEY` dan `organizationId`. Hal ini membatasi dampak kebocoran (*blast radius isolation*) di tingkat organisasi tanpa perlu menyimpan kunci per-organisasi di database.
  - Setiap enkripsi menggunakan **Initialization Vector (IV) 12-byte acak** dan menghasilkan **Authentication Tag 16-byte** untuk mendeteksi perubahan data ilegal secara real-time (*tampering detection*).
- **Masking pada Operasi List & Reveal Terpisah**:
  - `GET /projects/:projectId/environments/:envId/secrets` mengembalikan daftar rahasia dengan nilai terselubung (`value: "****"`) untuk semua peran. Teks asli tidak pernah dikirim pada operasi pencarian massal.
  - `POST /projects/:projectId/secrets/:secretId/reveal` didekripsikan secara eksplisit dan hanya mengembalikan nilai asli ke klien jika pengguna memiliki otorisasi yang sah.
- **Proteksi Tingkat Lingkungan (Environment Protection)**:
  - Perubahan (create/update/delete) dan pengungkapan (reveal) rahasia di dalam protected environment (seperti `production`) dibatasi hanya untuk pengguna dengan wewenang administrator (`project:admin` atau `org:admin/owner`).
  - Pengembang biasa (`project:developer`) diperbolehkan melihat metadata rahasia (list), namun ditolak jika mencoba melakukan reveal atau modifikasi.
- **Riwayat Versi (Versioning) & Rollback**:
  - Setiap operasi penulisan (create/update/rollback) secara otomatis meningkatkan nomor versi dan menyisipkan dokumen versi immutable baru ke dalam koleksi `secretversions`.
  - Operasi rollback (`POST /projects/:projectId/secrets/:secretId/rollback`) memulihkan nilai rahasia ke versi lama tertentu. Tindakan ini dicatat sebagai versi baru (misal memulihkan v1 pada secret berversi v3 akan membuat v4 dengan nilai sama dengan v1) untuk menjaga konsistensi sejarah penulisan rahasia.
- **Pengujian Terotomatisasi (Vitest Suite)**:
  - Membuat 15 skenario tes integrasi menyeluruh di `src/features/secrets/__tests__/secrets.test.ts` untuk memverifikasi fungsionalitas enkripsi GCM, batasan role berdasarkan tipe environment, perputaran versi, rollback, dan penghapusan kaskade. Seluruh skenario tes berhasil lulus cleanly.

### 5.4 API Keys & Environment Scoping (Phase 3.4 & Phase 4.4)
Kami merancang dan mengimplementasikan fitur autentikasi mesin-ke-mesin menggunakan API Keys dengan pembatasan lingkup proyek dan lingkungan secara ketat:
- **Format API Key Premium (Base58)**:
  - API Key dihasilkan dengan format `sdv_sk_` diikuti oleh 32 random bytes yang di-encode menggunakan Base58 (`sdv_sk_<base58_entropy>`).
  - Base58 dipilih karena mengeliminasi karakter yang membingungkan secara visual (seperti `0`, `O`, `I`, `l`) dan aman untuk URL.
- **Penyimpanan Hashing SHA-256 (Tanpa Menyimpan Plaintext)**:
  - Demi keamanan tingkat tinggi, plaintext key **hanya dikembalikan sekali saja** saat pembuatan key dan tidak dapat diambil kembali.
  - Di database, hanya SHA-256 hash dari key tersebut yang disimpan. Proses lookup saat autentikasi mencocokkan SHA-256 hash dengan waktu lookup O(1) yang cepat dan aman dari timing attacks.
- **Middlewares API Key & Scope Intersections**:
  - `authenticateJwt` mendeteksi token dengan prefiks `sdv_sk_` dan memvalidasi keaktifan serta waktu kedaluwarsanya.
  - Memeriksa irisan cakupan izin API Key (`secrets:read`, `secrets:write`, dll.) dengan metode HTTP dan path request.
  - Mewarisi peran organisasi dari pemilik kunci untuk mencegah eskalasi hak istimewa (*privilege escalation*).
- **Pembatasan Lingkup Proyek & Lingkungan (Project & Environment Scoping)**:
  - API Key dapat dibatasi ke tingkat organisasi (akses semua proyek), ke proyek tertentu (`projectId`), atau bahkan ke lingkungan tertentu saja (`environmentId` - misalnya hanya boleh mengakses `development`).
  - Aturan ini diverifikasi secara berlapis di tingkat middleware autentikasi dan langsung di dalam `SecretsService` untuk memastikan integritas data. Jika dilanggar, API mengembalikan respons `403 Forbidden` (`ForbiddenError`).
- **Pengujian Terotomatisasi (Vitest Suite)**:
  - Membuat 15 skenario tes integrasi menyeluruh di `src/features/api-keys/__tests__/api-keys.test.ts` untuk menguji pembuatan, hashing, penonaktifan, pembatasan scope, dan penolakan akses lintas proyek/lingkungan. Seluruh tes berhasil lulus (total **49 passed tests** di seluruh suite).

### 5.5 Deployments Module & BullMQ Simulated Pipeline (Phase 3.5)
Kami merancang dan mengimplementasikan modul Deployment terintegrasi untuk menangani pipeline pembangunan (build pipeline) berbasis simulasi, lengkap dengan notifikasi real-time dan mekanisme persetujuan manual:
- **Model & Skema Mongoose (`deployment.model.ts`)**:
  - Menyimpan metadata deployment lengkap termasuk `organizationId`, `projectId`, `environmentId`, `version`, `branch`, `commitSha`, `commitMessage`, `status`, `statusHistory`, `triggeredBy`, `triggeredVia`, `buildLogs`, `duration`, `errorMessage`, dan `completedAt`.
  - Dilengkapi dengan *compound index* `{ projectId: 1, _id: -1 }` untuk memfasilitasi pencarian riwayat deployment secara urut dan efisien.
- **Antrean Pekerjaan BullMQ & In-Process Workers (`config/queue.ts` & `workers/deployment.worker.ts`)**:
  - Mengonfigurasi antrean BullMQ (`deployments`) yang terikat ke koneksi Redis.
  - Untuk lingkungan non-produksi (development/test), worker otomatis berjalan *in-process* di dalam proses utama server Express saat server melakukan booting (`startAllWorkers` di `server.ts`).
- **Simulasi Siklus Hidup & Socket.IO Streaming Logs**:
  - Worker menyimulasikan build pipeline melalui serangkaian transisi status: `queued` ➔ `building` ➔ `deploying` ➔ `success` / `failed`.
  - Selama fase `building` dan `deploying`, log build ditulis secara berkala ke database dan dipancarkan (*broadcast*) secara real-time ke room Socket.IO organisasi (`org:${orgId}`) dengan format event `deployment:log` dan `deployment:status_changed`.
  - Socket.IO handshake dikonfigurasi untuk memvalidasi JWT token dan secara otomatis memasukkan klien ke room organisasi yang sesuai (`org:${orgId}`).
- **Mekanisme Persetujuan Manual (Manual Approval Gate)**:
  - Jika suatu environment bertipe dilindungi (`isProtected: true`) dan pengaturan proteksi proyek diaktifkan (`settings.deploymentProtection: true`), deployment baru yang di-trigger akan tertahan dengan status `pending_approval`.
  - Hanya pengguna dengan peran administratif (`project:admin` atau `org:admin/owner`) yang diizinkan menyetujui (`POST /projects/:projectId/deployments/:id/approve`) untuk memasukkannya ke antrean BullMQ, atau menolaknya (`POST /projects/:projectId/deployments/:id/reject`) untuk membatalkan proses deployment.
- **Pengecekan Pembatalan (Cancellation Checkpoints)**:
  - Pengguna dapat membatalkan deployment yang sedang berjalan.
  - Jika pekerjaan masih berada dalam antrean BullMQ (status `queued`), pekerjaan dihapus langsung dari antrean BullMQ.
  - Jika pekerjaan sudah berjalan (status `building`), server menuliskan flag pembatalan di Redis (`deployment:cancel:${id}`). Worker secara berkala mengecek flag ini di setiap checkpoint transisi status dan menghentikan proses secara anggun (*graceful cancellation*) jika bendera pembatalan terdeteksi.
- **Pengujian Terotomatisasi (Vitest Suite)**:
  - Membuat 11 skenario tes integrasi komprehensif di `src/features/deployments/__tests__/deployments.test.ts` untuk memverifikasi fungsionalitas antrean BullMQ, pembatalan, validasi cabang (*branch validation*), persetujuan manual pada protected environment, dan pagination kursor. Seluruh tes berhasil lulus dengan bersih.

### 5.6 Audit Logs Module & Immutability Trail (Phase 3.7)
Kami merancang dan mengimplementasikan modul **Audit Logs** untuk mencatat setiap aktivitas sensitif atau perubahan konfigurasi di seluruh sistem secara andal (SOC2-compliant audit trail):
- **Model & Skema Mongoose (`audit-log.model.ts`)**:
  - Menyimpan metadata log audit yang terperinci: `organizationId`, `projectId` (opsional), `actor` (userId, email, ipAddress, userAgent), `action`, `resource` (type, id, name), `metadata` (konteks tambahan seperti perubahan nilai), `outcome` (`success` | `failure`), dan `createdAt`.
  - Dikonfigurasi dengan Write Concern `{ writeConcern: { w: 'majority', j: true } }` untuk menjamin ketahanan database yang tinggi.
  - Memiliki compound index untuk mempercepat pencarian filter historis:
    - `{ organizationId: 1, createdAt: -1 }` (default historical listing)
    - `{ organizationId: 1, action: 1, createdAt: -1 }` (action filter)
    - `{ organizationId: 1, 'actor.userId': 1, createdAt: -1 }` (actor filter)
    - `{ organizationId: 1, 'resource.id': 1, createdAt: -1 }` (resource filter)
- **Desain Repositori Imutabel (Immutability Enforcement)**:
  - Repositori log audit `AuditLogRepository` hanya mengekspos metode `create` dan `findMany`. Tidak ada fungsi `update`, `delete`, atau `clear` untuk menjamin sifat data log yang kekal (*immutable*), mencegah manipulasi data oleh pihak internal.
- **Pencatatan Asinkron Fire-and-Forget**:
  - Operasi pencatatan log audit via `AuditLogsService.record()` dijalankan secara asinkron non-blocking. Jika terjadi kegagalan penulisan log, error ditangkap secara internal (di-log ke konsol) dan tidak akan mengganggu atau memperlambat transaksi utama pengguna (*zero latency degradation*).
  - Jika detail email tidak diteruskan, service secara asinkron me-resolve email aktor berdasarkan `actor.userId` di latar belakang.
- **Integrasi Menyeluruh di Seluruh Call Sites**:
  - Diintegrasikan di seluruh titik perubahan data (mutasi):
    - **Authentication**: `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_changed`, `auth.mfa.enabled`, `auth.mfa.disabled`.
    - **Projects**: `project.created`, `project.updated`, `project.archived`, `project.member_added`, `project.member_removed`.
    - **Secrets**: `secret.created`, `secret.updated`, `secret.deleted`, `secret.revealed` (ketika user melihat isi plaintext secret, bukan ketika list metadata).
    - **API Keys**: `apiKey.created`, `apiKey.revoked`.
    - **Deployments & Workers**: `deployment.triggered`, `deployment.approved`, `deployment.rejected`, `deployment.cancelled`, `deployment.completed`, `deployment.failed` (baik melalui API controller maupun di dalam BullMQ worker).
- **Pembatasan Peran & Isolasi Multi-tenant**:
  - Hanya pengguna dengan peran `owner` atau `admin` pada organisasi induk yang dapat memanggil API log audit (`GET /api/v1/organizations/:orgIdOrSlug/audit-logs`). Anggota biasa (`member`/`viewer`) akan menerima respon `403 Forbidden`.
  - Otorisasi diverifikasi secara ketat berdasarkan `organizationId` pengguna untuk memastikan isolasi tenant.
- **Pengujian Terotomatisasi (Vitest Suite)**:
  - Membuat 7 skenario tes integrasi komprehensif di `src/features/audit-logs/__tests__/audit-logs.test.ts` untuk memverifikasi fungsionalitas pencatatan log audit asinkron, proteksi peran (RBAC), pembatasan multi-tenant, pencarian filter, dan cursor pagination base64. Seluruh tes berhasil lulus 100% (total **67 passed tests** di seluruh monorepo).

---

## Langkah Menjalankan Secara Lokal
1. Pastikan Docker Engine / Docker Desktop Anda aktif.
2. Jalankan database:
   ```bash
   docker compose up -d
   ```
3. Mulai server API dan Web dalam mode development:
   ```bash
   pnpm dev
   ```
   - API Server: `http://localhost:4000`
   - Web App: `http://localhost:3000` (atau port 5173 jika berjalan standalone)

