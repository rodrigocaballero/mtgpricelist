const form = document.querySelector("#search-form");
const input = document.querySelector("#card-search");
const resultArea = document.querySelector("#result-area");
const resultTitle = document.querySelector("#result-title");
const resultCount = document.querySelector("#result-count");
const table = document.querySelector("#saved-table");
const savedCount = document.querySelector("#saved-count");
const downloadButton = document.querySelector("#download-csv");
const toast = document.querySelector("#toast");

const RESULTS_PER_PAGE = 5;
let savedCards = [];
let searchState = { query: "", page: 1, totalPages: 1, cards: [] };

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  await searchCards(query, 1);
});

async function searchCards(query, page = 1) {
  setLoading();
  try {
    const result = await findCards(query, page);
    if (!result.cards.length) {
      throw new Error("No encontramos resultados que incluyan esa palabra.");
    }

    searchState = {
      query,
      page,
      totalPages: result.totalPages,
      cards: result.cards,
    };

    renderResults(result.cards, query, page, result.totalPages);
  } catch (error) {
    resultTitle.textContent = "No encontramos esa carta";
    resultCount.textContent = "SIN RESULTADOS";
    resultArea.className = "result-area empty";
    resultArea.innerHTML = `<div class="empty-state"><div class="empty-orbit">?</div><strong>Intenta con otro nombre</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function findCards(query, page = 1) {
  try {
    const response = await fetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`name:${query}`)}&order=name&unique=cards&include_multilingual=true&page=${page}&per_page=${RESULTS_PER_PAGE}`
    );

    if (!response.ok) {
      const fallback = await findClosestFallback(query);
      return { cards: fallback, totalPages: 1 };
    }

    const data = await response.json();
    const cards = (data.data || []).map((card) => ({
      name: card.name,
      image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || "",
      language: card.lang === "es" ? "Español" : "Inglés",
      set: card.set_name || "Set desconocido",
      oracleText: card.oracle_text || "Sin descripción disponible",
      rarity: card.rarity || "Común",
      kingdomUrl: `https://www.cardkingdom.com/catalog/search?filter%5Bname%5D=${encodeURIComponent(card.name)}`,
      priceUsd: null,
      priceClp: null,
    }));

    const enrichedCards = await Promise.all(cards.map((card) => enrichCard(card)));
    const totalPages = Math.max(1, Math.ceil((data.total_cards || enrichedCards.length) / RESULTS_PER_PAGE));
    return { cards: enrichedCards, totalPages };
  } catch {
    return { cards: await findClosestFallback(query), totalPages: 1 };
  }
}

async function findClosestFallback(query) {
  try {
    const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    const card = await response.json();
    return [
      {
        name: card.name,
        image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || "",
        language: card.lang === "es" ? "Español" : "Inglés",
        set: card.set_name || "Set desconocido",
        oracleText: card.oracle_text || "Sin descripción disponible",
        rarity: card.rarity || "Común",
        kingdomUrl: `https://www.cardkingdom.com/catalog/search?filter%5Bname%5D=${encodeURIComponent(card.name)}`,
        priceUsd: null,
        priceClp: null,
      },
    ];
  } catch {
    return [];
  }
}

async function enrichCard(card) {
  const price = await getCardKingdomPrice(card.name);
  const rate = await getUsdToClpRate();
  const priceUsd = Number(price ?? 0);
  const priceClp = priceUsd > 0 ? Math.round(priceUsd * rate) : null;
  return {
    ...card,
    priceUsd: priceUsd > 0 ? priceUsd : null,
    priceClp,
  };
}

