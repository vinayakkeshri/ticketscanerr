// === CONFIG ===
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwFW-heAwWtCL1oA9xvP0l2_eH9ApWOC0xfb94IUWd4lKMM38k6naqUrIqQlwILKUI38A/exec";

const video = document.getElementById("video");
const status = document.getElementById("status");

// === CAMERA SETUP ===
navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
  .then(stream => {
    video.srcObject = stream;
    video.setAttribute("playsinline", true); // iOS fix
    video.play();
    status.textContent = "Camera started ✅";

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    const scanLoop = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);

        if (code) {
          const ticketId = code.data.trim();
          status.textContent = "QR Detected: " + ticketId;

          // ✅ Send both action and ticketId
          sendToBackend(ticketId);
          return; // stop scanning after first read
        }
      }
      requestAnimationFrame(scanLoop);
    };

    scanLoop();
  })
  .catch(err => {
    status.textContent = "Error accessing camera: " + err.message;
    console.error(err);
  });

// === SEND TO BACKEND ===
function sendToBackend(ticketId) {
  const url = `${WEB_APP_URL}?action=checkin&ticketId=${encodeURIComponent(ticketId)}`;

  fetch(url)
    .then(response => response.json())
    .then(data => {
      console.log(data);

      if (data.success && data.found) {
        if (data.alreadyCheckedIn) {
          alert(`⚠️ Ticket ${ticketId} was already checked in at ${data.checkinValue}`);
        } else {
          alert(`✅ Ticket ${ticketId} checked in successfully!`);
        }
      } else if (data.success && !data.found) {
        alert(`❌ Ticket ${ticketId} not found`);
      } else {
        alert(`⚠️ Error: ${data.error || "Unknown error"}`);
      }
    })
    .catch(err => {
      console.error(err);
      alert("❌ Network error connecting to backend");
    });
}
