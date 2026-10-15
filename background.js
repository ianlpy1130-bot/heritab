let creatingOffscreen = null;

async function ensureOffscreen() {
  const path = "offscreen.html";
  const offscreenUrl = chrome.runtime.getURL(path);

  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length > 0) {
      return;
    }
  } else {
    const clients = await self.clients.matchAll();
    if (clients.some((client) => client.url === offscreenUrl)) {
      return;
    }
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: path,
    reasons: ["BLOBS"],
    justification:
      "Precompute and cache the next new-tab snapshot and preload images for smoother new-tab opening."
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function tellOffscreenToRefresh() {
  await ensureOffscreen();

  try {
    return await chrome.runtime.sendMessage({ type: "PREPARE_NEXT_TAB" });
  } catch (error) {
    console.error("Failed to send PREPARE_NEXT_TAB:", error);
    throw error;
  }
}

async function ensureRefreshAlarm() {
  const existing = await chrome.alarms.get("refresh-next-tab-snapshot");
  if (existing) return;

  await chrome.alarms.create("refresh-next-tab-snapshot", {
    delayInMinutes: 1,
    periodInMinutes: 1
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureOffscreen();
  await ensureRefreshAlarm();
  await tellOffscreenToRefresh();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureOffscreen();
  await ensureRefreshAlarm();
  await tellOffscreenToRefresh();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "refresh-next-tab-snapshot") return;
  await tellOffscreenToRefresh();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ENSURE_OFFSCREEN") {
    ensureOffscreen()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "REFRESH_NEXT_TAB") {
    tellOffscreenToRefresh()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
// ---------------------------------------------------------------------------
// Image cache — stores images in Cache API so next tab loads instantly
// ---------------------------------------------------------------------------

const IMAGE_CACHE = "heritab-img-v1";

const IMAGE_ORIGINS = [
  "images.pexels.com",
  "images.unsplash.com",
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "cdn.pixabay.com",
  "flagcdn.com",
];

function isCacheableUrl(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol === "chrome-extension:") return false;
    return IMAGE_ORIGINS.includes(hostname);
  } catch { return false; }
}

// Intercept image fetches and serve from cache
self.addEventListener("fetch", (event) => {
  if (!isCacheableUrl(event.request.url)) return;
  event.respondWith(
    caches.open(IMAGE_CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const resp = await fetch(event.request);
      if (resp.ok) cache.put(event.request, resp.clone());
      return resp;
    })
  );
});

// Pre-populate cache when newtab.js finishes preloading the next image
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PRECACHE_IMAGE") return false;
  const url = message.url;
  if (!isCacheableUrl(url)) { sendResponse({ ok: false }); return true; }
  caches.open(IMAGE_CACHE).then(async (cache) => {
    const hit = await cache.match(url);
    if (hit) { sendResponse({ ok: true, cached: true }); return; }
    const resp = await fetch(url, { mode: "cors", credentials: "omit" });
    if (resp.ok) await cache.put(url, resp);
    sendResponse({ ok: resp.ok });
  }).catch(() => sendResponse({ ok: false }));
  return true;
});