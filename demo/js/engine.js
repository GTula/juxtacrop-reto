/* =========================================================
   juxtacrop · Rotation engine
   1. conditions(): turns raw NASA/FAO data into field conditions
      (monthly climate, frost/heat days, rain, soil moisture,
      greenness, sowing calendar), applying optional what-if
      adjustments (rain %, temperature °C).
   2. schedule(): places a 3-year rotation on a 36-month calendar
      derived from those conditions (when each crop can be sown,
      how long it occupies the field, what is left bare).
   3. evaluate(): transparent indicators for a rotation (bare
      months, rain on bare soil, water balance, nitrogen, organic
      matter inputs, pest-cycle breaks, climate risks, suitability).
   4. suggest(): builds alternative rotations from templates and
      ranks them by the farmer's priorities.
   Every number is traceable to a dataset or a stated rule —
   there are no yield or profit predictions.
   ========================================================= */

const Engine = (() => {
  const sum = a => a.reduce((s, x) => s + (x || 0), 0);
  const avg = a => { const v = a.filter(x => x != null); return v.length ? sum(v) / v.length : null; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const m0 = m => ((m - 1) % 12 + 12) % 12;           // month 1..12 → 0..11
  const wrap = m => m0(m) + 1;                        // any int → 1..12
  const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const SLOTS = 6;                                    // 3 years × (warm + cool season)
  const slotType = k => (k % 2 === 0 ? 'warm' : 'cool');

  /* ------------------------------------------------------------------
     1. CONDITIONS
     ------------------------------------------------------------------ */
  /** Pre-processes the daily POWER/IMERG series once per location. */
  function prepareDaily(daily) {
    const byMonth = Array.from({ length: 12 }, () => ({ tmax: [], tmin: [], rain: [] }));
    const monthly = {};      // 'YYYY-M' → rain total
    const years = new Set();
    const annual = {};       // year → { rain, tmaxSum, n }
    daily.dates.forEach((dt, i) => {
      const y = +dt.slice(0, 4), m = +dt.slice(4, 6);
      years.add(y);
      const b = byMonth[m - 1];
      if (daily.tmax[i] != null) b.tmax.push(daily.tmax[i]);
      if (daily.tmin[i] != null) b.tmin.push(daily.tmin[i]);
      if (daily.rain[i] != null) {
        b.rain.push(daily.rain[i]);
        monthly[`${y}-${m}`] = (monthly[`${y}-${m}`] || 0) + daily.rain[i];
      }
      annual[y] = annual[y] || { rain: 0, tmax: 0, n: 0 };
      if (daily.rain[i] != null) annual[y].rain += daily.rain[i];
      if (daily.tmax[i] != null) { annual[y].tmax += daily.tmax[i]; annual[y].n++; }
    });
    const nYearsMonth = byMonth.map((b, i) => b.tmax.length / DAYS[i]);
    const first = daily.dates[0], last = daily.dates[daily.dates.length - 1];
    const fullYears = [...years].filter(y => annual[y].n >= 360);
    return { byMonth, monthly, nYearsMonth, annual, fullYears, first, last };
  }

  function trend(xs, ys) {
    const n = xs.length; if (n < 5) return null;
    const mx = avg(xs), my = avg(ys);
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    return den ? num / den : null;
  }

  function percentile(arr, p) {
    const s = arr.filter(x => x != null).sort((a, b) => a - b);
    if (!s.length) return null;
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }

  /**
   * raw: { lat, clim, daily(prepared), smap[], ndvi[], gaez{} }
   * what-if: { dT (°C), rain (factor) } — each a number or a 12-month array (Jan..Dec)
   */
  function conditions(raw, whatIf = { dT: 0, rain: 1 }) {
    const per = (v, d) => (Array.isArray(v) ? v.map(x => x ?? d) : Array(12).fill(v ?? d));
    const dTm = per(whatIf.dT, 0), rfm = per(whatIf.rain, 1);
    const dT = avg(dTm), rf = avg(rfm);
    const south = raw.lat < 0;
    const C = raw.clim, D = raw.daily;
    const t2m = C.T2M.map((v, i) => v + dTm[i]);

    // Rain (IMERG): monthly climatology from complete months
    const rainByM = Array.from({ length: 12 }, () => []);
    Object.entries(D.monthly).forEach(([k, v]) => {
      const [y, m] = k.split('-').map(Number);
      if (D.fullYears.includes(y)) rainByM[m - 1].push(v);
    });
    const rainBase = rainByM.map(a => avg(a) ?? 0);
    const rain = rainBase.map((v, i) => v * rfm[i]);
    // heavy-rain, frost and heat days per month (average year)
    const perYear = (arr, test, i) => arr.filter(test).length / Math.max(1, D.nYearsMonth[i]);
    const heavyDays = D.byMonth.map((b, i) => perYear(b.rain, r => r * rfm[i] >= 50, i));
    const frostDays = D.byMonth.map((b, i) => perYear(b.tmin, t => t + dTm[i] <= 0, i));
    const heatDays = D.byMonth.map((b, i) => perYear(b.tmax, t => t + dTm[i] >= 35, i));
    const tmaxMean = D.byMonth.map((b, i) => (avg(b.tmax) ?? 0) + dTm[i]);
    const tminMean = D.byMonth.map((b, i) => (avg(b.tmin) ?? 0) + dTm[i]);
    const et = C.EVPTRNS.map((v, i) => v * DAYS[i] * (1 + 0.03 * dTm[i])); // ~3 %/°C more evaporative demand (rule of thumb)

    // Recent rain anomaly: last 12 complete months vs climatology
    const keys = Object.keys(D.monthly).map(k => k.split('-').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const last12 = keys.slice(-12);
    const recentRain = sum(last12.map(([y, m]) => D.monthly[`${y}-${m}`]));
    const normalRain12 = sum(last12.map(([, m]) => rainBase[m - 1]));

    // Trends (per decade) from complete years
    const ys = D.fullYears;
    const tmaxTrend = trend(ys, ys.map(y => D.annual[y].tmax / D.annual[y].n));
    const rainTrend = trend(ys, ys.map(y => D.annual[y].rain));

    // SMAP root-zone moisture
    let smap = null;
    if (raw.smap && raw.smap.length >= 12) {
      const byM = Array.from({ length: 12 }, () => []);
      raw.smap.forEach(s => byM[s.m - 1].push(s.v));
      const p20 = percentile(raw.smap.map(s => s.v), 0.2);
      const clim = byM.map(a => avg(a));
      const recent = raw.smap.slice(-6);
      smap = {
        clim, p20,
        dryFreq: byM.map(a => a.length ? a.filter(v => v < p20).length / a.length : null),
        recentAnom: avg(recent.map(s => s.v - clim[s.m - 1])),
        recentFrom: recent[0], recentTo: recent[recent.length - 1],
        years: `${raw.smap[0].y}–${raw.smap[raw.smap.length - 1].y}`,
        n: raw.smap.length,
      };
    }

    // MODIS NDVI greenness
    let ndvi = null;
    if (raw.ndvi && raw.ndvi.length >= 12) {
      const byM = Array.from({ length: 12 }, () => []);
      raw.ndvi.forEach(s => byM[s.m - 1].push(s.v));
      const clim = byM.map(a => avg(a));
      ndvi = { clim, low: clim.map(v => v != null && v < 0.4), years: `${raw.ndvi[0].y}–${raw.ndvi[raw.ndvi.length - 1].y}` };
    }

    // ---- Sowing calendar derived from temperature and frost ----
    const coldest = t2m.indexOf(Math.min(...t2m)) + 1;
    const warmest = t2m.indexOf(Math.max(...t2m)) + 1;
    const findFrom = (start, test) => { for (let i = 1; i <= 12; i++) { const m = wrap(start + i); if (test(m)) return m; } return null; };
    const frostFree = new Set();
    if (frostDays.every(f => f < 1)) for (let m = 1; m <= 12; m++) frostFree.add(m);
    else {
      frostFree.add(warmest);
      for (let i = 1; i < 12 && frostDays[m0(warmest + i)] < 1; i++) frostFree.add(wrap(warmest + i));
      for (let i = 1; i < 12 && frostDays[m0(warmest - i)] < 1; i++) frostFree.add(wrap(warmest - i));
    }
    const tropical = Math.min(...t2m) >= 17;
    let warmStart = findFrom(coldest, m => t2m[m - 1] >= 15 && frostDays[m - 1] < 1);
    if (tropical) { // no cold season: start with the rains
      const driest = rain.indexOf(Math.min(...rain)) + 1;
      warmStart = findFrom(driest, m => rain[m - 1] >= 60) || wrap(driest + 1);
    }
    warmStart = warmStart || wrap(coldest + 4);
    const coolStart = tropical ? wrap(warmStart + 6) : (findFrom(warmest, m => t2m[m - 1] <= 16) || wrap(warmStart + 6));
    const springStart = findFrom(coldest, m => t2m[m - 1] >= 5) || wrap(coldest + 2);
    const winterSevere = Math.min(...t2m) < -2;

    return {
      lat: raw.lat, south, dT, rf,
      t2m, tmaxMean, tminMean, rain, rainBase, rainYear: sum(rain), et, etYear: sum(et),
      frostDays, heatDays, heavyDays, heavyYear: sum(heavyDays),
      recentRain, normalRain12, recentTo: last12[last12.length - 1], tmaxTrend, rainTrend,
      period: `${D.first.slice(0, 4)}–${D.last.slice(0, 4)}`,
      smap, ndvi, gaez: raw.gaez || {},
      cal: { coldest, warmest, warmStart, coolStart, springStart, winterSevere, frostFree, tropical },
    };
  }

  /* ------------------------------------------------------------------
     2. SCHEDULING ON A 36-MONTH CALENDAR
     ------------------------------------------------------------------ */
  const monthAt = (cond, i) => wrap(cond.cal.warmStart + i);
  const offset = (cond, m) => (m - cond.cal.warmStart + 12) % 12;

  /** Months (absolute timeline indexes) a crop occupies when sown at `sow`. */
  function growthSpan(cond, crop, sow, maxEnd) {
    const months = [];
    if (crop.type === 'perennial') {
      for (let i = sow; i <= maxEnd; i++) months.push(i);
      return months;
    }
    let active = 0;
    for (let i = sow; i < sow + 12 && active < crop.grow; i++) {
      months.push(i);
      if (cond.t2m[monthAt(cond, i) - 1] >= crop.tBase) active++;
    }
    return months;
  }

  /**
   * Places the 6 slots of a rotation on the calendar.
   * Runs the cycle twice so crops that wrap into the next cycle are accounted for,
   * and keeps the second pass (steady state).
   */
  function schedule(slots, cond, ctx) {
    const occ = new Array(36).fill(null);            // crop id occupying each month
    const placements = [];                           // per slot (steady-state cycle)
    let cursor = 0;                                  // first free month
    let pendingCover = null;                         // cover/forage that ends when the next crop is sown
    const { cal } = cond;

    for (let cycle = 0; cycle < 2; cycle++) {
      for (let k = 0; k < SLOTS; k++) {
        const id = slots[k];
        const type = slotType(k);
        const year = Math.floor(k / 2);
        const abs = cycle * 36 + year * 12;
        const record = cycle === 1;
        const place = { slot: k, id, type, flags: [], months: [] };
        const finishCover = (sowAt) => {
          if (!pendingCover) return;
          const pc = pendingCover; pendingCover = null;
          pc.months = pc.months.filter(i => i < sowAt);
          if (pc.record) pc.months.forEach(i => { if (i >= 36 && i < 72) occ[i - 36] = pc.id; });
        };

        if (!id || id === 'fallow') {
          if (record) { place.flags.push(id ? ['info', 'Planned fallow (no crop).'] : ['gap', 'Unknown — treated as bare.']); placements.push(place); }
          continue;
        }
        const crop = CROP_BY_ID[id];
        if (!crop) continue;

        // Perennial continuing from the previous slot: already placed
        if (crop.type === 'perennial' && k > 0 && slots[k - 1] === id) { if (record) { place.cont = true; placements.push(place); } continue; }

        let base;
        if (type === 'warm') base = abs + 0;
        else base = abs + offset(cond, cal.coolStart);
        let windowEnd = base + (type === 'warm' ? 2 : 1);

        // Spring-sown cool crop in the warm slot (cold-winter regions)
        if (crop.type === 'cool' && type === 'warm') {
          if (cal.winterSevere && !crop.hardy) {
            base = abs - ((cal.warmStart - cal.springStart + 12) % 12); windowEnd = base + 1;
            place.flags.push(['info', `Spring-sown (${MONTHS_SHORT[cal.springStart - 1]}) as winters here are too cold for it.`]);
          } else place.flags.push(['mid', 'Cool-season crop placed in the warm season: higher heat stress.']);
        }
        if (crop.type === 'warm' && type === 'cool') place.flags.push(['mid', 'Warm-season crop placed in the cool season.']);

        const flexible = crop.isCover || (crop.type === 'cool' && crop.use === 'forage');
        // Covers can be seeded right after the previous harvest
        if (crop.isCover) base = Math.max(base - 2, cursor);
        let sow = Math.max(cursor, base);
        if (pendingCover && sow > pendingCover.sow) { sow = Math.max(base, pendingCover.sow + 2); finishCover(sow); }

        // Feasibility checks
        let infeasible = null;
        if (crop.needsIrrigation && ctx.irrigation === 'none') infeasible = 'Needs irrigation (flooded crop) and none is available.';
        if (!infeasible && crop.type === 'cool' && type === 'cool' && cal.winterSevere && !crop.hardy && !flexible) {
          infeasible = 'Not winter-hardy enough for this climate in the cool season.';
        }
        if (!infeasible && sow > windowEnd + (type === 'warm' ? 1 : 2)) {
          infeasible = `Previous crop is still in the field at sowing time (would be sown in ${MONTHS[monthAt(cond, sow) - 1]}).`;
        }

        let months = [];
        if (!infeasible) {
          if (sow > windowEnd) place.flags.push(['mid', `Late sowing (${MONTHS[monthAt(cond, sow) - 1]}) after the previous crop.`]);
          let maxEnd = sow + 11;
          if (crop.type === 'perennial') {
            let n = 1; while (k + n < SLOTS && slots[k + n] === id) n++;
            const lastSlot = k + n - 1;
            const lastEnd = cycle * 36 + Math.floor(lastSlot / 2) * 12 + (slotType(lastSlot) === 'warm' ? offset(cond, cal.coolStart) - 1 : 11);
            maxEnd = Math.min(sow + crop.span - 1, lastEnd);
          }
          months = growthSpan(cond, crop, sow, maxEnd);
          // Winter-kill of non-hardy covers/forages
          if (crop.type === 'cool' && cal.winterSevere && !crop.hardy && type === 'cool') {
            const killAt = months.findIndex(i => cond.t2m[monthAt(cond, i) - 1] < -2);
            if (killAt >= 0) { months = months.slice(0, killAt); place.flags.push(['info', 'Winter-killed by frost: leaves residue but no living cover in spring.']); }
          }
          // Warm crops must fit in the frost-free season
          if (crop.type === 'warm') {
            const exposed = months.filter(i => !cal.frostFree.has(monthAt(cond, i)));
            if (exposed.length > 1) infeasible = `Frost-free season too short for its ${crop.grow}-month cycle from ${MONTHS[monthAt(cond, sow) - 1]}.`;
          }
        }

        if (infeasible) {
          if (record) { place.flags.push(['bad', infeasible]); place.infeasible = true; placements.push(place); }
          continue;
        }

        place.sow = sow; place.months = months; place.end = months[months.length - 1];
        place.record = record;
        if (flexible && slots[(k + 1) % SLOTS] && slots[(k + 1) % SLOTS] !== 'fallow') {
          // ends when the next crop is sown
          pendingCover = place; place.flexible = true;
          cursor = sow + 2;
        } else {
          if (record) months.forEach(i => { if (i >= 36 && i < 72) occ[i - 36] = id; });
          cursor = place.end + 1;
        }
        if (record) placements.push(place);
      }
    }
    if (pendingCover) { const pc = pendingCover; if (pc.record) pc.months.forEach(i => { if (i >= 36 && i < 72) occ[i - 36] = pc.id; }); }
    // months wrapping past the second cycle land at the start
    placements.forEach(p => { if (p.months) p.months.forEach(i => { if (i >= 72) occ[i - 72] = occ[i - 72] || p.id; }); });
    return { occ, placements };
  }

  /* ------------------------------------------------------------------
     3. INDICATORS
     ------------------------------------------------------------------ */
  function sFactor(slopePct) { // RUSLE slope-steepness factor (McCool et al., 1987)
    const th = Math.atan((slopePct || 0) / 100);
    return slopePct < 9 ? 10.8 * Math.sin(th) + 0.03 : 16.8 * Math.sin(th) - 0.5;
  }

  function evaluate(slots, cond, ctx) {
    const sch = schedule(slots, cond, ctx);
    const { occ, placements } = sch;
    const mAt = i => monthAt(cond, i);
    const living = occ.filter(Boolean).length / 3;
    const bareIdx = occ.map((v, i) => (v ? null : i)).filter(i => i != null);
    const rainOnBare = sum(bareIdx.map(i => cond.rain[mAt(i) - 1])) / 3;
    const heavyOnBare = sum(bareIdx.map(i => cond.heavyDays[mAt(i) - 1])) / 3;
    const slope = ctx.terrain?.slopeMean ?? null;
    const erosion = rainOnBare * sFactor(slope ?? 1);

    const crops = placements.filter(p => p.months && p.months.length && !p.infeasible).map(p => ({ p, c: CROP_BY_ID[p.id] }));
    const risks = [];
    let waterUse = 0, waterDeficit = 0;
    crops.forEach(({ p, c }) => {
      const ms = p.months.map(i => mAt(i));
      const occupied = p.flexible ? p.months.filter(i => occ[((i % 36) + 36) % 36] === p.id).map(i => mAt(i)) : ms;
      const share = c.type === 'perennial' ? occupied.length / 12 : 1;
      const demand = c.type === 'perennial' ? c.water * share : (c.isCover ? c.water * Math.min(1, occupied.length / c.grow) : c.water);
      const supply = sum(occupied.map(m => cond.rain[m - 1]));
      waterUse += demand;
      const tol = [0.85, 0.7, 0.55][c.drought];
      if (ctx.irrigation !== 'full' && supply < demand * tol && !c.isCover) {
        const def = demand * tol - supply;
        waterDeficit += def;
        risks.push({ crop: c, kind: 'water', level: ctx.irrigation === 'some' ? 'mid' : 'bad',
          text: `${c.name}: ~${Math.round(supply)} mm of rain during its cycle vs ~${Math.round(demand)} mm it typically uses${ctx.irrigation === 'some' ? ' (partial irrigation available)' : ''}.`, src: ['imerg', 'agro'] });
      }
      const frost = sum(ms.map(m => cond.frostDays[m - 1]));
      if (c.frost === 0 && frost >= 1) risks.push({ crop: c, kind: 'frost', level: 'bad', text: `${c.name}: ~${frost.toFixed(1)} frost days/yr fall inside its cycle.`, src: ['power'] });
      else if (c.frost === 1 && frost >= 15) risks.push({ crop: c, kind: 'frost', level: 'mid', text: `${c.name}: ${Math.round(frost)} frost days/yr in its cycle — winter survival depends on variety.`, src: ['power'] });
      const heat = sum(ms.map(m => cond.heatDays[m - 1]));
      if ((c.heat === 0 && heat >= 2) || (c.heat === 1 && heat >= 8)) risks.push({ crop: c, kind: 'heat', level: c.heat === 0 ? 'bad' : 'mid', text: `${c.name}: ~${heat.toFixed(1)} days ≥ 35 °C/yr during its cycle (heat stress).`, src: ['power'] });
      const heavy = sum(ms.map(m => cond.heavyDays[m - 1]));
      const wet = ctx.drainage === 'poor' || ctx.drainage === 'limited' || (ctx.terrain?.lowShare ?? 0) > 0.25;
      if (c.waterlog === 0 && heavy >= 0.7 && wet) risks.push({ crop: c, kind: 'waterlog', level: 'mid', text: `${c.name}: sensitive to waterlogging; ~${heavy.toFixed(1)} days/yr with ≥ 50 mm rain in its cycle and ${ctx.drainage === 'unknown' ? 'low spots in the field' : `${ctx.drainage} drainage`}.`, src: ['imerg', 'srtm', 'farmer'] });
      const g = c.gaez ? cond.gaez[c.gaez] : null;
      if (g && g.now != null && g.now < 2500 && !c.isCover) risks.push({ crop: c, kind: 'suit', level: 'bad', text: `${c.name}: low FAO GAEZ suitability here (${Math.round(g.now / 100)}/100).`, src: ['gaez'] });
      if (g && g.now != null && g.future != null && g.future < g.now - 1500) risks.push({ crop: c, kind: 'suit', level: 'mid', text: `${c.name}: GAEZ suitability drops from ${Math.round(g.now / 100)} to ${Math.round(g.future / 100)}/100 by 2041–2070.`, src: ['gaez'] });
      if (c.equipment === 'specialized' && ctx.equipment === 'standard') risks.push({ crop: c, kind: 'equip', level: 'mid', text: `${c.name}: needs specialized machinery or know-how.`, src: ['farmer'] });
    });
    placements.filter(p => p.flags.length).forEach(p => p.flags.forEach(([lvl, txt]) => {
      if (lvl === 'bad' || lvl === 'mid') risks.push({ crop: CROP_BY_ID[p.id], kind: 'timing', level: lvl, text: `${CROP_BY_ID[p.id]?.name || 'Slot'}: ${txt}`, src: ['power'] });
    }));

    // Nitrogen & organic matter
    const seq = crops.slice().sort((a, b) => a.p.sow - b.p.sow);
    const nFix = sum(seq.map(x => x.c.nFix)) / 3;
    const nDemand = sum(seq.map(x => (x.c.isCover ? 0 : x.c.nDemand))) / 3;
    let legumeCredit = 0;
    seq.forEach((x, i) => { const prev = seq[(i - 1 + seq.length) % seq.length]; if (seq.length > 1 && x.c.nDemand >= 1 && !x.c.isCover && prev.c.nFix >= 1) legumeCredit++; });
    const omInputs = (sum(seq.map(x => x.c.residue + (x.c.isCover ? 0.5 : 0))) + living * 3 / 12 * 2) / 3;

    // Pest / disease cycles: consecutive cash crops of the same host group
    const cash = seq.filter(x => !x.c.isCover);
    let repeats = 0;
    cash.forEach((x, i) => { if (cash.length > 1) { const prev = cash[(i - 1 + cash.length) % cash.length]; if (prev.c.host === x.c.host && prev !== x) repeats++; } });
    const hosts = new Set(seq.map(x => x.c.host));

    const harvested = cash.filter(x => x.c.use !== 'cover');
    const forage = harvested.filter(x => x.c.forage || x.c.use === 'forage').length;
    const suit = harvested.map(x => (x.c.gaez && cond.gaez[x.c.gaez] ? cond.gaez[x.c.gaez].now : null)).filter(v => v != null);
    const suitFuture = harvested.map(x => (x.c.gaez && cond.gaez[x.c.gaez] ? cond.gaez[x.c.gaez].future : null)).filter(v => v != null);

    return {
      occ, placements, living, bare: 12 - living, rainOnBare, heavyOnBare, erosion, slope,
      waterUse: waterUse / 3, waterDeficit: waterDeficit / 3,
      nFix, nDemand, legumeCredit, omInputs, repeats, diversity: hosts.size,
      harvests: harvested.length / 3, forage, risks,
      suitNow: avg(suit), suitFuture: avg(suitFuture),
      crops: seq.map(x => x.c),
    };
  }

  /* ------------------------------------------------------------------
     4. PRIORITY FIT & SUGGESTIONS
     ------------------------------------------------------------------ */
  /** Signed change vs the current rotation for each priority (−1 … +1). */
  function deltas(ind, base, ctx) {
    const rel = (a, b, scale) => clamp((a - b) / Math.max(scale, 1e-6), -1, 1);
    return {
      soil: rel(ind.omInputs, base.omInputs, 1.5),
      water: clamp(-(ind.waterDeficit - base.waterDeficit) / 120 - (ind.waterUse - base.waterUse) / 600, -1, 1),
      erosion: base.erosion > 0 ? clamp(-(ind.erosion - base.erosion) / base.erosion, -1, 1) : rel(-ind.erosion, 0, 50),
      nitrogen: clamp((ind.nFix - base.nFix) / 1.2 + (ind.legumeCredit - base.legumeCredit) * 0.15, -1, 1),
      pests: clamp(-(ind.repeats - base.repeats) * 0.35 + (ind.diversity - base.diversity) * 0.15, -1, 1),
      income: clamp((ind.harvests - base.harvests) * 0.8 + (ctx.livestock ? (ind.forage - base.forage) * 0.15 : 0), -1, 1),
    };
  }
  function fit(d, ind, base, weights) {
    let s = 0, w = 0;
    PRIORITIES.forEach(p => { s += (weights[p.id] || 0) * d[p.id]; w += weights[p.id] || 0; });
    const riskPenalty = (ind.risks.filter(r => r.level === 'bad').length - base.risks.filter(r => r.level === 'bad').length) * 0.12;
    return (w ? s / w : 0) - riskPenalty;
  }

  /** Is a crop a reasonable candidate here? (GAEZ, irrigation, equipment) */
  function usable(c, cond, ctx) {
    if (c.needsIrrigation && ctx.irrigation === 'none') return false;
    if (c.equipment === 'specialized' && ctx.equipment === 'standard') return false;
    const g = c.gaez ? cond.gaez[c.gaez] : null;
    if (g && g.now != null && g.now < 3000) return false;
    if (c.type === 'warm' && cond.cal.frostFree.size < c.grow) return false;
    return true;
  }
  const suitOf = (c, cond) => { const g = c.gaez ? cond.gaez[c.gaez] : null; return g && g.now != null ? g.now : 5000; };
  /** First crop of an ordered preference list that is usable here (GAEZ only filters out unsuitable ones). */
  function pick(ids, cond, ctx, fallback = 'fallow') {
    const ok = ids.map(id => CROP_BY_ID[id]).filter(c => c && usable(c, cond, ctx));
    return ok.length ? ok[0].id : fallback;
  }

  /** Replaces harvest crops that can't be scheduled with fallow, then covers empty cool slots. */
  function repair(slots, cond, ctx, coverFor) {
    const s = slots.slice();
    for (let pass = 0; pass < 2; pass++) {
      const { placements } = schedule(s, cond, ctx);
      placements.forEach(p => { if (p.infeasible) s[p.slot] = 'fallow'; });
    }
    if (coverFor) s.forEach((id, k) => { if (slotType(k) === 'cool' && (!id || id === 'fallow')) s[k] = coverFor(s, k); });
    const { placements } = schedule(s, cond, ctx);
    placements.forEach(p => { if (p.infeasible) s[p.slot] = 'fallow'; });
    return s;
  }

  /** Cover crop choice: legume before an N-hungry crop, cereal rye otherwise (SARE guidance). */
  function coverChoice(cond, ctx) {
    return (s, k) => {
      const next = CROP_BY_ID[s[(k + 1) % SLOTS]];
      const dry = ctx.weights.water >= 2 && cond.smap && avg(cond.smap.dryFreq.filter(v => v != null)) > 0.25;
      if (dry) return pick(['oats', 'rye'], cond, ctx);
      if (next && next.nDemand >= 2) return pick(['vetch', 'rye'], cond, ctx);
      return pick(['rye', 'oats', 'vetch'], cond, ctx);
    };
  }

  function suggest(current, cond, ctx) {
    const cover = coverChoice(cond, ctx);
    const base = evaluate(current, cond, ctx);
    const warmCash = current.filter((id, k) => slotType(k) === 'warm' && CROP_BY_ID[id] && !CROP_BY_ID[id].isCover);
    const hostsNow = new Set(warmCash.map(id => CROP_BY_ID[id].host));
    const out = [];

    // A · Keep the crops, cover the bare seasons
    out.push({
      key: 'cover', name: 'Current crops + cover crops',
      why: `Keeps your cash crops and fills the seasons the field sits bare (${base.bare.toFixed(1)} months/yr today) with a cover crop.`,
      slots: repair(current.map((id, k) => (slotType(k) === 'cool' && (!id || id === 'fallow') ? cover(current, k) : id)), cond, ctx, cover),
    });

    // B · Diversify: cereal → legume → third family (+ winter cereal where it fits)
    const cereal = pick(ctx.weights.water >= 2 || cond.rainYear < 600 ? ['sorghum', 'corn'] : ['corn', 'sorghum'], cond, ctx);
    const legume = pick(['soybean', 'drybean', 'peanut'], cond, ctx);
    const third = pick(['sunflower', 'sorghum', 'drybean', 'cotton', 'peanut'].filter(id => !hostsNow.has(CROP_BY_ID[id].host) && id !== cereal && id !== legume), cond, ctx, 'soybean');
    const winterCash = pick(cond.cal.winterSevere ? ['wheat'] : ['wheat', 'barley', 'canola', 'pea'], cond, ctx);
    out.push({
      key: 'diverse', name: 'Diversified 3-crop rotation',
      why: `Rotates three plant families (${[cereal, legume, third].map(id => CROP_BY_ID[id]?.name || id).join(', ')}) plus a winter crop, so pests and diseases that build up on one host lose their food source.`,
      slots: repair([cereal, cover([cereal, 'fallow', legume], 1), legume, winterCash, third, 'fallow'], cond, ctx, cover),
    });

    // C · Water-wise: drought-tolerant summer crops, low-water winter options
    const dryWarm = ['sorghum', 'sunflower', 'peanut', 'cotton'].filter(id => usable(CROP_BY_ID[id], cond, ctx));
    const swap = id => { const c = CROP_BY_ID[id]; if (!c || c.type !== 'warm' || c.drought >= 2) return id; return dryWarm.find(d => CROP_BY_ID[d].host !== c.host) || dryWarm[0] || id; };
    const winterDry = pick(cond.cal.winterSevere ? ['wheat'] : ['chickpea', 'lentil', 'barley', 'wheat'], cond, ctx);
    let waterSlots = current.map((id, k) => (slotType(k) === 'warm' ? swap(id) : id));
    if (waterSlots.every((id, k) => slotType(k) === 'cool' || !CROP_BY_ID[id])) waterSlots = [dryWarm[0] || 'sorghum', 'fallow', legume, 'fallow', dryWarm[1] || dryWarm[0] || 'sunflower', 'fallow'];
    waterSlots[3] = waterSlots[3] && waterSlots[3] !== 'fallow' ? waterSlots[3] : winterDry;
    out.push({
      key: 'water', name: 'Water-wise rotation',
      why: `Swaps the thirstiest summer crops for drought-tolerant ones (${dryWarm.slice(0, 2).map(id => CROP_BY_ID[id].name).join(', ') || 'none available'}) and uses a low-water winter crop.`,
      slots: repair(waterSlots, cond, ctx, null),
    });

    // D · Soil-building perennial forage phase
    const forage = usable(CROP_BY_ID.alfalfa, cond, ctx) && ctx.drainage !== 'poor' ? 'alfalfa' : 'redclover';
    out.push({
      key: 'forage', name: 'Perennial forage phase',
      why: `Two years of ${CROP_BY_ID[forage].name.toLowerCase()} keep the soil covered year-round, add nitrogen and roots, then a grain crop uses that nitrogen.`,
      slots: repair([forage, forage, forage, forage, cereal, 'fallow'], cond, ctx, cover),
    });

    const scored = out.map(s => {
      const ind = evaluate(s.slots, cond, ctx);
      const d = deltas(ind, base, ctx);
      return { ...s, ind, d, fit: fit(d, ind, base, ctx.weights) };
    }).filter(s => s.slots.join() !== current.join());
    // de-duplicate identical plans
    const seen = new Set();
    const uniq = scored.filter(s => { const k = s.slots.join(); if (seen.has(k)) return false; seen.add(k); return true; });
    uniq.sort((a, b) => b.fit - a.fit);
    return { base, options: uniq.slice(0, 3) };
  }

  return { prepareDaily, conditions, schedule, evaluate, deltas, fit, usable, suggest, sFactor, monthAt, slotType, SLOTS, avg, sum, clamp };
})();
