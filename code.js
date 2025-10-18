// code.js - bug fixes: invalid-ticket actions, hold/resume reliable, correct colors on confirm
// --------------------------------------------------
const DEBUG = true; // set to false in production

// <-- IMPORTANT: replace with your deployed Apps Script exec URL
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzKr2r9QItmXB-5lvxOvmP9itkHItpk7Ww03cVc9N0zAhQHH4zxrf9L9SJrPThgfOjYlw/exec";

const video = document.getElementById("video");
const statusEl = document.getElementById("status");
const resultCard = document.getElementById("resultCard");
const resultTitle = document.getElementById("resultTitle");
const rcTicket = document.getElementById("rcTicket");
const rcName = document.getElementById("rcName");
const rcCheckinRow = document.getElementById("rcCheckinRow");
const rcCheckin = document.getElementById("rcCheckin");
const rcHint = document.getElementById("rcHint");
const cardActions = document.getElementById("cardActions");
const confirmBtn = document.getElementById("confirmBtn");
const holdBtn = document.getElementById("holdBtn");
const closeBtn = document.getElementById("closeBtn");
const scanAgainBtn = document.getElementById("scanAgainBtn");

let scanning = false;
let mediaStream = null;
let lastScannedRaw = "";
let awaitingConfirmation = false; // whether we are paused and waiting user to confirm/hold

function log(...args) { if (DEBUG) console.log("[Scanner]", ...args); }

function beepShort() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.1;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 120);
  } catch (e) { /* ignore audio errors */ }
}

/*
 showMessageCard:
  - title
  - ticketId
  - name
  - opts: {
      allowActions: bool (default true) -> whether Confirm/Hold should be shown
      isChecked: bool (default false) -> whether ticket is currently checked (either previously or just now)
      wasAlreadyChecked: bool (default false) -> whether it was checked before scanning (if true shows yellow)
      checkinValue: string
      hint: string
    }
*/
function showMessageCard(title, ticketId, name, opts = {}) {
  const {
    allowActions = true,
    isChecked = false,
    wasAlreadyChecked = false,
    checkinValue = "",
    hint = ""
  } = opts;

  resultCard.style.display = "block";
  resultCard.className = ""; // reset

  // decide class:
  if (!allowActions && !isChecked && !wasAlreadyChecked) {
    // error / not found
    resultCard.classList.add("error");
  } else if (isChecked && !wasAlreadyChecked) {
    // just checked in -> success (green)
    resultCard.classList.add("success");
  } else if (wasAlreadyChecked) {
    // previously checked -> warning (yellow)
    resultCard.classList.add("warning");
  } else {
    // default verify state -> neutral success look
    resultCard.classList.add("success");
  }

  // fill content
  resultTitle.textContent = title || "";
  rcTicket.textContent = ticketId || "";
  rcName.textContent = name || "(no name)";
  rcCheckinRow.style.display = isChecked || wasAlreadyChecked ? "block" : "none";
  rcCheckin.textContent = checkinValue || "";
  rcHint.textContent = hint || "";

  // actions: show only if allowActions AND ticket is not already checked
  if (allowActions && !wasAlreadyChecked && !isChecked) {
    cardActions.style.display = "flex";
    confirmBtn.style.display = "inline-block";
    holdBtn.style.display = "inline-block";
  } else {
    cardActions.style.display = "none";
  }
}

function hideCard() {
  resultCard.style.display = "none";
  cardActions.style.display = "none";
  awaitingConfirmation = false;
}

// stop scanner loop + media stream safely
function stopScannerAndStream() {
  scanning = false;
  try {
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  } catch (e) { log("stop stream error:", e); }
}

async function startCameraAndScan() {
  try {
    statusEl.textContent = "Requesting camera permission...";
    // ensure any previous stream/loop is stopped first
    stopScannerAndStream();

    // request environment camera
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });

    video.srcObject = mediaStream;
    video.setAttribute("playsinline", true);
    await video.play();

    statusEl.textContent = "Camera started — scanning...";
    // reset flags
    lastScannedRaw = "";
    awaitingConfirmation = false;
    startScannerLoop();
  } catch (err) {
    console.error("Camera start error:", err);
    statusEl.textContent = "Camera error: " + (err.message || err);
    showMessageCard("❌ Camera Error", "", "", { allowActions: false, hint: "Please allow camera access or try a different browser/device." });
    scanAgainBtn.style.display = "block";
  }
}

