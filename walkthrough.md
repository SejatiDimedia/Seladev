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