function renderResults(cards, query, page, totalPages) {
  resultTitle.textContent = `Coincidencias para “${escapeHtml(query)}”`;
  resultCount.textContent = `${cards.length} RESULTADOS`;
  resultArea.className = "result-area";

  const cardsMarkup = cards
    .map(
      (card) => `
        <article class="card-result">
          <img class="card-image" src="${card.image}" alt="${escapeHtml(card.name)}" />
          <div class="result-info">
            <span class="tag">${escapeHtml(card.language.toUpperCase())} · ${escapeHtml(card.set)}</span>
            <h3>${escapeHtml(card.name)}</h3>
            <span class="subname">RAREZA: ${escapeHtml(String(card.rarity).toUpperCase())}</span>
            <span class="price-label">PRECIO CARD KINGDOM</span>
            <strong class="price">${card.priceUsd ? `$${card.priceUsd.toFixed(2)} USD` : "Consultar"}</strong>
            <span class="price-note">${card.priceClp ? `Equivale a ${formatClp(card.priceClp)} CLP` : "Precio aún no disponible"}</span>
            <p class="oracle-text">${escapeHtml(card.oracleText)}</p>
            <div class="result-actions">
              <button class="save-button" type="button" data-name="${escapeHtml(card.name)}">＋ Guardar en mi lista</button>
              <a class="external-button" href="${card.kingdomUrl}" target="_blank" rel="noreferrer">Ver en Card Kingdom ↗</a>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  const pagination = totalPages > 1 ? `
    <div class="search-pagination">
      <button class="page-button" type="button" data-page="${Math.max(1, page - 1)}" ${page === 1 ? "disabled" : ""}>Anterior</button>
      <span>Página ${page} de ${totalPages}</span>
      <button class="page-button" type="button" data-page="${Math.min(totalPages, page + 1)}" ${page >= totalPages ? "disabled" : ""}>Siguiente</button>
    </div>
  ` : "";

  resultArea.innerHTML = `<div class="result-list">${cardsMarkup}</div>${pagination}`;

  resultArea.querySelectorAll(".save-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const selectedCard = cards.find((card) => card.name === button.dataset.name);
      if (!selectedCard) return;
      saveCard(selectedCard);
    });
  });

  resultArea.querySelectorAll(".page-button").forEach((button) => {
    const nextPage = Number(button.dataset.page);
    if (Number.isNaN(nextPage)) return;
    button.addEventListener("click", () => searchCards(searchState.query, nextPage));
  });
}

function saveCard(card) {
  const normalizedCard = {
    ...card,
    priceUsd: card.priceUsd ?? null,
    priceClp: card.priceClp ?? (card.priceUsd ? convertUsdToClp(card.priceUsd) : null),
  };

  if (savedCards.some((saved) => saved.name === normalizedCard.name)) {
    return showToast("Esta carta ya está en tu lista.");
  }

  savedCards.push(normalizedCard);
  renderTable();
  showToast(`Carta guardada • ${normalizedCard.priceClp ? formatClp(normalizedCard.priceClp) : "Precio por consultar"}`);
}

function renderTable() {
  const totalUsd = savedCards.reduce((sum, card) => sum + (Number(card.priceUsd ?? 0)), 0);
  const totalClp = savedCards.reduce((sum, card) => sum + (Number(card.priceClp ?? convertUsdToClp(card.priceUsd ?? 0))), 0);

  savedCount.textContent = savedCards.length;
  downloadButton.disabled = savedCards.length === 0;

  if (!savedCards.length) {
    table.innerHTML = `<tr class="table-empty"><td colspan="4">Aún no has guardado cartas en esta sesión.</td></tr>`;
    return;
  }

  const rows = savedCards
    .map(
      (card, index) => `
        <tr>
          <td class="table-card">${escapeHtml(card.name)}</td>
          <td class="table-lang">${card.language}</td>
          <td class="table-price">${card.priceUsd === null ? "Consultar en Card Kingdom" : `$${card.priceUsd.toFixed(2)} USD / ${formatClp(card.priceClp || convertUsdToClp(card.priceUsd))} CLP`}</td>
          <td><button class="remove-card" data-index="${index}" aria-label="Quitar ${escapeHtml(card.name)}">×</button></td>
        </tr>
      `
    )
    .join("");

  table.innerHTML = `${rows}
    <tr class="total-row">
      <td colspan="2"><strong>TOTAL</strong></td>
      <td><strong>${formatClp(totalClp)} CLP</strong><div class="sub-total">${formatUsd(totalUsd)} USD</div></td>
      <td></td>
    </tr>`;

  table.querySelectorAll(".remove-card").forEach((button) => {
    button.addEventListener("click", () => {
      savedCards.splice(Number(button.dataset.index), 1);
      renderTable();
    });
  });
}

downloadButton.addEventListener("click", () => {
  const rows = [["Carta", "Idioma", "Precio USD", "Precio CLP", "Enlace"]];
  savedCards.forEach((card) => {
    rows.push([
      card.name,
      card.language,
      card.priceUsd === null ? "Consultar" : `$${card.priceUsd.toFixed(2)}`,
      card.priceClp === null ? "Consultar" : `${formatClp(card.priceClp)}`,
      card.kingdomUrl,
    ]);
  });

  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "mtg-pricelist.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

async function getCardKingdomPrice(name) {
  try {
    const response = await fetch(
      `https://r.jina.ai/http://www.cardkingdom.com/catalog/search?filter%5Bname%5D=${encodeURIComponent(name)}`
    );
    if (!response.ok) return null;

    const text = await response.text();
    const matches = [...text.matchAll(/\$\s?(\d+(?:\.\d{2})?)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => value > 0);

    return matches.length ? Math.min(...matches) : null;
  } catch {
    return null;
  }
}

async function getUsdToClpRate() {
  const cacheKey = "mtgpricelist_usd_to_clp_rate";
  const cached = Number(sessionStorage.getItem(cacheKey));
  if (cached && cached > 0) return cached;

  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=USD&to=CLP");
    if (!response.ok) throw new Error("Rate unavailable");
    const data = await response.json();
    const rate = Number(data.rates?.CLP || 980);
    sessionStorage.setItem(cacheKey, String(rate));
    return rate;
  } catch {
    const fallbackRate = 980;
    sessionStorage.setItem(cacheKey, String(fallbackRate));
    return fallbackRate;
  }
}

