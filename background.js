/**
 * UK FlipCalc (v2.0) - Manifest V3 Background Service Worker
 * Handles cross-origin eBay Sold Comps fetches and live FX rate lookups with caching.
 */
'use strict';

const MARKET_DOMAINS = {
  ebay_uk: 'www.ebay.co.uk',
  ebay_us: 'www.ebay.com',
  ebay_de: 'www.ebay.de',
  ebay_au: 'www.ebay.com.au',
  ebay_fr: 'www.ebay.fr',
  ebay_ca: 'www.ebay.ca',
  ebay_it: 'www.ebay.it'
};

const FX_STORAGE_KEY = 'uk_flipcalc_fx_cache_v1';
const FX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const COMPS_TTL_MS = 20 * 60 * 1000; // 20 minutes
const COMPS_MAX_CACHE = 60;

const compsCache = new Map();

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function getFxRates(forceRefresh) {
  if (!forceRefresh && chrome.storage && chrome.storage.local) {
    try {
      const stored = await chrome.storage.local.get(FX_STORAGE_KEY);
      const cached = stored && stored[FX_STORAGE_KEY];
      if (cached && cached.rates && Date.now() - cached.updatedAt < FX_TTL_MS) {
        return { ok: true, rates: cached.rates, updatedAt: cached.updatedAt, source: cached.source, fromCache: true };
      }
    } catch (_) {
      // Proceed to network fetch
    }
  }

  // Primary: open.er-api.com (no API key required, supports GBP, USD, EUR, AUD, CAD, JPY, TWD)
  try {
    const resp = await fetchWithTimeout(
      'https://open.er-api.com/v6/latest/USD',
      { method: 'GET', cache: 'no-store' },
      8000
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.result === 'success' && data.rates && data.rates.GBP) {
        const rates = {
          USD: 1.0,
          GBP: data.rates.GBP,
          EUR: data.rates.EUR,
          AUD: data.rates.AUD,
          CAD: data.rates.CAD,
          JPY: data.rates.JPY,
          TWD: data.rates.TWD
        };
        const payload = { rates, updatedAt: Date.now(), source: 'open.er-api.com' };
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [FX_STORAGE_KEY]: payload }).catch(() => {});
        }
        return Object.assign({ ok: true, fromCache: false }, payload);
      }
    }
  } catch (_) {
    // Try secondary provider
  }

  // Secondary fallback: api.frankfurter.app
  try {
    const resp = await fetchWithTimeout(
      'https://api.frankfurter.app/latest?from=USD&to=GBP,EUR,AUD,CAD,JPY',
      { method: 'GET', cache: 'no-store' },
      8000
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.rates && data.rates.GBP) {
        const rates = Object.assign({ USD: 1.0 }, data.rates);
        const payload = { rates, updatedAt: Date.now(), source: 'frankfurter.app' };
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [FX_STORAGE_KEY]: payload }).catch(() => {});
        }
        return Object.assign({ ok: true, fromCache: false }, payload);
      }
    }
  } catch (_) {
    // Return failure so content script uses built-in fallback rates
  }

  return { ok: false, error: 'FX fetch failed' };
}

function buildSoldSearchUrl(domain, query) {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: '1',
    LH_Complete: '1',
    _sop: '13',
    _ipg: '60'
  });
  return `https://${domain}/sch/i.html?${params.toString()}`;
}

async function fetchSoldCompsHtml(marketId, query, forceRefresh) {
  const domain = MARKET_DOMAINS[marketId] || MARKET_DOMAINS.ebay_uk;
  const trimmedQuery = String(query || '').trim();
  const url = buildSoldSearchUrl(domain, trimmedQuery);

  if (!trimmedQuery) {
    return { ok: false, error: 'Empty search query', url };
  }

  const cacheKey = `${marketId}::${trimmedQuery.toLowerCase()}`;
  if (!forceRefresh && compsCache.has(cacheKey)) {
    const entry = compsCache.get(cacheKey);
    if (Date.now() - entry.ts < COMPS_TTL_MS) {
      return { ok: true, html: entry.html, url, fromCache: true };
    }
    compsCache.delete(cacheKey);
  }

  try {
    const resp = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      },
      12000
    );

    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}`, url };
    }

    const html = await resp.text();

    // Evict oldest cache entry if over limit
    if (compsCache.size >= COMPS_MAX_CACHE) {
      const oldestKey = compsCache.keys().next().value;
      compsCache.delete(oldestKey);
    }
    compsCache.set(cacheKey, { html, ts: Date.now() });

    return { ok: true, html, url, fromCache: false };
  } catch (err) {
    return {
      ok: false,
      error: err && err.name === 'AbortError' ? 'Request timed out' : String(err && err.message ? err.message : err),
      url
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if (message.type === 'FETCH_FX_RATES') {
    getFxRates(Boolean(message.forceRefresh))
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === 'FETCH_SOLD_COMPS') {
    fetchSoldCompsHtml(message.marketId, message.query, Boolean(message.forceRefresh))
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
