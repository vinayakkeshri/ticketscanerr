// Replace with your deployed Apps Script Web App URL
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyZtB0mDjtI5QUWemy3WGnkkYx43fI7LV4K7v-prDvWUoh477Ycpo6GtmnkThj3Vhmwzg/exec";

const video = document.getElementById("video");
const status = document.getElementById("status");

// Access the camera
navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
  .then(stream => {
    video.srcObject = stream;
    video.setAttribute("playsinline", true); // Required for iOS
    video.play();
    status.textContent = "Camera started";

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
          status.textContent = "QR Code detected: " + code.data;
          sendToBackend(code.data);
          // Optional: stop scanning after first read
          return;
        }
      }
      requestAnimationFrame(scanLoop);
    };

    scanLoop();
  })
  .catch(err => {
    status.textContent = "Error accessing camera: " + err;
    console.error(err);
  });

// Send scanned ticket ID to Apps Script
function sendToBackend(ticketId) {
  fetch(`${WEB_APP_URL}?ticketId=${encodeURIComponent(ticketId)}`)
    .then(response => response.json())
    .then(data => {
      alert("Ticket status: " + data.status);
      // You can update the page or do more here
    })
    .catch(err => {
      console.error(err);
      alert("Error sending ticket to backend");
    });
}
