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