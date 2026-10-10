Part 3. Shared contract (single source of truth)
3.1 Enums
Name
Values
user_role
customer, provider, admin
provider_mode
independent, planner
request_status
open, offers_received, booked, in_progress, completed, cancelled
meter_level
low, medium, high, critical
offer_status
pending, accepted, rejected, withdrawn
booking_status
confirmed, in_progress, completed, cancelled
media_kind
audio, photo
assignment_status
proposed, confirmed, declined
categories (text values)
plumbing, electrical, carpentry, appliance_repair, cleaning, painting, pest_control, other
Meter badge colors (frontend): low = green, medium = amber, high = orange, critical = red.
3.2 Tables (Supabase creates, backend maps with SQLAlchemy)
All ids are uuid (default gen_random_uuid()) unless marked bigserial. All timestamps are timestamptz, shown to clients as ISO 8601 UTC.
• profiles: id (= auth.users.id), role user_role, full_name, phone, language (default en), is_active (default true), created_at
• provider_profiles: user_id (pk, fk profiles), categories text[], lat, lng, service_radius_km (default 15), mode provider_mode (default independent), rating numeric(3,2) (default 0), rating_count int, is_verified bool, bio
• requests: id, customer_id, category, title, description, transcript, language, lat, lng, address, status request_status (default open), severity_score int (0 to 100), meter_level, diagnosis jsonb, booked_provider_id (nullable), created_at, updated_at
• request_media: id, request_id (nullable until the request is created), owner_id, kind media_kind, storage_path, mime, size_bytes, created_at
• offers: id, request_id, provider_id, price numeric(10,2), currency (default INR), eta_minutes int, message, proposed_start, proposed_end, status offer_status, created_at. Unique on (request_id, provider_id) where status is pending or accepted.
• bookings: id, request_id, offer_id, customer_id, provider_id, slot tstzrange, status booking_status, created_at. Exclusion constraint: no two bookings for the same provider_id with overlapping slot while status is confirmed or in_progress. Also one active booking per request.
• request_events (timeline and polling feed): id bigserial, request_id, actor_id (nullable), type, payload jsonb, created_at
• planner_runs: id, created_by, created_at, status (dry_run, confirmed), summary jsonb
• planner_assignments: id, run_id, request_id, provider_id, distance_km, score, status assignment_status
Storage buckets (private): request-audio, request-photos. Path format: <owner_id>/<uuid>.<ext>. Only the backend writes to them (service role). Clients get signed URLs from the API.
3.3 Environment variables
Backend (backend/.env)
Variable
Meaning
DATABASE_URL
Supabase pooler string, form postgresql+psycopg://user:pass@host:6543/postgres
SUPABASE_URL
Project URL
SUPABASE_SERVICE_ROLE_KEY
Server only, never to the browser
SUPABASE_JWT_SECRET
For verifying access tokens (Supabase teammate also reports whether the project uses JWKS signing keys)
GROQ_API_KEY
Groq key
GROQ_STT_MODEL
Default whisper-large-v3-turbo
GROQ_CHAT_MODEL
Backend decides, kept in env
GROQ_VISION_MODEL
Backend decides, kept in env
CORS_ORIGINS
Comma separated list, local dev origin plus the deployed URL
MAX_AUDIO_MB / MAX_PHOTO_MB
Defaults 10 and 5
FLASK_SECRET_KEY
Random string
Frontend (frontend/js/config.js, public values only)
Variable
Meaning
SUPABASE_URL
Same project URL
SUPABASE_ANON_KEY
Public anon key
API_BASE_URL
Empty string in production (same origin as Flask), http://localhost:5000 in local dev
3.4 API conventions
• Base path: /api/v1. Everything is JSON except uploads (multipart).
• Auth: header Authorization: Bearer <supabase access_token> on every route. No token or bad token returns 401.
• Roles are enforced by the backend using profiles.role from the database. The frontend hides things by role, but never relies on that for security.
• Errors always look like { error: { code, message, details? } }.
HTTP
code
When
401
UNAUTHENTICATED
Missing, expired or invalid token
403
FORBIDDEN
Wrong role or not your resource
404
NOT_FOUND

409
SLOT_CONFLICT
Provider already booked in that window
409
INVALID_STATE
Action not allowed in current status
413
FILE_TOO_LARGE

415
UNSUPPORTED_MEDIA

422
VALIDATION_ERROR
details lists field errors
429
RATE_LIMITED

503
AI_UNAVAILABLE
Groq down or timed out. Frontend must let the user continue manually
• Lists return { items: [], page, limit, total }. Defaults page=1, limit=20, max 100.
• Sorting uses sort=<field>&order=asc|desc.
• Response fields are snake_case.
3.5 Endpoints
Profile
Method and path
Role
Body or query
Returns
GET /me
any

