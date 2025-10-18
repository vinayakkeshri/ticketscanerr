// Replace with your actual deployed Google Apps Script web app URL
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyZoc_bDU-0zKOpdohvPWvYdditBTh8gj7MpNOdAyWEnKc4IdwHQaRim6oVPl6pXRh2Gw/exec";

const video = document.getElementById("video");
const statusEl = document.getElementById("status");
const resultCard = document.getElementById("resultCard");
const resultTitle = document.getElementById("resultTitle");
const resultMessage = document.getElementById("resultMessage");
const scanAgainBtn = document.getElementById("scanAgainBtn");

let scanning = false;

// === Start Camera ===
navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
  .then(stream => {
    video.srcObject = stream;
    video.setAttribute("playsinline", true);
    video.play();
    statusEl.textContent = "Camera ready - scanning...";
    startScanner();
  })
  .catch(err => {
    statusEl.textContent = "Camera access denied: " + err.message;
    console.error(err);
  });

// === Scanner Loop ===
function startScanner() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  scanning = true;
  function scanFrame() {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);

      if (code) {
        scanning = false;
        statusEl.textContent = "QR detected!";
        sendToBackend(code.data);
        return;
      }
    }
    requestAnimationFrame(scanFrame);
  }
  scanFrame();
}

// === Backend Communication ===
function sendToBackend(ticketId) {
  ticketId = ticketId?.trim().replace(/\r?\n|\r/g, "").toLowerCase();
  if (!ticketId) {
    showMessage("❌ Error", "Invalid or empty QR code", "error");
    scanAgainBtn.style.display = "block";
    return;
  }

  const url = `${WEB_APP_URL}?action=checkin&ticketId=${encodeURIComponent(ticketId)}`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      console.log("Response:", data);

      if (!data.success) {
        showMessage("❌ Error", data.error || "Unknown error", "error");
      } else if (!data.found) {
        showMessage("❌ Invalid Ticket", `Ticket ID ${ticketId} not found.`, "error");
      } else if (data.alreadyCheckedIn) {
        showMessage("⚠️ Already Checked In", `Ticket ID ${ticketId}\nChecked in at ${data.checkinValue}`, "warning");
      } else {
        showMessage("✅ Success", `Ticket ID ${ticketId} checked in successfully!`, "success");
        navigator.vibrate?.(200);
      }

      scanAgainBtn.style.display = "block"; // always visible after result
    })
    .catch(err => {
      console.error(err);
      showMessage("❌ Network Error", "Unable to reach backend", "error");
      scanAgainBtn.style.display = "block";
    });
}

// === Display Results ===
function showMessage(title, message, type) {
  resultCard.style.display = "block";
  resultCard.className = "";
  resultCard.classList.add(type);
  resultTitle.textContent = title;
  resultMessage.textContent = message;
}

// === Scan Again ===
scanAgainBtn.addEventListener("click", () => {
  resultCard.style.display = "none";
  scanAgainBtn.style.display = "none";
  statusEl.textContent = "Scanning for next QR...";
  scanning = true;
  startScanner();
});
