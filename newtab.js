import { siteImages, siteImageCredits, goodImages, insaneImages } from "./data/sites-images-v1.js";

const FALLBACK_IMAGE = "./assets/fallback.jpg";
const STORAGE_KEY = "unesco-selected-country-codes";
const SITE_STORAGE_KEY = "unesco-selected-site-ids";
const LANGUAGE_STORAGE_KEY = "unesco-selected-language";
const LANGUAGE_ORDER = ["en", "fr", "es", "ru", "ar", "zh"];
const MULTI_COUNTRY_STORAGE_KEY = "unesco-include-multi-country-sites";
const GOOD_IMAGES_ONLY_STORAGE_KEY = "unesco-good-images-only";
const INSANE_IMAGES_ONLY_STORAGE_KEY = "unesco-insane-images-only";
const NEXT_SITE_ID_STORAGE_KEY   = "unesco-next-site-id";
const NEXT_IMAGE_URL_STORAGE_KEY = "unesco-next-image-url";
const NEXT_SITE_NAME_STORAGE_KEY = "unesco-next-site-name";
const NEXT_SITE_DESC_STORAGE_KEY = "unesco-next-site-desc";

// ---------------------------------------------------------------------------
// Cached module-level state — avoids repeated localStorage reads per render
// ---------------------------------------------------------------------------

let goodImagesOnly = (() => {
  try {
    const raw = localStorage.getItem(GOOD_IMAGES_ONLY_STORAGE_KEY);
    return raw == null ? true : JSON.parse(raw) !== false;
  } catch {
    return true;
  }
})();

let insaneImagesOnly = (() => {
  try {
    const raw = localStorage.getItem(INSANE_IMAGES_ONLY_STORAGE_KEY);
    return raw == null ? false : JSON.parse(raw) === true;
  } catch {
    return false;
  }
})();

let currentLanguage = (() => {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return LANGUAGE_ORDER.includes(saved) ? saved : "en";
  } catch {
    return "en";
  }
})();

let includeMultiCountrySites = (() => {
  try {
    const raw = localStorage.getItem(MULTI_COUNTRY_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
})();

let allSites = [];
let draftSelectedCodes = new Set();
let draftSelectedSites = new Set();
let applyToastTimer = null;
let currentSite = null;

// ---------------------------------------------------------------------------
// Memoized stripHtml — eliminates repeated createElement overhead
// ---------------------------------------------------------------------------

const _stripHtmlCache = new Map();

function stripHtml(value) {
  const str = String(value || "");
  if (_stripHtmlCache.has(str)) return _stripHtmlCache.get(str);
  const div = document.createElement("div");
  div.innerHTML = str;
  const result = div.textContent || div.innerText || "";
  _stripHtmlCache.set(str, result);
  return result;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function saveGoodImagesOnly(value) {
  goodImagesOnly = Boolean(value);
  try {
    localStorage.setItem(GOOD_IMAGES_ONLY_STORAGE_KEY, JSON.stringify(goodImagesOnly));
  } catch {}
}

function saveInsaneImagesOnly(value) {
  insaneImagesOnly = Boolean(value);
  try {
    localStorage.setItem(INSANE_IMAGES_ONLY_STORAGE_KEY, JSON.stringify(insaneImagesOnly));
  } catch {}
}

function savePreferredLanguage(language) {
  currentLanguage = language;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {}
}

function saveIncludeMultiCountrySites(value) {
  includeMultiCountrySites = Boolean(value);
  try {
    localStorage.setItem(MULTI_COUNTRY_STORAGE_KEY, String(includeMultiCountrySites));
  } catch {}
}

function saveAppliedCountryCodes(selectedSet) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedSet)));
  } catch {}
}

function saveAppliedSiteIds(selectedSet) {
  try {
    localStorage.setItem(SITE_STORAGE_KEY, JSON.stringify(Array.from(selectedSet)));
  } catch {}
}

function loadAppliedCountryCodes(allCodes) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(allCodes);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(allCodes);
    const valid = parsed.filter((code) => allCodes.includes(code));
    return new Set(valid.length ? valid : allCodes);
  } catch {
    return new Set(allCodes);
  }
}

function loadAppliedSiteIds(allIds) {
  try {
    const raw = localStorage.getItem(SITE_STORAGE_KEY);
    if (!raw) return new Set(allIds);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(allIds);
    const valid = parsed.filter((id) => allIds.includes(id));
    return new Set(valid.length ? valid : allIds);
  } catch {
    return new Set(allIds);
  }
}

// ---------------------------------------------------------------------------
// Next-site preload cache
// ---------------------------------------------------------------------------

function saveNextSiteCache(siteId, imageUrl, name, desc) {
  try {
    if (siteId == null) {
      localStorage.removeItem(NEXT_SITE_ID_STORAGE_KEY);
    } else {
      localStorage.setItem(NEXT_SITE_ID_STORAGE_KEY, String(siteId));
    }
    if (imageUrl) {
      localStorage.setItem(NEXT_IMAGE_URL_STORAGE_KEY, imageUrl);
    } else {
      localStorage.removeItem(NEXT_IMAGE_URL_STORAGE_KEY);
    }
    if (name) {
      localStorage.setItem(NEXT_SITE_NAME_STORAGE_KEY, name);
    } else {
      localStorage.removeItem(NEXT_SITE_NAME_STORAGE_KEY);
    }
    if (desc) {
      localStorage.setItem(NEXT_SITE_DESC_STORAGE_KEY, desc);
    } else {
      localStorage.removeItem(NEXT_SITE_DESC_STORAGE_KEY);
    }
  } catch {}
}

function loadNextSiteCache() {
  try {
    return {
      siteId:   localStorage.getItem(NEXT_SITE_ID_STORAGE_KEY),
      imageUrl: localStorage.getItem(NEXT_IMAGE_URL_STORAGE_KEY),
      name:     localStorage.getItem(NEXT_SITE_NAME_STORAGE_KEY),
      desc:     localStorage.getItem(NEXT_SITE_DESC_STORAGE_KEY),
    };
  } catch {
    return { siteId: null, imageUrl: null, name: null, desc: null };
  }
}

