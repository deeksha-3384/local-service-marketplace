// (function () {
//   'use strict';
//   const { ic, esc, fmt, label, meter, chip, toast, fail, confirmBox, diagCard, timeline, empty, skel, stat, countUp, CATS, STATUSES, LANGS } = FF;
//   const api = FixAPI;
//   const $ = (s) => document.querySelector(s);
//   const catOpts = (all) => (all ? '<option value="">All categories</option>' : '') + CATS.map((c) => '<option value="' + c + '">' + esc(label(c)) + '</option>').join('');
//   const reqRow = (i) => '<a class="req" href="#/r/' + esc(i.id) + '"><div class="row"><strong>' + esc(i.title) + '</strong><span class="row gap">' + meter(i.meter_level) + chip(i.status) + '</span></div><div class="muted small">' + esc(label(i.category)) + ' · ' + i.offer_count + ' offer' + (i.offer_count === 1 ? '' : 's') + ' · ' + fmt(i.created_at) + '</div></a>';

//   // ------------------------------------------------------------------ home
//   async function home(ctx) {
//     const v = FF.view();
//     const first = esc((FF.me.profile.full_name || 'there').split(' ')[0]);
//     v.innerHTML = '<section class="showcase"><div class="showcase-in">' +
//       '<span class="hello">Hi ' + first + '</span>' +
//       '<h1>What needs fixing today?</h1>' +
//       '<p>Describe it, record it or snap a photo.</p>' +
//       '<a class="btn lg" href="#/new">' + ic('plus') + ' New request</a></div></section>' +
//       '<div class="stats" id="stats">' + skel(1) + '</div>' +
//       '<div class="card"><div class="row"><h2>Recent requests</h2><a href="#/requests">View all</a></div><div id="recent" class="stack"></div></div>';
//     async function load() {
//       const res = await Promise.all([api.get('/requests', { limit: 100 }), api.get('/bookings', { limit: 100 })]);
//       if (!ctx.alive()) return;
//       const rs = res[0].items, bs = res[1].items;
//       const open = rs.filter((r) => r.status === 'open' || r.status === 'offers_received');
//       const waiting = open.reduce((n, r) => n + (r.offer_count || 0), 0);
//       $('#stats').innerHTML = stat('inbox', 'Open requests', open.length, '#/requests') + stat('zap', 'Offers waiting', waiting, '#/requests') +
//         stat('calendar', 'Upcoming bookings', bs.filter((b) => b.status === 'confirmed' || b.status === 'in_progress').length, '#/bookings') +
//         stat('check', 'Completed jobs', bs.filter((b) => b.status === 'completed').length, '#/bookings');
//       countUp($('#stats'));
//       $('#recent').innerHTML = rs.length ? rs.slice(0, 4).map(reqRow).join('') : empty('inbox', 'No requests yet', 'Post your first problem and offers will appear here.', '<a class="btn" href="#/new">' + ic('plus') + ' New request</a>', true);
//     }
//     FF.current.reload = load;
//     await load();
//   }

//   // ------------------------------------------------------------------ new request (voice + photo)
//   async function newRequest() {
//     const v = FF.view();
//     const S = { media: [], notes: [], photos: 0, diagnosis: null, transcript: null };
//     let rec = null, stream = null, timer = null, tick = null;
//     v.innerHTML = '<div><h1>New request</h1><p class="muted">Tell us what is wrong. Speak, type or add photos, whatever is easiest.</p></div>' +
//       '<form id="f" class="card" novalidate>' +
//       '<div class="capture"><button class="capbtn" type="button" id="mic">' + ic('mic', 22) + '<span id="micLabel">Record voice</span><small>Describe it in your own language</small></button>' +
//       '<label class="capbtn" for="photo">' + ic('camera', 22) + '<span>Add photos</span><small id="photoCount">Up to 4 photos</small></label>' +
//       '<label class="capbtn" for="audioFile">' + ic('inbox', 22) + '<span>Upload voice note</span><small>mp3, m4a, wav, webm or ogg, up to 10 MB</small></label>' +
//       '<input id="photo" type="file" accept="image/*" multiple hidden>' +
//       '<input id="audioFile" type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.webm" hidden></div>' +
//       '<div id="recbar" class="recbar hidden"><span class="rec-dot"></span><strong id="recTime">0:00</strong><span class="muted small">Recording... tap Stop when you are done</span></div>' +
//       '<div id="thumbs" class="thumbs"></div>' +
//       '<div class="grid2"><div class="field"><label for="cat">Category</label><select id="cat">' + catOpts(false) + '</select></div>' +
//       '<div class="field"><label for="title">Title</label><input id="title" maxlength="120" placeholder="e.g. Leaking kitchen tap"></div></div>' +
//       '<div class="field"><label for="desc">Describe the problem</label><textarea id="desc" rows="4" maxlength="2000"></textarea></div>' +
//       '<div id="diag"></div>' +
//       '<div class="field"><label for="addr">Address</label><input id="addr" maxlength="300" autocomplete="street-address"></div>' +
//       '<div class="grid3"><div class="field"><label for="lat">Latitude</label><input id="lat" type="number" step="any"></div>' +
//       '<div class="field"><label for="lng">Longitude</label><input id="lng" type="number" step="any"></div>' +
//       '<div class="field"><label>&nbsp;</label><button class="btn ghost block" type="button" id="loc">' + ic('pin') + ' Use my location</button></div></div>' +
//       '<button class="btn block" id="go" type="submit">Send request</button></form>';

//     const mic = $('#mic');
//     function setMic(on) {
//       mic.classList.toggle('on', on);
//       $('#micLabel').textContent = on ? 'Stop recording' : 'Record voice';
//       $('#recbar').classList.toggle('hidden', !on);
//     }
//     FF.current.cleanup = function () {
//       clearTimeout(timer); clearInterval(tick);
//       if (rec && rec.state === 'recording') { rec.onstop = null; rec.stop(); }
//       if (stream) stream.getTracks().forEach((t) => t.stop());
//     };

//     function compress(file) {
//       return new Promise(function (resolve, reject) {
//         const img = new Image(), url = URL.createObjectURL(file);
//         img.onload = function () {
//           const k = Math.min(1, 1600 / Math.max(img.width, img.height));
//           const c = document.createElement('canvas');
//           c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
//           c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
//           URL.revokeObjectURL(url);
//           c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not process that photo.')); }, 'image/jpeg', 0.8);
//         };
//         img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
//         img.src = url;
//       });
//     }

