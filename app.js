const form = document.querySelector("#search-form");
const input = document.querySelector("#card-search");
const resultArea = document.querySelector("#result-area");
const resultTitle = document.querySelector("#result-title");
const resultCount = document.querySelector("#result-count");
const table = document.querySelector("#saved-table");
const savedCount = document.querySelector("#saved-count");
const clearListButton = document.querySelector("#clear-list");
const downloadButton = document.querySelector("#download-csv");
const languageFilter = document.querySelector("#language-filter");
const toast = document.querySelector("#toast");

const RESULTS_PER_PAGE = 5;
const STORAGE_KEY = "mtgpricelist_saved_cards";
let savedCards = loadSavedCards();
let searchState = { query: "", page: 1, totalPages: 1, language: "all" };

renderTable();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return;
  await searchCards(query, 1);
});

languageFilter.addEventListener("change", async () => {
  const query = input.value.trim();
  if (!query) return;
  await searchCards(query, 1);
});

async function searchCards(query, page = 1) {
  const selectedLanguage = languageFilter.value || "all";
  setLoading();
  try {
    const result = await findCards(query, page, selectedLanguage);
    if (!result.cards.length) {
      throw new Error("No encontramos resultados que incluyan esa palabra.");
    }

    searchState = { query, page, totalPages: result.totalPages, language: selectedLanguage };
    renderResults(result.cards, query, page, result.totalPages);
  } catch (error) {
    resultTitle.textContent = "No encontramos esa carta";
    resultCount.textContent = "SIN RESULTADOS";
    resultArea.className = "result-area empty";
    resultArea.innerHTML = `<div class="empty-state"><div class="empty-orbit">?</div><strong>Intenta con otro nombre</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function removeAccents(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function buildScryfallSearchCandidates(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const normalized = [
    cleanQuery,
    removeAccents(cleanQuery),
    cleanQuery.toLowerCase(),
    removeAccents(cleanQuery.toLowerCase()),
  ];

  const tokens = [...new Set(
    normalized.flatMap((value) => value.split(/\s+/).filter(Boolean))
  )].filter(Boolean);

  const baseVariants = [...new Set([
    ...normalized,
    ...tokens,
    tokens.join(" "),
    tokens.join(" OR "),
  ])].filter(Boolean);

  const candidates = [];

  baseVariants.forEach((variant) => {
    const safe = variant.replace(/"/g, "").trim();
    if (!safe) return;

    candidates.push(`name:${safe}`);
    candidates.push(`name:"${safe}"`);
    candidates.push(`oracle:${safe}`);
    candidates.push(`oracle:"${safe}"`);
    candidates.push(`lang:es name:${safe}`);
    candidates.push(`lang:es name:"${safe}"`);
  });

  return [...new Set(candidates)];
}

async function fetchScryfallCards(query, page = 1) {
  const candidateQueries = buildScryfallSearchCandidates(query);

  for (const candidate of candidateQueries) {
    try {
      const response = await fetch(
        `https://api.scryfall.com/cards/search?q=${encodeURIComponent(candidate)}&order=name&unique=prints&page=${page}&per_page=${RESULTS_PER_PAGE}`
      );

      if (!response.ok) continue;

      const data = await response.json();
      if (Array.isArray(data.data) && data.data.length) {
        return data;
      }
    } catch {
      continue;
    }
  }

  return { data: [], total_cards: 0 };
}

