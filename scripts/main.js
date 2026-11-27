/* Katalog: render kartu dari GAMES, filter kategori, dan pencarian */
(function () {
  const grid = document.getElementById("game-grid");
  const status = document.getElementById("catalog-status");
  const search = document.getElementById("game-search");
  const chipGroup = document.getElementById("category-chips");
  const featuredLink = document.getElementById("featured-link");
  const randomBtn = document.getElementById("random-btn");

  if (!grid) return;

  if (typeof GAMES === "undefined" || !Array.isArray(GAMES)) {
    grid.replaceChildren(el("p", "error-state", "Daftar game belum bisa dimuat. Coba muat ulang halaman."));
    return;
  }

  let activeCategory = "Semua";
  let query = "";

  function statusClass(status) {
    return status === "Beta" ? "badge badge-beta" : "badge badge-status";
  }

  function createCard(game) {
    const article = el("article", "card");

    const thumb = el("div", "card-thumb");
    thumb.setAttribute("aria-hidden", "true");
    if (game.thumbnail) {
      const img = el("img");
      img.src = game.thumbnail;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.onerror = () => img.replaceWith(document.createTextNode(game.title.charAt(0)));
      thumb.append(img);
    } else {
      thumb.textContent = game.title.charAt(0);
    }

    const body = el("div", "card-body");
    const heading = el("h3", "card-title", game.title);
    const desc = el("p", "card-desc", game.description);

    const meta = el("div", "card-meta");
    meta.append(el("span", "badge", game.category), el("span", statusClass(game.status), game.status));

    body.append(heading, desc, meta);

    const footer = el("div", "card-footer");
    const link = el("a", "btn btn-primary", "Play Now");
    link.href = game.url;
    link.setAttribute("aria-label", `Open Game ${game.title}`);
    footer.append(link);

    article.append(thumb, body, footer);
    return article;
  }

  function filteredGames() {
    const q = query.trim().toLowerCase();
    return GAMES.filter((g) => {
      const matchCategory = activeCategory === "Semua" || g.category === activeCategory;
      const haystack = `${g.title} ${g.description} ${g.category}`.toLowerCase();
      return matchCategory && (!q || haystack.includes(q));
    });
  }

  function renderChips() {
    const categories = ["Semua", ...new Set(GAMES.map((g) => g.category))];
    chipGroup.replaceChildren(
      ...categories.map((cat) => {
        const chip = el("button", "chip", cat);
        chip.type = "button";
        chip.setAttribute("aria-pressed", String(cat === activeCategory));
        chip.addEventListener("click", () => {
          activeCategory = cat;
          renderChips();
          renderGrid();
        });
        return chip;
      })
    );
  }

  function renderGrid() {
    const list = filteredGames();
    if (list.length === 0) {
      grid.replaceChildren(el("li", "empty-state", "Tidak ada game yang cocok dengan pencarian."));
    } else {
      grid.replaceChildren(
        ...list.map((game) => {
          const li = el("li");
          li.append(createCard(game));
          return li;
        })
      );
    }
    status.textContent = `${list.length} game ditampilkan`;
  }

  function setupHero() {
    const featured = GAMES.find((g) => g.featured) || GAMES[0];
    if (featuredLink && featured) featuredLink.href = featured.url;
    if (randomBtn) {
      randomBtn.disabled = GAMES.length === 0;
      randomBtn.addEventListener("click", () => {
        window.location.href = pickRandom(GAMES).url;
      });
    }
  }

  if (search) {
    search.addEventListener("input", (e) => {
      query = e.target.value;
      renderGrid();
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        search.value = "";
        query = "";
        renderGrid();
      }
    });
  }

  setupHero();
  renderChips();
  renderGrid();
})();
