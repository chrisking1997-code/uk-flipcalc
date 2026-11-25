# UK FlipCalc (v2.0 Global) — Chrome Extension (Manifest V3)

A lightweight Chrome Extension that injects a sleek dark-mode floating **profit, ROI, break-even & automatic Sold Comps valuation widget** onto product pages across **global eBay sites** (UK, US, DE, AU, FR, CA, IT) and **Vinted UK**.

## What's New in v2.0

- **Automatic eBay Sold Comps Valuation**:
  - Automatically fetches recent **Sold & Completed** listings in the background via `background.js` (with 20-minute caching and smart broader-query fallback if exact title matches < 2 items).
  - Filters extreme outliers using IQR trimming and displays clickable **Low (P25)**, **Median (P50)**, and **High (P75)** market prices.
  - Auto-fills **Target Resale** with the market median so you get an instant valuation without typing manually.
- **Instant Buy / Skip Verdict**:
  - **`✓ GOOD FLIP`** (green): strong profit and ≥ 20% ROI
  - **`⚠ THIN MARGIN`** (amber): profitable, but low margin or ROI
  - **`✕ LOSS — SKIP`** (red): market value is below break-even (shows exact shortfall)
- **Multi-Country eBay Support + Live FX Conversion**:
  - Activates automatically on **eBay UK** (`ebay.co.uk`), **eBay US** (`ebay.com`), **eBay DE** (`ebay.de`), **eBay AU** (`ebay.com.au`), **eBay FR** (`ebay.fr`), **eBay CA** (`ebay.ca`), **eBay IT** (`ebay.it`), and **Vinted UK** (`vinted.co.uk`).
  - Switch the **Comps Market** dropdown to compare resale prices across any supported country — live exchange rates (cached for 6 hours with offline fallbacks) automatically convert cross-border comps into the listing's currency.
  - Parses localized prices and free shipping across GBP (`£`), USD (`$`), EUR (`€` with comma decimals like `29,99 €`), AUD (`A$`), and CAD (`C$`).

## Project Structure

```text
uk-flipcalc/
├── manifest.json           # Chrome Extension Manifest V3 configuration
├── background.js           # Service worker for Sold Comps & live FX fetches (with caching)
├── calculator.js           # Pure math, multi-currency parsing, FX, comps stats & verdict engine
├── content.js              # Global eBay & Vinted extractors + Shadow DOM widget
├── styles.css              # Dark-mode styles injected exclusively into Shadow DOM
├── icons/
│   ├── icon.svg
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── tests/
    └── calculator.test.js  # Node unit tests for v2.0 logic
```

## How to Install / Update in Chrome or Edge (Load Unpacked)

1. Pull the latest code (`git pull`) or download the ZIP from GitHub and extract it.
2. Open Chrome and navigate to `chrome://extensions` (or `edge://extensions` in Edge).
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `uk-flipcalc` folder (containing `manifest.json`), or click the **Reload (↻)** icon on the existing UK FlipCalc card if already installed.
5. Visit any product listing on `ebay.co.uk/itm/...`, `ebay.com/itm/...`, `ebay.de/itm/...`, `ebay.com.au/itm/...`, `ebay.fr/itm/...`, `ebay.ca/itm/...`, `ebay.it/itm/...`, or `vinted.co.uk/items/...`.

## Running Local Tests

```bash
node --test tests/calculator.test.js
```

## Calculation Formulas

- **Base Cost**: `Buy Price + Inbound Post/Fee + Outbound Postage`
- **Platform Fee**: `Target Resale × (Fee % / 100) + Fixed Fee` (auto-converted if fee currency differs)
- **Total Cost**: `Base Cost + Platform Fee`
- **Estimated Net Profit**: `Target Resale − Total Cost`
- **ROI (%)**: `(Estimated Net Profit / Total Cost) × 100`
- **Break-Even Resale Price**: `(Base Cost + Fixed Fee) / (1 − Fee Rate)`
