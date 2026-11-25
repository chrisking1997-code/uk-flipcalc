/**
 * UK FlipCalc (v2.0 Global) - Content Script (Manifest V3)
 * Injects an isolated Shadow DOM floating arbitrage calculator on eBay global sites
 * (UK, US, DE, AU, FR, CA, IT) and Vinted UK with automatic Sold Comps valuation,
 * live FX conversion, and instant buy/skip verdicts.
 */
(function () {
  'use strict';

  const HOST_ID = 'uk-flipcalc-host';
  if (document.getElementById(HOST_ID)) {
    return;
  }

  const core = window.UKFlipCalcCore;
  if (!core) {
    return;
  }

  function detectCurrentSite() {
    if (window.__UK_FLIPCALC_SITE__) {
      const override = window.__UK_FLIPCALC_SITE__;
      if (typeof override === 'object' && override.site) {
        return override;
      }
      if (override === 'vinted') {
        return { site: 'vinted', marketId: 'ebay_uk', siteLabel: 'Vinted UK', currency: 'GBP' };
      }
      return { site: 'ebay', marketId: 'ebay_uk', siteLabel: 'eBay UK', currency: 'GBP' };
    }
    return core.detectSiteFromHost(window.location.hostname);
  }

  const SITE_INFO = detectCurrentSite();
  if (!SITE_INFO) {
    return;
  }

  const SITE = SITE_INFO.site;

  function queryFirstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) {
          return text;
        }
      }
    }
    return '';
  }

  function extractJsonLdOffer(fallbackCurrency) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || '');
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (!item || typeof item !== 'object') {
            continue;
          }
          const offers = item.offers;
          const offer = Array.isArray(offers) ? offers[0] : offers;
          if (offer && offer.price !== undefined) {
            const curr =
              typeof offer.priceCurrency === 'string' && offer.priceCurrency.trim()
                ? offer.priceCurrency.trim().toUpperCase()
                : fallbackCurrency;
            const parsed = core.parsePriceWithCurrency(String(offer.price), curr);
            return {
              title: typeof item.name === 'string' ? item.name.trim() : '',
              price: parsed ? parsed.amount : null,
              currency: parsed ? parsed.currency : curr
            };
          }
        }
      } catch (_) {
        // Ignore malformed JSON-LD blocks
      }
    }
    return { title: '', price: null, currency: fallbackCurrency };
  }

  /**
   * Extract Title, Item Price, Currency, and Postage from any supported eBay site.
   */
  function extractEbayData(fxRates) {
    const siteCurrency = SITE_INFO.currency || 'GBP';

    let title = queryFirstText([
      'h1.x-item-title__mainTitle span.ux-textspans',
      'h1.x-item-title__mainTitle',
      '[data-testid="x-item-title"] h1',
      '#itemTitle'
    ]);

    if (title) {
      title = title.replace(/^Details about\s+/i, '').trim();
    } else {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const rawTitle = (ogTitle && ogTitle.content) || document.title || '';
      title = rawTitle.replace(/\s*\|\s*eBay(?:\s*[A-Z]{2})?\s*$/i, '').trim();
    }

    let price = null;
    let detectedCurrency = siteCurrency;
    const priceSelectors = [
      '.x-price-primary span.ux-textspans',
      '.x-price-primary',
      '[data-testid="x-price-primary"]',
      '.x-bin-price__content .x-price-primary',
      '.x-bid-price .x-price-primary',
      '#prcIsum',
      '#mm-saleDscPrc'
    ];
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const parsed = core.parsePriceWithCurrency(el.innerText || el.textContent || '', siteCurrency);
        if (parsed !== null) {
          price = parsed.amount;
          detectedCurrency = parsed.currency;
          break;
        }
      }
    }

    if (price === null) {
      const metaPrice = document.querySelector('[itemprop="price"]');
      const metaCurr = document.querySelector('[itemprop="priceCurrency"]');
      const fallbackCurr =
        (metaCurr && metaCurr.getAttribute('content')) || siteCurrency;
      if (metaPrice) {
        const parsed = core.parsePriceWithCurrency(
          metaPrice.getAttribute('content') || metaPrice.textContent || '',
          fallbackCurr
        );
        if (parsed !== null) {
          price = parsed.amount;
          detectedCurrency = parsed.currency;
        }
      }
    }

    if (price === null || !title) {
      const ld = extractJsonLdOffer(siteCurrency);
      if (!title && ld.title) {
        title = ld.title;
      }
      if (price === null && ld.price !== null) {
        price = ld.price;
        detectedCurrency = ld.currency || siteCurrency;
      }
    }

    let shipping = null;
    let shippingHint = '';
    const shippingContainers = [
      '.ux-labels-values--shipping .ux-labels-values__values-content',
      '.d-shipping-minview .ux-labels-values__values-content',
      '[data-testid="ux-labels-values--shipping"]',
      '.ux-labels-values--shipping',
      '#fshippingCost',
      '#shSummary'
    ];

    const hasCurrencyMarker = /(?:£|€|\$|GBP|USD|EUR|AUD|CAD)/i;

    for (const sel of shippingContainers) {
      const container = document.querySelector(sel);
      if (!container) {
        continue;
      }
      const spans = container.querySelectorAll('.ux-textspans, span');
      for (const span of spans) {
        const txt = (span.innerText || span.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt) {
          continue;
        }
        if (core.isFreeShippingText(txt)) {
          shipping = 0;
          shippingHint = 'Free postage';
          break;
        }
        if (hasCurrencyMarker.test(txt)) {
          const parsed = core.parsePriceWithCurrency(txt, detectedCurrency);
          if (parsed !== null) {
            shipping = core.convertCurrency(parsed.amount, parsed.currency, detectedCurrency, fxRates);
            shippingHint = 'eBay postage';
            break;
          }
        }
      }

      if (shipping !== null) {
        break;
      }

      const fullText = (container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim();
      if (fullText) {
        if (core.isFreeShippingText(fullText)) {
          shipping = 0;
          shippingHint = 'Free postage';
          break;
        }
        const parsed = core.parsePriceWithCurrency(fullText, detectedCurrency);
        if (parsed !== null) {
          shipping = core.convertCurrency(parsed.amount, parsed.currency, detectedCurrency, fxRates);
          shippingHint = 'eBay postage';
          break;
        }
      }
    }

    return {
      site: 'ebay',
      siteLabel: SITE_INFO.siteLabel,
      currency: detectedCurrency,
      title,
      buyPrice: price,
      inboundShipping: shipping !== null ? shipping : 0,
      inboundHint:
        shippingHint || (shipping === null ? `Manual / ${core.formatMoney(0, detectedCurrency)}` : '')
    };
  }

  /**
   * Extract Title, Item Price (£), Buyer Protection Fee (£), and Shipping (£) from vinted.co.uk/items/*
   */
  function extractVintedData() {
    let title = queryFirstText([
      '[data-testid="item-page-summary-plugin"] h1',
      'h1.web_ui__Text__title',
      'main h1',
      'h1'
    ]);

    if (!title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const rawTitle = (ogTitle && ogTitle.content) || document.title || '';
      title = rawTitle.replace(/\s*\|\s*Vinted\s*$/i, '').trim();
    }

    let itemPrice = null;
    const itemPriceText = queryFirstText([
      '[data-testid="item-price"]',
      '.details-list--pricing [data-testid="item-price"]',
      '[data-testid="item-sidebar-price-container"] p'
    ]);
    if (itemPriceText) {
      itemPrice = core.parsePrice(itemPriceText);
    }

    if (itemPrice === null) {
      const metaPrice = document.querySelector('meta[property="product:price:amount"]');
      if (metaPrice && metaPrice.content) {
        itemPrice = core.parsePrice(metaPrice.content);
      }
    }

    let buyerProtectionFee = 0;
    const combinedPriceText = queryFirstText(['[data-testid="total-combined-price"]']);
    const combinedPrice = core.parsePrice(combinedPriceText);
    if (itemPrice !== null && combinedPrice !== null && combinedPrice > itemPrice) {
      buyerProtectionFee = Math.round((combinedPrice - itemPrice) * 100) / 100;
    }

    let shipping = null;
    const shippingText = queryFirstText([
      '[data-testid="item-shipping-banner-price"]',
      '[data-testid="item-shipping-banner--suffix"]',
      '[data-testid="item-shipping-banner"]'
    ]);
    if (shippingText) {
      shipping = core.parsePrice(shippingText);
    }

    const inboundTotal = Math.round((buyerProtectionFee + (shipping || 0)) * 100) / 100;
    const hintParts = [];
    if (buyerProtectionFee > 0) {
      hintParts.push(`Fee £${buyerProtectionFee.toFixed(2)}`);
    }
    if (shipping !== null && shipping > 0) {
      hintParts.push(`Ship £${shipping.toFixed(2)}`);
    } else if (shipping === 0) {
      hintParts.push('Free ship');
    }

    return {
      site: 'vinted',
      siteLabel: 'Vinted UK',
      currency: 'GBP',
      title,
      buyPrice: itemPrice,
      inboundShipping: inboundTotal,
      inboundHint: hintParts.length > 0 ? hintParts.join(' + ') : 'Manual / £0.00'
    };
  }

  function extractPageData(fxRates) {
    return SITE === 'ebay' ? extractEbayData(fxRates) : extractVintedData();
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        resolve({ ok: false, error: 'Extension messaging unavailable' });
        return;
      }
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message || 'Runtime error' });
            return;
          }
          resolve(response || { ok: false, error: 'No response' });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function createWidget() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-uk-flipcalc', 'true');

    // Prevent host-page keyboard shortcuts from firing while typing inside widget
    for (const evtName of ['keydown', 'keyup', 'keypress']) {
      host.addEventListener(evtName, (e) => e.stopPropagation());
    }

    const shadow = host.attachShadow({ mode: 'open' });

    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('styles.css');
      shadow.appendChild(link);
    } else if (window.__UK_FLIPCALC_CSS_TEXT__) {
      const style = document.createElement('style');
      style.textContent = window.__UK_FLIPCALC_CSS_TEXT__;
      shadow.appendChild(style);
    } else if (window.__UK_FLIPCALC_CSS_URL__) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = window.__UK_FLIPCALC_CSS_URL__;
      shadow.appendChild(link);
    }

    const defaultMarket = core.EBAY_MARKETS[SITE_INFO.marketId] || core.EBAY_MARKETS.ebay_uk;
    const marketOptionsHtml = Object.values(core.EBAY_MARKETS)
      .map(
        (m) =>
          `<option value="${m.id}"${m.id === defaultMarket.id ? ' selected' : ''}>${m.flag} ${m.name} (${core.getCurrencySymbol(m.currency)})</option>`
      )
      .join('');

    const platformOptionsHtml = Object.values(core.PLATFORMS)
      .map(
        (p) =>
          `<option value="${p.id}"${p.id === defaultMarket.defaultPlatform ? ' selected' : ''}>${p.label}</option>`
      )
      .join('');

    const initialSymbol = core.getCurrencySymbol(SITE_INFO.currency);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <section class="fc-card" id="fc-card" aria-label="FlipCalc Profit & Sold Comps Calculator">
        <header class="fc-header">
          <div class="fc-brand">
            <span class="fc-logo" id="fc-logo" aria-hidden="true">${initialSymbol}</span>
            <div class="fc-title-wrap">
              <span class="fc-brand-name">FlipCalc</span>
              <span class="fc-site-badge" data-site="${SITE}">${SITE_INFO.siteLabel}</span>
            </div>
          </div>
          <div class="fc-header-actions">
            <button type="button" class="fc-icon-btn" id="fc-resync-btn" title="Re-read title &amp; prices from page" aria-label="Re-sync from page">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                <path d="M16 16h5v5"/>
              </svg>
            </button>
            <button type="button" class="fc-icon-btn" id="fc-minimize-btn" title="Minimise calculator" aria-label="Minimise calculator">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>
        </header>

        <div class="fc-body">
          <div class="fc-field">
            <div class="fc-label-row">
              <label class="fc-label" for="fc-title">Item Title</label>
              <span class="fc-hint" id="fc-title-status">Auto-detected</span>
            </div>
            <input type="text" class="fc-input" id="fc-title" placeholder="Paste or edit item title..." autocomplete="off" spellcheck="false" />
          </div>

          <div class="fc-grid-2">
            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-buy-price">Buy Price</label>
              </div>
              <div class="fc-input-wrap">
                <span class="fc-prefix" data-currency-prefix>${initialSymbol}</span>
                <input type="number" class="fc-input fc-has-prefix" id="fc-buy-price" min="0" step="0.01" placeholder="0.00" inputmode="decimal" />
              </div>
            </div>

            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-inbound">Post / Fee</label>
                <span class="fc-hint" id="fc-inbound-hint"></span>
              </div>
              <div class="fc-input-wrap">
                <span class="fc-prefix" data-currency-prefix>${initialSymbol}</span>
                <input type="number" class="fc-input fc-has-prefix" id="fc-inbound" min="0" step="0.01" placeholder="0.00" inputmode="decimal" />
              </div>
            </div>
          </div>

          <div class="fc-grid-2">
            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-resale-price">Target Resale</label>
                <span class="fc-hint" id="fc-resale-hint">Auto</span>
              </div>
              <div class="fc-input-wrap">
                <span class="fc-prefix" data-currency-prefix>${initialSymbol}</span>
                <input type="number" class="fc-input fc-has-prefix fc-highlight" id="fc-resale-price" min="0" step="0.01" placeholder="Auto-checking..." inputmode="decimal" />
              </div>
            </div>

            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-outbound">Outbound Post</label>
              </div>
              <div class="fc-input-wrap">
                <span class="fc-prefix" data-currency-prefix>${initialSymbol}</span>
                <input type="number" class="fc-input fc-has-prefix" id="fc-outbound" min="0" step="0.01" value="${defaultMarket.defaultOutbound.toFixed(2)}" inputmode="decimal" />
              </div>
            </div>
          </div>

          <div class="fc-grid-2">
            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-market">Comps Market</label>
              </div>
              <select class="fc-select" id="fc-market">
                ${marketOptionsHtml}
              </select>
            </div>

            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-platform">Resale Fee</label>
              </div>
              <select class="fc-select" id="fc-platform">
                ${platformOptionsHtml}
              </select>
            </div>
          </div>

          <div class="fc-field fc-custom-fee-row" id="fc-custom-fee-row">
            <div class="fc-label-row">
              <label class="fc-label" for="fc-custom-fee">Custom Platform Fee (%)</label>
            </div>
            <div class="fc-input-wrap">
              <input type="number" class="fc-input fc-has-suffix" id="fc-custom-fee" min="0" max="99.9" step="0.1" value="10" inputmode="decimal" />
              <span class="fc-suffix">%</span>
            </div>
          </div>

          <div class="fc-market-box" id="fc-market-box">
            <div class="fc-market-head">
              <div class="fc-market-title-group">
                <span class="fc-market-title">Market Valuation</span>
                <span class="fc-count-pill" id="fc-comps-count" data-confidence="none">Checking...</span>
              </div>
              <button type="button" class="fc-icon-btn fc-icon-btn-sm" id="fc-comps-refresh" title="Refresh Sold Comps now" aria-label="Refresh Sold Comps">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                  <path d="M16 16h5v5"/>
                </svg>
              </button>
            </div>

            <div class="fc-comps-status" id="fc-comps-status">
              <div class="fc-comps-status-left">
                <span class="fc-spinner fc-visible" id="fc-comps-spinner"></span>
                <span id="fc-comps-status-text">Checking eBay sold listings...</span>
              </div>
            </div>

            <div class="fc-tier-grid fc-hidden" id="fc-tier-grid">
              <button type="button" class="fc-tier-btn" data-tier="p25" id="fc-tier-p25" title="Conservative (25th percentile)">
                <span class="fc-tier-label">Low (P25)</span>
                <span class="fc-tier-price" id="fc-tier-p25-val">—</span>
              </button>
              <button type="button" class="fc-tier-btn fc-active" data-tier="median" id="fc-tier-median" title="Recommended typical sold price (Median)">
                <span class="fc-tier-label">Median</span>
                <span class="fc-tier-price" id="fc-tier-median-val">—</span>
              </button>
              <button type="button" class="fc-tier-btn" data-tier="p75" id="fc-tier-p75" title="Optimistic (75th percentile)">
                <span class="fc-tier-label">High (P75)</span>
                <span class="fc-tier-price" id="fc-tier-p75-val">—</span>
              </button>
            </div>

            <div class="fc-fx-note" id="fc-fx-note"></div>
          </div>

          <div class="fc-results" aria-live="polite">
            <div class="fc-verdict" id="fc-verdict" data-tone="neutral">
              <span class="fc-verdict-badge" id="fc-verdict-badge">Awaiting Price</span>
              <span class="fc-verdict-reason" id="fc-verdict-reason">Fetching market comps...</span>
            </div>

            <div class="fc-profit-hero" id="fc-profit-hero" data-state="neutral">
              <span class="fc-profit-label">Est. Net Profit</span>
              <span class="fc-profit-value" id="fc-profit-value">—</span>
            </div>

            <div class="fc-metrics-grid">
              <div class="fc-metric">
                <div class="fc-metric-label">Total Cost</div>
                <div class="fc-metric-value" id="fc-total-cost">—</div>
              </div>
              <div class="fc-metric">
                <div class="fc-metric-label">ROI</div>
                <div class="fc-metric-value" id="fc-roi" data-state="neutral">—</div>
              </div>
              <div class="fc-metric">
                <div class="fc-metric-label">Break-Even</div>
                <div class="fc-metric-value" id="fc-breakeven">—</div>
              </div>
            </div>

            <div class="fc-fee-note" id="fc-fee-note">Enter Target Resale or pick a Market Comps price</div>
          </div>

          <button type="button" class="fc-comps-btn" id="fc-comps-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span id="fc-comps-btn-label">View ${defaultMarket.name} Sold Comps</span>
          </button>
          <div class="fc-query-preview" id="fc-query-preview"></div>
        </div>
      </section>

      <button type="button" class="fc-pill" id="fc-pill" aria-label="Expand FlipCalc">
        <span class="fc-logo" id="fc-pill-logo" aria-hidden="true">${initialSymbol}</span>
        <span>FlipCalc</span>
        <span class="fc-pill-profit" id="fc-pill-profit" data-state="neutral"></span>
      </button>
    `;

    shadow.appendChild(wrapper);
    (document.body || document.documentElement).appendChild(host);

    const els = {
      card: shadow.getElementById('fc-card'),
      logo: shadow.getElementById('fc-logo'),
      pill: shadow.getElementById('fc-pill'),
      pillLogo: shadow.getElementById('fc-pill-logo'),
      pillProfit: shadow.getElementById('fc-pill-profit'),
      resyncBtn: shadow.getElementById('fc-resync-btn'),
      minimizeBtn: shadow.getElementById('fc-minimize-btn'),
      titleInput: shadow.getElementById('fc-title'),
      titleStatus: shadow.getElementById('fc-title-status'),
      buyInput: shadow.getElementById('fc-buy-price'),
      inboundInput: shadow.getElementById('fc-inbound'),
      inboundHint: shadow.getElementById('fc-inbound-hint'),
      resaleInput: shadow.getElementById('fc-resale-price'),
      resaleHint: shadow.getElementById('fc-resale-hint'),
      outboundInput: shadow.getElementById('fc-outbound'),
      marketSelect: shadow.getElementById('fc-market'),
      platformSelect: shadow.getElementById('fc-platform'),
      customFeeRow: shadow.getElementById('fc-custom-fee-row'),
      customFeeInput: shadow.getElementById('fc-custom-fee'),
      compsCount: shadow.getElementById('fc-comps-count'),
      compsRefreshBtn: shadow.getElementById('fc-comps-refresh'),
      compsStatus: shadow.getElementById('fc-comps-status'),
      compsSpinner: shadow.getElementById('fc-comps-spinner'),
      compsStatusText: shadow.getElementById('fc-comps-status-text'),
      tierGrid: shadow.getElementById('fc-tier-grid'),
      tierP25Btn: shadow.getElementById('fc-tier-p25'),
      tierMedianBtn: shadow.getElementById('fc-tier-median'),
      tierP75Btn: shadow.getElementById('fc-tier-p75'),
      tierP25Val: shadow.getElementById('fc-tier-p25-val'),
      tierMedianVal: shadow.getElementById('fc-tier-median-val'),
      tierP75Val: shadow.getElementById('fc-tier-p75-val'),
      fxNote: shadow.getElementById('fc-fx-note'),
      verdictBox: shadow.getElementById('fc-verdict'),
      verdictBadge: shadow.getElementById('fc-verdict-badge'),
      verdictReason: shadow.getElementById('fc-verdict-reason'),
      profitHero: shadow.getElementById('fc-profit-hero'),
      profitValue: shadow.getElementById('fc-profit-value'),
      totalCost: shadow.getElementById('fc-total-cost'),
      roi: shadow.getElementById('fc-roi'),
      breakeven: shadow.getElementById('fc-breakeven'),
      feeNote: shadow.getElementById('fc-fee-note'),
      compsBtn: shadow.getElementById('fc-comps-btn'),
      compsBtnLabel: shadow.getElementById('fc-comps-btn-label'),
      queryPreview: shadow.getElementById('fc-query-preview'),
      currencyPrefixes: shadow.querySelectorAll('[data-currency-prefix]')
    };

    const dirty = {
      title: false,
      buyPrice: false,
      inboundShipping: false,
      resalePrice: false,
      outboundShipping: false
    };

    let workingCurrency = SITE_INFO.currency || 'GBP';
    let fxRates = Object.assign({}, core.FALLBACK_FX_RATES);
    let fxIsLive = false;
    let rawCompsItems = [];
    let lastCompsSummary = null;
    let activeTier = 'median';
    let lastQueriedKey = '';
    let compsRequestSeq = 0;
    let titleDebounceTimer = null;

    let minimized = false;
    try {
      minimized = window.localStorage.getItem('uk_flipcalc_minimized') === '1';
    } catch (_) {
      // Ignore storage access errors
    }

    function applyCurrencySymbols() {
      const symbol = core.getCurrencySymbol(workingCurrency);
      const isWide = symbol.length > 1;
      els.logo.textContent = symbol;
      els.pillLogo.textContent = symbol;
      for (const prefixEl of els.currencyPrefixes) {
        prefixEl.textContent = symbol;
      }
      for (const inp of [els.buyInput, els.inboundInput, els.resaleInput, els.outboundInput]) {
        inp.classList.toggle('fc-has-prefix-wide', isWide);
      }
    }

    function applyMinimizedState() {
      if (minimized) {
        els.card.classList.add('fc-hidden');
        els.pill.classList.add('fc-visible');
      } else {
        els.card.classList.remove('fc-hidden');
        els.pill.classList.remove('fc-visible');
      }
      try {
        window.localStorage.setItem('uk_flipcalc_minimized', minimized ? '1' : '0');
      } catch (_) {
        // Ignore storage errors
      }
    }

    function getSelectedMarket() {
      return core.EBAY_MARKETS[els.marketSelect.value] || core.EBAY_MARKETS.ebay_uk;
    }

    function updateQueryPreview() {
      const market = getSelectedMarket();
      els.compsBtnLabel.textContent = `View ${market.name} Sold Comps`;
      const cleaned = core.cleanTitleForSearch(els.titleInput.value);
      if (cleaned) {
        els.queryPreview.textContent = `Search (${market.shortName}): "${cleaned}"`;
        els.queryPreview.title = cleaned;
      } else {
        els.queryPreview.textContent = `Enter a title to search ${market.name} Sold Comps`;
        els.queryPreview.title = '';
      }
    }

    function setTierHighlight(tierName) {
      activeTier = tierName;
      els.tierP25Btn.classList.toggle('fc-active', tierName === 'p25');
      els.tierMedianBtn.classList.toggle('fc-active', tierName === 'median');
      els.tierP75Btn.classList.toggle('fc-active', tierName === 'p75');
    }

    function updateFxNote() {
      const market = getSelectedMarket();
      if (market.currency === workingCurrency) {
        els.fxNote.classList.remove('fc-visible');
        els.fxNote.textContent = '';
        return;
      }
      const oneUnit = core.convertCurrency(1, market.currency, workingCurrency, fxRates);
      const rateTag = fxIsLive ? 'live FX' : 'est. FX';
      const origMedianPart =
        lastCompsSummary && lastCompsSummary.marketMedian !== null
          ? `${market.shortName} median ${core.formatMoney(lastCompsSummary.marketMedian, market.currency)} • `
          : '';
      els.fxNote.textContent = `${origMedianPart}1 ${market.currency} = ${core.formatMoney(oneUnit, workingCurrency)} (${rateTag})`;
      els.fxNote.classList.add('fc-visible');
    }

    function applySummaryToUi(summary, allowAutoFill) {
      lastCompsSummary = summary;
      const market = getSelectedMarket();

      if (!summary || summary.count === 0) {
        els.tierGrid.classList.add('fc-hidden');
        els.compsCount.textContent = '0 sold';
        els.compsCount.dataset.confidence = 'none';
        updateFxNote();
        recalculate();
        return;
      }

      els.compsCount.textContent = `${summary.count} sold`;
      els.compsCount.dataset.confidence = summary.confidence;
      els.tierP25Val.textContent = core.formatMoney(summary.p25, workingCurrency);
      els.tierMedianVal.textContent = core.formatMoney(summary.median, workingCurrency);
      els.tierP75Val.textContent = core.formatMoney(summary.p75, workingCurrency);
      els.tierGrid.classList.remove('fc-hidden');
      els.compsStatus.style.display = 'none';

      if (allowAutoFill && summary.median !== null) {
        const chosenVal =
          activeTier === 'p25'
            ? summary.p25
            : activeTier === 'p75'
              ? summary.p75
              : summary.median;
        if (chosenVal !== null) {
          els.resaleInput.value = chosenVal.toFixed(2);
          els.resaleHint.textContent = `Auto (${market.shortName})`;
          setTierHighlight(activeTier || 'median');
        }
      }

      updateFxNote();
      recalculate();
    }

    function setCompsLoadingState(message) {
      els.compsStatus.style.display = 'flex';
      els.compsSpinner.classList.add('fc-visible');
      els.compsStatusText.textContent = message;
      els.compsCount.textContent = 'Checking...';
      els.compsCount.dataset.confidence = 'none';
      els.compsRefreshBtn.classList.add('fc-spinning');
    }

    function setCompsMessageState(badgeText, message) {
      els.compsStatus.style.display = 'flex';
      els.compsSpinner.classList.remove('fc-visible');
      els.compsStatusText.textContent = message;
      els.compsCount.textContent = badgeText;
      els.compsCount.dataset.confidence = 'none';
      els.tierGrid.classList.add('fc-hidden');
      els.compsRefreshBtn.classList.remove('fc-spinning');
      lastCompsSummary = null;
      updateFxNote();
      recalculate();
    }

    async function fetchAndAnalyzeComps(options) {
      const opts = options || {};
      const title = els.titleInput.value.trim();
      const market = getSelectedMarket();
      const primaryQuery = core.cleanTitleForSearch(title, 8);
      const broaderQuery = core.cleanTitleForSearch(title, 4);

      if (!primaryQuery) {
        setCompsMessageState('No title', 'Enter an item title to check sold prices');
        return;
      }

      const requestKey = `${market.id}::${primaryQuery.toLowerCase()}`;
      if (!opts.forceRefresh && requestKey === lastQueriedKey && rawCompsItems.length > 0) {
        const summary = core.analyzeSoldComps(rawCompsItems, {
          targetCurrency: workingCurrency,
          marketCurrency: market.currency,
          fxRates
        });
        applySummaryToUi(summary, Boolean(opts.allowAutoFill));
        return;
      }

      const seq = ++compsRequestSeq;
      lastQueriedKey = requestKey;
      setCompsLoadingState(`Checking ${market.name} sold prices...`);

      const resp = await sendRuntimeMessage({
        type: 'FETCH_SOLD_COMPS',
        marketId: market.id,
        query: primaryQuery,
        forceRefresh: Boolean(opts.forceRefresh)
      });

      if (seq !== compsRequestSeq) {
        return;
      }

      if (!resp || !resp.ok || !resp.html) {
        setCompsMessageState('Manual', 'Auto-check unavailable — click button below');
        return;
      }

      let parsed = core.parseEbaySoldHtml(resp.html, market.currency);

      if (parsed.blocked) {
        setCompsMessageState('Verify', 'eBay check needed — click button below to view');
        return;
      }

      // If strict 8-word title had < 2 sold matches, retry once with broader 4-word core query
      if (parsed.items.length < 2 && broaderQuery && broaderQuery.toLowerCase() !== primaryQuery.toLowerCase()) {
        setCompsLoadingState(`Broadening search on ${market.name}...`);
        const retryResp = await sendRuntimeMessage({
          type: 'FETCH_SOLD_COMPS',
          marketId: market.id,
          query: broaderQuery,
          forceRefresh: Boolean(opts.forceRefresh)
        });

        if (seq !== compsRequestSeq) {
          return;
        }

        if (retryResp && retryResp.ok && retryResp.html) {
          const retryParsed = core.parseEbaySoldHtml(retryResp.html, market.currency);
          if (retryParsed.blocked) {
            setCompsMessageState('Verify', 'eBay check needed — click button below to view');
            return;
          }
          if (retryParsed.items.length > parsed.items.length) {
            parsed = retryParsed;
          }
        }
      }

      els.compsRefreshBtn.classList.remove('fc-spinning');
      rawCompsItems = parsed.items;

      if (parsed.items.length === 0) {
        setCompsMessageState('0 sold', `No recent sold comps on ${market.name} — try shortening title`);
        return;
      }

      const summary = core.analyzeSoldComps(parsed.items, {
        targetCurrency: workingCurrency,
        marketCurrency: market.currency,
        fxRates
      });

      const shouldFill = opts.forceAutoFill || (!dirty.resalePrice && opts.allowAutoFill !== false);
      applySummaryToUi(summary, shouldFill);
    }

    function recalculate() {
      const isCustom = els.platformSelect.value === 'custom';
      els.customFeeRow.classList.toggle('fc-visible', isCustom);

      const res = core.calculateFlip({
        buyPrice: els.buyInput.value,
        inboundShipping: els.inboundInput.value,
        resalePrice: els.resaleInput.value,
        outboundShipping: els.outboundInput.value,
        platform: els.platformSelect.value,
        customFeePct: els.customFeeInput.value,
        currency: workingCurrency,
        fxRates
      });

      els.totalCost.textContent = core.formatMoney(res.totalCost, workingCurrency, false);
      els.breakeven.textContent =
        res.breakEvenPrice !== null ? core.formatMoney(res.breakEvenPrice, workingCurrency, false) : 'N/A';

      const verdict = core.evaluateFlipVerdict(res, lastCompsSummary, workingCurrency, fxRates);
      els.verdictBox.dataset.tone = verdict.tone;
      const prefixIcon =
        verdict.tone === 'positive'
          ? '✓ '
          : verdict.tone === 'warning'
            ? '⚠ '
            : verdict.tone === 'negative'
              ? '✕ '
              : '';
      els.verdictBadge.textContent = `${prefixIcon}${verdict.label}`;
      els.verdictReason.textContent = verdict.reason;
      els.verdictReason.title = verdict.reason;

      if (res.hasResaleInput && res.netProfit !== null) {
        const state = res.netProfit > 0 ? 'positive' : res.netProfit < 0 ? 'negative' : 'neutral';
        const formattedProfit = core.formatMoney(res.netProfit, workingCurrency, true);
        els.profitHero.dataset.state = state;
        els.profitValue.textContent = formattedProfit;

        els.pillProfit.dataset.state = state;
        els.pillProfit.textContent = formattedProfit;

        els.roi.dataset.state = state;
        if (res.roiPct !== null) {
          const roiSign = res.roiPct > 0 ? '+' : '';
          els.roi.textContent = `${roiSign}${res.roiPct.toFixed(1)}%`;
        } else {
          els.roi.textContent = '—';
        }

        if (res.platformFee > 0) {
          els.feeNote.textContent = `Includes ${core.formatMoney(res.platformFee, workingCurrency, false)} platform selling fee`;
        } else {
          els.feeNote.textContent = '0% platform selling fee applied';
        }
      } else {
        els.profitHero.dataset.state = 'neutral';
        els.profitValue.textContent = '—';
        els.roi.dataset.state = 'neutral';
        els.roi.textContent = '—';
        els.pillProfit.dataset.state = 'neutral';
        els.pillProfit.textContent = '';
        els.feeNote.textContent = 'Enter Target Resale or pick a Market Comps price';
      }
    }

    function syncFromDom(force) {
      if (force) {
        dirty.title = false;
        dirty.buyPrice = false;
        dirty.inboundShipping = false;
        dirty.resalePrice = false;
      }

      const data = extractPageData(fxRates);

      if (data.currency && data.currency !== workingCurrency) {
        workingCurrency = data.currency;
        applyCurrencySymbols();
        if (!dirty.outboundShipping) {
          const convertedOutbound = core.convertCurrency(
            defaultMarket.defaultOutbound,
            defaultMarket.currency,
            workingCurrency,
            fxRates
          );
          if (convertedOutbound !== null) {
            els.outboundInput.value = convertedOutbound.toFixed(2);
          }
        }
      }

      if (!dirty.title && data.title) {
        els.titleInput.value = data.title;
        els.titleStatus.textContent = 'Auto-detected';
      } else if (!dirty.title && !els.titleInput.value) {
        els.titleStatus.textContent = 'Manual entry';
      }

      if (!dirty.buyPrice && data.buyPrice !== null) {
        els.buyInput.value = data.buyPrice.toFixed(2);
      }

      if (!dirty.inboundShipping) {
        els.inboundInput.value = data.inboundShipping.toFixed(2);
        els.inboundHint.textContent = data.inboundHint || '';
        els.inboundHint.title = data.inboundHint || '';
      }

      updateQueryPreview();
      updateFxNote();
      recalculate();
      return Boolean(data.title && data.buyPrice !== null);
    }

    function scheduleAutoComps(delayMs, forceRefresh) {
      clearTimeout(titleDebounceTimer);
      titleDebounceTimer = setTimeout(() => {
        if (els.titleInput.value.trim()) {
          fetchAndAnalyzeComps({ forceRefresh: Boolean(forceRefresh), allowAutoFill: !dirty.resalePrice });
        }
      }, delayMs);
    }

    // Event bindings
    els.titleInput.addEventListener('input', () => {
      dirty.title = true;
      els.titleStatus.textContent = 'Edited';
      updateQueryPreview();
      scheduleAutoComps(900, false);
    });

    els.titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(titleDebounceTimer);
        dirty.resalePrice = false;
        fetchAndAnalyzeComps({ forceRefresh: false, forceAutoFill: true });
      }
    });

    els.buyInput.addEventListener('input', () => {
      dirty.buyPrice = true;
      recalculate();
    });

    els.inboundInput.addEventListener('input', () => {
      dirty.inboundShipping = true;
      els.inboundHint.textContent = 'Edited';
      recalculate();
    });

    els.resaleInput.addEventListener('input', () => {
      dirty.resalePrice = true;
      els.resaleHint.textContent = 'Manual';
      setTierHighlight('');
      recalculate();
    });

    els.outboundInput.addEventListener('input', () => {
      dirty.outboundShipping = true;
      recalculate();
    });

    els.marketSelect.addEventListener('change', () => {
      const market = getSelectedMarket();
      if (els.platformSelect.value !== 'custom' && els.platformSelect.value !== 'vinted_uk') {
        els.platformSelect.value = market.defaultPlatform;
      }
      dirty.resalePrice = false;
      activeTier = 'median';
      rawCompsItems = [];
      lastQueriedKey = '';
      updateQueryPreview();
      updateFxNote();
      fetchAndAnalyzeComps({ forceRefresh: false, forceAutoFill: true });
    });

    els.platformSelect.addEventListener('change', recalculate);
    els.customFeeInput.addEventListener('input', recalculate);

    function handleTierClick(tierName) {
      if (!lastCompsSummary || lastCompsSummary[tierName] === null) {
        return;
      }
      const market = getSelectedMarket();
      dirty.resalePrice = false;
      setTierHighlight(tierName);
      els.resaleInput.value = lastCompsSummary[tierName].toFixed(2);
      const labelMap = { p25: 'Low', median: 'Med', p75: 'High' };
      els.resaleHint.textContent = `${labelMap[tierName]} (${market.shortName})`;
      recalculate();
    }

    els.tierP25Btn.addEventListener('click', () => handleTierClick('p25'));
    els.tierMedianBtn.addEventListener('click', () => handleTierClick('median'));
    els.tierP75Btn.addEventListener('click', () => handleTierClick('p75'));

    els.compsRefreshBtn.addEventListener('click', () => {
      dirty.resalePrice = false;
      activeTier = 'median';
      fetchAndAnalyzeComps({ forceRefresh: true, forceAutoFill: true });
    });

    els.minimizeBtn.addEventListener('click', () => {
      minimized = true;
      applyMinimizedState();
    });

    els.pill.addEventListener('click', () => {
      minimized = false;
      applyMinimizedState();
    });

    els.resyncBtn.addEventListener('click', () => {
      rawCompsItems = [];
      lastQueriedKey = '';
      syncFromDom(true);
      fetchAndAnalyzeComps({ forceRefresh: true, forceAutoFill: true });
    });

    els.compsBtn.addEventListener('click', () => {
      const title = els.titleInput.value.trim();
      const market = getSelectedMarket();
      const url = core.buildEbaySoldCompsUrl(title, market.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    applyCurrencySymbols();
    applyMinimizedState();

    // Load live FX rates in background
    sendRuntimeMessage({ type: 'FETCH_FX_RATES' }).then((fxResp) => {
      if (fxResp && fxResp.ok && fxResp.rates) {
        fxRates = Object.assign({}, core.FALLBACK_FX_RATES, fxResp.rates);
        fxIsLive = true;
        if (rawCompsItems.length > 0) {
          const market = getSelectedMarket();
          const summary = core.analyzeSoldComps(rawCompsItems, {
            targetCurrency: workingCurrency,
            marketCurrency: market.currency,
            fxRates
          });
          applySummaryToUi(summary, !dirty.resalePrice);
        } else {
          updateFxNote();
          recalculate();
        }
      }
    });

    // Initial extraction + lightweight observer for async React/eBay hydration
    const completeOnInit = syncFromDom(false);
    if (els.titleInput.value.trim()) {
      scheduleAutoComps(350, false);
    }

    let observer = null;
    let debounceTimer = null;

    function startHydrationObserver() {
      if (observer) {
        observer.disconnect();
      }
      const startedAt = Date.now();
      observer = new MutationObserver(() => {
        if (Date.now() - startedAt > 10000) {
          observer.disconnect();
          return;
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const ok = syncFromDom(false);
          if (els.titleInput.value.trim() && !lastQueriedKey) {
            scheduleAutoComps(300, false);
          }
          if (ok && Date.now() - startedAt > 1500) {
            observer.disconnect();
          }
        }, 250);
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    if (!completeOnInit) {
      startHydrationObserver();
    }

    // Handle SPA route changes (e.g. clicking a recommended item on Vinted)
    let lastUrl = window.location.href;
    const onUrlChange = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        els.resaleInput.value = '';
        rawCompsItems = [];
        lastCompsSummary = null;
        lastQueriedKey = '';
        activeTier = 'median';
        syncFromDom(true);
        scheduleAutoComps(450, false);
        startHydrationObserver();
      }
    };

    window.addEventListener('popstate', onUrlChange);
    setInterval(onUrlChange, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget, { once: true });
  } else {
    createWidget();
  }
})();