function clearNextSiteCache() {
  try {
    localStorage.removeItem(NEXT_SITE_ID_STORAGE_KEY);
    localStorage.removeItem(NEXT_IMAGE_URL_STORAGE_KEY);
    localStorage.removeItem(NEXT_SITE_NAME_STORAGE_KEY);
    localStorage.removeItem(NEXT_SITE_DESC_STORAGE_KEY);
  } catch {}
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

async function preloadImage(url) {
  if (!url) return false;
  try {
    // fetch() with redirect:"follow" resolves the final CDN URL.
    // The SW cache stores the response under the final URL, so
    // setBackground()'s fetch() will be a cache hit with no redirect.
    const resp = await fetch(url, { mode: "cors", credentials: "omit", redirect: "follow" });
    if (resp.ok && resp.url && resp.url !== url) {
      // Save the resolved CDN URL so setBackground uses it directly
      _resolvedImageUrls[url] = resp.url;
    }
    return resp.ok;
  } catch {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  }
}

// Fixes Wikimedia hotlink blocking by routing through their official
// Special:FilePath API which has no hotlink restrictions.
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

function getImageForSite(site) {
  const id = String(site.id);
  let raw = null;
  if (insaneImagesOnly) {
    if (insaneImages.has(id)) {
      const urls = siteImages[id];
      if (urls && urls.length) raw = urls[0];
    }
    raw = raw || site.image || null;
  } else if (goodImagesOnly) {
    if (goodImages.has(id)) {
      const urls = siteImages[id];
      if (urls && urls.length) raw = urls[0];
    }
    raw = raw || site.image || null;
  } else {
    const urls = siteImages[id];
    raw = (urls && urls.length) ? urls[0] : (site.image || null);
  }
  return normalizeImageUrl(raw);
}

let _currentBgUrl = "";
// Maps original image URLs to their resolved CDN URLs after redirect
const _resolvedImageUrls = {};

function setBackground(imageUrl) {
  // Use pre-resolved CDN URL to skip redirect round-trip
  const finalUrl = _resolvedImageUrls[imageUrl] || imageUrl || FALLBACK_IMAGE;
  if (finalUrl === _currentBgUrl) return;
  _currentBgUrl = finalUrl;

  let heroImage = document.getElementById("heroImage");
  if (!heroImage) {
    // Fallback if no <img> element
    document.body.style.backgroundImage = `url("${finalUrl}")`;
    return;
  }

  // Use Image.decode() — fully decodes before painting (no top-down load),
  // works with all URLs including Wikimedia, and preserves full image quality.
  const loader = new Image();
  loader.src = finalUrl;
  loader.decode()
    .then(() => {
      heroImage.src = finalUrl;
      heroImage.classList.add("hero-loaded");
    })
    .catch(() => {
      // decode() not supported or failed — set src directly
      heroImage.src = finalUrl;
      heroImage.onload = () => heroImage.classList.add("hero-loaded");
    });
}

// ---------------------------------------------------------------------------
// Site pool helpers
// ---------------------------------------------------------------------------

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Uses precomputed site._codes — no string parsing at call time. */
function getSiteCountryCodes(site) {
  return site._codes || [];
}

function isGoodImageSite(site) {
  return goodImages.has(String(site.id));
}

function filterSitesByLanguage(sites, language) {
  if (!Array.isArray(sites)) return [];
  return sites.filter((site) => siteHasLanguage(site, language));
}

function isInsaneImageSite(site) {
  return insaneImages.has(String(site.id));
}

function getEligibleSitesForDisplay(sites) {
  let filtered = Array.isArray(sites) ? [...sites] : [];

  if (insaneImagesOnly) {
    const imageFiltered = filtered.filter(isInsaneImageSite);
    if (imageFiltered.length) filtered = imageFiltered;
  } else if (goodImagesOnly) {
    const imageFiltered = filtered.filter(isGoodImageSite);
    if (imageFiltered.length) filtered = imageFiltered;
  }

  const languageFiltered = filterSitesByLanguage(filtered, currentLanguage);
  if (languageFiltered.length) filtered = languageFiltered;

  return filtered;
}

function siteMatchesSelectedCountries(site, selectedCodes) {
  const siteCodes = getSiteCountryCodes(site);
  if (!siteCodes.length) return false;
  if (!includeMultiCountrySites && siteCodes.length > 1) return false;
  return siteCodes.some((code) => selectedCodes.has(code));
}

function getSitesMatchingSelectedCountries(sites, selectedCodes) {
  if (!selectedCodes || !selectedCodes.size) {
    return sites.filter((site) => {
      const siteCodes = getSiteCountryCodes(site);
      if (!siteCodes.length) return false;
      if (!includeMultiCountrySites && siteCodes.length > 1) return false;
      return true;
    });
  }
  return sites.filter((site) => siteMatchesSelectedCountries(site, selectedCodes));
}

function extractCountryCodes(sites) {
  const codes = new Set();
  sites.forEach((site) => {
    getSiteCountryCodes(site).forEach((code) => codes.add(code));
  });
  return Array.from(codes).sort((a, b) => {
    if (a === "xx") return 1;
    if (b === "xx") return -1;
    const nameA = COUNTRY_NAMES[a] || a.toUpperCase();
    const nameB = COUNTRY_NAMES[b] || b.toUpperCase();
    return nameA.localeCompare(nameB);
  });
}

function getAllSelectableSiteIds(sites) {
  return sites
    .filter((site) => site && site.id != null && site.name)
    .map((site) => String(site.id));
}

function getEligibleDisplayPool(sites) {
  const countryCodes = extractCountryCodes(sites);
  const appliedCodes = loadAppliedCountryCodes(countryCodes);
  const countryFiltered = getSitesMatchingSelectedCountries(sites, appliedCodes);
  const allIds = getAllSelectableSiteIds(countryFiltered);
  const appliedIds = loadAppliedSiteIds(allIds);

  const siteFiltered = countryFiltered.filter((site) =>
    appliedIds.has(String(site.id))
  );

  const displayPool = getEligibleSitesForDisplay(siteFiltered);
  return displayPool.length ? displayPool : getEligibleSitesForDisplay(countryFiltered);
}

function pickNextPreloadCandidate(pool, excludeSiteId = null) {
  const filtered = Array.isArray(pool)
    ? pool.filter((site) => String(site.id) !== String(excludeSiteId))
    : [];
  if (!filtered.length) return null;
  return pickRandom(filtered);
}

async function prepareNextSiteCache(pool, excludeSiteId = null) {
  const nextSite = pickNextPreloadCandidate(pool, excludeSiteId);
  if (!nextSite) { clearNextSiteCache(); return; }
  const nextImageUrl = getImageForSite(nextSite) || FALLBACK_IMAGE;
  const nextName = stripHtml(nextSite.name_en || nextSite.name || "");
  const nextDesc = stripHtml(nextSite.short_description_en || nextSite.description_en || nextSite.description || "");
  saveNextSiteCache(nextSite.id, nextImageUrl, nextName, nextDesc);
  await preloadImage(nextImageUrl);
  try { chrome.runtime.sendMessage({ type: "PRECACHE_IMAGE", url: nextImageUrl }); } catch {}
}

function getCachedSiteIfValid(pool) {
  const { siteId, imageUrl } = loadNextSiteCache();
  if (!siteId) return null;
  const match = pool.find((site) => String(site.id) === String(siteId));
  if (!match) { clearNextSiteCache(); return null; }
  return { site: match, imageUrl: imageUrl || getImageForSite(match) || FALLBACK_IMAGE };
}

// ---------------------------------------------------------------------------
// Language & localization
// ---------------------------------------------------------------------------

function siteHasLanguage(site, language) {
  if (!site) return false;
  if (language === "en") return true;
  const name = stripHtml(site[`name_${language}`] || "");
  const description = stripHtml(site[`description_${language}`] || "");
  const country = stripHtml(site[`country_${language}`] || "");
  return Boolean(name || description || country);
}

function getAvailableLanguages(site) {
  if (!site) return ["en"];
  const languages = LANGUAGE_ORDER.filter((lang) => siteHasLanguage(site, lang));
  return languages.length ? languages : ["en"];
}

function getCycleLanguages(site) {
  return getAvailableLanguages(site);
}

function getLocalizedValue(site, baseKey, language) {
  if (!site) return "";
  const localized = stripHtml(site[`${baseKey}_${language}`] || "");
  if (localized) return localized;
  const english = stripHtml(site[`${baseKey}_en`] || "");
  if (english) return english;
  return stripHtml(site[baseKey] || "");
}

// ---------------------------------------------------------------------------
// DOM update helpers — all batched inside fillSite's rAF
// ---------------------------------------------------------------------------

function animateClockIn() {
  const clockEl = document.getElementById("clock");
  if (!clockEl) return;
  clockEl.classList.add("entering");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { clockEl.classList.remove("entering"); });
  });
}

