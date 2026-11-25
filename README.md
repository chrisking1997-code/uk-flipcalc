# UK FlipCalc — Chrome Extension (Manifest V3)

A clean, lightweight Chrome Extension that injects a sleek dark-mode floating **profit, ROI, and break-even calculator** onto product pages on **eBay UK** (`ebay.co.uk/itm/*`) and **Vinted UK** (`vinted.co.uk/items/*`).

## Features

- **Automatic Page Activation**: Runs automatically on `https://www.ebay.co.uk/itm/*` and `https://www.vinted.co.uk/items/*` with zero extra browser permissions.
- **Smart Auto-Extraction + Manual Override**:
  - **eBay UK**: Parses Item Title (`h1.x-item-title__mainTitle`), Item Price (`.x-price-primary` + JSON-LD/meta fallbacks), and Postage (`.ux-labels-values--shipping` / free postage detection).
  - **Vinted UK**: Parses Item Title (`[data-testid="item-page-summary-plugin"] h1`), Item Price (`[data-testid="item-price"]`), Buyer Protection fee (`[data-testid="total-combined-price"] - item-price`), and Shipping (`[data-testid="item-shipping-banner-price"]`).
  - Every extracted field can be edited manually at any time, and a **Re-sync (↻)** button re-reads the page DOM on demand.
- **Shadow DOM Floating Widget**:
  - Fixed in the bottom-right corner inside an isolated Shadow DOM (`:host { all: initial }`) so its styles never clash with eBay or Vinted CSS.
  - Minimises to a compact pill (with live profit badge) and remembers your collapsed/expanded state.
- **Live Profit, ROI & Break-Even Calculations** (updates on every keystroke):
  - **Resale Platforms**:
    - `eBay UK Private (0% fee)`
    - `eBay UK Business (12.8% + £0.30)`
    - `Vinted UK (0% seller fee)`
    - `Custom %` (reveals an editable percentage fee input)
  - **Outputs**: Total Cost (£), Estimated Net Profit (£ — green when profitable, red when negative), ROI (%), and Break-Even Resale Price (£).
- **1-Click "Check eBay Sold Comps"**:
  - Strips common UK listing filler words (`BNWT`, `RARE`, `FREE POST`, `UK SELLER`, `VGC`, etc.) and opens a new tab to eBay UK **Sold & Completed** listings (`LH_Sold=1&LH_Complete=1&_sop=13`).

## Project Structure

```text
uk-flipcalc/
├── manifest.json       # Chrome Extension Manifest V3 configuration
├── calculator.js       # Pure calculation, GBP parsing, and title-cleaning logic
├── content.js          # eBay UK / Vinted UK DOM extractors & Shadow DOM widget
├── styles.css          # Dark-mode styles injected exclusively into Shadow DOM
├── icons/
│   ├── icon.svg        # Vector source icon
│   ├── icon16.png      # Manifest V3 toolbar/extension icon (16×16)
│   ├── icon48.png      # Extensions page icon (48×48)
│   └── icon128.png     # Store/details icon (128×128)
└── tests/
    ├── calculator.test.js  # Node unit tests for formulas, parsing & title cleanup
    └── ui.test.py          # Playwright E2E tests (Shadow DOM isolation & live UI)
```

## How to Install in Chrome (Load Unpacked)

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** ON in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `uk-flipcalc` folder (the directory containing `manifest.json`).
5. Visit any product listing on `https://www.ebay.co.uk/itm/...` or `https://www.vinted.co.uk/items/...` — the **UK FlipCalc** widget will appear automatically in the bottom-right corner.

## Running Local Tests

```bash
# 1. Unit tests for calculations, currency parsing, and title cleaning
node --test tests/calculator.test.js

# 2. Playwright browser tests (Shadow DOM CSS isolation, eBay & Vinted extraction, live UI, zero console errors)
python3 tests/ui.test.py
```

## Calculation Formulas

- **Base Cost**: `Buy Price + Inbound Post/Fee + Outbound Postage`
- **Platform Fee**: `Target Resale × (Fee % / 100) + Fixed Fee`
- **Total Cost**: `Base Cost + Platform Fee`
- **Estimated Net Profit**: `Target Resale − Total Cost`
- **ROI (%)**: `(Estimated Net Profit / Total Cost) × 100`
- **Break-Even Resale Price**: `(Base Cost + Fixed Fee) / (1 − Fee Rate)`
