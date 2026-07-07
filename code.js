// Site Asset Importer — Figma plugin main code

figma.showUI(__html__, {
  width: 430,
  height: 680
});

const STORAGE_KEY = 'site-asset-importer:favorites';

function dataUrlToBytes(dataUrl) {
  const parts = String(dataUrl || '').split(',');

  if (parts.length < 2) {
    throw new Error('Invalid image data.');
  }

  const base64 = parts[1];
  const binary = figma.base64Decode(base64);

  return binary;
}

function getMimeFromDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
  return match ? match[1].toLowerCase() : '';
}

function detectFormatFromDataUrl(dataUrl, fallback) {
  const mime = getMimeFromDataUrl(dataUrl);

  if (mime.includes('svg')) return 'svg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('avif')) return 'avif';

  return fallback || 'image';
}

function safeName(value, fallback) {
  const raw = String(value || '').trim();

  if (!raw) return fallback;

  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/g, '')
    .replace(/\/$/g, '')
    .split('/')
    .pop()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .slice(0, 60) || fallback;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (err) {
    return 'imported-assets';
  }
}

function getSizeForAsset(asset, image) {
  const fallbackWidth = 260;
  const fallbackHeight = 180;

  let width = Number(asset.width || 0);
  let height = Number(asset.height || 0);

  if ((!width || !height) && image && image.width && image.height) {
    width = image.width;
    height = image.height;
  }

  if (!width || !height) {
    width = fallbackWidth;
    height = fallbackHeight;
  }

  const maxWidth = 600;
  const maxHeight = 420;

  const scale = Math.min(1, maxWidth / width, maxHeight / height);

  return {
    width: Math.max(24, Math.round(width * scale)),
    height: Math.max(24, Math.round(height * scale))
  };
}

async function createRasterNode(asset, index) {
  const bytes = dataUrlToBytes(asset.dataUrl);
  const image = figma.createImage(bytes);

  let size = {
    width: 260,
    height: 180
  };

  try {
    const dimensions = await image.getSizeAsync();
    size = getSizeForAsset(asset, dimensions);
  } catch (err) {
    size = getSizeForAsset(asset, null);
  }

  const rect = figma.createRectangle();

  rect.name = safeName(asset.alt || asset.sourceUrl, `Imported Asset ${index + 1}`);
  rect.resize(size.width, size.height);

  rect.fills = [
    {
      type: 'IMAGE',
      scaleMode: 'FIT',
      imageHash: image.hash
    }
  ];

  return rect;
}

async function createSvgNode(asset, index) {
  try {
    const parts = String(asset.dataUrl || '').split(',');

    if (parts.length < 2) {
      throw new Error('Invalid SVG data.');
    }

    const encodedSvg = parts.slice(1).join(',');
    const svgText = decodeURIComponent(encodedSvg);

    const node = figma.createNodeFromSvg(svgText);
    node.name = safeName(asset.alt || asset.sourceUrl, `Imported SVG ${index + 1}`);

    return node;
  } catch (err) {
    // If SVG parsing fails, fall back to raster import.
    return createRasterNode(asset, index);
  }
}

function addMetadataText(parent, asset) {
  const sourceUrl = String(asset.sourceUrl || '').trim();

  if (!sourceUrl) return;

  const text = figma.createText();

  text.name = 'Source URL';
  text.characters = sourceUrl;
  text.fontSize = 10;
  text.fills = [
    {
      type: 'SOLID',
      color: {
        r: 0.35,
        g: 0.35,
        b: 0.35
      }
    }
  ];

  text.x = 0;
  text.y = parent.height + 8;

  parent.appendChild(text);
}