//     async function sendVoice(blob) {
//       const ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
//       const fd = new FormData();
//       fd.append('audio', blob, 'voice.' + ext);
//       fd.append('language', FF.me.profile.language || 'en');
//       toast('Listening to your recording...');
//       try {
//         const r = await api.upload('/intake/voice', fd);
//         if (!$('#desc')) return;
//         $('#desc').value = r.draft.description || r.transcript || '';
//         $('#title').value = r.draft.title || '';
//         if (CATS.indexOf(r.draft.category) >= 0) $('#cat').value = r.draft.category;
//         S.transcript = r.transcript; S.diagnosis = r.diagnosis;
//         if (r.media_id) S.media.push(r.media_id);
//         $('#diag').innerHTML = diagCard(r.diagnosis);
//         toast('Done. Check the details, then send your request.', 'success');
//       } catch (e) { fail(e); }
//     }

//     mic.onclick = async function () {
//       if (rec && rec.state === 'recording') { rec.stop(); return; }
//       if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Voice recording needs a modern browser and HTTPS.', 'error');
//       try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
//       catch (e) { return toast('Microphone access was blocked. Allow it in the browser and try again.', 'error'); }
//       const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
//       const chunks = [];
//       rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
//       rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
//       rec.onstop = async function () {
//         clearTimeout(timer); clearInterval(tick);
//         stream.getTracks().forEach((t) => t.stop());
//         setMic(false);
//         const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
//         if (blob.size < 1000) return toast('That recording was empty. Try again.', 'error');
//         mic.disabled = true; await sendVoice(blob); mic.disabled = false;
//       };
//       rec.start(); setMic(true);
//       let secs = 0; $('#recTime').textContent = '0:00';
//       tick = setInterval(function () { secs++; $('#recTime').textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'); }, 1000);
//       timer = setTimeout(function () { rec.stop(); }, 60000);
//     };

//     $('#photo').onchange = async function (ev) {
//       const files = Array.from(ev.target.files); ev.target.value = '';
//       for (const f of files) {
//         if (S.photos >= 4) { toast('You can add up to 4 photos.', 'error'); break; }
//         try {
//           toast('Uploading photo...');
//           const fd = new FormData();
//           fd.append('photo', await compress(f), 'photo.jpg');
//           fd.append('language', FF.me.profile.language || 'en');
//           const r = await api.upload('/intake/photo', fd);
//           if (!$('#thumbs')) return;
//           S.media.push(r.media_id); S.photos++; S.diagnosis = null; $('#diag').innerHTML = '';
//           if (r.analysis && r.analysis.summary) S.notes.push(r.analysis.summary);
//           if (r.url) $('#thumbs').insertAdjacentHTML('beforeend', '<img src="' + esc(r.url) + '" alt="">');
//           $('#photoCount').textContent = S.photos + ' of 4 added';
//         } catch (e) { fail(e); }
//       }
//     };

//     $('#audioFile').onchange = async function (ev) {
//       const f = ev.target.files[0];
//       ev.target.value = '';
//       if (!f) return;
//       if (rec && rec.state === 'recording') return toast('Stop the recording first.', 'error');
//       if (f.size > 10 * 1024 * 1024) return toast('That file is too large. Voice notes can be up to 10 MB.', 'error');
//       if (f.size < 1000) return toast('That file looks empty. Choose another one.', 'error');
//       mic.disabled = true;
//       await sendVoice(f);
//       mic.disabled = false;
//     };

//     $('#desc').addEventListener('input', function () { S.diagnosis = null; $('#diag').innerHTML = ''; });

//     async function reverseGeocode(lat, lng) {
//       try {
//         const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng);
//         if (!r.ok) return null;
//         const j = await r.json();
//         return j.display_name || null;
//       } catch (_) { return null; }
//     }
//     $('#loc').onclick = function () {
//       if (!navigator.geolocation) return toast('Location is not available. Type latitude and longitude.', 'error');
//       navigator.geolocation.getCurrentPosition(async function (p) {
//         const lat = p.coords.latitude, lng = p.coords.longitude;
//         $('#lat').value = lat.toFixed(5); $('#lng').value = lng.toFixed(5);
//         toast('Location added.', 'success');
//         if ($('#addr') && !$('#addr').value.trim()) {
//           const a = await reverseGeocode(lat, lng);
//           if (a && $('#addr') && !$('#addr').value.trim()) $('#addr').value = a.slice(0, 300);
//         }
//       }, function () { toast('Could not get your location. Type latitude and longitude instead.', 'error'); }, { timeout: 10000 });
//     };

//     $('#f').onsubmit = async function (e) {
//       e.preventDefault();
//       const description = $('#desc').value.trim(), title = $('#title').value.trim();
//       const lat = parseFloat($('#lat').value), lng = parseFloat($('#lng').value);
//       if (!description && !title) return toast('Describe the problem: type it or record it.', 'error');
//       if (!isFinite(lat) || !isFinite(lng)) return toast('Add your location: tap "Use my location" or type latitude and longitude.', 'error');
//       const go = $('#go'); go.disabled = true; go.textContent = 'Sending...';
//       try {
//         if (!S.diagnosis) {
//           try {
//             S.diagnosis = await api.post('/intake/diagnose', { description: description || title, transcript: S.transcript || undefined, photo_notes: S.notes, language: FF.me.profile.language || 'en' });
//           } catch (_) { /* AI unavailable: the request is still sent */ }
//         }
//         const body = { category: $('#cat').value, title: title || undefined, description: description || undefined, transcript: S.transcript || undefined, lat: lat, lng: lng, address: $('#addr').value.trim() || undefined, media_ids: S.media, diagnosis: S.diagnosis || undefined };
//         let r;
//         try { r = await api.post('/requests', body); }
//         catch (err) {
//           if (err.status === 422 && (err.details || []).some((d) => d.field === 'diagnosis')) { delete body.diagnosis; r = await api.post('/requests', body); }
//           else throw err;
//         }
//         toast('Request sent. Offers will appear here.', 'success');
//         location.hash = '#/r/' + r.id;
//       } catch (err) { fail(err); go.disabled = false; go.textContent = 'Send request'; }
//     };
//   }

