(function () {
  'use strict';

  // 18 colour families: [dark, light]
  var FAM = [
    ['#2563C9', '#C9DBF8'], ['#2E8B3A', '#C8ECCD'], ['#7448C8', '#E0D4F7'], ['#D6408A', '#F8D0E4'],
    ['#12939E', '#C3EEF0'], ['#F2A93B', '#FCE5B6'], ['#B71C1C', '#F5C6C6'], ['#7A4E2D', '#E8D5C2'],
    ['#1A2F6B', '#BCC6E3'], ['#8DB600', '#E7F4B9'], ['#E8590C', '#FFD3BA'], ['#E3C000', '#FFF4A8'],
    ['#3BA3F0', '#CFE9FC'], ['#B5179E', '#F2C7EB'], ['#6B6B1F', '#E4E4C0'], ['#3D4550', '#D0D5DB'],
    ['#7A1F3D', '#E9C4D0'], ['#FF7A6B', '#FFD9D4']
  ];
  var KEY = 'study-planner-v1';
  var DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PAGE_W = 1123, PAGE_H = 794, MAX_DAYS = 62;

  // ---------- helpers ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function mins(t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; }
  function hhmm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function $(id) { return document.getElementById(id); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function newSheet(name, legend, base) {
    var t = new Date();
    return {
      id: uid(), name: name || 'Sheet 1',
      start: iso(t), end: iso(addDays(t, 27)),
      dayStart: base ? base.dayStart : '08:00', dayEnd: base ? base.dayEnd : '21:00', slot: base ? base.slot : 30,
      legend: legend || [], cells: {}, weekly: {}, imp: {}
    };
  }
  function fixSheet(s) {
    s.id = s.id || uid(); s.name = s.name || 'Sheet';
    s.legend = s.legend || []; s.cells = s.cells || {}; s.weekly = s.weekly || {}; s.imp = s.imp || {};
    s.slot = +s.slot || 30; s.dayStart = s.dayStart || '08:00'; s.dayEnd = s.dayEnd || '21:00';
    if (!s.start || !s.end) { var t = new Date(); s.start = iso(t); s.end = iso(addDays(t, 27)); }
    var seen = {};
    s.legend.forEach(function (l) {
      if (seen[l.f]) for (var i = 0; i < FAM.length; i++) if (!s.legend.some(function (m) { return m.f === i; })) { l.f = i; break; }
      seen[l.f] = true;
    });
    return s;
  }
  // the old one-page timetable stored {legend, cells:{"date|index":[f,s]}}
  function isOld(o) { return o && o.legend && o.cells && !o.sheets && !o.dayStart; }
  function fromOld(o) {
    var s = newSheet('Exams', o.legend.map(function (l) { return { f: l.f, t: l.t, single: !!l.single }; }));
    s.start = '2026-11-17'; s.end = '2026-12-10'; s.dayStart = '08:00'; s.dayEnd = '21:00'; s.slot = 30;
    Object.keys(o.cells).forEach(function (k) {
      var p = k.split('|'), c = o.cells[k];
      s.cells[p[0] + '|' + hhmm(480 + 30 * +p[1])] = { f: c[0], s: c[1] };
    });
    return fixSheet(s);
  }

  // ---------- state ----------
  var app;
  try { app = JSON.parse(localStorage.getItem(KEY)); } catch (e) { app = null; }
  if (!app || !Array.isArray(app.sheets) || !app.sheets.length) app = { v: 1, sheets: [newSheet('Sheet 1')], active: 0 };
  app.sheets.forEach(fixSheet);
  if (!(app.active >= 0 && app.active < app.sheets.length)) app.active = 0;
  app.nowColor = app.nowColor || '#F2A93B';
  app.sessions = app.sessions || [];
  function applyNowColor() { document.documentElement.style.setProperty('--now', app.nowColor); }

  var undoStack = [];
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(app)); } catch (e) {} }
  function snap() { undoStack.push(JSON.stringify(app)); if (undoStack.length > 100) undoStack.shift(); updateUndo(); }
  function undo() {
    if (!undoStack.length) return;
    closePop(); app = JSON.parse(undoStack.pop()); persist(); render(); updateUndo();
  }
  function updateUndo() { $('bUndo').disabled = !undoStack.length; }
  function S() { return app.sheets[app.active]; }

  // ---------- sheet geometry ----------
  function daysOf(s) {
    var out = [], a = parseISO(s.start), b = parseISO(s.end);
    for (var d = new Date(a); d <= b && out.length < MAX_DAYS; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function timesOf(s) {
    var out = [], a = mins(s.dayStart), b = mins(s.dayEnd);
    for (var m = a; m + s.slot <= b; m += s.slot) out.push(hhmm(m));
    return out;
  }
  function effective(s, date, dow, t) {
    var c = s.cells[date + '|' + t];
    if (c) return c.x ? null : c;
    return s.weekly[dow + '|' + t] || null;
  }
  function fromWeekly(s, date, dow, t) { return !s.cells[date + '|' + t] && !!s.weekly[dow + '|' + t]; }

  // ---------- render ----------
  var gridEl = $('grid'), legEl = $('legend'), pop = $('pop');

  function render() {
    applyNowColor();
    if (typeof view !== 'undefined' && view === 'study') { if (window.Planner && window.Planner.onStudyRender) window.Planner.onStudyRender(); return; }
    renderGrid(); renderLegend(); renderTabs(); fit();
  }

  function renderGrid() {
    var s = S(), days = daysOf(s), times = timesOf(s);
    var first = days[0];
    var gaps = days.filter(function (d) { return d.getDay() === 1 && +d !== +first; }).length;
    var colW = Math.max(12, Math.floor((1059 - 46 - gaps * 8) / Math.max(days.length, 1)));
    var hours = times.filter(function (t, i) { return i > 0 && t.slice(3) === '00'; }).length;
    var legendH = 60, avail = PAGE_H - 48 - 84 - 12 - legendH;
    var step = Math.max(8, Math.floor((avail - hours * 2) / Math.max(times.length, 1)));
    var tw = colW - 2, th = step - 2, fs = colW < 24 ? 10 : 12;

    function ml(d) { return (d.getDay() === 1 && +d !== +first) ? 10 : 2; }
    function we(d) { return d.getDay() === 0 || d.getDay() === 6; }

    var h = '<div class="row"><div class="time"></div>';
    days.forEach(function (d) {
      h += '<div class="head' + (we(d) ? ' we' : '') + '" style="width:' + tw + 'px;margin-left:' + ml(d) + 'px"><span style="font-size:' + fs + 'px">' +
        DN[d.getDay()] + ' ' + d.getDate() + ' ' + MN[d.getMonth()] + '</span></div>';
    });
    h += '</div>';
    times.forEach(function (t, i) {
      var onHour = t.slice(3) === '00';
      h += '<div class="row" style="margin-top:' + (onHour && i > 0 ? 4 : 2) + 'px"><div class="time" style="line-height:' + th + 'px">' + (onHour ? t : '') + '</div>';
      days.forEach(function (d) {
        h += '<div class="tile' + (we(d) ? ' we' : '') + '" data-d="' + iso(d) + '" data-w="' + d.getDay() + '" data-t="' + t +
          '" style="width:' + tw + 'px;height:' + th + 'px;margin-left:' + ml(d) + 'px"></div>';
      });
      h += '</div>';
    });
    gridEl.innerHTML = h;
    paint();
  }

  function paint() {
    var s = S();
    gridEl.querySelectorAll('.tile').forEach(function (el) {
      var c = effective(s, el.dataset.d, el.dataset.w, el.dataset.t);
      el.style.background = c && FAM[c.f] ? FAM[c.f][c.s] : '';
      el.classList.toggle('imp', !!s.imp[el.dataset.d + '|' + el.dataset.t]);
    });
    markNow();
  }

  function markNow() {
    var s = S(), n = new Date(), d = iso(n), m = n.getHours() * 60 + n.getMinutes();
    var a = mins(s.dayStart), slotT = hhmm(a + Math.floor((m - a) / s.slot) * s.slot);
    gridEl.querySelectorAll('.tile.now').forEach(function (el) { el.classList.remove('now'); });
    if (m < a) return;
    var el = gridEl.querySelector('.tile[data-d="' + d + '"][data-t="' + slotT + '"]');
    if (el) el.classList.add('now');
  }

  function hoursByFamily() {
    var s = S(), days = daysOf(s), times = timesOf(s), out = {};
    days.forEach(function (d) {
      var di = iso(d), w = d.getDay();
      times.forEach(function (t) {
        var c = effective(s, di, w, t);
        if (c) out[c.f] = (out[c.f] || 0) + s.slot;
      });
    });
    return out;
  }
  function fmtH(m) { var h = m / 60; return (Math.round(h * 10) / 10) + 'h'; }

  function renderLegend() {
    var s = S(), hrs = hoursByFamily();
    legEl.innerHTML = '';
    s.legend.forEach(function (it, idx) {
      var el = document.createElement('div');
      el.className = 'item';
      var shades = it.single ? [0] : [0, 1];
      shades.forEach(function (sh) {
        var sw = document.createElement('span');
        sw.className = 'sw'; sw.style.background = FAM[it.f][sh];
        sw.addEventListener('click', function (e) { e.stopPropagation(); openLegendPop(idx, sw); });
        el.appendChild(sw);
      });
      var tx = document.createElement('span');
      tx.className = 'txt'; tx.contentEditable = 'true'; tx.spellcheck = false; tx.textContent = it.t;
      var snapped = false;
      tx.addEventListener('focus', function () { snapped = false; });
      tx.addEventListener('input', function () { if (!snapped) { snap(); snapped = true; } it.t = tx.textContent; persist(); });
      tx.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tx.blur(); } });
      el.appendChild(tx);
      if (hrs[it.f]) {
        var hs = document.createElement('span');
        hs.className = 'hrs'; hs.textContent = fmtH(hrs[it.f]);
        el.appendChild(hs);
      }
      var x = document.createElement('button');
      x.className = 'del'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove');
      x.addEventListener('click', function () { snap(); s.legend.splice(idx, 1); persist(); renderLegend(); });
      el.appendChild(x);
      legEl.appendChild(el);
    });
    if (s.legend.length < FAM.length) {
      var add = document.createElement('button');
      add.id = 'add'; add.textContent = '+'; add.setAttribute('aria-label', 'Add');
      add.addEventListener('click', function () {
        var f = -1;
        for (var i = 0; i < FAM.length; i++) if (!s.legend.some(function (l) { return l.f === i; })) { f = i; break; }
        if (f < 0) return;
        snap(); s.legend.push({ f: f, t: 'New topic', single: false }); persist(); renderLegend();
        var txts = legEl.querySelectorAll('.txt'), t = txts[txts.length - 1];
        t.focus();
        var r = document.createRange(); r.selectNodeContents(t);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      });
      legEl.appendChild(add);
    }
  }

  // ---------- tabs ----------
  function renderTabs() {
    var tabs = $('tabs');
    tabs.innerHTML = '';
    app.sheets.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'tab' + (i === app.active ? ' on' : '');
      b.textContent = s.name;
      if (i === app.active && app.sheets.length > 1) {
        var x = document.createElement('span');
        x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Delete sheet'); x.setAttribute('role', 'button');
        x.addEventListener('click', function (e) { e.stopPropagation(); confirmDelete(i, b); });
        b.appendChild(x);
      }
      b.addEventListener('click', function () { if (app.active !== i) { app.active = i; persist(); closePop(); render(); } });
      b.addEventListener('dblclick', function () { renameTab(i, b); });
      tabs.appendChild(b);
    });
    var add = document.createElement('button');
    add.id = 'addSheet'; add.textContent = '+'; add.setAttribute('aria-label', 'Add sheet'); add.title = 'Add sheet';
    add.addEventListener('click', function () {
      snap();
      var cur = S();
      app.sheets.push(newSheet('Sheet ' + (app.sheets.length + 1), clone(cur.legend), cur));
      app.active = app.sheets.length - 1; persist(); render();
    });
    tabs.appendChild(add);
  }
  function renameTab(i, b) {
    var s = app.sheets[i];
    var inp = document.createElement('input');
    inp.value = s.name; inp.setAttribute('aria-label', 'Sheet name');
    b.textContent = ''; b.appendChild(inp); inp.focus(); inp.select();
    var done = false;
    function finish(ok) {
      if (done) return; done = true;
      var v = inp.value.trim();
      if (ok && v && v !== s.name) { snap(); s.name = v; persist(); }
      renderTabs();
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    inp.addEventListener('blur', function () { finish(true); });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  function confirmDelete(i, anchor) {
    closePop();
    pop.innerHTML = '<p class="msg"></p><div class="row2"><button class="btn" data-a="no">Cancel</button><button class="btn danger" data-a="yes">Delete</button></div>';
    pop.querySelector('.msg').textContent = 'Delete “' + app.sheets[i].name + '”?';
    pop.querySelector('[data-a="no"]').onclick = closePop;
    pop.querySelector('[data-a="yes"]').onclick = function () {
      snap(); app.sheets.splice(i, 1); app.active = Math.max(0, Math.min(app.active, app.sheets.length - 1));
      persist(); closePop(); render();
    };
    place(anchor, true);
  }

  // ---------- popovers ----------
  var selected = [];
  function place(anchor, above) {
    pop.style.display = 'block';
    var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    var x = r.left + r.width / 2 - pw / 2, y = r.bottom + 6;
    if (above || y + ph > window.innerHeight - 50) y = r.top - ph - 6;
    if (y < 6) y = 6;
    x = Math.max(6, Math.min(x, window.innerWidth - pw - 6));
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function closePop() {
    pop.style.display = 'none'; pop.innerHTML = '';
    selected.forEach(function (t) { t.classList.remove('sel'); });
    selected = [];
  }
  function keyOf(el) { return el.dataset.d + '|' + el.dataset.t; }
  function wkOf(el) { return el.dataset.w + '|' + el.dataset.t; }

  var ICON_REPEAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>';
  var ICON_OUTLINE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1" stroke-dasharray="2 2"/></svg>';

  function openTilePop(anchor) {
    var h = '<div class="grid">';
    for (var half = 0; half < FAM.length; half += 9)
      for (var sh = 0; sh < 2; sh++)
        for (var f = half; f < Math.min(half + 9, FAM.length); f++)
          h += '<button class="c" data-f="' + f + '" data-s="' + sh + '" style="background:' + FAM[f][sh] + '" aria-label="Colour"></button>';
    h += '</div><div class="acts"><button class="clear" aria-label="Clear"></button>' +
      '<button class="ic" data-a="repeat" title="Repeat weekly" aria-label="Repeat weekly">' + ICON_REPEAT + '</button>' +
      '<button class="ic" data-a="imp" title="Outline" aria-label="Outline">' + ICON_OUTLINE + '</button></div>';
    pop.innerHTML = h;
    pop.querySelectorAll('.c').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); applyColour(+b.dataset.f, +b.dataset.s); closePop(); });
    });
    pop.querySelector('.clear').addEventListener('click', function (e) { e.stopPropagation(); clearTiles(); closePop(); });
    pop.querySelector('[data-a="repeat"]').addEventListener('click', function (e) { e.stopPropagation(); toggleRepeat(); popStates(); });
    pop.querySelector('[data-a="imp"]').addEventListener('click', function (e) { e.stopPropagation(); toggleImp(); popStates(); });
    popStates();
    place(anchor);
  }
  function popStates() {
    var s = S();
    var rep = pop.querySelector('[data-a="repeat"]'), imp = pop.querySelector('[data-a="imp"]');
    if (!rep) return;
    var allW = selected.length && selected.every(function (el) { return fromWeekly(s, el.dataset.d, el.dataset.w, el.dataset.t); });
    var anyCol = selected.some(function (el) { return effective(s, el.dataset.d, el.dataset.w, el.dataset.t); });
    rep.classList.toggle('on', !!allW); rep.disabled = !allW && !anyCol;
    imp.classList.toggle('on', selected.length > 0 && selected.every(function (el) { return s.imp[keyOf(el)]; }));
  }

  function applyColour(f, sh) {
    var s = S(); snap();
    selected.forEach(function (el) { s.cells[keyOf(el)] = { f: f, s: sh }; });
    persist(); paint(); renderLegend();
  }
  function clearTiles() {
    var s = S(); snap();
    selected.forEach(function (el) {
      var k = keyOf(el);
      if (s.weekly[wkOf(el)]) s.cells[k] = { x: 1 }; else delete s.cells[k];
      delete s.imp[k];
    });
    persist(); paint(); renderLegend();
  }
  function toggleRepeat() {
    var s = S();
    var allW = selected.every(function (el) { return fromWeekly(s, el.dataset.d, el.dataset.w, el.dataset.t); });
    snap();
    if (allW) {
      selected.forEach(function (el) {
        var wk = wkOf(el), c = s.weekly[wk];
        if (!c) return;
        delete s.weekly[wk];
        s.cells[keyOf(el)] = { f: c.f, s: c.s };
        Object.keys(s.cells).forEach(function (k) {
          var p = k.split('|');
          if (p[1] === el.dataset.t && s.cells[k].x && String(parseISO(p[0]).getDay()) === el.dataset.w) delete s.cells[k];
        });
      });
    } else {
      selected.forEach(function (el) {
        var c = effective(s, el.dataset.d, el.dataset.w, el.dataset.t);
        if (!c) return;
        s.weekly[wkOf(el)] = { f: c.f, s: c.s };
        Object.keys(s.cells).forEach(function (k) {
          var p = k.split('|'), v = s.cells[k];
          if (p[1] !== el.dataset.t || String(parseISO(p[0]).getDay()) !== el.dataset.w) return;
          if (v.x || (v.f === c.f && v.s === c.s)) delete s.cells[k];
        });
      });
    }
    persist(); paint(); renderLegend();
  }
  function toggleImp() {
    var s = S();
    var all = selected.every(function (el) { return s.imp[keyOf(el)]; });
    snap();
    selected.forEach(function (el) { if (all) delete s.imp[keyOf(el)]; else s.imp[keyOf(el)] = true; });
    persist(); paint();
  }

  function openLegendPop(idx, anchor) {
    closePop();
    var s = S(), h = '<div class="grid">';
    for (var f = 0; f < FAM.length; f++) {
      var used = s.legend.some(function (l, j) { return j !== idx && l.f === f; });
      h += '<button class="c' + (used ? ' used' : '') + '"' + (used ? ' disabled' : '') + ' data-f="' + f + '" style="background:' + FAM[f][0] + '" aria-label="Colour"></button>';
    }
    pop.innerHTML = h + '</div>';
    pop.querySelectorAll('.c:not(.used)').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var from = s.legend[idx].f, to = +b.dataset.f;
        if (from !== to) {
          snap();
          s.legend[idx].f = to;
          [s.cells, s.weekly].forEach(function (map) {
            Object.keys(map).forEach(function (k) { if (map[k].f === from) map[k].f = to; });
          });
          persist(); paint(); renderLegend();
        }
        closePop();
      });
    });
    place(anchor);
  }

  // ---------- tile selection: click, or drag across ----------
  var dragging = false;
  gridEl.addEventListener('mousedown', function (e) {
    var t = e.target.closest('.tile'); if (!t || e.button !== 0) return;
    e.preventDefault(); closePop(); dragging = true;
    selected = [t]; t.classList.add('sel');
  });
  gridEl.addEventListener('mouseover', function (e) {
    if (!dragging) return;
    var t = e.target.closest('.tile');
    if (t && selected.indexOf(t) < 0) { selected.push(t); t.classList.add('sel'); }
  });
  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    if (selected.length) openTilePop(selected[selected.length - 1]);
  });
  gridEl.addEventListener('touchend', function (e) {
    var t = e.target.closest('.tile'); if (!t) return;
    e.preventDefault(); closePop(); selected = [t]; t.classList.add('sel'); openTilePop(t);
  });
  document.addEventListener('mousedown', function (e) {
    if (!pop.contains(e.target) && !e.target.closest('.tile')) closePop();
  });

  // ---------- settings ----------
  function openSettings() {
    closePop();
    var s = S();
    $('fName').value = s.name; $('fStart').value = s.start; $('fEnd').value = s.end;
    $('fDayStart').value = s.dayStart; $('fDayEnd').value = s.dayEnd; $('fSlot').value = String(s.slot);
    $('fNow').value = app.nowColor;
    $('fErr').textContent = ''; $('fImport').value = '';
    $('modal').hidden = false; $('fName').focus();
  }
  function closeSettings() { $('modal').hidden = true; }
  $('fCancel').onclick = closeSettings;
  $('modal').addEventListener('mousedown', function (e) { if (e.target === $('modal')) closeSettings(); });
  $('fDone').onclick = function () {
    var name = $('fName').value.trim() || S().name, a = $('fStart').value, b = $('fEnd').value;
    var ds = $('fDayStart').value, de = $('fDayEnd').value, slot = +$('fSlot').value, err = '';
    if (!a || !b) err = 'Pick a first and last day.';
    else if (parseISO(b) < parseISO(a)) err = 'The last day is before the first day.';
    else if ((parseISO(b) - parseISO(a)) / 864e5 + 1 > MAX_DAYS) err = 'Keep a sheet to ' + MAX_DAYS + ' days or fewer.';
    else if (!ds || !de || mins(de) - mins(ds) < slot) err = 'The day must end after it starts.';
    if (err) { $('fErr').textContent = err; return; }
    var s = S(); snap();
    s.name = name; s.start = a; s.end = b; s.dayStart = ds; s.dayEnd = de; s.slot = slot;
    app.nowColor = $('fNow').value || app.nowColor;
    persist(); closeSettings(); render();
  };
  $('fImportBtn').onclick = function () {
    var added = importText($('fImport').value, false);
    if (!added) { $('fErr').textContent = 'That doesn’t look like timetable data.'; return; }
    closeSettings();
  };

  // ---------- open / save ----------
  function importText(text, replaceAll) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return false; }
    if (o && Array.isArray(o.sheets) && o.sheets.length) {
      snap();
      if (replaceAll) { app = { v: 1, sheets: o.sheets.map(fixSheet), active: Math.min(o.active || 0, o.sheets.length - 1), nowColor: o.nowColor || app.nowColor, sessions: o.sessions || app.sessions || [] }; }
      else { o.sheets.forEach(function (s) { s.id = uid(); app.sheets.push(fixSheet(s)); }); app.active = app.sheets.length - 1; }
    } else if (isOld(o)) {
      snap(); app.sheets.push(fromOld(o)); app.active = app.sheets.length - 1;
    } else if (o && o.legend && o.dayStart) {
      snap(); o.id = uid(); app.sheets.push(fixSheet(o)); app.active = app.sheets.length - 1;
    } else return false;
    persist(); render(); return true;
  }

  var fileHandle = null;
  var toastT;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3000);
  }
  function flash(btn) { btn.classList.add('ok'); setTimeout(function () { btn.classList.remove('ok'); }, 1200); }
  function download(data) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = 'study-planner.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  async function saveFile(saveAs) {
    var data = JSON.stringify(app, null, 1);
    if (saveAs) fileHandle = null;
    if (window.showSaveFilePicker) {
      try {
        if (!fileHandle) fileHandle = await window.showSaveFilePicker({
          suggestedName: 'study-planner.json',
          types: [{ description: 'Study planner', accept: { 'application/json': ['.json'] } }]
        });
        var w = await fileHandle.createWritable(); await w.write(data); await w.close();
        flash($('bSave')); toast('Saved to ' + fileHandle.name);
      } catch (e) { if (e.name !== 'AbortError') { fileHandle = null; download(data); flash($('bSave')); toast('Saved to your Downloads folder as study-planner.json'); } }
    } else { download(data); flash($('bSave')); toast('Saved to your Downloads folder as study-planner.json'); }
  }
  async function openFile() {
    if (window.showOpenFilePicker) {
      try {
        var hs = await window.showOpenFilePicker({ types: [{ description: 'Study planner', accept: { 'application/json': ['.json'] } }] });
        var file = await hs[0].getFile(), text = await file.text();
        if (importText(text, true)) { fileHandle = hs[0]; toast('Opened ' + file.name); }
      } catch (e) {}
    } else $('fileIn').click();
  }
  $('fileIn').addEventListener('change', function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (t) { importText(t, true); });
    this.value = '';
  });

  $('bUndo').onclick = undo;
  $('bOpen').onclick = openFile;
  $('bSave').onclick = function (e) { saveFile(e.shiftKey); };
  $('bPrint').onclick = function () { closePop(); window.print(); };
  $('bSettings').onclick = openSettings;

  document.addEventListener('keydown', function (e) {
    var editing = e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    var mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { closePop(); if (!$('modal').hidden) closeSettings(); }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !editing) { e.preventDefault(); undo(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(e.shiftKey); }
  });

  // ---------- fit page to window ----------
  function fit() {
    var sc = $('scaler'), st = $('stage');
    var k = Math.min((st.clientWidth - 24) / PAGE_W, (st.clientHeight - 24) / PAGE_H);
    k = Math.max(0.3, Math.min(k, 1.6));
    sc.style.transform = 'scale(' + k + ')';
    sc.style.width = PAGE_W * k + 'px'; sc.style.height = PAGE_H * k + 'px';
    sc.style.marginTop = Math.max(12, (st.clientHeight - PAGE_H * k) / 2) + 'px';
  }
  window.addEventListener('resize', fit);
  window.addEventListener('beforeprint', function () { closePop(); });

  setInterval(markNow, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) markNow(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (r) { r.update(); }).catch(function () {});
  }

  // ---------- study view ----------
  var view = 'table';
  function setView(v) {
    view = v; closePop();
    var study = v === 'study';
    $('study').hidden = !study; $('stage').hidden = study; $('tabs').hidden = study;
    $('bPrint').hidden = study; $('bSettings').hidden = study;
    $('bStudy').title = study ? 'Timetable' : 'Study';
    $('bStudy').setAttribute('aria-label', study ? 'Timetable' : 'Study');
    $('bStudy').classList.toggle('on', study);
    render();
  }
  $('bStudy').onclick = function () { setView(view === 'study' ? 'table' : 'study'); };

  window.Planner = {
    FAM: FAM, iso: iso, addDays: addDays, uid: uid, parseISO: parseISO,
    timesOf: timesOf, daysOf: daysOf, effective: effective,
    app: function () { return app; }, snap: snap, persist: persist, onStudyRender: null
  };

  render(); updateUndo();
})();
