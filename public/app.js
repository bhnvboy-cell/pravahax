let ws, myId, myUsername;
let localStream;
let remotePeerId;
let pc;

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const userList = document.getElementById('user-list');
const messages = document.getElementById('messages');
const msgInput = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const callView = document.getElementById('call-view');
const chatView = document.getElementById('chat-view');
const callStatus = document.getElementById('call-status');
const callPeerName = document.getElementById('call-peer-name');
const remoteVideo = document.getElementById('remote-video');
const localVideo = document.getElementById('local-video');
const toggleMic = document.getElementById('toggle-mic');
const toggleCam = document.getElementById('toggle-cam');
const endCallBtn = document.getElementById('end-call');
const incomingCallModal = document.getElementById('incoming-call');
const callerName = document.getElementById('caller-name');
const acceptCallBtn = document.getElementById('accept-call');
const rejectCallBtn = document.getElementById('reject-call');

let users = [];
let micOn = true, camOn = true;

joinBtn.addEventListener('click', join);
usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

function join() {
  const name = usernameInput.value.trim();
  if (!name) return;
  myUsername = name;
  myId = 'user_' + Math.random().toString(36).substr(2, 9);
  joinBtn.disabled = true;
  joinBtn.textContent = 'Connecting...';

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', userId: myId, username: myUsername }));
    loginScreen.classList.remove('active');
    appScreen.classList.add('active');
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join';
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case 'user-list':
        users = msg.users.filter(u => u.id !== myId);
        renderUsers();
        break;
      case 'chat':
        appendMessage(msg.username, msg.message, msg.from === myId, msg.timestamp);
        break;
      case 'call-request':
        remotePeerId = msg.from;
        callerName.textContent = msg.username;
        incomingCallModal.classList.remove('hidden');
        acceptCallBtn.onclick = async () => {
          incomingCallModal.classList.add('hidden');
          try {
            await startLocalStream();
            createPeerConnection();
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'offer', to: msg.from, offer: pc.localDescription }));
            callPeerName.textContent = msg.username;
            callStatus.textContent = 'Calling ' + msg.username + '...';
            chatView.classList.add('hidden');
            callView.classList.remove('hidden');
          } catch (e) {
            alert('Camera/microphone error: ' + e.message);
          }
        };
        rejectCallBtn.onclick = () => {
          incomingCallModal.classList.add('hidden');
          ws.send(JSON.stringify({ type: 'call-reject', to: msg.from }));
        };
        break;
      case 'offer':
        remotePeerId = msg.from;
        callerName.textContent = msg.username;
        incomingCallModal.classList.remove('hidden');
        acceptCallBtn.onclick = async () => {
          incomingCallModal.classList.add('hidden');
          try {
            await startLocalStream();
            createPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'answer', to: msg.from, answer: pc.localDescription }));
            callPeerName.textContent = msg.username;
            callStatus.textContent = 'Connected';
            chatView.classList.add('hidden');
            callView.classList.remove('hidden');
          } catch (e) {
            alert('Camera/microphone error: ' + e.message);
          }
        };
        rejectCallBtn.onclick = () => {
          incomingCallModal.classList.add('hidden');
          ws.send(JSON.stringify({ type: 'call-reject', to: msg.from }));
        };
        break;
      case 'answer':
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
        break;
      case 'ice-candidate':
        if (pc && msg.candidate) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        break;
      case 'call-reject':
        endCall();
        alert('Call rejected');
        break;
      case 'call-end':
        endCall();
        break;
    }
  };

  ws.onerror = () => alert('Connection error');
  ws.onclose = () => setTimeout(() => location.reload(), 2000);
}

function renderUsers() {
  userList.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.textContent = u.username;
    li.onclick = () => startCall(u);
    userList.appendChild(li);
  });
}

function appendMessage(username, text, mine, timestamp) {
  const div = document.createElement('div');
  div.className = 'msg' + (mine ? ' mine' : '');
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `${mine ? '' : `<div class="sender">${escapeHtml(username)}</div>`}<div class="text">${escapeHtml(text)}</div><div class="time">${time}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'chat', from: myId, message: text }));
  msgInput.value = '';
}

async function startLocalStream() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.ontrack = (event) => { remoteVideo.srcObject = event.streams[0]; };
  pc.onicecandidate = (event) => {
    if (event.candidate && remotePeerId) {
      ws.send(JSON.stringify({ type: 'ice-candidate', to: remotePeerId, candidate: event.candidate }));
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') endCall();
  };
}

function startCall(user) {
  remotePeerId = user.id;
  callPeerName.textContent = user.username;
  callStatus.textContent = 'Calling ' + user.username + '...';
  chatView.classList.add('hidden');
  callView.classList.remove('hidden');
  ws.send(JSON.stringify({ type: 'call-request', to: user.id }));
}

function endCall() {
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  remotePeerId = null;
  callView.classList.add('hidden');
  chatView.classList.remove('hidden');
  micOn = true; camOn = true;
  toggleMic.textContent = 'Mute'; toggleMic.classList.remove('active');
  toggleCam.textContent = 'Cam Off'; toggleCam.classList.remove('active');
}

endCallBtn.addEventListener('click', () => {
  if (remotePeerId) ws.send(JSON.stringify({ type: 'call-end', to: remotePeerId }));
  endCall();
});

toggleMic.addEventListener('click', () => {
  if (!localStream) return;
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  toggleMic.textContent = micOn ? 'Mute' : 'Unmute';
  toggleMic.classList.toggle('active', !micOn);
});

toggleCam.addEventListener('click', () => {
  if (!localStream) return;
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  toggleCam.textContent = camOn ? 'Cam Off' : 'Cam On';
  toggleCam.classList.toggle('active', !camOn);
});