//   // ------------------------------------------------------------------ my requests
//   async function requestsPage(ctx) {
//     const v = FF.view();
//     v.innerHTML = '<div class="row"><h1>My requests</h1><a class="btn" href="#/new">' + ic('plus') + ' New request</a></div>' +
//       '<div class="card filters"><div class="grid4">' +
//       '<div class="field"><label>Search</label><input id="q" placeholder="Title or details"></div>' +
//       '<div class="field"><label>Status</label><select id="st"><option value="">All</option>' + STATUSES.map((s) => '<option value="' + s + '">' + esc(label(s)) + '</option>').join('') + '</select></div>' +
//       '<div class="field"><label>Category</label><select id="ct">' + catOpts(true) + '</select></div>' +
//       '<div class="field"><label>Urgency</label><select id="mt"><option value="">Any</option><option>low</option><option>medium</option><option>high</option><option>critical</option></select></div>' +
//       '<div class="field"><label>Sort by</label><select id="so"><option value="created_at:desc">Newest first</option><option value="severity_score:desc">Most urgent</option></select></div></div></div>' +
//       '<div id="items" class="stack">' + skel(3) + '</div>';
//     async function load() {
//       const so = $('#so').value.split(':');
//       const r = await api.get('/requests', { q: $('#q').value.trim(), status: $('#st').value, category: $('#ct').value, meter_level: $('#mt').value, sort: so[0], order: so[1], limit: 50 });
//       if (!ctx.alive()) return;
//       $('#items').innerHTML = r.items.length
//         ? r.items.map(reqRow).join('') + (r.total > r.items.length ? '<p class="muted small">Showing ' + r.items.length + ' of ' + r.total + '.</p>' : '')
//         : empty('inbox', 'Nothing here', 'No requests match these filters.', '<a class="btn" href="#/new">' + ic('plus') + ' New request</a>');
//     }
//     ['st', 'ct', 'mt', 'so'].forEach((id) => $('#' + id).addEventListener('change', () => load().catch(fail)));
//     let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 300); });
//     FF.current.reload = load;
//     await load();
//   }

//   // ------------------------------------------------------------------ request detail + offers
//   function offerCard(o, open) {
//     const p = o.provider || {};
//     const acts = open && o.status === 'pending'
//       ? '<div class="row start gap"><button class="btn sm" data-act="accept" data-id="' + esc(o.id) + '">' + ic('check', 16) + ' Accept</button><button class="btn ghost sm" data-act="reject" data-id="' + esc(o.id) + '">Decline</button></div>'
//       : (o.status === 'accepted' ? '<span class="chip booked">Accepted</span>' : '');
//     return '<div class="offer ' + (o.status === 'accepted' ? 'accepted' : '') + '"><div class="row"><strong>' + esc(p.full_name) + '</strong><span class="price">' + esc(o.currency) + ' ' + esc(o.price) + '</span></div>' +
//       '<div class="muted small">' + ic('star', 14) + ' ' + (p.rating_count ? Number(p.rating).toFixed(1) + ' (' + esc(p.rating_count) + ')' : 'new') + (p.is_verified ? ' · verified' : '') + (p.distance_km != null ? ' · ' + esc(p.distance_km) + ' km away' : '') + ' · arrives in ' + esc(o.eta_minutes) + ' min</div>' +
//       '<div class="muted small">' + fmt(o.proposed_start) + ' to ' + fmt(o.proposed_end) + '</div>' + (o.message ? '<p>' + esc(o.message) + '</p>' : '') + acts + '</div>';
//   }

//   async function detail(ctx) {
//     const id = ctx.m[1];
//     FF.current.id = id;
//     const ui = { sort: 'price:asc', maxPrice: '', minRating: '' };
//     const v = FF.view();
//     v.innerHTML = '<a class="back" href="#/requests">← My requests</a><div id="head" class="card">' + skel(1) + '</div><div id="diag"></div>' +
//       '<div class="card"><div class="row"><h2>Offers</h2><div class="row gap filt"><select id="osort"><option value="price:asc">Cheapest</option><option value="eta_minutes:asc">Fastest</option><option value="rating:desc">Best rated</option><option value="distance:asc">Nearest</option></select>' +
//       '<input id="omax" type="number" min="0" placeholder="Max price"><select id="orate"><option value="">Any rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option></select></div></div><div id="offers" class="stack"></div></div>' +
//       '<div class="card"><h2>Timeline</h2><div id="tl"></div></div>';

//     async function load() {
//       const so = ui.sort.split(':');
//       const res = await Promise.all([
//         api.get('/requests/' + id), api.get('/requests/' + id + '/timeline'),
//         api.get('/requests/' + id + '/offers', { sort: so[0], order: so[1], max_price: ui.maxPrice, min_rating: ui.minRating }),
//       ]);
//       if (!ctx.alive()) return;
//       const r = res[0], tl = res[1], offers = res[2];
//       const open = r.status === 'open' || r.status === 'offers_received';
//       const photos = (r.media || []).filter((x) => x.kind === 'photo' && x.url).map((x) => '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"><img src="' + esc(x.url) + '" alt=""></a>').join('');
//       const audio = (r.media || []).filter((x) => x.kind === 'audio' && x.url).map((x) => '<audio controls src="' + esc(x.url) + '"></audio>').join('');
//       $('#head').innerHTML = '<div class="row"><h1>' + esc(r.title) + '</h1><span class="row gap">' + meter(r.meter_level) + chip(r.status) + '</span></div>' +
//         '<p class="muted small">' + esc(label(r.category)) + ' · posted ' + fmt(r.created_at) + (r.address ? ' · ' + esc(r.address) : '') + '</p><p>' + esc(r.description) + '</p>' +
//         (photos ? '<div class="thumbs">' + photos + '</div>' : '') + audio +
//         (r.booking ? '<div class="notice">' + ic('calendar') + ' Booking ' + esc(label(r.booking.status)) + ': ' + fmt(r.booking.slot.start) + ' to ' + fmt(r.booking.slot.end) + '</div>' : '') +
//         (function () {
//           if (['open', 'offers_received', 'booked'].indexOf(r.status) < 0) return '';
//           if (r.status === 'booked' && r.booking && (new Date(r.booking.slot.start).getTime() - Date.now()) < 20 * 60000)
//             return '<div class="notice">This job starts in less than 20 minutes, so it can no longer be deleted. Please contact the provider.</div>';
//           return '<button class="btn ghost sm" data-act="delete">' + ic('x', 16) + ' Delete request</button>';
//         })();
//       $('#diag').innerHTML = diagCard(r.diagnosis);
//       $('#offers').innerHTML = offers.items.length ? offers.items.map((o) => offerCard(o, open)).join('') : empty('inbox', 'No offers yet', 'Providers nearby have been notified. This page updates by itself.', '', true);
//       $('#tl').innerHTML = timeline(tl.items);
//     }

