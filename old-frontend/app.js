(() => {
  "use strict";

  const CONFIG = window.FIXFLOW_CONFIG || {};
  const API_BASE = (CONFIG.API_BASE_URL || "").replace(/\/$/, "");
  const SUPABASE_URL = (CONFIG.SUPABASE_URL || "").replace(/\/$/, "");
  const ANON_KEY = CONFIG.SUPABASE_ANON_KEY || "";
  const STORAGE_KEYS = { access: "fixflow_access_token", refresh: "fixflow_refresh_token" };
  const CATEGORIES = [
    { id: "plumbing", name: "Plumbing", icon: "plumbing", hint: "Pipes, leaks & more" },
    { id: "electrical", name: "Electrical", icon: "electrical", hint: "Lights & wiring" },
    { id: "appliance_repair", name: "Appliance repair", icon: "appliance", hint: "Fix it, don't toss it" },
    { id: "cleaning", name: "Cleaning", icon: "cleaning", hint: "A fresh start" },
    { id: "carpentry", name: "Carpentry", icon: "carpentry", hint: "Repairs & woodwork" },
    { id: "painting", name: "Painting", icon: "painting", hint: "Give it new life" },
    { id: "pest_control", name: "Pest control", icon: "pest", hint: "Keep the bugs out" },
    { id: "other", name: "Something else", icon: "other", hint: "We've got you" },
  ];
  const EXT = {};
  const DEMO_NOW = Date.now();
  const state = {
    role: "customer", profile: { full_name: "Priya Sharma", role: "customer", phone: "", language: "en" },
    providerProfile: null, token: sessionStorage.getItem(STORAGE_KEYS.access), refreshToken: sessionStorage.getItem(STORAGE_KEYS.refresh),
    demo: true, requests: [], bookings: [], view: "overview", filter: "all", search: "", location: null,
    activeRequest: null, pollingId: null, pollTimer: null, pollDelay: 3000, visible: !document.hidden,
  };

  const icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 14h7M8.5 18h4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h6"/>',
    user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c.8-3.1 3.1-4.8 7-4.8s6.2 1.7 7 4.8"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.2 1-1.8 1.4-1.8 2.7M12 17.2v.1"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
    search: '<circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 4.3 4.3"/>',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    chat: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 9.7 9.7 0 0 1-4-.8L4 20l1.5-3.4A7.1 7.1 0 0 1 4 12c0-4.2 3.6-7.5 8-7.5s8 3.1 8 7Z"/><path d="M8 12h.1M12 12h.1M16 12h.1"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>',
    plumbing: '<path d="M5 4v5a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4v3M5 4h4M5 4V2M19 20h-4M19 20v2M15 13V9h4v4M13 9h8M7 13v6"/>',
    electrical: '<path d="M13 2 4.5 13h6l-.7 9L19.5 11h-6L13 2Z"/>',
    appliance: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8h14M9 5.5h.1M12 5.5h.1M8 12h8v5H8z"/>',
    cleaning: '<path d="m7 21 3-11M14 21l-3-11M7 10h7M8 6h6M10 2h2l2 4H8l2-4ZM5 21h11"/><path d="m18 4 .5 1.5L20 6l-1.5.5L18 8l-.5-1.5L16 6l1.5-.5L18 4Z"/>',
    carpentry: '<path d="m3 7 4-4 4 4-4 4-4-4ZM13 17l4-4 4 4-4 4-4-4ZM9 9l6 6M5 19l3-3M16 5l3-3"/>',
    painting: '<path d="M4 5h16v7H4zM7 12v9M4 8H2M20 8h2M9 21h8"/><path d="M8 5V3h8v2"/>',
    pest: '<circle cx="12" cy="12" r="5"/><path d="M12 7V3M9 8 6 5M15 8l3-3M7 11H3M17 11h4M7 15l-3 3M17 15l3 3M9 16l-1 4M15 16l1 4"/>',
    other: '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="5"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.other}</svg>`;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const categoryName = (id) => CATEGORIES.find((item) => item.id === id)?.name || String(id || "Home service").replaceAll("_", " ");
  const dateAt = (delta, hour = 12) => { const date = new Date(DEMO_NOW + delta * 86400000); date.setHours(hour, 0, 0, 0); return date.toISOString(); };

  function seedDemo() {
    state.requests = [
      { id: "demo-sink", category: "plumbing", title: "Kitchen sink has a slow leak", description: "There is a small leak under the kitchen sink. I’ve placed a bowl underneath for now.", status: "offers_received", meter_level: "medium", severity_score: 39, offer_count: 3, created_at: dateAt(-1, 10), address: "Indiranagar, Bengaluru", my_offer_status: null, diagnosis: null },
      { id: "demo-fan", category: "electrical", title: "Ceiling fan making a clicking sound", description: "The fan works, but has started making a clicking noise on medium speed.", status: "open", meter_level: "low", severity_score: 22, offer_count: 0, created_at: dateAt(-3, 15), address: "Indiranagar, Bengaluru", my_offer_status: null, diagnosis: null },
    ];
    state.bookings = [{ id: "demo-booking", request_id: "demo-old", offer_id: "demo-offer", customer_id: "demo-customer", provider_id: "demo-provider", status: "confirmed", slot: { start: dateAt(2, 11), end: dateAt(2, 13) }, created_at: dateAt(-1), customer_name: "Priya Sharma", provider_name: "Ravi Kumar", request: { id: "demo-old", title: "Bathroom tap replacement", category: "plumbing", meter_level: "low", address: "Indiranagar, Bengaluru" } }];
  }

  function toast(title, message, error = false) {
    const node = document.createElement("div"); node.className = `toast${error ? " error" : ""}`;
    node.innerHTML = `<span class="toast-icon">${error ? "!" : "✓"}</span><span><strong>${esc(title)}</strong><p>${esc(message)}</p></span>`;
    $("#toastRegion").append(node); setTimeout(() => node.remove(), 4300);
  }

  function setIconNodes(root = document) {
    $$('[data-icon]', root).forEach((el) => { const name = [...el.classList].find((value) => value.startsWith("icon-"))?.slice(5) || el.dataset.icon; el.innerHTML = svg(name); });
  }

  function absoluteUrl(path) { return `${API_BASE}/api/v1${path.startsWith("/") ? path : `/${path}`}`; }
  async function api(path, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(absoluteUrl(path), { ...options, headers });
    if (response.status === 401 && retry && await refreshSession()) return api(path, options, false);
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.error?.message || `Something went wrong (${response.status}).`);
      error.status = response.status; error.code = body?.error?.code; error.details = body?.error?.details; throw error;
    }
    return body;
  }
  function saveSession(data) {
    state.token = data.access_token; state.refreshToken = data.refresh_token || null; state.demo = false;
    sessionStorage.setItem(STORAGE_KEYS.access, state.token);
    if (state.refreshToken) sessionStorage.setItem(STORAGE_KEYS.refresh, state.refreshToken);
  }
  async function refreshSession() {
    if (!SUPABASE_URL || !ANON_KEY || !state.refreshToken) return false;
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON_KEY }, body: JSON.stringify({ refresh_token: state.refreshToken }) });
      const data = await response.json(); if (!response.ok || !data.access_token) throw new Error("Session expired"); saveSession(data); return true;
    } catch { logout(false); return false; }
  }
  async function signIn(email, password) {
    if (!SUPABASE_URL || !ANON_KEY) throw new Error("Add the public Supabase URL and anon key in frontend/js/config.js to enable sign in.");
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON_KEY }, body: JSON.stringify({ email, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.msg || data.message || "Those sign-in details didn’t work. Please try again.");
    saveSession(data); closeModal();
    try { await loadAccount(); } catch (error) { logout(false); throw error; }
    toast("Welcome back", `You’re signed in as ${state.profile.full_name || email}.`);
  }
  function logout(notify = true) {
    state.token = null; state.refreshToken = null; state.demo = true; state.role = "customer"; state.profile = { full_name: "Priya Sharma", role: "customer", phone: "", language: "en" }; state.providerProfile = null;
    sessionStorage.removeItem(STORAGE_KEYS.access); sessionStorage.removeItem(STORAGE_KEYS.refresh); stopPolling(); seedDemo(); render();
    if (notify) toast("Signed out", "You’re back in preview mode.");
  }

  async function loadAccount() {
    const data = await api("/me"); state.profile = data.profile || state.profile; state.providerProfile = data.provider_profile || null; state.role = state.profile.role; state.demo = false;
    await loadData(); startPolling(); render();
  }
  async function loadData() {
    if (state.demo) { render(); return; }
    const tasks = [api("/requests?sort=created_at&order=desc&limit=50"), api("/bookings?sort=created_at&order=desc&limit=50")];
    const [requests, bookings] = await Promise.allSettled(tasks);
    if (requests.status === "fulfilled") state.requests = requests.value.items || [];
    else if (requests.reason.status === 401) { logout(false); return; }
    else toast("Requests didn’t load", requests.reason.message, true);
    if (bookings.status === "fulfilled") state.bookings = bookings.value.items || [];
    else if (bookings.reason.status !== 403) toast("Bookings didn’t load", bookings.reason.message, true);
    render();
  }

  function startPolling() {
    stopPolling(); if (state.demo) return;
    api("/updates?after_id=latest").then((data) => { state.pollingId = data.last_id; schedulePoll(3000); }).catch(() => schedulePoll(6000));
  }
  function stopPolling() { if (state.pollTimer) clearTimeout(state.pollTimer); state.pollTimer = null; }
  function schedulePoll(delay) { stopPolling(); if (state.visible && !state.demo) state.pollTimer = setTimeout(pollUpdates, delay); }
  async function pollUpdates() {
    if (!state.visible || state.demo) return;
    try {
      const data = await api(`/updates?after_id=${encodeURIComponent(state.pollingId ?? "latest")}`);
      state.pollingId = data.last_id; state.pollDelay = 3000;
      if ((data.events || []).length) await loadData();
      schedulePoll(3000);
    } catch { state.pollDelay = Math.min((state.pollDelay || 3000) * 2, 30000); schedulePoll(state.pollDelay); }
  }

  function localDate(value, options = { month: "short", day: "numeric" }) {
    if (!value) return "Recently"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "Recently";
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
  function relativeDate(value) {
    if (!value) return "Recently"; const delta = Date.now() - new Date(value).getTime();
    if (delta < 0) return localDate(value);
    if (delta < 3600000) return `${Math.max(1, Math.floor(delta / 60000))} min ago`;
    if (delta < 86400000) return `${Math.floor(delta / 3600000)} hr ago`;
    if (delta < 172800000) return "Yesterday";
    return localDate(value);
  }
  function formatTime(value) { if (!value) return "Time to be confirmed"; return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
  function money(value, currency = "INR") {
    const amount = Number(value || 0); try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); } catch { return `₹${amount}`; }
  }
  function initials(name) { return String(name || "G").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "G"; }
  function statusName(status) { return ({ open: "Finding your pro", offers_received: "Offers are in", booked: "Booked", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", pending: "Awaiting reply" })[status] || String(status || "Open").replaceAll("_", " "); }
  function visibleRequests() {
    const provider = state.role === "provider";
    let items = state.requests.filter((item) => provider ? ["open", "offers_received"].includes(item.status) : true);
    if (state.view === "requests" && state.filter !== "all") items = items.filter((item) => item.status === state.filter);
    if (state.search.trim()) { const query = state.search.trim().toLowerCase(); items = items.filter((item) => `${item.title} ${item.description} ${categoryName(item.category)}`.toLowerCase().includes(query)); }
    return items;
  }
  function requestCard(item) {
    const provider = state.role === "provider";
    const offerCount = Number(item.offer_count || 0);
    const action = provider ? (item.my_offer_status === "pending" ? "Offer sent" : "Send an offer") : (offerCount ? `Compare ${offerCount} offer${offerCount === 1 ? "" : "s"}` : "View request");
    const actionData = provider ? `data-action="${item.my_offer_status === "pending" ? "request-details" : "make-offer"}"` : `data-action="${offerCount ? "view-offers" : "request-details"}"`;
    const place = provider
      ? (item.distance_km != null ? `${Number(item.distance_km).toFixed(1)} km away` : "Within your service area")
      : (item.address || "Location shared after booking");
    return `<article class="request-card" data-request-id="${esc(item.id)}">
      <div class="request-card-main"><div class="request-meta"><span class="category-tag">${esc(categoryName(item.category))}</span><i class="meta-divider"></i><span class="request-date">${esc(relativeDate(item.created_at))}</span><i class="meta-divider"></i><span class="status-pill status-${esc(item.status)}">${esc(statusName(item.status))}</span></div>
      <h3>${esc(item.title || "Home service request")}</h3>
      <div class="request-footer"><span class="request-footer-item">${svg("pin")} ${esc(place)}</span>${!provider ? `<span class="request-footer-item offer-count">${svg("chat")} ${offerCount} offer${offerCount === 1 ? "" : "s"}</span>` : ""}</div></div>
      <div class="request-card-actions"><button class="small-action${provider && item.my_offer_status !== "pending" ? " primary-action" : ""}" ${actionData} ${provider && item.my_offer_status === "pending" ? "disabled" : ""}>${esc(action)}</button></div>
    </article>`;
  }
  function emptyState(title, message, button = true) {
    return `<div class="empty-state"><span class="empty-art">⌂</span><strong>${esc(title)}</strong><p>${esc(message)}</p>${button ? `<button class="small-action" data-action="new-request">Start a request <span>→</span></button>` : ""}</div>`;
  }
  function categoryCards() {
    return CATEGORIES.map((item) => `<button class="category-card" data-action="category" data-category="${item.id}"><span class="category-icon">${svg(item.icon)}</span><span><strong>${esc(item.name)}</strong></span></button>`).join("");
  }
  function upcomingMarkup() {
    const now = Date.now(); const booking = state.bookings.find((item) => ["confirmed", "in_progress"].includes(item.status) && new Date(item.slot?.end || 0).getTime() >= now);
    if (!booking) return `<div class="no-booking"><span class="no-booking-icon">${svg("calendar")}</span><strong>Nothing on the calendar yet</strong><p>Once you accept an offer, your booking will show up here.</p></div>`;
    const start = new Date(booking.slot?.start || booking.created_at); const providerName = booking.provider_name || "Your professional";
    return `<div class="upcoming-card"><div class="upcoming-date"><span class="date-tile"><b>${start.getDate()}</b><small>${new Intl.DateTimeFormat(undefined, { month: "short" }).format(start)}</small></span><span class="upcoming-date-copy"><strong>${esc(booking.request?.title || "Home service visit")}</strong><small>${esc(localDate(start, { weekday: "short", month: "short", day: "numeric" }))} · ${esc(formatTime(booking.slot?.start))}</small></span></div><div class="provider-mini"><span class="provider-photo">${esc(initials(providerName))}</span><span><strong>${esc(providerName)}</strong><small>${esc(categoryName(booking.request?.category))} professional</small></span><span class="provider-rating">★ 4.9</span></div></div>`;
  }

  function render() {
    if (EXT.customRender && EXT.customRender()) return;
    const name = state.profile.full_name || (state.demo ? "Priya Sharma" : "there");
    const firstName = name.trim().split(/\s+/)[0] || "there";
    const d = new Date(); $("#welcomeDate").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(d).toUpperCase();
    $("#welcomeTitle").innerHTML = `${state.role === "provider" ? "Good to see you" : "Good morning"}, ${esc(firstName)} <span class="wave">✳</span>`;
    $("#welcomeSubtitle").textContent = state.role === "provider" ? "Find a nearby repair request that fits your skills." : "Get trusted local help for the things that need fixing.";
    $("#topAvatar").textContent = initials(name);
    const provider = state.role === "provider"; $("#requestNavLabel").textContent = provider ? "Nearby requests" : "My requests";
    $("#heroTitle").innerHTML = provider ? "Find your next<br>repair project." : "Home repairs,<br>handled.";
    $("#heroCopy").textContent = provider ? "Browse nearby requests and send a clear offer to get started." : "Tell us what needs fixing. We’ll help you find the right local professional.";
    $("#heroCta").dataset.action = provider ? "browse-requests" : "new-request";
    $("#heroCta").innerHTML = `${provider ? "Explore nearby requests" : "Find a professional"} <span class="arrow">↗</span>`;
    $("#welcomeCta").dataset.action = provider ? "browse-requests" : "new-request";
    $("#welcomeCta").innerHTML = provider ? `<span class="button-icon">${svg("search")}</span> Browse requests` : `<span class="button-icon">${svg("plus")}</span> New request`;
    const active = provider ? state.requests.filter((item) => ["open", "offers_received"].includes(item.status)).length : state.requests.filter((item) => !["completed", "cancelled"].includes(item.status)).length;
    $("#requestNavCount").textContent = active || ""; $("#categoryGrid").innerHTML = categoryCards(); $("#upcomingBooking").innerHTML = upcomingMarkup();
    const requests = visibleRequests(); const activeRequests = requests.filter((item) => !["completed", "cancelled"].includes(item.status));
    $("#activeHeading").innerHTML = `${provider ? "Nearby requests" : "Your requests"} <span class="heading-count" id="activeCount">${activeRequests.length}</span>`;
    $("#requestPreview").innerHTML = activeRequests.length ? activeRequests.slice(0, 3).map(requestCard).join("") : emptyState(provider ? "No new requests nearby" : "A fresh start for your home", provider ? "New local service requests will appear here." : "Tell us what needs fixing and we'll find the right local pro.", !provider);
    $("#crumbPage").textContent = ({ overview: "Overview", requests: provider ? "Nearby requests" : "My requests", bookings: "Bookings" })[state.view];
    $$(".nav-link[data-view]").forEach((node) => node.classList.toggle("active", node.dataset.view === state.view));
    $("#contentWrap").querySelector(".welcome-row").classList.toggle("hidden", state.view !== "overview");
    $("#contentWrap").querySelector(".hero-banner").classList.toggle("hidden", state.view !== "overview");
    $("#contentWrap").querySelector(".dashboard-grid").classList.toggle("hidden", state.view !== "overview");
    const listView = $("#listView"); listView.classList.toggle("hidden", state.view === "overview");
    if (state.view !== "overview") renderListView();
    if (EXT.afterRender) EXT.afterRender();
  }

  function renderListView() {
    const isBooking = state.view === "bookings";
    $("#listOverline").textContent = isBooking ? "THE PLANS YOU’VE MADE" : state.role === "provider" ? "GOOD WORK STARTS HERE" : "YOUR HOME, AT A GLANCE";
    $("#listTitle").textContent = isBooking ? "Bookings" : state.role === "provider" ? "Nearby requests" : "My requests";
    const cta = $("#listCta");
    if (state.role === "provider") {
      cta.classList.toggle("hidden", !isBooking);
      cta.dataset.view = "requests"; cta.removeAttribute("data-action"); cta.innerHTML = `${svg("search")} Nearby requests`;
    } else {
      cta.classList.remove("hidden"); cta.dataset.action = "new-request"; cta.removeAttribute("data-view"); cta.innerHTML = `<span class="button-icon">${svg("plus")}</span> New request`;
    }
    $("#filterPills").innerHTML = isBooking ? `<span class="tab-indicator"><span class="status-dot"></span> Live bookings</span>` : ["all", "open", "offers_received", "booked", "in_progress", "completed"].map((filter) => `<button class="filter-pill${state.filter === filter ? " active" : ""}" data-filter="${filter}">${filter === "all" ? "All requests" : esc(statusName(filter))}</button>`).join("");
    const countNode = $("#resultsCount"); const list = $("#fullList");
    if (isBooking) {
      const filtered = state.bookings.filter((item) => !state.search || `${item.request?.title || ""} ${item.provider_name || ""} ${item.customer_name || ""}`.toLowerCase().includes(state.search.toLowerCase()));
      countNode.textContent = `${filtered.length} booking${filtered.length === 1 ? "" : "s"}`;
      list.innerHTML = filtered.length ? filtered.map(bookingCard).join("") : `<div class="empty-state"><span class="empty-art">${svg("calendar")}</span><strong>No bookings yet</strong><p>Your confirmed appointments will be collected here so nothing slips through the cracks.</p><button class="small-action" data-view="overview">Browse services <span>→</span></button></div>`;
      return;
    }
    const items = visibleRequests(); countNode.textContent = `${items.length} request${items.length === 1 ? "" : "s"}`;
    list.innerHTML = items.length ? items.map(requestCard).join("") : emptyState(state.role === "provider" ? "Nothing to pick up right now" : "No requests in this view", state.role === "provider" ? "Check back soon for new requests in your service area." : "Create your first request and we’ll help find a professional.", state.role !== "provider");
  }
  function bookingCard(booking) {
    const request = booking.request || {}; const start = booking.slot?.start; const providerName = booking.provider_name || "Professional"; const other = state.role === "provider" ? booking.customer_name || "Customer" : providerName;
    return `<article class="request-card booking-card" data-booking-id="${esc(booking.id)}"><div class="request-card-main"><div class="request-meta"><span class="category-tag">${esc(categoryName(request.category))}</span><i class="meta-divider"></i><span class="request-date">${esc(localDate(start, { weekday: "short", month: "short", day: "numeric" }))} · ${esc(formatTime(start))}</span><i class="meta-divider"></i><span class="status-pill status-${esc(booking.status)}">${esc(statusName(booking.status))}</span></div><h3>${esc(request.title || "Home service visit")}</h3><p class="request-description">${esc(request.address || "Address shared in your booking details")}</p><div class="request-footer"><span class="request-footer-item">${svg("user")} ${esc(other)}</span><span class="request-footer-item">${svg("clock")} ${esc(formatTime(start))}</span></div></div><div class="request-card-actions"><div class="provider-mini"><span class="provider-photo">${esc(initials(other))}</span></div>${booking.status === "confirmed" && state.role === "provider" ? `<button class="small-action primary-action" data-action="booking-start">Start work</button>` : booking.status === "in_progress" && state.role === "provider" ? `<button class="small-action primary-action" data-action="booking-complete">Mark complete</button>` : booking.status === "confirmed" && state.role === "customer" ? `<button class="small-action" data-action="booking-cancel">Cancel booking</button>` : ""}</div></article>`;
  }

  function showModal(content) {
    $("#modalCard").innerHTML = content; setIconNodes($("#modalCard")); $("#modalBackdrop").classList.remove("hidden"); document.body.style.overflow = "hidden";
    const first = $("input, select, textarea, button", $("#modalCard")); if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() { $("#modalBackdrop").classList.add("hidden"); $("#modalCard").innerHTML = ""; document.body.style.overflow = ""; state.activeRequest = null; }
  function modalShell(title, subtitle, body, actions, widthClass = "") {
    return `<div class="modal-heading"><div><h2 id="modalTitle">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="modal-close" aria-label="Close" data-action="close-modal"><span data-icon="close"></span></button></div>${body}${actions ? `<div class="modal-actions">${actions}</div>` : ""}`;
  }

  function openRequestModal(category = "") {
    if (state.role === "provider") { toast("Switch to a customer preview", "Provider accounts can respond to nearby requests."); return; }
    state.location = null;
    const categoryOptions = CATEGORIES.map((item) => `<option value="${item.id}" ${category === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("");
    const body = `<form id="requestForm" class="form-grid"><div class="field"><label for="requestCategory">Service category</label><select id="requestCategory" name="category" required>${categoryOptions}</select></div><div class="field"><label for="requestTitle">What needs attention?</label><input id="requestTitle" name="title" maxlength="120" placeholder="e.g. Leaking kitchen sink" required /></div><div class="field full"><label for="requestDescription">A few details help us find the right person</label><textarea id="requestDescription" name="description" maxlength="2000" placeholder="Tell us what happened, when it started, and anything else a professional should know." required></textarea><span class="field-hint">Your note is only shared with professionals who can help.</span></div><div class="field full"><label for="requestAddress">Service address or neighborhood</label><input id="requestAddress" name="address" maxlength="300" placeholder="Street, neighborhood, or landmark" required /></div><div class="field full"><div class="location-box"><span class="location-icon">${svg("pin")}</span><span class="location-copy"><strong id="locationTitle">Set your service location</strong><small id="locationHint">We use this to match you with nearby professionals.</small></span><button class="location-action" type="button" data-action="locate-me">Use my location</button></div></div></form>`;
    const actions = `<small>By continuing, you agree to share these details with matched local professionals.</small><span class="modal-actions-right"><button type="button" class="button button-quiet" data-action="close-modal">Cancel</button><button type="submit" form="requestForm" class="button button-primary" id="submitRequest">Find my pro <span>→</span></button></span>`;
    showModal(modalShell("Tell us what needs a hand", "A little detail goes a long way. We’ll do the matching from here.", body, actions));
    if (!state.demo) $("#submitRequest").disabled = true;
    if (EXT.afterRequestModal) EXT.afterRequestModal();
  }
  async function locateMe() {
    if (!navigator.geolocation) { toast("Location isn’t available", "Try a modern browser or contact us for help.", true); return; }
    $("#locationTitle").textContent = "Finding your location…"; $("#locationHint").textContent = "Your browser may ask you to allow location access.";
    navigator.geolocation.getCurrentPosition((position) => {
      state.location = { lat: position.coords.latitude, lng: position.coords.longitude };
      $("#locationTitle").textContent = "Your location is ready";
      $("#locationHint").textContent = `${state.location.lat.toFixed(4)}, ${state.location.lng.toFixed(4)} · Shared only with matched professionals`;
      $("#submitRequest").disabled = false;
    }, (error) => {
      state.location = null; $("#locationTitle").textContent = "Location permission needed";
      $("#locationHint").textContent = error.code === 1 ? "Allow location in your browser, or try again." : "Could not find you just now. Please try again.";
      toast("We need your location", "Allow location access so we can find nearby help.", true);
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }
  async function createRequest(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (state.demo) {
      const request = { id: `demo-${Date.now()}`, category: data.category, title: data.title.trim(), description: data.description.trim(), address: data.address.trim(), status: "open", meter_level: "low", severity_score: 20, offer_count: 0, created_at: new Date().toISOString(), my_offer_status: null };
      state.requests.unshift(request); closeModal(); state.view = "overview"; render(); toast("Request is on its way", "Nearby professionals can now take a look."); return;
    }
    if (!state.location) { toast("Set your location first", "We use it to match you with nearby professionals.", true); return; }
    const button = $("#submitRequest"); button.disabled = true; button.textContent = "Sending…";
    try {
      await api("/requests", { method: "POST", body: JSON.stringify({ category: data.category, title: data.title.trim(), description: data.description.trim(), address: data.address.trim(), lat: state.location.lat, lng: state.location.lng, language: state.profile.language || "en", ...(EXT.requestPayload ? EXT.requestPayload() : {}) }) });
      closeModal(); state.view = "overview"; await loadData(); toast("Request sent", "We’ll let you know when local professionals respond.");
    } catch (error) { button.disabled = false; button.textContent = "Find my pro →"; toast("Couldn’t send that request", error.message, true); }
  }

  async function openRequestDetails(request) {
    state.activeRequest = request;
    if (!state.demo) { try { request = await api(`/requests/${encodeURIComponent(request.id)}`); state.activeRequest = request; } catch (error) { toast("Request details unavailable", error.message, true); return; } }
    const body = `<div class="request-meta"><span class="category-tag">${esc(categoryName(request.category))}</span><i class="meta-divider"></i><span class="status-pill status-${esc(request.status)}">${esc(statusName(request.status))}</span></div><p style="margin:12px 0;color:#647168;font-size:11px;line-height:1.65">${esc(request.description || "No additional details shared.")}</p><div class="location-box"><span class="location-icon">${svg("pin")}</span><span class="location-copy"><strong>Service area</strong><small>${esc(request.address || (request.distance_km != null ? `${Number(request.distance_km).toFixed(1)} km away` : "Exact address shared after booking"))}</small></span></div>${request.diagnosis?.summary ? `<div style="margin-top:13px;padding:12px;border-radius:9px;background:#f7f9f4"><span class="section-overline">HOME HEALTH CHECK</span><p style="margin:5px 0 0;color:#738078;font-size:9px;line-height:1.55">${esc(request.diagnosis.summary)}</p></div>` : ""}`;
    const canCancel = state.role === "customer" && ["open", "offers_received"].includes(request.status);
    showModal(modalShell(request.title || "Request details", `Created ${relativeDate(request.created_at)} · ${categoryName(request.category)}`, body, `<small>${state.role === "provider" ? "Share a thoughtful offer to get this job." : "Your full address is only shared with your booked professional."}</small><span class="modal-actions-right">${canCancel ? `<button class="button button-quiet" data-action="cancel-request">Cancel request</button>` : ""}<button class="button button-quiet" data-action="close-modal">Close</button>${state.role === "provider" && ["open", "offers_received"].includes(request.status) && !state.requests.some((item) => item.id === request.id && item.my_offer_status === "pending") ? `<button class="button button-primary" data-action="make-offer">Send an offer</button>` : ""}</span>`));
  }

  function defaultDateTime(offsetHours) { const date = new Date(Date.now() + offsetHours * 3600000); date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function openOfferModal(request) {
    state.activeRequest = request;
    const body = `<form id="offerForm" class="form-grid"><div class="field"><label for="offerPrice">Your quote (₹)</label><input id="offerPrice" name="price" type="number" min="1" step="1" placeholder="e.g. 850" required /></div><div class="field"><label for="offerEta">Estimated time to arrive</label><select id="offerEta" name="eta_minutes" required><option value="30">Within 30 minutes</option><option value="60" selected>Within an hour</option><option value="120">Within 2 hours</option><option value="240">Later today</option><option value="1440">Tomorrow</option></select></div><div class="field"><label for="offerStart">Available from</label><input id="offerStart" name="proposed_start" type="datetime-local" min="${defaultDateTime(1)}" value="${defaultDateTime(3)}" required /></div><div class="field"><label for="offerEnd">Available until</label><input id="offerEnd" name="proposed_end" type="datetime-local" value="${defaultDateTime(5)}" required /></div><div class="field full"><label for="offerMessage">A note for the customer <span style="color:#a2aaa4;font-weight:400">(optional)</span></label><textarea id="offerMessage" name="message" maxlength="500" placeholder="Introduce yourself and share how you’d approach the repair."></textarea></div></form>`;
    showModal(modalShell("Send an offer", request.title || "Share your price and availability with the customer.", body, `<small>Keep your quote clear and your schedule up to date.</small><span class="modal-actions-right"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit" form="offerForm">Send offer <span>→</span></button></span>`));
  }
  async function submitOffer(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (state.demo) {
      const request = state.requests.find((item) => item.id === state.activeRequest?.id);
      if (request) { request.offer_count = Number(request.offer_count || 0) + 1; request.status = "offers_received"; request.my_offer_status = "pending"; }
      closeModal(); render(); toast("Preview offer sent", "Your request response is now reflected in this local preview."); return;
    }
    const payload = { price: Number(data.price), eta_minutes: Number(data.eta_minutes), message: data.message.trim() || undefined, proposed_start: new Date(data.proposed_start).toISOString(), proposed_end: new Date(data.proposed_end).toISOString() };
    const button = $("button[type=submit]", form.parentElement.parentElement) || $("button[form=offerForm]"); button.disabled = true;
    try { await api(`/requests/${encodeURIComponent(state.activeRequest.id)}/offers`, { method: "POST", body: JSON.stringify(payload) }); closeModal(); await loadData(); toast("Offer sent", "The customer will be able to compare your offer."); }
    catch (error) { button.disabled = false; toast("Couldn’t send the offer", error.message, true); }
  }

  function demoOffers() {
    return [
      { id: "demo-offer-1", provider_id: "p1", price: 750, currency: "INR", eta_minutes: 35, message: "I’m nearby this morning and can replace the worn washer. Parts included in this quote.", proposed_start: dateAt(1, 10), proposed_end: dateAt(1, 13), status: "pending", provider: { full_name: "Ravi Kumar", rating: 4.9, rating_count: 128, is_verified: true, distance_km: 1.8 } },
      { id: "demo-offer-2", provider_id: "p2", price: 620, currency: "INR", eta_minutes: 90, message: "Happy to inspect first and confirm the final repair cost before starting.", proposed_start: dateAt(1, 14), proposed_end: dateAt(1, 17), status: "pending", provider: { full_name: "Meera Nair", rating: 4.8, rating_count: 86, is_verified: true, distance_km: 3.2 } },
      { id: "demo-offer-3", provider_id: "p3", price: 950, currency: "INR", eta_minutes: 60, message: "I can bring the parts and get this fixed in one visit.", proposed_start: dateAt(2, 11), proposed_end: dateAt(2, 15), status: "pending", provider: { full_name: "Arjun Das", rating: 5.0, rating_count: 54, is_verified: true, distance_km: 2.4 } },
    ];
  }
  async function openOffers(request) {
    state.activeRequest = request; let offers;
    if (state.demo) offers = demoOffers();
    else { try { const data = await api(`/requests/${encodeURIComponent(request.id)}/offers?sort=rating&order=desc`); offers = data.items || []; } catch (error) { toast("Offers didn’t load", error.message, true); return; } }
    const body = offers.length ? offers.map((offer) => {
      const person = offer.provider || {}; const start = offer.proposed_start; const end = offer.proposed_end;
      return `<div class="offer-card" data-offer-id="${esc(offer.id)}"><span class="offer-avatar">${esc(initials(person.full_name || "Pro"))}</span><span class="offer-info"><strong>${esc(person.full_name || "Local professional")} ${person.is_verified ? `<span class="status-pill" style="padding:2px 5px;font-size:7px">Verified</span>` : ""}</strong><small><span class="offer-rating">★ ${Number(person.rating || 0).toFixed(1)}</span> · ${Number(person.rating_count || 0)} reviews · ${person.distance_km != null ? `${Number(person.distance_km).toFixed(1)} km away` : `${offer.eta_minutes} min away`}</small><small>${Number(offer.eta_minutes)} min response · ${esc(localDate(start, { weekday: "short", month: "short", day: "numeric" }))}, ${esc(formatTime(start))}–${esc(formatTime(end))}</small></span><span class="offer-price">${esc(money(offer.price, offer.currency))}<small>total quote</small></span>${offer.message ? `<p class="offer-message">“${esc(offer.message)}”</p>` : ""}<span class="offer-actions"><button class="small-action" data-action="reject-offer">Pass</button><button class="small-action primary-action" data-action="accept-offer">Choose this pro</button></span></div>`;
    }).join("") : `<div class="empty-state"><span class="empty-art">${svg("chat")}</span><strong>No offers just yet</strong><p>We’ll let you know when local professionals respond to your request.</p></div>`;
    const canCancel = state.role === "customer" && ["open", "offers_received"].includes(request.status);
    showModal(modalShell("Meet your local pros", `${offers.length} ${offers.length === 1 ? "offer" : "offers"} for “${request.title || "your request"}”`, body, `<small>Compare price, availability, and community ratings before you choose.</small><span class="modal-actions-right">${canCancel ? `<button class="button button-quiet" data-action="cancel-request">Cancel request</button>` : ""}<button class="button button-quiet" data-action="close-modal">Done</button></span>`));
  }
  async function offerAction(offerId, action) {
    if (state.demo) { toast("Preview mode", action === "accept" ? "In the live app, accepting this offer creates a confirmed booking." : "Offer actions are available after you sign in."); if (action === "accept") { const offer = demoOffers().find((item) => item.id === offerId); if (offer) { state.bookings.unshift({ id: `demo-book-${Date.now()}`, request_id: state.activeRequest.id, offer_id: offer.id, status: "confirmed", slot: { start: offer.proposed_start, end: offer.proposed_end }, provider_name: offer.provider.full_name, request: state.activeRequest }); state.activeRequest.status = "booked"; state.activeRequest.offer_count = 0; closeModal(); render(); toast("Booking confirmed", `${offer.provider.full_name} is booked for the job.`); } } return; }
    try {
      if (action === "accept") await api(`/offers/${encodeURIComponent(offerId)}/accept`, { method: "POST" });
      else await api(`/offers/${encodeURIComponent(offerId)}/reject`, { method: "POST" });
      closeModal(); await loadData(); toast(action === "accept" ? "Booking confirmed" : "Offer declined", action === "accept" ? "Your professional is booked. We’ve added the visit to your calendar." : "That offer has been removed from your list.");
    } catch (error) { toast(action === "accept" ? "Couldn’t accept this offer" : "Couldn’t decline this offer", error.message, true); }
  }
  async function cancelRequest(request) {
    if (!window.confirm(`Cancel “${request.title || "this request"}”?`)) return;
    if (state.demo) { state.requests = state.requests.map((item) => item.id === request.id ? { ...item, status: "cancelled" } : item); closeModal(); render(); toast("Request cancelled", "You can create a new request whenever you need us."); return; }
    try { await api(`/requests/${encodeURIComponent(request.id)}/cancel`, { method: "POST" }); closeModal(); await loadData(); toast("Request cancelled", "Your request has been closed."); } catch (error) { toast("Couldn’t cancel that request", error.message, true); }
  }
  async function updateBooking(booking, status) {
    if (state.demo) { state.bookings = state.bookings.map((item) => item.id === booking.id ? { ...item, status } : item); render(); toast(status === "cancelled" ? "Booking cancelled" : status === "completed" ? "Marked complete" : "Work started", "Your booking has been updated."); return; }
    try { await api(`/bookings/${encodeURIComponent(booking.id)}/status`, { method: "POST", body: JSON.stringify({ status }) }); await loadData(); toast("Booking updated", `Booking marked ${status.replaceAll("_", " ")}.`); } catch (error) { toast("Couldn’t update booking", error.message, true); }
  }

  function signInModal() {
    showModal(modalShell("Welcome back", "Sign in to manage your home repairs and bookings.", `<form class="form-grid" id="signInForm"><div class="field full"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" placeholder="you@example.com" required /></div><div class="field full"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Your password" required /></div></form>`, `<small>Your account is protected by Supabase authentication.</small><span class="modal-actions-right"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit" form="signInForm">Sign in <span>→</span></button></span>`));
    if (!SUPABASE_URL || !ANON_KEY) { $("#modalCard .modal-actions small").textContent = "Add the public Supabase URL and anon key in frontend/js/config.js to connect your account."; $("#modalCard input").disabled = true; $$("#modalCard input").forEach((input) => input.disabled = true); $("#modalCard button[type=submit]").disabled = true; }
  }
  function openProfile() {
    if (state.demo) { signInModal(); return; }
    const isProvider = state.role === "provider";
    const body = `<form class="form-grid" id="profileForm"><div class="field full"><label for="profileName">Full name</label><input id="profileName" name="full_name" value="${esc(state.profile.full_name || "")}" maxlength="120" required /></div><div class="field"><label for="profilePhone">Phone number</label><input id="profilePhone" name="phone" value="${esc(state.profile.phone || "")}" maxlength="20" placeholder="+91 98765 43210" /></div><div class="field"><label for="profileLanguage">Language</label><select id="profileLanguage" name="language"><option value="en" ${state.profile.language === "en" ? "selected" : ""}>English</option><option value="hi" ${state.profile.language === "hi" ? "selected" : ""}>Hindi</option><option value="bn" ${state.profile.language === "bn" ? "selected" : ""}>Bengali</option><option value="ta" ${state.profile.language === "ta" ? "selected" : ""}>Tamil</option><option value="te" ${state.profile.language === "te" ? "selected" : ""}>Telugu</option></select></div>${isProvider ? `<div class="field full"><label for="providerCategories">Your service categories</label><select id="providerCategories" name="categories" multiple size="4">${CATEGORIES.map((item) => `<option value="${item.id}" ${(state.providerProfile?.categories || []).includes(item.id) ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select><span class="field-hint">Hold Ctrl or Command to select more than one.</span></div><div class="field"><label for="providerLat">Latitude</label><input id="providerLat" name="lat" type="number" step="any" value="${esc(state.providerProfile?.lat ?? "")}" placeholder="12.9716" /></div><div class="field"><label for="providerLng">Longitude</label><input id="providerLng" name="lng" type="number" step="any" value="${esc(state.providerProfile?.lng ?? "")}" placeholder="77.5946" /></div><div class="field"><label for="providerRadius">Service radius (km)</label><input id="providerRadius" name="service_radius_km" type="number" value="${esc(state.providerProfile?.service_radius_km ?? 15)}" min="1" max="500" /></div><div class="field"><label for="providerBio">About you</label><input id="providerBio" name="bio" value="${esc(state.providerProfile?.bio || "")}" maxlength="500" placeholder="A little about your experience" /></div>` : ""}</form>`;
    showModal(modalShell("Your profile", `${state.role === "provider" ? "Help customers get to know you." : "Keep your account details up to date."}`, body, `<small>${isProvider ? "Your role is verified by your FixFlow account." : "Your details are only used to manage your service requests."}</small><span class="modal-actions-right"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit" form="profileForm">Save changes</button></span>`));
  }
  async function saveProfile(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    if (state.role === "provider") {
      const picked = [...$("#providerCategories").selectedOptions].length;
      if (!picked) { toast("Pick at least one service", "Choose the categories you work in.", true); return; }
      if (values.lat === "" || values.lng === "") { toast("Add your location", "Enter your latitude and longitude so we can match you with nearby requests.", true); return; }
    }
    try {
      const updated = await api("/me", { method: "PATCH", body: JSON.stringify({ full_name: values.full_name, phone: values.phone || undefined, language: values.language }) }); state.profile = { ...state.profile, ...updated };
      if (state.role === "provider") {
        const categories = [...$("#providerCategories").selectedOptions].map((option) => option.value);
        state.providerProfile = await api("/me/provider-profile", { method: "PUT", body: JSON.stringify({ categories, lat: Number(values.lat), lng: Number(values.lng), service_radius_km: Number(values.service_radius_km), bio: values.bio || undefined }) });
      }
      closeModal(); render(); toast("Profile saved", "Your details have been updated.");
    } catch (error) { toast("Couldn’t save your profile", error.message, true); }
  }

  function openAccountMenu() {
    closeAccountMenu(); const backdrop = $("#popoverBackdrop"); backdrop.classList.remove("hidden");
    const pop = document.createElement("div"); pop.className = "account-popover"; pop.id = "accountPopover";
    const name = state.profile.full_name || "FixFlow member";
    pop.innerHTML = `<div class="popover-heading"><strong>${esc(name)}</strong><small>${state.demo ? "Interactive preview" : `${esc(state.profile.email || "Signed in account")}`}</small></div>${state.demo ? `<div class="popover-label">PREVIEW AS</div><button class="role-option${state.role === "customer" ? " current" : ""}" data-action="switch-role" data-role="customer"><span>⌂</span> Homeowner ${state.role === "customer" ? "<span>✓</span>" : ""}</button><button class="role-option${state.role === "provider" ? " current" : ""}" data-action="switch-role" data-role="provider"><span>✳</span> Local professional ${state.role === "provider" ? "<span>✓</span>" : ""}</button><button class="role-option" data-action="open-signin"><span>↗</span> Sign in to your account</button>` : `<button class="role-option" data-action="open-profile"><span>◉</span> Profile & settings <span>→</span></button><button class="role-option" data-action="sign-out"><span>↗</span> Sign out</button>`}`;
    document.body.append(pop);
  }
  function closeAccountMenu() { $("#accountPopover")?.remove(); $("#popoverBackdrop").classList.add("hidden"); }
  function switchDemoRole(role) { if (!state.demo) return; state.role = role; state.profile.role = role; state.profile.full_name = role === "provider" ? "Ravi Kumar" : "Priya Sharma"; state.providerProfile = role === "provider" ? { categories: ["plumbing", "electrical"], mode: "independent" } : null; closeAccountMenu(); state.view = "overview"; state.filter = "all"; render(); toast(`Previewing ${role === "provider" ? "professional" : "homeowner"} view`, "Try the navigation and request actions to explore the interface."); }

  function findRequestFromTarget(target) { const card = target.closest("[data-request-id]"); return card ? state.requests.find((item) => String(item.id) === card.dataset.requestId) : state.activeRequest; }
  function findBookingFromTarget(target) { const card = target.closest("[data-booking-id]"); return card ? state.bookings.find((item) => String(item.id) === card.dataset.bookingId) : null; }
  function handleClick(event) {
    const viewNode = event.target.closest("[data-view]"); if (viewNode) { event.preventDefault(); state.view = viewNode.dataset.view; state.search = ""; $("#globalSearch").value = ""; $("#sidebar").classList.remove("open"); render(); return; }
    const filterNode = event.target.closest("[data-filter]"); if (filterNode) { state.filter = filterNode.dataset.filter; render(); return; }
    const button = event.target.closest("[data-action]"); if (!button) return;
    const action = button.dataset.action; const request = findRequestFromTarget(button); const booking = findBookingFromTarget(button);
    if (action === "new-request") openRequestModal();
    else if (action === "category") {
      if (state.role === "provider") { state.search = button.dataset.category.replaceAll("_", " "); $("#globalSearch").value = state.search; state.view = "requests"; render(); }
      else openRequestModal(button.dataset.category);
    }
    else if (action === "close-modal") closeModal();
    else if (action === "locate-me") locateMe();
    else if (action === "view-offers") { if (request) openOffers(request); }
    else if (action === "request-details") { if (request) openRequestDetails(request); }
    else if (action === "make-offer") { if (request) openOfferModal(request); }
    else if (action === "accept-offer" || action === "reject-offer") { const offer = button.closest("[data-offer-id]"); if (offer) offerAction(offer.dataset.offerId, action === "accept-offer" ? "accept" : "reject"); }
    else if (action === "booking-start" && booking) updateBooking(booking, "in_progress");
    else if (action === "booking-complete" && booking) updateBooking(booking, "completed");
    else if (action === "booking-cancel" && booking) updateBooking(booking, "cancelled");
    else if (action === "account-menu") openAccountMenu();
    else if (action === "switch-role") switchDemoRole(button.dataset.role);
    else if (action === "open-signin") { closeAccountMenu(); signInModal(); }
    else if (action === "open-profile") { closeAccountMenu(); openProfile(); }
    else if (action === "sign-out") { closeAccountMenu(); logout(); }
    else if (action === "help" || action === "learn-trust") toast("We’re here to help", "For this preview, explore the service categories or start a request.");
    else if (action === "notifications") toast("You’re all caught up", "New replies and booking updates will appear here.");
    else if (action === "cancel-request" && request) cancelRequest(request);
    else if (action === "cancel-request" && state.activeRequest) cancelRequest(state.activeRequest);
    else if (action === "browse-requests") { state.view = "requests"; state.search = ""; $("#globalSearch").value = ""; render(); }
  }

  function handleSubmit(event) {
    if (event.target.id === "requestForm") { event.preventDefault(); createRequest(event.target); }
    else if (event.target.id === "offerForm") { event.preventDefault(); submitOffer(event.target); }
    else if (event.target.id === "signInForm") { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target).entries()); signIn(data.email, data.password).catch((error) => toast("Sign in failed", error.message, true)); }
    else if (event.target.id === "profileForm") { event.preventDefault(); saveProfile(event.target); }
  }
  function bindEvents() {
    document.addEventListener("click", handleClick); document.addEventListener("submit", handleSubmit);
    $("#modalBackdrop").addEventListener("click", (event) => { if (event.target === $("#modalBackdrop")) closeModal(); });
    $("#popoverBackdrop").addEventListener("click", closeAccountMenu);
    $("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
    $("#globalSearch").addEventListener("input", (event) => { state.search = event.target.value; if (state.view === "overview" && state.search) state.view = "requests"; render(); $("#globalSearch").focus(); });
    document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#globalSearch").focus(); } if (event.key === "Escape") { closeModal(); closeAccountMenu(); $("#sidebar").classList.remove("open"); } });
    document.addEventListener("visibilitychange", () => { state.visible = !document.hidden; if (!state.visible) stopPolling(); else if (!state.demo) schedulePoll(1000); });
  }

  async function init() {
    setIconNodes(); bindEvents(); seedDemo(); render();
    if (state.token) {
      try { await loadAccount(); }
      catch (error) { logout(false); toast("Couldn’t reconnect", error.message, true); }
    }
  }
  window.FixFlow = { state, api, toast, showModal, closeModal, modalShell, render, loadData, esc, svg, $, $$, initials, categoryName, statusName, localDate, formatTime, relativeDate, money, setIconNodes, ext: EXT };
  init();
})();