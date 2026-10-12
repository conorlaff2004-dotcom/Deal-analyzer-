/* UI wiring: read the form, run the maths, render results and the area report. */
(function () {
  'use strict';

  const { analyseDeal, summarise } = window.DealCalc;
  const Data = window.DealData;
  const $ = (id) => document.getElementById(id);
  const form = $('deal');
  const STORE_KEY = 'deal-analyzer:v1';

  const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
  const money = (v) => (Number.isFinite(v) ? gbp0.format(Math.round(v)) : '–');
  const signed = (v) => (v > 0 ? '+' : '') + money(v);
  const pct = (v, d = 1) => (v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(d) + '%' : '–');

  // ---------------------------------------------------------------------------
  // Reading inputs
  // ---------------------------------------------------------------------------

  const fieldEls = () => Array.from(form.querySelectorAll('input, select'));

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

  const REFURB_RATE = { cosmetic: 120, medium: 300, full: 700 }; // £ per m²
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

    // Headline tiles
    $('t-cashLeft').textContent = r.moneyOut ? 'All out' : money(r.cashLeftIn);
    $('t-cashLeftSub').textContent = r.moneyOut
      ? `${money(-r.cashLeftIn)} pulled out on top`
      : r.refinance.enabled
        ? `${pct(r.cashLeftInPct, 0)} of ${money(r.totalCashIn)} invested`
        : 'no refinance';
    setTone($('t-cashflow'), money(r.fullLet.cashflow), r.fullLet.cashflow >= 200 ? 'good' : r.fullLet.cashflow >= 0 ? 'warn' : 'bad');
    setTone($('t-yield'), pct(r.fullLet.grossYieldPrice), r.fullLet.grossYieldPrice >= 7 ? 'good' : r.fullLet.grossYieldPrice >= 5.5 ? 'warn' : 'bad');
    $('t-yieldSub').textContent = `${pct(r.fullLet.netYield)} net on all-in cost`;
    setTone($('t-roi'), r.moneyOut && r.fullLet.cashflow > 0 ? '∞' : pct(r.fullLet.roi), r.fullLet.roi >= 10 ? 'good' : r.fullLet.roi >= 5 ? 'warn' : 'bad');

    renderVerdict(r);

    // Purchase
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

    // Refurb
    $('s-refurb').textContent = money(r.refurb.total + r.holding.total);
    rows($('tbl-refurb'), [
      ['Refurb budget', money(r.refurb.budget)],
      ['Contingency', money(r.refurb.contingency)],
      [`Holding costs (${r.refurb.months} mo)`, money(r.holding.property)],
      r.holding.finance ? [`Finance during works`, money(r.holding.finance)] : null,
      ['Total cash in', money(r.totalCashIn), 'total'],
      ['All-in cost', money(r.allInCost)],
    ]);

    // Refinance
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

    // Full let
    const fl = r.fullLet;
    $('s-let').textContent = money(fl.cashflow) + ' pcm';
    rows($('tbl-let'), [
      ['Rent', money(fl.rent)],
      ['Management', '−' + money(fl.costs.management)],
      ['Maintenance', '−' + money(fl.costs.maintenance)],
      ['Voids', '−' + money(fl.costs.voids)],
      ['Insurance', '−' + money(fl.costs.insurance)],
      fl.costs.serviceCharge ? ['Service charge / ground rent', '−' + money(fl.costs.serviceCharge)] : null,
      ['Certificates & other', '−' + money(fl.costs.other)],
      ['Mortgage', '−' + money(fl.mortgage)],
      ['Cashflow', money(fl.cashflow), 'total ' + (fl.cashflow >= 0 ? 'pos' : 'neg')],
      ['Annual cashflow', money(fl.annualCashflow)],
      ['Gross yield on price / all-in', `${pct(fl.grossYieldPrice)} / ${pct(fl.grossYieldAllIn)}`],
      ['Gross yield on end value', pct(fl.grossYieldGdv)],
      ['Net yield (before mortgage)', pct(fl.netYield)],
      ['ROI on money left in', r.moneyOut && fl.cashflow > 0 ? '∞ (all money out)' : pct(fl.roi)],
      r.ongoingLoan
        ? [`Lender ICR at ${i.stressRate}%`, `${pct(fl.icr, 0)} ${fl.icrPass ? '✓ passes' : '✗ below ' + i.icrTarget + '%'}`, fl.icrPass ? 'pos' : 'neg']
        : null,
      r.ongoingLoan && !fl.icrPass ? ['Max loan this rent supports', money(fl.maxLoanByRent), 'neg'] : null,
    ]);

    // Lodger
    const lo = r.lodger;
    $('s-lodger').textContent = money(lo.cashflow) + ' pcm';
    rows($('tbl-lodger'), [
      [`Room income (${lo.rooms} × ${money(i.lodgerRoomRent)})`, money(lo.income)],
      ['Extra bills', '−' + money(lo.costs.bills)],
      ['Maintenance & voids', '−' + money(lo.costs.maintenance + lo.costs.voids)],
      ['Insurance', '−' + money(lo.costs.insurance)],
      ['Mortgage', '−' + money(lo.mortgage)],
      ['Net after mortgage', money(lo.cashflow), 'total ' + (lo.cashflow >= 0 ? 'pos' : 'neg')],
      ['Mortgage covered by lodgers', pct(lo.mortgageCoverPct, 0)],
      ['Gross yield on price', pct(lo.grossYieldPrice)],
      ['ROI on money left in', r.moneyOut && lo.cashflow > 0 ? '∞ (all money out)' : pct(lo.roi)],
      lo.overRentARoom
        ? ['Taxable above Rent a Room £7,500', money(lo.income * 12 - 7500) + ' / yr']
        : ['Rent a Room relief', 'all tax-free'],
    ]);

    save();
  }

  function setTone(el, text, tone) {
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function renderVerdict(r) {
    const checks = [
      { ok: r.fullLet.grossYieldPrice >= 7, label: `Yield ${pct(r.fullLet.grossYieldPrice)}` },
      { ok: r.fullLet.cashflow >= 200, label: `Cashflow ${money(r.fullLet.cashflow)}` },
      { ok: !r.refinance.enabled || r.cashLeftInPct <= 25, label: r.moneyOut ? 'All money out' : `${pct(r.cashLeftInPct, 0)} left in` },
      { ok: !r.ongoingLoan || r.fullLet.icrPass, label: `ICR ${pct(r.fullLet.icr, 0)}` },
    ];
    const score = checks.filter((c) => c.ok).length;
    const word = score === 4 ? 'Strong deal' : score >= 2 ? 'Worth a closer look' : 'Weak on these numbers';
    const tone = score === 4 ? 'good' : score >= 2 ? 'warn' : 'bad';
    $('verdict').innerHTML =
      `<span class="pill" data-tone="${tone}">${word}</span>` +
      checks.map((c) => `<span class="chip" data-ok="${c.ok}">${c.ok ? '✓' : '✗'} ${c.label}</span>`).join('');
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
    const pc = Data.normalisePostcode($('postcode').value);
    if (!pc) return status('Enter a postcode first.', 'bad');
    $('postcode').value = pc;
    const btn = $('analyseBtn');
    btn.disabled = true;
    btn.textContent = 'Analysing…';
    status(`Looking up ${pc}…`);

    try {
      const info = await Data.lookupPostcode(pc);
      const country = info.country === 'Northern Ireland' || info.country === 'Scotland' || info.country === 'Wales' ? info.country : 'England';
      $('country').value = country;

      status(`Finding sales near ${pc}…`);
      const nearby = await Data.nearbyPostcodes(info.latitude, info.longitude, Number($('radius').value));
      const postcodes = Array.from(new Set([info.postcode, ...nearby.map((p) => p.postcode)]));
      const since = new Date();
      since.setFullYear(since.getFullYear() - Number($('years').value));
      const sinceIso = since.toISOString().slice(0, 10);

      let sales = [];
      let salesError = null;
      if (country === 'England' || country === 'Wales') {
        try {
          sales = await Data.soldPrices(postcodes, sinceIso);
        } catch (e) {
          salesError = e;
        }
      } else {
        salesError = new Error('Land Registry sold prices cover England and Wales only');
      }

      area = { pc, info, country, postcodes, sales, salesError, sinceIso };
      await refreshEstimates(true);
      renderArea();
      const n = usableSales().length;
      status(
        salesError
          ? `Found ${pc} (${info.admin_district || info.region || country}). Sold prices unavailable: ${escapeHtml(salesError.message)}. Rents estimated from regional figures.`
          : `Found ${n} sales near ${pc} since ${fmtDate(sinceIso)}. Estimates applied to fields you haven't edited.`,
        salesError ? 'warn' : 'good'
      );
    } catch (e) {
      status(`Couldn't analyse ${escapeHtml(pc)}: ${escapeHtml(e.message)}. Check the postcode and your connection, or enter figures by hand.`, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Analyse area';
    }
  }

  function usableSales() {
    if (!area) return [];
    const noNew = $('excludeNewBuild').checked;
    return area.sales.filter((s) => s.standard && !(noNew && s.newBuild));
  }

  // Recompute value and rent estimates (e.g. after type / beds change) and
  // apply them to fields the user hasn't typed into.
  async function refreshEstimates(fetchRents) {
    if (!area) return;
    const type = $('propertyType').value;
    const beds = Number($('beds').value) || 0;
    const sales = usableSales();
    const all = summarise(sales.map((s) => s.price));
    const sameType = summarise(sales.filter((s) => s.type === type).map((s) => s.price));
    area.stats = { all, sameType };

    // End value: upper quartile of the same type (a refurbished house should
    // sell towards the top of the local range). Need a few sales to trust it.
    if (sameType.count >= 3) {
      const gdv = Math.round(sameType.upperQuartile / 1000) * 1000;
      hint('gdvHint', 'gdv', gdv,
        `Area: ${TYPE_LABEL[type].toLowerCase()} sales median ${money(sameType.median)}, upper quartile ${money(sameType.upperQuartile)} (${sameType.count} sales)`);
    } else {
      $('gdvHint').innerHTML = `Not enough ${TYPE_LABEL[type].toLowerCase()} sales nearby to suggest an end value. Try a bigger radius or longer period.`;
    }

    // Rents
    const region = Data.regionOf(area.info);
    const key = $('pdKey').value.trim();
    let rent = null;
    let room = null;
    if (key && fetchRents) {
      try {
        const live = await Data.propertyDataRent(key, area.pc, beds);
        if (Number.isFinite(live.monthly)) area.liveRent = { ...live, beds };
      } catch (e) {
        area.liveRentError = e.message;
      }
      try {
        const liveRoom = await Data.propertyDataRoomRent(key, area.pc);
        if (Number.isFinite(liveRoom.monthly)) area.liveRoom = liveRoom;
      } catch (e) { /* fall back to estimate */ }
    }
    const est = Data.estimateRents({ region, localMedianPrice: all.median, beds, type });

    if (area.liveRent && area.liveRent.beds === beds) {
      rent = Math.round(area.liveRent.monthly / 5) * 5;
      const range = area.liveRent.range ? `, typical ${money(area.liveRent.range[0])}–${money(area.liveRent.range[1])}` : '';
      hint('rentHint', 'fullLetRent', rent, `PropertyData: ${beds}-bed asking rents average ${money(area.liveRent.monthly)} pcm${range}`);
    } else if (est) {
      rent = est.fullLet;
      const why = area.liveRentError ? ` (PropertyData failed: ${escapeHtml(area.liveRentError)})` : '';
      hint('rentHint', 'fullLetRent', rent, `Estimate for a ${beds}-bed ${TYPE_LABEL[type].toLowerCase()} in ${region}, scaled to local prices${why}`);
    }
    if (area.liveRoom) {
      room = Math.round(area.liveRoom.monthly / 5) * 5;
      hint('roomHint', 'lodgerRoomRent', room, `PropertyData: double rooms average ${money(area.liveRoom.monthly)} pcm`);
    } else if (est) {
      room = est.room;
      hint('roomHint', 'lodgerRoomRent', room, `Estimate for a double room in ${region}, scaled to local prices`);
    }
    if (!$('lodgerRooms').dataset.touched) $('lodgerRooms').value = Math.max(0, beds - 1);

    render();
  }

  // Show an area figure under a field, with a button to use it. Fields the
  // user hasn't typed into take the figure straight away.
  function hint(hintId, fieldId, value, text) {
    const field = $(fieldId);
    if (!field.dataset.touched) field.value = value;
    const same = Number(field.value) === value;
    $(hintId).innerHTML = `${text}. ` + (same ? `<b>Using ${money(value)}.</b>` : `<button type="button" class="link" data-apply="${fieldId}" data-value="${value}">Use ${money(value)}</button>`);
  }

  function renderArea() {
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
    const comps = sales.filter((s) => s.type === type).slice(0, 30);
    $('comps').innerHTML =
      `<caption>Recent ${TYPE_LABEL[type].toLowerCase()} sales${comps.length === 30 ? ' (latest 30)' : ''}</caption>` +
      `<thead><tr><th scope="col">Date</th><th scope="col">Address</th><th scope="col">Price</th></tr></thead><tbody>` +
      (comps.length
        ? comps.map((s) => `<tr><td>${fmtDate(s.date)}</td><td>${escapeHtml(titleCase(s.address))}, ${s.postcode}</td><td>${money(s.price)}</td></tr>`).join('')
        : `<tr><td colspan="3" class="muted">${area.salesError ? 'Sold prices unavailable.' : 'No sales of this type found. Try a bigger radius or a longer period.'}</td></tr>`) +
      '</tbody>';
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function fmtDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  function titleCase(s) {
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function syncFinanceVisibility() {
    const m = form.querySelector('input[name="financeMethod"]:checked').value;
    form.querySelectorAll('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== m; });
    $('refiFields').hidden = !$('refinance').checked;
  }

  // ---------------------------------------------------------------------------
  // Persistence (this browser only)
  // ---------------------------------------------------------------------------

  function save() {
    try {
      const state = {};
      for (const el of fieldEls()) {
        if (el.type === 'radio') { if (el.checked) state[el.name] = el.value; }
        else state[el.id] = el.type === 'checkbox' ? el.checked : el.value;
      }
      state._touched = fieldEls().filter((el) => el.dataset.touched).map((el) => el.id);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable */ }
  }

  function load() {
    try {
      const state = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!state) return;
      for (const el of fieldEls()) {
        if (el.type === 'radio') el.checked = state[el.name] === el.value;
        else if (el.id in state) {
          if (el.type === 'checkbox') el.checked = !!state[el.id];
          else el.value = state[el.id];
        }
      }
      (state._touched || []).forEach((id) => { if ($(id)) $(id).dataset.touched = '1'; });
      status('Your last figures are loaded. Press <b>Analyse area</b> to refresh local data.');
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  form.addEventListener('input', (e) => {
    const id = e.target.id;
    if (e.isTrusted && e.target.type !== 'radio') e.target.dataset.touched = '1';
    if (id === 'refurbBudget') $('refurbLevel').value = '';
    if (id === 'beds' || id === 'floorArea' || id === 'refurbLevel') applyRefurbLevel();
    render();
  });
  form.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'refurbLevel') applyRefurbLevel();
    syncFinanceVisibility();
    if (area && ['propertyType', 'beds', 'excludeNewBuild'].includes(id)) {
      refreshEstimates(id === 'beds').then(renderArea);
    } else if (area && id === 'price') {
      renderArea();
    }
    render();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); analyseArea(); });
  $('postcode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); analyseArea(); } });
  $('analyseBtn').addEventListener('click', analyseArea);
  $('pdKey').addEventListener('change', () => { if (area) refreshEstimates(true).then(renderArea); });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-apply]');
    if (!btn) return;
    const field = $(btn.dataset.apply);
    field.value = btn.dataset.value;
    delete field.dataset.touched;
    if (area) refreshEstimates(false); else render();
  });

  $('resetBtn').addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  });

  load();
  syncFinanceVisibility();
  render();
})();
