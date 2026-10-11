(function () {
  'use strict';
  const { ic, esc, fmt, label, localInput, meter, chip, toast, fail, confirmBox, diagCard, timeline, empty, skel, stat, countUp, modal, CATS, LANGS } = FF;
  const api = FixAPI;
  const $ = (s) => document.querySelector(s);
  const pp = () => FF.me.provider_profile || {};
  const needsSetup = () => api.needsProviderSetup(FF.me);
  function gate() {
    if (!needsSetup()) return false;
    toast('Set your skills and service area first.', 'error');
    location.hash = '#/profile';
    return true;
  }

  function offerModal(r, done) {
    const start = new Date(Date.now() + 3600e3); start.setMinutes(0, 0, 0);
    const m = modal('<h3>Make an offer</h3><p class="muted small">' + esc(r.title) + '</p><form id="of" novalidate>' +
      '<div class="grid2"><div class="field"><label>Your price</label><input id="op" type="number" min="1" step="0.01"></div><div class="field"><label>Arrive within (minutes)</label><input id="oe" type="number" min="5" step="5" value="30"></div></div>' +
      '<div class="grid2"><div class="field"><label>Start time</label><input id="os" type="datetime-local" value="' + localInput(start) + '"></div>' +
      '<div class="field"><label>Job length</label><select id="od">' + [1, 2, 3, 4, 6, 8].map((h) => '<option value="' + h + '">' + h + ' hour' + (h > 1 ? 's' : '') + '</option>').join('') + '</select></div></div>' +
      '<div class="field"><label>Message (optional)</label><textarea id="om" rows="3" maxlength="500"></textarea></div>' +
      '<div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" id="osub" type="submit">Send offer</button></div></form>');
    const q = (s) => m.el.querySelector(s);
    q('[data-close]').onclick = m.close;
    q('#of').onsubmit = async function (e) {
      e.preventDefault();
      const price = Math.round(parseFloat(q('#op').value) * 100) / 100;
      const eta = parseInt(q('#oe').value, 10);
      const s = new Date(q('#os').value);
      if (!(price > 0)) return toast('Enter a price.', 'error');
      if (!(eta > 0)) return toast('Enter how soon you can arrive.', 'error');
      if (isNaN(s.getTime())) return toast('Pick a start time.', 'error');
      if (s.getTime() < Date.now() - 4 * 60000) return toast('The start time must be in the future.', 'error');
      const end = new Date(s.getTime() + parseInt(q('#od').value, 10) * 3600e3);
      const btn = q('#osub'); btn.disabled = true;
      try {
        await api.post('/requests/' + r.id + '/offers', { price: price, eta_minutes: eta, message: q('#om').value.trim() || undefined, proposed_start: s.toISOString(), proposed_end: end.toISOString() });
        m.close(); toast('Offer sent. The customer has been notified.', 'success'); if (done) done();
      } catch (err) { fail(err); btn.disabled = false; }
    };
  }

  // ------------------------------------------------------------------ home
  async function home(ctx) {
    if (gate()) return;
    const v = FF.view();
    v.innerHTML = '<div class="card hero-card"><div><p class="eyebrow">Service provider</p><h1>Hi ' + esc((FF.me.profile.full_name || 'there').split(' ')[0]) + ', here is your day</h1><p class="muted" id="modeLine"></p></div><a class="btn" id="cta" href="#/feed">' + ic('search') + ' Find jobs</a></div><div class="stats" id="stats">' + skel(1) + '</div>';
    async function load() {
      const d = await api.get('/provider/dashboard');
      if (!ctx.alive()) return;
      const planner = d.mode === 'planner';
      $('#modeLine').textContent = planner ? 'Planner mode: the Recovery Planner sends you matched jobs.' : 'Independent mode: browse open requests and send your own offers.';
      $('#cta').setAttribute('href', planner ? '#/assignments' : '#/feed');
      $('#cta').innerHTML = planner ? ic('zap') + ' View assignments' : ic('search') + ' Find jobs';
      $('#stats').innerHTML = stat('pin', 'Open jobs nearby', d.open_nearby, planner ? null : '#/feed') + stat('inbox', 'Offers pending', d.pending_offers) +
        stat('zap', 'Assignments waiting', d.pending_assignments, '#/assignments') + stat('calendar', 'Upcoming bookings', d.upcoming_bookings, '#/bookings') +
        stat('star', 'Your rating', d.rating_count ? Number(d.rating).toFixed(1) + ' / 5' : 'No ratings yet');
      countUp($('#stats'));
    }
    FF.current.reload = load;
    await load();
  }

  // ------------------------------------------------------------------ job feed (independent mode)
  async function feed(ctx) {
    if (gate()) return;
    const v = FF.view();
    if (pp().mode !== 'independent') {
      v.innerHTML = empty('briefcase', 'You are in planner mode', 'Jobs are assigned to you automatically. Switch to independent mode to browse open requests and send your own offers.', '<div class="row gap" style="justify-content:center"><a class="btn" href="#/assignments">View assignments</a><a class="btn ghost" href="#/profile">Change mode</a></div>');
      return;
    }
    v.innerHTML = '<div><h1>Open jobs near you</h1><p class="muted">Matching your skills and service area. Send an offer to get booked.</p></div>' +
      '<div class="card filters"><div class="grid4"><div class="field"><label>Search</label><input id="q" placeholder="Title or details"></div>' +
      '<div class="field"><label>Category</label><select id="ct">' + '<option value="">All my categories</option>' + CATS.map((c) => '<option value="' + c + '">' + esc(label(c)) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Urgency</label><select id="mt"><option value="">Any</option><option>low</option><option>medium</option><option>high</option><option>critical</option></select></div>' +
      '<div class="field"><label>Within</label><select id="rd"><option value="">My full area</option><option value="5">5 km</option><option value="10">10 km</option><option value="25">25 km</option></select></div>' +
      '<div class="field"><label>Sort by</label><select id="so"><option value="created_at:desc">Newest</option><option value="severity_score:desc">Most urgent</option><option value="distance:asc">Nearest</option></select></div></div></div>' +
      '<div id="items" class="stack">' + skel(3) + '</div>';
    const byId = {}, translated = {};
    const card = (i) => '<div class="card job lift" data-id="' + esc(i.id) + '"><div class="row"><h3><a href="#/r/' + esc(i.id) + '">' + esc(i.title) + '</a></h3><span class="row gap">' + meter(i.meter_level) + (i.my_offer_status === 'pending' || i.my_offer_status === 'accepted' ? '<span class="chip booked">Offer sent</span>' : '') + '</span></div>' +
      '<p class="muted small">' + esc(label(i.category)) + (i.distance_km != null ? ' · ' + esc(i.distance_km) + ' km away' : '') + ' · ' + i.offer_count + ' offer' + (i.offer_count === 1 ? '' : 's') + ' · ' + fmt(i.created_at) + '</p>' +
      '<p class="clamp">' + esc(i.description) + '</p><div data-tr class="tr hidden"></div>' +
      '<div class="row start gap">' + (i.my_offer_status === 'pending' || i.my_offer_status === 'accepted' ? '' : '<button class="btn sm" data-act="offer">' + ic('check', 16) + ' Make offer</button>') +
      '<a class="btn ghost sm" href="#/r/' + esc(i.id) + '">Details</a><button class="btn ghost sm" data-act="tr">' + ic('globe', 16) + ' Translate</button></div></div>';
    async function load() {
      const so = $('#so').value.split(':');
      const r = await api.get('/requests', { q: $('#q').value.trim(), category: $('#ct').value, meter_level: $('#mt').value, radius_km: $('#rd').value, sort: so[0], order: so[1], limit: 50 });
      if (!ctx.alive()) return;
      r.items.forEach((i) => { byId[i.id] = i; });
      $('#items').innerHTML = r.items.length ? r.items.map(card).join('') : empty('search', 'No open jobs right now', 'New requests in your categories will appear here automatically.', '', true);
      Object.keys(translated).forEach((id) => {
        const el = document.querySelector('.job[data-id="' + id + '"] [data-tr]');
        if (el) { el.textContent = translated[id]; el.classList.remove('hidden'); }
      });
    }
    $('#items').addEventListener('click', async function (e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const cardEl = b.closest('.job'), i = byId[cardEl.dataset.id];
      if (b.dataset.act === 'offer') return offerModal(i, () => load().catch(() => {}));
      const box = cardEl.querySelector('[data-tr]');
      if (translated[i.id]) { delete translated[i.id]; box.classList.add('hidden'); return; }
      b.disabled = true;
      try {
        const r = await api.post('/translate', { text: (i.title + '\n' + i.description).slice(0, 2000), target_lang: FF.me.profile.language || 'en' });
        translated[i.id] = r.text; box.textContent = r.text; box.classList.remove('hidden');
      } catch (err) { fail(err); }
      b.disabled = false;
    });
    ['ct', 'mt', 'rd', 'so'].forEach((id) => $('#' + id).addEventListener('change', () => load().catch(fail)));
    let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 300); });
    FF.current.reload = load;
    await load();
  }

  // ------------------------------------------------------------------ request detail
  async function detail(ctx) {
    if (gate()) return;
    const id = ctx.m[1];
    FF.current.id = id;
    const v = FF.view();
    v.innerHTML = '<a class="back" href="#/feed">← Jobs</a><div id="head" class="card">' + skel(1) + '</div><div id="diag"></div><div class="card hidden" id="tlc"><h2>Timeline</h2><div id="tl"></div></div>';
    async function load() {
      const res = await Promise.all([api.get('/requests/' + id), api.get('/requests/' + id + '/timeline').catch(() => null)]);
      if (!ctx.alive()) return;
      const r = res[0], tl = res[1];
      const photos = (r.media || []).filter((x) => x.kind === 'photo' && x.url).map((x) => '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"><img src="' + esc(x.url) + '" alt=""></a>').join('');
      const audio = (r.media || []).filter((x) => x.kind === 'audio' && x.url).map((x) => '<audio controls src="' + esc(x.url) + '"></audio>').join('');
      const canOffer = (r.status === 'open' || r.status === 'offers_received') && pp().mode === 'independent';
      $('#head').innerHTML = '<div class="row"><h1>' + esc(r.title) + '</h1><span class="row gap">' + meter(r.meter_level) + chip(r.status) + '</span></div>' +
        '<p class="muted small">' + esc(label(r.category)) + ' · posted ' + fmt(r.created_at) + ' · ' + (r.address ? esc(r.address) : 'exact address is shared once you are booked') + '</p><p>' + esc(r.description) + '</p>' +
        (photos ? '<div class="thumbs">' + photos + '</div>' : '') + audio +
        (r.booking ? '<div class="notice">' + ic('calendar') + ' Your booking ' + esc(label(r.booking.status)) + ': ' + fmt(r.booking.slot.start) + ' to ' + fmt(r.booking.slot.end) + '</div>' : '') +
        (canOffer ? '<button class="btn" id="mk">' + ic('check') + ' Make offer</button>' : '');
      $('#diag').innerHTML = diagCard(r.diagnosis);
      if (tl) { $('#tlc').classList.remove('hidden'); $('#tl').innerHTML = timeline(tl.items); }
      const mk = $('#mk'); if (mk) mk.onclick = () => offerModal(r, () => load().catch(() => {}));
    }
    FF.current.reload = load;
    await load();
  }

  // ------------------------------------------------------------------ planner assignments
  async function assignments(ctx) {
    if (gate()) return;
    const v = FF.view();
    v.innerHTML = '<div><h1>Planner assignments</h1><p class="muted">Jobs matched to you by the Recovery Planner. Accept to book the job or decline to release it.</p></div>' +
      (pp().mode === 'independent' ? '<div class="notice">You are in independent mode. Assignments only arrive in planner mode. <a href="#/profile">Change mode</a></div>' : '') +
      '<div id="items" class="stack">' + skel(2) + '</div>';
    async function load() {
      const r = await api.get('/provider/assignments', { limit: 50 });
      if (!ctx.alive()) return;
      $('#items').innerHTML = r.items.length ? r.items.map((a) => '<div class="card lift"><div class="row"><h3>' + esc(a.request.title) + '</h3><span class="row gap">' + meter(a.request.meter_level) + '<span class="chip open">Match ' + Math.round(a.score || 0) + '%</span></span></div>' +
        '<p class="muted small">' + esc(label(a.request.category)) + ' · ' + (a.distance_km != null ? esc(a.distance_km) + ' km away · ' : '') + fmt(a.request.created_at) + '</p><p>' + esc(a.request.description) + '</p>' +
        '<div class="row start gap"><button class="btn sm" data-act="accept" data-id="' + esc(a.id) + '">' + ic('check', 16) + ' Accept job</button><button class="btn ghost sm" data-act="decline" data-id="' + esc(a.id) + '">Decline</button><a class="btn ghost sm" href="#/r/' + esc(a.request_id) + '">Details</a></div></div>').join('')
        : empty('zap', 'No assignments right now', 'When the planner matches a job to you, it appears here.', '', true);
    }
    $('#items').addEventListener('click', async function (e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'accept' && !(await confirmBox('Accept this job?', 'The booking starts now and lasts about the estimated duration.', 'Accept job'))) return;
      b.disabled = true;
      try {
        await api.post('/provider/assignments/' + b.dataset.id + '/' + b.dataset.act);
        if (b.dataset.act === 'accept') { toast('Job booked.', 'success'); location.hash = '#/bookings'; } else { toast('Assignment declined.'); await load(); }
      } catch (err) { fail(err); b.disabled = false; }
    });
    FF.current.reload = load;
    await load();
  }

  // ------------------------------------------------------------------ bookings
  async function bookings(ctx) {
    const v = FF.view();
    v.innerHTML = '<div class="row"><h1>My bookings</h1><select id="bs" class="inline">' +
      '<option value="active">Upcoming and active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="">All</option></select></div>' +
      '<div id="items" class="stack">' + skel(3) + '</div>';

    const card = (b) => {
      const live = b.status === 'confirmed' || b.status === 'in_progress';
      return '<article class="bcard">' +
        '<div class="bcard-head"><h3>' + esc(b.request.title) + '</h3><span class="row gap">' + meter(b.request.meter_level) + chip(b.status) + '</span></div>' +
        '<div class="bcard-body">' +
        '<p class="bcard-when">' + ic('calendar', 18) + ' ' + fmt(b.slot.start) + ' to ' + fmt(b.slot.end) + '</p>' +
        '<p class="muted small">' + esc(b.customer_name) + ' · ' + esc(label(b.request.category)) + ' · ' + (b.request.address ? esc(b.request.address) : 'no address given') + '</p>' +
        '<div class="row start gap">' +
        (b.status === 'confirmed' ? '<button class="btn sm" data-s="in_progress" data-id="' + esc(b.id) + '">' + ic('zap', 16) + ' Start work</button>' : '') +
        (b.status === 'in_progress' ? '<button class="btn sm" data-s="completed" data-id="' + esc(b.id) + '">' + ic('check', 16) + ' Mark completed</button>' : '') +
        (live ? '<button class="btn ghost sm" data-s="cancelled" data-id="' + esc(b.id) + '">' + ic('x', 16) + ' Cancel booking</button>' : '') +
        '<a class="btn ghost sm" href="#/r/' + esc(b.request_id) + '">Details</a></div></div></article>';
    };

    async function load() {
      const f = $('#bs').value;
      let items;
      if (f === 'active') {
        const res = await Promise.all([
          api.get('/bookings', { status: 'confirmed', sort: 'slot_start', order: 'asc', limit: 50 }),
          api.get('/bookings', { status: 'in_progress', sort: 'slot_start', order: 'asc', limit: 50 }),
        ]);
        items = res[0].items.concat(res[1].items).sort((a, b) => new Date(a.slot.start) - new Date(b.slot.start));
      } else {
        items = (await api.get('/bookings', { status: f, sort: 'slot_start', order: 'desc', limit: 50 })).items;
      }
      if (!ctx.alive()) return;
      $('#items').innerHTML = items.length ? items.map(card).join('')
        : empty('calendar', f === 'active' ? 'No upcoming bookings' : 'Nothing here', f === 'active' ? 'Accepted offers and assignments show up here.' : 'No bookings match this filter.', '', true);
    }

    $('#items').addEventListener('click', async function (e) {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      if (b.dataset.s === 'cancelled' && !(await confirmBox('Cancel this booking?', 'The customer will be notified and the request goes back to them so they can choose another provider.', 'Cancel booking', true))) return;
      b.disabled = true;
      try { await api.post('/bookings/' + b.dataset.id + '/status', { status: b.dataset.s }); toast('Booking updated.', 'success'); await load(); }
      catch (err) { fail(err); b.disabled = false; }
    });
    $('#bs').onchange = () => load().catch(fail);
    FF.current.reload = load;
    await load();
  }

  // ------------------------------------------------------------------ profile + planner vs independent
  async function profile() {
    const p = pp(), cur = p.categories || [];
    const v = FF.view();
    const mode = (m, icon, title, text) => '<button type="button" class="card mode ' + (p.mode === m ? 'on' : '') + '" data-mode="' + m + '"><div class="ico">' + ic(icon, 22) + '</div><h3>' + title + '</h3><p class="muted">' + text + '</p></button>';
    v.innerHTML = '<div><h1>Profile and work mode</h1>' + (needsSetup() ? '<div class="notice">Choose your skills and service area to start receiving jobs.</div>' : '') + '</div>' +
      '<div class="grid2" id="modes">' + mode('independent', 'search', 'Independent', 'Browse open requests near you and send your own offers. You set your price and your time.') + mode('planner', 'zap', 'Planner', 'The Recovery Planner assigns you the best matched jobs automatically. Accept or decline each one.') + '</div>' +
      '<form id="pf" class="card" novalidate><h2>Skills and service area</h2><div class="field"><label>Your categories</label><div class="cats">' + CATS.map((c) => '<label class="catpill"><input type="checkbox" value="' + c + '"' + (cur.indexOf(c) >= 0 ? ' checked' : '') + '><span>' + esc(label(c)) + '</span></label>').join('') + '</div></div>' +
      '<div class="grid3"><div class="field"><label for="lat">Latitude</label><input id="lat" type="number" step="any" value="' + (p.lat == null ? '' : esc(p.lat)) + '"></div><div class="field"><label for="lng">Longitude</label><input id="lng" type="number" step="any" value="' + (p.lng == null ? '' : esc(p.lng)) + '"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="btn ghost block" type="button" id="loc">' + ic('pin') + ' Use my location</button></div></div>' +
      '<div class="field"><label for="rad">Service radius (km)</label><input id="rad" type="number" min="1" max="500" step="1" value="' + esc(p.service_radius_km || 15) + '"></div>' +
      '<div class="field"><label for="bio">About you (optional)</label><textarea id="bio" rows="3" maxlength="500">' + esc(p.bio) + '</textarea></div><button class="btn" id="save">Save profile</button></form>';
    $('#modes').addEventListener('click', async function (e) {
      const b = e.target.closest('[data-mode]');
      if (!b || b.classList.contains('on')) return;
      try {
        FF.me.provider_profile = await api.post('/provider/mode', { mode: b.dataset.mode });
        document.querySelectorAll('.mode').forEach((x) => x.classList.toggle('on', x.dataset.mode === b.dataset.mode));
        toast(b.dataset.mode === 'planner' ? 'Planner mode on. Jobs will be assigned to you.' : 'Independent mode on. You can browse and bid on jobs.', 'success');
      } catch (err) { fail(err); }
    });
    $('#loc').onclick = function () {
      if (!navigator.geolocation) return toast('Location is not available. Type latitude and longitude.', 'error');
      navigator.geolocation.getCurrentPosition(function (pos) {
        $('#lat').value = pos.coords.latitude.toFixed(5); $('#lng').value = pos.coords.longitude.toFixed(5);
      }, function () { toast('Could not get your location. Type it instead.', 'error'); }, { timeout: 10000 });
    };
    $('#pf').onsubmit = async function (e) {
      e.preventDefault();
      const cats = Array.from(document.querySelectorAll('.catpill input:checked')).map((x) => x.value);
      const lat = parseFloat($('#lat').value), lng = parseFloat($('#lng').value), rad = parseFloat($('#rad').value);
      if (!cats.length) return toast('Pick at least one category.', 'error');
      if (!isFinite(lat) || !isFinite(lng)) return toast('Add your location.', 'error');
      if (!(rad > 0 && rad <= 500)) return toast('Service radius must be between 1 and 500 km.', 'error');
      $('#save').disabled = true;
      try {
        FF.me.provider_profile = await api.put('/me/provider-profile', { categories: cats, lat: lat, lng: lng, service_radius_km: rad, bio: $('#bio').value.trim() || null });
        toast('Profile saved. You are ready for jobs.', 'success');
      } catch (err) { fail(err); }
      $('#save').disabled = false;
    };
  }

  FF.start({
    role: 'provider', home: '#/home',
    links: [
      { hash: '#/home', label: 'Home', icon: 'home' },
      { hash: '#/feed', label: 'Jobs', icon: 'search', also: ['#/r/'] },
      { hash: '#/assignments', label: 'Assignments', icon: 'zap' },
      { hash: '#/bookings', label: 'Bookings', icon: 'calendar' },
      { hash: '#/profile', label: 'Profile and mode', icon: 'sliders' },
    ],
    routes: [
      { re: /^#\/home$/, fn: home }, { re: /^#\/feed$/, fn: feed }, { re: /^#\/r\/([0-9a-fA-F-]{36})$/, fn: detail },
      { re: /^#\/assignments$/, fn: assignments }, { re: /^#\/bookings$/, fn: bookings }, { re: /^#\/profile$/, fn: profile },
    ],
    toast: function (ev, me) {
      const mine = ev.payload && ev.payload.provider_id === me.profile.id;
      if (ev.type === 'planner.assigned' && mine) return 'New job assigned to you';
      if (ev.type === 'offer.accepted' && mine) return 'Your offer was accepted!';
      if (ev.type === 'offer.rejected' && mine) return 'An offer of yours was declined';
      if (ev.type === 'request.cancelled' && mine) return 'A customer deleted a job you were booked for. Check your Bookings.';
      if (ev.type === 'request.created' && me.provider_profile && me.provider_profile.mode === 'independent') return 'New job in your area';
      return null;
    },
  });
})();