function animateSiteText() {
  const els = [
    document.getElementById("siteName"),
    document.getElementById("siteDescription"),
  ].filter(Boolean);
  els.forEach((el) => {
    el.classList.remove("text-enter");
    void el.offsetWidth;
    el.classList.add("text-enter");
  });
}

function updateClock() {
  const clockEl = document.getElementById("clock");
  if (!clockEl) return;
  const now = new Date();
  clockEl.textContent = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

// Inline grey globe SVG used for "Others" (xx) sites
const GLOBE_FLAG_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23607080'/%3E%3Cellipse cx='32' cy='32' rx='13' ry='30' fill='none' stroke='%23a0b4c0' stroke-width='2'/%3E%3Cline x1='2' y1='32' x2='62' y2='32' stroke='%23a0b4c0' stroke-width='2'/%3E%3Cline x1='8' y1='16' x2='56' y2='16' stroke='%23a0b4c0' stroke-width='1.5'/%3E%3Cline x1='8' y1='48' x2='56' y2='48' stroke='%23a0b4c0' stroke-width='1.5'/%3E%3Ccircle cx='32' cy='32' r='30' fill='none' stroke='%23a0b4c0' stroke-width='2'/%3E%3C/svg%3E";

function getFlagSrc(code, size = 80) {
  const normalized = String(code || "").trim().toLowerCase();
  if (normalized === "xx") return GLOBE_FLAG_SRC;
  if (normalized === "by") {
    return "https://preview.redd.it/every-national-flag-in-a-16-9-aspect-ratio-day-1-v0-l4tzpv72fxsc1.png?width=1080&crop=smart&auto=webp&s=e0204453a45dfbd89e3b9cca5837003976157e95";
  }
  return `https://flagcdn.com/w${size}/${normalized}.png`;
}

function setMapLink(site) {
  const linkEl = document.getElementById("siteNameLink");
  if (!linkEl) return;
  const parts = [];
  const mapName = getLocalizedValue(site, "name", currentLanguage) || site.name;
  const mapCountry = getLocalizedValue(site, "country", currentLanguage) || site.country;
  if (mapName) parts.push(stripHtml(mapName));
  if (mapCountry) parts.push(stripHtml(mapCountry));
  const query = parts.join(", ") || "UNESCO World Heritage Site";
  linkEl.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function updateTranslateButton(site) {
  const translateBtn = document.getElementById("translateBtn");
  if (!translateBtn) return;
  const languages = getAvailableLanguages(site);
  if (languages.length <= 1) { translateBtn.hidden = true; return; }
  translateBtn.hidden = false;
  translateBtn.textContent = currentLanguage.toUpperCase();
  translateBtn.setAttribute("aria-label", `Change language, current language ${currentLanguage.toUpperCase()}`);
  translateBtn.title = `Language: ${currentLanguage.toUpperCase()}`;
}

function applyLanguageToSite(site) {
  if (!site) return;
  const siteNameEl = document.getElementById("siteName");
  const siteDescriptionEl = document.getElementById("siteDescription");
  const root = document.documentElement;

  const cleanName = getLocalizedValue(site, "name", currentLanguage) || "Unknown Site";
  const cleanCountry =
    getLocalizedValue(site, "country", currentLanguage) || stripHtml(site.country || "");
  const cleanDescription =
    getLocalizedValue(site, "description", currentLanguage) ||
    `${cleanName} is a UNESCO World Heritage Site in ${cleanCountry || "the world"}.`;

  if (siteNameEl) siteNameEl.textContent = cleanName;
  if (siteDescriptionEl) siteDescriptionEl.textContent = cleanDescription;

  root.setAttribute("lang", currentLanguage);
  root.setAttribute("dir", currentLanguage === "ar" ? "rtl" : "ltr");

  const searchSiteBtn = document.getElementById("searchSiteBtn");
  if (searchSiteBtn) {
    const query = encodeURIComponent(`${cleanName} UNESCO World Heritage Site`);
    searchSiteBtn.href = `https://www.google.com/search?q=${query}`;
    searchSiteBtn.hidden = false;
  }

  updateTranslateButton(site);
  setMapLink(site);
  animateSiteText();
}

function setFlag(site) {
  const flagEl = document.getElementById("countryFlag");
  if (!flagEl) return;

  const codes = getSiteCountryCodes(site);
  flagEl.innerHTML = "";

  if (!codes.length) { flagEl.hidden = true; return; }

  codes.forEach((code) => {
    const img = document.createElement("img");
    img.src = getFlagSrc(code, 80);
    img.alt = `${code.toUpperCase()} flag`;
    img.className = "country-flag-img";
    img.loading = "eager";
    img.decoding = "async";
    img.onerror = () => {
      img.remove();
      if (flagEl.children.length === 0) flagEl.hidden = true;
    };
    flagEl.appendChild(img);
  });

  flagEl.hidden = flagEl.children.length === 0;
}

function setImageCredit(site) {
  const creditEl = document.getElementById("imageCredit");
  if (!creditEl) return;

  const credit = siteImageCredits?.[String(site.id)];
  if (!credit || !credit.sourcePage) { creditEl.hidden = true; creditEl.innerHTML = ""; return; }

  const title = stripHtml(credit.title || site.name || "Image");
  const author = stripHtml(credit.author || "Unknown author");
  const licenseName = stripHtml(credit.licenseName || "");
  const notes = stripHtml(credit.notes || "");

  let html = `Photo: <a href="${credit.sourcePage}" target="_blank" rel="noopener noreferrer">${title}</a>`;
  if (author) html += ` by ${author}`;
  if (licenseName && credit.licenseUrl) {
    html += `, <a href="${credit.licenseUrl}" target="_blank" rel="noopener noreferrer">${licenseName}</a>`;
  } else if (licenseName) {
    html += `, ${licenseName}`;
  }
  if (notes) html += `<span class="image-credit-note">${notes}</span>`;

  creditEl.innerHTML = html;
  creditEl.hidden = false;
}

function getPreferredVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;
  const prefix = lang.split("-")[0];
  return voices.find((v) => v.lang && v.lang.startsWith(prefix)) || null;
}

function wireSpeech(site) {
  const speakBtn = document.getElementById("speakBtn");
  if (!speakBtn) return;
  const cleanNativeName = stripHtml(site.nativeName || "");
  if (!("speechSynthesis" in window) || !cleanNativeName || !site.speechLang) {
    speakBtn.hidden = true;
    speakBtn.onclick = null;
    return;
  }
  speakBtn.hidden = false;
  speakBtn.onclick = () => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanNativeName);
    utterance.lang = site.speechLang;
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    const voice = getPreferredVoice(site.speechLang);
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };
}

