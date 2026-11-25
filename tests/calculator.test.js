'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../calculator.js');

test('detectSiteFromHost identifies global eBay sites and Vinted UK', () => {
  assert.deepEqual(core.detectSiteFromHost('www.ebay.co.uk'), {
    site: 'ebay',
    marketId: 'ebay_uk',
    siteLabel: 'eBay UK',
    currency: 'GBP'
  });
  assert.deepEqual(core.detectSiteFromHost('www.ebay.com'), {
    site: 'ebay',
    marketId: 'ebay_us',
    siteLabel: 'eBay US',
    currency: 'USD'
  });
  assert.deepEqual(core.detectSiteFromHost('www.ebay.de'), {
    site: 'ebay',
    marketId: 'ebay_de',
    siteLabel: 'eBay DE',
    currency: 'EUR'
  });
  assert.deepEqual(core.detectSiteFromHost('www.ebay.com.au'), {
    site: 'ebay',
    marketId: 'ebay_au',
    siteLabel: 'eBay AU',
    currency: 'AUD'
  });
  assert.deepEqual(core.detectSiteFromHost('www.vinted.co.uk'), {
    site: 'vinted',
    marketId: 'ebay_uk',
    siteLabel: 'Vinted UK',
    currency: 'GBP'
  });
  assert.equal(core.detectSiteFromHost('www.example.com'), null);
});

test('parsePriceWithCurrency parses GBP, USD, EUR (comma decimal), AUD, CAD, and localized Free text', () => {
  assert.deepEqual(core.parsePriceWithCurrency('£33.97', 'GBP'), { amount: 33.97, currency: 'GBP' });
  assert.deepEqual(core.parsePriceWithCurrency('US $49.95', 'GBP'), { amount: 49.95, currency: 'USD' });
  assert.deepEqual(core.parsePriceWithCurrency('AU $65.00', 'AUD'), { amount: 65, currency: 'AUD' });
  assert.deepEqual(core.parsePriceWithCurrency('C $39.99', 'CAD'), { amount: 39.99, currency: 'CAD' });
  assert.deepEqual(core.parsePriceWithCurrency('EUR 29,99', 'EUR'), { amount: 29.99, currency: 'EUR' });
  assert.deepEqual(core.parsePriceWithCurrency('1.249,50 €', 'EUR'), { amount: 1249.5, currency: 'EUR' });
  assert.deepEqual(core.parsePriceWithCurrency('Free postage', 'GBP'), { amount: 0, currency: 'GBP' });
  assert.deepEqual(core.parsePriceWithCurrency('Kostenloser Versand', 'EUR'), { amount: 0, currency: 'EUR' });
  assert.deepEqual(core.parsePriceWithCurrency('Livraison gratuite', 'EUR'), { amount: 0, currency: 'EUR' });
  assert.equal(core.parsePrice('£14.99'), 14.99);
});

test('convertCurrency converts cleanly using provided FX rates', () => {
  const rates = { USD: 1, GBP: 0.8, EUR: 0.9, AUD: 1.5 };
  assert.equal(core.convertCurrency(100, 'USD', 'GBP', rates), 80);
  assert.equal(core.convertCurrency(80, 'GBP', 'USD', rates), 100);
  assert.equal(core.convertCurrency(90, 'EUR', 'GBP', rates), 80);
  assert.equal(core.convertCurrency(50, 'GBP', 'GBP', rates), 50);
});

test('calculateFlip handles UK, US, and cross-currency fixed fee accurately', () => {
  const ukLoss = core.calculateFlip({
    buyPrice: 33.97,
    inboundShipping: 20.25,
    outboundShipping: 3.5,
    resalePrice: 40,
    platform: 'ebay_private',
    currency: 'GBP'
  });
  assert.equal(ukLoss.totalCost, 57.72);
  assert.equal(ukLoss.breakEvenPrice, 57.72);
  assert.equal(ukLoss.netProfit, -17.72);

  const usProfit = core.calculateFlip({
    buyPrice: 20,
    inboundShipping: 0,
    outboundShipping: 5,
    resalePrice: 60,
    platform: 'ebay_us_standard',
    currency: 'USD'
  });
  // Fee = 60 * 0.1325 + 0.30 = 8.25; Total Cost = 25 + 8.25 = 33.25; Net Profit = 26.75
  assert.equal(usProfit.platformFee, 8.25);
  assert.equal(usProfit.totalCost, 33.25);
  assert.equal(usProfit.netProfit, 26.75);
});

