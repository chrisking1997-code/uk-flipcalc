/**
 * UK FlipCalc (v2.0 Global) - Pure calculation, multi-currency parsing, FX conversion,
 * multi-country eBay Sold Comps parsing/statistics, and verdict engine.
 * Loaded before content.js in the Chrome Extension and exportable for Node unit tests.
 */
(function (root) {
  'use strict';

  const CURRENCIES = {
    GBP: { code: 'GBP', symbol: '£', decimals: 2 },
    USD: { code: 'USD', symbol: '$', decimals: 2 },
    EUR: { code: 'EUR', symbol: '€', decimals: 2 },
    AUD: { code: 'AUD', symbol: 'A$', decimals: 2 },
    CAD: { code: 'CAD', symbol: 'C$', decimals: 2 },
    JPY: { code: 'JPY', symbol: '¥', decimals: 0 },
    TWD: { code: 'TWD', symbol: 'NT$', decimals: 0 }
  };

  // Fallback FX rates (base = USD) used only before live rates load or when offline.
  const FALLBACK_FX_RATES = {
    USD: 1.0,
    GBP: 0.79,
    EUR: 0.92,
    AUD: 1.54,
    CAD: 1.39,
    JPY: 152.0,
    TWD: 32.3
  };

  const EBAY_MARKETS = {
    ebay_uk: {
      id: 'ebay_uk',
      name: 'eBay UK',
      shortName: 'UK',
      flag: '🇬🇧',
      domain: 'www.ebay.co.uk',
      currency: 'GBP',
      defaultOutbound: 3.5,
      defaultPlatform: 'ebay_private'
    },
    ebay_us: {
      id: 'ebay_us',
      name: 'eBay US',
      shortName: 'US',
      flag: '🇺🇸',
      domain: 'www.ebay.com',
      currency: 'USD',
      defaultOutbound: 5.0,
      defaultPlatform: 'ebay_us_standard'
    },
    ebay_de: {
      id: 'ebay_de',
      name: 'eBay DE',
      shortName: 'DE',
      flag: '🇩🇪',
      domain: 'www.ebay.de',
      currency: 'EUR',
      defaultOutbound: 4.95,
      defaultPlatform: 'ebay_de_private'
    },
    ebay_au: {
      id: 'ebay_au',
      name: 'eBay AU',
      shortName: 'AU',
      flag: '🇦🇺',
      domain: 'www.ebay.com.au',
      currency: 'AUD',
      defaultOutbound: 9.5,
      defaultPlatform: 'ebay_au_standard'
    },
    ebay_fr: {
      id: 'ebay_fr',
      name: 'eBay FR',
      shortName: 'FR',
      flag: '🇫🇷',
      domain: 'www.ebay.fr',
      currency: 'EUR',
      defaultOutbound: 4.95,
      defaultPlatform: 'ebay_fr_private'
    },
    ebay_ca: {
      id: 'ebay_ca',
      name: 'eBay CA',
      shortName: 'CA',
      flag: '🇨🇦',
      domain: 'www.ebay.ca',
      currency: 'CAD',
      defaultOutbound: 9.0,
      defaultPlatform: 'ebay_ca_standard'
    },
    ebay_it: {
      id: 'ebay_it',
      name: 'eBay IT',
      shortName: 'IT',
      flag: '🇮🇹',
      domain: 'www.ebay.it',
      currency: 'EUR',
      defaultOutbound: 5.5,
      defaultPlatform: 'ebay_it_private'
    }
  };

  const PLATFORMS = {
    ebay_private: {
      id: 'ebay_private',
      label: 'eBay UK Private (0% fee)',
      pctFee: 0,
      fixedFee: 0,
      fixedCurrency: 'GBP'
    },
    ebay_business: {
      id: 'ebay_business',
      label: 'eBay UK Business (12.8% + £0.30)',
      pctFee: 12.8,
      fixedFee: 0.30,
      fixedCurrency: 'GBP'
    },
    ebay_us_standard: {
      id: 'ebay_us_standard',
      label: 'eBay US Standard (13.25% + $0.30)',
      pctFee: 13.25,
      fixedFee: 0.30,
      fixedCurrency: 'USD'
    },
    ebay_de_private: {
      id: 'ebay_de_private',
      label: 'eBay DE Private (0% fee)',
      pctFee: 0,
      fixedFee: 0,
      fixedCurrency: 'EUR'
    },
    ebay_de_business: {
      id: 'ebay_de_business',
      label: 'eBay DE Business (12% + €0.35)',
      pctFee: 12.0,
      fixedFee: 0.35,
      fixedCurrency: 'EUR'
    },
    ebay_au_standard: {
      id: 'ebay_au_standard',
      label: 'eBay AU Standard (13.4% + A$0.30)',
      pctFee: 13.4,
      fixedFee: 0.30,
      fixedCurrency: 'AUD'
    },
    ebay_fr_private: {
      id: 'ebay_fr_private',
      label: 'eBay FR Private (5% fee)',
      pctFee: 5.0,
      fixedFee: 0,
      fixedCurrency: 'EUR'
    },
    ebay_ca_standard: {
      id: 'ebay_ca_standard',
      label: 'eBay CA Standard (13.25% + C$0.30)',
      pctFee: 13.25,
      fixedFee: 0.30,
      fixedCurrency: 'CAD'
    },
    ebay_it_private: {
      id: 'ebay_it_private',
      label: 'eBay IT Private (5% fee)',
      pctFee: 5.0,
      fixedFee: 0,
      fixedCurrency: 'EUR'
    },
    vinted_uk: {
      id: 'vinted_uk',
      label: 'Vinted UK (0% seller fee)',
      pctFee: 0,
      fixedFee: 0,
      fixedCurrency: 'GBP'
    },
    custom: {
      id: 'custom',
      label: 'Custom %',
      pctFee: 10,
      fixedFee: 0,
      fixedCurrency: 'GBP'
    }
  };

  // Common UK / US / EU eBay & Vinted listing filler & hype phrases stripped before sold-comps lookup.
  const FILLER_PHRASES = [
    'brand new with tags',
    'brand new without tags',
    'brand new in box',
    'new with tags',
    'new without tags',
    'new in box',
    'brand new',
    'free postage',
    'free delivery',
    'free shipping',
    'fast dispatch',
    'fast delivery',
    'next day delivery',
    'uk seller',
    'us seller',
    'uk stock',
    'excellent condition',
    'great condition',
    'good condition',
    'mint condition',
    'perfect condition',
    'immaculate condition',
    'very good condition',
    'read description',
    'see pics',
    'see photos',
    'please read',
    'job lot',
    'worn once',
    'worn twice',
    'never worn',
    'unwanted gift',
    'sehr guter zustand',
    'guter zustand',
    'top zustand',
    'wie neu',
    'kostenloser versand',
    'très bon état',
    'bon état',
    'comme neuf',
    'livraison gratuite',
    'ottime condizioni',
    'come nuovo'
  ];

  const FILLER_WORDS = new Set([
    'bnwt', 'bnwot', 'nwt', 'nwot', 'bnib', 'nib', 'bn', 'vgc', 'euc', 'guc',
    'new', 'mint', 'excellent', 'great', 'good', 'perfect', 'immaculate',
    'superb', 'amazing', 'lovely', 'gorgeous', 'stunning', 'nice', 'clean',
    'condition', 'bargain', 'cheap', 'rare', 'wow', 'look', 'l@@k', 'read',
    'description', 'fast', 'free', 'post', 'postage', 'p&p', 'pp', 'delivery',
    'dispatch', 'despatch', 'shipping', 'uk', 'us', 'usa', 'seller', 'stock',
    'genuine', 'authentic', 'official', 'original', 'rrp', 'sale', 'reduced',
    'clearance', 'gift', 'present', 'xmas', 'christmas', 'please', 'see',
    'pics', 'photos', 'pictures', 'tested', 'working', 'sealed', 'boxed',
    'unopened', 'unused', 'unwanted', 'preloved', 'pre-loved', 'used', 'worn',
    'hardly', 'barely', 'freebie', 'offer', 'offers', 'quick', 'send',
    'tracked', 'royal', 'mail', 'evri', 'yodel', 'inpost', 'hermes', 'parcel',
    'postpaid', 'neu', 'ovp', 'gebraucht', 'rar', 'selten', 'top', 'versand',
    'gratis', 'kostenlos', 'neuf', 'occasion', 'gratuit', 'nuovo', 'usato',
    'spedizione'
  ]);

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function detectSiteFromHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host.endsWith('ebay.co.uk')) {
      return { site: 'ebay', marketId: 'ebay_uk', siteLabel: 'eBay UK', currency: 'GBP' };
    }
    if (host.endsWith('ebay.com.au')) {
      return { site: 'ebay', marketId: 'ebay_au', siteLabel: 'eBay AU', currency: 'AUD' };
    }
    if (host.endsWith('ebay.com')) {
      return { site: 'ebay', marketId: 'ebay_us', siteLabel: 'eBay US', currency: 'USD' };
    }
    if (host.endsWith('ebay.de')) {
      return { site: 'ebay', marketId: 'ebay_de', siteLabel: 'eBay DE', currency: 'EUR' };
    }
    if (host.endsWith('ebay.fr')) {
      return { site: 'ebay', marketId: 'ebay_fr', siteLabel: 'eBay FR', currency: 'EUR' };
    }
    if (host.endsWith('ebay.ca')) {
      return { site: 'ebay', marketId: 'ebay_ca', siteLabel: 'eBay CA', currency: 'CAD' };
    }
    if (host.endsWith('ebay.it')) {
      return { site: 'ebay', marketId: 'ebay_it', siteLabel: 'eBay IT', currency: 'EUR' };
    }
    if (host.endsWith('vinted.co.uk')) {
      return { site: 'vinted', marketId: 'ebay_uk', siteLabel: 'Vinted UK', currency: 'GBP' };
    }
    return null;
  }

  function getCurrencySymbol(code) {
    const cfg = CURRENCIES[String(code || 'GBP').toUpperCase()];
    return cfg ? cfg.symbol : '£';
  }

  /**
   * Convert an amount from one currency to another using USD-based FX rates.
   */
  function convertCurrency(amount, fromCurrency, toCurrency, fxRates) {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
      return null;
    }
    const from = String(fromCurrency || 'GBP').toUpperCase();
    const to = String(toCurrency || from).toUpperCase();
    if (from === to) {
      return round2(amount);
    }
    const rates = Object.assign({}, FALLBACK_FX_RATES, fxRates || {});
    const fromRate = rates[from];
    const toRate = rates[to];
    if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
      return round2(amount);
    }
    return round2((amount / fromRate) * toRate);
  }

  /**
   * Parse localized numeric strings like "1,234.56", "1.234,56", "29,99", "1.200", "33.97".
   */
  function parseLocalizedNumber(numStr) {
    if (!numStr || typeof numStr !== 'string') {
      return null;
    }
    const cleaned = numStr.replace(/[\s\u00a0]/g, '');
    if (!cleaned || !/\d/.test(cleaned)) {
      return null;
    }

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let normalized = cleaned;

    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma > lastDot) {
        // European: 1.234,56
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        // US/UK: 1,234.56
        normalized = cleaned.replace(/,/g, '');
      }
    } else if (lastComma !== -1) {
      const decimalsAfterComma = cleaned.length - lastComma - 1;
      if (decimalsAfterComma === 1 || decimalsAfterComma === 2) {
        normalized = cleaned.replace(',', '.');
      } else {
        normalized = cleaned.replace(/,/g, '');
      }
    } else if (lastDot !== -1) {
      const decimalsAfterDot = cleaned.length - lastDot - 1;
      if (decimalsAfterDot === 3 && /^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
        // European thousands separator without decimals: e.g. 1.200
        normalized = cleaned.replace(/\./g, '');
      }
    }

    const val = parseFloat(normalized);
    return Number.isFinite(val) && val >= 0 ? round2(val) : null;
  }

  function isFreeShippingText(text) {
    if (!text || typeof text !== 'string') {
      return false;
    }
    const hasCurrencyNum = /(?:£|€|\$|GBP|USD|EUR|AUD|CAD)\s*\d|\d\s*(?:€|EUR)/i.test(text);
    if (hasCurrencyNum) {
      return false;
    }
    return /\b(?:free|collection\s*only|local\s*pickup|kostenlos(?:er)?|nur\s*abholung|gratuit(?:e)?|gratis|ritiro\s*in\s*zona)\b/i.test(
      text
    );
  }

  /**
   * Parse a multi-currency price string into { amount, currency } or null.
   * Examples: "£14.99", "US $34.95", "AU $49.00", "C $39.99", "EUR 29,99", "29,99 €", "Free postage"
   */
  function parsePriceWithCurrency(raw, fallbackCurrency) {
    const fb = String(fallbackCurrency || 'GBP').toUpperCase();
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw >= 0 ? { amount: round2(raw), currency: fb } : null;
    }
    if (!raw || typeof raw !== 'string') {
      return null;
    }

    const text = raw.replace(/\u00a0/g, ' ').trim();
    if (!text) {
      return null;
    }

    if (isFreeShippingText(text)) {
      return { amount: 0, currency: fb };
    }

    const numPattern = '([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)';

    const prefixPatterns = [
      { re: new RegExp(`(?:AU\\s*\\$|A\\$|AUD)\\s*${numPattern}`, 'i'), currency: 'AUD' },
      { re: new RegExp(`(?:CA?\\s*\\$|CAD)\\s*${numPattern}`, 'i'), currency: 'CAD' },
      { re: new RegExp(`(?:US\\s*\\$|USD)\\s*${numPattern}`, 'i'), currency: 'USD' },
      { re: new RegExp(`(?:£|GBP)\\s*${numPattern}`, 'i'), currency: 'GBP' },
      { re: new RegExp(`(?:€|EUR)\\s*${numPattern}`, 'i'), currency: 'EUR' },
      { re: new RegExp(`(?:¥|JPY)\\s*${numPattern}`, 'i'), currency: 'JPY' },
      { re: new RegExp(`(?:NT\\$|TWD)\\s*${numPattern}`, 'i'), currency: 'TWD' },
      {
        re: new RegExp(`\\$\\s*${numPattern}`),
        currency: fb === 'AUD' || fb === 'CAD' || fb === 'USD' ? fb : 'USD'
      }
    ];

    for (const p of prefixPatterns) {
      const m = text.match(p.re);
      if (m) {
        const amount = parseLocalizedNumber(m[1]);
        if (amount !== null) {
          return { amount, currency: p.currency };
        }
      }
    }

    // Suffix currency patterns common in Europe: "29,99 €", "29,99 EUR"
    const suffixPatterns = [
      { re: new RegExp(`${numPattern}\\s*(?:€|EUR)`, 'i'), currency: 'EUR' },
      { re: new RegExp(`${numPattern}\\s*(?:£|GBP)`, 'i'), currency: 'GBP' },
      { re: new RegExp(`${numPattern}\\s*(?:USD)`, 'i'), currency: 'USD' },
      { re: new RegExp(`${numPattern}\\s*(?:AUD)`, 'i'), currency: 'AUD' },
      { re: new RegExp(`${numPattern}\\s*(?:CAD)`, 'i'), currency: 'CAD' }
    ];

    for (const p of suffixPatterns) {
      const m = text.match(p.re);
      if (m) {
        const amount = parseLocalizedNumber(m[1]);
        if (amount !== null) {
          return { amount, currency: p.currency };
        }
      }
    }

    // Fallback: plain number only (e.g. meta/JSON-LD or numeric string)
    const plainMatch = text.match(new RegExp(`^\\s*${numPattern}\\s*$`));
    if (plainMatch) {
      const amount = parseLocalizedNumber(plainMatch[1]);
      if (amount !== null) {
        return { amount, currency: fb };
      }
    }

    return null;
  }

  /**
   * Backward-compatible price parser returning only the numeric amount or null.
   */
  function parsePrice(raw) {
    const parsed = parsePriceWithCurrency(raw, 'GBP');
    return parsed ? parsed.amount : null;
  }

  /**
   * Safely convert user numeric input to a non-negative finite number (defaulting to 0).
   */
  function toNonNegativeNumber(value) {
    const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
    if (!Number.isFinite(num) || num < 0) {
      return 0;
    }
    return num;
  }

  /**
   * Compute flip profit, fees, total cost, ROI %, and break-even resale price.
   */
  function calculateFlip(params) {
    const buyPrice = toNonNegativeNumber(params.buyPrice);
    const inboundShipping = toNonNegativeNumber(params.inboundShipping);
    const outboundShipping = toNonNegativeNumber(params.outboundShipping);
    const hasResaleInput =
      params.resalePrice !== '' &&
      params.resalePrice !== null &&
      params.resalePrice !== undefined &&
      Number.isFinite(parseFloat(params.resalePrice)) &&
      parseFloat(params.resalePrice) > 0;
    const resalePrice = hasResaleInput ? toNonNegativeNumber(params.resalePrice) : 0;

    const workingCurrency = String(params.currency || 'GBP').toUpperCase();
    const platformCfg = PLATFORMS[params.platform] || PLATFORMS.ebay_private;
    const pctFee =
      platformCfg.id === 'custom'
        ? Math.min(100, toNonNegativeNumber(params.customFeePct))
        : platformCfg.pctFee;

    let fixedFee = platformCfg.fixedFee || 0;
    if (fixedFee > 0 && platformCfg.fixedCurrency && platformCfg.fixedCurrency !== workingCurrency) {
      fixedFee = convertCurrency(fixedFee, platformCfg.fixedCurrency, workingCurrency, params.fxRates);
    }

    const feeRate = pctFee / 100;
    const baseCost = buyPrice + inboundShipping + outboundShipping;
    const platformFee = hasResaleInput ? resalePrice * feeRate + fixedFee : 0;
    const totalCost = baseCost + platformFee;

    const netProfit = hasResaleInput ? resalePrice - totalCost : null;
    const roiPct =
      hasResaleInput && totalCost > 0 ? (netProfit / totalCost) * 100 : null;

    // Break-even resale price R where R * (1 - feeRate) - fixedFee - baseCost = 0
    let breakEvenPrice = null;
    if (baseCost === 0) {
      breakEvenPrice = 0;
    } else if (feeRate < 1) {
      breakEvenPrice = (baseCost + fixedFee) / (1 - feeRate);
    }

    return {
      currency: workingCurrency,
      buyPrice: round2(buyPrice),
      inboundShipping: round2(inboundShipping),
      outboundShipping: round2(outboundShipping),
      resalePrice: hasResaleInput ? round2(resalePrice) : null,
      baseCost: round2(baseCost),
      platformFee: round2(platformFee),
      totalCost: round2(totalCost),
      netProfit: netProfit !== null ? round2(netProfit) : null,
      roiPct: roiPct !== null ? Math.round(roiPct * 10) / 10 : null,
      breakEvenPrice: breakEvenPrice !== null ? round2(breakEvenPrice) : null,
      hasResaleInput
    };
  }

  /**
   * Clean an item title into a focused keyword query for eBay Sold & Completed comps.
   */
  function cleanTitleForSearch(rawTitle, maxWords) {
    if (!rawTitle || typeof rawTitle !== 'string') {
      return '';
    }
    const limit = Number.isInteger(maxWords) && maxWords > 0 ? maxWords : 8;

    let cleaned = rawTitle
      .replace(/[\[\(][^\]\)]{1,28}[\]\)]/g, ' ')
      .replace(/[|•·★☆✓✔🔥💥✨⚡❤️👍!?,:;~*=+"]/g, ' ')
      .replace(/(?:\s+[-–—]+|[-–—]+\s+|[/\\]+)/g, ' ');

    for (const phrase of FILLER_PHRASES) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
    }

    const rawTokens = cleaned
      .split(/\s+/)
      .map((t) => t.replace(/^['’`-]+|['’`-]+$/g, ''))
      .filter(Boolean);

    const seen = new Set();
    const filtered = [];

    for (const token of rawTokens) {
      const lower = token.toLowerCase();
      if (FILLER_WORDS.has(lower)) {
        continue;
      }
      if (!/[a-z0-9\u00c0-\u024f]/i.test(token)) {
        continue;
      }
      if (/^(?:£|€|\$)\d/.test(token)) {
        continue;
      }
      if (seen.has(lower)) {
        continue;
      }
      seen.add(lower);
      filtered.push(token);
      if (filtered.length >= limit) {
        break;
      }
    }

    if (filtered.length > 0) {
      return filtered.join(' ');
    }

    return rawTitle
      .replace(/[^\w\s\u00c0-\u024f-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, limit)
      .join(' ');
  }

  /**
   * Build the eBay Sold & Completed listings URL for any supported eBay market.
   */
  function buildEbaySoldCompsUrl(rawTitle, marketId, maxWords) {
    const market = EBAY_MARKETS[marketId] || EBAY_MARKETS.ebay_uk;
    const query = cleanTitleForSearch(rawTitle, maxWords);
    const params = new URLSearchParams({
      _nkw: query,
      LH_Sold: '1',
      LH_Complete: '1',
      _sop: '13'
    });
    return `https://${market.domain}/sch/i.html?${params.toString()}`;
  }

  function formatMoney(amount, currencyCode, showPlus) {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
      return '—';
    }
    const code = String(currencyCode || 'GBP').toUpperCase();
    const cfg = CURRENCIES[code] || CURRENCIES.GBP;
    const sign = amount < 0 ? '-' : showPlus && amount > 0 ? '+' : '';
    const formattedNum = Math.abs(amount).toFixed(cfg.decimals);
    return `${sign}${cfg.symbol}${formattedNum}`;
  }

  function formatGBP(amount, showPlus) {
    return formatMoney(amount, 'GBP', showPlus);
  }

  function isRangePriceText(text) {
    if (!text) {
      return false;
    }
    return /\b(?:to|bis|à|a)\b/i.test(text) && (text.match(/\d/g) || []).length >= 2;
  }

  function isBotChallengeHtml(htmlOrText) {
    if (!htmlOrText || typeof htmlOrText !== 'string') {
      return false;
    }
    return /Pardon Our Interruption|Checking your browser before accessing|\/splashui\/challenge|g-recaptcha|captcha-delivery/i.test(
      htmlOrText
    );
  }

  /**
   * Parse sold items from a DOM Document (browser DOMParser output).
   * Supports both classic eBay `.s-item` and newer `.s-card` / `.su-card-container` markup.
   */
  function parseEbaySoldDocument(doc, marketCurrency) {
    const fallbackCurr = String(marketCurrency || 'GBP').toUpperCase();
    if (!doc) {
      return { blocked: false, items: [] };
    }

    const docTitle = (doc.title || '').trim();
    const bodyTextHead = ((doc.body && doc.body.textContent) || '').slice(0, 2000);
    if (isBotChallengeHtml(docTitle + ' ' + bodyTextHead)) {
      return { blocked: true, items: [] };
    }

    const items = [];
    const resultsRoot =
      doc.querySelector('ul.srp-results') ||
      doc.querySelector('.srp-river-results') ||
      doc.body;

    if (!resultsRoot) {
      return { blocked: false, items: [] };
    }

    const children = resultsRoot.querySelectorAll(
      'li.s-item, li.s-card, li.srp-river-answer'
    );

    for (const node of children) {
      if (node.classList && node.classList.contains('srp-river-answer')) {
        // eBay inserts "Results matching fewer words" divider as an srp-river-answer.
        // Stop once we already have solid exact matches so unrelated cheaper items don't pollute median.
        const answerText = (node.textContent || '').toLowerCase();
        if (
          items.length >= 3 &&
          /(?:matching fewer words|weniger wörtern|moins de mots|meno parole|international sellers)/i.test(
            answerText
          )
        ) {
          break;
        }
        continue;
      }

      const titleEl = node.querySelector(
        '.s-item__title, .s-card__title, h3.s-item__title'
      );
      const rawTitle = titleEl ? (titleEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!rawTitle || /^shop on ebay$/i.test(rawTitle)) {
        continue;
      }

      const priceEl = node.querySelector('.s-item__price, .s-card__price');
      const priceText = priceEl ? (priceEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!priceText || isRangePriceText(priceText)) {
        continue;
      }

      const parsed = parsePriceWithCurrency(priceText, fallbackCurr);
      if (!parsed || parsed.amount <= 0) {
        continue;
      }

      const cleanTitle = rawTitle
        .replace(/^(?:New listing|Neues Angebot|Nouvelle annonce|Nuova inserzione)\s*/i, '')
        .trim();

      items.push({
        title: cleanTitle,
        price: parsed.amount,
        currency: parsed.currency
      });

      if (items.length >= 40) {
        break;
      }
    }

    return { blocked: false, items };
  }

  /**
   * String-based HTML fallback parser (used in Node tests or environments without DOMParser).
   */
  function parseEbaySoldHtmlString(html, marketCurrency) {
    const fallbackCurr = String(marketCurrency || 'GBP').toUpperCase();
    if (!html || typeof html !== 'string') {
      return { blocked: false, items: [] };
    }
    if (isBotChallengeHtml(html.slice(0, 12000))) {
      return { blocked: true, items: [] };
    }

    const items = [];
    const blockRegex = /<li[^>]*class="[^"]*\b(?:s-item|s-card)\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;

    while ((match = blockRegex.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(
        /class="[^"]*\b(?:s-item__title|s-card__title)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:div|h3|span)>/i
      );
      const rawTitle = titleMatch
        ? titleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
      if (!rawTitle || /^shop on ebay$/i.test(rawTitle)) {
        continue;
      }

      const priceMatch = block.match(
        /class="[^"]*\b(?:s-item__price|s-card__price)\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      );
      const priceText = priceMatch
        ? priceMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
      if (!priceText || isRangePriceText(priceText)) {
        continue;
      }

      const parsed = parsePriceWithCurrency(priceText, fallbackCurr);
      if (!parsed || parsed.amount <= 0) {
        continue;
      }

      items.push({
        title: rawTitle.replace(/^(?:New listing|Neues Angebot)\s*/i, '').trim(),
        price: parsed.amount,
        currency: parsed.currency
      });

      if (items.length >= 40) {
        break;
      }
    }

    return { blocked: false, items };
  }

  function parseEbaySoldHtml(html, marketCurrency) {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return parseEbaySoldDocument(doc, marketCurrency);
    }
    return parseEbaySoldHtmlString(html, marketCurrency);
  }

  function quantile(sorted, q) {
    if (!sorted.length) {
      return null;
    }
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return round2(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
    }
    return round2(sorted[base]);
  }

  /**
   * Compute cleaned sold-price statistics (IQR outlier trimming, P25 / Median / P75 / Mean).
   */
  function analyzeSoldComps(rawItems, options) {
    const opts = options || {};
    const targetCurrency = String(opts.targetCurrency || 'GBP').toUpperCase();
    const marketCurrency = String(opts.marketCurrency || targetCurrency).toUpperCase();
    const fxRates = opts.fxRates || FALLBACK_FX_RATES;

    const converted = [];
    for (const entry of rawItems || []) {
      const rawPrice = typeof entry === 'number' ? entry : entry && entry.price;
      const itemCurr =
        typeof entry === 'object' && entry && entry.currency
          ? entry.currency
          : marketCurrency;
      if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
        continue;
      }
      const inTarget = convertCurrency(rawPrice, itemCurr, targetCurrency, fxRates);
      const inMarket = convertCurrency(rawPrice, itemCurr, marketCurrency, fxRates);
      if (inTarget !== null && inTarget > 0) {
        converted.push({ inTarget, inMarket });
      }
    }

    const rawCount = converted.length;
    if (rawCount === 0) {
      return {
        count: 0,
        rawCount: 0,
        currency: targetCurrency,
        marketCurrency,
        min: null,
        p25: null,
        median: null,
        p75: null,
        max: null,
        mean: null,
        marketMedian: null,
        confidence: 'none'
      };
    }

    converted.sort((a, b) => a.inTarget - b.inTarget);
    let filtered = converted;

    // Trim extreme outliers via IQR when sample size >= 5
    if (converted.length >= 5) {
      const values = converted.map((x) => x.inTarget);
      const q1 = quantile(values, 0.25);
      const q3 = quantile(values, 0.75);
      const iqr = q3 - q1;
      if (iqr > 0) {
        const lowerFence = Math.max(0.01, q1 - 1.5 * iqr);
        const upperFence = q3 + 1.5 * iqr;
        const trimmed = converted.filter(
          (x) => x.inTarget >= lowerFence && x.inTarget <= upperFence
        );
        if (trimmed.length >= 3) {
          filtered = trimmed;
        }
      }
    }

    const vals = filtered.map((x) => x.inTarget);
    const marketVals = filtered.map((x) => x.inMarket).sort((a, b) => a - b);
    const sum = vals.reduce((acc, v) => acc + v, 0);
    const count = vals.length;
    const confidence = count >= 8 ? 'high' : count >= 3 ? 'medium' : 'low';

    return {
      count,
      rawCount,
      currency: targetCurrency,
      marketCurrency,
      min: round2(vals[0]),
      p25: quantile(vals, 0.25),
      median: quantile(vals, 0.5),
      p75: quantile(vals, 0.75),
      max: round2(vals[count - 1]),
      mean: round2(sum / count),
      marketMedian: quantile(marketVals, 0.5),
      confidence
    };
  }

  /**
   * Evaluate whether the product is profitable to flip.
   */
  function evaluateFlipVerdict(calcResult, compsSummary, currencyCode, fxRates) {
    const curr = String(currencyCode || (calcResult && calcResult.currency) || 'GBP').toUpperCase();
    if (!calcResult || !calcResult.hasResaleInput || calcResult.netProfit === null) {
      return {
        code: 'no_target',
        tone: 'neutral',
        label: 'Awaiting Price',
        reason: 'Enter Target Resale or wait for Sold Comps'
      };
    }

    const profit = calcResult.netProfit;
    const roi = calcResult.roiPct !== null ? calcResult.roiPct : 0;
    const profitUsd = convertCurrency(profit, curr, 'USD', fxRates);
    const gap =
      calcResult.breakEvenPrice !== null && calcResult.resalePrice !== null
        ? round2(calcResult.breakEvenPrice - calcResult.resalePrice)
        : 0;

    const lowSampleNote =
      compsSummary && compsSummary.count > 0 && compsSummary.count < 3
        ? ` (${compsSummary.count} comp${compsSummary.count === 1 ? '' : 's'} — verify)`
        : '';

    if (profit <= 0) {
      return {
        code: 'loss',
        tone: 'negative',
        label: 'LOSS — SKIP',
        reason: `${formatMoney(Math.abs(gap), curr, false)} below break-even${lowSampleNote}`
      };
    }

    if (roi >= 20 && profitUsd >= 5) {
      return {
        code: 'good_flip',
        tone: 'positive',
        label: 'GOOD FLIP',
        reason: `Strong profit & +${roi.toFixed(1)}% ROI${lowSampleNote}`
      };
    }

    return {
      code: 'thin_margin',
      tone: 'warning',
      label: 'THIN MARGIN',
      reason: `Small net profit (${roi.toFixed(1)}% ROI) — check fees${lowSampleNote}`
    };
  }

  const api = {
    CURRENCIES,
    FALLBACK_FX_RATES,
    EBAY_MARKETS,
    PLATFORMS,
    detectSiteFromHost,
    getCurrencySymbol,
    convertCurrency,
    parseLocalizedNumber,
    isFreeShippingText,
    parsePriceWithCurrency,
    parsePrice,
    calculateFlip,
    cleanTitleForSearch,
    buildEbaySoldCompsUrl,
    formatMoney,
    formatGBP,
    isBotChallengeHtml,
    parseEbaySoldDocument,
    parseEbaySoldHtmlString,
    parseEbaySoldHtml,
    analyzeSoldComps,
    evaluateFlipVerdict
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.UKFlipCalcCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
