const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const sharp = require('sharp');

const app = express();

const PORT = process.env.PORT || 3000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ASSETS = 80;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif'
]);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 SiteAssetImporter/1.0';

function normalizeUrl(input) {
  const value = String(input || '').trim();

  if (!value) {
    throw new Error('Missing URL.');
  }

  let url = value;

  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  const parsed = new URL(url);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  return parsed.toString();
}

function resolveUrl(baseUrl, maybeUrl) {
  if (!maybeUrl) return null;

  const raw = String(maybeUrl).trim();

  if (!raw) return null;
  if (raw.startsWith('data:image/')) return raw;
  if (raw.startsWith('//')) {
    const base = new URL(baseUrl);
    return `${base.protocol}${raw}`;
  }

  try {
    return new URL(raw, baseUrl).toString();
  } catch (err) {
    return null;
  }
}

function getContentType(headers) {
  return String(headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
}

function extensionFromUrl(url) {
  const clean = String(url || '').toLowerCase().split('?')[0].split('#')[0];

  if (clean.endsWith('.svg')) return 'svg';
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'jpg';
  if (clean.endsWith('.gif')) return 'gif';
  if (clean.endsWith('.webp')) return 'webp';
  if (clean.endsWith('.avif')) return 'avif';

  return '';
}

function formatFromContentType(contentType, url) {
  const type = String(contentType || '').toLowerCase();

  if (type.includes('svg')) return 'svg';
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('gif')) return 'gif';
  if (type.includes('webp')) return 'webp';
  if (type.includes('avif')) return 'avif';

  const ext = extensionFromUrl(url);
  if (ext) return ext;

  if (/\/is\/image\//i.test(String(url || ''))) return 'cdn';

  return 'image';
}

function looksLikeImageUrl(url) {
  const value = String(url || '').trim();

  if (!value) return false;

  if (/^data:image\/(svg\+xml|png|jpe?g|gif|webp|avif)/i.test(value)) return true;

  if (/\.(svg|png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(value)) return true;

  // Common image CDN pattern, including Cox/Akamai/Adobe Scene7-style URLs:
  // https://assets.cox.com/is/image/cox/example?$carousel-imagery$&wid=518&hei=512
  if (/\/is\/image\//i.test(value)) return true;

  // Common image transform query params.
  if (/[?&](wid|width|w|hei|height|h|fmt|format|qlt|quality|fit|crop)=/i.test(value)) {
    return true;
  }

  return false;
}

function dedupeAssets(assets) {
  const seen = new Set();
  const output = [];

  for (const asset of assets) {
    if (!asset || !asset.url) continue;

    const key = asset.url;
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(asset);
  }

  return output;
}

function parseSrcset(srcset) {
  const value = String(srcset || '').trim();
  if (!value) return [];

  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function makeAsset(url, sourcePage, extra = {}) {
  const format = extra.format || formatFromContentType(extra.contentType, url);

  return {
    url,
    src: url,
    proxyUrl: `/asset?url=${encodeURIComponent(url)}`,
    originalUrl: url,
    sourcePage,
    format,
    contentType: extra.contentType || '',
    width: extra.width || null,
    height: extra.height || null,
    alt: extra.alt || '',
    title: extra.title || '',
    available: extra.available !== false
  };
}

async function fetchWithLimit(url, maxBytes) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/gif,*/*;q=0.8'
    }
  });

  const contentType = getContentType(response.headers);

  if (!response.ok) {
    const error = new Error(`Fetch failed with status ${response.status}.`);
    error.status = response.status;
    error.contentType = contentType;
    throw error;
  }

  const contentLength = Number(response.headers.get('content-length') || 0);

  if (contentLength && contentLength > maxBytes) {
    throw new Error('Response is too large.');
  }

  const buffer = await response.buffer();

  if (buffer.length > maxBytes) {
    throw new Error('Response is too large.');
  }

  return {
    response,
    buffer,
    contentType
  };
}

async function getImageMetadata(buffer, contentType) {
  try {
    if (contentType === 'image/svg+xml') {
      return {};
    }

    const meta = await sharp(buffer).metadata();

    return {
      width: meta.width || null,
      height: meta.height || null
    };
  } catch (err) {
    return {};
  }
}

async function handleDirectImage(url) {
  const fetched = await fetchWithLimit(url, MAX_IMAGE_BYTES);

  if (!SUPPORTED_IMAGE_TYPES.has(fetched.contentType) && !looksLikeImageUrl(url)) {
    throw new Error('The URL did not return a supported image type.');
  }

  const metadata = await getImageMetadata(fetched.buffer, fetched.contentType);

  return [
    makeAsset(url, url, {
      contentType: fetched.contentType,
      format: formatFromContentType(fetched.contentType, url),
      width: metadata.width,
      height: metadata.height,
      alt: '',
      title: ''
    })
  ];
}

function extractAssetsFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const candidates = [];

  $('img').each((index, element) => {
    const img = $(element);

    const src = img.attr('src');
    const dataSrc = img.attr('data-src') || img.attr('data-original') || img.attr('data-lazy-src');
    const srcset = img.attr('srcset') || img.attr('data-srcset');

    const urls = [];

    if (src) urls.push(src);
    if (dataSrc) urls.push(dataSrc);

    for (const srcsetUrl of parseSrcset(srcset)) {
      urls.push(srcsetUrl);
    }

    for (const rawUrl of urls) {
      const resolved = resolveUrl(pageUrl, rawUrl);
      if (!resolved) continue;

      candidates.push(
        makeAsset(resolved, pageUrl, {
          alt: img.attr('alt') || '',
          title: img.attr('title') || '',
          width: Number(img.attr('width')) || null,
          height: Number(img.attr('height')) || null
        })
      );
    }
  });

  $('source').each((index, element) => {
    const source = $(element);
    const srcset = source.attr('srcset');

    for (const srcsetUrl of parseSrcset(srcset)) {
      const resolved = resolveUrl(pageUrl, srcsetUrl);
      if (!resolved) continue;
      candidates.push(makeAsset(resolved, pageUrl));
    }
  });

  $('svg').each((index, element) => {
    const svgHtml = $.html(element);
    if (!svgHtml) return;

    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgHtml)}`;

    candidates.push({
      url: dataUrl,
      src: dataUrl,
      proxyUrl: dataUrl,
      originalUrl: dataUrl,
      sourcePage: pageUrl,
      format: 'svg',
      contentType: 'image/svg+xml',
      width: null,
      height: null,
      alt: 'Inline SVG',
      title: 'Inline SVG',
      available: true
    });
  });

  $('meta[property="og:image"], meta[name="twitter:image"], meta[property="og:image:url"]').each(
    (index, element) => {
      const content = $(element).attr('content');
      const resolved = resolveUrl(pageUrl, content);
      if (!resolved) return;
      candidates.push(makeAsset(resolved, pageUrl, { title: 'Social preview image' }));
    }
  );

  $('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').each(
    (index, element) => {
      const href = $(element).attr('href');
      const resolved = resolveUrl(pageUrl, href);
      if (!resolved) return;
      candidates.push(makeAsset(resolved, pageUrl, { title: 'Site icon' }));
    }
  );

  $('[style]').each((index, element) => {
    const style = $(element).attr('style') || '';
    const matches = style.match(/url\((['"]?)(.*?)\1\)/gi) || [];

    for (const match of matches) {
      const cleaned = match
        .replace(/^url\((['"]?)/i, '')
        .replace(/(['"]?)\)$/i, '')
        .trim();

      const resolved = resolveUrl(pageUrl, cleaned);
      if (!resolved) continue;

      candidates.push(makeAsset(resolved, pageUrl, { title: 'Background image' }));
    }
  });

  return dedupeAssets(candidates)
    .filter((asset) => {
      return (
        asset.url.startsWith('data:image/') ||
        looksLikeImageUrl(asset.url) ||
        ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'cdn', 'image'].includes(asset.format)
      );
    })
    .slice(0, MAX_ASSETS);
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'Site Asset Importer Backend',
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true
  });
});

app.post('/extract', async (req, res) => {
  try {
    const url = normalizeUrl(req.body && req.body.url);

    // If it looks like a direct image/CDN URL, try that first.
    if (looksLikeImageUrl(url)) {
      try {
        const directAssets = await handleDirectImage(url);
        return res.json({
          ok: true,
          url,
          mode: 'direct-image',
          assets: directAssets
        });
      } catch (directErr) {
        // Fall through to HTML fetch in case the URL looked image-like but returns HTML.
      }
    }

    const fetched = await fetchWithLimit(url, MAX_HTML_BYTES);

    if (SUPPORTED_IMAGE_TYPES.has(fetched.contentType)) {
      const metadata = await getImageMetadata(fetched.buffer, fetched.contentType);

      return res.json({
        ok: true,
        url,
        mode: 'direct-image',
        assets: [
          makeAsset(url, url, {
            contentType: fetched.contentType,
            format: formatFromContentType(fetched.contentType, url),
            width: metadata.width,
            height: metadata.height
          })
        ]
      });
    }

    if (!fetched.contentType.includes('text/html')) {
      return res.status(415).json({
        ok: false,
        error:
          'That URL did not return website HTML or a supported image. Try a public webpage URL or direct image/CDN URL.'
      });
    }

    const html = fetched.buffer.toString('utf8');
    const assets = extractAssetsFromHtml(html, url);

    res.json({
      ok: true,
      url,
      mode: 'html',
      assets
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || 'Could not extract assets from that URL.'
    });
  }
});

app.get('/asset', async (req, res) => {
  try {
    const url = normalizeUrl(req.query.url);

    const fetched = await fetchWithLimit(url, MAX_IMAGE_BYTES);
    const contentType = fetched.contentType;

    if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
      return res.status(415).json({
        ok: false,
        error: `Unsupported asset type: ${contentType || 'unknown'}`
      });
    }

    // SVG can pass through as SVG text.
    if (contentType === 'image/svg+xml') {
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(fetched.buffer);
    }

    // Convert AVIF/WEBP/GIF/JPG/etc. to PNG for safer Figma/plugin canvas handling.
    // This is the important Cox/AVIF compatibility layer.
    const pngBuffer = await sharp(fetched.buffer)
      .rotate()
      .png()
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(pngBuffer);
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || 'Could not proxy asset.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Site Asset Importer backend running on port ${PORT}`);
});
