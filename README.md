# Game Browser Collection

Kumpulan game browser ringan berbasis HTML, CSS, dan JavaScript.

## Fitur
- index.html sebagai katalog game.
- Dukungan mobile, tablet, dan desktop.
- Tema dark modern.
- Sistem registrasi game yang mudah dikembangkan.
- Tanpa login dan tanpa server.

## Struktur
```text
/
├── index.html
├── README.md
├── LICENSE
├── assets/
│   ├── icons/
│   └── thumbnails/
├── styles/
│   ├── base.css        # token warna, tipografi, reset
│   ├── layout.css      # header, hero, grid, footer
│   └── components.css  # tombol, chip, kartu, badge
├── scripts/
│   ├── game-registry.js  # daftar semua game (data)
│   ├── main.js           # render katalog, filter, pencarian
│   └── utils.js
└── games/
    ├── starfall/index.html
    └── orbit-weaver/index.html
```

## Cara menjalankan
Buka index.html langsung di browser, atau jalankan local server:

```bash
npx serve .
```

Atau:

```bash
python -m http.server 8000
```

Lalu buka http://localhost:8000

## Menambah game baru
1. Buat folder baru di `games/nama-game/` dan isi `index.html`.
2. Tambahkan object game ke `scripts/game-registry.js`.
3. Tambahkan thumbnail ke `assets/thumbnails/` (opsional, ada fallback).
4. Buka `index.html`; game baru akan muncul otomatis.

## Deploy
Project ini dapat langsung di-deploy ke GitHub Pages: upload seluruh isi folder ke repo, lalu aktifkan Pages dari branch utama.

## Teknologi
- HTML5, CSS3, JavaScript
- Google Fonts (Sora, Inter, JetBrains Mono)
- Canvas API
- LocalStorage