function convertUsdToClp(amount) {
  const numeric = Number(amount || 0);
  return numeric > 0 ? Math.round(numeric * Number(sessionStorage.getItem("mtgpricelist_usd_to_clp_rate") || 980)) : 0;
}

function setLoading() {
  resultTitle.textContent = "Buscando carta...";
  resultCount.textContent = "CONSULTANDO";
  resultArea.className = "result-area empty";
  resultArea.innerHTML = `<div class="empty-state"><div class="empty-orbit">✦</div><strong>Consultando el catálogo</strong><p>Estamos buscando la carta y su referencia de Card Kingdom.</p></div>`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function formatClp(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

async function getCardKingdomPrice(name) {
  // Card Kingdom bloquea peticiones de navegador en algunos países. Jina solo se usa
  // como lector de la página pública; si falla, no se muestra un precio inventado.
  try {
    const url = `https://r.jina.ai/http://www.cardkingdom.com/catalog/search?filter%5Bname%5D=${encodeURIComponent(name)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const text = await response.text();
    const matches = [...text.matchAll(/\$\s?(\d+(?:\.\d{2})?)/g)].map((match) => Number(match[1])).filter((value) => value > 0);
    return matches.length ? Math.min(...matches) : null;
  } catch {
    return null;
  }
}

function renderResult(card) {
  resultTitle.textContent = "Carta encontrada";
  resultCount.textContent = "1 RESULTADO";
  resultArea.className = "result-area";
  const price = card.price === null ? "Consultar" : `$${card.price.toFixed(2)}`;
  const note = card.price === null ? "Abre Card Kingdom para ver disponibilidad y precio actual." : "Precio más bajo detectado en el catálogo.";
  resultArea.innerHTML = `<article class="card-result">
    <img class="card-image" src="${card.image}" alt="${escapeHtml(card.name)}" />
    <div class="result-info">
      <span class="tag">${card.language.toUpperCase()} · ${escapeHtml(card.set)}</span>
      <h3>${escapeHtml(card.name)}</h3><span class="subname">IDENTIFICADA POR SCRYFALL</span>
      <span class="price-label">PRECIO CARD KINGDOM</span><strong class="price">${price}</strong><span class="price-note">${note}</span>
      <div class="result-actions"><button class="save-button" id="save-card">＋ Guardar en mi lista</button><a class="external-button" href="${card.kingdomUrl}" target="_blank" rel="noreferrer">Ver en Card Kingdom ↗</a></div>
    </div></article>`;
  document.querySelector("#save-card").addEventListener("click", () => saveCard(card));
}

function saveCard(card) {
  if (savedCards.some((saved) => saved.name === card.name)) return showToast("Esta carta ya está en tu lista.");
  savedCards.push(card);
  renderTable();
  showToast("Carta guardada en tu lista temporal.");
}

function renderTable() {
  savedCount.textContent = savedCards.length;
  downloadButton.disabled = savedCards.length === 0;
  table.innerHTML = savedCards.length ? savedCards.map((card, index) => `<tr><td class="table-card">${escapeHtml(card.name)}</td><td class="table-lang">${card.language}</td><td class="table-price">${card.price === null ? "Consultar en Card Kingdom" : `$${card.price.toFixed(2)}`}</td><td><button class="remove-card" data-index="${index}" aria-label="Quitar ${escapeHtml(card.name)}">×</button></td></tr>`).join("") : `<tr class="table-empty"><td colspan="4">Aún no has guardado cartas en esta sesión.</td></tr>`;
  table.querySelectorAll(".remove-card").forEach((button) => button.addEventListener("click", () => {
    savedCards.splice(Number(button.dataset.index), 1);
    renderTable();
  }));
}

downloadButton.addEventListener("click", () => {
  const rows = [["Carta", "Idioma", "Precio Card Kingdom", "Enlace"]];
  savedCards.forEach((card) => rows.push([card.name, card.language, card.price === null ? "Consultar" : `$${card.price.toFixed(2)}`, card.kingdomUrl]));
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = "mana-market-cartas.csv"; link.click(); URL.revokeObjectURL(link.href);
});

function setLoading() {
  resultTitle.textContent = "Buscando carta...";
  resultCount.textContent = "CONSULTANDO";
  resultArea.className = "result-area empty";
  resultArea.innerHTML = `<div class="empty-state"><div class="empty-orbit">✦</div><strong>Consultando el catálogo</strong><p>Estamos buscando la carta y su referencia de Card Kingdom.</p></div>`;
}
function showToast(message) { toast.textContent = message; toast.classList.add("visible"); setTimeout(() => toast.classList.remove("visible"), 2800); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[char])); }