function groupCardVariants(cards) {
  const grouped = new Map();

  cards.forEach((card) => {
    const key = normalizeCardName(card.name || "");
    if (!key) return;

    if (!grouped.has(key)) {
      grouped.set(key, {
        name: card.name,
        image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || "",
        language: card.lang === "es" ? "Español" : "Inglés",
        set: card.set_name || "Set desconocido",
        oracleText: card.oracle_text || "Sin descripción disponible",
        rarity: card.rarity || "Común",
        kingdomUrl: `https://www.cardkingdom.com/catalog/search?filter%5Bname%5D=${encodeURIComponent(card.name)}`,
        variants: [],
        priceUsd: getScryfallPrice(card),
        priceClp: null,
      });
    }

    const group = grouped.get(key);
    const variant = {
      name: card.name,
      set: card.set_name || "Set desconocido",
      language: card.lang === "es" ? "Español" : "Inglés",
      rarity: card.rarity || "Común",
      image: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || group.image || "",
      oracleText: card.oracle_text || group.oracleText || "Sin descripción disponible",
      kingdomUrl: `https://www.cardkingdom.com/catalog/search?filter%5Bname%5D=${encodeURIComponent(card.name)}`,
      priceUsd: getScryfallPrice(card),
      priceClp: null,
    };

    const exists = group.variants.some((item) => item.set === variant.set && item.language === variant.language);
    if (!exists) {
      group.variants.push(variant);
    }
  });

  return [...grouped.values()].map((card) => ({
    ...card,
    variantSummary: card.variants.slice(0, 8).map((item) => `${item.set} · ${item.language}`).join(" • "),
  }));
}

async function findCards(query, page = 1, language = "all") {
  try {
    const data = await fetchScryfallCards(query, page);
    const filteredData = Array.isArray(data.data)
      ? data.data.filter((card) => language === "all" || (language === "es" ? card.lang === "es" : card.lang !== "es"))
      : [];

    if (!filteredData.length) {
      return { cards: await findClosestFallback(query, language), totalPages: 1 };
    }

    const cards = groupCardVariants(filteredData);
    const enrichedCards = await Promise.all(cards.map((card) => enrichCard(card)));
    const totalPages = Math.max(1, Math.ceil((filteredData.length || enrichedCards.length) / RESULTS_PER_PAGE));
    return { cards: enrichedCards, totalPages };
  } catch {
    return { cards: await findClosestFallback(query, language), totalPages: 1 };
  }
}

async function findClosestFallback(query, language = "all") {
  try {
    const data = await fetchScryfallCards(query, 1);
    const filteredData = Array.isArray(data.data)
      ? data.data.filter((card) => language === "all" || (language === "es" ? card.lang === "es" : card.lang !== "es"))
      : [];

    return groupCardVariants(filteredData).slice(0, RESULTS_PER_PAGE).map((card) => ({
      ...card,
      priceUsd: null,
      priceClp: null,
    }));
  } catch {
    return [];
  }
}

async function enrichCard(card) {
  const rate = await getUsdToClpRate();
  const basePrice = card.priceUsd ?? await getCardKingdomPrice(card.name);
  const basePriceUsd = Number(basePrice ?? 0);
  const basePriceClp = basePriceUsd > 0 ? Math.round(basePriceUsd * rate) : null;

  const variantPrices = card.variants && card.variants.length
    ? await Promise.all(card.variants.map(async (variant) => {
        const variantPrice = variant.priceUsd ?? await getCardKingdomPrice(variant.name);
        const variantPriceUsd = Number(variantPrice ?? basePriceUsd ?? 0);
        return {
          ...variant,
          priceUsd: variantPriceUsd > 0 ? variantPriceUsd : null,
          priceClp: variantPriceUsd > 0 ? Math.round(variantPriceUsd * rate) : null,
        };
      }))
    : [];

  const resolvedVariants = variantPrices.length ? variantPrices : (card.variants || []).map((variant) => ({
    ...variant,
    priceUsd: basePriceUsd > 0 ? basePriceUsd : null,
    priceClp: basePriceClp,
  }));

  const defaultVariantPriceUsd = Number(resolvedVariants[0]?.priceUsd ?? basePriceUsd ?? 0);
  const defaultVariantPriceClp = defaultVariantPriceUsd > 0 ? Math.round(defaultVariantPriceUsd * rate) : null;

  return {
    ...card,
    variants: resolvedVariants,
    priceUsd: defaultVariantPriceUsd > 0 ? defaultVariantPriceUsd : null,
    priceClp: defaultVariantPriceClp,
  };
}

