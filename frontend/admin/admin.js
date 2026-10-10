(function () {
  'use strict';
  const { ic, esc, fmt, label, meter, chip, toast, fail, confirmBox, diagCard, timeline, empty, skel, stat, countUp, CATS, STATUSES } = FF;
  const api = FixAPI;
  const $ = (s) => document.querySelector(s);
  const WHY = {
    not_found: 'Request not found', not_open: 'Request is no longer open', already_assigned: 'Already assigned to a provider',
    missing_location: 'Request has no location', no_planner_providers: 'No planner-mode provider is free right now',
    no_provider_in_range: 'No provider covers this category and area', no_capacity: 'Every matching provider is already assigned',
  };
  const DROP = { request_not_open: 'Request is no longer open', request_already_assigned: 'Request got another assignment', provider_unavailable: 'Provider is unavailable', provider_has_pending_assignment: 'Provider already has a pending assignment' };

  async function home(ctx) {
    const v = FF.view();
    v.innerHTML = '<div class="card hero-card"><div><p class="eyebrow">Admin</p><h1>Platform overview</h1><p class="muted">Live numbers across customers, providers and requests.</p></div><a class="btn" href="#/planner">' + ic('zap') + ' Recovery Planner</a></div><div class="stats" id="stats">' + skel(1) + '</div><div class="card"><h2>Requests by status</h2><div class="bars" id="bars"></div></div>';
    async function load() {
      const s = await api.get('/admin/stats');
      if (!ctx.alive()) return;
      $('#stats').innerHTML = stat('users', 'Customers', s.users_by_role.customer, '#/users') + stat('briefcase', 'Providers', s.users_by_role.provider, '#/users') +
        stat('calendar', 'Bookings in the last 24h', s.bookings_today) + stat('chart', 'Average offers per request', String(s.avg_offers_per_request));
      countUp($('#stats'));
      const max = Math.max(1, ...STATUSES.map((k) => s.requests_by_status[k] || 0));
      $('#bars').innerHTML = STATUSES.map((k) => '<div class="bar"><span>' + esc(label(k)) + '</span><div class="track"><i style="width:' + Math.round(((s.requests_by_status[k] || 0) / max) * 100) + '%"></i></div><strong>' + (s.requests_by_status[k] || 0) + '</strong></div>').join('');
    }
    FF.current.reload = load;
    await load();
  }

  async function users(ctx) {
    const st = { page: 1 };
    const v = FF.view();
    v.innerHTML = '<h1>Users</h1><div class="card filters"><div class="grid3"><div class="field"><label>Search</label><input id="q" placeholder="Name or email"></div><div class="field"><label>Role</label><select id="rl"><option value="">All</option><option value="customer">Customers</option><option value="provider">Providers</option><option value="admin">Admins</option></select></div></div></div><div class="card"><div class="tbl-wrap" id="tbl">' + skel(2) + '</div><div class="row" id="pg"></div></div>';
    async function load() {
      const r = await api.get('/admin/users', { q: $('#q').value.trim(), role: $('#rl').value, page: st.page, limit: 15 });
      if (!ctx.alive()) return;
      $('#tbl').innerHTML = r.items.length ? '<table class="tbl"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Verified</th><th>Mode</th><th></th></tr></thead><tbody>' + r.items.map((u) =>
        '<tr><td><strong>' + esc(u.full_name || '—') + '</strong><div class="muted small">' + esc(u.email || '') + '</div></td><td>' + chip(u.role) + '</td><td>' + (u.is_active ? '<span class="chip completed">Active</span>' : '<span class="chip cancelled">Disabled</span>') + '</td>' +
        '<td>' + (u.role === 'provider' ? (u.is_verified ? '<span class="chip completed">Verified</span>' : '<span class="chip open">Unverified</span>') : '—') + '</td><td>' + esc(label(u.mode || '')) + '</td>' +
        '<td class="actions"><button class="btn ghost sm" data-k="active" data-id="' + esc(u.id) + '" data-v="' + (!u.is_active) + '">' + (u.is_active ? 'Disable' : 'Enable') + '</button> ' +
        (u.role === 'provider' ? '<button class="btn ghost sm" data-k="verified" data-id="' + esc(u.id) + '" data-v="' + (!u.is_verified) + '">' + (u.is_verified ? 'Unverify' : 'Verify') + '</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : empty('users', 'No users found', 'Try a different search.', '', true);
      const pages = Math.max(1, Math.ceil(r.total / r.limit));
      $('#pg').innerHTML = '<span class="muted small">' + r.total + ' users · page ' + r.page + ' of ' + pages + '</span><span class="row gap"><button class="btn ghost sm" id="pv"' + (r.page <= 1 ? ' disabled' : '') + '>Previous</button><button class="btn ghost sm" id="nx"' + (r.page >= pages ? ' disabled' : '') + '>Next</button></span>';
      $('#pv').onclick = () => { st.page--; load().catch(fail); };
      $('#nx').onclick = () => { st.page++; load().catch(fail); };
    }
    $('#tbl').addEventListener('click', async function (e) {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      const on = b.dataset.v === 'true';
      if (b.dataset.k === 'active' && !on && !(await confirmBox('Disable this account?', 'They will no longer be able to use the app.', 'Disable', true))) return;
      b.disabled = true;
      try { await api.patch('/admin/users/' + b.dataset.id, b.dataset.k === 'active' ? { is_active: on } : { is_verified: on }); toast('User updated.', 'success'); await load(); }
      catch (err) { fail(err); b.disabled = false; }
    });
    $('#rl').onchange = () => { st.page = 1; load().catch(fail); };
    let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(() => { st.page = 1; load().catch(fail); }, 300); };
    FF.current.reload = load;
    await load();
  }

  async function requests(ctx) {
    const v = FF.view();
    v.innerHTML = '<h1>All requests</h1><div class="card filters"><div class="grid4"><div class="field"><label>Search</label><input id="q" placeholder="Title or details"></div>' +
      '<div class="field"><label>Status</label><select id="st"><option value="">All</option>' + STATUSES.map((s) => '<option value="' + s + '">' + esc(label(s)) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Category</label><select id="ct"><option value="">All</option>' + CATS.map((c) => '<option value="' + c + '">' + esc(label(c)) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Sort by</label><select id="so"><option value="created_at:desc">Newest</option><option value="severity_score:desc">Most urgent</option></select></div></div></div><div id="items" class="stack">' + skel(3) + '</div>';
    async function load() {
      const so = $('#so').value.split(':');
      const r = await api.get('/requests', { q: $('#q').value.trim(), status: $('#st').value, category: $('#ct').value, sort: so[0], order: so[1], limit: 50 });
      if (!ctx.alive()) return;
      $('#items').innerHTML = r.items.length ? r.items.map((i) => '<a class="req" href="#/r/' + esc(i.id) + '"><div class="row"><strong>' + esc(i.title) + '</strong><span class="row gap">' + meter(i.meter_level) + chip(i.status) + '</span></div><div class="muted small">' + esc(label(i.category)) + ' · ' + i.offer_count + ' offers · ' + fmt(i.created_at) + '</div></a>').join('') + (r.total > r.items.length ? '<p class="muted small">Showing ' + r.items.length + ' of ' + r.total + '.</p>' : '') : empty('inbox', 'No requests', 'Nothing matches these filters.', '', true);
    }
    ['st', 'ct', 'so'].forEach((id) => $('#' + id).addEventListener('change', () => load().catch(fail)));
    let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 300); });
    FF.current.reload = load;
    await load();
  }

  async function detail(ctx) {
    const id = ctx.m[1];
    FF.current.id = id;
    FF.view().innerHTML = '<a class="back" href="#/requests">← All requests</a><div id="head" class="card">' + skel(1) + '</div><div id="diag"></div><div class="card"><h2>Offers</h2><div id="offers" class="stack"></div></div><div class="card"><h2>Timeline</h2><div id="tl"></div></div>';
    async function load() {
      const res = await Promise.all([api.get('/requests/' + id), api.get('/requests/' + id + '/timeline'), api.get('/requests/' + id + '/offers', { sort: 'price', order: 'asc' })]);
      if (!ctx.alive()) return;
      const r = res[0];
      $('#head').innerHTML = '<div class="row"><h1>' + esc(r.title) + '</h1><span class="row gap">' + meter(r.meter_level) + chip(r.status) + '</span></div><p class="muted small">' + esc(label(r.category)) + ' · posted ' + fmt(r.created_at) + (r.address ? ' · ' + esc(r.address) : '') + '</p><p>' + esc(r.description) + '</p>' +
        (r.booking ? '<div class="notice">' + ic('calendar') + ' Booking ' + esc(label(r.booking.status)) + ': ' + fmt(r.booking.slot.start) + ' to ' + fmt(r.booking.slot.end) + '</div>' : '') +
        (['open', 'offers_received', 'booked', 'in_progress'].indexOf(r.status) >= 0 ? '<button class="btn ghost sm" id="cx">Cancel request</button>' : '');
      $('#diag').innerHTML = diagCard(r.diagnosis);
      $('#offers').innerHTML = res[2].items.length ? res[2].items.map((o) => '<div class="offer ' + (o.status === 'accepted' ? 'accepted' : '') + '"><div class="row"><strong>' + esc(o.provider.full_name) + '</strong><span class="price">' + esc(o.currency) + ' ' + esc(o.price) + '</span></div><div class="muted small">' + chip(o.status).replace(/<[^>]+>/g, '') + ' · arrives in ' + esc(o.eta_minutes) + ' min · ' + fmt(o.proposed_start) + '</div></div>').join('') : '<p class="muted">No offers.</p>';
      $('#tl').innerHTML = timeline(res[1].items);
      const cx = $('#cx');
      if (cx) cx.onclick = async function () {
        if (!(await confirmBox('Cancel this request?', 'Any booking on it is cancelled too.', 'Cancel request', true))) return;
        try { await api.post('/requests/' + id + '/cancel'); toast('Request cancelled.', 'success'); await load(); } catch (err) { fail(err); }
      };
    }
    FF.current.reload = load;
    await load();
  }

  async function planner(ctx) {
    FF.view().innerHTML = '<div><h1>Recovery Planner</h1><p class="muted">Matches open requests to planner-mode providers by distance, rating and urgency. Preview first, then publish to providers.</p></div>' +
      '<div class="card" id="setup">' + skel(1) + '</div><div id="result"></div><div class="card"><h2>Recent runs</h2><div id="runs" class="stack"></div></div>';
    const titles = {};

    function showRun(run) {
      const t = (rid) => titles[rid] || String(rid).slice(0, 8);
      const rows = run.assignments.map((a) => '<tr><td>' + esc(a.request_title) + '</td><td>' + esc(a.provider_name) + '</td><td>' + esc(a.distance_km) + ' km</td><td>' + Math.round(a.score || 0) + '%</td></tr>').join('');
      $('#result').innerHTML = '<div class="card"><div class="row"><h2>' + (run.status === 'dry_run' ? 'Preview (not visible to providers)' : 'Published plan') + '</h2>' + chip(run.status === 'dry_run' ? 'proposed' : 'confirmed') + '</div>' +
        '<p class="muted">' + (run.summary.assigned || 0) + ' of ' + (run.summary.requests_considered || 0) + ' requests matched · ' + (run.summary.providers_considered || 0) + ' providers available</p>' +
        (rows ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Request</th><th>Provider</th><th>Distance</th><th>Match</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="muted">No assignments could be made.</p>') +
        (run.unassigned.length ? '<h4>Not assigned</h4><ul class="clean">' + run.unassigned.map((u) => '<li>' + esc(t(u.request_id)) + ': ' + esc(WHY[u.reason] || label(u.reason)) + '</li>').join('') + '</ul>' : '') +
        (run.dropped.length ? '<h4>Dropped at publish</h4><ul class="clean">' + run.dropped.map((d) => '<li>' + esc(t(d.request_id)) + ': ' + esc(DROP[d.reason] || label(d.reason)) + '</li>').join('') + '</ul>' : '') +
        (run.status === 'dry_run' && run.assignments.length ? '<div class="row end"><button class="btn" id="pub">' + ic('check') + ' Publish to providers</button></div>' : '') + '</div>';
      const pub = $('#pub');
      if (pub) pub.onclick = async function () {
        if (!(await confirmBox('Publish this plan?', 'Matched providers will see their assignments and can accept or decline.', 'Publish'))) return;
        pub.disabled = true;
        try { showRun(await api.post('/admin/planner/runs/' + run.run_id + '/confirm')); toast('Plan published to providers.', 'success'); loadRuns().catch(() => {}); }
        catch (err) { fail(err); pub.disabled = false; }
      };
      $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function loadRuns() {
      const r = await api.get('/admin/planner/runs');
      if (!ctx.alive()) return;
      $('#runs').innerHTML = r.items.length ? r.items.map((x) => '<div class="req"><div class="row"><span>' + fmt(x.created_at) + ' · ' + x.assignment_count + ' assignment' + (x.assignment_count === 1 ? '' : 's') + '</span><span class="row gap">' + chip(x.status === 'dry_run' ? 'proposed' : 'confirmed') + '<button class="btn ghost sm" data-run="' + esc(x.id) + '">View</button></span></div></div>').join('') : '<p class="muted">No runs yet.</p>';
    }
    $('#runs').addEventListener('click', async function (e) {
      const b = e.target.closest('[data-run]');
      if (!b) return;
      try { showRun(await api.get('/admin/planner/runs/' + b.dataset.run)); } catch (err) { fail(err); }
    });

    const res = await Promise.all([api.get('/requests', { status: 'open', limit: 100 }), api.get('/requests', { status: 'offers_received', limit: 100 })]);
    if (!ctx.alive()) return;
    const open = res[0].items.concat(res[1].items);
    open.forEach((i) => { titles[i.id] = i.title; });
    $('#setup').innerHTML = '<h2>1. Choose requests</h2><p class="muted small">Leave all unticked to plan every open request, most urgent first.</p>' +
      (open.length ? '<div class="stack">' + open.map((i) => '<label class="row start gap"><input type="checkbox" class="pick" value="' + esc(i.id) + '"> <span><strong>' + esc(i.title) + '</strong> ' + meter(i.meter_level) + ' <span class="muted small">' + esc(label(i.category)) + '</span></span></label>').join('') + '</div>' : '<p class="muted">There are no open requests right now.</p>') +
      '<h2 style="margin-top:20px">2. Options</h2><label class="row start gap"><input type="checkbox" id="rv"> Only verified providers</label><div class="row end"><button class="btn" id="run">' + ic('zap') + ' Preview plan</button></div>';
    $('#run').onclick = async function () {
      const ids = Array.from(document.querySelectorAll('.pick:checked')).map((x) => x.value);
      const body = { dry_run: true, require_verified: $('#rv').checked };
      if (ids.length) body.request_ids = ids;
      const b = $('#run'); b.disabled = true;
      try { showRun(await api.post('/admin/planner/run', body)); loadRuns().catch(() => {}); } catch (err) { fail(err); }
      b.disabled = false;
    };
    await loadRuns();
  }

  FF.start({
    role: 'admin', home: '#/home',
    links: [
      { hash: '#/home', label: 'Overview', icon: 'grid' },
      { hash: '#/users', label: 'Users', icon: 'users' },
      { hash: '#/requests', label: 'Requests', icon: 'list', also: ['#/r/'] },
      { hash: '#/planner', label: 'Planner', icon: 'zap' },
    ],
    routes: [
      { re: /^#\/home$/, fn: home }, { re: /^#\/users$/, fn: users }, { re: /^#\/requests$/, fn: requests },
      { re: /^#\/r\/([0-9a-fA-F-]{36})$/, fn: detail }, { re: /^#\/planner$/, fn: planner },
    ],
  });
})();