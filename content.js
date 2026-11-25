/**
 * UK FlipCalc - Content Script (Manifest V3)
 * Injects an isolated Shadow DOM floating profit & arbitrage widget on
 * ebay.co.uk/itm/* and vinted.co.uk/items/* pages.
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

  function detectSite() {
    if (window.__UK_FLIPCALC_SITE__) {
      return window.__UK_FLIPCALC_SITE__;
    }
    const host = window.location.hostname.toLowerCase();
    if (host.endsWith('ebay.co.uk')) {
      return 'ebay';
    }
    if (host.endsWith('vinted.co.uk')) {
      return 'vinted';
    }
    return null;
  }

  const SITE = detectSite();
  if (!SITE) {
    return;
  }

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

  function extractJsonLdOffer() {
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
            return {
              title: typeof item.name === 'string' ? item.name.trim() : '',
              price: core.parsePrice(String(offer.price))
            };
          }
        }
      } catch (_) {
        // Ignore malformed JSON-LD blocks
      }
    }
    return { title: '', price: null };
  }

  /**
   * Extract Title, Item Price (£), and Postage (£) from ebay.co.uk/itm/*
   */
  function extractEbayData() {
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
      title = rawTitle.replace(/\s*\|\s*eBay(?:\s*UK)?\s*$/i, '').trim();
    }

    let price = null;
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
        const parsed = core.parsePrice(el.innerText || el.textContent || '');
        if (parsed !== null) {
          price = parsed;
          break;
        }
      }
    }

    if (price === null) {
      const metaPrice = document.querySelector('[itemprop="price"]');
      if (metaPrice) {
        price = core.parsePrice(metaPrice.getAttribute('content') || metaPrice.textContent || '');
      }
    }

    if (price === null || !title) {
      const ld = extractJsonLdOffer();
      if (!title && ld.title) {
        title = ld.title;
      }
      if (price === null && ld.price !== null) {
        price = ld.price;
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

    for (const sel of shippingContainers) {
      const container = document.querySelector(sel);
      if (!container) {
        continue;
      }
      // Prefer first child span containing price or "Free" before delivery date text
      const spans = container.querySelectorAll('.ux-textspans, span');
      for (const span of spans) {
        const txt = (span.innerText || span.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt) {
          continue;
        }
        if (/\b(?:free|collection only)\b/i.test(txt) && !/£\s*\d/.test(txt)) {
          shipping = 0;
          shippingHint = 'Free postage';
          break;
        }
        const parsed = core.parsePrice(txt);
        if (parsed !== null && /£|GBP/i.test(txt)) {
          shipping = parsed;
          shippingHint = 'eBay postage';
          break;
        }
      }

      if (shipping !== null) {
        break;
      }

      const fullText = (container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim();
      if (fullText) {
        if (/\b(?:free\s*(?:postage|delivery|shipping|collection)|collection\s*only)\b/i.test(fullText) && !/£\s*\d/.test(fullText)) {
          shipping = 0;
          shippingHint = 'Free postage';
          break;
        }
        const parsed = core.parsePrice(fullText);
        if (parsed !== null) {
          shipping = parsed;
          shippingHint = 'eBay postage';
          break;
        }
      }
    }

    return {
      site: 'ebay',
      siteLabel: 'eBay UK',
      title,
      buyPrice: price,
      inboundShipping: shipping !== null ? shipping : 0,
      inboundHint: shippingHint || (shipping === null ? 'Manual / £0.00' : '')
    };
  }

  /**
   * Extract Title, Item Price (£), Buyer Protection Fee (£), and Shipping (£)
   * from vinted.co.uk/items/* using live-verified data-testid selectors.
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
    const combinedPriceText = queryFirstText([
      '[data-testid="total-combined-price"]'
    ]);
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
      title,
      buyPrice: itemPrice,
      inboundShipping: inboundTotal,
      inboundHint: hintParts.length > 0 ? hintParts.join(' + ') : 'Manual / £0.00'
    };
  }

  function extractPageData() {
    return SITE === 'ebay' ? extractEbayData() : extractVintedData();
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

    // Inject Shadow DOM isolated stylesheet
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

    const siteLabel = SITE === 'ebay' ? 'eBay UK' : 'Vinted UK';
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <section class="fc-card" id="fc-card" aria-label="UK FlipCalc Profit Calculator">
        <header class="fc-header">
          <div class="fc-brand">
            <span class="fc-logo" aria-hidden="true">£</span>
            <div class="fc-title-wrap">
              <span class="fc-brand-name">UK FlipCalc</span>
              <span class="fc-site-badge" data-site="${SITE}">${siteLabel}</span>
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
                <span class="fc-prefix">£</span>
                <input type="number" class="fc-input fc-has-prefix" id="fc-buy-price" min="0" step="0.01" placeholder="0.00" inputmode="decimal" />
              </div>
            </div>

            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-inbound">Post / Fee</label>
                <span class="fc-hint" id="fc-inbound-hint"></span>
              </div>
              <div class="fc-input-wrap">
                <span class="fc-prefix">£</span>
                <input type="number" class="fc-input fc-has-prefix" id="fc-inbound" min="0" step="0.01" placeholder="0.00" inputmode="decimal" />
              </div>
            </div>
          </div>

          <div class="fc-grid-2">
            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-resale-price">Target Resale</label>
              </div>
              <div class="fc-input-wrap">
                <span class="fc-prefix">£</span>
                <input type="number" class="fc-input fc-has-prefix fc-highlight" id="fc-resale-price" min="0" step="0.01" placeholder="Enter price" inputmode="decimal" />
              </div>
            </div>

            <div class="fc-field">
              <div class="fc-label-row">
                <label class="fc-label" for="fc-outbound">Outbound Post</label>
              </div>
              <div class="fc-input-wrap">
                <span class="fc-prefix">£</span>
                <input type="number" class="fc-input fc-has-prefix" id="fc-outbound" min="0" step="0.01" value="3.50" inputmode="decimal" />
              </div>
            </div>
          </div>

          <div class="fc-field">
            <div class="fc-label-row">
              <label class="fc-label" for="fc-platform">Resale Platform</label>
            </div>
            <select class="fc-select" id="fc-platform">
              <option value="ebay_private">eBay UK Private (0% fee)</option>
              <option value="ebay_business">eBay UK Business (12.8% + £0.30)</option>
              <option value="vinted_uk">Vinted UK (0% seller fee)</option>
              <option value="custom">Custom %</option>
            </select>
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

          <div class="fc-results" aria-live="polite">
            <div class="fc-profit-hero" id="fc-profit-hero" data-state="neutral">
              <span class="fc-profit-label">Est. Net Profit</span>
              <span class="fc-profit-value" id="fc-profit-value">—</span>
            </div>

            <div class="fc-metrics-grid">
              <div class="fc-metric">
                <div class="fc-metric-label">Total Cost</div>
                <div class="fc-metric-value" id="fc-total-cost">£0.00</div>
              </div>
              <div class="fc-metric">
                <div class="fc-metric-label">ROI</div>
                <div class="fc-metric-value" id="fc-roi" data-state="neutral">—</div>
              </div>
              <div class="fc-metric">
                <div class="fc-metric-label">Break-Even</div>
                <div class="fc-metric-value" id="fc-breakeven">£0.00</div>
              </div>
            </div>

            <div class="fc-fee-note" id="fc-fee-note">Enter Target Resale to calculate profit &amp; ROI</div>
          </div>

          <button type="button" class="fc-comps-btn" id="fc-comps-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span>Check eBay Sold Comps</span>
          </button>
          <div class="fc-query-preview" id="fc-query-preview"></div>
        </div>
      </section>

      <button type="button" class="fc-pill" id="fc-pill" aria-label="Expand UK FlipCalc">
        <span class="fc-logo" aria-hidden="true">£</span>
        <span>UK FlipCalc</span>
        <span class="fc-pill-profit" id="fc-pill-profit" data-state="neutral"></span>
      </button>
    `;

    shadow.appendChild(wrapper);
    (document.body || document.documentElement).appendChild(host);

    const els = {
      card: shadow.getElementById('fc-card'),
      pill: shadow.getElementById('fc-pill'),
      pillProfit: shadow.getElementById('fc-pill-profit'),
      resyncBtn: shadow.getElementById('fc-resync-btn'),
      minimizeBtn: shadow.getElementById('fc-minimize-btn'),
      titleInput: shadow.getElementById('fc-title'),
      titleStatus: shadow.getElementById('fc-title-status'),
      buyInput: shadow.getElementById('fc-buy-price'),
      inboundInput: shadow.getElementById('fc-inbound'),
      inboundHint: shadow.getElementById('fc-inbound-hint'),
      resaleInput: shadow.getElementById('fc-resale-price'),
      outboundInput: shadow.getElementById('fc-outbound'),
      platformSelect: shadow.getElementById('fc-platform'),
      customFeeRow: shadow.getElementById('fc-custom-fee-row'),
      customFeeInput: shadow.getElementById('fc-custom-fee'),
      profitHero: shadow.getElementById('fc-profit-hero'),
      profitValue: shadow.getElementById('fc-profit-value'),
      totalCost: shadow.getElementById('fc-total-cost'),
      roi: shadow.getElementById('fc-roi'),
      breakeven: shadow.getElementById('fc-breakeven'),
      feeNote: shadow.getElementById('fc-fee-note'),
      compsBtn: shadow.getElementById('fc-comps-btn'),
      queryPreview: shadow.getElementById('fc-query-preview')
    };

    const dirty = {
      title: false,
      buyPrice: false,
      inboundShipping: false
    };

    let minimized = false;
    try {
      minimized = window.localStorage.getItem('uk_flipcalc_minimized') === '1';
    } catch (_) {
      // Ignore storage access errors
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

    function updateQueryPreview() {
      const cleaned = core.cleanTitleForSearch(els.titleInput.value);
      if (cleaned) {
        els.queryPreview.textContent = `Search: "${cleaned}"`;
        els.queryPreview.title = cleaned;
      } else {
        els.queryPreview.textContent = 'Enter a title to search eBay Sold Comps';
        els.queryPreview.title = '';
      }
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
        customFeePct: els.customFeeInput.value
      });

      els.totalCost.textContent = core.formatGBP(res.totalCost, false);
      els.breakeven.textContent =
        res.breakEvenPrice !== null ? core.formatGBP(res.breakEvenPrice, false) : 'N/A';

      if (res.hasResaleInput && res.netProfit !== null) {
        const state = res.netProfit > 0 ? 'positive' : res.netProfit < 0 ? 'negative' : 'neutral';
        const formattedProfit = core.formatGBP(res.netProfit, true);
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
          els.feeNote.textContent = `Includes ${core.formatGBP(res.platformFee, false)} platform selling fee`;
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
        els.feeNote.textContent = 'Enter Target Resale to calculate profit & ROI';
      }
    }

    function syncFromDom(force) {
      if (force) {
        dirty.title = false;
        dirty.buyPrice = false;
        dirty.inboundShipping = false;
      }

      const data = extractPageData();

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
      recalculate();
      return Boolean(data.title && data.buyPrice !== null);
    }

    // Event bindings
    els.titleInput.addEventListener('input', () => {
      dirty.title = true;
      els.titleStatus.textContent = 'Edited';
      updateQueryPreview();
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

    els.resaleInput.addEventListener('input', recalculate);
    els.outboundInput.addEventListener('input', recalculate);
    els.platformSelect.addEventListener('change', recalculate);
    els.customFeeInput.addEventListener('input', recalculate);

    els.minimizeBtn.addEventListener('click', () => {
      minimized = true;
      applyMinimizedState();
    });

    els.pill.addEventListener('click', () => {
      minimized = false;
      applyMinimizedState();
    });

    els.resyncBtn.addEventListener('click', () => {
      syncFromDom(true);
    });

    els.compsBtn.addEventListener('click', () => {
      const title = els.titleInput.value.trim();
      const url = core.buildEbaySoldCompsUrl(title);
      window.open(url, '_blank', 'noopener,noreferrer');
    });

    applyMinimizedState();

    // Initial extraction + lightweight observer for async React/eBay hydration
    const completeOnInit = syncFromDom(false);
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
        syncFromDom(true);
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
