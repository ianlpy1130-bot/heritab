// offscreen.js — runs in the offscreen document (full DOM, no CSP restrictions)
// Handles PREPARE_NEXT_TAB messages from background.js.
// Does all the heavy work: fetches next image, generates thumbnail + bgColor,
// saves everything to chrome.storage.local for the new tab page to read.

const STORAGE_KEYS = {
  siteId:    "unesco-next-site-id",
  imageUrl:  "unesco-next-image-url",
  name:      "unesco-next-site-name",
  desc:      "unesco-next-site-desc",
  thumbnail: "unesco-next-thumbnail",
  bgColor:   "unesco-next-bg-color",
  // Settings written by newtab, read here to pick the right pool
  goodImagesOnly:   "unesco-good-images-only",
  insaneImagesOnly: "unesco-insane-images-only",
  selectedCodes:    "unesco-selected-country-codes",
  selectedSites:    "unesco-selected-site-ids",
  multiCountry:     "unesco-include-multi-country-sites",
};

function stripHtml(str) {
  return str ? str.replace(/<[^>]*>/g, "").trim() : "";
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeImageUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname === "upload.wikimedia.org") {
      const parts = u.pathname.split("/");
      let filename = parts[parts.length - 1];
      const thumbMatch = filename.match(/^\d+px-(.+)$/);
      if (thumbMatch) filename = thumbMatch[1];
      filename = decodeURIComponent(filename);
      return (
        "https://commons.wikimedia.org/wiki/Special:FilePath/" +
        encodeURIComponent(filename) +
        "?width=2560"
      );
    }
    return url;
  } catch { return url; }
}

function getSettings() {
  function get(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function parse(val, def) { try { return val == null ? def : JSON.parse(val); } catch { return def; } }
  const goodRaw = get(STORAGE_KEYS.goodImagesOnly);
  return {
    goodImagesOnly:   goodRaw == null ? true : parse(goodRaw, true),
    insaneImagesOnly: parse(get(STORAGE_KEYS.insaneImagesOnly), false),
    selectedCodes:    parse(get(STORAGE_KEYS.selectedCodes), null),
    selectedSites:    parse(get(STORAGE_KEYS.selectedSites), null),
    multiCountry:     parse(get(STORAGE_KEYS.multiCountry), false),
    currentSiteId:    get(STORAGE_KEYS.siteId) || null,
  };
}

async function fetchSites() {
  const url = chrome.runtime.getURL("data/sites.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error("sites.json fetch failed");
  return res.json();
}

async function fetchImageModule() {
  const url = chrome.runtime.getURL("data/sites-images-v1.js");
  // Dynamic import works in offscreen module context
  const mod = await import(url);
  return { siteImages: mod.siteImages, goodImages: mod.goodImages, insaneImages: mod.insaneImages };
}

function getImageForSite(site, { siteImages, goodImages, insaneImages, goodImagesOnly, insaneImagesOnly }) {
  const id = String(site.id);
  let raw = null;
  if (insaneImagesOnly) {
    if (insaneImages.has(id)) {
      const urls = siteImages[id];
      if (urls?.length) raw = urls[0];
    }
    raw = raw || site.image || null;
  } else if (goodImagesOnly) {
    if (goodImages.has(id)) {
      const urls = siteImages[id];
      if (urls?.length) raw = urls[0];
    }
    raw = raw || site.image || null;
  } else {
    const urls = siteImages[id];
    raw = (urls?.length) ? urls[0] : (site.image || null);
  }
  return normalizeImageUrl(raw);
}

function buildPool(sites, settings) {
  let pool = sites.filter(s => {
    // Country filter
    if (settings.selectedCodes) {
      const codes = String(s.countryCode || "").split(",").map(c => c.trim().toLowerCase());
      if (!codes.some(c => settings.selectedCodes.includes(c))) return false;
    }
    // Site filter
    if (settings.selectedSites && !settings.selectedSites.includes(String(s.id))) return false;
    // Multi-country filter
    if (!settings.multiCountry) {
      const codes = String(s.countryCode || "").split(",").map(c => c.trim());
      if (codes.length > 1) return false;
    }
    return true;
  });
  if (!pool.length) pool = sites; // fallback to all
  return pool;
}

async function generateThumbnail(imageUrl) {
  let blobUrl = null;
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("fetch failed");
    const blob = await response.blob();
    blobUrl = URL.createObjectURL(blob);

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = blobUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 68;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 120, 68);

    const data = ctx.getImageData(0, 0, 120, 68).data;
    let r = 0, g = 0, b = 0;
    const px = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i+1]; b += data[i+2];
    }
    const toHex = v => Math.round(v / px).toString(16).padStart(2, "0");
    const bgColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    const thumbnail = canvas.toDataURL("image/jpeg", 0.6);
    return { thumbnail, bgColor };
  } catch {
    return null;
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

async function prepareNextTab() {
  const settings = getSettings();
  const [sites, imageModule] = await Promise.all([
    fetchSites(),
    fetchImageModule(),
  ]);

  const pool = buildPool(sites, settings);
  const next = pickRandom(
    pool.filter(s => String(s.id) !== String(settings.currentSiteId))
  ) || pickRandom(pool);

  if (!next) return;

  const imageUrl = getImageForSite(next, { ...imageModule, ...settings }) || "";
  const name = stripHtml(next.name_en || next.name || "");
  const desc = stripHtml(next.description_en || next.description || "");

  // Write to localStorage — same storage newtab.js reads from
  try {
    localStorage.setItem(STORAGE_KEYS.siteId,   String(next.id));
    localStorage.setItem(STORAGE_KEYS.imageUrl, imageUrl);
    localStorage.setItem(STORAGE_KEYS.name,     name);
    localStorage.setItem(STORAGE_KEYS.desc,     desc);
  } catch {}

  // Ask service worker to pre-cache the image
  try {
    await chrome.runtime.sendMessage({ type: "PRECACHE_IMAGE", url: imageUrl });
  } catch {}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PREPARE_NEXT_TAB") return false;
  prepareNextTab()
    .then(() => sendResponse({ ok: true }))
    .catch(err => sendResponse({ ok: false, error: String(err) }));
  return true; // keep channel open for async response
});