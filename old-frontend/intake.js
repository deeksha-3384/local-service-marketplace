/* FixFlow: voice + photo AI intake, diagnosis card and meter badge.
   Plugs into app.js through window.FixFlow.ext hooks. No other file needs to change. */
(() => {
  "use strict";
  const FF = window.FixFlow;
  if (!FF) { console.error("intake.js: app.js must load first."); return; }
  const { state, api, toast, esc, $, $$ } = FF;
  const EXT = FF.ext;

  const MAX_PHOTOS = 4;
  const MAX_RECORD_SECONDS = 60;
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const CATEGORY_IDS = ["plumbing", "electrical", "carpentry", "appliance_repair", "cleaning", "painting", "pest_control", "other"];

  const ICON = {
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    spark: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  const fresh = () => ({
    recorder: null, stream: null, chunks: [], recording: false, busy: false, timer: null, seconds: 0,
    audioId: null, transcript: "", diagnosis: null, diagnosedText: "", photos: [], notes: [],
  });
  let intake = fresh();

  const lang = () => state.profile.language || "en";
  const field = (id) => document.getElementById(id);

  function resetIntake() {
    try { if (intake.recorder && intake.recorder.state !== "inactive") { intake.recorder.onstop = null; intake.recorder.stop(); } } catch { /* ignore */ }
    if (intake.stream) intake.stream.getTracks().forEach((track) => track.stop());
    if (intake.timer) clearInterval(intake.timer);
    intake = fresh();
  }

  /* ---------- meter badge (also used on request cards) ---------- */
  const METER_LABEL = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
  function meterBadge(level) {
    if (!METER_LABEL[level]) return "";
    return `<span class="meter-badge meter-${esc(level)}" title="Urgency meter">● ${esc(METER_LABEL[level])}</span>`;
  }

  /* ---------- diagnosis card ---------- */
  function diagnosisIsStale() {
    const textarea = field("requestDescription");
    return !!intake.diagnosis && !!textarea && textarea.value.trim() !== intake.diagnosedText.trim();
  }
  function renderDiagnosis() {
    const holder = field("diagnosisCard"); if (!holder) return;
    const d = intake.diagnosis;
    if (!d) { holder.innerHTML = ""; return; }
    const stale = diagnosisIsStale();
    const score = Math.max(0, Math.min(100, Number(d.severity_score) || 0));
    const causes = (d.probable_causes || []).slice(0, 3).map((c) => `<div class="diag-cause"><span>${esc(c.label)}</span><span>${Math.round((Number(c.confidence) || 0) * 100)}%</span></div>`).join("");
    const questions = (d.follow_up_questions || []).slice(0, 3).map((q) => `<li>${esc(q)}</li>`).join("");
    holder.innerHTML = `<div class="diag-card${stale ? " stale" : ""}">
      <div class="diag-top"><span class="diag-title">HOME HEALTH CHECK</span>${meterBadge(d.meter_level)}</div>
      <div class="meter-bar meter-${esc(d.meter_level || "low")}" aria-label="Urgency ${score} out of 100"><i style="width:${score}%"></i></div>
      <p class="diag-summary">${esc(d.summary || "")}</p>
      ${d.safety_warning ? `<div class="diag-safety">⚠ ${esc(d.safety_warning)}</div>` : ""}
      ${causes ? `<div class="diag-causes">${causes}</div>` : ""}
      ${questions ? `<ul class="diag-questions">${questions}</ul>` : ""}
      <div class="diag-meta">${d.estimated_duration_minutes ? `<span>≈ ${Number(d.estimated_duration_minutes)} min job</span>` : ""}${d.recommended_category ? `<span>Suggested: ${esc(d.recommended_category.replaceAll("_", " "))}</span>` : ""}</div>
      ${stale ? `<small class="diag-stale-note">You changed the description. We’ll refresh this when you send the request.</small>` : ""}
    </div>`;
  }

  /* ---------- status line, buttons ---------- */
  function setStatus(text) { const node = field("intakeStatus"); if (node) node.textContent = text || ""; }
  function syncButtons() {
    const mic = field("intakeMic"), photoLabel = field("intakePhotoLabel"), check = field("intakeDiagnose");
    if (mic) {
      mic.classList.toggle("recording", intake.recording);
      mic.innerHTML = intake.recording ? `${icon("stop")}<span>Stop · ${intake.seconds}s</span>` : `${icon("mic")}<span>Record voice</span>`;
      mic.disabled = intake.busy && !intake.recording;
    }
    if (photoLabel) photoLabel.classList.toggle("disabled", intake.busy || intake.photos.length >= MAX_PHOTOS || intake.recording);
    if (check) check.disabled = intake.busy || intake.recording;
  }
  function setBusy(busy, message) { intake.busy = busy; setStatus(busy ? message : ""); syncButtons(); }

  function aiError(error, what) {
    if (error.status === 429) {
      const wait = error.details && error.details.retry_after_seconds ? error.details.retry_after_seconds : 30;
      toast("Easy there", `Please wait about ${wait} seconds and try again.`, true);
    } else if (error.code === "AI_UNAVAILABLE" || error.status === 503) {
      toast("AI is busy right now", "You can still type your problem and send the request.", true);
    } else if (error.status === 401) {
      toast("Please sign in again", "Your session has expired.", true);
    } else {
      toast(`Couldn’t ${what}`, error.message, true);
    }
  }

  /* ---------- voice ---------- */
  function pickMime() {
    if (!window.MediaRecorder) return null;
    const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return options.find((type) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) || "";
  }

  async function toggleRecording() {
    if (intake.recording) { intake.recorder.stop(); return; }
    if (intake.busy) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast("Recording isn’t supported here", "Try Chrome, Edge or Safari, or type the problem instead.", true); return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast("Microphone is blocked", "Allow microphone access in your browser, then try again.", true); return; }
    const mime = pickMime();
    let recorder;
    try { recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch { stream.getTracks().forEach((track) => track.stop()); toast("Recording isn’t supported here", "Please type the problem instead.", true); return; }

    intake.stream = stream; intake.recorder = recorder; intake.chunks = []; intake.seconds = 0; intake.recording = true;
    recorder.ondataavailable = (event) => { if (event.data && event.data.size) intake.chunks.push(event.data); };
    recorder.onstop = async () => {
      if (intake.timer) clearInterval(intake.timer);
      stream.getTracks().forEach((track) => track.stop());
      intake.recording = false; syncButtons();
      const type = recorder.mimeType || mime || "audio/webm";
      const blob = new Blob(intake.chunks, { type });
      if (blob.size < 1000) { toast("That was very short", "Hold on a little longer and describe the problem.", true); return; }
      await sendVoice(blob);
    };
    recorder.start();
    setStatus("Listening… describe what’s wrong, then press Stop.");
    intake.timer = setInterval(() => {
      intake.seconds += 1; syncButtons();
      if (intake.seconds >= MAX_RECORD_SECONDS && intake.recorder && intake.recorder.state !== "inactive") intake.recorder.stop();
    }, 1000);
    syncButtons();
  }

  async function sendVoice(blob) {
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const body = new FormData();
    body.append("audio", blob, `voice.${ext}`);
    body.append("language", lang());
    setBusy(true, "Turning your voice into a request…");
    try {
      const data = await api("/intake/voice", { method: "POST", body });
      applyVoice(data);
    } catch (error) { aiError(error, "understand the recording"); }
    finally { setBusy(false); }
  }

  function setValue(id, value, maxLength) {
    const node = field(id); if (!node || value == null) return;
    node.value = maxLength ? String(value).slice(0, maxLength) : String(value);
  }
  function applyVoice(data) {
    intake.audioId = data.media_id || null;
    intake.transcript = data.transcript || "";
    const draft = data.draft || {};
    if (draft.category && CATEGORY_IDS.includes(draft.category)) setValue("requestCategory", draft.category);
    if (draft.title) setValue("requestTitle", draft.title, 120);
    if (draft.description) setValue("requestDescription", draft.description, 2000);
    intake.diagnosis = data.diagnosis || null;
    intake.diagnosedText = field("requestDescription") ? field("requestDescription").value : "";
    renderDiagnosis();
    setStatus(intake.transcript ? `We heard: “${intake.transcript.slice(0, 160)}${intake.transcript.length > 160 ? "…" : ""}”  Edit anything below.` : "");
    if (!data.diagnosis) toast("Transcribed", "The AI health check is busy, but we filled in the form from your words.");
    else toast("Got it", "We filled in the form from your recording.");
  }

  /* ---------- photos ---------- */
  async function compress(file) {
    try {
      if (!window.createImageBitmap) return file;
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      return blob && blob.size < file.size ? blob : file;
    } catch { return file; }
  }

  function renderPhotos() {
    const holder = field("intakePhotos"); if (!holder) return;
    holder.innerHTML = intake.photos.map((photo, index) => `<div class="intake-photo">${photo.url ? `<img src="${esc(photo.url)}" alt="Photo ${index + 1}" />` : ""}<button type="button" data-photo-remove="${index}" aria-label="Remove photo">×</button></div>`).join("");
  }

  async function addPhotos(fileList) {
    const files = [...fileList];
    for (const file of files) {
      if (intake.photos.length >= MAX_PHOTOS) { toast("That’s enough photos", `You can add up to ${MAX_PHOTOS} photos.`); break; }
      const blob = await compress(file);
      if (blob.size > MAX_PHOTO_BYTES) { toast("Photo is too large", "Please choose a photo under 5 MB.", true); continue; }
      const body = new FormData();
      body.append("photo", blob, blob.type === "image/jpeg" ? "photo.jpg" : file.name || "photo.jpg");
      body.append("language", lang());
      setBusy(true, `Looking at your photo ${intake.photos.length + 1}…`);
      try {
        const data = await api("/intake/photo", { method: "POST", body });
        const summary = data.analysis && data.analysis.summary ? data.analysis.summary : "";
        intake.photos.push({ id: data.media_id, url: data.url || "", summary });
        if (summary) intake.notes.push(summary);
        renderPhotos();
        if (summary) toast("Photo added", summary.length > 110 ? `${summary.slice(0, 110)}…` : summary);
        else toast("Photo added", "The AI couldn’t look at it right now, but it’s attached.");
      } catch (error) { aiError(error, "add that photo"); break; }
      finally { setBusy(false); }
    }
  }

  /* ---------- AI health check from typed text ---------- */
  async function runDiagnose() {
    const description = (field("requestDescription") ? field("requestDescription").value : "").trim();
    if (!description) { toast("Tell us what’s wrong first", "Type a short description (or record your voice), then run the health check.", true); return; }
    const payload = { description, language: lang() };
    if (intake.transcript) payload.transcript = intake.transcript.slice(0, 4000);
    if (intake.notes.length) payload.photo_notes = intake.notes.slice(0, 4);
    setBusy(true, "Running the health check…");
    try {
      intake.diagnosis = await api("/intake/diagnose", { method: "POST", body: JSON.stringify(payload) });
      intake.diagnosedText = description;
      renderDiagnosis();
    } catch (error) { aiError(error, "run the health check"); }
    finally { setBusy(false); }
  }

  /* ---------- inject into the request modal ---------- */
  function injectBlock() {
    resetIntake();
    if (state.demo) return;
    const form = field("requestForm"); if (!form) return;
    const block = document.createElement("div");
    block.className = "field full intake-block"; block.id = "intakeBlock";
    block.innerHTML = `<div class="intake-head"><strong>Describe it your way</strong><small>Speak or snap a photo. Our AI fills in the form and gives a quick health check.</small></div>
      <div class="intake-actions">
        <button type="button" class="intake-btn" id="intakeMic">${icon("mic")}<span>Record voice</span></button>
        <label class="intake-btn" id="intakePhotoLabel" for="intakePhoto">${icon("camera")}<span>Add photo</span></label>
        <input id="intakePhoto" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden />
        <button type="button" class="intake-btn intake-btn-ghost" id="intakeDiagnose">${icon("spark")}<span>AI health check</span></button>
      </div>
      <div class="intake-status" id="intakeStatus" aria-live="polite"></div>
      <div class="intake-photos" id="intakePhotos"></div>
      <div id="diagnosisCard"></div>`;
    form.prepend(block);
    field("intakeMic").addEventListener("click", toggleRecording);
    field("intakeDiagnose").addEventListener("click", runDiagnose);
    field("intakePhoto").addEventListener("change", (event) => { const files = event.target.files; if (files && files.length) addPhotos(files).finally(() => { event.target.value = ""; }); });
    block.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-photo-remove]"); if (!remove) return;
      const index = Number(remove.dataset.photoRemove);
      const [gone] = intake.photos.splice(index, 1);
      if (gone && gone.summary) { const at = intake.notes.indexOf(gone.summary); if (at >= 0) intake.notes.splice(at, 1); }
      renderPhotos();
    });
    const textarea = field("requestDescription");
    if (textarea) textarea.addEventListener("input", () => { if (intake.diagnosis) renderDiagnosis(); });
    syncButtons();
  }

  // Free the microphone if the modal is closed while recording.
  const modalCard = document.getElementById("modalCard");
  if (modalCard) new MutationObserver(() => { if (!document.getElementById("intakeBlock") && (intake.recording || intake.stream || intake.audioId || intake.photos.length)) resetIntake(); }).observe(modalCard, { childList: true });

  /* ---------- hooks (chained, so other modules can add their own) ---------- */
  const prevModal = EXT.afterRequestModal;
  EXT.afterRequestModal = () => { if (prevModal) prevModal(); injectBlock(); };

  const prevPayload = EXT.requestPayload;
  EXT.requestPayload = () => {
    const extra = prevPayload ? prevPayload() : {};
    const mediaIds = [intake.audioId, ...intake.photos.map((photo) => photo.id)].filter(Boolean).slice(0, 5);
    if (mediaIds.length) extra.media_ids = mediaIds;
    if (intake.transcript) extra.transcript = intake.transcript.slice(0, 4000);
    if (intake.diagnosis && !diagnosisIsStale()) extra.diagnosis = intake.diagnosis;
    return extra;
  };

  const prevRender = EXT.afterRender;
  EXT.afterRender = () => {
    if (prevRender) prevRender();
    $$(".request-card[data-request-id]").forEach((card) => {
      if (card.querySelector(".meter-badge")) return;
      const item = state.requests.find((request) => String(request.id) === card.dataset.requestId);
      const meta = card.querySelector(".request-meta");
      if (item && meta && METER_LABEL[item.meter_level]) meta.insertAdjacentHTML("beforeend", `<i class="meta-divider"></i>${meterBadge(item.meter_level)}`);
    });
  };

  EXT.meterBadge = meterBadge;
  EXT.intakeTools = { addPhotos, sendVoice, runDiagnose, getState: () => intake };
})();