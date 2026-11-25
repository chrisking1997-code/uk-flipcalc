/**
 * UK FlipCalc (v2.1) - Manifest V3 Background Service Worker
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

  try {
    const resp = await fetchWithTimeout(
      'https://open.er-api.com/v6/latest/USD',
      { method: 'GET', cache: 'no-store' },
      7000
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

  try {
    const resp = await fetchWithTimeout(
      'https://api.frankfurter.app/latest?from=USD&to=GBP,EUR,AUD,CAD,JPY',
      { method: 'GET', cache: 'no-store' },
      7000
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

function buildSoldSearchUrl(domain, query, condition) {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: '1',
    LH_Complete: '1',
    _sop: '13'
  });
  if (condition === 'used') {
    params.set('LH_ItemCondition', '3000');
  } else if (condition === 'new') {
    params.set('LH_ItemCondition', '1000');
  }
  return `https://${domain}/sch/i.html?${params.toString()}`;
}

const HTML_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

async function fetchSoldCompsHtml(marketId, query, forceRefresh, condition) {
  const domain = MARKET_DOMAINS[marketId] || MARKET_DOMAINS.ebay_uk;
  const trimmedQuery = String(query || '').trim();
  const cond = condition === 'used' || condition === 'new' ? condition : 'any';
  const url = buildSoldSearchUrl(domain, trimmedQuery, cond);

  if (!trimmedQuery) {
    return { ok: false, error: 'Empty search query', url };
  }

  const cacheKey = `${marketId}::${cond}::${trimmedQuery.toLowerCase()}`;
  if (!forceRefresh && compsCache.has(cacheKey)) {
    const entry = compsCache.get(cacheKey);
    if (Date.now() - entry.ts < COMPS_TTL_MS) {
      return { ok: true, html: entry.html, url, finalUrl: entry.finalUrl || url, fromCache: true };
    }
    compsCache.delete(cacheKey);
  }

  try {
    let resp = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: HTML_FETCH_HEADERS
      },
      7500
    );

    if (resp.status === 403) {
      try {
        await fetchWithTimeout(
          `https://${domain}/`,
          {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: HTML_FETCH_HEADERS
          },
          5000
        );
      } catch (_) {
        // Ignore warmup network error and still attempt single retry
      }

      resp = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: HTML_FETCH_HEADERS
        },
        7500
      );
    }

    const finalUrl = resp.url || url;
    if (/splashui\/challenge|\/challenge\b/i.test(finalUrl)) {
      return { ok: true, blocked: true, html: '', url, finalUrl, fromCache: false };
    }

    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}`, url, finalUrl };
    }

    const html = await resp.text();

    if (compsCache.size >= COMPS_MAX_CACHE) {
      const oldestKey = compsCache.keys().next().value;
      compsCache.delete(oldestKey);
    }
    compsCache.set(cacheKey, { html, finalUrl, ts: Date.now() });

    return { ok: true, html, url, finalUrl, fromCache: false };
  } catch (err) {
    return {
      ok: false,
      error:
        err && err.name === 'AbortError'
          ? 'Timed out'
          : String(err && err.message ? err.message : err),
      url
    };
  }
}

function buildVintedApiUrl(query, condition) {
  const params = new URLSearchParams({
    page: '1',
    per_page: '36',
    search_text: String(query || '').trim(),
    order: 'relevance'
  });
  if (condition === 'new') {
    params.append('status_ids[]', '6');
    params.append('status_ids[]', '1');
  } else if (condition === 'used') {
    params.append('status_ids[]', '2');
    params.append('status_ids[]', '3');
    params.append('status_ids[]', '4');
  }
  return `https://www.vinted.co.uk/api/v2/catalog/items?${params.toString()}`;
}

async function fetchVintedCompsJson(query, forceRefresh, condition) {
  const trimmedQuery = String(query || '').trim();
  const cond = condition === 'used' || condition === 'new' ? condition : 'any';
  const url = buildVintedApiUrl(trimmedQuery, cond);

  if (!trimmedQuery) {
    return { ok: false, error: 'Empty search query', url };
  }

  const cacheKey = `vinted_uk::${cond}::${trimmedQuery.toLowerCase()}`;
  if (!forceRefresh && compsCache.has(cacheKey)) {
    const entry = compsCache.get(cacheKey);
    if (Date.now() - entry.ts < COMPS_TTL_MS && entry.json) {
      return { ok: true, json: entry.json, url, fromCache: true };
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
        headers: { Accept: 'application/json, text/plain, */*' }
      },
      7500
    );

    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}`, url };
    }

    const json = await resp.json();
    if (compsCache.size >= COMPS_MAX_CACHE) {
      const oldestKey = compsCache.keys().next().value;
      compsCache.delete(oldestKey);
    }
    compsCache.set(cacheKey, { json, ts: Date.now() });

    return { ok: true, json, url, fromCache: false };
  } catch (err) {
    return {
      ok: false,
      error:
        err && err.name === 'AbortError'
          ? 'Timed out'
          : String(err && err.message ? err.message : err),
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
    fetchSoldCompsHtml(message.marketId, message.query, Boolean(message.forceRefresh), message.condition)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === 'FETCH_VINTED_COMPS') {
    fetchVintedCompsJson(message.query, Boolean(message.forceRefresh), message.condition)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
