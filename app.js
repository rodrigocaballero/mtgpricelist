const form = document.querySelector("#search-form");
const input = document.querySelector("#card-search");
const resultArea = document.querySelector("#result-area");
const resultTitle = document.querySelector("#result-title");
const resultCount = document.querySelector("#result-count");
const table = document.querySelector("#saved-table");
const savedCount = document.querySelector("#saved-count");
const downloadButton = document.querySelector("#download-csv");
const toast = document.querySelector("#toast");

// La lista vive únicamente en memoria: al recargar o cerrar la pestaña vuelve a estar vacía.
let savedCards = [];
let currentCard = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  setLoading();
  try {
    const cards = await findCards(query);
    if (!cards.length) {
      throw new Error("No encontramos resultados que incluyan esa palabra.");
    }
    renderOptions(cards, query);
  } catch (error) {
    currentCard = null;
    resultTitle.textContent = "No encontramos esa carta";
    resultCount.textContent = "SIN RESULTADOS";
    resultArea.className = "result-area empty";
    resultArea.innerHTML = `<div class="empty-state"><div class="empty-orbit">?</div><strong>Intenta con otro nombre</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
});

async function findCards(query) {
  try {
    const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(`name:${query}`)}&order=name&unique=cards`);
    if (!response.ok) return await findClosestFallback(query);

    const data = await response.json();
    const cards = (data.data || []).slice(0, 8).map((card) => ({
      name: card.name,
      image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || "",
      language: card.lang === "es" ? "Español" : "Inglés",
      price: null,
      kingdomUrl: `https://www.cardkingdom.com/catalog/search?filter%5Bname%5D=${encodeURIComponent(card.name)}`,
      set: card.set_name,
      id: card.id,
    }));

    if (cards.length) {
      return cards;
    }

    return await findClosestFallback(query);
  } catch {
    return await findClosestFallback(query);
  }
}

async function findClosestFallback(query) {
  try {
    const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(query)}`);
    if (!response.ok) return [];

    const card = await response.json();
    return [{
      name: card.name,
      image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || "",
      language: card.lang === "es" ? "Español" : "Inglés",
      price: null,
      kingdomUrl: `https://www.cardkingdom.com/catalog/search?filter%5Bname%5D=${encodeURIComponent(card.name)}`,
      set: card.set_name,
      id: card.id,
    }];
  } catch {
    return [];
  }
}

async function enrichCard(card) {
  const price = await getCardKingdomPrice(card.name);
  return { ...card, price };
}

function renderOptions(cards, query) {
  resultTitle.textContent = `Coincidencias para “${escapeHtml(query)}”`;
  resultCount.textContent = `${cards.length} RESULTADOS`;
  resultArea.className = "result-area";
  resultArea.innerHTML = `<div class="result-options">${cards.map((card, index) => `
    <button class="option-card" type="button" data-index="${index}">
      <span class="option-card-name">${escapeHtml(card.name)}</span>
      <span class="option-card-set">${escapeHtml(card.set || "Carta")}</span>
    </button>
  `).join("")}</div>`;

  resultArea.querySelectorAll(".option-card").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.index);
      const selectedCard = cards[index];
      const enrichedCard = await enrichCard(selectedCard);
      currentCard = enrichedCard;
      renderResult(enrichedCard);
    });
  });
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
