# Property Deal Analyzer

A calculator for screening buy-to-let and BRRR deals in Northern Ireland, Ireland and Great Britain. Enter a postcode and a purchase price and it works out:

- **Purchase costs**: Stamp Duty (NI / England, with the investor surcharge), Irish stamp duty, Wales LTT, Scotland LBTT, plus legal, survey, broker, lender and sourcing fees. Ireland is shown in euro.
- **Refurb**: budget from a cosmetic / medium / full level and floor area, contingency, holding costs and finance interest during the works
- **Add bedrooms**: add one or more bedrooms in the refurb (convert a reception room, split a room, box/attic room, loft conversion, extension, or a custom cost). The cost and extra months go into the refurb. Rents, HMO and lodger room counts, and the suggested end value then use the bedroom count after works. A payoff box compares the value and rent uplift (from your sold and rent evidence) with the cost, and shows the payback time
- **Income after refurb**: pick a strategy from the dropdown and the headline numbers follow it, with a table comparing all four:
  - **Full let**: one tenancy; rent less management and voids
  - **Lodgers**: you live in and let spare rooms; how much of the mortgage they cover and the Rent a Room allowance (£7,500 UK, €14,000 Ireland)
  - **HMO**: rooms let separately with bills included; management, voids, bills, HMO licence and cleaning
  - **Serviced accommodation**: nightly rate × occupancy; booking platform fees, cleaning per stay, bills, supplies and licence
  - Maintenance, insurance, service charge and certificates apply to every strategy
- **Yield**: gross yield on purchase price, all-in cost and end value, plus net yield
- **ROI**: annual cashflow ÷ money left in the deal
- **Money left in after refinance**: new mortgage on the end value, minus the purchase loan and refinance costs, plus a lender ICR stress test

## Rents

Rent figures come from three places, best first:

1. **Your listings.** The *Rent evidence* panel has search links for PropertyPal, PropertyNews, Daft, Rightmove, Zoopla, MyHome, Rent.ie and SpareRoom, filtered to the area and bedrooms. Copy a results page or a single listing and paste it in. The app picks out each rent (pcm or per week), bedrooms, property type, address, date and "let agreed", and you tick the ones to keep. Each rent is saved against its **postcode district** (BT12, BT7, M14) or, in Ireland, Eircode routing key (D06, W91), read from the address and editable before you add it. When you analyse a property, only rents from **its own district** count: once that district has **3 or more rents for the same bedroom count from the last 12 months**, the median becomes the full-let rent. A *Rents by area* table compares districts side by side. Tick *Include nearby districts* to borrow rents from neighbouring districts when yours has too few; whole lets and rooms widen separately. Room listings set the lodger room rent the same way. Saved rents stay in your browser; use Export / Import CSV to back them up or move them between devices.
2. **Official figures**, applied automatically by **Analyse area**:
   - **Ireland**: the RTB Rent Index (rents agreed on new tenancies, CSO table RIA02) for the town or area, by bedrooms and property type, for the latest year. Enter an Eircode or town; the matching RTB area is filled in and you can change it.
   - **Northern Ireland**: NI Housing Executive average rent (Jan–Jun 2025), Belfast £1,130 or rest of NI £850, adjusted for bedrooms and type.
   - **Great Britain**: PropertyData live asking rents if you add an API key, otherwise regional averages scaled to local sold prices.
3. **Rough guides** for room rents in NI and Ireland until you add room listings.

The app doesn't fetch listing sites itself. PropertyPal, Daft and Rightmove don't offer public APIs, their terms don't allow automated scraping, and they block it. The search link plus paste step takes a minute per area and keeps you within their terms.

## Property news

The rents panel shows recent property headlines (rents, landlords, house prices, housing policy) for Northern Ireland, Ireland and UK landlords. It opens on your country's tab, and stories that mention your area, such as Belfast or Naas, are tagged and shown first. Headlines come from Google News searches over the last 2 weeks. Online, the deploy workflow refreshes them every 3 hours (`scripts/news.js` writes `news.json`). Locally, `server.js` fetches them live, at most once an hour.

## Sold evidence

The *Sold evidence* panel works like the rents panel, for sale prices. Search links open sold results on PropertyPal, PropertyNews, Rightmove and Zoopla, or on the Property Price Register, Daft and MyHome for Ireland. Paste a sold results page, a single listing or rows from the Property Price Register. The app picks out the price, bedrooms, type, address, postcode district, sale date and whether it's sold or sale agreed, and you tick the ones to keep.

Sales are grouped by postcode district, like rents. For the property you're analysing, the app looks at your sales from the last 2 years in that district and uses the narrowest group with 3 or more sales: same bedrooms and type, then same bedrooms, then same type. From that group it:

- suggests the **end value after refurb** (upper quartile: a refurbished home should sell near the top of the local range)
- shows how far your **purchase price** is above or below the median
- fills a **Sold prices by area** table comparing districts

You can tick *Include nearby districts* when your district has too few sales. Your own sold evidence takes priority over Land Registry figures. Export / Import CSV backs it up.

## Sold prices (Land Registry)

In England and Wales, **Analyse area** pulls nearby sales from [HM Land Registry Price Paid Data](https://landregistry.data.gov.uk/) via [postcodes.io](https://postcodes.io). It shows quartiles by property type, recent comparables and how your price compares to the median, and suggests an end value (upper quartile of the same type). Land Registry doesn't record bedrooms.

Northern Ireland doesn't publish individual sale prices. Ireland's Property Price Register isn't wired in yet. For both, set the end value from recent sales you find on PropertyPal or Daft.

## Using it online

The app deploys to GitHub Pages on every push (`.github/workflows/pages.yml`):
https://conorlaff2004-dotcom.github.io/Deal-analyzer-/

On a phone, open it and choose **Add to Home Screen** to use it like an app. Online there's no proxy server, so if a browser blocks one of the data services, that lookup shows an error and you can still enter the figure by hand.

## Running it locally

```bash
npm start        # http://localhost:8080
```

`server.js` has no dependencies (Node 18+). It serves the app and proxies the data APIs (postcodes.io, Land Registry, CSO, PropertyData), so area lookups work even if a browser blocks the cross-site requests. You can also open `index.html` directly. The calculator works without a server, but some browsers may block the area lookups.

```bash
npm test         # unit tests for the tax, deal maths and listing parser
```

## Files

- `index.html`, `styles.css`: the calculator
- `js/calc.js`: the deal maths (pure functions, tested)
- `js/data.js`: postcode, sold price, RTB and NI rent lookups and estimates
- `js/comps.js`: reads rents from pasted listings and summarises them (tested)
- `js/app.js`: wires the form to the maths and renders results
- `server.js`: static server and API proxy

Tax bands are for completions from 1 April 2025. Figures are for screening deals, not financial advice.
