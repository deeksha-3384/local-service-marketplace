(function () {
  'use strict';
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const ICONS = {
    home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
    plus: 'M12 5v14M5 12h14',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    calendar: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    mic: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
    camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    pin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    menu: 'M3 12h18M3 6h18M3 18h18',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    check: 'M20 6L9 17l-5-5',
    x: 'M18 6L6 18M6 6l12 12',
    briefcase: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    chart: 'M12 20V10M18 20V4M6 20v-4',
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  };
  const ic = (n, s) => '<svg class="ic" width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ICONS[n] || '') + '"/></svg>';

  const CATS = ['plumbing', 'electrical', 'carpentry', 'appliance_repair', 'cleaning', 'painting', 'pest_control', 'other'];
  const STATUSES = ['open', 'offers_received', 'booked', 'in_progress', 'completed', 'cancelled'];
  const LANGS = { en: 'English', hi: 'हिन्दी', kn: 'ಕನ್ನಡ', ta: 'தமிழ்', te: 'తెలుగు', ml: 'മലയാളം', mr: 'मराठी', bn: 'বাংলা' };
  const TL = {
    'request.created': 'Request posted', 'diagnosis.ready': 'AI diagnosis ready', 'offer.created': 'New offer',
    'offer.accepted': 'Offer accepted', 'offer.rejected': 'Offer declined', 'offer.withdrawn': 'Offer withdrawn',
    'booking.created': 'Booking confirmed', 'booking.status_changed': 'Booking updated',
    'request.status_changed': 'Status changed', 'request.cancelled': 'Request cancelled',
    'planner.assigned': 'Provider assigned by the planner', 'planner.declined': 'Assignment declined',
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const label = (s) => String(s || '').replace(/_/g, ' ');
  const money = (cur, v) => (cur || '') + ' ' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const meter = (l) => (l ? '<span class="meter ' + esc(l) + '">' + esc(l) + '</span>' : '');
  const chip = (s) => '<span class="chip ' + esc(s) + '">' + esc(label(s)) + '</span>';
  const skel = (n) => new Array(n || 2).fill('<div class="skel"></div>').join('');

  function empty(icon, title, text, actions, inline) {
    return '<div class="' + (inline ? 'empty' : 'card empty') + '"><div class="big">' + ic(icon, 28) + '</div><h3>' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p>' + (actions || '') + '</div>';
  }

  function stat(icon, text, n, href) {
    const tag = href ? 'a' : 'div';
    const val = typeof n === 'number' ? '<b data-count="' + n + '">0</b>' : '<b>' + esc(n) + '</b>';
    return '<' + tag + ' class="card lift stat"' + (href ? ' href="' + href + '"' : '') + '><div class="ico">' + ic(icon, 20) + '</div>' + val + '<span class="muted">' + esc(text) + '</span></' + tag + '>';
  }

  function countUp(root) {
    root.querySelectorAll('[data-count]').forEach(function (el) {
      const to = Number(el.dataset.count) || 0;
      if (reduced || to === 0) { el.textContent = to; return; }
      const t0 = performance.now();
      (function step(t) {
        const p = Math.min(1, (t - t0) / 700);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  function diagCard(d) {
    if (!d) return '';
    const causes = (d.probable_causes || []).map(function (c) { return '<li>' + esc(c.label) + ' <span class="muted">' + Math.round((c.confidence || 0) * 100) + '%</span></li>'; }).join('');
    const qs = (d.follow_up_questions || []).map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('');
    return '<div class="card"><div class="row"><h3>' + ic('zap') + ' AI diagnosis</h3>' + meter(d.meter_level) + '</div><p>' + esc(d.summary) + '</p>' +
      '<div class="gauge"><i style="width:' + Math.max(4, Number(d.severity_score) || 0) + '%"></i></div>' +
      '<p class="muted small">Severity ' + esc(d.severity_score) + '/100 · about ' + esc(d.estimated_duration_minutes) + ' min on site</p>' +
      (d.safety_warning ? '<div class="notice error">' + esc(d.safety_warning) + '</div>' : '') +
      (causes ? '<h4>Likely causes</h4><ul class="clean">' + causes + '</ul>' : '') +
      (qs ? '<h4>A professional may ask</h4><ul class="clean">' + qs + '</ul>' : '') + '</div>';
  }

  function timeline(items) {
    if (!items || !items.length) return '<p class="muted">Nothing yet.</p>';
    return '<ol class="tl">' + items.map(function (e) {
      return '<li><span class="dot"></span><div><strong>' + esc(TL[e.type] || label(e.type)) + '</strong><div class="muted small">' + fmt(e.created_at) + '</div></div></li>';
    }).join('') + '</ol>';
  }

  // ---------------------------------------------------------------- feedback
  function fatal(text) {
    let b = document.getElementById('ff-fatal');
    if (!b) { b = document.createElement('div'); b.id = 'ff-fatal'; b.className = 'fatal'; document.body.appendChild(b); }
    b.textContent = 'Something broke on this page: ' + text + ' (press F12 and open Console for details)';
  }
  window.addEventListener('error', function (e) { fatal(e.message || 'script error'); });
  window.addEventListener('unhandledrejection', function (e) {
    const r = e.reason;
    if (r && r.name === 'ApiError') return;
    fatal((r && r.message) || 'unknown error');
  });

  function toast(text, type) {
    let r = document.getElementById('ff-toasts');
    if (!r) { r = document.createElement('div'); r.id = 'ff-toasts'; document.body.appendChild(r); }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = text;
    r.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); }, 4200);
  }
  const fail = (e) => toast(e && e.message ? e.message : 'Something went wrong.', 'error');

  function modal(html, opts) {
    const o = opts || {};
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    let closed = false;
    const onKey = function (e) { if (e.key === 'Escape') close(); };
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      back.classList.add('out');
      setTimeout(function () { back.remove(); }, 200);
      if (o.onClose) o.onClose();
    }
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    const first = back.querySelector('input,select,textarea,button');
    if (first) first.focus();
    return { el: back.firstElementChild, close: close };
  }

  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      let result = false;
      const m = modal('<h3>' + esc(title) + '</h3><p class="muted">' + esc(text) + '</p><div class="row end"><button class="btn ghost" data-v="0">Not now</button><button class="btn' + (danger ? ' danger' : '') + '" data-v="1">' + esc(okLabel || 'Confirm') + '</button></div>', { onClose: function () { resolve(result); } });
      m.el.addEventListener('click', function (e) {
        const b = e.target.closest('[data-v]');
        if (b) { result = b.dataset.v === '1'; m.close(); }
      });
    });
  }

  // ---------------------------------------------------------------- shell + router + live updates
  const FF = {
    ic, esc, fmt, label, money, localInput, meter, chip, skel, empty, stat, countUp, diagCard, timeline,
    toast, fail, modal, confirmBox, CATS, STATUSES, LANGS,
    me: null, cfg: null, current: { id: null, reload: null },
    view: function () { return document.getElementById('view'); },
  };
  window.FF = FF;

  let routeId = 0, enterTimer = null, cursor = null, delay = 3000, reloadTimer = null;

  function setActive(h) {
    document.querySelectorAll('.navlink').forEach(function (a) {
      const l = FF.cfg.links.find(function (x) { return x.hash === a.getAttribute('data-h'); });
      const on = !!l && (h === l.hash || (l.also || []).some(function (pre) { return h.indexOf(pre) === 0; }));
      a.classList.toggle('active', on);
    });
  }

  function route() {
    const h = location.hash || FF.cfg.home;
    const my = ++routeId;
    if (FF.current && FF.current.cleanup) { try { FF.current.cleanup(); } catch (e) { /* ignore */ } }
    FF.current = { id: null, reload: null };
    document.getElementById('navlinks').classList.remove('open');
    let found = null;
    for (let i = 0; i < FF.cfg.routes.length && !found; i++) {
      const m = h.match(FF.cfg.routes[i].re);
      if (m) found = { r: FF.cfg.routes[i], m: m };
    }
    if (!found) { location.hash = FF.cfg.home; return; }
    setActive(h);
    const v = FF.view();
    v.classList.add('enter');
    v.innerHTML = skel(2);
    clearTimeout(enterTimer);
    enterTimer = setTimeout(function () { v.classList.remove('enter'); }, 1000);
    window.scrollTo(0, 0);
    const ctx = { m: found.m, alive: function () { return my === routeId; } };
    Promise.resolve().then(function () { return found.r.fn(ctx); }).catch(function (err) {
      if (!ctx.alive()) return;
      if (err && err.status === 401) { FixAPI.goLogin(FF.cfg.role, 'Your session expired. Please log in again.'); return; }
      v.innerHTML = empty('x', 'Could not load this page', (err && err.message) || 'Please try again.', '<button class="btn" id="retry">Try again</button>');
      const b = document.getElementById('retry');
      if (b) b.onclick = route;
    });
  }

  function handleEvents(events) {
    const mine = FF.me.profile.id;
    events.forEach(function (ev) {
      if (ev.actor_id !== mine && FF.cfg.toast) {
        const t = FF.cfg.toast(ev, FF.me);
        if (t) toast(t, 'success');
      }
    });
    const c = FF.current;
    if (c.reload && (c.id === null || events.some(function (e) { return e.request_id === c.id; }))) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () { Promise.resolve().then(c.reload).catch(function () {}); }, 300);
    }
  }

  async function poll() {
    try {
      if (!document.hidden) {
        if (cursor === null) {
          cursor = (await FixAPI.get('/updates', { after_id: 'latest' })).last_id;
        } else {
          const r = await FixAPI.get('/updates', { after_id: cursor });
          cursor = r.last_id;
          if (r.events.length) handleEvents(r.events);
        }
      }
      delay = 3000;
    } catch (e) {
      delay = Math.min(delay * 2, 30000);
    }
    setTimeout(poll, delay);
  }

  async function start(cfg) {
    FF.cfg = cfg;
    const me = await FixAPI.requireRole(cfg.role);
    FF.me = me;
    const p = me.profile;
    const initials = ((p.full_name || p.role).trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('') || '?').toUpperCase();
    const roleName = { customer: 'Customer', provider: 'Service provider', admin: 'Admin' }[p.role] || p.role;
    document.getElementById('app').innerHTML =
      '<header class="appbar"><div class="appbar-in">' +
      '<a class="logo" href="' + cfg.home + '">FixFlow<span>.</span></a>' +
      '<button class="nav-toggle" id="navToggle" aria-label="Menu" type="button">' + ic('menu', 22) + '</button>' +
      '<nav class="navlinks" id="navlinks">' + cfg.links.map(function (l) { return '<a class="navlink" data-h="' + l.hash + '" href="' + l.hash + '">' + ic(l.icon) + '<span>' + esc(l.label) + '</span></a>'; }).join('') + '</nav>' +
      '<div class="appbar-r"><label class="langsel" title="Language for AI replies">' + ic('globe', 16) + '<select id="lang">' + Object.keys(LANGS).map(function (k) { return '<option value="' + k + '"' + (k === (p.language || 'en') ? ' selected' : '') + '>' + LANGS[k] + '</option>'; }).join('') + '</select></label>' +
      '<div class="who"><span class="avatar">' + esc(initials) + '</span><span><span class="who-name">' + esc(p.full_name || 'Account') + '</span><span class="who-role">' + esc(roleName) + '</span></span></div>' +
      '<button class="btn ghost sm" id="logout" type="button">' + ic('logout', 16) + '<span class="lbl">Log out</span></button></div>' +
      '</div></header><main class="page"><div id="view" class="view"></div></main>';

    document.getElementById('navToggle').onclick = function () { document.getElementById('navlinks').classList.toggle('open'); };
    document.getElementById('logout').onclick = async function () { await FixAPI.signOut(); location.href = '/index.html'; };
    document.getElementById('lang').onchange = async function (e) {
      try {
        const upd = await FixAPI.patch('/me', { language: e.target.value });
        FF.me.profile.language = upd.language;
        toast('Saved. AI replies will now be written in ' + LANGS[upd.language] + '.', 'success');
      } catch (err) { fail(err); }
    };
    window.addEventListener('hashchange', route);
    route();
    poll();
  }
  FF.start = start;
})();