async function createAssetFrame(asset, index) {
  const format = detectFormatFromDataUrl(asset.dataUrl, asset.format);
  const sourceUrl = asset.sourceUrl || '';
  const sourceDomain = getDomain(asset.sourcePage || sourceUrl);

  const frame = figma.createFrame();

  frame.name = `${sourceDomain} / ${safeName(asset.alt || sourceUrl, `Asset ${index + 1}`)}`;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'AUTO';
  frame.itemSpacing = 8;
  frame.paddingTop = 12;
  frame.paddingRight = 12;
  frame.paddingBottom = 12;
  frame.paddingLeft = 12;
  frame.fills = [
    {
      type: 'SOLID',
      color: {
        r: 1,
        g: 1,
        b: 1
      }
    }
  ];
  frame.strokes = [
    {
      type: 'SOLID',
      color: {
        r: 0.88,
        g: 0.88,
        b: 0.88
      }
    }
  ];
  frame.strokeWeight = 1;
  frame.cornerRadius = 8;

  let assetNode;

  if (format === 'svg') {
    assetNode = await createSvgNode(asset, index);
  } else {
    assetNode = await createRasterNode(asset, index);
  }

  frame.appendChild(assetNode);

  const caption = figma.createText();
  caption.name = 'Attribution / Source';
  caption.characters = sourceUrl ? `Source: ${sourceUrl}` : 'Source: unknown';
  caption.fontSize = 10;
  caption.fills = [
    {
      type: 'SOLID',
      color: {
        r: 0.35,
        g: 0.35,
        b: 0.35
      }
    }
  ];

  caption.resizeWithoutConstraints(Math.max(220, Math.min(520, assetNode.width || 260)), caption.height);
  frame.appendChild(caption);

  return frame;
}

async function ensureFonts() {
  await figma.loadFontAsync({
    family: 'Inter',
    style: 'Regular'
  });
}

async function importAssets(assets) {
  if (!Array.isArray(assets) || !assets.length) {
    throw new Error('No assets were provided for import.');
  }

  await ensureFonts();

  const createdFrames = [];
  let currentX = figma.viewport.center.x;
  let currentY = figma.viewport.center.y;

  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i];

    if (!asset || !asset.dataUrl) {
      continue;
    }

    const frame = await createAssetFrame(asset, i);

    frame.x = currentX;
    frame.y = currentY;

    createdFrames.push(frame);

    currentX += frame.width + 32;

    if ((i + 1) % 3 === 0) {
      currentX = figma.viewport.center.x;
      currentY += frame.height + 40;
    }
  }

  if (!createdFrames.length) {
    throw new Error('No valid assets could be imported.');
  }

  figma.currentPage.selection = createdFrames;
  figma.viewport.scrollAndZoomIntoView(createdFrames);

  return createdFrames.length;
}

async function loadFavorites() {
  try {
    const favorites = await figma.clientStorage.getAsync(STORAGE_KEY);
    return Array.isArray(favorites) ? favorites : [];
  } catch (err) {
    return [];
  }
}

async function saveFavorites(favorites) {
  try {
    if (Array.isArray(favorites)) {
      await figma.clientStorage.setAsync(STORAGE_KEY, favorites.slice(0, 24));
    }
  } catch (err) {
    // Ignore storage failures.
  }
}

figma.ui.onmessage = async (message) => {
  try {
    if (!message || !message.type) return;

    if (message.type === 'IMPORT_ASSETS') {
      const count = await importAssets(message.assets);

      figma.ui.postMessage({
        type: 'IMPORT_COMPLETE',
        message: `${count} asset${count === 1 ? '' : 's'} imported into Figma.`
      });

      return;
    }

    if (message.type === 'LOAD_FAVORITES') {
      const favorites = await loadFavorites();

      figma.ui.postMessage({
        type: 'FAVORITES_LOADED',
        favorites
      });

      return;
    }

    if (message.type === 'SAVE_FAVORITES') {
      await saveFavorites(message.favorites);

      figma.ui.postMessage({
        type: 'FAVORITES_SAVED'
      });

      return;
    }

    if (message.type === 'CLOSE_PLUGIN') {
      figma.closePlugin();
    }
  } catch (err) {
    figma.ui.postMessage({
      type: 'IMPORT_ERROR',
      message: err.message || 'Something went wrong in Figma.'
    });
  }
};