// ---------------------------------------------------------------------------
// fillSite — batches all DOM writes into a single rAF
// ---------------------------------------------------------------------------

function fillSite(site, options = {}) {
  if (!site) return;
  currentSite = site;

  const availableLanguages = getAvailableLanguages(site);
  if (!availableLanguages.includes(currentLanguage)) {
    currentLanguage = availableLanguages[0] || "en";
    savePreferredLanguage(currentLanguage);
  }

  const chosenImage = options.imageUrl || getImageForSite(site);

  // Background can paint immediately — it's the highest-priority visual
  setBackground(chosenImage || null);

  // Batch all remaining DOM writes into a single frame
  requestAnimationFrame(() => {
    setFlag(site);
    wireSpeech(site);
    setImageCredit(site);
    applyLanguageToSite(site);
  });
}

// ---------------------------------------------------------------------------
// showRandomSite
// ---------------------------------------------------------------------------

function showRandomSite(selectedCodesOverride = null) {
  let filteredSites = allSites.filter((site) => site && site.name);
  if (!filteredSites.length) return;

  filteredSites = getEligibleSitesForDisplay(filteredSites);
  if (!filteredSites.length) return;

  const allCodes = extractCountryCodes(filteredSites);
  const appliedCodes = selectedCodesOverride || loadAppliedCountryCodes(allCodes);

  if (appliedCodes && appliedCodes.size) {
    const matches = filteredSites.filter((site) =>
      siteMatchesSelectedCountries(site, appliedCodes)
    );
    if (matches.length) filteredSites = matches;
  } else {
    filteredSites = getSitesMatchingSelectedCountries(filteredSites, appliedCodes);
  }

  if (!filteredSites.length) return;

  const visibleSiteIds = filteredSites.map((site) => String(site.id));
  const appliedSiteIds = loadAppliedSiteIds(visibleSiteIds);

  if (appliedSiteIds && appliedSiteIds.size) {
    const matches = filteredSites.filter((site) => appliedSiteIds.has(String(site.id)));
    if (matches.length) filteredSites = matches;
  }

  if (!filteredSites.length) return;

  fillSite(pickRandom(filteredSites));
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function revealStartupUI() {
  requestAnimationFrame(() => { document.body.classList.add("ui-ready"); });
}

function syncSettingsUI() {
  const goodImagesCheckbox = document.getElementById("settingsGoodImages");
  const multiCountryCheckbox = document.getElementById("settingsMultiCountry");
  const insaneImagesCheckbox = document.getElementById("settingsInsaneImages");
  if (goodImagesCheckbox) goodImagesCheckbox.checked = goodImagesOnly;
  if (multiCountryCheckbox) multiCountryCheckbox.checked = includeMultiCountrySites;
  if (insaneImagesCheckbox) insaneImagesCheckbox.checked = insaneImagesOnly;
}

function showApplyToast() {
  const toast = document.getElementById("applyToast");
  if (!toast) return;
  toast.hidden = false;
  requestAnimationFrame(() => { toast.classList.add("show"); });
  clearTimeout(applyToastTimer);
  applyToastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => { toast.hidden = true; }, 180);
  }, 1500);
}

function showErrorToast(message) {
  const toast = document.getElementById("applyToast");
  if (!toast) return;
  const original = toast.textContent;
  toast.textContent = message;
  toast.style.background = "#c0392b";
  toast.hidden = false;
  requestAnimationFrame(() => { toast.classList.add("show"); });
  clearTimeout(applyToastTimer);
  applyToastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.hidden = true;
      toast.textContent = original;
      toast.style.background = "";
    }, 180);
  }, 2500);
}

