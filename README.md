# Catatan Toko

Aplikasi ini sekarang berupa **proyek web biasa** (bukan artifact Claude lagi), jadi datanya
disimpan lewat `localStorage` browser — lebih stabil dan tidak bergantung ke Claude sama sekali.

## Langkah 1 — Coba dulu di laptop (opsional)

```bash
npm install
npm run dev
```

Buka alamat yang muncul di terminal (biasanya `http://localhost:5173`) di Chrome laptop untuk
mengecek semuanya jalan normal sebelum di-deploy.

## Langkah 2 — Deploy supaya online (gratis, tanpa perlu laptop kuat)

Karena laptop kamu speknya terbatas, **jangan build APK di laptop** — cukup upload kodenya
ke GitHub lalu biarkan **Vercel** yang build di cloud-nya mereka:

1. Buat akun gratis di https://github.com dan https://vercel.com (bisa login pakai akun GitHub)
2. Upload folder ini ke repo GitHub baru (lewat web GitHub: "Add file" → "Upload files", atau
   pakai `git push` kalau familiar)
3. Di Vercel, pilih **"New Project"** → import repo GitHub tadi → klik **Deploy**
4. Tunggu ± 1 menit, Vercel akan kasih URL seperti `https://catatan-toko-xxxx.vercel.app`

Buka URL itu di HP — ini sudah jadi web app yang bisa dipakai dan datanya tersimpan permanen
di browser HP kamu.

## Langkah 3 — Ubah jadi APK (opsional, kalau mau ikon aplikasi asli)

1. Buka https://www.pwabuilder.com
2. Masukkan URL Vercel tadi, klik **Start**
3. Setelah dianalisis, klik **Package for Stores** → pilih **Android**
4. Download paket APK-nya, kirim ke HP, install seperti biasa (aktifkan "izinkan sumber tidak
   dikenal" kalau diminta)

Ini prosesnya di cloud juga (bukan di laptop kamu), jadi tidak akan berat.

## Catatan

- Ganti `public/icon-192.png` dan `public/icon-512.png` dengan ikon buatanmu sendiri kalau mau
  (ukurannya harus persis 192×192 dan 512×512 piksel) — sekarang isinya cuma kotak hijau polos.
- Foto disimpan di memori aplikasi (tidak lewat localStorage, karena bisa terlalu besar) —
  tetap gunakan tombol "Simpan ke HP" di preview foto untuk cadangan permanen.
- Data teks (nama toko, tanggal, jam, warna, catatan) otomatis tersimpan lewat localStorage,
  aman walau HP dimatikan/di-restart.
