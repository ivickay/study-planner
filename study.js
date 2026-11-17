// Study screen: stopwatch / Pomodoro timer, year heatmap, streaks, planned vs actual.
// Loaded after app.js, which exposes window.Planner.
(function () {
  'use strict';
  var P = window.Planner;
  if (!P) return;
  var FAM = P.FAM, iso = P.iso, addDays = P.addDays, uid = P.uid;
  var DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TKEY = 'study-planner-timer';
  var HEAT = ['#EEF1F5', '#C8ECCD', '#8FD19E', '#45A85A', '#2E7D32'];

  var timer;
  try { timer = JSON.parse(localStorage.getItem(TKEY)); } catch (e) { timer = null; }
  if (!timer) timer = { mode: 'watch', subject: null, running: false, start: 0, acc: 0, sessionStart: 0, phase: 'focus', focus: 25, brk: 5, cycles: 0 };
  function saveTimer() { try { localStorage.setItem(TKEY, JSON.stringify(timer)); } catch (e) {} }

  var range = 'week', year = new Date().getFullYear(), showAdd = false;
  var el = document.getElementById('study');

  function app() { return P.app(); }
  function sessions() { var a = app(); a.sessions = a.sessions || []; return a.sessions; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtHM(m) {
    m = Math.round(m || 0);
    var h = Math.floor(m / 60), r = m % 60;
    return h ? h + 'h' + (r ? ' ' + String(r).padStart(2, '0') + 'm' : '') : r + 'm';
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0');
  }

  // subjects = topics in the keys of all sheets (not one-colour entries like Due / Exams)
  function subjects() {
    var out = [], seen = {};
    app().sheets.forEach(function (s) {
      s.legend.forEach(function (l) {
        var n = (l.t || '').trim(), k = n.toLowerCase();
        if (l.single || !n || seen[k]) return;
        seen[k] = true; out.push({ t: n, f: l.f });
      });
    });
    return out;
  }
  function famOf(name, fallback) {
    var s = subjects().filter(function (x) { return x.t.toLowerCase() === String(name || '').toLowerCase(); })[0];
    return s ? s.f : (fallback != null ? fallback : 15);
  }

  // ---------- timer ----------
  function elapsed() { return timer.acc + (timer.running ? Date.now() - timer.start : 0); }
  function phaseLen() { return (timer.phase === 'focus' ? timer.focus : timer.brk) * 60000; }

  function logSession(name, startMs, mins) {
    if (mins < 1) return;
    P.snap();
    sessions().push({ id: uid(), start: startMs, mins: Math.round(mins), t: name || 'Unassigned', f: famOf(name) });
    P.persist();
  }

  var actx;
  function ensureAudio() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) {}
  }
  function beep() {
    if (!actx) return;
    try {
      [0, 0.25, 0.5].forEach(function (t) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
        g.gain.setValueAtTime(0.0001, actx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t + 0.18);
        o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 0.2);
      });
    } catch (e) {}
  }

  function startPause() {
    ensureAudio();
    if (timer.running) { timer.acc += Date.now() - timer.start; timer.running = false; }
    else {
      if (!timer.subject) { var s = subjects()[0]; timer.subject = s ? s.t : null; }
      if (!timer.acc) timer.sessionStart = Date.now();
      timer.start = Date.now(); timer.running = true;
    }
    saveTimer(); render();
  }
  function resetTimer() {
    timer.running = false; timer.acc = 0; timer.sessionStart = 0; timer.phase = 'focus';
    saveTimer(); render();
  }
  function finish() {
    var ms = elapsed();
    if (timer.mode === 'watch' || timer.phase === 'focus') logSession(timer.subject, timer.sessionStart || Date.now() - ms, ms / 60000);
    if (timer.mode === 'pomo' && timer.phase === 'focus') {
      timer.phase = 'break'; timer.acc = 0; timer.start = Date.now(); timer.sessionStart = Date.now(); timer.running = true;
      saveTimer(); render(); return;
    }
    resetTimer();
  }
  function tick() {
    if (timer.mode !== 'pomo' || !timer.running) return false;
    var changed = false;
    while (timer.running && elapsed() >= phaseLen()) {
      var end = timer.start + (phaseLen() - timer.acc);
      if (timer.phase === 'focus') {
        logSession(timer.subject, timer.sessionStart || end - phaseLen(), timer.focus);
        timer.cycles = (timer.cycles || 0) + 1;
        timer.phase = 'break'; timer.acc = 0; timer.start = end; timer.sessionStart = end;
      } else {
        timer.phase = 'focus'; timer.acc = 0; timer.running = false; timer.sessionStart = 0;
      }
      changed = true;
    }
    if (changed) { saveTimer(); beep(); }
    return changed;
  }

  // ---------- numbers ----------
  function minsByDay() {
    var m = {};
    sessions().forEach(function (s) { var d = iso(new Date(s.start)); m[d] = (m[d] || 0) + s.mins; });
    return m;
  }
  function rangeDates(r) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    if (r === 'week') { var mon = addDays(t, -((t.getDay() + 6) % 7)); return [iso(mon), iso(addDays(mon, 6))]; }
    if (r === 'month') return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
    if (r === 'year') return [t.getFullYear() + '-01-01', t.getFullYear() + '-12-31'];
    return ['0000-01-01', '9999-12-31'];
  }
  // planned = light-shade tiles in the timetable, counted once per date & time
  function planned(from, to) {
    var bySub = {}, byDay = {}, seen = {};
    app().sheets.forEach(function (s) {
      var names = {};
      s.legend.forEach(function (l) { if (!l.single && (l.t || '').trim()) names[l.f] = l.t.trim(); });
      var times = P.timesOf(s);
      P.daysOf(s).forEach(function (d) {
        var di = iso(d);
        if (di < from || di > to) return;
        times.forEach(function (t) {
          var k = di + '|' + t;
          if (seen[k]) return;
          var c = P.effective(s, di, d.getDay(), t);
          if (!c || c.s !== 1 || names[c.f] == null) return;
          seen[k] = true;
          bySub[names[c.f]] = (bySub[names[c.f]] || 0) + s.slot;
          byDay[di] = (byDay[di] || 0) + s.slot;
        });
      });
    });
    return { bySub: bySub, byDay: byDay };
  }
  function streaks(dm) {
    var cur = 0, d = new Date();
    if (!dm[iso(d)]) d = addDays(d, -1);
    while (dm[iso(d)]) { cur++; d = addDays(d, -1); }
    var best = 0, run = 0, prev = null;
    Object.keys(dm).sort().forEach(function (k) {
      var dt = P.parseISO(k);
      run = prev && iso(addDays(prev, 1)) === k ? run + 1 : 1;
      best = Math.max(best, run); prev = dt;
    });
    return { cur: cur, best: best };
  }

  // ---------- render ----------
  var ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14l10-7z"/><path d="M19 5v14"/></svg>',
    reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
  };

  function render() {
    if (el.hidden) return;
    var subs = subjects(), dm = minsByDay(), today = iso(new Date());
    var wk = rangeDates('week'), yr = rangeDates('year');
    function sumRange(a, b) { var t = 0; Object.keys(dm).forEach(function (k) { if (k >= a && k <= b) t += dm[k]; }); return t; }
    var st = streaks(dm);
    if (timer.subject && !subs.some(function (s) { return s.t === timer.subject; }) && !timer.running) timer.subject = subs[0] ? subs[0].t : null;

    var h = '<div class="sgrid">';

    // timer card
    h += '<section class="card timer"><div class="seg" role="group" aria-label="Timer mode">' +
      '<button data-mode="watch" class="' + (timer.mode === 'watch' ? 'on' : '') + '"' + (timer.running || timer.acc ? ' disabled' : '') + '>Stopwatch</button>' +
      '<button data-mode="pomo" class="' + (timer.mode === 'pomo' ? 'on' : '') + '"' + (timer.running || timer.acc ? ' disabled' : '') + '>Pomodoro</button></div>';
    h += '<div class="chips">';
    if (!subs.length) h += '<span class="muted">Add topics to your timetable key to pick a subject.</span>';
    subs.forEach(function (s) {
      h += '<button class="chip' + (timer.subject === s.t ? ' on' : '') + '" data-sub="' + esc(s.t) + '"' + (timer.running ? ' disabled' : '') + '><span style="background:' + FAM[s.f][0] + '"></span>' + esc(s.t) + '</button>';
    });
    h += '</div>';
    var pomo = timer.mode === 'pomo';
    h += '<div class="phase">' + (pomo ? (timer.phase === 'focus' ? 'Focus' : 'Break') : '&nbsp;') + '</div>';
    h += '<div id="tDisplay" class="clock">' + fmtClock(pomo ? phaseLen() - elapsed() : elapsed()) + '</div>';
    h += '<div class="ctrls">' +
      '<button class="round main" data-act="go" aria-label="' + (timer.running ? 'Pause' : 'Start') + '">' + (timer.running ? ICON.pause : ICON.play) + '</button>' +
      (pomo ? '<button class="round" data-act="finish" aria-label="Skip to next phase" title="Skip"' + (timer.running || timer.acc ? '' : ' disabled') + '>' + ICON.skip + '</button>'
            : '<button class="round" data-act="finish" aria-label="Finish and save" title="Finish and save"' + (timer.running || timer.acc ? '' : ' disabled') + '>' + ICON.stop + '</button>') +
      '<button class="round" data-act="reset" aria-label="Discard" title="Discard"' + (timer.running || timer.acc ? '' : ' disabled') + '>' + ICON.reset + '</button></div>';
    if (pomo) h += '<div class="pset"><label>Focus <input type="number" min="1" max="180" data-p="focus" value="' + timer.focus + '"' + (timer.running ? ' disabled' : '') + '> min</label>' +
      '<label>Break <input type="number" min="1" max="60" data-p="brk" value="' + timer.brk + '"' + (timer.running ? ' disabled' : '') + '> min</label></div>';
    h += '</section>';

    // summary card
    h += '<section class="card summary">' +
      stat('Today', fmtHM(dm[today] || 0)) + stat('This week', fmtHM(sumRange(wk[0], wk[1]))) +
      stat('Streak', st.cur + (st.cur === 1 ? ' day' : ' days'), 'Best ' + st.best) + stat('This year', fmtHM(sumRange(yr[0], yr[1]))) +
      '</section>';

    // heatmap
    h += '<section class="card heat"><div class="chead"><h2>' + year + '</h2><div class="yr">' +
      '<button class="tool" data-yr="-1" aria-label="Previous year">' + ICON.prev + '</button>' +
      '<button class="tool" data-yr="1" aria-label="Next year">' + ICON.next + '</button></div></div>' + heatmap(dm, today) + '</section>';

    // subjects
    var rd = rangeDates(range), planTo = rd[1] < today ? rd[1] : today;
    var pl = planned(rd[0], planTo).bySub, act = {};
    sessions().forEach(function (s) { var d = iso(new Date(s.start)); if (d >= rd[0] && d <= rd[1]) act[s.t] = (act[s.t] || 0) + s.mins; });
    var names = subs.map(function (s) { return s.t; });
    Object.keys(act).concat(Object.keys(pl)).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    var max = 1;
    names.forEach(function (n) { max = Math.max(max, act[n] || 0, pl[n] || 0); });
    h += '<section class="card subj"><div class="chead"><h2>Subjects</h2><div class="seg small" role="group" aria-label="Period">' +
      ['week', 'month', 'year', 'all'].map(function (r) { return '<button data-range="' + r + '" class="' + (range === r ? 'on' : '') + '">' + r.charAt(0).toUpperCase() + r.slice(1) + '</button>'; }).join('') +
      '</div></div>';
    var any = false;
    names.forEach(function (n) {
      var a = act[n] || 0, p = pl[n] || 0;
      if (!a && !p) return;
      any = true;
      var f = famOf(n);
      h += '<div class="srow"><span class="nm"><span class="dot" style="background:' + FAM[f][0] + '"></span>' + esc(n) + '</span>' +
        '<div class="track"><div class="plan" style="width:' + (p / max * 100) + '%;background:' + FAM[f][1] + '"></div>' +
        '<div class="act" style="width:' + (a / max * 100) + '%;background:' + FAM[f][0] + '"></div></div>' +
        '<span class="num">' + fmtHM(a) + (p ? ' <small>of ' + fmtHM(p) + ' planned</small>' : '') + '</span></div>';
    });
    if (!any) h += '<p class="muted">Nothing studied or planned in this period yet.</p>';
    h += '</section>';

    // sessions
    var list = sessions().slice().sort(function (x, y) { return y.start - x.start; }).slice(0, 12);
    h += '<section class="card sess"><div class="chead"><h2>Sessions</h2><button class="link" data-act="toggleAdd">' + (showAdd ? 'Cancel' : '+ Add time') + '</button></div>';
    if (showAdd) {
      h += '<form class="addf" data-form="add"><label class="sr" for="aSub">Subject</label><select id="aSub">' +
        subs.map(function (s) { return '<option>' + esc(s.t) + '</option>'; }).join('') + '</select>' +
        '<label class="sr" for="aDate">Date</label><input id="aDate" type="date" value="' + today + '">' +
        '<label class="sr" for="aMin">Minutes</label><input id="aMin" type="number" min="1" max="1440" placeholder="mins">' +
        '<button class="btn primary" type="submit">Add</button></form>';
    }
    if (!list.length) h += '<p class="muted">Finished timer sessions appear here.</p>';
    list.forEach(function (s) {
      var d = new Date(s.start);
      h += '<div class="lrow"><span class="dot" style="background:' + FAM[famOf(s.t, s.f)][0] + '"></span><span class="nm">' + esc(s.t) + '</span>' +
        '<span class="muted">' + DN[d.getDay()] + ' ' + d.getDate() + ' ' + MN[d.getMonth()] + ' · ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + '</span>' +
        '<span class="num">' + fmtHM(s.mins) + '</span><button class="x" data-del="' + s.id + '" aria-label="Delete session">×</button></div>';
    });
    h += '</section></div>';

    el.innerHTML = h;
    var hw = el.querySelector('.hwrap'), td = el.querySelector('.hc.today');
    if (hw && td && hw.scrollWidth > hw.clientWidth) hw.scrollLeft = Math.max(0, td.offsetLeft - hw.clientWidth * 0.75);
    updateBar();
  }
  function stat(label, value, sub) {
    return '<div class="stat"><div class="sl">' + label + '</div><div class="sv">' + value + '</div>' + (sub ? '<div class="ss">' + sub + '</div>' : '') + '</div>';
  }

  function heatmap(dm, today) {
    var pl = planned(year + '-01-01', year + '-12-31').byDay;
    var jan1 = new Date(year, 0, 1), first = addDays(jan1, -((jan1.getDay() + 6) % 7)), dec31 = new Date(year, 11, 31);
    var h = '<div class="hwrap"><div class="hmonths">', cells = '', col = 0, lastMonth = -1;
    for (var d = new Date(first); d <= dec31; d = addDays(d, 1)) {
      var di = iso(d), inYear = d.getFullYear() === year, m = dm[di] || 0;
      if ((d.getDay() + 6) % 7 === 0) {
        if (inYear && d.getMonth() !== lastMonth) { h += '<span style="left:' + (col * 15) + 'px">' + MN[d.getMonth()] + '</span>'; lastMonth = d.getMonth(); }
        col++;
      }
      if (inYear && lastMonth === -1) { h += '<span style="left:0">' + MN[0] + '</span>'; lastMonth = 0; }
      var lvl = !m ? 0 : m < 60 ? 1 : m < 120 ? 2 : m < 240 ? 3 : 4;
      var tip = DN[d.getDay()] + ' ' + d.getDate() + ' ' + MN[d.getMonth()] + ' · ' + (m ? fmtHM(m) + ' studied' : 'no study') + (pl[di] ? ' · ' + fmtHM(pl[di]) + ' planned' : '');
      cells += inYear ? '<i class="hc' + (di === today ? ' today' : '') + '" style="background:' + HEAT[lvl] + '" title="' + tip + '"></i>' : '<i class="hc out"></i>';
    }
    h += '</div><div class="hbody"><div class="hdays"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>' +
      '<div class="hgrid">' + cells + '</div></div>' +
      '<div class="hkey">Less' + HEAT.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + 'More</div></div>';
    return h;
  }

  function updateBar() {
    var b = document.getElementById('tRun');
    if (!b) return;
    var on = timer.running || timer.acc;
    b.textContent = on ? fmtClock(timer.mode === 'pomo' ? phaseLen() - elapsed() : elapsed()) : '';
    b.parentNode.classList.toggle('live', !!timer.running);
  }

  // ---------- events ----------
  el.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t || t.disabled) return;
    if (t.dataset.mode) { timer.mode = t.dataset.mode; timer.phase = 'focus'; saveTimer(); render(); }
    else if (t.dataset.sub != null) { timer.subject = t.dataset.sub; saveTimer(); render(); }
    else if (t.dataset.act === 'go') startPause();
    else if (t.dataset.act === 'finish') finish();
    else if (t.dataset.act === 'reset') resetTimer();
    else if (t.dataset.act === 'toggleAdd') { showAdd = !showAdd; render(); }
    else if (t.dataset.range) { range = t.dataset.range; render(); }
    else if (t.dataset.yr) { year += +t.dataset.yr; render(); }
    else if (t.dataset.del) {
      P.snap();
      var a = app(); a.sessions = sessions().filter(function (s) { return s.id !== t.dataset.del; });
      P.persist(); render();
    }
  });
  el.addEventListener('change', function (e) {
    var p = e.target.dataset && e.target.dataset.p;
    if (p) { var v = Math.max(1, Math.min(+e.target.max, Math.round(+e.target.value || 1))); timer[p] = v; saveTimer(); render(); }
  });
  el.addEventListener('submit', function (e) {
    e.preventDefault();
    var sub = document.getElementById('aSub').value, d = document.getElementById('aDate').value, m = +document.getElementById('aMin').value;
    if (!sub || !d || !(m > 0)) return;
    var dt = P.parseISO(d); dt.setHours(12);
    logSession(sub, +dt, m); showAdd = false; render();
  });
  document.addEventListener('keydown', function (e) {
    if (el.hidden || e.code !== 'Space') return;
    if (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return;
    e.preventDefault(); startPause();
  });

  setInterval(function () {
    var changed = tick();
    if (changed) render();
    else {
      var d = document.getElementById('tDisplay');
      if (d && !el.hidden) d.textContent = fmtClock(timer.mode === 'pomo' ? phaseLen() - elapsed() : elapsed());
      updateBar();
    }
  }, 250);
  window.addEventListener('storage', function (e) {
    if (e.key === TKEY) { try { timer = JSON.parse(e.newValue) || timer; } catch (x) {} render(); }
  });

  P.onStudyRender = render;
  tick(); updateBar();
})();