{ profile, provider_profile? }
PATCH /me
any
{ full_name?, phone?, language? }
profile
PUT /me/provider-profile
provider
{ categories, lat, lng, service_radius_km, bio? }
provider_profile
POST /provider/mode
provider
{ mode }
provider_profile
Intake and AI (all need login)
Method and path
Body
Returns
POST /intake/voice
multipart: audio (file), language
{ media_id, transcript, draft: { category, title, description, severity_score, meter_level } }
POST /intake/photo
multipart: photo (file), request_id?
{ media_id, url, analysis: { summary, visible_issues[] } }
POST /intake/diagnose
{ description, transcript?, media_ids[] }
diagnosis object (3.7)
POST /translate
{ text, target_lang }
{ text, target_lang }
Requests
Method and path
Role
Notes
POST /requests
customer
Body { category, title, description, lat, lng, address, language, media_ids[]?, diagnosis? }. Backend attaches media and computes diagnosis if not supplied. Returns request.
GET /requests
all
Role-scoped. Customer: own. Provider: open requests in their categories and radius (independent mode only). Admin: all. Query: status, category, meter_level, q, near_lat, near_lng, radius_km, sort (created_at, severity_score, distance), order, page, limit. Each item includes distance_km when provider.
GET /requests/{id}
owner, matching provider, admin
Full request with media[] (signed URLs), offer_count, booking?
POST /requests/{id}/cancel
customer, admin

GET /requests/{id}/timeline
owner, involved provider, admin
{ items: [event] } oldest first
GET /requests/{id}/offers
owner, admin
Query sort (price, eta_minutes, rating, distance), order, max_price, min_rating, max_eta. Each offer includes provider: { id, full_name, rating, rating_count, is_verified, distance_km }.
Offers and bookings
Method and path
Role
Notes
POST /requests/{id}/offers
provider (independent)
{ price, eta_minutes, message?, proposed_start, proposed_end }
POST /offers/{id}/withdraw
provider

POST /offers/{id}/accept
customer
Creates the booking and rejects other offers. 409 SLOT_CONFLICT if the provider is already booked in that window.
POST /offers/{id}/reject
customer

GET /bookings
all
Role-scoped, query status, sort, page, limit
GET /bookings/{id}
involved, admin

POST /bookings/{id}/status
provider, customer (cancel only), admin
{ status }
Provider planner side
Method and path
Role
Notes
GET /provider/assignments
provider (planner)
Proposed assignments with request summary
POST /provider/assignments/{id}/accept
provider
Creates booking, can return SLOT_CONFLICT
POST /provider/assignments/{id}/decline
provider

GET /provider/dashboard
provider
{ open_nearby, pending_offers, upcoming_bookings, rating }
GET /providers/{id}
any
Public profile
Admin
Method and path
Notes
GET /admin/stats
{ users_by_role, requests_by_status, bookings_today, avg_offers_per_request }
GET /admin/users
Query role, q, page, limit
PATCH /admin/users/{id}
{ is_active?, is_verified? }
POST /admin/planner/run
{ request_ids?, dry_run }. Returns { run_id, assignments: [{ request_id, provider_id, distance_km, score }], unassigned_request_ids[] }
GET /admin/planner/runs/{id}
Same shape as above
POST /admin/planner/runs/{id}/confirm
Turns the proposed assignments into proposed rows visible to planner providers
3.6 Live updates (polling)
GET /updates?after_id=<number> returns { last_id, events: [event] }. It is role-scoped, so each user only receives events for their own requests, offers and bookings.
• Frontend polls every 3 seconds with the last last_id it saw. First call uses after_id=0 and may return a lot, so the frontend should instead call GET /updates?after_id=latest once to get the starting cursor.
• Empty result is { last_id: <same>, events: [] } and is tiny, which is what keeps this fine on slow Wi-Fi.
• Pause polling when the tab is hidden (document.visibilityState). On error, back off 3s, 6s, 12s, max 30s.
• Event shape: { id, request_id, type, actor_id, payload, created_at }.
• Event types: request.created, request.status_changed, request.cancelled, diagnosis.ready, offer.created, offer.accepted, offer.rejected, offer.withdrawn, booking.created, booking.status_changed, planner.assigned, planner.declined.
• The timeline component renders GET /requests/{id}/timeline and appends matching events from the polling feed.
3.7 Diagnosis object
{ summary, probable_causes: [{ label, confidence }], recommended_category, severity_score, meter_level, estimated_duration_minutes, safety_warning (string or null), follow_up_questions: [string], language }
confidence is 0 to 1. meter_level is derived from severity_score: 0 to 24 low, 25 to 49 medium, 50 to 74 high, 75 to 100 critical.
3.8 Media rules
• Audio: frontend picks the first supported type from audio/webm;codecs=opus, audio/mp4, audio/ogg, using MediaRecorder.isTypeSupported. The upload filename must carry the matching extension (.webm, .m4a, .ogg). Max 60 seconds, 10 MB. Backend accepts webm, mp4, m4a, ogg, wav, mp3. iPhone Safari produces audio/mp4, Android Chrome produces audio/webm.
• Photos: frontend resizes so the longest side is at most 1600 px and re-encodes as JPEG quality 0.8 before upload. Max 5 MB each, up to 4 per request.
• Microphone only works on HTTPS (localhost counts), so voice must be tested on the deployed URL.