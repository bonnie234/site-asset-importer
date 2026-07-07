// Site Asset Importer — UI logic
// Replace this after Render is set up.
const BACKEND_URL = 'https://site-asset-importer.onrender.com';

const state = {
  assets: [],
  selected: new Set(),
  favorites: [],
  activeFormat: 'all',
  hideTiny: true,
  hideUnavailable: false,
  loading: false
};

const STORAGE_KEY = 'site-asset-importer:favorites';

const els = {
  urlInput: document.getElementById('urlInput'),
  extractBtn: document.getElementById('extractBtn'),
  status: document.getElementById('status'),
  imageGrid: document.getElementById('imageGrid'),
  resultCount: document.getElementById('resultCount'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  deselectAllBtn: document.getElementById('deselectAllBtn'),
  importBtn: document.getElementById('importBtn'),
  hideTinyToggle: document.getElementById('hideTinyToggle'),
  hideUnavailableToggle: document.getElementById('hideUnavailableToggle'),
  favoritesList: document.getElementById('favoritesList')
};

function setStatus(message, type) {
  els.status.textContent = message || '';
  els.status.className = 'status';

  if (type) {
    els.status.classList.add(type);
  }
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();

  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `https://${raw}`;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (err) {
    return 'source';
  }
}

function getAssetUrl(asset) {
  return asset.proxyUrl || asset.src || asset.url || asset.originalUrl;
}

function getOriginalUrl(asset) {
  return asset.originalUrl || asset.url || asset.src || '';
}

function getDisplayFormat(asset) {
  return String(asset.format || 'image').toUpperCase();
}

function isTiny(asset) {
  const width = Number(asset.width || 0);
  const height = Number(asset.height || 0);

  if (!width || !height) return false;

  return width <= 24 && height <= 24;
}

function isVisibleAsset(asset) {
  if (!asset) return false;

  if (state.activeFormat !== 'all') {
    const format = String(asset.format || '').toLowerCase();
    if (format !== state.activeFormat) return false;
  }

  if (state.hideTiny && isTiny(asset)) {
    return false;
  }

  if (state.hideUnavailable && asset.available === false) {
    return false;
  }

  return true;
}

function visibleAssets() {
  return state.assets.filter(isVisibleAsset);
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function truncate(value, max) {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function isFavorite(asset) {
  const originalUrl = getOriginalUrl(asset);
  return state.favorites.some((fav) => fav.originalUrl === originalUrl);
}

function saveFavorites() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.favorites));
  } catch (err) {
    // Ignore local storage failures.
  }
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.favorites = parsed;
    }
  } catch (err) {
    state.favorites = [];
  }
}

function toggleFavorite(asset) {
  const originalUrl = getOriginalUrl(asset);
  const index = state.favorites.findIndex((fav) => fav.originalUrl === originalUrl);

  if (index >= 0) {
    state.favorites.splice(index, 1);
  } else {
    state.favorites.unshift({
      originalUrl,
      url: getAssetUrl(asset),
      format: asset.format || 'image',
      alt: asset.alt || asset.title || '',
      sourcePage: asset.sourcePage || ''
    });
  }

  state.favorites = state.favorites.slice(0, 24);
  saveFavorites();
  renderFavorites();
  renderAssets();
}

function renderFavorites() {
  if (!state.favorites.length) {
    els.favoritesList.innerHTML = '<div class="empty">No favorites yet.</div>';
    return;
  }

  els.favoritesList.innerHTML = state.favorites
    .map((fav, index) => {
      const label = escapeHtml(truncate(fav.alt || fav.format || 'Asset', 18));
      const src = escapeHtml(fav.url || fav.originalUrl);

      return `
        <button class="favorite-item" type="button" data-favorite-index="${index}" title="${escapeHtml(fav.originalUrl)}">
          <img src="${src}" alt="" />
          <span>${label}</span>
        </button>
      `;
    })
    .join('');

  els.favoritesList.querySelectorAll('[data-favorite-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-favorite-index'));
      const fav = state.favorites[index];

      if (fav && fav.originalUrl) {
        els.urlInput.value = fav.originalUrl;
      }
    });
  });
}