function wireSearch() {
  const form = document.getElementById("searchForm");
  const input = document.getElementById("searchInput");
  if (!form || !input) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    // Use Chrome Search API to respect user's default search engine
    if (chrome.search && chrome.search.query) {
      chrome.search.query({ text: query, disposition: "CURRENT_TAB" });
    } else {
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }
  });
}

function wireTranslateButton() {
  const translateBtn = document.getElementById("translateBtn");
  if (!translateBtn) return;
  translateBtn.addEventListener("click", () => {
    if (!currentSite) return;
    const languages = getCycleLanguages(currentSite);
    if (languages.length <= 1) return;
    const currentIndex = languages.indexOf(currentLanguage);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % languages.length;
    savePreferredLanguage(languages[nextIndex]);
    applyLanguageToSite(currentSite);
  });
}

// ---------------------------------------------------------------------------
// Country checklist
// ---------------------------------------------------------------------------

function renderCountryChecklist(sites) {
  const container = document.getElementById("countryChecklist");
  if (!container) return;

  const codes = extractCountryCodes(sites);
  const appliedCodes = loadAppliedCountryCodes(codes);
  draftSelectedCodes = new Set(appliedCodes);

  container.innerHTML = codes
    .map((code) => {
      const name = COUNTRY_NAMES[code] || code.toUpperCase();
      const checked = draftSelectedCodes.has(code) ? "checked" : "";
      return `
        <label class="country-option">
          <input type="checkbox" value="${code}" ${checked}>
          <span class="country-tile">
            <img src="${getFlagSrc(code, 40)}" alt="${name} flag" />
            <span class="country-name">${name}</span>
          </span>
        </label>
      `;
    })
    .join("");
}

function getDraftCountryCodesFromUI() {
  const checkboxes = document.querySelectorAll('#countryChecklist input[type="checkbox"]');
  return new Set(
    Array.from(checkboxes)
      .filter((input) => input.checked)
      .map((input) => input.value)
  );
}

function setDraftCountryCodesInUI(selectedSet) {
  const checkboxes = document.querySelectorAll('#countryChecklist input[type="checkbox"]');
  checkboxes.forEach((input) => { input.checked = selectedSet.has(input.value); });
  draftSelectedCodes = new Set(selectedSet);
}

// ---------------------------------------------------------------------------
// Site picker
// ---------------------------------------------------------------------------

function getDraftSiteIdsFromUI() {
  const checkboxes = document.querySelectorAll('#siteCountryGroups input[type="checkbox"]');
  return new Set(
    Array.from(checkboxes)
      .filter((input) => input.checked)
      .map((input) => input.value)
  );
}

function setDraftSiteIdsInUI(selectedSet) {
  const checkboxes = document.querySelectorAll('#siteCountryGroups input[type="checkbox"]');
  checkboxes.forEach((input) => { input.checked = selectedSet.has(input.value); });
  draftSelectedSites = new Set(selectedSet);
}

