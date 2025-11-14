// code.js - cleaned version (no closeBtn), fully working and stable
// --------------------------------------------------
const DEBUG = true; // set to false in production
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbw-XngyMNG5N64B49gPF6fzdRJMW0zgN1i2sg7vKYwkCrfC0G7H14d0tV0mIS9PS4yx8A/exec";

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
const scanAgainBtn = document.getElementById("scanAgainBtn");

let scanning = false;
let mediaStream = null;
let lastScannedRaw = "";
let awaitingConfirmation = false;

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
    setTimeout(() => { o.stop(); ctx.close(); }, 120);
  } catch { }
}

function showMessageCard(title, ticketId, name, opts = {}) {
  const {
    allowActions = true,
    isChecked = false,
    wasAlreadyChecked = false,
    checkinValue = "",
    hint = ""
  } = opts;

  resultCard.style.display = "block";
  resultCard.className = "";

  if (!allowActions && !isChecked && !wasAlreadyChecked)
    resultCard.classList.add("error");
  else if (isChecked && !wasAlreadyChecked)
    resultCard.classList.add("success");
  else if (wasAlreadyChecked)
    resultCard.classList.add("warning");
  else
    resultCard.classList.add("success");

  resultTitle.textContent = title || "";
  rcTicket.textContent = ticketId || "";
  rcName.textContent = name || "(no name)";
  rcCheckinRow.style.display = isChecked || wasAlreadyChecked ? "block" : "none";
  rcCheckin.textContent = checkinValue || "";
  rcHint.textContent = hint || "";

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
    stopScannerAndStream();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });

    video.srcObject = mediaStream;
    video.setAttribute("playsinline", true);
    await video.play();

    statusEl.textContent = "Camera started — scanning...";
    lastScannedRaw = "";
    awaitingConfirmation = false;
    startScannerLoop();
  } catch (err) {
    console.error("Camera start error:", err);
    statusEl.textContent = "Camera error: " + (err.message || err);
    showMessageCard("❌ Camera Error", "", "", { allowActions: false, hint: "Please allow camera access or try again." });
    scanAgainBtn.style.display = "block";
  }
}

function startScannerLoop() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (scanning) scanning = false;
  scanning = true;

  function frame() {
    if (!scanning) return;
    if (awaitingConfirmation) return requestAnimationFrame(frame);

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch { return requestAnimationFrame(frame); }

      let imageData;
      try { imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch { return requestAnimationFrame(frame); }

      let code;
      try { code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" }); } catch { }

      if (code && code.data) {
        const raw = String(code.data || "");
        if (raw === lastScannedRaw) return requestAnimationFrame(frame);
        lastScannedRaw = raw;
        beepShort();
        try { navigator.vibrate && navigator.vibrate(100); } catch { }

        awaitingConfirmation = true;
        statusEl.textContent = "QR detected — looking up...";
        stopScannerAndStream();
        performLookup(raw).catch(err => {
          console.error("Lookup error:", err);
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
    showMessageCard("❌ Invalid QR", "", "", { allowActions: false, hint: "Empty QR code." });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  const url = `${WEB_APP_URL}?action=lookup&ticketId=${encodeURIComponent(ticketId)}`;
  let resp;
  try { resp = await fetch(url, { cache: "no-store" }); }
  catch (err) {
    showMessageCard("❌ Network Error", ticketId, "", { allowActions: false, hint: "Network issue. Try again." });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  if (!resp.ok) {
    showMessageCard("❌ Server Error", ticketId, "", { allowActions: false, hint: `Server returned ${resp.status}` });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  let data;
  try { data = await resp.json(); }
  catch {
    showMessageCard("❌ Invalid Response", ticketId, "", { allowActions: false, hint: "Server did not return valid JSON." });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  if (!data.success) {
    showMessageCard("❌ Error", ticketId, "", { allowActions: false, hint: data.error || "Unknown error" });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  if (!data.found) {
    showMessageCard("❌ Ticket Not Found", ticketId, "", { allowActions: false, hint: "Ticket not found in database." });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  const attendeeName = data.name || "(no name)";
  const alreadyCheckedIn = !!data.alreadyCheckedIn;
  const checkinValue = data.checkinValue || "";

  if (alreadyCheckedIn) {
    showMessageCard("⚠️ Already Checked In", ticketId, attendeeName, {
      allowActions: false,
      isChecked: true,
      wasAlreadyChecked: true,
      checkinValue,
      hint: "Ticket was already checked in."
    });
    scanAgainBtn.style.display = "block";
    awaitingConfirmation = false;
    return;
  }

  showMessageCard("🔎 Verify Attendee", ticketId, attendeeName, {
    allowActions: true,
    hint: "If name matches, press Confirm Check-In. Otherwise press Hold."
  });

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Checking in...";
    try {
      const result = await performCheckin(ticketId);
      showMessageCard("✅ Checked In", ticketId, result.name || attendeeName, {
        allowActions: false,
        isChecked: true,
        checkinValue: result.checkinValue || "",
        hint: "Check-in successful."
      });
      resultCard.classList.add("pulse");
      try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch { }
    } catch (err) {
      showMessageCard("❌ Check-in Failed", ticketId, attendeeName, {
        allowActions: false,
        hint: String(err)
      });
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "✅ Confirm Check-In";
      scanAgainBtn.style.display = "block";
      awaitingConfirmation = false;
    }
  };

  holdBtn.onclick = () => {
    hideCard();
    scanAgainBtn.style.display = "block";
    statusEl.textContent = "Paused. Press 'Scan Next Ticket' to continue.";
    awaitingConfirmation = false;
  };
}

async function performCheckin(ticketId) {
  const url = `${WEB_APP_URL}?action=checkin&ticketId=${encodeURIComponent(ticketId)}`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
  const data = await resp.json().catch(() => ({}));
  if (!data.success) throw new Error(data.error || "Unknown error");
  return data;
}

scanAgainBtn.addEventListener("click", async () => {
  hideCard();
  scanAgainBtn.style.display = "none";
  statusEl.textContent = "Restarting camera...";
  await startCameraAndScan();
});

if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
  statusEl.textContent = "Camera not supported.";
  showMessageCard("❌ Unsupported", "", "", { allowActions: false, hint: "Your browser doesn't support camera." });
  scanAgainBtn.style.display = "block";
} else {
  setTimeout(() => startCameraAndScan(), 100);
}