function renderAssets() {
  const assets = visibleAssets();

  els.resultCount.textContent = `${assets.length} found`;

  if (!state.assets.length) {
    els.imageGrid.innerHTML = '<div class="empty">Extracted assets will appear here.</div>';
    els.importBtn.disabled = true;
    return;
  }

  if (!assets.length) {
    els.imageGrid.innerHTML = '<div class="empty">No assets match the current filters.</div>';
    els.importBtn.disabled = true;
    return;
  }

  els.imageGrid.innerHTML = assets
    .map((asset, index) => {
      const originalUrl = getOriginalUrl(asset);
      const assetUrl = getAssetUrl(asset);
      const key = originalUrl || assetUrl || String(index);
      const selected = state.selected.has(key);
      const favorite = isFavorite(asset);
      const format = getDisplayFormat(asset);
      const domain = getDomain(asset.sourcePage || originalUrl);
      const alt = asset.alt || asset.title || '';
      const dims = asset.width && asset.height ? `${asset.width}×${asset.height}` : 'Dimensions unknown';

      const unavailable = asset.available === false;

      let preview = '';

      if (unavailable) {
        preview = `
          <div class="thumb-fallback">
            <strong>Unavailable</strong>
            <span>Open source URL</span>
          </div>
        `;
      } else {
        preview = `
          <img src="${escapeHtml(assetUrl)}" alt="${escapeHtml(alt)}" loading="lazy" />
        `;
      }

      return `
        <article class="asset-card ${selected ? 'selected' : ''}" data-key="${escapeHtml(key)}">
          <div class="thumb-wrap">
            ${preview}
          </div>

          <div class="asset-actions">
            <button class="favorite-btn ${favorite ? 'active' : ''}" type="button" data-action="favorite" title="Favorite">★</button>
            <input type="checkbox" data-action="select" ${selected ? 'checked' : ''} aria-label="Select asset" />
          </div>

          <div class="meta">
            <strong>${escapeHtml(format)}</strong>
            <span>${escapeHtml(dims)}</span>
            <span>${escapeHtml(domain)}</span>

            <div class="source-actions">
              <a class="source-link" href="${escapeHtml(originalUrl)}" target="_blank" rel="noreferrer">Source</a>
              <button class="copy-link" type="button" data-action="copy">Copy URL</button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  els.imageGrid.querySelectorAll('.asset-card').forEach((card) => {
    const key = card.getAttribute('data-key');
    const asset = assets.find((item) => {
      const itemKey = getOriginalUrl(item) || getAssetUrl(item);
      return itemKey === key;
    });

    if (!asset) return;

    const select = card.querySelector('[data-action="select"]');
    const favorite = card.querySelector('[data-action="favorite"]');
    const copy = card.querySelector('[data-action="copy"]');

    select.addEventListener('change', () => {
      if (select.checked) {
        state.selected.add(key);
      } else {
        state.selected.delete(key);
      }

      renderAssets();
      updateImportButton();
    });

    favorite.addEventListener('click', () => {
      toggleFavorite(asset);
    });

    copy.addEventListener('click', async () => {
      const originalUrl = getOriginalUrl(asset);

      try {
        await navigator.clipboard.writeText(originalUrl);
        setStatus('Source URL copied.', 'success');
      } catch (err) {
        setStatus('Could not copy URL. Open the source link instead.', 'error');
      }
    });
  });

  updateImportButton();
}

function updateImportButton() {
  els.importBtn.disabled = state.selected.size === 0 || state.loading;
  els.importBtn.textContent = state.selected.size
    ? `Import Selected (${state.selected.size})`
    : 'Import Selected';
}

function setLoading(isLoading) {
  state.loading = isLoading;
  els.extractBtn.disabled = isLoading;
  els.importBtn.disabled = isLoading || state.selected.size === 0;
}

async function extractAssets() {
  const url = normalizeUrl(els.urlInput.value);

  if (!url) {
    setStatus('Paste a website or direct image URL first.', 'error');
    return;
  }

  if (BACKEND_URL.includes('YOUR-RENDER-URL')) {
    setStatus('Backend URL is not set yet. Replace YOUR-RENDER-URL in ui.js after Render is live.', 'error');
    return;
  }

  setLoading(true);
  setStatus('Extracting assets…', 'busy');

  try {
    const response = await fetch(`${BACKEND_URL}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Could not extract assets.');
    }

    state.assets = Array.isArray(data.assets) ? data.assets : [];
    state.selected.clear();

    if (!state.assets.length) {
      setStatus('No image assets were found at that URL.', 'error');
    } else {
      const mode = data.mode === 'direct-image' ? 'direct image' : 'website';
      setStatus(`Found ${state.assets.length} assets from this ${mode}.`, 'success');
    }

    renderAssets();
  } catch (err) {
    state.assets = [];
    state.selected.clear();
    renderAssets();
    setStatus(err.message || 'Something went wrong while extracting assets.', 'error');
  } finally {
    setLoading(false);
    updateImportButton();
  }
}

