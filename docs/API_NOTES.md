# API notes (what the backend really returns)

Base path /api/v1. Timestamps are ISO 8601 UTC ending in Z. Money fields are plain numbers.
Send datetimes WITH a timezone (e.g. 2026-10-12T10:00:00Z). Without one, the API returns 422.

## Added or clarified compared with the contract
- GET /me -> { profile, provider_profile }  (provider_profile is null for non-providers)
- POST /requests also accepts optional `transcript`. If `diagnosis` is omitted, the backend runs the AI
  itself. If the AI is unavailable, the request is still created with diagnosis: null.
- GET /requests items include `distance_km` (providers, or when near_lat and near_lng are sent) and
  `offer_count`. Providers also get `my_offer_status` (null, pending, accepted, rejected, withdrawn).
- Provider privacy: until a provider is the booked provider, `address` is null and lat/lng are rounded to
  2 decimals.
- GET /requests/{id} adds `media[]`, `offer_count`, `booking` (or null).
- GET /requests/{id}/offers items = offer fields + provider { id, full_name, rating, rating_count,
  is_verified, distance_km }. Sort fields: price, eta_minutes, rating, distance. Filters: max_price,
  min_rating, max_eta.
- Offer body: { price, eta_minutes, message?, proposed_start, proposed_end } (timezone-aware datetimes,
  window of at most 7 days, start not in the past).
- Booking object: { id, request_id, offer_id (null for planner bookings), customer_id, provider_id,
  status, slot: { start, end }, created_at, customer_name, provider_name,
  request: { id, title, category, meter_level, address, lat, lng } }
- POST /offers/{id}/accept -> 201 with the booking object, or 409 SLOT_CONFLICT.
- POST /bookings/{id}/status: confirmed -> in_progress | cancelled, in_progress -> completed | cancelled.
  A customer may only cancel, and only while confirmed.
- GET /updates?after_id=latest returns the starting cursor { last_id, events: [] }.
  Then poll GET /updates?after_id=<last_id>. Max 100 events per call.
- Extra error codes: PROFILE_NOT_FOUND (403), ACCOUNT_DISABLED (403), DB_UNAVAILABLE (503),
  AUTH_UNAVAILABLE (503), AUTH_NOT_CONFIGURED (503), BAD_REQUEST (400), METHOD_NOT_ALLOWED (405).

## Not built yet
Voice/photo/diagnose/translate routes, provider assignments, planner and admin routes.


## Step 13 additions
- POST /intake/voice (customer only, multipart: audio, optional language). Response: { media_id, transcript,
  draft, diagnosis }. `diagnosis` is extra: pass it to POST /requests so the AI is not called twice.
  If the AI is exhausted you still get the transcript and a basic draft (category other, diagnosis null).
  media_id can be null if file storage failed: skip null ids in media_ids. Speech language is auto-detected;
  `language` only sets the language of the written draft. Formats: webm, m4a/mp4, ogg, wav, mp3 (10 MB).
- POST /intake/photo (customer only, multipart: photo, optional request_id, optional language).
  Response: { media_id, url, analysis }. analysis is null if the AI is unavailable (photo is still saved).
  JPEG, PNG or WebP, max 5 MB, max 4 photos per request. Compress on the client first.
- POST /intake/diagnose (any role): { description, transcript?, media_ids?, photo_notes?, language? }.
  photo_notes is the list of analysis.summary strings returned by /intake/photo. Returns the diagnosis object.
- POST /translate (any role): { text, target_lang } -> { text, target_lang }. Languages: en hi kn ta te ml mr bn.
- GET /requests/{id} media[] items now have a temporary signed `url` (valid about 1 hour).
- AI endpoints are rate limited per user (429 RATE_LIMITED with details.retry_after_seconds).
  If every AI model is exhausted: 503 AI_UNAVAILABLE. Let the user type instead.
- New error codes: STORAGE_UNAVAILABLE (503), FILE_TOO_LARGE (413), UNSUPPORTED_MEDIA (415).

## Step 14 additions
- GET /provider/assignments?status=proposed|confirmed|declined (default proposed, paginated). Item:
  { id, run_id, request_id, provider_id, distance_km, score, status, request: { id, title, category,
  description, language, severity_score, meter_level, status, lat, lng, address, created_at } }
  (address is null and lat/lng rounded until the provider is booked). Only confirmed runs are shown.
- POST /provider/assignments/{id}/accept. Optional body { start?, duration_minutes? }. Default slot starts
  now and lasts the diagnosis estimate (60 min if unknown, 15-480). 201 booking (offer_id null), or 409
  SLOT_CONFLICT / INVALID_STATE.
- POST /provider/assignments/{id}/decline -> 200 { id, request_id, status: declined }.
- GET /provider/dashboard -> { open_nearby, pending_offers, upcoming_bookings, pending_assignments, rating,
  rating_count, mode }.
- GET /providers/{id} -> { id, full_name, categories, service_radius_km, rating, rating_count, is_verified, bio }.
- GET /admin/stats -> { users_by_role, requests_by_status, bookings_today (last 24h), avg_offers_per_request }.
- GET /admin/users?role=&q=&page=&limit= -> items { id, role, full_name, email, phone, language, is_active,
  created_at, is_verified, mode, rating, rating_count }.
- PATCH /admin/users/{id} { is_active?, is_verified? }. Admins cannot deactivate themselves.
- POST /admin/planner/run { request_ids?, dry_run (default true), require_verified (default false) }
  -> 201 { run_id, status (dry_run|confirmed), assignments: [{ id, request_id, provider_id, distance_km,
  score, status, request_title, provider_name }], unassigned: [{ request_id, reason }],
  unassigned_request_ids, dropped, summary }. dry_run=false publishes immediately.
  Reasons: not_found, not_open, already_assigned, missing_location, no_planner_providers,
  no_provider_in_range, no_capacity. Without request_ids it plans all open requests (most severe first, max 200).
- GET /admin/planner/runs (latest 20), GET /admin/planner/runs/{id} (same shape),
  POST /admin/planner/runs/{id}/confirm (dry_run -> confirmed; stale assignments are dropped and listed in `dropped`).
- Planner-mode providers get an empty GET /requests feed; they work from /provider/assignments.
## Emergency mode additions
- POST /admin/planner/run accepts { emergency?: bool (default false) }. When true, requests with severity
  >= 50 (High, Critical) are planned first using all providers; the rest only get leftover providers.
  Requests with unknown severity are never treated as urgent.
- New unassigned reason: deferred_for_urgent (a provider could serve it, but was used for an urgent request).
- Planner run assignments now include severity_score and meter_level.
- summary now includes emergency (bool).