function renderResults(cards, query, page, totalPages) {
  const languageLabel = languageFilter.value === "es" ? "Español" : languageFilter.value === "en" ? "Inglés" : "Todos";
  resultTitle.textContent = `Coincidencias para “${escapeHtml(query)}”`;
  resultCount.textContent = `${cards.length} RESULTADOS · ${languageLabel}`;
  resultArea.className = "result-area";

  const cardsMarkup = cards.map((card) => {
    const quantityValue = 1;
    const defaultVariant = card.variants?.[0] || card;
    const selectedVariant = defaultVariant || card;
    const priceUsd = Number(selectedVariant?.priceUsd ?? card.priceUsd ?? 0);
    const priceClp = Number(selectedVariant?.priceClp ?? card.priceClp ?? 0);
    const variantsMarkup = (card.variants || []).map((variant, index) => {
      const isSelected = index === 0;
      const variantLabel = `${variant.set} · ${variant.language}`;
      return `
        <button
          type="button"
          class="variant-option ${isSelected ? "selected" : ""}"
          data-card-name="${escapeHtml(card.name)}"
          data-variant-set="${escapeHtml(variant.set)}"
          data-variant-language="${escapeHtml(variant.language)}"
          data-variant-image="${(variant.image || card.image || "").replace(/"/g, "&quot;")}"
          data-variant-price-usd="${variant.priceUsd ?? card.priceUsd ?? ""}"
          data-variant-price-clp="${variant.priceClp ?? card.priceClp ?? ""}"
          title="${escapeHtml(variantLabel)}"
          aria-label="Seleccionar versión ${escapeHtml(variantLabel)}"
        >
          <span>${escapeHtml(variant.set)}</span>
        </button>
      `;
    }).join("");

    return `
      <article class="card-result" data-selected-name="${escapeHtml(card.name)}" data-selected-set="${escapeHtml(defaultVariant.set)}" data-selected-language="${escapeHtml(defaultVariant.language)}" data-current-image="${escapeHtml(defaultVariant.image || card.image || "")}" data-selected-price-usd="${priceUsd}" data-selected-price-clp="${priceClp}">
        <img class="card-image" src="${defaultVariant.image || card.image}" alt="${escapeHtml(card.name)}" />
        <div class="result-info">
          <span class="tag">${escapeHtml(card.language.toUpperCase())} · ${escapeHtml(card.set)}</span>
          <h3>${escapeHtml(card.name)}</h3>
          <span class="subname">RAREZA: ${escapeHtml(String(card.rarity).toUpperCase())}</span>
          <div class="variants-box">
            <span>Variantes</span>
            <div class="variant-list">${variantsMarkup}</div>
          </div>
          <span class="price-label">PRECIO CARD KINGDOM</span>
          <strong class="price">${priceUsd > 0 ? `$${priceUsd.toFixed(2)} USD` : "Consultar"}</strong>
          <span class="price-note">${priceClp > 0 ? `Equivale a ${formatClp(priceClp)} CLP` : "Precio aún no disponible"}</span>
          <p class="oracle-text">${escapeHtml(card.oracleText)}</p>
          <div class="result-actions">
            <label class="quantity-control">
              <span>Cantidad</span>
              <input class="quantity-input" type="number" min="1" value="${quantityValue}" data-name="${card.name}" />
            </label>
            <button class="save-button" type="button" data-name="${card.name}">＋ Agregar</button>
            <a class="external-button" href="${card.kingdomUrl}" target="_blank" rel="noreferrer">Ver en Card Kingdom ↗</a>
          </div>
        </div>
      </article>
    `;
  }).join("");

  const pagination = totalPages > 1 ? `
    <div class="search-pagination">
      <button class="page-button" type="button" data-page="${Math.max(1, page - 1)}" ${page === 1 ? "disabled" : ""}>Anterior</button>
      <span>Página ${page} de ${totalPages}</span>
      <button class="page-button" type="button" data-page="${Math.min(totalPages, page + 1)}" ${page >= totalPages ? "disabled" : ""}>Siguiente</button>
    </div>
  ` : "";

  resultArea.innerHTML = `<div class="result-list">${cardsMarkup}</div>${pagination}`;

  resultArea.querySelectorAll(".variant-option").forEach((button) => {
    button.addEventListener("click", () => {
      const article = button.closest(".card-result");
      const variantButtons = article.querySelectorAll(".variant-option");
      variantButtons.forEach((item) => item.classList.toggle("selected", item === button));

      const selectedImage = button.dataset.variantImage || article.dataset.currentImage || "";
      const selectedPriceUsd = Number(button.dataset.variantPriceUsd || article.dataset.selectedPriceUsd || 0);
      const selectedPriceClp = Number(button.dataset.variantPriceClp || article.dataset.selectedPriceClp || 0);
      const imageElement = article.querySelector(".card-image");
      if (imageElement && selectedImage) {
        imageElement.src = selectedImage;
      }

      const priceElement = article.querySelector(".price");
      const priceNoteElement = article.querySelector(".price-note");
      if (priceElement) {
        priceElement.textContent = selectedPriceUsd > 0 ? `$${selectedPriceUsd.toFixed(2)} USD` : "Consultar";
      }
      if (priceNoteElement) {
        priceNoteElement.textContent = selectedPriceClp > 0 ? `Equivale a ${formatClp(selectedPriceClp)} CLP` : "Precio aún no disponible";
      }

      article.dataset.selectedSet = button.dataset.variantSet;
      article.dataset.selectedLanguage = button.dataset.variantLanguage;
      article.dataset.currentImage = selectedImage;
      article.dataset.selectedPriceUsd = String(selectedPriceUsd);
      article.dataset.selectedPriceClp = String(selectedPriceClp);
    });
  });

  resultArea.querySelectorAll(".save-button").forEach((button) => {
    button.addEventListener("click", () => {
      const card = cards.find((item) => item.name === button.dataset.name);
      const article = button.closest(".card-result");
      const selectedVariantButton = article?.querySelector(".variant-option.selected");
      const selectedVariant = card?.variants?.find((variant) =>
        variant.set === selectedVariantButton?.dataset.variantSet &&
        variant.language === selectedVariantButton?.dataset.variantLanguage
      ) || card?.variants?.[0] || card;

      const quantityInput = resultArea.querySelector(`.quantity-input[data-name="${button.dataset.name}"]`);
      const quantity = Number(quantityInput?.value || 1);
      const cardToSave = selectedVariant && card ? {
        ...card,
        ...selectedVariant,
        name: selectedVariant.name || card.name,
        image: selectedVariant.image || card.image,
        set: selectedVariant.set || card.set,
        language: selectedVariant.language || card.language,
        oracleText: selectedVariant.oracleText || card.oracleText,
        rarity: selectedVariant.rarity || card.rarity,
        kingdomUrl: selectedVariant.kingdomUrl || card.kingdomUrl,
        priceUsd: selectedVariant.priceUsd ?? card.priceUsd ?? null,
        priceClp: selectedVariant.priceClp ?? card.priceClp ?? null,
      } : card;

      if (cardToSave) saveCard(cardToSave, quantity);
    });
  });

  resultArea.querySelectorAll(".page-button").forEach((button) => {
    const nextPage = Number(button.dataset.page);
    if (!Number.isNaN(nextPage)) {
      button.addEventListener("click", () => searchCards(searchState.query, nextPage));
    }
  });
}