async function fetchAssetAsDataUrl(asset) {
  const source = getAssetUrl(asset);

  const absoluteUrl = source.startsWith('http')
    ? `${BACKEND_URL}${source}`
    : source.startsWith('/asset')
      ? `${BACKEND_URL}${source}`
      : source;

  const response = await fetch(absoluteUrl);

  if (!response.ok) {
    throw new Error('Could not fetch selected asset.');
  }

  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read selected asset.'));

    reader.readAsDataURL(blob);
  });
}

async function importSelected() {
  const selectedAssets = state.assets.filter((asset) => {
    const key = getOriginalUrl(asset) || getAssetUrl(asset);
    return state.selected.has(key);
  });

  if (!selectedAssets.length) {
    setStatus('Select at least one asset to import.', 'error');
    return;
  }

  setLoading(true);
  setStatus(`Preparing ${selectedAssets.length} assets for Figma…`, 'busy');

  try {
    const prepared = [];

    for (const asset of selectedAssets) {
      const dataUrl = await fetchAssetAsDataUrl(asset);

      prepared.push({
        dataUrl,
        format: asset.format || 'image',
        sourceUrl: getOriginalUrl(asset),
        sourcePage: asset.sourcePage || '',
        alt: asset.alt || asset.title || '',
        width: asset.width || null,
        height: asset.height || null
      });
    }

    parent.postMessage(
      {
        pluginMessage: {
          type: 'IMPORT_ASSETS',
          assets: prepared
        }
      },
      '*'
    );

    setStatus(`Sending ${prepared.length} assets to Figma…`, 'busy');
  } catch (err) {
    setStatus(err.message || 'Could not import selected assets.', 'error');
  } finally {
    setLoading(false);
    updateImportButton();
  }
}

function selectVisibleAssets() {
  visibleAssets().forEach((asset) => {
    const key = getOriginalUrl(asset) || getAssetUrl(asset);
    state.selected.add(key);
  });

  renderAssets();
}

function deselectAllAssets() {
  state.selected.clear();
  renderAssets();
}

function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeFormat = button.getAttribute('data-format') || 'all';

      document.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.setAttribute('aria-pressed', btn === button ? 'true' : 'false');
      });

      renderAssets();
    });
  });
}

function setupEvents() {
  els.extractBtn.addEventListener('click', extractAssets);

  els.urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      extractAssets();
    }
  });

  els.selectAllBtn.addEventListener('click', selectVisibleAssets);
  els.deselectAllBtn.addEventListener('click', deselectAllAssets);
  els.importBtn.addEventListener('click', importSelected);

  els.hideTinyToggle.addEventListener('change', () => {
    state.hideTiny = els.hideTinyToggle.checked;
    renderAssets();
  });

  els.hideUnavailableToggle.addEventListener('change', () => {
    state.hideUnavailable = els.hideUnavailableToggle.checked;
    renderAssets();
  });
}

window.onmessage = (event) => {
  const message = event.data && event.data.pluginMessage;

  if (!message) return;

  if (message.type === 'IMPORT_COMPLETE') {
    setStatus(message.message || 'Assets imported into Figma.', 'success');
  }

  if (message.type === 'IMPORT_ERROR') {
    setStatus(message.message || 'Figma could not import the assets.', 'error');
  }

  if (message.type === 'FAVORITES_LOADED') {
    if (Array.isArray(message.favorites) && message.favorites.length) {
      state.favorites = message.favorites;
      saveFavorites();
      renderFavorites();
    }
  }
};

function init() {
  loadFavorites();

  state.hideTiny = els.hideTinyToggle.checked;
  state.hideUnavailable = els.hideUnavailableToggle.checked;

  setupFilters();
  setupEvents();
  renderFavorites();
  renderAssets();

  parent.postMessage(
    {
      pluginMessage: {
        type: 'LOAD_FAVORITES'
      }
    },
    '*'
  );
}

init();
