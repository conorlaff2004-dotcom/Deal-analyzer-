# Property Deal Analyzer

A calculator for screening UK buy-to-let and BRRR deals. Enter a postcode and a purchase price and it works out:

- **Purchase costs**: Stamp Duty (or Wales LTT / Scotland LBTT, with the investor surcharge), legal, survey, broker, lender and sourcing fees
- **Refurb**: budget from a cosmetic / medium / full level and floor area, contingency, holding costs and finance interest during the works
- **Full-let rent**: monthly cashflow after management, maintenance, voids, insurance, service charge and mortgage
- **Lodger rent**: income from letting spare rooms while you live there, how much of the mortgage it covers, and the Rent a Room £7,500 allowance
- **Yield**: gross yield on purchase price, all-in cost and end value, plus net yield
- **ROI**: annual cashflow ÷ money left in the deal
- **Money left in after refinance**: new mortgage on the end value, minus the purchase loan and refinance costs, plus a lender ICR stress test

## Area data

**Analyse area** looks at what's around the postcode:

| What | Source | Key needed |
|---|---|---|
| Postcode, region, nearby postcodes | [postcodes.io](https://postcodes.io) | No |
| Sold prices (by type: lower quartile, median, upper quartile, recent comparables) | [HM Land Registry Price Paid Data](https://landregistry.data.gov.uk/) | No |
| Asking rents (whole property and double rooms) | [PropertyData API](https://propertydata.co.uk/api) | Yes, optional |

From these it suggests:

- **End value after refurb**: the upper quartile of local sales of the same property type
- **Full-let rent** and **room rent**: live figures from PropertyData if you add a key; otherwise an estimate from regional averages (ONS / SpareRoom levels) adjusted by bedrooms, property type and how local sold prices compare with the regional median
- **Your price vs median**: how far your purchase price sits below or above local sales of the same type

Suggestions fill any field you haven't edited. Fields you've typed into are kept, and a **Use £…** link lets you switch to the area figure.

Land Registry covers England and Wales only and doesn't record bedrooms, so check listings for size. The rent estimate without a key is a starting point. Check it with local agents or Rightmove / SpareRoom before you offer.

## Running it

```bash
npm start        # http://localhost:8080
```

`server.js` has no dependencies (Node 18+). It serves the app and proxies the three data APIs, so area lookups work even if a browser blocks the cross-site requests. You can also open `index.html` directly. The calculator works without a server, but some browsers may block the area lookups.

```bash
npm test         # unit tests for the tax, mortgage and deal maths
```

## Files

- `index.html`, `styles.css`: the calculator
- `js/calc.js`: the deal maths (pure functions, tested)
- `js/data.js`: postcode, sold price and rent lookups and estimates
- `js/app.js`: wires the form to the maths and renders results
- `server.js`: static server and API proxy

Tax bands are for completions from 1 April 2025. Figures are for screening deals, not financial advice.
