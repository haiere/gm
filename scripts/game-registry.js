/*
 * Registry game. Tambah game baru dengan satu object di sini,
 * lalu buat folder games/<id>/index.html.
 * status: "New" | "Stable" | "Beta"
 */
const GAMES = [
  {
    id: "starfall",
    title: "Starfall",
    description: "Space shooter arcade. Tembak, hindari, dan bertahan selama mungkin.",
    category: "Arcade",
    status: "Stable",
    thumbnail: "assets/thumbnails/starfall.webp",
    url: "games/starfall/index.html",
    featured: true
  },
  {
    id: "orbit-weaver",
    title: "Orbit Weaver",
    description: "Tahan untuk spiral keluar, lepas untuk jatuh ke dalam. Lewati batu-batu.",
    category: "Arcade",
    status: "Beta",
    thumbnail: "assets/thumbnails/orbit-weaver.webp",
    url: "games/orbit-weaver/index.html",
    featured: false
  }
];
