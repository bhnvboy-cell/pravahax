let ws, token, currentUser;
let localStream, remotePeerId, pc;
let micOn = true, camOn = true;
let pingInterval = null;
let reconnectTimeout = null;
let connected = false;

let currentRoom = null;
let peerConnections = {};
let roomMembers = [];

const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authError = document.getElementById('auth-error');
const userList = document.getElementById('user-list');
const onlineCount = document.getElementById('online-count');
const currentUserEl = document.getElementById('current-user');
const messages = document.getElementById('messages');
const msgInput = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const fileInput = document.getElementById('file-input');
const photoBtn = document.getElementById('photo-btn');
const callView = document.getElementById('call-view');
const chatView = document.getElementById('chat-view');
const callStatus = document.getElementById('call-status');
const callPeerName = document.getElementById('call-peer-name');
const remoteVideo = document.getElementById('remote-video');
const localVideo = document.getElementById('local-video');
const videoGrid = document.getElementById('video-grid');
const toggleMic = document.getElementById('toggle-mic');
const toggleCam = document.getElementById('toggle-cam');
const endCallBtn = document.getElementById('end-call');
const incomingCallModal = document.getElementById('incoming-call');
const callerName = document.getElementById('caller-name');
const acceptCallBtn = document.getElementById('accept-call');
const rejectCallBtn = document.getElementById('reject-call');

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loginForm.classList.toggle('hidden', btn.dataset.tab !== 'login');
    registerForm.classList.toggle('hidden', btn.dataset.tab !== 'register');
    authError.textContent = '';
  });
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  authError.textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.error) { authError.textContent = data.error; return; }
    token = data.token;
    currentUser = data.user;
    startApp();
  } catch (err) {
    authError.textContent = 'Connection failed';
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  authError.textContent = '';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (data.error) { authError.textContent = data.error; return; }
    token = data.token;
    currentUser = data.user;
    startApp();
  } catch (err) {
    authError.textContent = 'Connection failed';
  }
});

function startApp() {
  authScreen.classList.remove('active');
  appScreen.classList.add('active');
  currentUserEl.textContent = currentUser.username + (currentUser.role === 'admin' ? ' (Admin)' : '');
  messages.innerHTML = '';

  try {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
        localStream = stream;
        localVideo.srcObject = stream;
      }).catch(() => {});
    }
  } catch (e) {}

  connectWebSocket();
}

