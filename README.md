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

Rents come from **built-in let-agreed listings** for BT7 and BT12 (`js/rent-data.js`, made from `data/BT7_BT12_let_agreed_rents.xlsx`: 312 PropertyPal let-agreed listings, Jan–Oct 2026). The *Local rents* panel shows each area's average, lowest and highest rent by size (1–5 bed, 6+ bed, room in a shared house). Click a size to see its listings, with links.

For the property you're analysing, the deal uses the average for its district and its bedroom count after any added bedrooms. Room rents for lodgers and HMOs use the "room in shared house" average. The hint under each field shows how many listings the figure is based on and warns when there are fewer than 3.

Outside BT7 and BT12, or for a size with no listings, the app falls back to official figures: the NI Housing Executive average (Belfast £1,130, rest of NI £850, Jan–Jun 2025), the RTB Rent Index for Ireland, or PropertyData / regional estimates in Great Britain.

To update the rents, replace the spreadsheet and regenerate `js/rent-data.js` from it (one row per listing: address, rooms, rent, area, let-agreed date, type, link, note).

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

## Saving online across devices

Press **Not saved online** at the top of the app to connect a device. Your saved sold prices and current deal figures are stored in a private GitHub gist in your own account, using an access key with only the `gist` permission. On each device you paste the key once. After that, every change uploads a couple of seconds after you make it, and the app downloads the latest data each time you open it or switch back to it. Data from different devices is merged, so nothing added on one device is lost, and deleting a sale removes it everywhere. Your PropertyData API key and the GitHub key stay on each device.

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
- `js/comps.js`: reads pasted sold listings, summarises sales and the built-in rents (tested)
- `js/rent-data.js`: built-in let-agreed rents for BT7 and BT12
- `js/app.js`: wires the form to the maths and renders results
- `server.js`: static server and API proxy

Tax bands are for completions from 1 April 2025. Figures are for screening deals, not financial advice.
