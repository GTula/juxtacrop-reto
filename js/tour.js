/* Guided tours use the real demo state; no sample results or copied controls.
   The tour never opens by itself: the "? Guided tour" button starts it straight on the first real
   step (the location modal, where the farmer searches a field or picks a sample farm). */
(() => {
  const root = document.createElement('div');
  root.className = 'tour-root'; root.hidden = true;
  root.innerHTML = `${Array.from({ length: 4 }, () => '<div class="tour-shade"></div>').join('')}<div class="tour-ring"></div><section class="tour-card" role="dialog" aria-label="Guided tour" tabindex="-1"></section><span class="tour-live" role="status" aria-live="polite"></span>`;
  document.body.append(root);
  const card = root.querySelector('.tour-card'), ring = root.querySelector('.tour-ring');
  const help = document.createElement('button');
  help.className = 'tour-help'; help.textContent = '? Guided tour';
  help.setAttribute('aria-label', 'Help / Guided tour'); $('.demo-brand').append(help);
  let active = false, mode = null, index = 0, steps = [], targets = [], returnFocus, frame;
  let historyConfirmed = false, edited = false, evidence = false, selected = false;
  let screen = 'step', errorSince = 0, reviewing = false;
  const visible = el => el && !el.closest('.hidden') && el.getBoundingClientRect().width > 0;
  const shown = selector => visible($(selector));
  function hideModals() { $$('.modal').forEach(el => { if (el.id !== 'reconModal') el.classList.add('hidden'); }); }
  function expand(id) { const el = $(id); el?.classList.remove('min'); const b = el?.querySelector('.pane-min'); if (b) b.textContent = '–'; }
  function close() {
    active = false; root.hidden = true; document.body.classList.remove('tour-active');
    if (S.drawMode) cancelDraw(true);
    (returnFocus?.isConnected && visible(returnFocus) ? returnFocus : help).focus();
  }
  function shell(label, title, text, body, foot = '') {
    card.innerHTML = `<div class="tour-kicker"><span>${label}</span><button class="tour-close" data-action="close" aria-label="Close guided tour">Close ✕</button></div><h2>${title}</h2><p>${text}</p>${body}${foot}`;
  }
  // No intro screen: resume an unfinished tour, otherwise start on the field that is there (or on the location step).
  function open() {
    returnFocus = document.activeElement; active = true; root.hidden = false;
    document.body.classList.add('tour-active');
    if (mode && index < steps.length) enter(); else start(S.field ? 'current' : 'own');
  }
  function start(kind) {
    hideModals(); stopSim();
    mode = kind; index = 0; historyConfirmed = false; edited = false; evidence = false; selected = false;
    const sample = kind === 'iowa' || kind === 'uruguay';
    if (sample) { clearAll(); loadDemo(kind); }
    steps = [];
    if (sample) steps.push({ id: 'sample', title: 'Your sample farm', text: 'These boundaries follow real fields. Crops and history are fictional. Wait for the plots to appear, then continue.', target: '#paneField', ready: () => S.parcels.length > 0 });
    else {
      if (S.lat === null) steps.push({ id: 'location', title: 'Find your field', text: 'Search for a town or coordinates and select a result, use your location, or pick a sample farm (Iowa or Uruguay).', target: '#onboard .modal-card', enter: openOnboard, ready: () => S.lat !== null, action: true });
      // A sample farm draws its field and plots by itself a moment after the location is set.
      if (!S.field) steps.push({ id: 'field', title: 'Outline your field', text: 'Choose Outline field, tap each corner on the map, then use Finish. Draw a boundary with at least three corners.', target: '#map', extra: '#paneField, #drawBar', ready: () => !!S.field || !!S.demoLoading, action: true });
      if (!S.parcels.length) steps.push({ id: 'plots', title: 'Create management plots', text: 'Split your field with OK, or choose Draw plot and draw inside the field. At least one plot is needed.', target: '#paneField', extra: '#map, #drawBar', ready: () => S.parcels.length > 0 || !!S.demoLoading, action: true });
    }
    steps.push(
      { id: 'overview', title: 'One field, several decisions', text: 'Select a plot to work with its history and future rotation. Farmer input describes your priorities; the rotation bar compares the options.', target: '#paneField' },
      { id: 'history', title: 'Confirm what you planted', text: 'Open Planted before. Review the six seasons, then select Done. Unknown seasons use a simulated reconstruction in this prototype.', target: '#pcHist', ready: () => historyConfirmed && !shown('#reconModal') && !shown('#historyModal'), action: true },
      { id: 'goals', title: 'What matters on your farm?', text: 'Choose up to three goals. Irrigation, machinery and drainage also influence the suggestions. You can keep the current choices.', target: '#inputBody .goals' },
      { id: 'compare', title: 'Compare an alternative', text: 'Choose Cover crops, More crops, Water-wise or Pasture in the rotation bar. Compare its benefits and risks with Now.', target: '#rbPlans', ready: () => selected, action: true },
      { id: 'evidence', title: 'Look behind the suggestion', text: 'Select Data behind this to see evidence, information gaps and indicators. Read the evidence, then choose Next. These are comparisons, not yield or profit predictions.', target: '#planBody', extra: '#rbPlans', ready: () => evidence },
      { id: 'edit', title: 'Make the rotation your own', text: 'Tap a future season, then tap a different crop in Ranked crops. This creates your own plan. Dragging a crop onto a season also works.', target: '#paneRank', extra: '#rbCircles .future, #seasonPop', ready: () => edited, action: true },
      { id: 'finish', title: 'Ready to explore', text: 'Weather lets you explore hypothetical rain and temperature changes. Map view shows satellite layers; Simulate follows the next three years. Review decisions with a local agronomist. Reopen Guided tour whenever you need it.', target: '#paneWeather' }
    );
    enter();
  }
  function enter(review = false) {
    reviewing = review;
    screen = 'step'; errorSince = 0; const step = steps[index];
    hideModals(); expand('#paneField'); expand('#paneInput'); expand('#paneRank'); expand('#paneWeather');
    step.enter?.();
    if (step.id === 'evidence' && S.plan) openPlan(S.heroKey || S.plan.opts[0]?.key || 'current');
    if (step.id === 'edit' && S.plan) { S.sel = { when: 'future', k: 0 }; updateUI(); }
    shell(`Step ${index + 1} of ${steps.length}`, step.title, step.text, '<p class="tour-status" id="tourStatus"></p>', `<div class="tour-progress"><i style="width:${(index + 1) / steps.length * 100}%"></i></div><div class="tour-foot"><button class="btn ghost" data-action="back" ${index === 0 ? 'disabled' : ''}>Back</button><button class="btn primary" data-action="next">${index === steps.length - 1 ? 'Finish' : 'Next'}</button></div>`);
    root.querySelector('.tour-live').textContent = `Step ${index + 1} of ${steps.length}. ${step.title}. ${step.text}`;
    refresh();
    const target = targets[0];
    if (target) target.scrollIntoView({ block: innerWidth <= 820 ? 'center' : 'nearest', behavior: 'instant' });
    layout(); card.focus();
  }
  function refresh() {
    if (!active || screen !== 'step') return;
    const step = steps[index];
    // Loading a sample minimizes this pane after its last UI update.
    if (step.id === 'sample' && S.parcels.length) expand('#paneField');
    let selector = step.target;
    if (step.id === 'history' && shown('#historyModal')) selector = '#historyModal .modal-card';
    if (step.id === 'history' && shown('#reconModal')) selector = '#reconModal .modal-card';
    if (step.id === 'evidence' && shown('#whyModal')) selector = '#whyModal .modal-card';
    if (step.id === 'evidence' && shown('#sourcesModal')) selector = '#sourcesModal .modal-card';
    if (step.id === 'compare' && shown('#planModal')) selector = '#planBody';
    // querySelectorAll with a combined selector returns document order, which
    // can put an auxiliary toolbar before the modal we actually want to anchor.
    targets = [...new Set([...document.querySelectorAll(selector), ...(step.extra ? document.querySelectorAll(step.extra) : [])])].filter(visible);
    const ready = !step.ready || step.ready();
    $('[data-action="next"]', card).disabled = !ready;
    const status = $('#tourStatus');
    const needsData = ['compare', 'evidence', 'edit'].includes(step.id) && !S.plan;
    const failed = needsData && ['power', 'imerg'].some(k => S.status[k] === 'error');
    if (needsData && !errorSince) errorSince = Date.now();
    const slow = needsData && Date.now() - errorSince > 20000;
    const text = failed || slow ? 'Climate data is unavailable or taking longer than usual. Retry the sources, or close the guide and return later.' : needsData ? 'Waiting for climate data and rotation options… You can close the guide at any time.' : ready ? 'Ready when you are.' : 'Use the highlighted controls to complete this step.';
    if (status.dataset.text !== text) {
      status.dataset.text = text; status.textContent = text;
      if (failed || slow) { const retry = document.createElement('button'); retry.className = 'btn ghost'; retry.textContent = 'Retry data'; retry.dataset.action = 'retry'; status.append(retry); }
    }
    // Actual actions advance the guide; informational steps wait for Next.
    if (step.action && ready && !reviewing) { index++; enter(); return; }
    layout();
  }
  function layout() {
    if (!active) return;
    const w = innerWidth, h = innerHeight;
    const r = targets[0]?.getBoundingClientRect();
    let x = 0, y = 0, right = 0, bottom = 0;
    if (r) { x = Math.max(0, r.left - 6); y = Math.max(0, r.top - 6); right = Math.max(x, Math.min(w, r.right + 6)); bottom = Math.max(y, Math.min(h, r.bottom + 6)); }
    const rects = [[0, 0, w, y], [0, y, x, bottom - y], [right, y, w - right, bottom - y], [0, bottom, w, h - bottom]];
    // Extra interactive regions need holes too: use a single SVG mask for all regions.
    const holes = targets.map(el => { const b = el.getBoundingClientRect(); return `<rect x="${b.left - 5}" y="${b.top - 5}" width="${b.width + 10}" height="${b.height + 10}" rx="10" fill="black"/>`; }).join('');
    let svg = root.querySelector('svg');
    if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'; root.prepend(svg); }
    svg.innerHTML = `<defs><mask id="tourMask"><rect width="100%" height="100%" fill="white"/>${holes}</mask></defs><rect width="100%" height="100%" fill="rgba(12,29,22,.68)" mask="url(#tourMask)"/>`;
    root.querySelectorAll('.tour-shade').forEach((el, i) => { const b = rects[i]; el.style.cssText = `left:${b[0]}px;top:${b[1]}px;width:${b[2]}px;height:${b[3]}px;background:transparent;pointer-events:none`; });
    ring.style.cssText = `display:${r ? 'block' : 'none'};left:${x}px;top:${y}px;width:${right - x}px;height:${bottom - y}px`;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = (w - cw) / 2, top = (h - ch) / 2;
    if (r) {
      if (w <= 1200) { left = (w - cw) / 2; top = h - ch - 12; }
      else { left = right + cw + 24 < w ? right + 16 : x - cw - 16 > 0 ? x - cw - 16 : (w - cw) / 2; top = Math.max(12, Math.min(h - ch - 12, y)); if (left < right && left + cw > x) top = bottom + ch + 24 < h ? bottom + 16 : Math.max(12, y - ch - 16); }
    }
    card.style.left = `${Math.max(12, left)}px`; card.style.top = `${Math.max(12, top)}px`;
  }
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
    const action = b.dataset.action;
    if (action === 'close') close();
    else if (action === 'next') { if (index === steps.length - 1) { mode = null; close(); } else { index++; enter(); } }
    else if (action === 'back') { index--; enter(true); }
    else if (action === 'retry') { errorSince = Date.now(); loadData(); refresh(); }
  });
  help.onclick = open;
  const allowed = el => card.contains(el) || targets.some(t => t.contains(el));
  for (const type of ['pointerdown', 'click', 'dblclick', 'contextmenu']) document.addEventListener(type, e => {
    if (active && !allowed(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (active && screen === 'step' && steps[index].id === 'compare' && e.target.closest('[data-plan]')) {
      const key = e.target.closest('[data-plan]').dataset.plan; if (!['current', 'custom'].includes(key)) selected = true;
    }
  }, true);
  document.addEventListener('focusin', e => { if (active && !allowed(e.target)) card.focus(); });
  document.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    if (e.key === 'Tab') {
      const els = [...document.querySelectorAll('button, input, select, a[href], [tabindex="0"]')].filter(el => !el.disabled && visible(el) && allowed(el));
      const pos = els.indexOf(document.activeElement), next = e.shiftKey ? pos - 1 : pos + 1;
      if (pos < 0 || next < 0 || next >= els.length) { e.preventDefault(); (e.shiftKey ? els.at(-1) : els[0])?.focus(); }
    }
  }, true);
  document.addEventListener('demo:history-confirmed', () => { if (active && steps[index]?.id === 'history') historyConfirmed = true; });
  document.addEventListener('demo:evidence-opened', () => { if (active && steps[index]?.id === 'evidence') evidence = true; });
  document.addEventListener('demo:crop-edited', () => { if (active && steps[index]?.id === 'edit') edited = true; });
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = null; refresh(); }); };
  document.addEventListener('demo:updated', schedule);
  new MutationObserver(schedule).observe(document.querySelector('#onboard'), { attributes: true, subtree: true, childList: true });
  new MutationObserver(schedule).observe(document.querySelector('#historyModal'), { attributes: true });
  new MutationObserver(schedule).observe(document.querySelector('#reconModal'), { attributes: true });
  window.addEventListener('resize', schedule); document.addEventListener('scroll', schedule, true);
  // Poll only while open to pick up asynchronous modal transitions and slow-source feedback.
  setInterval(() => { if (active) refresh(); }, 500);
})();