//     async function act(e) {
//       const b = e.target.closest('[data-act]');
//       if (!b) return;
//       const a = b.dataset.act;
//       if (a === 'delete' && !(await confirmBox('Delete this request?', 'It will be removed from open jobs. If a provider is already booked, they will be notified.', 'Delete request', true))) return;
//       if (a === 'accept' && !(await confirmBox('Accept this offer?', 'This books the provider for the proposed time and declines the other offers.', 'Accept and book'))) return;
//       b.disabled = true;
//       try {
//         if (a === 'delete') { await api.post('/requests/' + id + '/delete'); toast('Request deleted.', 'success'); location.hash = '#/requests'; return; }
//         else if (a === 'accept') { await api.post('/offers/' + b.dataset.id + '/accept'); toast('Booked! The provider has been notified.', 'success'); }
//         else if (a === 'reject') await api.post('/offers/' + b.dataset.id + '/reject');
//         await load();
//       } catch (err) { fail(err); b.disabled = false; if (err.code === 'SLOT_CONFLICT' || err.code === 'TOO_LATE') load().catch(() => {}); }
//     }
//     $('#head').addEventListener('click', act);
//     $('#offers').addEventListener('click', act);
//     $('#osort').onchange = (e) => { ui.sort = e.target.value; load().catch(fail); };
//     $('#orate').onchange = (e) => { ui.minRating = e.target.value; load().catch(fail); };
//     let t; $('#omax').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.maxPrice = e.target.value; load().catch(fail); }, 400); };
//     FF.current.reload = load;
//     await load();
//   }

//   // ------------------------------------------------------------------ bookings + profile
//   async function bookings(ctx) {
//     const v = FF.view();
//     v.innerHTML = '<div class="row"><h1>My bookings</h1><select id="bs" class="inline"><option value="">All</option><option value="confirmed">Confirmed</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div><div id="items" class="stack">' + skel(3) + '</div>';
//     async function load() {
//       const r = await api.get('/bookings', { status: $('#bs').value, sort: 'slot_start', order: 'desc', limit: 50 });
//       if (!ctx.alive()) return;
//       $('#items').innerHTML = r.items.length ? r.items.map((b) => '<a class="req" href="#/r/' + esc(b.request_id) + '"><div class="row"><strong>' + esc(b.request.title) + '</strong>' + chip(b.status) + '</div><div class="muted small">' + esc(b.provider_name) + ' · ' + fmt(b.slot.start) + ' to ' + fmt(b.slot.end) + '</div></a>').join('') : empty('calendar', 'No bookings yet', 'Accept an offer and your booking shows up here.', '', true);
//     }
//     $('#bs').onchange = () => load().catch(fail);
//     FF.current.reload = load;
//     await load();
//   }

//   async function profile() {
//     const p = FF.me.profile;
//     FF.view().innerHTML = '<h1>My profile</h1><form id="pf" class="card" novalidate><div class="grid2"><div class="field"><label for="pn">Full name</label><input id="pn" maxlength="120" value="' + esc(p.full_name) + '"></div>' +
//       '<div class="field"><label for="pp">Phone</label><input id="pp" value="' + esc(p.phone) + '" placeholder="+91 98765 43210"></div></div>' +
//       '<div class="field"><label for="pl">Language for AI replies</label><select id="pl">' + Object.keys(LANGS).map((k) => '<option value="' + k + '"' + (k === p.language ? ' selected' : '') + '>' + LANGS[k] + '</option>').join('') + '</select></div><button class="btn" id="ps">Save changes</button></form>';
//     $('#pf').onsubmit = async function (e) {
//       e.preventDefault();
//       const name = $('#pn').value.trim(), phone = $('#pp').value.trim();
//       if (!name) return toast('Please enter your name.', 'error');
//       const body = { full_name: name, language: $('#pl').value };
//       if (phone) body.phone = phone;
//       $('#ps').disabled = true;
//       try {
//         const upd = await api.patch('/me', body);
//         Object.assign(FF.me.profile, upd);
//         if (FF.setLang) FF.setLang(upd.language);
//         toast('Profile saved.', 'success');
//       } catch (err) { fail(err); }
//       $('#ps').disabled = false;
//     };
//   }

//   // Pop-up on login: summarises offers waiting on open requests (once per login session)
//   async function offerPopup() {
//     try {
//       const lo = document.getElementById('logout');
//       if (lo) lo.addEventListener('click', function () { sessionStorage.removeItem('ff_offer_popup'); });
//       if (sessionStorage.getItem('ff_offer_popup')) return;
//       sessionStorage.setItem('ff_offer_popup', '1');
//       const r = await api.get('/requests', { limit: 100 });
//       const waiting = r.items.filter(function (i) { return (i.status === 'open' || i.status === 'offers_received') && i.offer_count > 0; });
//       const total = waiting.reduce(function (n, i) { return n + i.offer_count; }, 0);
//       if (!total) return;
//       const rows = waiting.slice(0, 3).map(function (i) {
//         return '<a class="req" href="#/r/' + esc(i.id) + '"><div class="row"><strong>' + esc(i.title) + '</strong><span class="chip offers_received">' + i.offer_count + ' offer' + (i.offer_count === 1 ? '' : 's') + '</span></div></a>';
//       }).join('');
//       const m = FF.modal('<h3>' + ic('zap', 20) + ' You have ' + total + ' offer' + (total === 1 ? '' : 's') + ' waiting</h3>' +
//         '<p class="muted">Professionals have replied to your request. Pick one to review the price and arrival time.</p>' +
//         '<div class="stack">' + rows + '</div>' +
//         '<div class="row end"><button class="btn ghost" data-later>Later</button><a class="btn" href="#/requests" data-go>View all offers</a></div>');
//       m.el.addEventListener('click', function (e) {
//         if (e.target.closest('a, [data-later]')) m.close();
//       });
//     } catch (e) { /* the pop-up is optional, never block the page */ }
//   }