function connectWebSocket() {
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  connected = false;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token }));
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }

    switch (msg.type) {
      case 'auth-success':
        connected = true;
        currentUser = msg.user;
        currentUserEl.textContent = currentUser.username + (currentUser.role === 'admin' ? ' (Admin)' : '');
        appendSystemMessage('Connected as ' + msg.user.username);
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
        break;
      case 'message-history':
        if (msg.messages && msg.messages.length > 0) {
          msg.messages.forEach(m => {
            appendMessage(m.username, m.message, m.from === currentUser.id, m.timestamp);
          });
        }
        break;
      case 'auth-error':
        authError.textContent = msg.error;
        appScreen.classList.remove('active');
        authScreen.classList.add('active');
        break;
      case 'user-list':
        renderUsers(msg.users);
        break;
      case 'chat':
        appendMessage(msg.username, msg.message, msg.from === currentUser.id, msg.timestamp);
        break;
      case 'admin-message':
        appendSystemMessage('[Admin] ' + msg.message);
        break;
      case 'kicked':
        alert('You have been kicked by an admin');
        location.reload();
        break;
      case 'server-shutdown':
        appendSystemMessage('Server: ' + msg.message);
        break;
      case 'call-request':
        remotePeerId = msg.from;
        callerName.textContent = msg.username;
        incomingCallModal.classList.remove('hidden');
        acceptCallBtn.onclick = async () => {
          incomingCallModal.classList.add('hidden');
          try {
            if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            createPeerConnection(msg.from, msg.username);
            const offer = await peerConnections[msg.from].pc.createOffer();
            await peerConnections[msg.from].pc.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'offer', to: msg.from, offer: peerConnections[msg.from].pc.localDescription }));
            callPeerName.textContent = msg.username;
            callStatus.textContent = 'Calling ' + msg.username + '...';
            chatView.classList.add('hidden');
            callView.classList.remove('hidden');
          } catch (e) { alert('Camera/mic error: ' + e.message); }
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
            if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            createPeerConnection(msg.from, msg.username);
            await peerConnections[msg.from].pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
            const answer = await peerConnections[msg.from].pc.createAnswer();
            await peerConnections[msg.from].pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'answer', to: msg.from, answer: peerConnections[msg.from].pc.localDescription }));
            callPeerName.textContent = msg.username;
            callStatus.textContent = 'Connected';
            chatView.classList.add('hidden');
            callView.classList.remove('hidden');
          } catch (e) { alert('Camera/mic error: ' + e.message); }
        };
        rejectCallBtn.onclick = () => {
          incomingCallModal.classList.add('hidden');
          ws.send(JSON.stringify({ type: 'call-reject', to: msg.from }));
        };
        break;
      case 'answer':
        if (peerConnections[msg.from] && peerConnections[msg.from].pc) {
          await peerConnections[msg.from].pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
        }
        break;
      case 'ice-candidate':
        if (peerConnections[msg.from] && peerConnections[msg.from].pc && msg.candidate) {
          await peerConnections[msg.from].pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
        break;
      case 'call-reject':
        endCall();
        alert('Call rejected');
        break;
      case 'call-end':
        removePeer(msg.from);
        if (Object.keys(peerConnections).length === 0) endCall();
        break;
      case 'room-created':
        currentRoom = msg.roomId;
        callPeerName.textContent = 'Group Call';
        callStatus.textContent = 'Room created. Inviting users...';
        chatView.classList.add('hidden');
        callView.classList.remove('hidden');
        break;
      case 'room-joined':
        currentRoom = msg.roomId;
        roomMembers = msg.members.filter(id => id !== currentUser.id);
        callPeerName.textContent = msg.roomName || 'Group Call';
        callStatus.textContent = msg.members.length + ' participants';
        chatView.classList.add('hidden');
        callView.classList.remove('hidden');
        roomMembers.forEach(uid => initiatePeer(uid));
        break;
      case 'room-invite':
        callerName.textContent = msg.username + ' invited you to a call';
        incomingCallModal.classList.remove('hidden');
        acceptCallBtn.onclick = () => {
          incomingCallModal.classList.add('hidden');
          ws.send(JSON.stringify({ type: 'room-join', roomId: msg.roomId }));
        };
        rejectCallBtn.onclick = () => incomingCallModal.classList.add('hidden');
        break;
      case 'room-user-joined':
        roomMembers.push(msg.userId);
        callStatus.textContent = (roomMembers.length + 1) + ' participants';
        break;
      case 'room-user-left':
        roomMembers = roomMembers.filter(id => id !== msg.userId);
        removePeer(msg.userId);
        callStatus.textContent = (roomMembers.length + 1) + ' participants';
        break;
      case 'room-ended':
      case 'room-error':
        appendSystemMessage('Group call ended');
        endAllCalls();
        break;
      case 'room-updated':
        roomMembers = msg.members.filter(id => id !== currentUser.id);
        callStatus.textContent = msg.members.length + ' participants';
        break;
      case 'room-signal':
        handleRoomSignal(msg);
        break;
      case 'pong':
        break;
    }
  };

  ws.onclose = () => {
    connected = false;
    if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
    if (appScreen.classList.contains('active')) {
      appendSystemMessage('Disconnected. Reconnecting...');
      reconnectTimeout = setTimeout(connectWebSocket, 3000);
    }
  };

  ws.onerror = () => {};
}

function renderUsers(list) {
  userList.innerHTML = '';
  onlineCount.textContent = list.length;
  list.forEach(u => {
    const li = document.createElement('li');
    if (u.role === 'admin') li.classList.add('admin');

    const info = document.createElement('span');
    info.className = 'user-info';
    info.textContent = u.username;
    li.appendChild(info);

    if (u.role === 'admin') {
      const badge = document.createElement('span');
      badge.className = 'role-badge';
      badge.textContent = 'ADMIN';
      li.appendChild(badge);
    }

    if (u.id !== currentUser.id) {
      const callBtn = document.createElement('button');
      callBtn.className = 'call-btn';
      callBtn.innerHTML = '&#128222;';
      callBtn.title = 'Call ' + u.username;
      callBtn.onclick = (e) => { e.stopPropagation(); startCall(u); };
      li.appendChild(callBtn);
    }

    userList.appendChild(li);
  });
}

