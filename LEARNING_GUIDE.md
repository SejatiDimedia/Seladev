# Panduan Belajar Kode Sumber (LEARNING GUIDE) — SELADEV Monorepo

Dokumen ini dirancang sebagai panduan belajar interaktif untuk membantu Anda memahami konsep, pola arsitektur, dan teknologi yang diimplementasikan dalam repositori **SELADEV**.

---

## Daftar Isi
1. [Arsitektur Monorepo (pnpm & Turborepo)](#1-arsitektur-monorepo-pnpm--turborepo)
2. [TypeScript Strict Mode & Konfigurasi Tingkat Lanjut](#2-typescript-strict-mode--konfigurasi-tingkat-lanjut)
3. [Aliran Data Clean Architecture](#3-aliran-data-clean-architecture)
4. [Validasi Data Terbagi (Shared Zod Validators)](#4-validasi-data-terbagi-shared-zod-validators)
5. [Sistem Penanganan Error Terpusat](#5-sistem-penanganan-error-terpusat)
6. [Desain Token CSS & Glassmorphic UI](#6-desain-token-css--glassmorphic-ui)
7. [Keamanan Autentikasi: Token Rotation & RBAC Dua Tingkat](#7-keamanan-autentikasi-token-rotation--rbac-dua-tingkat)
8. [Resolusi Kompilasi & Trik TypeScript Monorepo](#8-resolusi-kompilasi--trik-typescript-monorepo)
9. [Keamanan MFA / TOTP & Enkripsi AES-256-GCM](#9-keamanan-mfa--totp-enkripsi-aes-256-gcm)
10. [Manajemen Proyek, Lingkungan (Environments), dan Keanggotaan Proyek](#10-manajemen-proyek-lingkungan-environments-dan-keanggotaan-proyek)
11. [Manajemen Secrets & Riwayat Versi (Secrets & Versioning)](#11-manajemen-secrets--riwayat-versi-secrets--versioning)
12. [Modul API Keys & Autentikasi Mesin-ke-Mesin (Machine-to-Machine Auth)](#12-modul-api-keys--autentikasi-mesin-ke-mesin-machine-to-machine-auth)
13. [Pembatasan Lingkup API Keys (Project & Environment Scoping)](#13-pembatasan-lingkup-api-keys-project--environment-scoping)

---

## 1. Arsitektur Monorepo (pnpm & Turborepo)

### Apa itu Monorepo?
Monorepo adalah strategi di mana beberapa proyek (misalnya backend API, frontend Web, dan paket utilitas) disimpan dalam **satu repositori Git** yang sama.

### Cara Kerja di SELADEV:
Di dalam proyek ini, kita memiliki berkas `pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'      # Tempat aplikasi yang bisa dijalankan (API, Web)
  - 'packages/*'  # Tempat pustaka/kode pendukung (Types, Validators, Utils)
```

Dalam file `apps/api/package.json`, kita mengimpor paket pendukung menggunakan referensi workspace:
```json
"dependencies": {
  "@seladev/types": "workspace:*",
  "@seladev/validators": "workspace:*"
}
```
**Mengapa ini hebat?** Saat Anda mengubah tipe data di `packages/types`, aplikasi backend (`apps/api`) dan frontend (`apps/web`) akan langsung mendeteksi perubahan tersebut secara instan tanpa perlu mempublikasikannya ke npm registry publik.

### Turborepo (`turbo.json`)
Turborepo bertugas menjalankan perintah (seperti `build` atau `lint`) secara paralel dan memanfaatkan cache.
* Jika Anda menjalankan `pnpm build` dan tidak ada berkas yang berubah sejak kompilasi terakhir, Turborepo akan langsung menampilkan hasil kompilasi dari cache dalam hitungan milidetik (*Zero Time Build*).

---

## 2. TypeScript Strict Mode & Konfigurasi Tingkat Lanjut

Semua konfigurasi utama diletakkan di `tsconfig.base.json` dan diwarisi oleh aplikasi di bawahnya menggunakan `"extends": "../../tsconfig.base.json"`.

### Opsi Compiler Kritis yang Harus Dipelajari:

1. **`strict: true`**
   Mengaktifkan sekumpulan pemeriksaan tipe data yang sangat ketat untuk memastikan tidak ada kesalahan logika penulisan tipe data.

2. **`skipLibCheck: true`**
   *Mengapa ini dipasang?* Opsi ini memberi tahu compiler untuk mengabaikan pemeriksaan tipe di dalam berkas deklarasi (`.d.ts`) milik pustaka pihak ketiga di `node_modules`. Ini mencegah error kompilasi jika ada pustaka luar yang tipe datanya kurang sempurna (misalnya, masalah ketidakcocokan tipe pada `react-router` ketika menggunakan opsi strict tertentu).

3. **`exactOptionalPropertyTypes: true`**
   Aturan ini melarang pemberian nilai `undefined` secara eksplisit pada properti opsional.
   * **Contoh Salah (Error):**
     ```typescript
     interface Config { timeout?: number }
     const c: Config = { timeout: undefined }; // Ditolak oleh compiler
     ```
   * **Contoh Benar:**
     ```typescript
     const c: Config = {}; // Hilangkan properti jika tidak memiliki nilai
     ```

4. **`paths` (Path Aliasing)**
   Menghindari impor relatif yang berantakan:
   ```typescript
   // Sebelum (Buruk):
   import { User } from '../../../../packages/types/src/user.types';

   // Sesudah (Rapi & Modular):
   import { User } from '@seladev/types';
   ```

---

## 3. Aliran Data Clean Architecture

Backend API dirancang dengan **Clean Architecture** yang didelegasikan berdasarkan folder fitur. Aliran datanya adalah sebagai berikut:

```
[Client Request] ──▶ [Express Router]
                           │
                           ▼ (Validasi Zod)
                     [Request Middleware]
                           │
                           ▼
                     [Controller] (Parser HTTP & Delegator)
                           │
                           ▼
                     [Service Layer] (Logika Bisnis Utama)
                           │
                           ▼
                     [Repository Layer] (Akses Basis Data)
                           │
                           ▼
                     [Database / MongoDB]
```

### Penjelasan Setiap Layer:
* **Router & Middleware**: Menerima request dari luar, mencocokkan route path, dan menjalankan validasi payload (Zod) sebelum request diproses lebih lanjut.
* **Controller**: Bertugas mengurai data masukan (params, query, body), mendelegasikannya ke Service yang tepat, dan membungkus hasil respons dalam format JSON standar (`{ success: true, data }`). Controller **tidak boleh** mengandung logika bisnis atau query basis data langsung.
* **Service**: Otak dari aplikasi. Di sinilah semua aturan bisnis dijalankan (misalnya: enkripsi rahasia, pengecekan hak akses RBAC, pengiriman notifikasi).
* **Repository**: Layer abstraksi database. Layer ini berinteraksi langsung dengan model Mongoose. Jika di masa mendatang database diubah (misalnya dari MongoDB ke PostgreSQL), Anda hanya perlu mengganti kode di kelas Repository tanpa mengubah logika di dalam Service.

---

## 4. Validasi Data Terbagi (Shared Zod Validators)

Proyek ini mendemonstrasikan metode validasi sekali tulis (*Single Source of Truth*). Kita menulis aturan validasi sekali di `packages/validators/src/auth.schemas.ts`:

```typescript
export const loginSchema = z.object({
  email: z.string().email('Format email salah').toLowerCase(),
  password: z.string().min(8, 'Password minimal 8 karakter'),
});
```

### Penggunaan di Backend (apps/api):
Dipasang sebagai middleware route menggunakan handler kustom `validateRequest`:
```typescript
import { validateRequest } from './middleware/validate-request';
import { loginSchema } from '@seladev/validators';

router.post('/login', validateRequest({ body: loginSchema }), authController.login);
```

### Penggunaan di Frontend (apps/web):
Digunakan bersama pustaka `react-hook-form` dan `@hookform/resolvers`:
```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginDto } from '@seladev/validators';

const { register, handleSubmit, formState: { errors } } = useForm<LoginDto>({
  resolver: zodResolver(loginSchema)
});
```
**Mengapa pola ini penting?** Aturan validasi (seperti panjang minimal password atau format email) dipastikan 100% sinkron antara client-side dan server-side.

---

## 5. Sistem Penanganan Error Terpusat

### Klasifikasi Error:
1. **Operational Errors (Error Terduga)**: Error yang normal terjadi akibat input user, seperti salah password (401), data tidak ditemukan (404), atau validasi gagal (400).
2. **Programmer Errors (Error Tak Terduga)**: Error akibat bug sistem, seperti mengakses properti dari variabel `undefined` atau kesalahan sintaks.

### Mewarisi Kelas Error Kustom (`BaseError`):
Di [apps/api/src/lib/errors.ts](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/api/src/lib/errors.ts):
```typescript
export abstract class BaseError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  readonly isOperational: boolean;

  constructor(message: string, isOperational = true) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype); // ◀ PENTING
    Error.captureStackTrace(this, this.constructor);
  }
}
```
> **Catatan Belajar:** Aturan `Object.setPrototypeOf(this, new.target.prototype)` digunakan karena kompilasi TypeScript untuk kelas bawaan `Error` merusak rantai prototipe (*prototype chain*). Baris ini mengembalikan rantai tersebut sehingga pengecekan `err instanceof ValidationError` dapat terdeteksi dengan tepat di middleware Express.

### Global Error Handler Middleware
Express mendeteksi middleware penanganan error apabila memiliki **4 argumen**:
```typescript
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction // ◀ Jangan dihapus! Express mendeteksi error handler dari argumen ke-4
) {
  // Semua error dibungkus dengan JSON yang konsisten
  res.status(statusCode).json({
    success: false,
    error: { code, message, requestId }
  });
}
```

---

## 6. Desain Token CSS & Glassmorphic UI

### Desain Sistem Menggunakan Variabel HSL
Di [apps/web/src/index.css](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/web/src/index.css), kita mendefinisikan warna sebagai nilai HSL mentah tanpa fungsi `hsl()` di dalamnya:
```css
:root {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --primary: 263.4 70% 50.4%;
  --border: 240 3.7% 15.9%;
}
```
Lalu di [tailwind.config.js](file:///Users/timurdianradhasejati/Programming/Code/Web/Mern/seladev/apps/web/tailwind.config.js), kita memetakan warna tersebut:
```javascript
colors: {
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  primary: 'hsl(var(--primary))',
  border: 'hsl(var(--border))',
}
```
**Mengapa menggunakan metode ini?**
1. **Transparansi Dinamis**: Kita dapat menggunakan modifier opacity Tailwind secara langsung pada warna kustom, misalnya `bg-primary/20` (warna primary dengan opacity 20%).
2. **Kemudahan Tema**: Untuk mengganti tema warna, kita cukup memanipulasi variabel CSS menggunakan JavaScript di elemen `:root` tanpa perlu menulis ulang kelas CSS.

### Efek Premium Glassmorphism
Untuk memberikan tampilan modern semi-transparan seperti dashboard Vercel/Linear:
```css
.glass-panel {
  background: rgba(15, 15, 20, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```
Pola ini menggunakan `backdrop-filter: blur` untuk memburamkan elemen di belakang panel kaca tersebut, dikombinasikan dengan border semi-transparan tipis untuk memberikan efek refleksi cahaya pada sudut-sudut kartu.

---

## 7. Keamanan Autentikasi: Token Rotation & RBAC Dua Tingkat

Modul **Identity & Access** yang baru saja dibangun mengimplementasikan pola keamanan tingkat tinggi yang sangat krusial untuk dipelajari:

### A. Refresh Token Rotation (RTR) & Token Family
Untuk mencegah token disalahgunakan jika dicuri, kita menggunakan pola **Refresh Token Rotation**.
* **Cara Kerja**: Setiap kali pengguna meminta Token Akses baru menggunakan Refresh Token lama, server akan memberikan Token Akses baru **DAN** Refresh Token baru. Token lama langsung dinonaktifkan.
* **Reuse Detection (Token Family)**: Semua refresh token yang dibuat dalam satu sesi memiliki ID `family` yang sama. Jika penyerang mencoba mengirimkan refresh token lama yang *sudah pernah ditukar*, sistem mendeteksi ini sebagai **serangan pemutaran ulang (replay attack)**. Server akan langsung menonaktifkan seluruh keluarga token (`isRevoked: true` untuk semua token dengan `family` tersebut), sehingga memaksa pengguna asli dan penyerang keluar sistem (logout otomatis).

### B. Indeks otomatis MongoDB (TTL Index)
Pada skema `RefreshToken`, terdapat pengaturan indeks khusus:
```typescript
expiresAt: {
  type: Date,
  required: true,
  index: { expires: 0 },
}
```
* **Catatan Belajar**: Ini disebut **TTL (Time-To-Live) Index**. MongoDB secara otomatis memantau bidang ini dan akan menghapus dokumen tersebut dari database secara fisik tepat ketika waktu `expiresAt` tercapai. Ini menghindari penumpukan data sampah di database Anda secara otomatis tanpa perlu membuat cron job pembersihan manual.

### C. Kriptografi Asimetris (RS256 JWT) & Self-Healing Dev Keys
* **Mengapa RS256 asimetris?** Karena algoritma ini menggunakan sepasang kunci: **Kunci Privat** (untuk menandatangani token di server otorisasi) dan **Kunci Publik** (yang disebarkan untuk verifikasi token oleh server lain). Ini memungkinkan layanan downstream memvalidasi token tanpa memiliki kemampuan memalsukannya.
* **Fitur Self-Healing Dev Keys**:
  ```typescript
  const { privateKey: genPriv, publicKey: genPub } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    // ...
  });
  ```
  Ini adalah teknik penulisan kode mandiri (*self-healing code*). Jika aplikasi mendeteksi kunci di file `.env` Anda masih berupa teks biasa (dummy), daripada mematikan server dengan *crash error*, ia akan secara dinamis membuat pasangan kunci RSA 2048-bit di dalam memori saat server dinyalakan. Ini mempermudah tim pengembang baru (*onboarding*) untuk langsung menjalankan aplikasi secara lokal dengan cepat.

### D. Kontrol Akses Berbasis Pangkat (Rank-based RBAC)
Untuk memeriksa wewenang akses dengan cara yang bersih dan ringkas, kita mengonversi peran (*role*) menjadi pangkat angka (*ranks*):
```typescript
const ORG_ROLE_RANKS: Record<string, number> = {
  owner: 40,
  admin: 30,
  member: 20,
  viewer: 10,
  none: 0,
};
```
* **Keuntungan Pola Ini**: Cukup dengan membandingkan angka pangkat, kita dapat mengamankan rute secara fleksibel tanpa menulis kondisi `if` bercabang yang rumit:
  ```typescript
  // Jika rute membutuhkan admin (30), dan user berpangkat owner (40)
  if (userOrgRank < requiredOrgRank) {
    throw new ForbiddenError(); // 40 >= 30, lolos validasi!
  }
  ```
  Ini secara otomatis mendukung pewarisan wewenang (*role inheritance*), di mana pangkat yang lebih tinggi mewarisi seluruh izin pangkat di bawahnya.

---

## 8. Resolusi Kompilasi & Trik TypeScript Monorepo

Ketika mengintegrasikan Mongoose dengan skema modular di dalam monorepo pnpm, terdapat beberapa kendala TypeScript tingkat lanjut yang berhasil diselesaikan:

### A. Impor vs Kompilasi: Mengatasi `rootDir` Constraint (`TS6059`)
Dalam arsitektur monorepo, aplikasi seperti `apps/api` menggunakan `"rootDir": "src"` untuk membatasi file mana saja yang dikompilasi menjadi JavaScript siap rilis.
* **Masalah**: Jika `apps/api` mengimpor tipe data langsung dari `@seladev/types` yang terarah ke berkas `.ts` asli (`packages/types/src/index.ts`), compiler TypeScript menganggap berkas luar tersebut sebagai bagian dari program kompilasi lokal `apps/api`, sehingga memicu error `TS6059` karena mengimpor berkas di luar `rootDir`.
* **Solusi**: 
  1. Ubah entri paket lokal (`package.json`) `@seladev/types`, `@seladev/validators`, dan `@seladev/utils` untuk menunjuk ke `./dist/index.js` dan `./dist/index.d.ts`.
  2. Override konfigurasi `paths` di `apps/api/tsconfig.json` agar mengarah ke berkas deklarasi compiled `.d.ts` di dalam `dist`:
     ```json
     "paths": {
       "@seladev/types": ["../../packages/types/dist/index.d.ts"]
     }
     ```
  Dengan cara ini, compiler menyelesaikan impor menggunakan file `.d.ts` yang bersih tanpa mencoba mengompilasi ulang berkas `.ts` aslinya.

### B. Menonaktifkan Type Emission untuk Aplikasi Leaf Node (`TS2742`)
* **Masalah**: Kesalahan `TS2742` terjadi ketika tipe data yang dihasilkan dari router Express atau fungsi pembungkus (seperti `asyncWrapper`) tidak dapat diekspor secara portabel karena bergantung pada pustaka luar yang tidak diimpor secara langsung.
* **Solusi**: Karena `apps/api` adalah produk akhir (leaf node/aplikasi web) dan **bukan** pustaka yang akan diimpor oleh aplikasi lain, ia tidak perlu menghasilkan deklarasi tipe (`.d.ts`). Kita menonaktifkan ini di `apps/api/tsconfig.json`:
  ```json
  "declaration": false,
  "declarationMap": false
  ```
  Ini mempercepat waktu build secara dramatis dan menghilangkan seluruh error portabilitas tipe.

### C. Pembatasan Penghapusan Properti Mongoose (`TS2790`)
* **Masalah**: Ketika kita meredefinisi transformer serialisasi Mongoose (`toJSON.transform`) untuk menyembunyikan password hash atau metadata bawaan:
  ```typescript
  transform: (_doc, ret) => {
    delete ret.passwordHash; // Error TS2790: Properti tidak opsional
  }
  ```
  TypeScript memprotes karena kita mencoba menghapus properti wajib pada tipe objek `UserDocument`.
* **Solusi**: Lakukan cast instan objek `ret` menjadi `any` terlebih dahulu:
  ```typescript
  transform: (_doc, ret) => {
    const obj = ret as any;
    delete obj.passwordHash;
    return obj;
  }
  ```
  Ini mengizinkan penghapusan properti sensitif sebelum dikirim ke client-side.

### D. Sinkronisasi Tipe Tanggal (Mongoose Date vs TypeScript String)
* **Masalah**: Tipe entitas di package `@seladev/types` mendefinisikan tanggal seperti `lastLoginAt` atau `joinedAt` sebagai `string | null` karena saat dikirim ke frontend via JSON, tanggal tersebut berupa string ISO. Namun, di dalam database MongoDB, kita menyimpannya sebagai objek JavaScript `Date`. Ini memicu bentrokan tipe assignability.
* **Solusi**: Saat mendefinisikan interface `UserDocument` atau `MembershipDocument`, kita mengecualikan kolom tanggal bawaan dari pewarisan tipe package dan mengidentifikasikannya kembali sebagai `Date`:
  ```typescript
  export interface UserDocument extends Omit<User, 'lastLoginAt' | 'createdAt' | 'updatedAt'>, Document {
    lastLoginAt: Date | null;
  }
  ```
  Hal ini memberikan validasi tipe yang akurat di backend server saat berinteraksi dengan database Mongoose secara langsung.

---

## 9. Keamanan MFA / TOTP & Enkripsi AES-256-GCM

Kita menerapkan standar keamanan kelas industri untuk melindungi rahasia TOTP pengguna dengan pola-pola arsitektur berikut:

### A. Enkripsi Rahasia TOTP dengan AES-256-GCM
Berbeda dengan hashing password (seperti bcrypt yang searah), rahasia TOTP harus dapat didekripsi kembali oleh server untuk memvalidasi token 6-digit yang dikirim pengguna. Oleh karena itu, kita menggunakan **enkripsi asimetris/simetris dua arah**.
* **AES-256-GCM (Galois/Counter Mode)**: Dipilih karena merupakan algoritma enkripsi terotentikasi (*Authenticated Encryption*). Selain mengamankan data, ia menghasilkan `authTag` untuk mendeteksi apabila ada modifikasi/tampering ilegal pada data terenkripsi.
* **Format Payload di Database**:
  ```json
  {
    "ciphertext": "base64_string",
    "iv": "base64_string_12_bytes",
    "authTag": "base64_string_16_bytes"
  }
  ```
* **Pola Enkripsi (dalam `crypto.ts`)**:
  ```typescript
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  ```
  Setiap enkripsi menghasilkan **IV (Initialization Vector) 12-byte acak** agar mengenkripsi teks yang sama dua kali menghasilkan hasil sandi (*ciphertext*) yang berbeda, mempersulit penyerang menganalisis pola rahasia.

### B. Protokol Login 2FA yang Aman (MFA Pending JWT)
Saat pengguna dengan MFA aktif memasukkan email & password yang benar, server tidak boleh langsung mengeluarkan token akses berumur panjang atau me-log masuk sesi mereka.
* **MFA Pending Token**: Kita menggunakan Token JWT khusus (`mfaToken`) dengan umur sangat pendek (3 menit) yang ditandatangani menggunakan kunci privat RSA server.
  ```typescript
  // Payload mfaToken
  {
    "sub": "userId",
    "type": "mfa_pending"
  }
  ```
* **Mengapa pola ini aman?**
  1. Token ini tidak memiliki izin akses apa pun pada API platform (tidak lolos `authenticateJwt` biasa karena tipenya bukan `access`).
  2. Satu-satunya kegunaan token ini adalah untuk dikirimkan ke endpoint `POST /auth/login/mfa` bersama kode OTP 6-digit untuk memverifikasi langkah kedua login.

### C. Backup Recovery Codes
Ketika mengaktifkan MFA, server secara otomatis menghasilkan **8 buah backup recovery codes** berupa string acak heksadesimal 10 karakter.
* **Metode Penyimpanan**: Kode cadangan ini sangat sensitif. Kita menyimpannya di database sebagai **bcrypt hash** (sama seperti password), bukan teks biasa.
* **Validasi Sekali Pakai**: Saat pengguna kehilangan ponsel mereka dan memasukkan kode pemulihan untuk login, server membandingkan input dengan hash bcrypt. Jika cocok, kode pemulihan tersebut **dihapus secara permanen** dari database (`user.mfaRecoveryCodes` difilter) agar tidak bisa digunakan kembali oleh orang lain yang mungkin mengintipnya (*one-time use validation*).

### D. Bypass Rute Otorisasi pada MFA Enforcement
* **Enforcement Middleware**: Jika organisasi mewajibkan MFA (`settings.mfaRequired: true`), semua panggilan API pengguna akan diblokir dengan `403 Forbidden` jika pengguna belum menyalakan MFA.
* **Pengecualian Rute Akun (`isAuthRoute`)**:
  ```typescript
  const isAuthRoute = req.originalUrl.includes('/api/v1/auth');
  ```
  Kita wajib mengecualikan seluruh rute autentikasi akun sendiri agar pengguna yang belum menyalakan MFA tetap bisa memanggil `/auth/mfa/setup` dan `/auth/mfa/activate` untuk mendaftarkan TOTP mereka. Jika tidak dikecualikan, pengguna akan terkunci selamanya (*deadlock*) karena tidak bisa mengakses halaman pendaftaran MFA akibat terblokir oleh aturan MFA itu sendiri.

---

## 10. Manajemen Proyek, Lingkungan (Environments), dan Keanggotaan Proyek

Kami telah membangun fondasi utama untuk isolasi pengerjaan aplikasi dan konfigurasi menggunakan arsitektur berikut:

### A. Pola Relasi Multi-Tenant Proyek & Organisasi
Proyek adalah unit kerja utama di SELADEV. Setiap proyek terikat ke satu organisasi induk.
* **Keunikan Slug Tingkat Org**: Slug proyek tidak unik secara global melainkan unik per organisasi. Dua organisasi berbeda dapat memiliki proyek dengan slug yang sama (misal `payment-gateway`).
* Enkapsulasi data ini diamankan menggunakan **Compound Unique Index** pada MongoDB:
  ```typescript
  ProjectSchema.index({ organizationId: 1, slug: 1 }, { unique: true });
  ```
  Hal ini mencegah tabrakan nama proyek di dalam organisasi yang sama namun tetap fleksibel di tingkat global.

### B. Penyimpanan Konfigurasi Terbenam (Embedded Variables)
Variabel lingkungan non-sensitif (seperti `API_URL` atau feature flags) disimpan dalam bentuk array terbenam (*embedded array*) secara langsung di dalam dokumen environment.
* **Keuntungan**:
  1. Mengurangi kebutuhan operasi `JOIN` (Lookup) saat runtime. Klien dapat menarik seluruh konfigurasi lingkungan dalam satu panggilan baca dokumen tunggal.
  2. Memungkinkan pembaruan semua variabel secara atomik menggunakan instruksi pembaruan tunggal.
* **Format Skema**:
  ```typescript
  variables: [{
    key: string;
    value: string;
    isSecret: boolean; // Jika true, nilainya adalah kunci rujukan ke koleksi secrets
  }]
  ```

### C. Proteksi Lingkungan & Otorisasi Bertingkat
* **Auto-Provisioning**: Ketika sebuah proyek dibuat, sistem secara otomatis membangkitkan tiga default environment (`development`, `staging`, dan `production`). Lingkungan `production` diberi tanda `isProtected: true`.
* **Aturan Proteksi**:
  1. Lingkungan bertipe `production` tidak dapat dihapus oleh siapa pun.
  2. Perubahan variabel lingkungan pada protected environment dibatasi secara ketat: hanya `project:admin` atau `org:admin/owner` yang diizinkan untuk menyimpannya. Pengembang biasa (`project:developer`) akan ditolak dengan respons `403 Forbidden` (`ForbiddenError`).

### D. Pewarisan Peran (Role Inheritance) & Validasi Administrator Tunggal
* **Resolusi Peran Efektif**:
  Pola otorisasi yang kami gunakan menetapkan bahwa peran tingkat organisasi yang tinggi otomatis melimpahi proyek:
  `Effective Role = max(Org Role, Project Role)`
  Seorang Admin Organisasi (`org:admin`) tidak harus terdaftar sebagai anggota proyek untuk mengelolanya; middleware `authorizeRbac` mendeteksi ini dan meloloskan akses secara otomatis.
* **Pencegahan Administratif Buntu (Sole Admin Safety)**:
  Sistem melarang pencabutan peran `admin` proyek atau penghapusan pengguna dari proyek jika ia merupakan **satu-satunya administrator aktif** yang tersisa di proyek tersebut. Hal ini menghalangi terjadinya situasi di mana sebuah proyek tidak lagi memiliki pengelola administratif yang aktif.

---

## 11. Manajemen Secrets & Riwayat Versi (Secrets & Versioning)

Modul **Secrets & Versioning** (Phase 1.3 & Phase 2.3) menerapkan perlindungan kriptografi kelas industri untuk data konfigurasi sensitif. Berikut adalah konsep penting yang harus dipelajari:

### A. Kunci Enkripsi Turunan Organisasi (Per-Org Derived Keys)
Untuk menghindari satu kunci enkripsi yang sama bagi semua data pelanggan, kita menggunakan kunci turunan per organisasi:
* **Rumus Derivasi Kunci**:
  `derivedKey = HMAC-SHA256(MASTER_ENCRYPTION_KEY, organizationId)`
* **Keuntungan Keamanan**:
  1. Isolasi dampak kebocoran (*blast radius isolation*): Jika kunci turunan suatu organisasi bocor, data rahasia milik organisasi lain tetap sepenuhnya aman karena dienkripsi dengan kunci yang berbeda.
  2. Tanpa penyimpanan kunci: Kunci turunan tidak pernah disimpan di database melainkan diturunkan secara instan dalam memori ketika dibutuhkan menggunakan rahasia utama (`MASTER_ENCRYPTION_KEY`) dan `organizationId`.

### B. Enkripsi AES-256-GCM Terotentikasi
Kita menggunakan algoritma **AES-256-GCM** yang menghasilkan tiga komponen utama:
1. **Ciphertext**: Nilai asli yang terenkripsi dalam format base64.
2. **Initialization Vector (IV)**: Salt acak 12-byte yang menjamin bahwa teks yang sama jika dienkripsi ulang tidak akan menghasilkan ciphertext yang sama.
3. **Authentication Tag**: Kode autentikasi 16-byte yang dibuat selama enkripsi. Saat dekripsi, tag ini digunakan untuk memastikan data tidak dimodifikasi secara ilegal oleh pihak ketiga (*tampering detection*). Jika data dirusak, operasi dekripsi akan melempar error dan gagal total.

### C. Pemisahan endpoint List & Reveal
* **List (Masked)**: Endpoint daftar rahasia (`GET /projects/:projectId/environments/:envId/secrets`) mengembalikan seluruh metadata namun menyembunyikan nilai asli dengan menggantinya menjadi `value: "****"`. Ini mencegah pencurian data massal secara tidak sengaja oleh skrip pemantau atau kegagalan log.
* **Reveal (Explicit Decrypt)**: Pengungkapan nilai asli memerlukan pemanggilan endpoint tersendiri secara eksplisit (`POST /projects/:projectId/secrets/:secretId/reveal`). Hal ini mempermudah pencatatan audit log yang tepat untuk mencatat siapa saja manusia/aktor yang benar-benar melihat rahasia tersebut.

### D. Proteksi Protected Environment
Aturan keamanan diperketat berdasarkan status proteksi lingkungan (`isProtected`):
* Pada **standard environment** (seperti `development` atau `staging`), pengembang biasa (`project:developer`) diperbolehkan membuat, memutus, mengubah, dan melihat nilai rahasia untuk mempermudah pengerjaan lokal.
* Pada **protected environment** (seperti `production`), pengembang biasa diblokir dengan respons `403 Forbidden` (`ForbiddenError`) jika mencoba mengungkap (reveal) atau memodifikasi rahasia. Hanya pemilik peran administratif (`project:admin` atau `org:admin/owner`) yang diizinkan untuk melakukannya.

### E. Immutability & Riwayat Versi (Versioning)
1. Bidang versi (`version`) dalam dokumen `Secret` dinaikkan secara berurutan (*monotonic version counter*).
2. Dokumen versi lama disimpan secara permanen dan tidak dapat diubah (*immutable history*) di dalam koleksi `SecretVersion`.
3. Saat melakukan **Rollback** (`POST /projects/:projectId/secrets/:secretId/rollback`), rahasia utama akan memulihkan data enkripsinya ke versi target tertentu. Tindakan rollback ini sendiri dicatat sebagai versi baru yang bertambah (misalnya, me-rollback versi 2 ke versi 1 pada secret berversi 3 akan menghasilkan versi baru yaitu 4) untuk mempertahankan audit trail yang bersih dari semua perubahan historis.

---

## 12. Modul API Keys & Autentikasi Mesin-ke-Mesin (Machine-to-Machine Auth)

API Keys digunakan oleh sistem otomatis seperti CI/CD pipelines (GitHub Actions, GitLab CI), scripts kustom, atau CLI tools untuk berinteraksi dengan API SELADEV tanpa memerlukan sesi interaktif user manusia.

### A. Format API Key dengan Prefiks Terstandar
Setiap API Key yang dihasilkan mengikuti format:
`sdv_sk_` + `Base58(32 random bytes)`
* **Prefiks `sdv_sk_`**: Prefiks statis membantu pendeteksian otomatis (Secret Scanning) oleh sistem deteksi keamanan pihak ketiga (seperti GitGuardian, GitHub Secret Scanning, atau Trufflehog) jika pengembang tidak sengaja melakukan commit kode kunci ke repositori publik.
* **Base58 (URL-Safe)**: Base58 mengecualikan karakter ambigu visual (seperti angka `0`, huruf `O`, angka `1`, dan huruf `l`). Hal ini memastikan key mudah disalin oleh manusia tanpa risiko salah ketik.

### B. Penyimpanan One-Way Hashing SHA-256
API Key adalah kredensial yang sangat sensitif. Untuk meminimalkan risiko jika database bocor, SELADEV menerapkan pola keamanan **Display Once, Never Retrieve**:
1. Plaintext API Key hanya dihasilkan dan dikembalikan sekali di respons API sesaat setelah pembuatan. Server **tidak pernah** menyimpan plaintext key ini di disk atau log.
2. Di database, server hanya menyimpan **SHA-256 hash** dari key tersebut.
3. Saat request masuk membawa API Key di header `Authorization: Bearer sdv_sk_...`, server menghitung SHA-256 hash dari token tersebut dan mencocokkannya ke database.
* **Mengapa SHA-256, bukan bcrypt?** bcrypt sengaja dirancang lambat (~300ms) untuk mencegah serangan brute force pada password yang biasanya rentan karena dipilih manusia. API Key memiliki entropi tinggi acak 256-bit, sehingga tidak rentan terhadap serangan kamus (*dictionary attack*). SHA-256 jauh lebih cepat (di bawah mikrodetik), sangat ideal untuk autentikasi per-request tanpa menambah latensi.

---

## 13. Pembatasan Lingkup API Keys (Project & Environment Scoping)

Untuk membatasi dampak jika suatu kredensial bocor (*blast radius reduction*), API Key di SELADEV dirancang dengan pembatasan hak akses yang presisi (Least Privilege Principle).

### A. Irisan Otorisasi (Scope Intersection dengan RBAC)
API Key membawa array `scopes` (seperti `secrets:read`, `secrets:write`, dll.). Saat autentikasi, server melakukan pengecekan ganda:
1. API Key harus memiliki scope yang sesuai untuk operasi yang dipanggil.
2. Pembuat/Pemilik API Key tersebut harus memiliki peran organisasi (RBAC) yang sah untuk operasi tersebut.
Hal ini mencegah eskalasi hak istimewa (*privilege escalation*). Jika admin membuat key dengan scope `secrets:write` lalu admin tersebut diturunkan perannya menjadi `viewer`, key tersebut otomatis kehilangan kemampuan menulis karena pemiliknya tidak lagi memiliki wewenang tersebut.

### B. Pembatasan Lingkup Proyek (Project Scoping)
* Kunci yang dikonfigurasi dengan `projectId: null` dapat mengakses seluruh proyek di organisasi (Org-scoped).
* Kunci dengan `projectId` tertentu dibatasi hanya pada proyek tersebut. Jika kunci proyek A mencoba memanggil endpoint proyek B, server mengembalikan respons `403 Forbidden` (`ForbiddenError`).

### C. Pembatasan Lingkup Lingkungan (Environment Scoping)
* Phase 4.4 menambahkan dukungan `environmentId` opsional untuk membatasi API Key hanya pada lingkungan tertentu saja (misalnya hanya boleh membaca/menulis secrets di lingkungan `development`).
* Aturan ini ditegakkan di dalam `SecretsService` secara ketat pada setiap operasi baca/tulis rahasia. Jika API Key mencoba mengakses rahasia di lingkungan lain, ia akan langsung ditolak dengan `ForbiddenError`.
