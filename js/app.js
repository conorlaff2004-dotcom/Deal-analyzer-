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
  const pct = (v, d = 1) => (v === Infinity ? '∞' : Number.isFinite(v) ? v.toFixed(d) + '%' : '–');

  // ---------------------------------------------------------------------------
  // Reading inputs
  // ---------------------------------------------------------------------------

  const fieldEls = () => Array.from(form.querySelectorAll('input:not([type="file"]), select')).filter((el) => el.id || el.name);

  function readInputs() {
    const out = {};
    for (const el of fieldEls()) {
      if (el.closest('#parsePreview')) continue;
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
    setTone($('t-cashflow'), money(r.fullLet.cashflow), r.fullLet.cashflow >= 200 ? 'good' : r.fullLet.cashflow >= 0 ? 'warn' : 'bad');
    setTone($('t-yield'), pct(r.fullLet.grossYieldPrice), r.fullLet.grossYieldPrice >= 7 ? 'good' : r.fullLet.grossYieldPrice >= 5.5 ? 'warn' : 'bad');
    $('t-yieldSub').textContent = `${pct(r.fullLet.netYield)} net on all-in cost`;
    setTone($('t-roi'), r.moneyOut && r.fullLet.cashflow > 0 ? '∞' : pct(r.fullLet.roi), r.fullLet.roi >= 10 ? 'good' : r.fullLet.roi >= 5 ? 'warn' : 'bad');

    renderVerdict(r);

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
        ? [`Taxable above Rent a Room ${money(lo.rentARoomLimit)}`, money(lo.income * 12 - lo.rentARoomLimit) + ' / yr']
        : ['Rent a Room relief', `all tax-free (under ${money(lo.rentARoomLimit)})`],
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
  // Country-dependent UI
  // ---------------------------------------------------------------------------

  function syncCountry() {
    const c = $('country').value;
    const sym = c === 'Ireland' ? '€' : '£';
    document.querySelectorAll('.cur').forEach((el) => { el.textContent = sym; });
    form.querySelectorAll('[data-country]').forEach((el) => { el.hidden = el.dataset.country !== c; });
    renderSearchLinks();
    renderComps();
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
    const beds = Number($('beds').value) || 0;
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
  function officialRents() {
    if (!area) return null;
    const beds = Number($('beds').value) || 0;
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
  // Your own listings (3+ in the last 12 months) beat official figures.
  function refreshEstimates() {
    const beds = Number($('beds').value) || 0;
    const s = Comps.summariseComps(comps, { beds, months: 12, currency: currency() });
    const off = officialRents() || {};

    if (s.sameBeds.count >= MIN_COMPS) {
      const m = Math.round(s.sameBeds.median / 5) * 5;
      hint('rentHint', 'fullLetRent', m,
        `Your listings: median of ${s.sameBeds.count} ${beds}-bed rents in the last 12 months (${money(s.sameBeds.min)}–${money(s.sameBeds.max)})` +
        (off.fullLet ? `. Official figure ${money(off.fullLet)}` : ''));
    } else if (off.fullLet) {
      const need = MIN_COMPS - s.sameBeds.count;
      hint('rentHint', 'fullLetRent', off.fullLet, `${off.fullLetText}. Add ${need} more ${beds}-bed listing${need > 1 ? 's' : ''} to use local rents`);
    }

    if (s.rooms.count >= MIN_COMPS) {
      const m = Math.round(s.rooms.median / 5) * 5;
      hint('roomHint', 'lodgerRoomRent', m, `Your listings: median of ${s.rooms.count} room rents in the last 12 months (${money(s.rooms.min)}–${money(s.rooms.max)})`);
    } else if (off.room) {
      hint('roomHint', 'lodgerRoomRent', off.room, off.roomText);
    }

    if (area && area.country !== 'Ireland' && area.country !== 'Northern Ireland') {
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
      $('gdvHint').textContent = 'Sold prices by sale aren’t available here yet. Use recent sales of similar houses on PropertyPal or Daft.';
    }

    if (area && !$('lodgerRooms').dataset.touched) $('lodgerRooms').value = Math.max(0, beds - 1);
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
  // Rent evidence from listings
  // ---------------------------------------------------------------------------

  let comps = loadComps();
  let preview = [];
  const SOURCES = ['PropertyPal', 'Daft', 'Rightmove', 'Zoopla', 'MyHome', 'Rent.ie', 'SpareRoom', 'Agent', 'Other'];

  function loadComps() {
    try { return JSON.parse(localStorage.getItem(COMPS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveComps() {
    try { localStorage.setItem(COMPS_KEY, JSON.stringify(comps)); } catch (e) { /* storage unavailable */ }
  }

  function searchArea() {
    if ($('country').value === 'Ireland') return $('rtbArea').value || $('postcode').value;
    if (area && area.label) return area.label;
    return Data.normalisePostcode($('postcode').value).split(' ')[0];
  }

  function renderSearchLinks() {
    const links = Data.listingSearches({ area: searchArea(), beds: Number($('beds').value) || 0, country: $('country').value });
    $('searchLinks').innerHTML =
      '<span class="links-label">Search:</span>' +
      links.map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join('');
  }

  function detectSource(text) {
    const t = text.toLowerCase();
    const map = [['propertypal', 'PropertyPal'], ['daft', 'Daft'], ['rightmove', 'Rightmove'], ['zoopla', 'Zoopla'], ['myhome', 'MyHome'], ['rent.ie', 'Rent.ie'], ['spareroom', 'SpareRoom']];
    const hit = map.find(([k]) => t.includes(k));
    return hit ? hit[1] : $('country').value === 'Ireland' ? 'Daft' : 'PropertyPal';
  }

  function parsePasted() {
    const text = $('pasteBox').value;
    if (!text.trim()) return;
    const source = detectSource(text);
    const cur = currency();
    preview = Comps.parseListings(text).map((c) => ({
      ...c, source, currency: c.currency || cur,
      beds: c.beds === null && c.kind !== 'room' ? Number($('beds').value) || null : c.beds,
      keep: c.currency === cur,
    }));
    renderPreview(preview.length ? '' : 'No rents found in that text. Copy the page again including the prices, or add one by hand.');
  }

  function addManual() {
    preview.push({ rent: '', currency: currency(), beds: Number($('beds').value) || null, kind: 'whole', type: $('propertyType').value, address: '', date: new Date().toISOString().slice(0, 10), status: 'listed', source: detectSource(''), keep: true });
    renderPreview('');
  }

  function renderPreview(message) {
    const el = $('parsePreview');
    el.hidden = false;
    if (!preview.length) { el.innerHTML = `<p class="status" data-tone="warn">${message}</p>`; return; }
    const opt = (list, v) => list.map((o) => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('');
    el.innerHTML =
      `<p class="note">Found ${preview.length}. Check them, untick any that aren’t comparable, then add.</p>` +
      '<div class="scroll"><table class="comps preview"><thead><tr><th>Add</th><th>Date seen</th><th>Address</th><th>Beds</th><th>Let as</th><th>Rent / month</th><th>Source</th><th>Status</th></tr></thead><tbody>' +
      preview.map((c, k) => `<tr data-k="${k}">
        <td><input type="checkbox" data-f="keep" ${c.keep ? 'checked' : ''} aria-label="Add this rent"></td>
        <td><input type="date" data-f="date" value="${escapeHtml(c.date)}"></td>
        <td><input type="text" data-f="address" value="${escapeHtml(c.address)}" placeholder="Street, area"></td>
        <td><input type="number" data-f="beds" value="${c.beds ?? ''}" min="0" max="12" class="narrow"></td>
        <td><select data-f="kind">${['whole', 'room'].map((o) => `<option value="${o}"${o === c.kind ? ' selected' : ''}>${o === 'room' ? 'Room' : 'Whole property'}</option>`).join('')}</select></td>
        <td><span class="cur-in">${c.currency === 'EUR' ? '€' : '£'}<input type="number" data-f="rent" value="${c.rent}" step="5"></span></td>
        <td><select data-f="source">${opt(SOURCES, c.source)}</select></td>
        <td><select data-f="status">${opt(['listed', 'let agreed'], c.status)}</select></td>
      </tr>`).join('') +
      '</tbody></table></div>' +
      '<div class="row wrap"><button type="button" class="btn primary" id="addSelected">Add selected</button><button type="button" class="btn ghost" id="cancelPreview">Cancel</button></div>';
  }

  function previewEdit(e) {
    const tr = e.target.closest('tr[data-k]');
    if (!tr) return;
    const c = preview[Number(tr.dataset.k)];
    const f = e.target.dataset.f;
    if (!c || !f) return;
    c[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
  }

  function addSelected() {
    const add = preview.filter((c) => c.keep && Number(c.rent) > 0).map(({ keep, ...c }) => ({ ...c, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }));
    comps = comps.concat(add);
    saveComps();
    preview = [];
    $('parsePreview').hidden = true;
    $('pasteBox').value = '';
    renderComps();
    refreshEstimates();
  }

  function renderComps() {
    const beds = Number($('beds').value) || 0;
    const cur = currency();
    const s = Comps.summariseComps(comps, { beds, months: 12, currency: cur });
    $('compsTitle').textContent = `Saved rents (${comps.length})`;
    $('compsSummary').innerHTML = comps.length
      ? [
          `<span><b>${s.recentCount}</b> in the last 12 months</span>`,
          `<span>${beds}-bed median <b>${s.sameBeds.count ? money(s.sameBeds.median) : '–'}</b> (${s.sameBeds.count})</span>`,
          `<span>All whole lets median <b>${s.allWhole.count ? money(s.allWhole.median) : '–'}</b> (${s.allWhole.count})</span>`,
          `<span>Rooms median <b>${s.rooms.count ? money(s.rooms.median) : '–'}</b> (${s.rooms.count})</span>`,
        ].join('')
      : '<span class="muted">No rents saved yet. Use the search links, then paste what you find.</span>';

    const sorted = comps.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $('compsTable').innerHTML = sorted.length
      ? '<thead><tr><th scope="col">Date</th><th scope="col">Address</th><th scope="col">Beds</th><th scope="col">Let as</th><th scope="col">Rent / month</th><th scope="col">Source</th><th scope="col"><span class="sr">Remove</span></th></tr></thead><tbody>' +
        sorted.map((c) => {
          const old = !Comps.withinMonths(c.date, 12);
          const match = c.kind !== 'room' && Number(c.beds) === beds;
          return `<tr class="${old ? 'old' : ''} ${match ? 'mine' : ''}">
            <td>${fmtDay(c.date)}${old ? ' <small>older</small>' : ''}</td>
            <td>${escapeHtml(c.address || '–')}${c.status === 'let agreed' ? ' <small class="tag">let agreed</small>' : ''}</td>
            <td>${c.kind === 'room' ? '–' : c.beds ?? '?'}</td>
            <td>${c.kind === 'room' ? 'Room' : TYPE_LABEL[c.type] || 'Whole'}</td>
            <td>${money(Number(c.rent), c.currency || 'GBP')}</td>
            <td>${escapeHtml(c.source || '')}</td>
            <td><button type="button" class="link" data-remove="${c.id}" aria-label="Remove">✕</button></td></tr>`;
        }).join('') + '</tbody>'
      : '';
  }

  function exportCsv() {
    const blob = new Blob([Comps.toCsv(comps)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rent-comparables-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function importCsv(file) {
    const rows = Comps.fromCsv(await file.text());
    comps = comps.concat(rows.map((c) => ({ ...c, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7) })));
    saveComps();
    renderComps();
    refreshEstimates();
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

  const persisted = () => fieldEls().filter((el) => !el.closest('#parsePreview'));

  function save() {
    try {
      const state = {};
      for (const el of persisted()) {
        if (el.type === 'radio') { if (el.checked) state[el.name] = el.value; }
        else state[el.id] = el.type === 'checkbox' ? el.checked : el.value;
      }
      state._touched = persisted().filter((el) => el.dataset.touched).map((el) => el.id);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable */ }
  }

  function load() {
    try {
      const state = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!state) return;
      for (const el of persisted()) {
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
    if (e.target.closest('#parsePreview')) return previewEdit(e);
    if (e.target.id === 'pasteBox') return;
    const id = e.target.id;
    if (e.isTrusted && e.target.type !== 'radio') e.target.dataset.touched = '1';
    if (id === 'refurbBudget') $('refurbLevel').value = '';
    if (id === 'beds' || id === 'floorArea' || id === 'refurbLevel') applyRefurbLevel();
    render();
  });
  form.addEventListener('change', (e) => {
    if (e.target.closest('#parsePreview')) return previewEdit(e);
    const id = e.target.id;
    if (id === 'importCsv') { if (e.target.files[0]) importCsv(e.target.files[0]); e.target.value = ''; return; }
    if (id === 'refurbLevel') applyRefurbLevel();
    if (id === 'country') syncCountry();
    syncFinanceVisibility();
    if (['propertyType', 'beds', 'excludeNewBuild', 'rtbArea', 'country'].includes(id)) {
      renderComps();
      renderSearchLinks();
      refreshEstimates();
      renderArea();
    } else if (area && id === 'price') {
      renderArea();
    }
    render();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); analyseArea(); });
  $('postcode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); analyseArea(); } });
  $('analyseBtn').addEventListener('click', analyseArea);
  $('parseBtn').addEventListener('click', parsePasted);
  $('addManualBtn').addEventListener('click', addManual);
  $('exportCsv').addEventListener('click', exportCsv);
  $('clearComps').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Click again to delete all';
      setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = 'Clear all'; }, 4000);
      return;
    }
    comps = [];
    saveComps();
    btn.dataset.confirm = '';
    btn.textContent = 'Clear all';
    renderComps();
    refreshEstimates();
  });
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
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      comps = comps.filter((c) => c.id !== rm.dataset.remove);
      saveComps();
      renderComps();
      refreshEstimates();
      return;
    }
    if (e.target.id === 'addSelected') addSelected();
    if (e.target.id === 'cancelPreview') { preview = []; $('parsePreview').hidden = true; }
  });

  $('resetBtn').addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    location.reload();
  });

  load();
  syncFinanceVisibility();
  syncCountry();
  refreshEstimates();
})();