function startScannerLoop() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // ensure only one loop runs
  if (scanning) {
    log("Scanner loop already running — restarting loop.");
    // let existing loop finish. Set scanning false to force restart below.
    scanning = false;
  }
  scanning = true;

  function frame() {
    if (!scanning) return;

    if (awaitingConfirmation) {
      // paused waiting for guard person to confirm/hold — do not scan
      requestAnimationFrame(frame);
      return;
    }

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (drawErr) { log("drawImage error:", drawErr); requestAnimationFrame(frame); return; }

      let imageData;
      try { imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (e) { log("getImageData error:", e); requestAnimationFrame(frame); return; }

      let code = null;
      try { code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" }); } catch (err) { log("jsQR error:", err); }

      if (code && code.data) {
        const raw = String(code.data || "");
        // small debounce: ignore same immediate repeat
        if (raw === lastScannedRaw) {
          requestAnimationFrame(frame);
          return;
        }
        lastScannedRaw = raw;
        log("Detected QR:", raw);
        beepShort();
        try { navigator.vibrate && navigator.vibrate(100); } catch (e) {}

        // pause scanning and lookup
        awaitingConfirmation = true;
        statusEl.textContent = "QR detected — looking up...";

        // stop camera tracks to free permission while guard verifies (optional)
        try { mediaStream && mediaStream.getTracks().forEach(t => t.stop()); } catch (e) { log("stop tracks error:", e); }

        performLookup(raw).catch(err => {
          console.error("Lookup unexpected error:", err);
          showMessageCard("❌ Lookup Error", raw, "", { allowActions: false, hint: String(err) });
          scanAgainBtn.style.display = "block";
          awaitingConfirmation = false;
        });
        return;
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

async function performLookup(rawScanned) {
  const raw = String(rawScanned || "");
  const ticketId = raw.replace(/\r?\n|\r/g, "").trim().toLowerCase();
  if (!ticketId) {
    showMessageCard("❌ Invalid QR", "", "", { allowActions: false, hint: "Scanned QR contained no usable ID." });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  const url = `${WEB_APP_URL}?action=lookup&ticketId=${encodeURIComponent(ticketId)}`;
  log("Lookup fetch:", url);
  let resp;
  try {
    resp = await fetch(url, { method: "GET", cache: "no-store" });
  } catch (err) {
    log("Network error during lookup:", err);
    showMessageCard("❌ Network Error", ticketId, "", { allowActions: false, hint: "Network error. Try again." });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    log("Lookup bad response:", resp.status, txt);
    showMessageCard("❌ Server Error", ticketId, "", { allowActions: false, hint: `Server returned ${resp.status}` });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  let data;
  try { data = await resp.json(); } catch (err) {
    const txt = await resp.text().catch(() => "");
    log("Lookup JSON parse error:", err, txt);
    showMessageCard("❌ Bad Response", ticketId, "", { allowActions: false, hint: "Server returned invalid JSON" });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  log("Lookup JSON:", data);
  if (!data || typeof data !== "object" || !data.success) {
    showMessageCard("❌ Server Error", ticketId, "", { allowActions: false, hint: data && data.error ? data.error : "Unknown server error" });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  // if not found: show error and NO actions
  if (!data.found) {
    showMessageCard("❌ Ticket Not Found", ticketId, "", { allowActions: false, hint: "Ticket not found in database. Hold or contact admin." });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  // found: show name and checkin state (even if already checked in)
  const attendeeName = data.name || "(no name)";
  const alreadyCheckedIn = !!data.alreadyCheckedIn;
  const checkinValue = data.checkinValue || "";

  if (alreadyCheckedIn) {
    // previously checked -> show yellow, no actions
    showMessageCard("⚠️ Already Checked In", ticketId, attendeeName, { allowActions: false, isChecked: true, wasAlreadyChecked: true, checkinValue: checkinValue, hint: "This ticket was already checked in. Do not re-check unless instructed." });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  // not checked in: show Confirm / Hold
  showMessageCard("🔎 Verify Attendee", ticketId, attendeeName, { allowActions: true, isChecked: false, wasAlreadyChecked: false, checkinValue: "", hint: "If name matches, press Confirm Check-In. Otherwise press Hold." });

  // wire confirm/hold handlers (re-assign to avoid duplicates)
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Checking in...";
    // keep UI showing attendee while checking-in
    try {
      // Do check-in network call
      const result = await performCheckin(ticketId);
      // result contains backend response JSON if successful
      // show success (green) and checkin timestamp
      showMessageCard("✅ Checked In", ticketId, result.name || attendeeName, { allowActions: false, isChecked: true, wasAlreadyChecked: false, checkinValue: result.checkinValue || "", hint: "Check-in successful." });
      resultCard.classList.add("pulse");
      try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch (e) {}
    } catch (err) {
      console.error("performCheckin error:", err);
      showMessageCard("❌ Check-in Failed", ticketId, attendeeName, { allowActions: false, isChecked: false, wasAlreadyChecked: false, checkinValue: "", hint: String(err) });
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "✅ Confirm Check-In";
      scanAgainBtn.style.display = "block";
      awaitingConfirmation = false;
    }
  };

  holdBtn.onclick = () => {
    // close popup and resume scanning (do not check-in)
    hideCard();
    scanAgainBtn.style.display = "none";
    statusEl.textContent = "Resuming camera...";
    // reset flags and restart camera properly
    lastScannedRaw = ""; // allow same ticket again
    awaitingConfirmation = false;
    stopScannerAndStream();
    setTimeout(() => {
      startCameraAndScan();
    }, 200); // small delay to ensure camera resources free
  };

  closeBtn.onclick = () => {
    hideCard();
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
  };
}

async function performCheckin(ticketId) {
  const url = `${WEB_APP_URL}?action=checkin&ticketId=${encodeURIComponent(ticketId)}`;
  log("Checkin fetch:", url);
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Server returned ${resp.status} ${txt}`);
  }
  let data;
  try { data = await resp.json(); } catch (err) {
    const txt = await resp.text().catch(() => "");
    throw new Error("Invalid JSON from server: " + txt);
  }
  log("Checkin response:", data);
  if (!data.success) throw new Error(data.error || "Unknown server error");
  if (!data.found) throw new Error("Ticket not found during check-in (race condition?)");
  // return object used by caller
  return data;
}

// scan again handler: visible after each check or error
scanAgainBtn.addEventListener("click", async () => {
  hideCard();
  scanAgainBtn.style.display = "none";
  lastScannedRaw = ""; // reset debounce so same QR can be scanned again
  statusEl.textContent = "Restarting camera...";
  await startCameraAndScan();
});

// Auto-start when supported
if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
  statusEl.textContent = "No camera API available in this browser.";
  showMessageCard("❌ Unsupported", "", "", { allowActions: false, hint: "Your browser does not support camera access (getUserMedia). Try Chrome/Firefox on mobile/desktop." });
  scanAgainBtn.style.display = "block";
} else {
  setTimeout(() => { startCameraAndScan(); }, 100);
}
