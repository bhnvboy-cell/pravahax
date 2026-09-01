# PravahaX

Local network chat and video call app. No internet required — works over WiFi.

## Features

- Real-time text messaging
- Video and audio calls (WebRTC)
- See who's online
- Works on any device (phone, tablet, computer)
- No account needed — just enter your name

## How to Run

```bash
npm install
npm start
```

Open `http://localhost:3000` on your computer.

For other devices on the same WiFi, use your computer's local IP (shown in terminal when server starts):

```
http://YOUR_IP:3000
```

## Camera/Mic on Mobile

Mobile browsers require HTTPS or special flags for camera/microphone access.

**Option 1: Firefox (recommended)**  
Install Firefox on your phone — it works over HTTP on local networks.

**Option 2: Chrome flag**  
Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`  
Enable it and add: `http://YOUR_IP:3000`  
Relaunch Chrome.

## Tech Stack

- Node.js + Express (server)
- WebSocket (chat signaling)
- WebRTC (peer-to-peer video/audio calls)
- Vanilla HTML/CSS/JS (frontend)

## Project Structure

```
server.js          - Backend server
public/
  index.html       - App UI
  style.css        - Styling
  app.js           - Client logic
```

## License

MIT