function appendMessage(username, text, mine, timestamp) {
  const div = document.createElement('div');
  div.className = 'msg' + (mine ? ' mine' : '');
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let content = '';
  if (!mine) content += `<div class="sender">${esc(username)}</div>`;
  if (text && text.startsWith('/uploads/')) {
    content += `<img class="chat-image" src="${esc(text)}" onclick="window.open(this.src)" />`;
  } else {
    content += `<div class="text">${esc(text)}</div>`;
  }
  content += `<div class="time">${time}</div>`;
  div.innerHTML = content;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.innerHTML = `<div class="text">${esc(text)}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'chat', message: text }));
  msgInput.value = '';
}

photoBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.url && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', message: data.url }));
    }
  } catch (e) {
    appendSystemMessage('Failed to upload image');
  }
  fileInput.value = '';
});

function createPeerConnection(peerId, peerUsername) {
  if (peerConnections[peerId]) {
    peerConnections[peerId].pc.close();
  }
  const rtc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  if (localStream) localStream.getTracks().forEach(track => rtc.addTrack(track, localStream));
  rtc.ontrack = (event) => {
    let videoEl = document.getElementById('remote-video-' + peerId);
    if (!videoEl) {
      const wrapper = document.createElement('div');
      wrapper.className = 'video-label';
      wrapper.setAttribute('data-name', peerUsername);
      videoEl = document.createElement('video');
      videoEl.id = 'remote-video-' + peerId;
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      wrapper.appendChild(videoEl);
      videoGrid.appendChild(wrapper);
    }
    videoEl.srcObject = event.streams[0];
  };
  rtc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'ice-candidate', to: peerId, candidate: event.candidate }));
    }
  };
  rtc.onconnectionstatechange = () => {
    if (rtc.connectionState === 'disconnected' || rtc.connectionState === 'failed') {
      removePeer(peerId);
      if (Object.keys(peerConnections).length === 0) endCall();
    }
  };
  peerConnections[peerId] = { pc: rtc, username: peerUsername };
  return rtc;
}

function removePeer(peerId) {
  if (peerConnections[peerId]) {
    peerConnections[peerId].pc.close();
    delete peerConnections[peerId];
  }
  const videoEl = document.getElementById('remote-video-' + peerId);
  if (videoEl) videoEl.parentElement.remove();
}

function initiatePeer(peerId) {
  if (!localStream || !peerId || peerId === currentUser.id) return;
  createPeerConnection(peerId, '');
  peerConnections[peerId].pc.createOffer().then(offer => {
    return peerConnections[peerId].pc.setLocalDescription(offer);
  }).then(() => {
    ws.send(JSON.stringify({ type: 'room-signal', roomId: currentRoom, to: peerId, signal: { type: 'offer', offer: peerConnections[peerId].pc.localDescription } }));
  }).catch(() => {});
}

async function handleRoomSignal(msg) {
  if (msg.signal.type === 'offer') {
    createPeerConnection(msg.from, msg.username);
    await peerConnections[msg.from].pc.setRemoteDescription(new RTCSessionDescription(msg.signal.offer));
    const answer = await peerConnections[msg.from].pc.createAnswer();
    await peerConnections[msg.from].pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'room-signal', roomId: currentRoom, to: msg.from, signal: { type: 'answer', answer: peerConnections[msg.from].pc.localDescription } }));
  } else if (msg.signal.type === 'answer') {
    if (peerConnections[msg.from]) {
      await peerConnections[msg.from].pc.setRemoteDescription(new RTCSessionDescription(msg.signal.answer));
    }
  } else if (msg.signal.candidate) {
    if (peerConnections[msg.from]) {
      await peerConnections[msg.from].pc.addIceCandidate(new RTCIceCandidate(msg.signal.candidate));
    }
  }
}

function startCall(user) {
  remotePeerId = user.id;
  callPeerName.textContent = user.username;
  callStatus.textContent = 'Calling ' + user.username + '...';
  chatView.classList.add('hidden');
  callView.classList.remove('hidden');
  ws.send(JSON.stringify({ type: 'call-request', to: user.id }));
}

function startGroupCall() {
  const onlineUsers = Array.from(userList.querySelectorAll('li')).length;
  if (onlineUsers < 2) { appendSystemMessage('Need at least 2 users for group call'); return; }
  ws.send(JSON.stringify({ type: 'room-create', name: currentUser.username + "'s call" }));
}

function endCall() {
  if (currentRoom) {
    ws.send(JSON.stringify({ type: currentRoom ? 'room-end' : 'call-end', to: remotePeerId, roomId: currentRoom }));
    currentRoom = null;
  }
  endAllCalls();
}

function endAllCalls() {
  Object.keys(peerConnections).forEach(id => removePeer(id));
  peerConnections = {};
  roomMembers = [];
  currentRoom = null;
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  videoGrid.innerHTML = '';
  remotePeerId = null;
  callView.classList.add('hidden');
  chatView.classList.remove('hidden');
  micOn = true; camOn = true;
  toggleMic.textContent = 'Mute'; toggleMic.classList.remove('active');
  toggleCam.textContent = 'Cam Off'; toggleCam.classList.remove('active');
}

endCallBtn.addEventListener('click', () => {
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

document.getElementById('group-call-btn').addEventListener('click', startGroupCall);

document.getElementById('logout-btn').addEventListener('click', () => {
  token = null;
  currentUser = null;
  connected = false;
  if (pingInterval) clearInterval(pingInterval);
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (ws) ws.close();
  appScreen.classList.remove('active');
  authScreen.classList.add('active');
  messages.innerHTML = '';
});
