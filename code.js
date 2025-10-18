// code.js (replace your file with this)
// -----------------------------
// Paste this file as code.js and make sure index.html still includes: <script src="code.js"></script>
// Replace WEB_APP_URL with your deployed Apps Script URL (must end with /exec)

const DEBUG = true; // set false in production

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyZoc_bDU-0zKOpdohvPWvYdditBTh8gj7MpNOdAyWEnKc4IdwHQaRim6oVPl6pXRh2Gw/exec"; // <-- replace this

// DOM
const video = document.getElementById("video");
const statusEl = document.getElementById("status");
const resultCard = document.getElementById("resultCard");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");
const scanAgainBtn = document.getElementById("scanAgainBtn");

// internal
let scanning = false;
let mediaStream = null;

// safe console wrapper
function log(...args) {
  if (DEBUG) console.log("[Scanner]", ...args);
}

// show UI message
function showMessage(title, message, type = "error", rawScanned = "") {
  resultCard.style.display = "block";
  resultCard.className = ""; // reset
  resultCard.classList.add(type);
  resultTitle.textContent = title;
  resultMessage.textContent = message + (DEBUG && rawScanned ? `\n\nRaw: ${rawScanned}` : "");
}

// start camera and scanning
async function startCameraAndScan() {
  try {
    statusEl.textContent = "Requesting camera permission...";
    // stop previous stream if present
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }

    // request environment camera
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });

    video.srcObject = mediaStream;
    video.setAttribute("playsinline", true);
    await video.play();

    statusEl.textContent = "Camera started — scanning...";
    startScannerLoop();
  } catch (err) {
    console.error("Camera start error:", err);
    statusEl.textContent = "Camera error: " + (err.message || err);
    showMessage("❌ Camera Error", "Please allow camera access or try a different browser/device.", "error");
    scanAgainBtn.style.display = "block";
  }
}

function startScannerLoop() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  scanning = true;

  function frame() {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch (drawErr) {
        // sometimes drawImage fails if stream not fully ready
        log("drawImage error:", drawErr);
        requestAnimationFrame(frame);
        return;
      }

      let imageData;
      try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (e) {
        log("getImageData error:", e);
        requestAnimationFrame(frame);
        return;
      }

      let code = null;
      try {
        code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
      } catch (err) {
        log("jsQR error:", err);
      }

      if (code && code.data) {
        log("jsQR result:", code);
        scanning = false;
        statusEl.textContent = "QR detected — processing...";
        // ensure stream is stopped to release camera on mobile (optional)
        try {
          mediaStream && mediaStream.getTracks().forEach(t => t.stop());
        } catch (e) { log("stop tracks error:", e); }

        sendToBackend(code.data).catch(err => {
          // should already be handled inside sendToBackend, but just in case
          console.error("sendToBackend unexpected error:", err);
          showMessage("❌ Unexpected Error", String(err), "error", code.data);
          scanAgainBtn.style.display = "block";
        });
        return;
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// prepare and send to backend, with robust handling
async function sendToBackend(ticketIdRaw) {
  try {
    const raw = String(ticketIdRaw || "");
    // clean and normalize: remove CR/LF, trim, toLowerCase
    const ticketId = raw.replace(/\r?\n|\r/g, "").trim().toLowerCase();

    log("Scanned raw:", JSON.stringify(raw), "normalized:", ticketId);

    if (!ticketId) {
      showMessage("❌ Invalid QR", "Scanned QR contained no usable ID.", "error", raw);
      scanAgainBtn.style.display = "block";
      return;
    }

    // build URL
    const url = `${WEB_APP_URL}?action=checkin&ticketId=${encodeURIComponent(ticketId)}`;
    log("Fetching:", url);

    const resp = await fetch(url, { method: "GET", cache: "no-store" });

    // network level errors
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      log("Network response not ok:", resp.status, text);
      showMessage("❌ Network Error", `Server returned ${resp.status}`, "error", raw);
      scanAgainBtn.style.display = "block";
      return;
    }

    // Try json parse
    let data;
    try {
      data = await resp.json();
    } catch (err) {
      const txt = await resp.text().catch(() => "");
      log("JSON parse error:", err, "resp text:", txt);
      showMessage("❌ Bad Response", "Server returned invalid JSON", "error", raw);
      scanAgainBtn.style.display = "block";
      return;
    }

    log("Backend JSON:", data);

    // handle backend structured response
    if (!data || typeof data !== "object") {
      showMessage("❌ Bad Response", "Empty or invalid response object from server", "error", raw);
    } else if (!data.success) {
      // backend sent an error message
      showMessage("❌ Server Error", data.error || "Unknown error from server", "error", raw);
    } else if (!data.found) {
      showMessage("❌ Invalid Ticket", `Ticket ${ticketId} not found.`, "error", raw);
    } else if (data.alreadyCheckedIn) {
      showMessage("⚠️ Already Checked In", `Ticket ${ticketId}\nChecked in at: ${data.checkinValue || "unknown"}`, "warning", raw);
    } else {
      showMessage("✅ Checked In", `Ticket ${ticketId} checked in successfully!`, "success", raw);
      try { navigator.vibrate && navigator.vibrate(200); } catch (e) { /* ignore */ }
    }

    scanAgainBtn.style.display = "block";
  } catch (err) {
    console.error("sendToBackend error:", err);
    showMessage("❌ Unexpected Error", String(err), "error", String(ticketIdRaw || ""));
    scanAgainBtn.style.display = "block";
  }
}

// scan again handler
scanAgainBtn.addEventListener("click", async () => {
  resultCard.style.display = "none";
  scanAgainBtn.style.display = "none";
  statusEl.textContent = "Restarting camera...";
  await startCameraAndScan();
});

// Auto-start
if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
  statusEl.textContent = "No camera API available in this browser.";
  showMessage("❌ Unsupported", "Your browser does not support camera access (getUserMedia). Try Chrome/Firefox on mobile/desktop.", "error");
  scanAgainBtn.style.display = "block";
} else {
  // small delay to ensure DOM/video is ready
  setTimeout(() => {
    startCameraAndScan();
  }, 100);
}
