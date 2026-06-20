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
