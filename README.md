# UK FlipCalc (v2.3 Global) — Chrome Extension (Manifest V3)

A lightweight Chrome Extension that injects a dark-mode floating **profit, ROI, break-even, max-offer & automatic market comps widget** onto product pages across **global eBay sites** (UK, US, DE, AU, FR, CA, IT) and **Vinted UK**.

## Key Features (v2.3.0)

- **Bidirectional Vinted UK + Global eBay Comps**:
  - **Vinted UK (Active)**: Queries Vinted UK catalog comps directly same-origin when browsing Vinted UK (instant automatic valuation, zero HTTP 403, automatically excludes the current listing ID) and supports eBay ↔ Vinted cross-checking via 1-click buttons & live tab sync.
  - **Global eBay (Sold & Completed)**: Supports eBay UK, US, DE, AU, FR, CA, and IT with automatic IQR outlier trimming, clickable **Low (P25)** / **Median** / **High (P75)** chips, live FX conversion, and live Sold-tab sync.
- **Anti-Mismatch Protection**:
  - Auto-enriches vague Vinted titles (e.g. `Callaway` → `Callaway Golf balls`) using Vinted's Brand & Category Breadcrumb.
  - Relevance filtering rejects unrelated product categories (e.g. golf clubs when searching golf balls).
  - Shows **Top-3 matched comp titles & prices** right inside the widget.
  - **`⚠ VERIFY COMPS`** risk guard downgrades false `GOOD FLIP` signals when queries are too broad or price spread is abnormally wide.
  - Clickable **Condition filter** (`Any / Used / New`) auto-detected from the listing.
- **Max Offer / Negotiation Target (`Max Offer`)**:
  - Reverse-calculates the maximum buy price you should offer to hit your target ROI (click the pill to cycle **20% / 25% / 30% / 50% ROI**), ideal for Vinted Make Offer and eBay Best Offer.
- **Persistent User Preferences**:
  - Automatically remembers your preferred **Comps Market**, **Resale Fee platform** (including Custom %), **Outbound Postage** (per currency), and **Target ROI %** across sessions.

## Installation / Update (Chrome or Edge)

1. Pull the latest code (`git pull`) or download the ZIP from GitHub and extract it.
2. Navigate to `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode**, click **Load unpacked** (select the `uk-flipcalc` folder containing `manifest.json`), or click **Reload (↻)** on the existing card and verify version **`2.3.0`**.
4. Refresh any open eBay or Vinted tab (`F5`).

## Running Local Tests

```bash
node --test tests/calculator.test.js
```

## Formulas

- **Base Cost**: `Buy Price + Inbound Post/Fee + Outbound Postage`
- **Platform Fee**: `Target Resale × (Fee % / 100) + Fixed Fee`
- **Total Cost**: `Base Cost + Platform Fee`
- **Net Profit**: `Target Resale − Total Cost`
- **ROI (%)**: `(Net Profit / Total Cost) × 100`
- **Break-Even Resale Price**: `(Base Cost + Fixed Fee) / (1 − Fee Rate)`
- **Max Offer (at target ROI $r$)**: `Target Resale / (1 + r) − Inbound − Outbound − Platform Fee`
