// frontend/js/api.js
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || /PASTE_/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) {
    console.error('FixFlow: fill in SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js');
  }
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('FixFlow: supabase-js did not load. Check your internet connection and the script order.');
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const API = (cfg.API_BASE_URL || '') + '/api/v1';

  // Flask serves files, not folders: always link to index.html
  const HOME = {
    customer: '/customer/index.html',
    provider: '/provider/index.html',
    admin: '/admin/index.html',
  };
  const ROLE_LABEL = { customer: 'customer', provider: 'service provider', admin: 'admin' };

  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details || null;
    }
  }

  async function getToken() {
    const { data } = await sb.auth.getSession();
    return data && data.session ? data.session.access_token : null;
  }

  async function request(path, opts) {
    const o = opts || {};
    const method = o.method || 'GET';
    const auth = o.auth !== false;

    let url = API + path;
    if (o.query) {
      const qs = new URLSearchParams();
      Object.keys(o.query).forEach(function (k) {
        const v = o.query[k];
        if (v !== undefined && v !== null && v !== '') qs.append(k, v);
      });
      const s = qs.toString();
      if (s) url += (url.indexOf('?') >= 0 ? '&' : '?') + s;
    }

    const headers = {};
    if (auth) {
      const token = await getToken();
      if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Please log in.');
      headers.Authorization = 'Bearer ' + token;
    }

    let payload;
    if (o.form) {
      payload = o.form; // FormData: the browser sets the multipart boundary itself
    } else if (o.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(o.body);
    }

    let res;
    try {
      res = await fetch(url, { method: method, headers: headers, body: payload });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = null; }
    }
    if (res.ok) return data;

    if (res.status === 401 && auth && !o._retried) {
      const r = await sb.auth.refreshSession();
      if (!r.error && r.data && r.data.session) {
        return request(path, Object.assign({}, o, { _retried: true }));
      }
    }

    const err = data && data.error ? data.error : {};
    throw new ApiError(
      res.status,
      err.code || 'HTTP_' + res.status,
      err.message || 'Something went wrong (' + res.status + ').',
      err.details
    );
  }

  // ---------------------------------------------------------------- auth
  let _me = null;

  async function me(force) {
    if (_me && !force) return _me;
    _me = await request('/me');
    return _me;
  }

  function authError(error) {
    const raw = (error && error.message) || 'Authentication failed.';
    let msg = raw;
    if (/invalid login credentials/i.test(raw)) msg = 'Wrong email or password.';
    else if (/already registered/i.test(raw)) msg = 'An account with this email already exists. Try logging in.';
    return new ApiError((error && error.status) || 400, (error && error.code) || 'AUTH_ERROR', msg);
  }

  async function signOut() {
    _me = null;
    try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  }

  // expectedRole = 'customer' | 'provider' | null (null accepts any role, used by the admin page)
  async function signIn(expectedRole, email, password) {
    _me = null;
    const res = await sb.auth.signInWithPassword({ email: String(email).trim(), password: password });
    if (res.error) throw authError(res.error);

    let m;
    try {
      m = await me(true);
    } catch (e) {
      await signOut();
      throw e;
    }
    const role = m.profile.role;
    if (expectedRole && role !== expectedRole) {
      await signOut();
      throw new ApiError(
        403, 'WRONG_PORTAL',
        'This is a ' + (ROLE_LABEL[role] || role) + ' account. Please use the ' +
        (ROLE_LABEL[role] || role) + ' login instead.'
      );
    }
    return m;
  }

  async function signUp(role, fullName, email, password) {
    if (role !== 'customer' && role !== 'provider') {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Choose customer or service provider.');
    }
    _me = null;
    const res = await sb.auth.signUp({
      email: String(email).trim(),
      password: password,
      options: { data: { role: role, full_name: String(fullName).trim() } },
    });
    if (res.error) throw authError(res.error);
    if (!res.data.session) {
      throw new ApiError(0, 'CONFIRM_EMAIL', 'Account created. Check your email to confirm it, then log in.');
    }

    let m;
    try {
      m = await me(true);
    } catch (e) {
      await signOut();
      throw e;
    }
    if (m.profile.role !== role) {
      await signOut();
      throw new ApiError(
        500, 'ROLE_MISMATCH',
        'Your account was created, but its role was saved as "' + m.profile.role +
        '" instead of "' + role + '". Please tell the developer.'
      );
    }
    return m;
  }

  function goHome(role) { location.replace(HOME[role] || '/index.html'); }

  function goLogin(role, notice) {
    if (notice) {
      try { sessionStorage.setItem('fixflow_notice', notice); } catch (e) { /* ignore */ }
    }
    location.replace('/login.html' + (role ? '?role=' + encodeURIComponent(role) : ''));
  }

  // Call at the top of every protected page: const me = await FixAPI.requireRole('customer');
  async function requireRole(role) {
    const never = new Promise(function () {}); // stops the page script while we redirect
    const token = await getToken();
    if (!token) { goLogin(role); return never; }

    let m;
    try {
      m = await me();
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        await signOut();
        goLogin(role, e.message);
        return never;
      }
      throw e;
    }
    if (m.profile.role !== role) { goHome(m.profile.role); return never; }
    return m;
  }

  // Providers get an empty provider_profiles row at sign-up, so check the content, not the row
  function needsProviderSetup(m) {
    if (!m || !m.profile || m.profile.role !== 'provider') return false;
    const pp = m.provider_profile;
    return !pp || !(pp.categories && pp.categories.length) || pp.lat == null || pp.lng == null;
  }

  window.FixAPI = {
    sb: sb,
    ApiError: ApiError,
    HOME: HOME,
    request: request,
    get: function (path, query) { return request(path, { query: query }); },
    post: function (path, body) { return request(path, { method: 'POST', body: body }); },
    put: function (path, body) { return request(path, { method: 'PUT', body: body }); },
    patch: function (path, body) { return request(path, { method: 'PATCH', body: body }); },
    upload: function (path, formData) { return request(path, { method: 'POST', form: formData }); },
    getToken: getToken,
    me: me,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    requireRole: requireRole,
    needsProviderSetup: needsProviderSetup,
    goHome: goHome,
    goLogin: goLogin,
  };
})();