function normalizeCardName(value) {
  return removeAccents(String(value || "")).trim().toLowerCase();
}

function getScryfallPrice(card) {
  const price = card.prices?.usd || card.prices?.usd_foil || card.prices?.usd_etched;
  const numericPrice = Number(price);
  return numericPrice > 0 ? numericPrice : null;
}

function saveCard(card, quantity = 1) {
  const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const normalizedCard = {
    ...card,
    quantity: safeQuantity,
    priceUsd: card.priceUsd ?? null,
    priceClp: card.priceClp ?? (card.priceUsd ? convertUsdToClp(card.priceUsd) : null),
  };

  const cardKey = getSavedCardKey(normalizedCard);
  const existing = savedCards.find((saved) => getSavedCardKey(saved) === cardKey);
  if (existing) {
    existing.quantity += safeQuantity;
    persistSavedCards();
    renderTable();
    showToast(`${safeQuantity} más agregadas a ${normalizedCard.name}.`);
    return;
  }

  savedCards.push(normalizedCard);
  persistSavedCards();
  renderTable();
  showToast(`${safeQuantity} carta${safeQuantity > 1 ? "s" : ""} agregada${safeQuantity > 1 ? "s" : ""} a la lista.`);
}

function getSavedCardKey(card) {
  return [card.name, card.set, card.language]
    .map((value) => normalizeCardName(value))
    .join("|");
}

