// URL of your Apps Script backend
const WEB_APP_URL = "https://vinayakkeshri.github.io/ticketscanerr/";

// Elements
const status = document.getElementById("status");

// Check for camera access and start scanner
navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
  .then(stream => {
    const video = document.getElementById("video");
    video.srcObject = stream;
    video.setAttribute("playsinline", true); // required to play on iOS
    video.play();
    status.textContent = "Camera started";

    // Simple QR scanning loop using HTML5 QR Code library or your own logic
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    const scan = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Here you can use a QR scanning library like jsQR
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        // Example: const code = jsQR(imageData.data, canvas.width, canvas.height);
        // if (code) { sendToBackend(code.data); }

      }
      requestAnimationFrame(scan);
    };
    scan();

  })
  .catch(err => {
    status.textContent = "Error accessing camera: " + err;
    console.error(err);
  });

// Function to send scanned QR code to Apps Script backend
function sendToBackend(ticketId) {
  fetch(WEB_APP_URL + "?ticketId=" + encodeURIComponent(ticketId))
    .then(response => response.json())
    .then(data => {
      alert("Ticket status: " + data.status);
    })
    .catch(err => console.error(err));
}