test('cleanTitleForSearch and buildEbaySoldCompsUrl support multiple markets and word limits', () => {
  const title = 'BNWT Run-D.M.C King Of Rock LP Album vinyl record 180gram remastered 2013 black RARE UK SELLER';
  const full = core.cleanTitleForSearch(title, 8);
  const short = core.cleanTitleForSearch(title, 4);
  assert.equal(full, 'Run-D.M.C King Of Rock LP Album vinyl record');
  assert.equal(short, 'Run-D.M.C King Of Rock');

  const usUrl = core.buildEbaySoldCompsUrl(title, 'ebay_us');
  assert.match(usUrl, /^https:\/\/www\.ebay\.com\/sch\/i\.html\?/);
  assert.match(usUrl, /LH_Sold=1/);
  assert.match(usUrl, /LH_Complete=1/);

  const deUrl = core.buildEbaySoldCompsUrl('Nike Air Max 90 NEU OVP Gratis Versand', 'ebay_de');
  assert.match(deUrl, /^https:\/\/www\.ebay\.de\/sch\/i\.html\?/);
  assert.match(deUrl, /_nkw=Nike\+Air\+Max\+90/);
});

test('parseEbaySoldHtmlString extracts classic .s-item and new .s-card sold prices, skips placeholders and ranges', () => {
  const sampleHtml = `
    <html><body><ul class="srp-results">
      <li class="s-item"><div class="s-item__title">Shop on eBay</div><span class="s-item__price">£20.00</span></li>
      <li class="s-item"><div class="s-item__title"><span>Run-DMC King Of Rock LP</span></div><span class="s-item__price">£28.50</span></li>
      <li class="s-item"><div class="s-item__title"><span>Run-DMC King Of Rock Vinyl Range</span></div><span class="s-item__price">£15.00 to £45.00</span></li>
      <li class="s-card"><div class="s-card__title">Run-DMC King Of Rock 180g</div><span class="s-card__price">£31.00</span></li>
      <li class="s-card"><div class="s-card__title">Neues Angebot Run-DMC LP</div><span class="s-card__price">EUR 34,50</span></li>
    </ul></body></html>
  `;
  const parsed = core.parseEbaySoldHtmlString(sampleHtml, 'GBP');
  assert.equal(parsed.blocked, false);
  assert.equal(parsed.items.length, 3);
  assert.deepEqual(parsed.items[0], { title: 'Run-DMC King Of Rock LP', price: 28.5, currency: 'GBP' });
  assert.deepEqual(parsed.items[1], { title: 'Run-DMC King Of Rock 180g', price: 31, currency: 'GBP' });
  assert.deepEqual(parsed.items[2], { title: 'Run-DMC LP', price: 34.5, currency: 'EUR' });

  const blocked = core.parseEbaySoldHtmlString('<html><title>Pardon Our Interruption...</title></html>', 'GBP');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.items.length, 0);
});

test('analyzeSoldComps trims extreme outliers and converts cross-currency comps', () => {
  const rates = { USD: 1, GBP: 0.8 };
  const items = [
    { price: 1, currency: 'USD' },    // extreme low outlier
    { price: 40, currency: 'USD' },
    { price: 45, currency: 'USD' },
    { price: 50, currency: 'USD' },
    { price: 52, currency: 'USD' },
    { price: 55, currency: 'USD' },
    { price: 500, currency: 'USD' }   // extreme high outlier
  ];
  const summary = core.analyzeSoldComps(items, {
    targetCurrency: 'GBP',
    marketCurrency: 'USD',
    fxRates: rates
  });
  assert.equal(summary.rawCount, 7);
  assert.equal(summary.count, 5);
  assert.equal(summary.median, 40); // $50 * 0.8 = £40
  assert.equal(summary.marketMedian, 50);
  assert.equal(summary.p25, 36);    // $45 * 0.8 = £36
  assert.equal(summary.p75, 41.6);  // $52 * 0.8 = £41.60
  assert.equal(summary.confidence, 'medium');
});

test('evaluateFlipVerdict classifies GOOD FLIP, THIN MARGIN, and LOSS correctly', () => {
  const goodCalc = core.calculateFlip({
    buyPrice: 20,
    inboundShipping: 0,
    outboundShipping: 3.5,
    resalePrice: 45,
    platform: 'ebay_private',
    currency: 'GBP'
  });
  const goodVerdict = core.evaluateFlipVerdict(goodCalc, { count: 10 }, 'GBP');
  assert.equal(goodVerdict.code, 'good_flip');
  assert.equal(goodVerdict.tone, 'positive');

  const thinCalc = core.calculateFlip({
    buyPrice: 40,
    inboundShipping: 0,
    outboundShipping: 3.5,
    resalePrice: 46,
    platform: 'ebay_private',
    currency: 'GBP'
  });
  const thinVerdict = core.evaluateFlipVerdict(thinCalc, { count: 6 }, 'GBP');
  assert.equal(thinVerdict.code, 'thin_margin');
  assert.equal(thinVerdict.tone, 'warning');

  const lossCalc = core.calculateFlip({
    buyPrice: 33.97,
    inboundShipping: 20.25,
    outboundShipping: 3.5,
    resalePrice: 32,
    platform: 'ebay_private',
    currency: 'GBP'
  });
  const lossVerdict = core.evaluateFlipVerdict(lossCalc, { count: 12 }, 'GBP');
  assert.equal(lossVerdict.code, 'loss');
  assert.equal(lossVerdict.tone, 'negative');
  assert.match(lossVerdict.reason, /£25\.72 below break-even/);
});