function loadSavedCards() {
  try {
    const storedValue = localStorage.getItem(STORAGE_KEY);
    const parsed = storedValue ? JSON.parse(storedValue) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedCards() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCards));
}

function renderTable() {
  savedCount.textContent = savedCards.length;
  clearListButton.disabled = savedCards.length === 0;
  downloadButton.disabled = savedCards.length === 0;

  if (!savedCards.length) {
    table.innerHTML = `<tr class="table-empty"><td colspan="6">Aún no has guardado cartas. La lista se mantiene guardada entre cierres.</td></tr>`;
    return;
  }

  const totalUsd = savedCards.reduce((sum, card) => sum + Number((card.priceUsd ?? 0) * (card.quantity ?? 1)), 0);
  const totalClp = savedCards.reduce((sum, card) => sum + Number((card.priceClp ?? convertUsdToClp(card.priceUsd ?? 0)) * (card.quantity ?? 1)), 0);

  const rows = savedCards.map((card, index) => {
    const unitPrice = card.priceUsd === null ? "Consultar" : `$${card.priceUsd.toFixed(2)} USD`;
    const total = card.priceUsd === null ? "Consultar" : `${formatClp((card.priceClp ?? convertUsdToClp(card.priceUsd)) * (card.quantity ?? 1))} CLP`;
    return `
      <tr>
        <td class="table-card">${escapeHtml(card.name)}<small>${escapeHtml(card.set || "Edición desconocida")}</small></td>
        <td class="table-qty">${card.quantity ?? 1}</td>
        <td class="table-lang">${card.language}</td>
        <td class="table-price">${unitPrice}</td>
        <td class="table-total">${total}</td>
        <td><button class="remove-card" data-index="${index}" aria-label="Quitar ${escapeHtml(card.name)}">×</button></td>
      </tr>
    `;
  }).join("");

  table.innerHTML = `${rows}
    <tr class="total-row">
      <td colspan="4"><strong>TOTAL</strong></td>
      <td><strong>${formatClp(totalClp)}</strong><div class="sub-total">${formatUsd(totalUsd)} USD</div></td>
      <td></td>
    </tr>`;

  table.querySelectorAll(".remove-card").forEach((button) => {
    button.addEventListener("click", () => {
      savedCards.splice(Number(button.dataset.index), 1);
      persistSavedCards();
      renderTable();
    });
  });
}

clearListButton.addEventListener("click", () => {
  if (!savedCards.length) {
    showToast("La lista ya está vacía.");
    return;
  }

  savedCards = [];
  persistSavedCards();
  renderTable();
  showToast("Lista temporal vaciada.");
});

downloadButton.addEventListener("click", () => {
  const rows = [["Carta", "Cantidad", "Idioma", "Precio USD", "Precio CLP", "Enlace"]];
  savedCards.forEach((card) => {
    rows.push([
      card.name,
      card.quantity ?? 1,
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