function renderSiteCountryGroups(sites) {
  const container = document.getElementById("siteCountryGroups");
  if (!container) return;

  const allIds = getAllSelectableSiteIds(sites);
  const appliedIds = loadAppliedSiteIds(allIds);
  const validAppliedIds = new Set(Array.from(appliedIds).filter((id) => allIds.includes(id)));
  draftSelectedSites = new Set(validAppliedIds);

  const grouped = new Map();
  sites
    .filter((site) => site && site.id != null && site.name)
    .forEach((site) => {
      const country = stripHtml(site.country || "Unknown country");
      if (!grouped.has(country)) grouped.set(country, []);
      grouped.get(country).push(site);
    });

  const countryNames = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

  if (!countryNames.length) {
    container.innerHTML = `
      <div class="empty-site-picker">
        No sites are available because no countries are currently selected.
      </div>
    `;
    return;
  }

  container.innerHTML = countryNames
    .map((country, index) => {
      const countrySites = grouped
        .get(country)
        .slice()
        .sort((a, b) => stripHtml(a.name).localeCompare(stripHtml(b.name)));

      const siteItems = countrySites
        .map((site) => {
          const id = String(site.id);
          const checked = validAppliedIds.has(id) ? "checked" : "";
          return `
            <label class="site-option">
              <input type="checkbox" value="${id}" ${checked}>
              <span class="site-tile">
                <span class="site-title">${stripHtml(site.name)}</span>
              </span>
            </label>
          `;
        })
        .join("");

      return `
        <div class="site-country-group">
          <button class="site-country-toggle" type="button" data-country-toggle="${index}">
            <span>${country}</span>
            <span class="site-country-count">${countrySites.length} sites</span>
          </button>
          <div class="site-list" data-country-list="${index}" hidden>
            ${siteItems}
          </div>
        </div>
      `;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Customize panel wiring
// ---------------------------------------------------------------------------

function wireCustomizePanel() {
  const customizeBtn = document.getElementById("customizeBtn");
  const customizePanel = document.getElementById("customizePanel");
  const closeCustomizeBtn = document.getElementById("closeCustomizeBtn");
  const selectAllBtn = document.getElementById("selectAllCountriesBtn");
  const clearBtn = document.getElementById("clearCountriesBtn");
  const openSitePickerBtn = document.getElementById("openSitePickerBtn");
  const applyBtn = document.getElementById("applyCountriesBtn");
  const checklist = document.getElementById("countryChecklist");
  const sitePickerPanel = document.getElementById("sitePickerPanel");
  const closeSitePickerBtn = document.getElementById("closeSitePickerBtn");
  const selectAllSitesBtn = document.getElementById("selectAllSitesBtn");
  const clearSitesBtn = document.getElementById("clearSitesBtn");
  const applySitesBtn = document.getElementById("applySitesBtn");
  const siteCountryGroups = document.getElementById("siteCountryGroups");

  // Settings panel elements
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const closeSettingsBtn = document.getElementById("closeSettingsBtn");
  const settingsGoodImages = document.getElementById("settingsGoodImages");
  const settingsMultiCountry = document.getElementById("settingsMultiCountry");
  const settingsInsaneImages = document.getElementById("settingsInsaneImages");

  if (
    !customizeBtn || !customizePanel || !closeCustomizeBtn ||
    !selectAllBtn || !clearBtn || !openSitePickerBtn || !applyBtn ||
    !checklist || !sitePickerPanel || !closeSitePickerBtn ||
    !selectAllSitesBtn || !clearSitesBtn || !applySitesBtn || !siteCountryGroups
  ) return;

  customizeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    customizePanel.hidden = !customizePanel.hidden;

    if (!customizePanel.hidden) {
      const eligibleSites = getEligibleSitesForDisplay(allSites);
      const allCodes = extractCountryCodes(eligibleSites);
      const appliedCodes = loadAppliedCountryCodes(allCodes);
      setDraftCountryCodesInUI(appliedCodes);
      syncSettingsUI();

      // Scroll to the first selected country alphabetically
      requestAnimationFrame(() => {
        const container = document.getElementById("countryChecklist");
        if (!container || !appliedCodes.size) return;

        // allCodes is already sorted alphabetically — find first checked one
        const firstSelectedCode = allCodes.find(code => appliedCodes.has(code));
        if (!firstSelectedCode) return;

        const checkbox = container.querySelector(`input[value="${firstSelectedCode}"]`);
        if (!checkbox) return;

        const tile = checkbox.closest(".country-option");
        if (!tile) return;

        // Scroll so the tile is near the top of the checklist
        const containerRect = container.getBoundingClientRect();
        const tileRect = tile.getBoundingClientRect();
        container.scrollTop += tileRect.top - containerRect.top - 8;
      });
    }
  });

  closeCustomizeBtn.addEventListener("click", () => { customizePanel.hidden = true; });

  checklist.addEventListener("change", () => { draftSelectedCodes = getDraftCountryCodesFromUI(); });

  selectAllBtn.addEventListener("click", () => {
    const eligibleSites = getEligibleSitesForDisplay(allSites);
    setDraftCountryCodesInUI(new Set(extractCountryCodes(eligibleSites)));
  });

  clearBtn.addEventListener("click", () => { setDraftCountryCodesInUI(new Set()); });

  // Settings panel
  if (openSettingsBtn && settingsPanel) {
    openSettingsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      syncSettingsUI();
      settingsPanel.hidden = false;
      customizePanel.hidden = true;
    });
  }

  if (closeSettingsBtn && settingsPanel) {
    closeSettingsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      settingsPanel.hidden = true;
      customizePanel.hidden = false;
    });
  }

  if (settingsGoodImages) {
    settingsGoodImages.addEventListener("change", () => {
      saveGoodImagesOnly(settingsGoodImages.checked);
    });
  }

  if (settingsMultiCountry) {
    settingsMultiCountry.addEventListener("change", () => {
      saveIncludeMultiCountrySites(settingsMultiCountry.checked);
    });
  }

  if (settingsInsaneImages) {
    settingsInsaneImages.addEventListener("change", () => {
      saveInsaneImagesOnly(settingsInsaneImages.checked);
    });
  }

  const settingsApplyBtn = document.getElementById("settingsApplyBtn");
  if (settingsApplyBtn) {
    settingsApplyBtn.addEventListener("click", () => {
      // Temporarily apply the checkbox states to test what pool would result
      const wouldBeGoodOnly   = settingsGoodImages?.checked ?? goodImagesOnly;
      const wouldBeInsaneOnly = settingsInsaneImages?.checked ?? insaneImagesOnly;
      const wouldBeMulti      = settingsMultiCountry?.checked ?? includeMultiCountrySites;

      // Simulate the pool with these settings
      const testPool = allSites.filter(site => {
        const codes = site._codes || [];
        if (!wouldBeMulti && codes.length > 1) return false;
        const id = String(site.id);
        if (wouldBeInsaneOnly) return insaneImages.has(id);
        if (wouldBeGoodOnly)   return goodImages.has(id);
        return true;
      });

      // Also filter by currently selected countries
      const eligibleSites = getEligibleDisplayPool(allSites);
      const eligibleIds = new Set(eligibleSites.map(s => String(s.id)));
      const finalPool = testPool.filter(s => eligibleIds.has(String(s.id)));

      if (!finalPool.length) {
        showErrorToast("No images found with these settings");
        return;
      }

      location.reload();
    });
  }

  openSitePickerBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const selectedCodesFromUI = getDraftCountryCodesFromUI();
    const eligibleSites = getEligibleSitesForDisplay(allSites);
    const allCodes = extractCountryCodes(eligibleSites);
    const codesToUse = selectedCodesFromUI.size ? selectedCodesFromUI : new Set(allCodes);
    renderSiteCountryGroups(getSitesMatchingSelectedCountries(eligibleSites, codesToUse));
    sitePickerPanel.hidden = false;
  });

  closeSitePickerBtn.addEventListener("click", () => { sitePickerPanel.hidden = true; });

  siteCountryGroups.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-country-toggle]");
    if (!toggle) return;
    const index = toggle.getAttribute("data-country-toggle");
    const list = siteCountryGroups.querySelector(`[data-country-list="${index}"]`);
    if (list) list.hidden = !list.hidden;
  });

  siteCountryGroups.addEventListener("change", () => {
    draftSelectedSites = getDraftSiteIdsFromUI();
  });

  selectAllSitesBtn.addEventListener("click", () => {
    const checkboxes = document.querySelectorAll('#siteCountryGroups input[type="checkbox"]');
    setDraftSiteIdsInUI(new Set(Array.from(checkboxes).map((input) => input.value)));
  });

  clearSitesBtn.addEventListener("click", () => { setDraftSiteIdsInUI(new Set()); });

  applySitesBtn.addEventListener("click", () => {
    draftSelectedSites = getDraftSiteIdsFromUI();
    const checkboxes = document.querySelectorAll('#siteCountryGroups input[type="checkbox"]');
    const visibleIds = Array.from(checkboxes).map((input) => input.value);
    const idsToApply = draftSelectedSites.size ? draftSelectedSites : new Set(visibleIds);

    // Check if the resulting pool would have any displayable sites
    const wouldBePool = allSites.filter(site => idsToApply.has(String(site.id)));
    const wouldBeEligible = getEligibleSitesForDisplay(wouldBePool);
    if (!wouldBeEligible.length) {
      showErrorToast("No matching sites found — try different settings");
      return;
    }

    saveAppliedSiteIds(idsToApply);

    const selectedCodes = new Set();
    allSites
      .filter((site) => idsToApply.has(String(site.id)))
      .forEach((site) => {
        getSiteCountryCodes(site).forEach((code) => selectedCodes.add(code));
      });

    if (selectedCodes.size) saveAppliedCountryCodes(selectedCodes);

    sitePickerPanel.hidden = true;
    customizePanel.hidden = true;
    clearNextSiteCache();
    showApplyToast();
    setTimeout(() => location.reload(), 800);
  });

  applyBtn.addEventListener("click", () => {
    draftSelectedCodes = getDraftCountryCodesFromUI();

    const eligibleSites = getEligibleSitesForDisplay(allSites);
    const allCodes = extractCountryCodes(eligibleSites);
    const codesToApply = draftSelectedCodes.size ? draftSelectedCodes : new Set(allCodes);

    // Check if the resulting pool would have any displayable sites
    const wouldBePool = getSitesMatchingSelectedCountries(eligibleSites, codesToApply);
    if (!wouldBePool.length) {
      showErrorToast("No matching sites found — try different settings");
      return;
    }

    saveAppliedCountryCodes(codesToApply);

    const allowedSites = getSitesMatchingSelectedCountries(eligibleSites, codesToApply);
    saveAppliedSiteIds(new Set(allowedSites.map((site) => String(site.id))));

    customizePanel.hidden = true;
    sitePickerPanel.hidden = true;
    clearNextSiteCache();
    showApplyToast();
    setTimeout(() => location.reload(), 800);
  });

  document.addEventListener("click", (event) => {
    if (
      !customizePanel.hidden &&
      !customizeBtn.contains(event.target) &&
      !customizePanel.contains(event.target)
    ) {
      customizePanel.hidden = true;
    }

    if (
      !sitePickerPanel.hidden &&
      !openSitePickerBtn.contains(event.target) &&
      !sitePickerPanel.contains(event.target)
    ) {
      sitePickerPanel.hidden = true;
    }

    if (
      settingsPanel &&
      !settingsPanel.hidden &&
      !openSettingsBtn?.contains(event.target) &&
      !settingsPanel.contains(event.target)
    ) {
      settingsPanel.hidden = true;
    }
  });
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadSites() {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "./data/sites.json", true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch(e) {
          reject(new Error("sites.json parse error"));
        }
      } else {
        reject(new Error("Could not load sites.json: " + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error("sites.json request failed"));
    xhr.send();
  });
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

