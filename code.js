// === CONFIG ===
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzMbx_xQddMKF1BIAD68IPObqw6GcSZjabFRIVNghiEsGxl9c0BkKAphAE0mrxprC2yEw/exec";

const video = document.getElementById("video");
const status = document.getElementById("status");
const resultBox = document.getElementById("result");
const message = document.getElementById("message");
const ticketInfo = document.getElementById("ticket-info");
const scanAgainBtn = document.getElementById("scan-again");

let scanning = true;

// === CAMERA SETUP ===
navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
  .then(stream => {
    video.srcObject = stream;
    status.textContent = "Camera started ✅";
    startScanning();
  })
  .catch(err => {
    status.textContent = "⚠️ Error accessing camera: " + err.message;
  });

// === SCANNING LOOP ===
function startScanning() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  const loop = () => {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);

      if (code) {
        scanning = false;
        const ticketId = code.data.trim();
        showMessage("🔍 QR Detected", "Checking ticket...", "warning");
        sendToBackend(ticketId);
        return;
      }
    }
    requestAnimationFrame(loop);
  };
  loop();
}

// === SEND TO BACKEND ===
function sendToBackend(ticketId) {
  fetch(`${WEB_APP_URL}?action=checkin&ticketId=${encodeURIComponent(ticketId)}`)
    .then(res => res.json())
    .then(data => {
      console.log("Response:", data);
      if (!data.success) {
        showMessage("❌ Error", data.error || "Unknown error", "error");
        return;
      }

      if (!data.found) {
        showMessage("❌ Invalid Ticket", `Ticket ID ${ticketId} not found.`, "error");
      } else if (data.alreadyCheckedIn) {
        showMessage("⚠️ Already Checked In", `Ticket ID ${ticketId}\nChecked in at ${data.checkinValue}`, "warning");
      } else {
        showMessage("✅ Success", `Ticket ID ${ticketId} checked in successfully!`, "success");
        navigator.vibrate?.(200);
      }

      scanAgainBtn.style.display = "block";
    })
    .catch(err => {
      console.error(err);
      showMessage("❌ Network Error", "Unable to reach backend", "error");
      scanAgainBtn.style.display = "block";
    });
}

// === UI HELPERS ===
function showMessage(title, info, type) {
  message.textContent = title;
  ticketInfo.textContent = info;
  resultBox.className = `result-box ${type}`;
  resultBox.style.display = "block";
}

scanAgainBtn.addEventListener("click", () => {
  scanning = true;
  resultBox.style.display = "none";
  scanAgainBtn.style.display = "none";
  status.textContent = "Scanning for next QR...";
  startScanning();
});
