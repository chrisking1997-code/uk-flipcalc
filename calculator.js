/**
 * UK FlipCalc - Pure calculation, price parsing, and title cleaning utilities.
 * Loaded before content.js in the Chrome Extension and exportable for Node unit tests.
 */
(function (root) {
  'use strict';

  const PLATFORMS = {
    ebay_private: {
      id: 'ebay_private',
      label: 'eBay UK Private (0% fee)',
      pctFee: 0,
      fixedFee: 0
    },
    ebay_business: {
      id: 'ebay_business',
      label: 'eBay UK Business (12.8% + £0.30)',
      pctFee: 12.8,
      fixedFee: 0.30
    },
    vinted_uk: {
      id: 'vinted_uk',
      label: 'Vinted UK (0% seller fee)',
      pctFee: 0,
      fixedFee: 0
    },
    custom: {
      id: 'custom',
      label: 'Custom %',
      pctFee: 10,
      fixedFee: 0
    }
  };

  // Common UK eBay / Vinted listing filler & hype words stripped before sold-comps lookup.
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
    'unwanted gift'
  ];

  const FILLER_WORDS = new Set([
    'bnwt', 'bnwot', 'nwt', 'nwot', 'bnib', 'nib', 'bn', 'vgc', 'euc', 'guc',
    'new', 'mint', 'excellent', 'great', 'good', 'perfect', 'immaculate',
    'superb', 'amazing', 'lovely', 'gorgeous', 'stunning', 'nice', 'clean',
    'condition', 'bargain', 'cheap', 'rare', 'wow', 'look', 'l@@k', 'read',
    'description', 'fast', 'free', 'post', 'postage', 'p&p', 'pp', 'delivery',
    'dispatch', 'despatch', 'shipping', 'uk', 'seller', 'stock', 'genuine',
    'authentic', 'official', 'original', 'rrp', 'sale', 'reduced', 'clearance',
    'gift', 'present', 'xmas', 'christmas', 'please', 'see', 'pics', 'photos',
    'pictures', 'tested', 'working', 'sealed', 'boxed', 'unopened', 'unused',
    'unwanted', 'preloved', 'pre-loved', 'used', 'worn', 'hardly', 'barely',
    'freebie', 'offer', 'offers', 'quick', 'send', 'tracked', 'royal', 'mail',
    'evri', 'yodel', 'inpost', 'hermes', 'parcel', 'postpaid'
  ]);

  /**
   * Parse a GBP currency string (e.g. "£14.99", "GBP 24.50", "from £2.99", "Free postage")
   * into a non-negative number, or null if not parseable.
   */
  function parsePrice(raw) {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw >= 0 ? round2(raw) : null;
    }
    if (!raw || typeof raw !== 'string') {
      return null;
    }

    const text = raw.replace(/\u00a0/g, ' ').trim();
    if (!text) {
      return null;
    }

    if (/\bfree\b/i.test(text) && !/£\s*\d/.test(text)) {
      return 0;
    }

    // Prefer an explicit £ or GBP figure first to avoid grabbing unrelated numbers (e.g. "2nd class").
    const gbpMatch = text.match(/(?:£|GBP)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i);
    if (gbpMatch) {
      const val = parseFloat(gbpMatch[1].replace(/,/g, ''));
      return Number.isFinite(val) && val >= 0 ? round2(val) : null;
    }

    // Fallback: plain decimal number (e.g. from meta/JSON-LD or manual numeric string).
    const plainMatch = text.match(/^\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*$/);
    if (plainMatch) {
      const val = parseFloat(plainMatch[1].replace(/,/g, ''));
      return Number.isFinite(val) && val >= 0 ? round2(val) : null;
    }

    return null;
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

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Compute flip profit, fees, total cost, ROI %, and break-even resale price.
   *
   * @param {Object} params
   * @param {number|string} params.buyPrice - Item buy price (£)
   * @param {number|string} params.inboundShipping - Inbound postage / buyer protection fee (£)
   * @param {number|string} params.resalePrice - Target resale price (£), empty/0 means not yet entered
   * @param {number|string} params.outboundShipping - Estimated outbound postage / packaging (£)
   * @param {string} params.platform - One of PLATFORMS keys
   * @param {number|string} [params.customFeePct] - Custom fee % when platform === 'custom'
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

    const platformCfg = PLATFORMS[params.platform] || PLATFORMS.ebay_private;
    const pctFee =
      platformCfg.id === 'custom'
        ? Math.min(100, toNonNegativeNumber(params.customFeePct))
        : platformCfg.pctFee;
    const fixedFee = platformCfg.fixedFee;
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
   * Clean an item title into a focused keyword query for eBay UK Sold & Completed comps.
   */
  function cleanTitleForSearch(rawTitle) {
    if (!rawTitle || typeof rawTitle !== 'string') {
      return '';
    }

    // Remove bracketed promotional tags like [NEW], (READ), *RARE*
    let cleaned = rawTitle
      .replace(/[\[\(][^\]\)]{1,28}[\]\)]/g, ' ')
      .replace(/[|•·★☆✓✔🔥💥✨⚡❤️👍!?,:;~*=+"]/g, ' ')
      .replace(/(?:\s+[-–—]+|[-–—]+\s+|[/\\]+)/g, ' ');

    // Remove multi-word filler phrases
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
      // Drop isolated non-alphanumeric or single stray punctuation
      if (!/[a-z0-9]/i.test(token)) {
        continue;
      }
      // Drop prices embedded in titles like "£50"
      if (/^£\d/.test(token)) {
        continue;
      }
      if (seen.has(lower)) {
        continue;
      }
      seen.add(lower);
      filtered.push(token);
      if (filtered.length >= 9) {
        break;
      }
    }

    if (filtered.length > 0) {
      return filtered.join(' ');
    }

    // Fallback: if all words were filler, keep basic alphanumeric tokens from original title
    return rawTitle
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 8)
      .join(' ');
  }

  /**
   * Build the eBay UK Sold & Completed listings URL.
   */
  function buildEbaySoldCompsUrl(rawTitle) {
    const query = cleanTitleForSearch(rawTitle);
    const params = new URLSearchParams({
      _nkw: query,
      LH_Sold: '1',
      LH_Complete: '1',
      _sop: '13'
    });
    return `https://www.ebay.co.uk/sch/i.html?${params.toString()}`;
  }

  function formatGBP(amount, showPlus) {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
      return '—';
    }
    const sign = amount < 0 ? '-' : showPlus && amount > 0 ? '+' : '';
    return `${sign}£${Math.abs(amount).toFixed(2)}`;
  }

  const api = {
    PLATFORMS,
    parsePrice,
    calculateFlip,
    cleanTitleForSearch,
    buildEbaySoldCompsUrl,
    formatGBP
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.UKFlipCalcCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