async function init() {
  // Critical path: clock + background paint fire immediately
  updateClock();
  animateClockIn();
  setInterval(updateClock, 1000);

  const warmCache = loadNextSiteCache();

  // Paint cached text instantly — no waiting for sites.json
  if (warmCache?.name) {
    const nameEl = document.getElementById("siteName");
    if (nameEl) nameEl.textContent = warmCache.name;
  }
  if (warmCache?.desc) {
    const descEl = document.getElementById("siteDescription");
    if (descEl) descEl.textContent = warmCache.desc;
  }

  if (warmCache?.imageUrl) setBackground(warmCache.imageUrl);

  revealStartupUI();

  // Defer non-visual wiring until after first paint
  requestAnimationFrame(() => {
    wireSearch();
    wireTranslateButton();
    syncSettingsUI();
  });

  try {
    allSites = await loadSites();

    if (!Array.isArray(allSites) || allSites.length === 0) {
      throw new Error("sites.json is empty or invalid");
    }

    // Precompute country codes once — eliminates repeated string parsing during filtering
    allSites.forEach((site) => {
      const codes = String(site.countryCode || "")
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter((c) => /^[a-z]{2}$/.test(c));
      // Sites with no recognised country code go into "Others" (code "xx")
      site._codes = codes.length ? codes : ["xx"];
    });

    const eligibleSites = getEligibleDisplayPool(allSites);

    if (!eligibleSites.length) throw new Error("No eligible sites available");

    const cached = getCachedSiteIfValid(eligibleSites);

    if (cached) {
      fillSite(cached.site, { imageUrl: cached.imageUrl });
      requestAnimationFrame(() => {
        renderCountryChecklist(allSites);
        wireCustomizePanel();
      });
      prepareNextSiteCache(eligibleSites, cached.site.id);
      return;
    }

    const selectedSite = pickRandom(eligibleSites);
    fillSite(selectedSite);

    requestAnimationFrame(() => {
      renderCountryChecklist(allSites);
      wireCustomizePanel();
    });

    prepareNextSiteCache(eligibleSites, selectedSite.id);
  } catch (error) {
    console.error(error);
    fillSite({
      id: null,
      name: "UNESCO World Heritage Site",
      name_en: "UNESCO World Heritage Site",
      country: "",
      description:
        "Could not load sites.json. Check that ./data/sites.json exists and the extension was reloaded.",
      description_en:
        "Could not load sites.json. Check that ./data/sites.json exists and the extension was reloaded.",
      image: null,
      nativeName: null,
      speechLang: null,
      countryCode: null,
      _codes: [],
    });
  }
}

init();

// ---------------------------------------------------------------------------
// Country name lookup table
// ---------------------------------------------------------------------------

