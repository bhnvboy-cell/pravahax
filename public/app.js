let ws, peer, myId, myUsername;
let localStream;
let currentCall;
let remotePeerId;

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

  peer = new Peer(myId, { path: '/peerjs', host: location.hostname, port: 9000 });

  peer.on('open', () => {
    ws = new WebSocket(`ws://${location.host}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', userId: myId, username: myUsername }));
      loginScreen.classList.remove('active');
      appScreen.classList.add('active');
    };
    ws.onmessage = handleWSMessage;
  });

  peer.on('call', (call) => {
    const caller = users.find(u => u.id === call.peer);
    callerName.textContent = caller?.username || call.peer;
    incomingCallModal.classList.remove('hidden');

    acceptCallBtn.onclick = async () => {
      incomingCallModal.classList.add('hidden');
      await startLocalStream();
      call.answer(localStream);
      setupCall(call, call.peer);
    };
    rejectCallBtn.onclick = () => {
      incomingCallModal.classList.add('hidden');
      call.reject();
    };
  });
}

function handleWSMessage(event) {
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
      callerName.textContent = msg.username;
      incomingCallModal.classList.remove('hidden');
      remotePeerId = msg.from;

      acceptCallBtn.onclick = async () => {
        incomingCallModal.classList.add('hidden');
        ws.send(JSON.stringify({ type: 'call-accept', to: msg.from }));
        await startLocalStream();
        const call = peer.call(msg.from, localStream);
        if (call) setupCall(call, msg.from);
      };
      rejectCallBtn.onclick = () => {
        incomingCallModal.classList.add('hidden');
        ws.send(JSON.stringify({ type: 'call-reject', to: msg.from }));
      };
      break;
    case 'call-accept':
      if (currentCall) {
        callStatus.textContent = 'Connected';
      }
      break;
    case 'call-reject':
      endCall();
      alert('Call rejected');
      break;
    case 'call-end':
      endCall();
      break;
  }
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
  div.innerHTML = `${mine ? '' : `<div class="sender">${username}</div>`}<div class="text">${escapeHtml(text)}</div><div class="time">${time}</div>`;
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
  if (!text) return;
  ws.send(JSON.stringify({ type: 'chat', from: myId, message: text }));
  msgInput.value = '';
}

async function startLocalStream() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

function startCall(user) {
  ws.send(JSON.stringify({ type: 'call-request', to: user.id }));
  callPeerName.textContent = user.username;
  callStatus.textContent = 'Calling ' + user.username + '...';
  chatView.classList.add('hidden');
  callView.classList.remove('hidden');
  remotePeerId = user.id;
}

function setupCall(call, peerId) {
  currentCall = call;
  remotePeerId = peerId;

  call.on('stream', (stream) => {
    remoteVideo.srcObject = stream;
    callStatus.textContent = 'Connected';
    chatView.classList.add('hidden');
    callView.classList.remove('hidden');
  });

  call.on('close', endCall);
  call.on('error', endCall);
}

function endCall() {
  if (currentCall) { currentCall.close(); currentCall = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  callView.classList.add('hidden');
  chatView.classList.remove('hidden');
  micOn = true;
  camOn = true;
  toggleMic.textContent = 'Mute';
  toggleCam.textContent = 'Cam Off';
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