//   FF.start({
//     role: 'customer', home: '#/home',
//     links: [
//       { hash: '#/home', label: 'Home', icon: 'home' },
//       { hash: '#/new', label: 'New request', icon: 'plus' },
//       { hash: '#/requests', label: 'My requests', icon: 'list', also: ['#/r/'] },
//       { hash: '#/bookings', label: 'Bookings', icon: 'calendar' },
//       { hash: '#/profile', label: 'Profile', icon: 'user' },
//     ],
//     routes: [
//       { re: /^#\/home$/, fn: home }, { re: /^#\/new$/, fn: newRequest }, { re: /^#\/requests$/, fn: requestsPage },
//       { re: /^#\/r\/([0-9a-fA-F-]{36})$/, fn: detail }, { re: /^#\/bookings$/, fn: bookings }, { re: /^#\/profile$/, fn: profile },
//     ],
//     toast: function (ev) {
//       return { 'offer.created': 'New offer on your request', 'booking.created': 'Your booking is confirmed', 'booking.status_changed': 'Your booking was updated', 'planner.assigned': 'A provider was assigned to your request' }[ev.type] || null;
//     },
//   }).then(offerPopup);
// })();
(function () {
  'use strict';
  const { ic, esc, fmt, label, meter, chip, toast, fail, confirmBox, diagCard, timeline, empty, skel, stat, countUp, CATS, STATUSES, LANGS } = FF;
  const api = FixAPI;
  const $ = (s) => document.querySelector(s);
  const catOpts = (all) => (all ? '<option value="">All categories</option>' : '') + CATS.map((c) => '<option value="' + c + '">' + esc(label(c)) + '</option>').join('');
  const reqRow = (i) => '<a class="req" href="#/r/' + esc(i.id) + '"><div class="row"><strong>' + esc(i.title) + '</strong><span class="row gap">' + meter(i.meter_level) + chip(i.status) + '</span></div><div class="muted small">' + esc(label(i.category)) + ' · ' + i.offer_count + ' offer' + (i.offer_count === 1 ? '' : 's') + ' · ' + fmt(i.created_at) + '</div></a>';
  const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
  const langNames = (arr) => (arr && arr.length ? arr : ['en']).map((k) => LANGS[k] || k).join(', ');

  // Provider contact: the API only sends the number while the booking is active
  function contactRow(status, name, phone) {
    if (status !== 'confirmed' && status !== 'in_progress') return '';
    const who = esc(name || 'Your provider');
    if (phone) {
      return '<div class="contact">' + ic('phone', 20) + '<span><strong>' + who + '</strong><br><span class="muted small">' + esc(phone) + '</span></span>' +
        '<a class="btn sm" href="' + esc(telHref(phone)) + '">' + ic('phone', 16) + ' Call</a></div>';
    }
    return '<div class="notice">' + who + ' has not added a phone number yet.</div>';
  }

  // ------------------------------------------------------------------ home
  async function home(ctx) {
    const v = FF.view();
    v.innerHTML = '<section class="showcase"><div class="showcase-in">' +
      '<h1>What needs fixing today?</h1>' +
      '<p>Describe it, record it or snap a photo.</p>' +
      '<a class="btn lg" href="#/new">' + ic('plus') + ' New request</a></div></section>' +
      '<div class="stats" id="stats">' + skel(1) + '</div>' +
      '<div class="card"><div class="row"><h2>Recent requests</h2><a href="#/requests">View all</a></div><div id="recent" class="stack"></div></div>';
    async function load() {
      const res = await Promise.all([api.get('/requests', { limit: 100 }), api.get('/bookings', { limit: 100 })]);
      if (!ctx.alive()) return;
      const rs = res[0].items, bs = res[1].items;
      const open = rs.filter((r) => r.status === 'open' || r.status === 'offers_received');
      const waiting = open.reduce((n, r) => n + (r.offer_count || 0), 0);
      $('#stats').innerHTML = stat('inbox', 'Open requests', open.length, '#/requests') + stat('zap', 'Offers waiting', waiting, '#/requests') +
        stat('calendar', 'Upcoming bookings', bs.filter((b) => b.status === 'confirmed' || b.status === 'in_progress').length, '#/bookings') +
        stat('check', 'Completed jobs', bs.filter((b) => b.status === 'completed').length, '#/bookings');
      countUp($('#stats'));
      $('#recent').innerHTML = rs.length ? rs.slice(0, 4).map(reqRow).join('') : empty('inbox', 'No requests yet', 'Post your first problem and offers will appear here.', '<a class="btn" href="#/new">' + ic('plus') + ' New request</a>', true);
    }
    FF.current.reload = load;
    await load();
  }

  // ------------------------------------------------------------------ new request (voice + photo)
  async function newRequest() {
    const v = FF.view();
    const S = { media: [], notes: [], photos: 0, diagnosis: null, transcript: null };
    let rec = null, stream = null, timer = null, tick = null;
    v.innerHTML = '<div><h1>New request</h1><p class="muted">Tell us what is wrong. Speak, type or add photos, whatever is easiest.</p></div>' +
      '<form id="f" class="card" novalidate>' +
      '<div class="capture"><button class="capbtn" type="button" id="mic">' + ic('mic', 22) + '<span id="micLabel">Record voice</span><small>Describe it in your own language</small></button>' +
      '<label class="capbtn" for="photo">' + ic('camera', 22) + '<span>Add photos</span><small id="photoCount">Up to 4 photos</small></label>' +
      '<label class="capbtn" for="audioFile">' + ic('inbox', 22) + '<span>Upload voice note</span><small>mp3, m4a, wav, webm or ogg, up to 10 MB</small></label>' +
      '<input id="photo" type="file" accept="image/*" multiple hidden>' +
      '<input id="audioFile" type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.webm" hidden></div>' +
      '<div id="recbar" class="recbar hidden"><span class="rec-dot"></span><strong id="recTime">0:00</strong><span class="muted small">Recording... tap Stop when you are done</span></div>' +
      '<div id="thumbs" class="thumbs"></div>' +
      '<div class="grid2"><div class="field"><label for="cat">Category</label><select id="cat">' + catOpts(false) + '</select></div>' +
      '<div class="field"><label for="title">Title</label><input id="title" maxlength="120" placeholder="e.g. Leaking kitchen tap"></div></div>' +
      '<div class="field"><label for="desc">Describe the problem</label><textarea id="desc" rows="4" maxlength="2000"></textarea></div>' +
      '<div id="diag"></div>' +
      '<div class="field"><label for="addr">Address</label><input id="addr" maxlength="300" autocomplete="street-address"></div>' +
      '<div class="grid3"><div class="field"><label for="lat">Latitude</label><input id="lat" type="number" step="any"></div>' +
      '<div class="field"><label for="lng">Longitude</label><input id="lng" type="number" step="any"></div>' +
      '<div class="field"><label>&nbsp;</label><button class="btn ghost block" type="button" id="loc">' + ic('pin') + ' Use my location</button></div></div>' +
      '<button class="btn block" id="go" type="submit">Send request</button></form>';

    const mic = $('#mic');
    function setMic(on) {
      mic.classList.toggle('on', on);
      $('#micLabel').textContent = on ? 'Stop recording' : 'Record voice';
      $('#recbar').classList.toggle('hidden', !on);
    }
    FF.current.cleanup = function () {
      clearTimeout(timer); clearInterval(tick);
      if (rec && rec.state === 'recording') { rec.onstop = null; rec.stop(); }
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };

    function compress(file) {
      return new Promise(function (resolve, reject) {
        const img = new Image(), url = URL.createObjectURL(file);
        img.onload = function () {
          const k = Math.min(1, 1600 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not process that photo.')); }, 'image/jpeg', 0.8);
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
        img.src = url;
      });
    }

    async function sendVoice(blob) {
      const ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
      const fd = new FormData();
      fd.append('audio', blob, 'voice.' + ext);
      fd.append('language', FF.me.profile.language || 'en');
      toast('Listening to your recording...');
      try {
        const r = await api.upload('/intake/voice', fd);
        if (!$('#desc')) return;
        $('#desc').value = r.draft.description || r.transcript || '';
        $('#title').value = r.draft.title || '';
        if (CATS.indexOf(r.draft.category) >= 0) $('#cat').value = r.draft.category;
        S.transcript = r.transcript; S.diagnosis = r.diagnosis;
        if (r.media_id) S.media.push(r.media_id);
        $('#diag').innerHTML = diagCard(r.diagnosis);
        toast('Done. Check the details, then send your request.', 'success');
      } catch (e) { fail(e); }
    }

    mic.onclick = async function () {
      if (rec && rec.state === 'recording') { rec.stop(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) return toast('Voice recording needs a modern browser and HTTPS.', 'error');
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (e) { return toast('Microphone access was blocked. Allow it in the browser and try again.', 'error'); }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const chunks = [];
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      rec.onstop = async function () {
        clearTimeout(timer); clearInterval(tick);
        stream.getTracks().forEach((t) => t.stop());
        setMic(false);
        const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
        if (blob.size < 1000) return toast('That recording was empty. Try again.', 'error');
        mic.disabled = true; await sendVoice(blob); mic.disabled = false;
      };
      rec.start(); setMic(true);
      let secs = 0; $('#recTime').textContent = '0:00';
      tick = setInterval(function () { secs++; $('#recTime').textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0'); }, 1000);
      timer = setTimeout(function () { rec.stop(); }, 60000);
    };

    $('#photo').onchange = async function (ev) {
      const files = Array.from(ev.target.files); ev.target.value = '';
      for (const f of files) {
        if (S.photos >= 4) { toast('You can add up to 4 photos.', 'error'); break; }
        try {
          toast('Uploading photo...');
          const fd = new FormData();
          fd.append('photo', await compress(f), 'photo.jpg');
          fd.append('language', FF.me.profile.language || 'en');
          const r = await api.upload('/intake/photo', fd);
          if (!$('#thumbs')) return;
          S.media.push(r.media_id); S.photos++; S.diagnosis = null; $('#diag').innerHTML = '';
          if (r.analysis && r.analysis.summary) S.notes.push(r.analysis.summary);
          if (r.url) $('#thumbs').insertAdjacentHTML('beforeend', '<img src="' + esc(r.url) + '" alt="">');
          $('#photoCount').textContent = S.photos + ' of 4 added';
        } catch (e) { fail(e); }
      }
    };

    $('#audioFile').onchange = async function (ev) {
      const f = ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      if (rec && rec.state === 'recording') return toast('Stop the recording first.', 'error');
      if (f.size > 10 * 1024 * 1024) return toast('That file is too large. Voice notes can be up to 10 MB.', 'error');
      if (f.size < 1000) return toast('That file looks empty. Choose another one.', 'error');
      mic.disabled = true;
      await sendVoice(f);
      mic.disabled = false;
    };

    $('#desc').addEventListener('input', function () { S.diagnosis = null; $('#diag').innerHTML = ''; });

    async function reverseGeocode(lat, lng) {
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng);
        if (!r.ok) return null;
        const j = await r.json();
        return j.display_name || null;
      } catch (_) { return null; }
    }
    $('#loc').onclick = function () {
      if (!navigator.geolocation) return toast('Location is not available. Type latitude and longitude.', 'error');
      navigator.geolocation.getCurrentPosition(async function (p) {
        const lat = p.coords.latitude, lng = p.coords.longitude;
        $('#lat').value = lat.toFixed(5); $('#lng').value = lng.toFixed(5);
        toast('Location added.', 'success');
        if ($('#addr') && !$('#addr').value.trim()) {
          const a = await reverseGeocode(lat, lng);
          if (a && $('#addr') && !$('#addr').value.trim()) $('#addr').value = a.slice(0, 300);
        }
      }, function () { toast('Could not get your location. Type latitude and longitude instead.', 'error'); }, { timeout: 10000 });
    };

    $('#f').onsubmit = async function (e) {
      e.preventDefault();
      const description = $('#desc').value.trim(), title = $('#title').value.trim();
      const lat = parseFloat($('#lat').value), lng = parseFloat($('#lng').value);
      if (!description && !title) return toast('Describe the problem: type it or record it.', 'error');
      if (!isFinite(lat) || !isFinite(lng)) return toast('Add your location: tap "Use my location" or type latitude and longitude.', 'error');
      const go = $('#go'); go.disabled = true; go.textContent = 'Sending...';
      try {
        if (!S.diagnosis) {
          try {
            S.diagnosis = await api.post('/intake/diagnose', { description: description || title, transcript: S.transcript || undefined, photo_notes: S.notes, language: FF.me.profile.language || 'en' });
          } catch (_) { /* AI unavailable: the request is still sent */ }
        }
        const body = { category: $('#cat').value, title: title || undefined, description: description || undefined, transcript: S.transcript || undefined, lat: lat, lng: lng, address: $('#addr').value.trim() || undefined, media_ids: S.media, diagnosis: S.diagnosis || undefined };
        let r;
        try { r = await api.post('/requests', body); }
        catch (err) {
          if (err.status === 422 && (err.details || []).some((d) => d.field === 'diagnosis')) { delete body.diagnosis; r = await api.post('/requests', body); }
          else throw err;
        }
        toast('Request sent. Offers will appear here.', 'success');
        location.hash = '#/r/' + r.id;
      } catch (err) { fail(err); go.disabled = false; go.textContent = 'Send request'; }
    };
  }

  // ------------------------------------------------------------------ my requests
  async function requestsPage(ctx) {
    const v = FF.view();
    v.innerHTML = '<div class="row"><h1>My requests</h1><a class="btn" href="#/new">' + ic('plus') + ' New request</a></div>' +
      '<div class="card filters"><div class="grid4">' +
      '<div class="field"><label>Search</label><input id="q" placeholder="Title or details"></div>' +
      '<div class="field"><label>Status</label><select id="st"><option value="">All</option>' + STATUSES.map((s) => '<option value="' + s + '">' + esc(label(s)) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label>Category</label><select id="ct">' + catOpts(true) + '</select></div>' +
      '<div class="field"><label>Urgency</label><select id="mt"><option value="">Any</option><option>low</option><option>medium</option><option>high</option><option>critical</option></select></div>' +
      '<div class="field"><label>Sort by</label><select id="so"><option value="created_at:desc">Newest first</option><option value="severity_score:desc">Most urgent</option></select></div></div></div>' +
      '<div id="items" class="stack">' + skel(3) + '</div>';
    async function load() {
      const so = $('#so').value.split(':');
      const r = await api.get('/requests', { q: $('#q').value.trim(), status: $('#st').value, category: $('#ct').value, meter_level: $('#mt').value, sort: so[0], order: so[1], limit: 50 });
      if (!ctx.alive()) return;
      $('#items').innerHTML = r.items.length
        ? r.items.map(reqRow).join('') + (r.total > r.items.length ? '<p class="muted small">Showing ' + r.items.length + ' of ' + r.total + '.</p>' : '')
        : empty('inbox', 'Nothing here', 'No requests match these filters.', '<a class="btn" href="#/new">' + ic('plus') + ' New request</a>');
    }
    ['st', 'ct', 'mt', 'so'].forEach((id) => $('#' + id).addEventListener('change', () => load().catch(fail)));
    let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 300); });
    FF.current.reload = load;
    await load();
  }

  // ------------------------------------------------------------------ request detail + offers
  function offerCard(o, open) {
    const p = o.provider || {};
    const acts = open && o.status === 'pending'
      ? '<div class="row start gap"><button class="btn sm" data-act="accept" data-id="' + esc(o.id) + '">' + ic('check', 16) + ' Accept</button><button class="btn ghost sm" data-act="reject" data-id="' + esc(o.id) + '">Decline</button></div>'
      : (o.status === 'accepted' ? '<span class="chip booked">Accepted</span>' : '');
    return '<div class="offer ' + (o.status === 'accepted' ? 'accepted' : '') + '"><div class="row"><strong>' + esc(p.full_name) + '</strong><span class="price">' + esc(o.currency) + ' ' + esc(o.price) + '</span></div>' +
      '<div class="muted small">' + ic('star', 14) + ' ' + (p.rating_count ? Number(p.rating).toFixed(1) + ' (' + esc(p.rating_count) + ')' : 'new') + (p.is_verified ? ' · verified' : '') + (p.distance_km != null ? ' · ' + esc(p.distance_km) + ' km away' : '') + ' · arrives in ' + esc(o.eta_minutes) + ' min</div>' +
      '<div class="muted small">' + ic('globe', 14) + ' Speaks ' + esc(langNames(p.languages)) + '</div>' +
      '<div class="muted small">' + fmt(o.proposed_start) + ' to ' + fmt(o.proposed_end) + '</div>' + (o.message ? '<p>' + esc(o.message) + '</p>' : '') + acts + '</div>';
  }

  async function detail(ctx) {
    const id = ctx.m[1];
    FF.current.id = id;
    const ui = { sort: 'price:asc', maxPrice: '', minRating: '', language: '' };
    const myLang = FF.me.profile.language || 'en';
    const langOpts = '<option value="">Any language</option>' +
      [myLang].concat(Object.keys(LANGS).filter((k) => k !== myLang)).map((k) => '<option value="' + k + '">' + (k === myLang ? 'My language · ' : 'Speaks ') + esc(LANGS[k]) + '</option>').join('');
    const v = FF.view();
    v.innerHTML = '<a class="back" href="#/requests">← My requests</a><div id="head" class="card">' + skel(1) + '</div><div id="diag"></div>' +
      '<div class="card"><div class="row"><h2>Offers</h2><div class="row gap filt"><select id="osort"><option value="price:asc">Cheapest</option><option value="eta_minutes:asc">Fastest</option><option value="rating:desc">Best rated</option><option value="distance:asc">Nearest</option></select>' +
      '<select id="olang" title="Show only providers who speak this language">' + langOpts + '</select>' +
      '<input id="omax" type="number" min="0" placeholder="Max price"><select id="orate"><option value="">Any rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option></select></div></div><div id="offers" class="stack"></div></div>' +
      '<div class="card"><h2>Timeline</h2><div id="tl"></div></div>';

    async function load() {
      const so = ui.sort.split(':');
      const res = await Promise.all([
        api.get('/requests/' + id), api.get('/requests/' + id + '/timeline'),
        api.get('/requests/' + id + '/offers', { sort: so[0], order: so[1], max_price: ui.maxPrice, min_rating: ui.minRating, language: ui.language }),
      ]);
      if (!ctx.alive()) return;
      const r = res[0], tl = res[1], offers = res[2];
      const open = r.status === 'open' || r.status === 'offers_received';
      const filtered = ui.maxPrice || ui.minRating || ui.language;
      const photos = (r.media || []).filter((x) => x.kind === 'photo' && x.url).map((x) => '<a href="' + esc(x.url) + '" target="_blank" rel="noopener"><img src="' + esc(x.url) + '" alt=""></a>').join('');
      const audio = (r.media || []).filter((x) => x.kind === 'audio' && x.url).map((x) => '<audio controls src="' + esc(x.url) + '"></audio>').join('');
      $('#head').innerHTML = '<div class="row"><h1>' + esc(r.title) + '</h1><span class="row gap">' + meter(r.meter_level) + chip(r.status) + '</span></div>' +
        '<p class="muted small">' + esc(label(r.category)) + ' · posted ' + fmt(r.created_at) + (r.address ? ' · ' + esc(r.address) : '') + '</p><p>' + esc(r.description) + '</p>' +
        (photos ? '<div class="thumbs">' + photos + '</div>' : '') + audio +
        (r.booking ? '<div class="notice">' + ic('calendar') + ' Booking ' + esc(label(r.booking.status)) + ': ' + fmt(r.booking.slot.start) + ' to ' + fmt(r.booking.slot.end) + '</div>' +
          contactRow(r.booking.status, r.booking.provider_name, r.booking.provider_phone) : '') +
        (function () {
          if (['open', 'offers_received', 'booked'].indexOf(r.status) < 0) return '';
          if (r.status === 'booked' && r.booking && (new Date(r.booking.slot.start).getTime() - Date.now()) < 20 * 60000)
            return '<div class="notice">This job starts in less than 20 minutes, so it can no longer be deleted. Please contact the provider.</div>';
          return '<button class="btn ghost sm" data-act="delete">' + ic('x', 16) + ' Delete request</button>';
        })();
      $('#diag').innerHTML = diagCard(r.diagnosis);
      $('#offers').innerHTML = offers.items.length
        ? offers.items.map((o) => offerCard(o, open)).join('')
        : (filtered
          ? empty('search', 'No offers match these filters', 'Try another language, price or rating.', '', true)
          : empty('inbox', 'No offers yet', 'Providers nearby have been notified. This page updates by itself.', '', true));
      $('#tl').innerHTML = timeline(tl.items);
    }

    async function act(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'delete' && !(await confirmBox('Delete this request?', 'It will be removed from open jobs. If a provider is already booked, they will be notified.', 'Delete request', true))) return;
      if (a === 'accept' && !(await confirmBox('Accept this offer?', 'This books the provider for the proposed time and declines the other offers.', 'Accept and book'))) return;
      b.disabled = true;
      try {
        if (a === 'delete') { await api.post('/requests/' + id + '/delete'); toast('Request deleted.', 'success'); location.hash = '#/requests'; return; }
        else if (a === 'accept') { await api.post('/offers/' + b.dataset.id + '/accept'); toast('Booked! The provider\'s phone number is now on this page.', 'success'); }
        else if (a === 'reject') await api.post('/offers/' + b.dataset.id + '/reject');
        await load();
      } catch (err) { fail(err); b.disabled = false; if (err.code === 'SLOT_CONFLICT' || err.code === 'TOO_LATE') load().catch(() => {}); }
    }
    $('#head').addEventListener('click', act);
    $('#offers').addEventListener('click', act);
    $('#osort').onchange = (e) => { ui.sort = e.target.value; load().catch(fail); };
    $('#olang').onchange = (e) => { ui.language = e.target.value; load().catch(fail); };
    $('#orate').onchange = (e) => { ui.minRating = e.target.value; load().catch(fail); };
    let t; $('#omax').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.maxPrice = e.target.value; load().catch(fail); }, 400); };
    FF.current.reload = load;
    await load();
  }

  // ------------------------------------------------------------------ bookings + profile
  async function bookings(ctx) {
    const v = FF.view();
    v.innerHTML = '<div class="row"><h1>My bookings</h1><select id="bs" class="inline"><option value="">All</option><option value="confirmed">Confirmed</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div><div id="items" class="stack">' + skel(3) + '</div>';
    async function load() {
      const r = await api.get('/bookings', { status: $('#bs').value, sort: 'slot_start', order: 'desc', limit: 50 });
      if (!ctx.alive()) return;
      $('#items').innerHTML = r.items.length ? r.items.map((b) =>
        '<article class="bcard"><div class="bcard-head"><h3>' + esc(b.request.title) + '</h3><span class="row gap">' + meter(b.request.meter_level) + chip(b.status) + '</span></div>' +
        '<div class="bcard-body"><p class="bcard-when">' + ic('calendar', 18) + ' ' + fmt(b.slot.start) + ' to ' + fmt(b.slot.end) + '</p>' +
        '<p class="muted small">' + esc(b.provider_name) + ' · ' + esc(label(b.request.category)) + '</p>' +
        contactRow(b.status, b.provider_name, b.provider_phone) +
        '<div class="row start gap"><a class="btn ghost sm" href="#/r/' + esc(b.request_id) + '">Details</a></div></div></article>').join('')
        : empty('calendar', 'No bookings yet', 'Accept an offer and your booking shows up here.', '', true);
    }
    $('#bs').onchange = () => load().catch(fail);
    FF.current.reload = load;
    await load();
  }

  async function profile() {
    const p = FF.me.profile;
    FF.view().innerHTML = '<h1>My profile</h1><form id="pf" class="card" novalidate><div class="grid2"><div class="field"><label for="pn">Full name</label><input id="pn" maxlength="120" value="' + esc(p.full_name) + '"></div>' +
      '<div class="field"><label for="pp">Phone</label><input id="pp" value="' + esc(p.phone) + '" placeholder="+91 98765 43210"></div></div>' +
      '<div class="field"><label for="pl">Language for AI replies</label><select id="pl">' + Object.keys(LANGS).map((k) => '<option value="' + k + '"' + (k === p.language ? ' selected' : '') + '>' + LANGS[k] + '</option>').join('') + '</select></div><button class="btn" id="ps">Save changes</button></form>';
    $('#pf').onsubmit = async function (e) {
      e.preventDefault();
      const name = $('#pn').value.trim(), phone = $('#pp').value.trim();
      if (!name) return toast('Please enter your name.', 'error');
      const body = { full_name: name, language: $('#pl').value };
      if (phone) body.phone = phone;
      $('#ps').disabled = true;
      try {
        const upd = await api.patch('/me', body);
        Object.assign(FF.me.profile, upd);
        if (FF.setLang) FF.setLang(upd.language);
        toast('Profile saved.', 'success');
      } catch (err) { fail(err); }
      $('#ps').disabled = false;
    };
  }

  // Pop-up on login: summarises offers waiting on open requests (once per login session)
  async function offerPopup() {
    try {
      const lo = document.getElementById('logout');
      if (lo) lo.addEventListener('click', function () { sessionStorage.removeItem('ff_offer_popup'); });
      if (sessionStorage.getItem('ff_offer_popup')) return;
      sessionStorage.setItem('ff_offer_popup', '1');
      const r = await api.get('/requests', { limit: 100 });
      const waiting = r.items.filter(function (i) { return (i.status === 'open' || i.status === 'offers_received') && i.offer_count > 0; });
      const total = waiting.reduce(function (n, i) { return n + i.offer_count; }, 0);
      if (!total) return;
      const rows = waiting.slice(0, 3).map(function (i) {
        return '<a class="req" href="#/r/' + esc(i.id) + '"><div class="row"><strong>' + esc(i.title) + '</strong><span class="chip offers_received">' + i.offer_count + ' offer' + (i.offer_count === 1 ? '' : 's') + '</span></div></a>';
      }).join('');
      const m = FF.modal('<h3>' + ic('zap', 20) + ' You have ' + total + ' offer' + (total === 1 ? '' : 's') + ' waiting</h3>' +
        '<p class="muted">Professionals have replied to your request. Pick one to review the price and arrival time.</p>' +
        '<div class="stack">' + rows + '</div>' +
        '<div class="row end"><button class="btn ghost" data-later>Later</button><a class="btn" href="#/requests" data-go>View all offers</a></div>');
      m.el.addEventListener('click', function (e) {
        if (e.target.closest('a, [data-later]')) m.close();
      });
    } catch (e) { /* the pop-up is optional, never block the page */ }
  }

  FF.start({
    role: 'customer', home: '#/home',
    links: [
      { hash: '#/home', label: 'Home', icon: 'home' },
      { hash: '#/new', label: 'New request', icon: 'plus' },
      { hash: '#/requests', label: 'My requests', icon: 'list', also: ['#/r/'] },
      { hash: '#/bookings', label: 'Bookings', icon: 'calendar' },
      { hash: '#/profile', label: 'Profile', icon: 'user' },
    ],
    routes: [
      { re: /^#\/home$/, fn: home }, { re: /^#\/new$/, fn: newRequest }, { re: /^#\/requests$/, fn: requestsPage },
      { re: /^#\/r\/([0-9a-fA-F-]{36})$/, fn: detail }, { re: /^#\/bookings$/, fn: bookings }, { re: /^#\/profile$/, fn: profile },
    ],
    toast: function (ev) {
      return { 'offer.created': 'New offer on your request', 'booking.created': 'Your booking is confirmed', 'booking.status_changed': 'Your booking was updated', 'planner.assigned': 'A provider was assigned to your request' }[ev.type] || null;
    },
  }).then(offerPopup);
})();