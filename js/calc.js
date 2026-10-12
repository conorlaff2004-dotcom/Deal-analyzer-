/*
 * Deal maths. Pure functions only (no DOM, no network) so they can be unit
 * tested in Node and reused by the UI.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Property transaction taxes
  // ---------------------------------------------------------------------------

  // Bands are [upper limit, rate]. Rates current for completions from 1 April 2025.
  const SDLT_STANDARD = [[125000, 0], [250000, 0.02], [925000, 0.05], [1500000, 0.10], [Infinity, 0.12]];
  const SDLT_FTB = [[300000, 0], [500000, 0.05]]; // only available up to £500k
  const SDLT_SURCHARGE = 0.05; // additional dwellings / companies
  const SDLT_NON_RESIDENT = 0.02;

  const LTT_MAIN = [[225000, 0], [400000, 0.06], [750000, 0.075], [1500000, 0.10], [Infinity, 0.12]];
  const LTT_HIGHER = [[180000, 0.05], [250000, 0.085], [400000, 0.10], [750000, 0.125], [1500000, 0.15], [Infinity, 0.17]];

  const LBTT_MAIN = [[145000, 0], [250000, 0.02], [325000, 0.05], [750000, 0.10], [Infinity, 0.12]];
  const LBTT_FTB = [[175000, 0], [250000, 0.02], [325000, 0.05], [750000, 0.10], [Infinity, 0.12]];
  const LBTT_ADS = 0.08;

  const SURCHARGE_THRESHOLD = 40000;

  function bandedTax(price, bands, extraRate) {
    extraRate = extraRate || 0;
    let tax = 0;
    let lower = 0;
    const breakdown = [];
    for (const [upper, rate] of bands) {
      if (price <= lower) break;
      const slice = Math.min(price, upper) - lower;
      const r = rate + extraRate;
      tax += slice * r;
      breakdown.push({ from: lower, to: Math.min(price, upper), rate: r, tax: slice * r });
      lower = upper;
    }
    return { tax: Math.floor(tax), breakdown };
  }

  /**
   * buyerType: 'additional' (BTL / second home / company), 'ftb' (first-time buyer),
   * 'mover' (main residence, not first-time).
   * country: 'England' | 'Wales' | 'Scotland' | 'Northern Ireland'
   */
  function propertyTax(price, buyerType, country, nonResident) {
    price = Math.max(0, Number(price) || 0);
    const surcharge = buyerType === 'additional' && price >= SURCHARGE_THRESHOLD;

    if (country === 'Wales') {
      const r = bandedTax(price, surcharge ? LTT_HIGHER : LTT_MAIN);
      return { name: 'Land Transaction Tax (Wales)', ...r };
    }
    if (country === 'Scotland') {
      const r = bandedTax(price, buyerType === 'ftb' ? LBTT_FTB : LBTT_MAIN);
      if (surcharge) {
        const ads = Math.floor(price * LBTT_ADS);
        r.breakdown.push({ label: 'Additional Dwelling Supplement', rate: LBTT_ADS, tax: ads });
        r.tax += ads;
      }
      return { name: 'LBTT (Scotland)', ...r };
    }
    // England & Northern Ireland: SDLT
    let extra = surcharge ? SDLT_SURCHARGE : 0;
    if (nonResident) extra += SDLT_NON_RESIDENT;
    const bands = buyerType === 'ftb' && price <= 500000 ? SDLT_FTB : SDLT_STANDARD;
    return { name: 'Stamp Duty (SDLT)', ...bandedTax(price, bands, extra) };
  }

  // ---------------------------------------------------------------------------
  // Mortgage helpers
  // ---------------------------------------------------------------------------

  function monthlyPayment(loan, annualRatePct, termYears, interestOnly) {
    loan = Number(loan) || 0;
    const r = (Number(annualRatePct) || 0) / 100 / 12;
    if (loan <= 0) return 0;
    if (interestOnly) return loan * r;
    const n = Math.max(1, Math.round((Number(termYears) || 25) * 12));
    if (r === 0) return loan / n;
    return (loan * r) / (1 - Math.pow(1 + r, -n));
  }

  // ---------------------------------------------------------------------------
  // Full deal analysis
  // ---------------------------------------------------------------------------

  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  function analyseDeal(i) {
    const price = n(i.price);

    // --- Purchase ------------------------------------------------------------
    const tax = propertyTax(price, i.buyerType, i.country || 'England', !!i.nonResident);

    let purchaseLoan = 0;
    let lenderFee = 0;
    let bridgeExitFee = 0;
    let monthlyFinanceDuringWorks = 0;
    if (i.financeMethod === 'mortgage') {
      purchaseLoan = price * n(i.purchaseLtv) / 100;
      lenderFee = n(i.purchaseLenderFee);
      monthlyFinanceDuringWorks = monthlyPayment(purchaseLoan, i.purchaseRate, i.purchaseTerm, i.purchaseInterestOnly);
    } else if (i.financeMethod === 'bridge') {
      purchaseLoan = price * n(i.bridgeLtv) / 100;
      lenderFee = purchaseLoan * n(i.bridgeArrangementPct) / 100;
      bridgeExitFee = purchaseLoan * n(i.bridgeExitPct) / 100;
      monthlyFinanceDuringWorks = purchaseLoan * n(i.bridgeMonthlyRate) / 100;
    }
    const deposit = price - purchaseLoan;

    const purchaseCosts = {
      tax: tax.tax,
      legal: n(i.legalFees),
      survey: n(i.surveyFees),
      broker: n(i.brokerFee),
      lender: lenderFee,
      sourcing: n(i.sourcingFee),
      other: n(i.otherPurchaseCosts),
    };
    const totalPurchaseCosts = Object.values(purchaseCosts).reduce((a, b) => a + b, 0);

    // --- Refurb --------------------------------------------------------------
    const refurbBudget = n(i.refurbBudget);
    const contingency = refurbBudget * n(i.refurbContingencyPct) / 100;
    const refurbMonths = n(i.refurbMonths);
    const holdingProperty = n(i.holdingCostsMonthly) * refurbMonths;
    const holdingFinance = monthlyFinanceDuringWorks * refurbMonths;
    const refurbTotal = refurbBudget + contingency;
    const holdingTotal = holdingProperty + holdingFinance;

    const totalCashIn = deposit + totalPurchaseCosts + refurbTotal + holdingTotal;
    const allInCost = price + totalPurchaseCosts + refurbTotal + holdingTotal;

    // --- Refinance -----------------------------------------------------------
    const gdv = n(i.gdv) || price;
    const refinance = !!i.refinance;
    let refiLoan = 0;
    let refiCosts = 0;
    let cashReleased = 0;
    let ongoingLoan = purchaseLoan;
    let ongoingRate = i.financeMethod === 'bridge' ? n(i.bridgeMonthlyRate) * 12 : n(i.purchaseRate);
    let ongoingTerm = n(i.purchaseTerm);
    let ongoingIO = i.financeMethod === 'bridge' ? true : !!i.purchaseInterestOnly;

    if (refinance) {
      refiLoan = gdv * n(i.refiLtv) / 100;
      refiCosts = n(i.refiFees) + bridgeExitFee;
      cashReleased = refiLoan - purchaseLoan - refiCosts;
      ongoingLoan = refiLoan;
      ongoingRate = n(i.refiRate);
      ongoingTerm = n(i.refiTerm);
      ongoingIO = !!i.refiInterestOnly;
    }
    const cashLeftIn = totalCashIn - cashReleased;
    const ongoingMortgage = monthlyPayment(ongoingLoan, ongoingRate, ongoingTerm, ongoingIO);
    const equity = gdv - ongoingLoan;

    // --- Full let (single let / AST) -----------------------------------------
    const rent = n(i.fullLetRent);
    const letCosts = {
      management: rent * n(i.managementPct) / 100,
      maintenance: rent * n(i.maintenancePct) / 100,
      voids: rent * n(i.voidsPct) / 100,
      insurance: n(i.insuranceMonthly),
      serviceCharge: n(i.serviceChargeMonthly),
      other: n(i.otherMonthly),
    };
    const letOpex = Object.values(letCosts).reduce((a, b) => a + b, 0);
    const letCashflow = rent - letOpex - ongoingMortgage;

    const fullLet = {
      rent,
      costs: letCosts,
      opex: letOpex,
      mortgage: ongoingMortgage,
      cashflow: letCashflow,
      annualCashflow: letCashflow * 12,
      grossYieldPrice: pct(rent * 12, price),
      grossYieldAllIn: pct(rent * 12, allInCost),
      grossYieldGdv: pct(rent * 12, gdv),
      netYield: pct((rent - letOpex) * 12, allInCost),
      roi: cashLeftIn > 0 ? pct(letCashflow * 12, cashLeftIn) : Infinity,
    };

    // Lender rental stress test (ICR) on the ongoing loan.
    const stressRate = n(i.stressRate);
    const icrTarget = n(i.icrTarget);
    const stressInterest = ongoingLoan * stressRate / 100 / 12;
    fullLet.icr = stressInterest > 0 ? (rent / stressInterest) * 100 : Infinity;
    fullLet.icrPass = fullLet.icr >= icrTarget;
    fullLet.maxLoanByRent = stressRate > 0 && icrTarget > 0 ? (rent * 12) / (icrTarget / 100) / (stressRate / 100) : Infinity;

    // --- Lodger (owner lives in, lets spare rooms) ---------------------------
    const rooms = n(i.lodgerRooms);
    const lodgerIncome = rooms * n(i.lodgerRoomRent);
    const lodgerCosts = {
      bills: n(i.lodgerBillsMonthly),
      maintenance: lodgerIncome * n(i.maintenancePct) / 100,
      voids: lodgerIncome * n(i.voidsPct) / 100,
      insurance: n(i.insuranceMonthly),
    };
    const lodgerOpex = Object.values(lodgerCosts).reduce((a, b) => a + b, 0);
    const lodgerCashflow = lodgerIncome - lodgerOpex - ongoingMortgage;
    const lodger = {
      rooms,
      income: lodgerIncome,
      costs: lodgerCosts,
      opex: lodgerOpex,
      mortgage: ongoingMortgage,
      cashflow: lodgerCashflow,
      annualCashflow: lodgerCashflow * 12,
      grossYieldPrice: pct(lodgerIncome * 12, price),
      grossYieldAllIn: pct(lodgerIncome * 12, allInCost),
      netYield: pct((lodgerIncome - lodgerOpex) * 12, allInCost),
      roi: cashLeftIn > 0 ? pct(lodgerCashflow * 12, cashLeftIn) : Infinity,
      mortgageCoverPct: ongoingMortgage > 0 ? (lodgerIncome / ongoingMortgage) * 100 : Infinity,
      rentARoomTaxFree: Math.min(lodgerIncome * 12, 7500),
      overRentARoom: lodgerIncome * 12 > 7500,
    };

    return {
      price,
      tax,
      purchaseLoan,
      deposit,
      purchaseCosts,
      totalPurchaseCosts,
      refurb: { budget: refurbBudget, contingency, total: refurbTotal, months: refurbMonths },
      holding: { property: holdingProperty, finance: holdingFinance, total: holdingTotal },
      totalCashIn,
      allInCost,
      gdv,
      uplift: gdv - allInCost,
      refinance: { enabled: refinance, loan: refiLoan, costs: refiCosts, cashReleased, bridgeExitFee },
      cashLeftIn,
      moneyOut: cashLeftIn <= 0,
      cashLeftInPct: totalCashIn > 0 ? (cashLeftIn / totalCashIn) * 100 : 0,
      ongoingLoan,
      ongoingMortgage,
      equity,
      fullLet,
      lodger,
    };
  }

  function pct(a, b) {
    return b > 0 ? (a / b) * 100 : 0;
  }

  // ---------------------------------------------------------------------------
  // Stats helpers for comparables
  // ---------------------------------------------------------------------------

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function summarise(values) {
    const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    return {
      count: s.length,
      min: s[0],
      max: s[s.length - 1],
      lowerQuartile: quantile(s, 0.25),
      median: quantile(s, 0.5),
      upperQuartile: quantile(s, 0.75),
      mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN,
    };
  }

  const api = { propertyTax, bandedTax, monthlyPayment, analyseDeal, summarise, quantile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DealCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