const COUNTRY_NAMES = {
  ad: "Andorra",
  ae: "United Arab Emirates",
  af: "Afghanistan",
  ag: "Antigua and Barbuda",
  ai: "Anguilla",
  al: "Albania",
  am: "Armenia",
  ao: "Angola",
  aq: "Antarctica",
  ar: "Argentina",
  as: "American Samoa",
  at: "Austria",
  au: "Australia",
  aw: "Aruba",
  ax: "Åland Islands",
  az: "Azerbaijan",
  ba: "Bosnia and Herzegovina",
  bb: "Barbados",
  bd: "Bangladesh",
  be: "Belgium",
  bf: "Burkina Faso",
  bg: "Bulgaria",
  bh: "Bahrain",
  bi: "Burundi",
  bj: "Benin",
  bl: "Saint Barthélemy",
  bm: "Bermuda",
  bn: "Brunei",
  bo: "Bolivia",
  bq: "Caribbean Netherlands",
  br: "Brazil",
  bs: "Bahamas",
  bt: "Bhutan",
  bv: "Bouvet Island",
  bw: "Botswana",
  by: "Belarus",
  bz: "Belize",
  ca: "Canada",
  cc: "Cocos (Keeling) Islands",
  cd: "Democratic Republic of the Congo",
  cf: "Central African Republic",
  cg: "Republic of the Congo",
  ch: "Switzerland",
  ci: "Côte d'Ivoire",
  ck: "Cook Islands",
  cl: "Chile",
  cm: "Cameroon",
  cn: "China",
  co: "Colombia",
  cr: "Costa Rica",
  cu: "Cuba",
  cv: "Cabo Verde",
  cw: "Curaçao",
  cx: "Christmas Island",
  cy: "Cyprus",
  cz: "Czechia",
  de: "Germany",
  dj: "Djibouti",
  dk: "Denmark",
  dm: "Dominica",
  do: "Dominican Republic",
  dz: "Algeria",
  ec: "Ecuador",
  ee: "Estonia",
  eg: "Egypt",
  eh: "Western Sahara",
  er: "Eritrea",
  es: "Spain",
  et: "Ethiopia",
  fi: "Finland",
  fj: "Fiji",
  fk: "Falkland Islands",
  fm: "Micronesia",
  fo: "Faroe Islands",
  fr: "France",
  ga: "Gabon",
  gb: "United Kingdom",
  gd: "Grenada",
  ge: "Georgia",
  gf: "French Guiana",
  gg: "Guernsey",
  gh: "Ghana",
  gi: "Gibraltar",
  gl: "Greenland",
  gm: "Gambia",
  gn: "Guinea",
  gp: "Guadeloupe",
  gq: "Equatorial Guinea",
  gr: "Greece",
  gs: "South Georgia and the South Sandwich Islands",
  gt: "Guatemala",
  gu: "Guam",
  gw: "Guinea-Bissau",
  gy: "Guyana",
  hk: "Hong Kong",
  hm: "Heard Island and McDonald Islands",
  hn: "Honduras",
  hr: "Croatia",
  ht: "Haiti",
  hu: "Hungary",
  id: "Indonesia",
  ie: "Ireland",
  il: "Israel",
  im: "Isle of Man",
  in: "India",
  io: "British Indian Ocean Territory",
  iq: "Iraq",
  ir: "Iran",
  is: "Iceland",
  it: "Italy",
  je: "Jersey",
  jm: "Jamaica",
  jo: "Jordan",
  jp: "Japan",
  ke: "Kenya",
  kg: "Kyrgyzstan",
  kh: "Cambodia",
  ki: "Kiribati",
  km: "Comoros",
  kn: "Saint Kitts and Nevis",
  kp: "North Korea",
  kr: "South Korea",
  kw: "Kuwait",
  ky: "Cayman Islands",
  kz: "Kazakhstan",
  la: "Laos",
  lb: "Lebanon",
  lc: "Saint Lucia",
  li: "Liechtenstein",
  lk: "Sri Lanka",
  lr: "Liberia",
  ls: "Lesotho",
  lt: "Lithuania",
  lu: "Luxembourg",
  lv: "Latvia",
  ly: "Libya",
  ma: "Morocco",
  mc: "Monaco",
  md: "Moldova",
  me: "Montenegro",
  mf: "Saint Martin",
  mg: "Madagascar",
  mh: "Marshall Islands",
  mk: "North Macedonia",
  ml: "Mali",
  mm: "Myanmar",
  mn: "Mongolia",
  mo: "Macao",
  mp: "Northern Mariana Islands",
  mq: "Martinique",
  mr: "Mauritania",
  ms: "Montserrat",
  mt: "Malta",
  mu: "Mauritius",
  mv: "Maldives",
  mw: "Malawi",
  mx: "Mexico",
  my: "Malaysia",
  mz: "Mozambique",
  na: "Namibia",
  nc: "New Caledonia",
  ne: "Niger",
  nf: "Norfolk Island",
  ng: "Nigeria",
  ni: "Nicaragua",
  nl: "Netherlands",
  no: "Norway",
  np: "Nepal",
  nr: "Nauru",
  nu: "Niue",
  nz: "New Zealand",
  om: "Oman",
  pa: "Panama",
  pe: "Peru",
  pf: "French Polynesia",
  pg: "Papua New Guinea",
  ph: "Philippines",
  pk: "Pakistan",
  pl: "Poland",
  pm: "Saint Pierre and Miquelon",
  pn: "Pitcairn Islands",
  pr: "Puerto Rico",
  ps: "Palestine",
  pt: "Portugal",
  pw: "Palau",
  py: "Paraguay",
  qa: "Qatar",
  re: "Réunion",
  ro: "Romania",
  rs: "Serbia",
  ru: "Russia",
  rw: "Rwanda",
  sa: "Saudi Arabia",
  sb: "Solomon Islands",
  sc: "Seychelles",
  sd: "Sudan",
  se: "Sweden",
  sg: "Singapore",
  sh: "Saint Helena, Ascension and Tristan da Cunha",
  si: "Slovenia",
  sj: "Svalbard and Jan Mayen",
  sk: "Slovakia",
  sl: "Sierra Leone",
  sm: "San Marino",
  sn: "Senegal",
  so: "Somalia",
  sr: "Suriname",
  ss: "South Sudan",
  st: "São Tomé and Príncipe",
  sv: "El Salvador",
  sx: "Sint Maarten",
  sy: "Syria",
  sz: "Eswatini",
  tc: "Turks and Caicos Islands",
  td: "Chad",
  tf: "French Southern Territories",
  tg: "Togo",
  th: "Thailand",
  tj: "Tajikistan",
  tk: "Tokelau",
  tl: "Timor-Leste",
  tm: "Turkmenistan",
  tn: "Tunisia",
  to: "Tonga",
  tr: "Türkiye",
  tt: "Trinidad and Tobago",
  tv: "Tuvalu",
  tw: "Taiwan",
  tz: "Tanzania",
  ua: "Ukraine",
  ug: "Uganda",
  um: "United States Minor Outlying Islands",
  us: "United States",
  uy: "Uruguay",
  uz: "Uzbekistan",
  va: "Vatican City",
  vc: "Saint Vincent and the Grenadines",
  ve: "Venezuela",
  vg: "British Virgin Islands",
  vi: "U.S. Virgin Islands",
  vn: "Vietnam",
  vu: "Vanuatu",
  wf: "Wallis and Futuna",
  ws: "Samoa",
  xk: "Kosovo",
  ye: "Yemen",
  yt: "Mayotte",
  za: "South Africa",
  zm: "Zambia",
  zw: "Zimbabwe",
  xx: "Others",
};