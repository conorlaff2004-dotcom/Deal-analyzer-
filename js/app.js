/* UI wiring: read the form, run the maths, render results, area data and rent evidence. */
(function () {
  'use strict';

  const { analyseDeal, summarise } = window.DealCalc;
  const Data = window.DealData;
  const Comps = window.DealComps;
  const $ = (id) => document.getElementById(id);
  const form = $('deal');
  const STORE_KEY = 'deal-analyzer:v2';
  const COMPS_KEY = 'deal-analyzer:comps';
  const MIN_COMPS = 3;

  const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
  const EIRCODE = /^([AC-FHKNPRTV-Y]\d{2}|D6W)(\s*[0-9AC-FHKNPRTV-Y]{4})?$/i;

  const currency = () => ($('country').value === 'Ireland' ? 'EUR' : 'GBP');
  const fmts = {
    GBP: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }),
    EUR: new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
  };
  const money = (v, cur) => (Number.isFinite(v) ? fmts[cur || currency()].format(Math.round(v)) : '–');
  const signed = (v) => (v > 0 ? '+' : '') + money(v);
  // Bedrooms when you buy, and after any bedrooms added in the refurb.
  const bedsNow = () => Number($('beds').value) || 0;
  const bedsAfter = () => bedsNow() + Math.max(0, Math.round(Number($('extraBeds').value) || 0));
  const pct = (v, d = 1) => (v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(d) + '%' : '–');

  // ---------------------------------------------------------------------------
  // Reading inputs
  // ---------------------------------------------------------------------------

  const fieldEls = () => Array.from(form.querySelectorAll('input:not([type="file"]), select')).filter((el) => el.id || el.name);

  function readInputs() {
    const out = {};
    for (const el of fieldEls()) {
      if (el.type === 'radio') {
        if (el.checked) out[el.name] = el.value;
      } else if (el.type === 'checkbox') {
        out[el.id] = el.checked;
      } else if (el.type === 'number') {
        out[el.id] = el.value === '' ? 0 : Number(el.value);
      } else {
        out[el.id] = el.value;
      }
    }
    out.icrTarget = Number(out.icrTarget);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Refurb budget helper
  // ---------------------------------------------------------------------------

  const REFURB_RATE = { cosmetic: 120, medium: 300, full: 700 }; // per m²
  const AREA_BY_BEDS = [35, 50, 65, 85, 110, 135, 160];

  function floorArea() {
    const fa = Number($('floorArea').value);
    if (fa > 0) return fa;
    const beds = Math.max(0, Math.min(6, Math.round(Number($('beds').value) || 0)));
    return AREA_BY_BEDS[beds];
  }

  function applyRefurbLevel() {
    const level = $('refurbLevel').value;
    if (!level) return;
    $('refurbBudget').value = Math.round((floorArea() * REFURB_RATE[level]) / 500) * 500;
  }

  // ---------------------------------------------------------------------------
  // Rendering results
  // ---------------------------------------------------------------------------

  function rows(table, data) {
    table.innerHTML = data
      .filter(Boolean)
      .map(([label, value, cls]) => `<tr class="${cls || ''}"><th scope="row">${label}</th><td>${value}</td></tr>`)
      .join('');
  }

  function render() {
    const i = readInputs();
    const r = analyseDeal(i);
    const method = i.financeMethod;

    $('t-cashLeft').textContent = r.moneyOut ? 'All out' : money(r.cashLeftIn);
    $('t-cashLeftSub').textContent = r.moneyOut
      ? `${money(-r.cashLeftIn)} pulled out on top`
      : r.refinance.enabled
        ? `${pct(r.cashLeftInPct, 0)} of ${money(r.totalCashIn)} invested`
        : 'no refinance';
    const key = i.strategy || 'full';
    const st = r.strategies[key];
    const tone = (v, good, ok) => (v >= good ? 'good' : v >= ok ? 'warn' : 'bad');
    $('t-cashflowLabel').textContent = `${STRATEGY_SHORT[key]} cashflow`;
    setTone($('t-cashflow'), money(st.cashflow), tone(st.cashflow, 200, 0));
    setTone($('t-yield'), pct(st.grossYieldPrice), tone(st.grossYieldPrice, 7, 5.5));
    $('t-yieldSub').textContent = `${pct(st.netYield)} net on all-in cost`;
    setTone($('t-roi'), r.moneyOut && st.cashflow > 0 ? '∞' : pct(st.roi), tone(st.roi, 10, 5));

    renderVerdict(r, st, key);
    $('m-cashflow').textContent = money(st.cashflow);
    $('m-cashflow').dataset.tone = $('t-cashflow').dataset.tone;
    $('m-yield').textContent = pct(st.grossYieldPrice);
    $('m-yield').dataset.tone = $('t-yield').dataset.tone;
    $('m-left').textContent = r.moneyOut ? 'All out' : money(r.cashLeftIn);
    $('m-roi').textContent = $('t-roi').textContent;
    $('m-roi').dataset.tone = $('t-roi').dataset.tone;

    $('s-purchase').textContent = money(r.price + r.totalPurchaseCosts);
    rows($('tbl-purchase'), [
      ['Purchase price', money(r.price)],
      [r.tax.name, money(r.tax.tax)],
      ['Legal', money(r.purchaseCosts.legal)],
      ['Survey', money(r.purchaseCosts.survey)],
      ['Broker', money(r.purchaseCosts.broker)],
      r.purchaseCosts.lender ? [method === 'bridge' ? 'Bridge arrangement fee' : 'Lender fee', money(r.purchaseCosts.lender)] : null,
      r.purchaseCosts.sourcing ? ['Sourcing fee', money(r.purchaseCosts.sourcing)] : null,
      r.purchaseCosts.other ? ['Other', money(r.purchaseCosts.other)] : null,
      ['Total purchase costs', money(r.totalPurchaseCosts), 'sub'],
      [method === 'cash' ? 'Cash for purchase' : `Deposit (${method === 'bridge' ? 'bridge' : 'mortgage'} ${money(r.purchaseLoan)})`, money(r.deposit)],
    ]);

    $('s-refurb').textContent = money(r.refurb.total + r.holding.total);
    rows($('tbl-refurb'), [
      ['Refurb budget', money(r.refurb.budget)],
      r.refurb.bedroomWorks ? [`Adding ${r.refurb.extraBeds} bedroom${r.refurb.extraBeds > 1 ? 's' : ''}`, money(r.refurb.bedroomWorks)] : null,
      ['Contingency', money(r.refurb.contingency)],
      [`Holding costs (${r.refurb.months} mo)`, money(r.holding.property)],
      r.holding.finance ? ['Finance during works', money(r.holding.finance)] : null,
      ['Total cash in', money(r.totalCashIn), 'total'],
      ['All-in cost', money(r.allInCost)],
    ]);

    if (r.refinance.enabled) {
      $('s-refi').textContent = r.moneyOut ? 'all money out' : money(r.cashLeftIn) + ' left in';
      rows($('tbl-refi'), [
        ['End value', money(r.gdv)],
        ['Uplift over all-in cost', signed(r.uplift), r.uplift >= 0 ? 'pos' : 'neg'],
        [`New mortgage (${i.refiLtv}% LTV)`, money(r.refinance.loan)],
        r.purchaseLoan ? ['Repay purchase loan', '−' + money(r.purchaseLoan)] : null,
        ['Refinance costs', '−' + money(r.refinance.costs)],
        ['Cash released', money(r.refinance.cashReleased)],
        ['Money left in', r.moneyOut ? `${money(-r.cashLeftIn)} out` : money(r.cashLeftIn), 'total'],
        ['Equity in property', money(r.equity)],
      ]);
    } else {
      $('s-refi').textContent = 'off';
      rows($('tbl-refi'), [
        ['Money left in', money(r.cashLeftIn), 'total'],
        ['Equity (at end value)', money(r.equity)],
        method === 'bridge' ? ['Bridging stays in place', 'refinance or sell to exit', 'neg'] : null,
      ]);
    }

    renderBedPayoff(r, i);
    renderIncome(r, i, key);
    renderCompare(r, key);

    save();
  }

  function setTone(el, text, tone) {
    el.textContent = text;
    el.dataset.tone = tone;
  }

  // ---------------------------------------------------------------------------
  // Adding bedrooms: what an extra bedroom is worth against what it costs
  // ---------------------------------------------------------------------------

  const BED_METHODS = {
    reception: { cost: 4000, months: 0 },
    split: { cost: 3000, months: 0 },
    boxroom: { cost: 2500, months: 0 },
    loft: { cost: 40000, months: 2 },
    extension: { cost: 50000, months: 3 },
  };

  function applyBedMethod() {
    const m = BED_METHODS[$('extraBedMethod').value];
    if (!m) return;
    $('extraBedCost').value = m.cost;
    $('extraBedMonths').value = m.months;
  }

  // Rent for a given bedroom count: let-agreed average, else the official figure.
  function rentFor(beds) {
    const st = localRentFor(beds);
    if (st) return { value: st.average, from: `${st.count} let-agreed in ${st.district}` };
    const off = officialRents(beds);
    return off && off.fullLet ? { value: off.fullLet, from: 'area estimate' } : null;
  }

  function renderBedPayoff(r, i) {
    const box = $('bedPayoff');
    const add = r.refurb.extraBeds;
    box.hidden = !add;
    if (!add) return;
    const now = bedsNow();
    const after = now + add;
    const cost = r.refurb.bedroomWorks * (1 + (Number(i.refurbContingencyPct) || 0) / 100);
    const lines = [];

    // Compare like with like: both sizes by type, or both across all types.
    const d = subjectDistrict();
    const both = [localSaleFor(now), localSaleFor(after)];
    const sameBasis = both[0] && both[1] && both[0].byType !== both[1].byType
      ? [Comps.saleEvidence(SALES.listings, d, now, null), Comps.saleEvidence(SALES.listings, d, after, null)] // all types
      : both;
    const [vNow, vAfter] = sameBasis;
    let valueUp = null;
    if (vNow && vAfter && vNow.count >= MIN_COMPS && vAfter.count >= MIN_COMPS) {
      valueUp = vAfter.median - vNow.median;
      lines.push(['Value', `${saleWhat(vAfter, after)} median ${money(vAfter.median)} vs ${saleWhat(vNow, now)} ${money(vNow.median)} (sale agreed, ${d})`, signed(valueUp), valueUp > cost ? 'pos' : 'neg']);
    } else {
      lines.push(['Value', d && SALE_AREAS.includes(d) ? `Too few ${now}-bed or ${after}-bed sales in ${d} to compare` : `No sale-agreed data for ${d || 'this area'} to compare`, '–', '']);
    }

    const rNow = rentFor(now);
    const rAfter = rentFor(after);
    let rentUp = null;
    if (rNow && rAfter) {
      rentUp = rAfter.value - rNow.value;
      lines.push(['Full let', `${after}-bed ${money(rAfter.value)} vs ${now}-bed ${money(rNow.value)} (${rAfter.from})`, `${signed(rentUp)} pcm`, rentUp > 0 ? 'pos' : '']);
    }
    const roomRent = Number(i.hmoRoomRent) || Number(i.lodgerRoomRent) || 0;
    if (roomRent) lines.push(['HMO / lodgers', `${add} more room${add > 1 ? 's' : ''} to let at ${money(roomRent)}`, `${signed(add * roomRent)} pcm`, 'pos']);

    const best = Math.max(rentUp || 0, add * roomRent);
    const payback = best > 0 ? cost / best : Infinity;
    const verdict = valueUp !== null
      ? (valueUp >= cost ? `Adds ${money(valueUp - cost)} more value than it costs` : `Costs ${money(cost - valueUp)} more than the value it adds`)
      : best > 0 ? `Extra rent pays back the works in about ${Math.ceil(payback)} months` : '';

    box.innerHTML =
      `<div class="payoff-head"><b>${now} → ${after} bedrooms</b><span>Works ${money(cost)} incl. contingency${r.refurb.months ? `, ${r.refurb.months} months in total` : ''}</span></div>` +
      '<table>' + lines.map(([k, d, v, cls]) => `<tr><th scope="row">${k}</th><td>${escapeHtml(d)}</td><td class="${cls}">${v}</td></tr>`).join('') + '</table>' +
      (verdict ? `<p class="payoff-verdict" data-good="${valueUp !== null ? valueUp >= cost : best > 0}">${verdict}${valueUp !== null && best > 0 ? `; extra rent pays it back in about ${Math.ceil(payback)} months` : ''}.</p>` : '') +
      '<p class="fine">A new bedroom needs a window big enough to escape through, enough floor space (6.5 m² for a single let room in an NI HMO) and building control sign-off. Losing the only living room can put off tenants and some lenders.</p>';
  }

  const STRATEGY_NAME = { full: 'Full let', lodger: 'Lodgers', hmo: 'HMO', sa: 'Serviced accommodation' };
  const STRATEGY_SHORT_ROW = { full: 'Full let', lodger: 'Lodgers', hmo: 'HMO', sa: 'Serviced acc.' };
  const STRATEGY_SHORT = { full: 'Full-let', lodger: 'Lodger', hmo: 'HMO', sa: 'SA' };

  function renderVerdict(r, st, key) {
    const hasIcr = key === 'full' || key === 'hmo';
    const checks = [
      { ok: st.grossYieldPrice >= 7, label: `Yield ${pct(st.grossYieldPrice)}` },
      { ok: st.cashflow >= 200, label: `Cashflow ${money(st.cashflow)}` },
      { ok: !r.refinance.enabled || r.cashLeftInPct <= 25, label: r.moneyOut ? 'All money out' : `${pct(r.cashLeftInPct, 0)} left in` },
      hasIcr ? { ok: !r.ongoingLoan || st.icrPass, label: `ICR ${pct(st.icr, 0)}` } : null,
    ].filter(Boolean);
    const score = checks.filter((c) => c.ok).length;
    const word = score === checks.length ? 'Strong deal' : score >= 2 ? 'Worth a closer look' : 'Weak on these numbers';
    const tone = score === checks.length ? 'good' : score >= 2 ? 'warn' : 'bad';
    $('verdict').innerHTML =
      `<span class="pill" data-tone="${tone}">${word}</span>` +
      checks.map((c) => `<span class="chip" data-ok="${c.ok}">${c.ok ? '✓' : '✗'} ${c.label}</span>`).join('');
  }

  const COST_LABEL = {
    management: 'Management', voids: 'Voids', bills: 'Bills', licence: 'Licence', cleaning: 'Cleaning',
    platform: 'Booking platform fees', supplies: 'Supplies', maintenance: 'Maintenance',
    insurance: 'Insurance', serviceCharge: 'Service charge / ground rent', other: 'Certificates & other',
  };

  function renderIncome(r, i, key) {
    const st = r.strategies[key];
    $('s-incomeLabel').textContent = `${STRATEGY_NAME[key]}, monthly`;
    $('s-income').textContent = money(st.cashflow) + ' pcm';
    const incomeLabel = {
      full: () => 'Rent',
      lodger: () => `Room income (${st.rooms} × ${money(i.lodgerRoomRent)})`,
      hmo: () => `Room income (${st.rooms} × ${money(i.hmoRoomRent)})`,
      sa: () => `${st.nights.toFixed(1)} nights × ${money(i.saNightlyRate)} (${st.stays.toFixed(1)} stays)`,
    }[key]();
    const incomeRow = [incomeLabel, money(st.income)];
    const costRows = Object.entries(st.costs)
      .filter(([k, v]) => v || ['management', 'maintenance', 'insurance'].includes(k))
      .map(([k, v]) => [k === 'bills' && key === 'lodger' ? 'Extra bills' : COST_LABEL[k] || k, '−' + money(v)]);
    const extra = [];
    if (key === 'full' || key === 'hmo') {
      if (r.ongoingLoan) extra.push([`Lender ICR at ${i.stressRate}%`, `${pct(st.icr, 0)} ${st.icrPass ? '✓ passes' : '✗ below ' + i.icrTarget + '%'}`, st.icrPass ? 'pos' : 'neg']);
      if (r.ongoingLoan && !st.icrPass) extra.push(['Max loan this income supports', money(st.maxLoanByRent), 'neg']);
      if (key === 'hmo') extra.push(['', '<small class="muted">HMO and SA lending usually needs a specialist lender</small>']);
    }
    if (key === 'lodger') {
      extra.push(['Mortgage covered by lodgers', pct(st.mortgageCoverPct, 0)]);
      extra.push(st.overRentARoom
        ? [`Taxable above Rent a Room ${money(st.rentARoomLimit)}`, money(st.income * 12 - st.rentARoomLimit) + ' / yr']
        : ['Rent a Room relief', `all tax-free (under ${money(st.rentARoomLimit)})`]);
    }
    rows($('tbl-income'), [
      incomeRow,
      ...costRows,
      ['Mortgage', '−' + money(st.mortgage)],
      ['Cashflow', money(st.cashflow), 'total ' + (st.cashflow >= 0 ? 'pos' : 'neg')],
      ['Annual cashflow', money(st.annualCashflow)],
      ['Gross yield on price / all-in', `${pct(st.grossYieldPrice)} / ${pct(st.grossYieldAllIn)}`],
      ['Gross yield on end value', pct(st.grossYieldGdv)],
      ['Net yield (before mortgage)', pct(st.netYield)],
      ['ROI on money left in', r.moneyOut && st.cashflow > 0 ? '∞ (all money out)' : pct(st.roi)],
      ...extra,
    ]);
  }

  function renderCompare(r, key) {
    const keys = ['full', 'lodger', 'hmo', 'sa'];
    const best = keys.reduce((a, b) => (r.strategies[b].cashflow > r.strategies[a].cashflow ? b : a));
    $('tbl-compare').innerHTML =
      '<thead><tr><th scope="col">Strategy</th><th scope="col">Income</th><th scope="col">Cashflow</th><th scope="col">Yield</th><th scope="col">ROI</th></tr></thead><tbody>' +
      keys.map((k) => {
        const st = r.strategies[k];
        return `<tr class="${k === key ? 'mine' : ''}" data-pick="${k}" tabindex="0" title="Show ${STRATEGY_NAME[k]}">
          <th scope="row">${STRATEGY_SHORT_ROW[k]}${k === best ? ' <small class="tag local">best</small>' : ''}</th>
          <td>${money(st.income)}</td>
          <td class="${st.cashflow >= 0 ? 'pos' : 'neg'}">${money(st.cashflow)}</td>
          <td>${pct(st.grossYieldPrice)}</td>
          <td>${r.moneyOut && st.cashflow > 0 ? '∞' : pct(st.roi)}</td></tr>`;
      }).join('') +
      '</tbody><tfoot><tr><td colspan="5"><small class="muted">Monthly figures. Lodger cashflow is before your own living costs. Click a row to switch strategy.</small></td></tr></tfoot>';
  }

  function syncStrategy() {
    const key = $('strategy').value;
    form.querySelectorAll('[data-strategy]').forEach((el) => { el.hidden = !el.dataset.strategy.split(' ').includes(key); });
  }

  // ---------------------------------------------------------------------------
  // Country-dependent UI
  // ---------------------------------------------------------------------------

  function syncCountry() {
    const c = $('country').value;
    const sym = c === 'Ireland' ? '€' : '£';
    document.querySelectorAll('.cur').forEach((el) => { el.textContent = sym; });
    form.querySelectorAll('[data-country]').forEach((el) => { el.hidden = el.dataset.country !== c; });
    renderSearchLinks();
    renderLocalRents();
    renderNews();
  }

  // ---------------------------------------------------------------------------
  // Area analysis
  // ---------------------------------------------------------------------------

  const TYPE_LABEL = { detached: 'Detached', 'semi-detached': 'Semi-detached', terraced: 'Terraced', flat: 'Flat', other: 'Other' };
  let area = null; // last analysis result

  function status(html, tone) {
    const el = $('areaStatus');
    el.innerHTML = html;
    el.dataset.tone = tone || '';
  }

  async function analyseArea() {
    const raw = $('postcode').value.trim();
    if (!raw) return status('Enter a postcode, Eircode or town first.', 'bad');
    const btn = $('analyseBtn');
    btn.disabled = true;
    btn.textContent = 'Analysing…';
    try {
      const isUk = UK_POSTCODE.test(raw.replace(/\s+/g, ' '));
      const isIe = !isUk && (EIRCODE.test(raw) || $('country').value === 'Ireland');
      if (isIe) await analyseIreland(raw);
      else if (isUk) await analyseUk(Data.normalisePostcode(raw));
      else status('That doesn’t look like a UK postcode. For Ireland, choose Ireland as the country and enter an Eircode or town.', 'bad');
    } catch (e) {
      status(`Couldn't analyse ${escapeHtml(raw)}: ${escapeHtml(e.message)}. Check it and your connection, or enter figures by hand.`, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Analyse area';
      renderSearchLinks();
      renderNews();
    }
  }

  async function analyseIreland(raw) {
    $('country').value = 'Ireland';
    syncCountry();
    status('Loading the RTB rent index from the CSO…');
    area = { country: 'Ireland', label: raw, sales: [] };
    try {
      const rtb = await Data.loadRtb();
      area.rtb = rtb;
      $('rtbAreas').innerHTML = rtb.locations.map((l) => `<option value="${escapeHtml(l)}"></option>`).join('');
      if (!rtb.locations.includes($('rtbArea').value) || !$('rtbArea').dataset.touched) {
        const m = Data.matchRtbLocation(raw, rtb.locations);
        if (m) $('rtbArea').value = m;
      }
      const ok = rtb.locations.includes($('rtbArea').value);
      status(
        ok
          ? `Using RTB rents for <b>${escapeHtml($('rtbArea').value)}</b> (${escapeHtml(rtb.period)}): rents agreed on new tenancies. Change the RTB rent area if that’s not right, and add listings below.`
          : `Couldn’t match “${escapeHtml(raw)}” to an RTB area. Pick one in <b>RTB rent area</b>.`,
        ok ? 'good' : 'warn'
      );
    } catch (e) {
      area.rtbError = e.message;
      status(`RTB rent index unavailable (${escapeHtml(e.message)}). Using a national rough guide; add listings below for a proper figure.`, 'warn');
    }
    $('area').hidden = true;
    refreshEstimates();
  }

  async function analyseUk(pc) {
    $('postcode').value = pc;
    status(`Looking up ${pc}…`);
    const info = await Data.lookupPostcode(pc);
    const country = ['Northern Ireland', 'Scotland', 'Wales'].includes(info.country) ? info.country : 'England';
    $('country').value = country;
    syncCountry();
    area = { country, pc, info, label: `${pc.split(' ')[0]} ${info.admin_district || ''}`.trim(), sales: [] };
    try { area.nearbyDistricts = await Data.nearbyOutcodes(info.outcode || pc.split(' ')[0]); } catch (e) { area.nearbyDistricts = []; }

    if (country === 'England' || country === 'Wales') {
      status(`Finding sales near ${pc}…`);
      const nearby = await Data.nearbyPostcodes(info.latitude, info.longitude, Number($('radius').value));
      area.postcodes = Array.from(new Set([info.postcode, ...nearby.map((p) => p.postcode)]));
      const since = new Date();
      since.setFullYear(since.getFullYear() - Number($('years').value));
      area.sinceIso = since.toISOString().slice(0, 10);
      try {
        area.sales = await Data.soldPrices(area.postcodes, area.sinceIso);
      } catch (e) {
        area.salesError = e;
      }
    }

    const key = $('pdKey').value.trim();
    if (key && country !== 'Northern Ireland') await fetchLiveRents(key);
    refreshEstimates();

    const place = info.admin_district || info.region || country;
    if (country === 'Northern Ireland') {
      $('area').hidden = true;
      status(`Found ${pc} (${escapeHtml(place)}). Using NI Housing Executive average rents for ${/belfast/i.test(place) ? 'Belfast' : 'outside Belfast'} until you add listings below. Sold prices aren’t published per sale in NI.`, 'good');
    } else if (area.salesError || country === 'Scotland') {
      renderArea();
      status(`Found ${pc} (${escapeHtml(place)}). Sold prices unavailable${area.salesError ? ': ' + escapeHtml(area.salesError.message) : ' in Scotland'}.`, 'warn');
    } else {
      renderArea();
      status(`Found ${usableSales().length} sales near ${pc} since ${fmtDate(area.sinceIso)}. Estimates applied to fields you haven't edited.`, 'good');
    }
  }

  async function fetchLiveRents(key) {
    const beds = bedsAfter();
    try {
      const live = await Data.propertyDataRent(key, area.pc, beds);
      if (Number.isFinite(live.monthly)) area.liveRent = { ...live, beds };
    } catch (e) {
      area.liveRentError = e.message;
    }
    try {
      const liveRoom = await Data.propertyDataRoomRent(key, area.pc);
      if (Number.isFinite(liveRoom.monthly)) area.liveRoom = liveRoom;
    } catch (e) { /* fall back */ }
  }

  function usableSales() {
    if (!area || !area.sales) return [];
    const noNew = $('excludeNewBuild').checked;
    return area.sales.filter((s) => s.standard && !(noNew && s.newBuild));
  }

  // Official / estimated rents for the current property, before listings.
  function officialRents(bedsFor) {
    if (!area) return null;
    const beds = bedsFor ?? bedsAfter();
    const type = $('propertyType').value;
    const typeName = TYPE_LABEL[type].toLowerCase();

    if (area.country === 'Ireland') {
      const loc = $('rtbArea').value;
      const hit = area.rtb && area.rtb.locations.includes(loc) ? area.rtb.lookup(loc, beds, type) : null;
      const guide = Data.estimateRents({ region: 'Ireland', localMedianPrice: 0, beds, type });
      if (hit) {
        return {
          fullLet: Math.round(hit.monthly / 25) * 25,
          fullLetText: `RTB rent index, ${loc}, ${area.rtb.period}: ${money(hit.raw)} average (${hit.basis})${hit.monthly !== hit.raw ? `, adjusted to ${beds} bed` : ''}`,
          room: guide.room,
          roomText: 'Rough national guide for a double room',
        };
      }
      return {
        fullLet: guide.fullLet,
        fullLetText: `Rough national guide for a ${beds}-bed ${typeName}`,
        room: guide.room,
        roomText: 'Rough national guide for a double room',
      };
    }

    if (area.country === 'Northern Ireland') {
      const ni = Data.estimateNiRents({ district: area.info.admin_district, beds, type });
      return {
        fullLet: ni.fullLet,
        fullLetText: `${ni.source}, ${ni.area} average, adjusted to a ${beds}-bed ${typeName}`,
        room: ni.room,
        roomText: `Rough guide for a double room, ${ni.area}`,
      };
    }

    const out = {};
    const all = summarise(usableSales().map((s) => s.price));
    const region = Data.regionOf(area.info);
    const est = Data.estimateRents({ region, localMedianPrice: all.median, beds, type });
    if (area.liveRent && area.liveRent.beds === beds) {
      const range = area.liveRent.range ? `, typical ${money(area.liveRent.range[0])}–${money(area.liveRent.range[1])}` : '';
      out.fullLet = Math.round(area.liveRent.monthly / 5) * 5;
      out.fullLetText = `PropertyData: ${beds}-bed asking rents average ${money(area.liveRent.monthly)}${range}`;
    } else if (est) {
      out.fullLet = est.fullLet;
      out.fullLetText = `Estimate for a ${beds}-bed ${typeName} in ${region}, scaled to local prices`;
    }
    if (area.liveRoom) {
      out.room = Math.round(area.liveRoom.monthly / 5) * 5;
      out.roomText = `PropertyData: double rooms average ${money(area.liveRoom.monthly)}`;
    } else if (est) {
      out.room = est.room;
      out.roomText = `Estimate for a double room in ${region}, scaled to local prices`;
    }
    return out;
  }

  // Pick the best rent figures and apply them to fields the user hasn't edited.
  // Built-in let-agreed rents for the area beat official figures.
  function refreshEstimates() {
    const beds = bedsAfter();
    const off = officialRents() || {};
    const local = localRentFor(beds);
    const d = subjectDistrict();
    const noData = d && $('country').value !== 'Ireland' ? `. No let-agreed ${beds}-bed rents for ${d} in the built-in data` : '';

    if (local) {
      hint('rentHint', 'fullLetRent', Math.round(local.average / 5) * 5, rentText(local, `${beds}-bed lets`) + (off.fullLet ? `. Area estimate ${money(off.fullLet)}` : ''));
    } else if (off.fullLet) {
      hint('rentHint', 'fullLetRent', off.fullLet, off.fullLetText + noData);
    }

    const room = localRentFor('room');
    if (room) {
      const text = rentText(room, 'rooms in shared houses');
      hint('roomHint', 'lodgerRoomRent', Math.round(room.average / 5) * 5, text);
      hint('hmoRoomHint', 'hmoRoomRent', Math.round(room.average / 5) * 5, text);
    } else if (off.room) {
      hint('roomHint', 'lodgerRoomRent', off.room, off.roomText);
      hint('hmoRoomHint', 'hmoRoomRent', off.room, off.roomText);
    }
    if (!$('hmoRooms').dataset.touched && (area || Number($('extraBeds').value))) $('hmoRooms').value = Math.max(1, beds);

    const ev = localSaleFor(beds);
    const added = bedsAfter() - bedsNow();
    const prefix = added ? `After adding ${added} bedroom${added > 1 ? 's' : ''}: ` : '';
    if (ev && ev.count >= MIN_COMPS) {
      const gdv = Math.round(ev.upperQuartile / 1000) * 1000;
      hint('gdvHint', 'gdv', gdv,
        `${prefix}sale-agreed asking prices in ${ev.district}: ${ev.count} ${saleWhat(ev, beds)} homes, median ${money(ev.median)}, upper quartile ${money(ev.upperQuartile)} (a refurbished home should sell towards the top)`);
    } else if (ev) {
      $('gdvHint').textContent = `${prefix}only ${ev.count} ${saleWhat(ev, beds)} sale${ev.count > 1 ? 's' : ''} in ${ev.district} (median ${money(ev.median)}), too few to suggest an end value.`;
    } else if (area && area.country !== 'Ireland' && area.country !== 'Northern Ireland') {
      const type = $('propertyType').value;
      const sameType = summarise(usableSales().filter((x) => x.type === type).map((x) => x.price));
      if (sameType.count >= 3) {
        const gdv = Math.round(sameType.upperQuartile / 1000) * 1000;
        hint('gdvHint', 'gdv', gdv,
          `Area: ${TYPE_LABEL[type].toLowerCase()} sales median ${money(sameType.median)}, upper quartile ${money(sameType.upperQuartile)} (${sameType.count} sales)`);
      } else {
        $('gdvHint').innerHTML = `Not enough ${TYPE_LABEL[type].toLowerCase()} sales nearby to suggest an end value. Try a bigger radius or longer period.`;
      }
    } else if (area) {
      $('gdvHint').textContent = `No sale-agreed data for ${subjectDistrict() || 'this area'} yet. Set the end value from recent sales of similar homes.`;
    }

    if (!$('lodgerRooms').dataset.touched && (area || Number($('extraBeds').value))) $('lodgerRooms').value = Math.max(0, beds - 1);
    renderLocalRents();
    renderLocalSales();
    render();
  }

  // Show a suggested figure under a field, with a button to use it. Fields the
  // user hasn't typed into take the figure straight away.
  function hint(hintId, fieldId, value, text) {
    const field = $(fieldId);
    if (!field.dataset.touched) field.value = value;
    const same = Number(field.value) === value;
    $(hintId).innerHTML = `${escapeHtml(text)}. ` + (same ? `<b>Using ${money(value)}.</b>` : `<button type="button" class="link" data-apply="${fieldId}" data-value="${value}">Use ${money(value)}</button>`);
  }

  function renderArea() {
    if (!area || !area.info || !area.postcodes) { $('area').hidden = true; return; }
    $('area').hidden = false;
    const { info, pc, postcodes, sinceIso } = area;
    const sales = usableSales();
    const place = [info.admin_ward, info.admin_district, info.region || info.country].filter(Boolean).join(', ');
    $('areaMeta').textContent = `${pc} · ${place} · ${postcodes.length} postcodes within ${Number($('radius').value) / 1000} km · sales since ${fmtDate(sinceIso)}`;

    const types = ['terraced', 'semi-detached', 'detached', 'flat'];
    const price = Number($('price').value);
    const statRows = types
      .map((t) => {
        const s = summarise(sales.filter((x) => x.type === t).map((x) => x.price));
        const mine = t === $('propertyType').value;
        if (!s.count) return `<tr class="${mine ? 'mine' : ''}"><th scope="row">${TYPE_LABEL[t]}</th><td>0</td><td colspan="4" class="muted">No sales</td></tr>`;
        const vs = mine && price ? `<td class="${price <= s.median ? 'pos' : 'neg'}">${pct(((price - s.median) / s.median) * 100, 0)}</td>` : '<td></td>';
        return `<tr class="${mine ? 'mine' : ''}"><th scope="row">${TYPE_LABEL[t]}</th><td>${s.count}</td><td>${money(s.lowerQuartile)}</td><td>${money(s.median)}</td><td>${money(s.upperQuartile)}</td>${vs}</tr>`;
      })
      .join('');
    const all = summarise(sales.map((x) => x.price));
    $('typeStats').innerHTML =
      `<caption>Sold prices by type</caption><thead><tr><th scope="col">Type</th><th scope="col">Sales</th><th scope="col">Lower Q</th><th scope="col">Median</th><th scope="col">Upper Q</th><th scope="col">Your price vs median</th></tr></thead>` +
      `<tbody>${statRows}<tr class="sub"><th scope="row">All types</th><td>${all.count}</td><td>${money(all.lowerQuartile)}</td><td>${money(all.median)}</td><td>${money(all.upperQuartile)}</td><td></td></tr></tbody>`;

    const type = $('propertyType').value;
    const list = sales.filter((s) => s.type === type).slice(0, 30);
    $('comps').innerHTML =
      `<caption>Recent ${TYPE_LABEL[type].toLowerCase()} sales${list.length === 30 ? ' (latest 30)' : ''}</caption>` +
      `<thead><tr><th scope="col">Date</th><th scope="col">Address</th><th scope="col">Price</th></tr></thead><tbody>` +
      (list.length
        ? list.map((s) => `<tr><td>${fmtDate(s.date)}</td><td>${escapeHtml(titleCase(s.address))}, ${s.postcode}</td><td>${money(s.price)}</td></tr>`).join('')
        : `<tr><td colspan="3" class="muted">${area.salesError ? 'Sold prices unavailable.' : 'No sales of this type found. Try a bigger radius or a longer period.'}</td></tr>`) +
      '</tbody>';
  }

  // ---------------------------------------------------------------------------
  // Local rents: built-in let-agreed listings (js/rent-data.js)
  // ---------------------------------------------------------------------------

  const RENTS = window.RentData || { meta: {}, listings: [] };
  const RENT_AREAS = Array.from(new Set(RENTS.listings.map((l) => l.district))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const GROUP_LABEL = { 1: '1 bed', 2: '2 bed', 3: '3 bed', 4: '4 bed', 5: '5 bed', '6+': '6+ bed', room: 'Room in shared house' };
  let rentView = null; // area tab chosen in the Local rents panel
  let rentListGroup = null; // size whose listings are shown

  // Rents saved by the old "rent evidence" panel are kept only so online
  // saving doesn't drop them; nothing reads them any more.
  let comps = loadComps();
  function loadComps() {
    try { return JSON.parse(localStorage.getItem(COMPS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveComps() {
    try { localStorage.setItem(COMPS_KEY, JSON.stringify(comps)); } catch (e) { /* storage unavailable */ }
  }

  // The district being analysed: BT12, M14, D06, or the Irish town.
  function subjectDistrict() {
    const d = Comps.districtOf($('postcode').value);
    if (d) return d;
    if ($('country').value === 'Ireland') return Comps.normaliseDistrict(($('rtbArea').value || $('postcode').value).split(',')[0]);
    return '';
  }

  const localRents = (district) => Comps.summariseRentData(RENTS.listings, district);
  const rentPeriod = () => {
    const dates = RENTS.listings.map((l) => l.date).sort();
    return dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : '';
  };

  // Let-agreed rent for this area and size, or null when there's no listing.
  function localRentFor(beds, district = subjectDistrict()) {
    if (!RENT_AREAS.includes(district)) return null;
    const g = localRents(district).groups[Comps.rentGroup(beds)];
    return g.count ? { ...g, district } : null;
  }

  function rentText(st, what) {
    const thin = st.count < MIN_COMPS ? `. Only ${st.count} listing${st.count > 1 ? 's' : ''}, so treat it with care` : '';
    return `Let-agreed rents in ${st.district}: average of ${st.count} ${what} ${money(st.average)} (${money(st.min)}–${money(st.max)})${thin}`;
  }

  function renderLocalRents() {
    const here = subjectDistrict();
    if (!rentView || !RENT_AREAS.includes(rentView)) rentView = RENT_AREAS.includes(here) ? here : RENT_AREAS[0];
    const myGroup = Comps.rentGroup(bedsAfter());
    if (!rentListGroup) rentListGroup = myGroup;
    $('rentAreaTabs').innerHTML = RENT_AREAS.map((d) =>
      `<button type="button" role="tab" data-rent-area="${d}" aria-selected="${d === rentView}">${d}${d === here ? ' •' : ''}</button>`).join('');
    $('rentsSource').innerHTML = `${escapeHtml(RENTS.meta.source || '')}, let agreed ${rentPeriod()}. Pulled ${fmtDay(RENTS.meta.pulled)}. ` +
      (RENT_AREAS.includes(here) ? `The deal uses <b>${here}</b>.` : here ? `No let-agreed data for <b>${escapeHtml(here)}</b> yet, so the deal uses the area estimate.` : '');

    const sum = localRents(rentView);
    $('rentsTable').innerHTML =
      `<caption>${rentView}: ${sum.count} lets</caption><thead><tr><th scope="col">Size</th><th scope="col">Listings</th><th scope="col">Average rent</th><th scope="col">Lowest</th><th scope="col">Highest</th></tr></thead><tbody>` +
      Comps.RENT_GROUPS.map((g) => {
        const st = sum.groups[g];
        const mine = rentView === here && g === myGroup;
        return `<tr class="${mine ? 'mine' : ''}" data-rent-group="${g}" tabindex="0">
          <th scope="row">${GROUP_LABEL[g]}${mine ? ' <small class="tag local">this deal</small>' : ''}</th>
          <td>${st.count}</td><td>${st.count ? money(st.average) : '–'}</td><td>${st.count ? money(st.min) : '–'}</td><td>${st.count ? money(st.max) : '–'}</td></tr>`;
      }).join('') + '</tbody>';

    const list = RENTS.listings
      .filter((l) => l.district === rentView && Comps.rentGroup(l.beds) === rentListGroup)
      .sort((a, b) => b.date.localeCompare(a.date));
    $('rentListingsTitle').textContent = `${GROUP_LABEL[rentListGroup]} listings in ${rentView} (${list.length})`;
    $('rentListings').innerHTML = list.length
      ? '<thead><tr><th scope="col">Let agreed</th><th scope="col">Address</th><th scope="col">Type</th><th scope="col">Rent / month</th></tr></thead><tbody>' +
        list.map((l) => `<tr><td>${fmtDay(l.date)}</td>
          <td>${l.link ? `<a href="${escapeHtml(l.link)}" target="_blank" rel="noopener">${escapeHtml(l.address)}</a>` : escapeHtml(l.address)}${l.note ? ` <small class="tag">${escapeHtml(l.note)}</small>` : ''}</td>
          <td>${escapeHtml(l.type || '')}</td><td>${money(l.rent, 'GBP')}</td></tr>`).join('') + '</tbody>'
      : '<tbody><tr><td class="muted">No listings of this size.</td></tr></tbody>';
  }

  function searchArea() {
    if ($('country').value === 'Ireland') return $('rtbArea').value || $('postcode').value;
    if (area && area.label) return area.label;
    return Data.normalisePostcode($('postcode').value).split(' ')[0];
  }

  function renderSearchLinks() {
    const g = (site, words) => `https://www.google.com/search?q=${encodeURIComponent(`${words} site:${site}`)}`;
    const a = searchArea();
    $('saLinks').innerHTML = '<span class="links-label">Check nightly rates:</span>' +
      [['Airbnb', g('airbnb.co.uk', `${a} entire home`)], ['Booking.com', g('booking.com', `${a} apartment`)], ['AirDNA', `https://www.airdna.co/vacation-rental-data/app/search?query=${encodeURIComponent(a)}`]]
        .map(([l, u]) => `<a href="${u}" target="_blank" rel="noopener">${l}</a>`).join('');
  }

  // ---------------------------------------------------------------------------
  // Local sale prices: built-in sale-agreed listings (js/sale-data.js)
  // ---------------------------------------------------------------------------

  const SALES = window.SaleData || { meta: {}, listings: [] };
  const SALE_AREAS = Array.from(new Set(SALES.listings.map((l) => l.district))).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const SALE_LABEL = { 1: '1 bed', 2: '2 bed', 3: '3 bed', 4: '4 bed', 5: '5 bed', '6+': '6+ bed', all: 'All sizes' };
  let saleView = null; // area tab: a district or 'all'
  let saleListGroup = null;

  // Sales saved by the old "sold evidence" panel are kept only so online
  // saving doesn't drop them; nothing reads them any more.
  const SOLD_KEY = 'deal-analyzer:sold';
  let sales = loadSales();
  function loadSales() {
    try { return JSON.parse(localStorage.getItem(SOLD_KEY) || '[]'); } catch (e) { return []; }
  }

  /** Sale-agreed prices for this area and size (same type when 3+), or null. */
  function localSaleFor(beds, district = subjectDistrict()) {
    if (!SALE_AREAS.includes(district)) return null;
    return Comps.saleEvidence(SALES.listings, district, beds, $('propertyType').value);
  }

  function saleWhat(ev, beds) {
    return `${Comps.rentGroup(beds)}-bed${ev.byType ? ' ' + TYPE_LABEL[$('propertyType').value].toLowerCase() : ''}`;
  }

  function salePeriod() {
    const dates = SALES.listings.map((l) => l.date).sort();
    return dates.length ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : '';
  }

  function renderLocalSales() {
    const here = subjectDistrict();
    const views = [...SALE_AREAS, 'all'];
    if (!saleView || !views.includes(saleView)) saleView = SALE_AREAS.includes(here) ? here : SALE_AREAS[0];
    const nowGroup = Comps.rentGroup(bedsNow());
    const afterGroup = Comps.rentGroup(bedsAfter());
    if (!saleListGroup) saleListGroup = nowGroup;
    $('saleAreaTabs').innerHTML = views.map((d) =>
      `<button type="button" role="tab" data-sale-area="${d}" aria-selected="${d === saleView}">${d === 'all' ? SALE_AREAS.join(' + ') : d}${d === here ? ' •' : ''}</button>`).join('');

    // How the purchase price compares with what you're buying.
    const price = Number($('price').value);
    const ev = localSaleFor(bedsNow());
    let compare = '';
    if (ev && price) {
      const vs = ((price - ev.median) / ev.median) * 100;
      compare = ` Your price is <b class="${vs <= 0 ? 'pos' : 'neg'}">${Math.abs(vs).toFixed(0)}% ${vs <= 0 ? 'below' : 'above'}</b> the ${here} ${saleWhat(ev, bedsNow())} median of ${money(ev.median)} (${ev.count} sales${ev.count < MIN_COMPS ? ', very few' : ''}).`;
    } else if (here && !SALE_AREAS.includes(here)) {
      compare = ` No sale-agreed data for <b>${escapeHtml(here)}</b> yet.`;
    }
    $('salesSource').innerHTML = `${escapeHtml(SALES.meta.source || '')}, sale agreed ${salePeriod()}. Prices are the <b>asking price when the sale was agreed</b>, not the final sold price.` + compare;

    const sum = Comps.summariseSaleData(SALES.listings, saleView === 'all' ? null : saleView);
    const mineArea = saleView === here;
    $('salesTable').innerHTML =
      `<caption>${saleView === 'all' ? SALE_AREAS.join(' + ') : saleView}: ${sum.count} sales</caption><thead><tr><th scope="col">Size</th><th scope="col">Sales</th><th scope="col">Average</th><th scope="col">Median</th><th scope="col">Lowest</th><th scope="col">Highest</th></tr></thead><tbody>` +
      [...Comps.SALE_GROUPS, 'all'].map((g) => {
        const st = sum.groups[g];
        const tags = mineArea ? [g === nowGroup ? 'buying' : '', g === afterGroup && afterGroup !== nowGroup ? 'after works' : ''].filter(Boolean) : [];
        const cell = (v) => (st.count ? money(v, 'GBP') : '–');
        return `<tr class="${tags.length ? 'mine' : ''} ${g === 'all' ? 'sub' : ''}" data-sale-group="${g}" tabindex="0">
          <th scope="row">${SALE_LABEL[g]}${tags.map((t) => ` <small class="tag local">${t}</small>`).join('')}</th>
          <td>${st.count}</td><td>${cell(st.average)}</td><td>${cell(st.median)}</td><td>${cell(st.min)}</td><td>${cell(st.max)}</td></tr>`;
      }).join('') + '</tbody>';

    const list = SALES.listings
      .filter((l) => (saleView === 'all' || l.district === saleView) && (saleListGroup === 'all' || Comps.rentGroup(l.beds) === saleListGroup))
      .sort((a, b) => b.date.localeCompare(a.date));
    $('saleListingsTitle').textContent = `${SALE_LABEL[saleListGroup]} sales in ${saleView === 'all' ? SALE_AREAS.join(' + ') : saleView} (${list.length})`;
    $('saleListings').innerHTML = list.length
      ? '<thead><tr><th scope="col">Sale agreed</th><th scope="col">Address</th><th scope="col">Beds</th><th scope="col">Type</th><th scope="col">Asking price</th></tr></thead><tbody>' +
        list.map((l) => `<tr><td>${fmtDay(l.date)}</td>
          <td>${l.link ? `<a href="${escapeHtml(l.link)}" target="_blank" rel="noopener">${escapeHtml(l.address)}</a>` : escapeHtml(l.address)}</td>
          <td>${l.beds}</td><td>${escapeHtml(String(l.type || '').replace(/Apartmentses$/, 'Apartments').replace(/s$/, ''))}</td>
          <td>${money(l.price, 'GBP')} <small class="muted">${escapeHtml(l.basis || '')}</small></td></tr>`).join('') + '</tbody>'
      : '<tbody><tr><td class="muted">No sales of this size.</td></tr></tbody>';
  }

  // ---------------------------------------------------------------------------
  // Property news (news.json is refreshed every few hours by the Pages
  // workflow, or fetched live by server.js)
  // ---------------------------------------------------------------------------

  let news = null;
  let newsFeed = null;
  let newsExpanded = false;

  async function loadNews() {
    try {
      const res = await fetch('news.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      news = await res.json();
    } catch (e) {
      news = { error: true };
    }
    renderNews();
  }

  // A word that identifies the local area in a headline (e.g. Belfast, Naas).
  function localWord() {
    if ($('country').value === 'Ireland') return ($('rtbArea').value || $('postcode').value).split(',')[0].trim();
    return (area && area.info && area.info.admin_district) || '';
  }

  function relDate(iso) {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
    if (!Number.isFinite(days)) return '';
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return fmtDay(iso);
  }

  function renderNews() {
    const defaultFeed = { Ireland: 'ie', 'Northern Ireland': 'ni' }[$('country').value] || 'uk';
    const feed = newsFeed || defaultFeed;
    document.querySelectorAll('#newsTabs [data-feed]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.feed === feed)));

    const local = localWord();
    const searchUrl = `https://news.google.com/search?q=${encodeURIComponent(`${local || ({ ie: 'Ireland', ni: 'Northern Ireland', uk: 'UK' })[feed]} property OR rent OR landlord`)}`;
    const searchLink = `<a href="${searchUrl}" target="_blank" rel="noopener">More news${local ? ' for ' + escapeHtml(local) : ''} ↗</a>`;

    const f = news && news.feeds && news.feeds[feed];
    if (!news) return;
    if (news.error || !f || !f.items.length) {
      $('newsList').innerHTML = `<li class="muted">Headlines aren’t available right now${f && f.error ? ` (${escapeHtml(f.error)})` : ''}.</li>`;
      $('newsMore').hidden = true;
      $('newsMeta').innerHTML = searchLink;
      return;
    }

    const re = local && local.length > 2 ? new RegExp(`\\b${local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
    const items = f.items
      .map((it) => ({ ...it, local: re ? re.test(it.title) : false }))
      .sort((a, b) => (b.local - a.local) || String(b.date).localeCompare(String(a.date)));
    const shown = newsExpanded ? items : items.slice(0, 6);
    $('newsList').innerHTML = shown.map((it) => `<li>
        <a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
        <span>${it.local ? '<b class="tag local">' + escapeHtml(local) + '</b>' : ''}${escapeHtml(it.source || '')}${it.date ? ' · ' + relDate(it.date) : ''}</span>
      </li>`).join('');
    $('newsMore').hidden = items.length <= 6;
    $('newsMore').textContent = newsExpanded ? 'Show fewer' : `Show all ${items.length}`;
    $('newsMeta').innerHTML = `Headlines from the last 2 weeks via Google News, updated ${relDate(news.updated)}. ${searchLink}`;
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function fmtDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  function fmtDay(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? escapeHtml(iso || '') : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  }
  function titleCase(s) {
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function syncFinanceVisibility() {
    const m = form.querySelector('input[name="financeMethod"]:checked').value;
    form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== m; });
    $('refiFields').hidden = !$('refinance').checked;
  }

  // ---------------------------------------------------------------------------
  // Persistence (this browser only)
  // ---------------------------------------------------------------------------

  const persisted = () => fieldEls();

  function formState() {
    const state = {};
    for (const el of persisted()) {
      if (el.type === 'radio') { if (el.checked) state[el.name] = el.value; }
      else state[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    state._touched = persisted().filter((el) => el.dataset.touched).map((el) => el.id);
    return state;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(formState())); } catch (e) { /* storage unavailable */ }
  }

  function load() {
    try {
      const state = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!state) return;
      applyState(state);
      status('Your last figures are loaded. Press <b>Analyse area</b> to refresh local data.');
    } catch (e) { /* ignore */ }
  }

  function applyState(state) {
    try {
      for (const el of persisted()) {
        if (el.type === 'radio') el.checked = state[el.name] === el.value;
        else if (el.id in state) {
          if (el.type === 'checkbox') el.checked = !!state[el.id];
          else el.value = state[el.id];
        }
      }
      persisted().forEach((el) => { delete el.dataset.touched; });
      (state._touched || []).forEach((id) => { if ($(id)) $(id).dataset.touched = '1'; });
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Sync across devices (private GitHub gist)
  // ---------------------------------------------------------------------------

  const SYNC = { token: 'deal-analyzer:ghToken', gist: 'deal-analyzer:gistId', deleted: 'deal-analyzer:deleted', dealUpdated: 'deal-analyzer:dealUpdated', last: 'deal-analyzer:lastSync' };
  const NOT_SYNCED = ['pdKey']; // keys stay on each device
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  let syncTimer = null;
  let syncing = false;
  let syncAgain = false;

  function tombstones() {
    try { return JSON.parse(ls.get(SYNC.deleted) || '{}'); } catch (e) { return {}; }
  }
  function forget(items) {
    const t = tombstones();
    items.forEach((c) => { if (c.id) t[c.id] = Date.now(); });
    ls.set(SYNC.deleted, JSON.stringify(t));
  }
  function dealEdited() {
    ls.set(SYNC.dealUpdated, String(Date.now()));
    scheduleSync(4000);
  }

  function localData() {
    const state = formState();
    NOT_SYNCED.forEach((k) => delete state[k]);
    return {
      rents: comps,
      sales,
      deleted: tombstones(),
      deal: { updated: Number(ls.get(SYNC.dealUpdated)) || 0, state },
    };
  }

  function applyData(data) {
    comps = data.rents;
    sales = data.sales;
    try {
      localStorage.setItem(COMPS_KEY, JSON.stringify(comps));
      localStorage.setItem(SOLD_KEY, JSON.stringify(sales));
    } catch (e) { /* ignore */ }
    ls.set(SYNC.deleted, JSON.stringify(data.deleted || {}));
    const mine = Number(ls.get(SYNC.dealUpdated)) || 0;
    if (data.deal && data.deal.updated > mine && data.deal.state) {
      const keep = {};
      NOT_SYNCED.forEach((k) => { keep[k] = $(k) ? $(k).value : ''; });
      applyState({ ...data.deal.state, ...keep });
      ls.set(SYNC.dealUpdated, String(data.deal.updated));
      save();
      syncStrategy();
      syncFinanceVisibility();
      syncCountry();
    }
    refreshEstimates();
  }

  function scheduleSync(delay = 2000) {
    if (!ls.get(SYNC.token)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, delay);
  }

  async function runSync() {
    const token = ls.get(SYNC.token);
    if (!token) return renderSyncStatus();
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    renderSyncStatus('Syncing…', 'busy');
    try {
      const { gistId, data } = await window.DealSync.sync(token, ls.get(SYNC.gist), localData());
      ls.set(SYNC.gist, gistId);
      ls.set(SYNC.last, String(Date.now()));
      applyData(data);
      renderSyncStatus();
    } catch (e) {
      renderSyncStatus(e.message, 'bad');
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(500); }
    }
  }

  function renderSyncStatus(text, tone) {
    const on = !!ls.get(SYNC.token);
    const last = Number(ls.get(SYNC.last));
    $('syncDot').dataset.tone = tone || (on ? 'good' : 'off');
    $('syncLabel').textContent = tone === 'bad' ? 'Not saved online' : text || (on
      ? (last ? `Saved online ${new Date(last).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Saving online')
      : 'Not saved online');
    $('syncSetup').hidden = on;
    $('syncConnected').hidden = !on;
    $('syncMsg').textContent = tone === 'bad' ? text : '';
  }

  $('syncBtn').addEventListener('click', () => {
    $('syncPanel').hidden = !$('syncPanel').hidden;
    if (!$('syncPanel').hidden) $('syncPanel').scrollIntoView({ block: 'nearest' });
  });
  $('syncClose').addEventListener('click', () => { $('syncPanel').hidden = true; });
  $('syncConnect').addEventListener('click', async () => {
    const t = $('syncToken').value.trim();
    if (!t) { $('syncMsg').textContent = 'Paste your access key first.'; return; }
    ls.set(SYNC.token, t);
    $('syncToken').value = '';
    await runSync();
    if (!ls.get(SYNC.last)) ls.del(SYNC.token); // didn't work: stay disconnected
    renderSyncStatus($('syncMsg').textContent || undefined, $('syncMsg').textContent ? 'bad' : undefined);
  });
  $('syncNow').addEventListener('click', runSync);
  $('syncDisconnect').addEventListener('click', () => {
    [SYNC.token, SYNC.gist, SYNC.last].forEach(ls.del);
    renderSyncStatus();
  });
  // Pick up changes made on another device when you come back to the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (Number(ls.get(SYNC.last)) || 0) > 20000) runSync();
  });

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  form.addEventListener('input', (e) => {
    const id = e.target.id;
    if (e.isTrusted && e.target.type !== 'radio') e.target.dataset.touched = '1';
    if (e.isTrusted) dealEdited();
    if (id === 'refurbBudget') $('refurbLevel').value = '';
    if (id === 'beds' || id === 'floorArea' || id === 'refurbLevel') applyRefurbLevel();
    render();
  });
  form.addEventListener('change', (e) => {
    const id = e.target.id;
    if (e.isTrusted) dealEdited();
    if (id === 'refurbLevel') applyRefurbLevel();
    if (id === 'extraBedMethod') applyBedMethod();
    if (id === 'extraBedCost' || id === 'extraBedMonths') $('extraBedMethod').value = 'custom';
    if (id === 'country') syncCountry();
    if (id === 'strategy') syncStrategy();
    syncFinanceVisibility();
    if (['propertyType', 'beds', 'excludeNewBuild', 'rtbArea', 'country', 'postcode', 'extraBeds'].includes(id)) {
      rentListGroup = null;
      saleListGroup = null;
      renderSearchLinks();
      refreshEstimates();
      renderArea();
      renderNews();
    } else if (id === 'price') {
      renderLocalSales();
      if (area) renderArea();
    }
    render();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); analyseArea(); });
  $('postcode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); analyseArea(); } });
  $('analyseBtn').addEventListener('click', analyseArea);
  $('pdKey').addEventListener('change', async () => {
    if (area && area.pc && area.country !== 'Northern Ireland') { await fetchLiveRents($('pdKey').value.trim()); refreshEstimates(); }
  });

  document.addEventListener('click', (e) => {
    const apply = e.target.closest('[data-apply]');
    if (apply) {
      const field = $(apply.dataset.apply);
      field.value = apply.dataset.value;
      delete field.dataset.touched;
      refreshEstimates();
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      $('strategy').value = pick.dataset.pick;
      syncStrategy();
      render();
      return;
    }
    const stab = e.target.closest('[data-sale-area]');
    if (stab) { saleView = stab.dataset.saleArea; renderLocalSales(); return; }
    const sgrp = e.target.closest('[data-sale-group]');
    if (sgrp) { saleListGroup = sgrp.dataset.saleGroup; renderLocalSales(); $('saleListingsWrap').open = true; return; }
    const tab = e.target.closest('[data-rent-area]');
    if (tab) { rentView = tab.dataset.rentArea; renderLocalRents(); return; }
    const grp = e.target.closest('[data-rent-group]');
    if (grp) { rentListGroup = grp.dataset.rentGroup; renderLocalRents(); $('rentListingsWrap').open = true; return; }
  });

  $('newsTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-feed]');
    if (!b) return;
    newsFeed = b.dataset.feed;
    newsExpanded = false;
    renderNews();
  });
  $('newsMore').addEventListener('click', () => { newsExpanded = !newsExpanded; renderNews(); });

  document.addEventListener('keydown', (e) => {
    const pick = e.target.closest && e.target.closest('[data-pick], [data-rent-group], [data-sale-group]');
    if (pick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick.click(); }
  });

  $('resetBtn').addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  });

  load();
  syncStrategy();
  syncFinanceVisibility();
  syncCountry();
  refreshEstimates();
  loadNews();
  renderSyncStatus();
  runSync();
})();
