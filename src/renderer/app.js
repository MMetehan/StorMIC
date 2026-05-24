'use strict';

// ── Sabitler ──────────────────────────────────────────────────
const DEFAULT_SIGNAL_URL = window.__STORMIC_SIGNAL_URL__ || window.electron?.signalUrl || '';
const CHUNK_SIZE = 16384; // 16 KB

function getSignalUrl() {
  return localStorage.getItem('stormic_signal_url') || DEFAULT_SIGNAL_URL;
}
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

// ── Yardımcı: kullanıcı rengi ────────────────────────────────
function usernameColor(username) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = username.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 65%, 65%)`;
}

// ── Ses efekti ────────────────────────────────────────────────
function playSound(type) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    if (type === 'join') {
      osc.frequency.setValueAtTime(820, ctx.currentTime);
      osc.frequency.setValueAtTime(1040, ctx.currentTime + 0.12);
    } else {
      osc.frequency.setValueAtTime(1040, ctx.currentTime);
      osc.frequency.setValueAtTime(700, ctx.currentTime + 0.14);
    }
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch {}
}

// ── Uygulama durumu ───────────────────────────────────────────
const state = {
  username:    null,
  channelCode: null,
  ws:          null,
};

// username -> { pc, dc, incoming, initiator, makingOffer }
const peers = new Map();

// Mikrofon durumu
const mic = {
  stream:         null,
  track:          null,
  mode:           'off',  // 'off' | 'ptt' | 'open'
  analyser:       null,
  audioCtx:       null,
  speakTimer:     null,
  isSpeaking:     false,
  speakThreshold: Number(localStorage.getItem('stormic_speak_threshold') || 8),
};

function getAudioConstraints() {
  const deviceId = localStorage.getItem('stormic_input_device') || '';
  const noise = localStorage.getItem('stormic_noise_suppression') !== 'false';
  const echo  = localStorage.getItem('stormic_echo_cancellation') !== 'false';
  const agc   = localStorage.getItem('stormic_agc') === 'true';
  const c = { noiseSuppression: noise, echoCancellation: echo, autoGainControl: agc };
  if (deviceId) c.deviceId = deviceId;
  return c;
}

// username -> HTMLAudioElement (uzak ses)
const remoteAudio = new Map();

// ── Yeniden bağlanma durumu ───────────────────────────────────
const reconn = { timer: null, attempts: 0 };

function setConnStatus(status) {
  // status: 'connected' | 'reconnecting' | 'disconnected' | 'idle'
  const dot = document.getElementById('conn-dot');
  if (!dot) return;
  dot.className = `conn-dot ${status}`;
  const labels = { connected: 'Bağlı', reconnecting: 'Yeniden bağlanıyor...', disconnected: 'Bağlantı kesildi', idle: '' };
  dot.title = labels[status] || '';
}

function scheduleReconnect() {
  if (reconn.timer || !state.channelCode) return;
  const delay = Math.min(1500 * 2 ** reconn.attempts, 30000);
  reconn.attempts++;
  setConnStatus('reconnecting');
  reconn.timer = setTimeout(() => {
    reconn.timer = null;
    if (state.channelCode) doReconnect();
  }, delay);
}

function doReconnect() {
  // Eski peer bağlantılarını temizle
  peers.forEach(({ pc }) => pc.close());
  peers.clear();
  remoteAudio.forEach(el => { el.srcObject = null; });
  remoteAudio.clear();
  [...videoTiles.keys()].filter(id => id.startsWith('remote-')).forEach(removeVideoTile);
  document.getElementById('participants-list').innerHTML = '';
  // Yeniden bağlan
  connectSignaling();
}

// Video durumu
const vid = {
  cameraStream:     null,
  cameraTrack:      null,
  screenStream:     null,
  screenTrack:      null,
  screenAudioTrack: null,
};

// tileId -> HTMLElement (video tile)
const videoTiles = new Map();

// ── Ekran geçişleri ───────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function copyToClipboard(text, feedbackEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (!feedbackEl) return;
    feedbackEl.textContent = 'Kopyalandı!';
    setTimeout(() => { feedbackEl.textContent = ''; }, 2000);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Ekran 1: Kullanıcı adı ────────────────────────────────────
const inputUsername = document.getElementById('input-username');

// Son kullanılan adı geri yükle
const _savedName = localStorage.getItem('stormic_username');
if (_savedName) inputUsername.value = _savedName;

function confirmUsername() {
  const name = inputUsername.value.trim();
  if (!name) return;
  state.username = name;
  localStorage.setItem('stormic_username', name);
  document.getElementById('welcome-text').textContent = `Merhaba, ${name}`;
  showScreen('screen-channel');
}

document.getElementById('btn-username-confirm').addEventListener('click', confirmUsername);
inputUsername.addEventListener('keydown', e => { if (e.key === 'Enter') confirmUsername(); });

document.getElementById('btn-edit-username').addEventListener('click', () => {
  showScreen('screen-username');
  inputUsername.select();
  inputUsername.focus();
});

// ── Ekran 2: Kanal oluştur / katıl ───────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  joinIntent = 'create';
  const code = randomCode();
  state.channelCode = code;
  document.getElementById('created-code').textContent = code;
  document.getElementById('copy-feedback').textContent = '';
  showScreen('screen-created');
});

document.getElementById('btn-copy').addEventListener('click', () => {
  copyToClipboard(state.channelCode, document.getElementById('copy-feedback'));
});

document.getElementById('btn-enter-channel').addEventListener('click', enterRoom);

const inputCode = document.getElementById('input-code');
document.getElementById('btn-join').addEventListener('click', () => {
  const code = inputCode.value.trim().toUpperCase();
  if (code.length !== 6) return;
  joinIntent = 'join';
  state.channelCode = code;
  enterRoom();
});
inputCode.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

// ── Oda ───────────────────────────────────────────────────────
function enterRoom() {
  document.getElementById('room-code-display').textContent = state.channelCode;
  document.getElementById('participants-list').innerHTML = '';
  document.getElementById('messages').innerHTML = '';
  showScreen('screen-room');
  connectSignaling();
}

document.getElementById('btn-copy-room-code').addEventListener('click', () => {
  copyToClipboard(state.channelCode, null);
});

document.getElementById('btn-leave').addEventListener('click', leaveRoom);

function leaveRoom() {
  if (reconn.timer) { clearTimeout(reconn.timer); reconn.timer = null; }
  reconn.attempts = 0;
  disableMic();
  disableCamera();
  disableScreenShare();
  peers.forEach(({ pc }) => pc.close());
  peers.clear();
  remoteAudio.forEach(el => { el.srcObject = null; });
  remoteAudio.clear();
  [...videoTiles.keys()].forEach(removeVideoTile);
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.channelCode = null;
  setConnStatus('idle');
  resetControlButtons();
  showScreen('screen-channel');
}

// ── Ses seviyesi ──────────────────────────────────────────────
const remoteVolumes = new Map(); // username → 0-1

function setRemoteVolume(username, vol) {
  remoteVolumes.set(username, vol);
  const el = remoteAudio.get(username);
  if (el) el.volume = vol;
}

// ── Volume popover ────────────────────────────────────────────
const volumePopover    = document.getElementById('volume-popover');
const volumePopoverName = document.getElementById('volume-popover-name');
const volumeSlider     = document.getElementById('volume-slider');
const volumeVal        = document.getElementById('volume-val');
const btnVolumeMute    = document.getElementById('btn-volume-mute');
let   volumePopoverTarget = null;

function openVolumePopover(username, anchorEl) {
  volumePopoverTarget = username;
  volumePopoverName.textContent = username;
  const vol = remoteVolumes.get(username) ?? 1;
  volumeSlider.value = Math.round(vol * 100);
  volumeVal.textContent = Math.round(vol * 100) + '%';
  btnVolumeMute.textContent = vol === 0 ? 'Sesi Aç' : 'Sustur';
  btnVolumeMute.classList.toggle('active', vol === 0);

  const rect = anchorEl.getBoundingClientRect();
  const sidebar = document.querySelector('.sidebar');
  const sidebarRect = sidebar.getBoundingClientRect();
  volumePopover.style.top = (rect.top - sidebarRect.top) + 'px';
  volumePopover.classList.remove('hidden');
}

function closeVolumePopover() {
  volumePopover.classList.add('hidden');
  volumePopoverTarget = null;
}

volumeSlider.addEventListener('input', () => {
  const vol = Number(volumeSlider.value) / 100;
  volumeVal.textContent = volumeSlider.value + '%';
  btnVolumeMute.textContent = vol === 0 ? 'Sesi Aç' : 'Sustur';
  btnVolumeMute.classList.toggle('active', vol === 0);
  if (volumePopoverTarget) setRemoteVolume(volumePopoverTarget, vol);
});

btnVolumeMute.addEventListener('click', () => {
  const isMuted = Number(volumeSlider.value) === 0;
  const newVol = isMuted ? 100 : 0;
  volumeSlider.value = newVol;
  volumeVal.textContent = newVol + '%';
  btnVolumeMute.textContent = newVol === 0 ? 'Sesi Aç' : 'Sustur';
  btnVolumeMute.classList.toggle('active', newVol === 0);
  if (volumePopoverTarget) setRemoteVolume(volumePopoverTarget, newVol / 100);
});

document.addEventListener('click', (e) => {
  if (!volumePopover.classList.contains('hidden') &&
      !volumePopover.contains(e.target) &&
      !e.target.closest('#participants-list')) {
    closeVolumePopover();
  }
});

// ── Katılımcı listesi ─────────────────────────────────────────
function addParticipant(username, isSelf = false) {
  if (document.getElementById(`peer-${username}`)) return;
  const li = document.createElement('li');
  li.id = `peer-${username}`;
  li.style.setProperty('--user-color', usernameColor(username));
  if (isSelf) li.classList.add('self');
  const nameSpan = document.createElement('span');
  nameSpan.className = 'participant-name';
  nameSpan.textContent = isSelf ? `${username} (sen)` : username;
  li.appendChild(nameSpan);
  if (!isSelf) {
    const qualityDot = document.createElement('span');
    qualityDot.className = 'quality-dot';
    qualityDot.title = 'Bağlanıyor...';
    li.appendChild(qualityDot);
    li.addEventListener('click', () => {
      if (volumePopoverTarget === username) { closeVolumePopover(); return; }
      openVolumePopover(username, li);
    });
  }
  document.getElementById('participants-list').appendChild(li);
}

function removeParticipant(username) {
  document.getElementById(`peer-${username}`)?.remove();
  if (volumePopoverTarget === username) closeVolumePopover();
  remoteVolumes.delete(username);
}

function setSpeaking(username, active) {
  document.getElementById(`peer-${username}`)?.classList.toggle('speaking', active);
}

// ── WebRTC peer bağlantısı ────────────────────────────────────
function createPeerConnection(remoteUsername, initiator) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const peerState = { pc, dc: null, incoming: null, initiator, makingOffer: false };
  peers.set(remoteUsername, peerState);

  // Mevcut track'leri ekle
  if (mic.track && mic.stream)             pc.addTrack(mic.track, mic.stream);
  if (vid.cameraTrack && vid.cameraStream) pc.addTrack(vid.cameraTrack, vid.cameraStream);
  if (vid.screenTrack && vid.screenStream) pc.addTrack(vid.screenTrack, vid.screenStream);
  if (vid.screenAudioTrack && vid.screenStream) pc.addTrack(vid.screenAudioTrack, vid.screenStream);

  // Renegotiation (örn. yeni track eklendiğinde)
  pc.onnegotiationneeded = async () => {
    if (peerState.makingOffer || pc.signalingState !== 'stable') return;
    peerState.makingOffer = true;
    try {
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      sendSignal(remoteUsername, { type: 'offer', sdp: pc.localDescription });
    } finally {
      peerState.makingOffer = false;
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) sendSignal(remoteUsername, { type: 'ice', candidate });
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected' && vid.screenTrack) {
      const sender = pc.getSenders().find(se => se.track?.id === vid.screenTrack?.id);
      if (sender) applyBitrate(sender, screenMaxBps());
    }
    if (s === 'failed') {
      // ICE yeniden başlatmayı dene
      if (!peerState.iceRestarted && peerState.initiator) {
        peerState.iceRestarted = true;
        pc.restartIce();
        return;
      }
      cleanupPeer(remoteUsername);
    }
    if (s === 'disconnected' || s === 'closed') {
      cleanupPeer(remoteUsername);
    }
  };

  function cleanupPeer(username) {
    if (!peers.has(username)) return;
    peers.get(username).pc.close();
    peers.delete(username);
    removeParticipant(username);
    remoteAudio.get(username)?.remove();
    remoteAudio.delete(username);
    const screenKey = `${username}-screen`;
    remoteAudio.get(screenKey)?.srcObject && (remoteAudio.get(screenKey).srcObject = null);
    remoteAudio.delete(screenKey);
    [...videoTiles.keys()]
      .filter(id => id.startsWith(`remote-${username}-`))
      .forEach(removeVideoTile);
    appendSystemMessage(`${username} bağlantısı kesildi`);
  }

  // Gelen ses/video track'leri
  pc.ontrack = ({ track, streams }) => {
    if (track.kind === 'audio') {
      const stream = streams[0] ?? new MediaStream([track]);
      if (!remoteAudio.has(remoteUsername)) {
        // İlk ses track'i = mikrofon
        const audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.volume = remoteVolumes.get(remoteUsername) ?? 1;
        remoteAudio.set(remoteUsername, audioEl);
        audioEl.srcObject = stream;
      } else {
        // Ekstra ses track'i = muhtemelen ekran sesi; mesaj eşleşmesini bekle
        const peer = peers.get(remoteUsername);
        if (peer) {
          if (!peer.pendingAudioTracks) peer.pendingAudioTracks = new Map();
          peer.pendingAudioTracks.set(track.id, { track, stream });
          resolveScreenAudio(peer, remoteUsername);
        }
      }
      return;
    }
    if (track.kind === 'video') {
      const stream = streams[0] ?? new MediaStream([track]);
      const peer = peers.get(remoteUsername);
      if (!peer) return;
      const knownKind = peer.pendingKinds?.get(track.id);
      if (knownKind) {
        const tileId = `remote-${remoteUsername}-${knownKind}`;
        peer.pendingKinds.delete(track.id);
        removeVideoTile(tileId);
        addVideoTile(tileId, remoteUsername, stream, knownKind);
        track.onended = () => removeVideoTile(tileId);
      } else {
        if (!peer.pendingTracks) peer.pendingTracks = new Map();
        peer.pendingTracks.set(track.id, { stream, track });
      }
    }
  };

  if (initiator) {
    const dc = pc.createDataChannel('stormic', { ordered: true });
    dc.binaryType = 'arraybuffer';
    setupDataChannel(dc, remoteUsername);
    peerState.dc = dc;
    // onnegotiationneeded data channel eklenince otomatik tetikler
  } else {
    pc.ondatachannel = ({ channel }) => {
      channel.binaryType = 'arraybuffer';
      peerState.dc = channel;
      setupDataChannel(channel, remoteUsername);
    };
  }

  return peerState;
}

function setupDataChannel(dc, remoteUsername) {
  dc.onopen = () => {
    // Yeni bağlanan peer'a aktif video/ses stream'lerini bildir
    if (vid.cameraTrack) dc.send(JSON.stringify({ type: 'video-track', trackId: vid.cameraTrack.id, kind: 'camera' }));
    if (vid.screenTrack) dc.send(JSON.stringify({ type: 'video-track', trackId: vid.screenTrack.id, kind: 'screen' }));
    if (vid.screenAudioTrack) dc.send(JSON.stringify({ type: 'screen-audio-track', trackId: vid.screenAudioTrack.id }));
  };
  dc.onmessage = ({ data }) => {
    if (typeof data === 'string') {
      handleControlMessage(JSON.parse(data), remoteUsername);
    } else {
      handleBinaryChunk(data, remoteUsername);
    }
  };
}

// ── Sinyal ───────────────────────────────────────────────────
function sendSignal(to, data) {
  state.ws.send(JSON.stringify({ type: 'signal', to, data }));
}

function handleSignal({ from, data }) {
  switch (data.type) {
    case 'offer': {
      if (!peers.has(from)) createPeerConnection(from, false);
      const peer = peers.get(from);
      const { pc } = peer;

      // Çakışma kontrolü (glare): biz de offer üretiyorsak ve initiator'sak, yabancı offer'ı yoksay
      const collision = peer.makingOffer || pc.signalingState !== 'stable';
      if (collision && peer.initiator) return;

      pc.setRemoteDescription(data.sdp)
        .then(() => pc.createAnswer())
        .then(answer => pc.setLocalDescription(answer).then(() => answer))
        .then(answer => sendSignal(from, { type: 'answer', sdp: answer }));
      break;
    }
    case 'answer': {
      const peer = peers.get(from);
      if (peer) peer.pc.setRemoteDescription(data.sdp);
      break;
    }
    case 'ice': {
      const peer = peers.get(from);
      if (peer) peer.pc.addIceCandidate(data.candidate).catch(() => {});
      break;
    }
  }
}

// ── Veri kanalı mesajları ─────────────────────────────────────
function handleControlMessage(msg, from) {
  switch (msg.type) {
    case 'chat':
      appendChatMessage(msg.username, msg.text);
      break;
    case 'speaking':
      setSpeaking(from, msg.active);
      break;
    case 'video-track': {
      const peer = peers.get(from);
      if (!peer) break;
      const pending = peer.pendingTracks?.get(msg.trackId);
      if (pending) {
        peer.pendingTracks.delete(msg.trackId);
        const tileId = `remote-${from}-${msg.kind}`;
        removeVideoTile(tileId);
        addVideoTile(tileId, from, pending.stream, msg.kind);
        pending.track.onended = () => removeVideoTile(tileId);
      } else {
        if (!peer.pendingKinds) peer.pendingKinds = new Map();
        peer.pendingKinds.set(msg.trackId, msg.kind);
      }
      break;
    }
    case 'video-stop': {
      removeVideoTile(`remote-${from}-${msg.kind}`);
      break;
    }
    case 'screen-audio-track': {
      const peer = peers.get(from);
      if (!peer) break;
      peer.pendingScreenAudioId = msg.trackId;
      resolveScreenAudio(peer, from);
      break;
    }
    case 'screen-audio-stop': {
      const screenKey = `${from}-screen`;
      const el = remoteAudio.get(screenKey);
      if (el) { el.srcObject = null; remoteAudio.delete(screenKey); }
      break;
    }
    case 'file-meta': {
      const peer = peers.get(from);
      if (peer) {
        const msgEl = appendFileProgressMessage(from, msg.name, msg.size);
        peer.incoming = { id: msg.id, name: msg.name, size: msg.size, mime: msg.mime, chunks: [], received: 0, msgEl };
      }
      break;
    }
    case 'file-done': {
      const peer = peers.get(from);
      if (peer?.incoming) {
        const { name, mime, chunks, msgEl } = peer.incoming;
        const blob = new Blob(chunks, { type: mime || 'application/octet-stream' });
        finalizeFileProgressMessage(msgEl, from, name, blob);
        peer.incoming = null;
      }
      break;
    }
  }
}

function handleBinaryChunk(data, from) {
  const peer = peers.get(from);
  if (!peer?.incoming) return;
  peer.incoming.chunks.push(data);
  peer.incoming.received += data.byteLength;
  if (peer.incoming.size > 0 && peer.incoming.msgEl) {
    const pct = Math.min(100, Math.round(peer.incoming.received / peer.incoming.size * 100));
    const bar = peer.incoming.msgEl.querySelector('.file-progress-bar');
    const pctEl = peer.incoming.msgEl.querySelector('.file-progress-pct');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  }
}

function broadcastControl(msg) {
  const json = JSON.stringify(msg);
  peers.forEach(({ dc }) => {
    if (dc?.readyState === 'open') dc.send(json);
  });
}

// ── Bitrate yardımcıları ──────────────────────────────────────
function screenMaxBps() {
  if (screenCfg.width >= 1920) return 8_000_000;
  if (screenCfg.width >= 1280) return 4_000_000;
  return 2_000_000;
}

async function applyBitrate(sender, bps) {
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  params.encodings[0].maxBitrate = bps;
  await sender.setParameters(params).catch(() => {});
}

// ── Ekran sesi eşleştirme ─────────────────────────────────────
function resolveScreenAudio(peer, remoteUsername) {
  if (!peer.pendingScreenAudioId || !peer.pendingAudioTracks?.size) return;
  const pending = peer.pendingAudioTracks.get(peer.pendingScreenAudioId);
  if (!pending) return;
  peer.pendingAudioTracks.delete(peer.pendingScreenAudioId);
  peer.pendingScreenAudioId = null;
  const screenKey = `${remoteUsername}-screen`;
  const audioEl = new Audio();
  audioEl.autoplay = true;
  remoteAudio.set(screenKey, audioEl);
  audioEl.srcObject = pending.stream;
  pending.track.onended = () => {
    if (remoteAudio.get(screenKey) === audioEl) {
      audioEl.srcObject = null;
      remoteAudio.delete(screenKey);
    }
  };
}

// ── Bağlantı kalitesi + adaptif bitrate ───────────────────────
async function updatePeerStats() {
  for (const [username, { pc }] of peers) {
    try {
      const stats = await pc.getStats();
      let rtt = null;
      let videoPacketsSent = 0;
      let videoPacketsLost = 0;

      stats.forEach(r => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
          if (rtt === null || r.currentRoundTripTime < rtt) rtt = r.currentRoundTripTime;
        }
        if (r.type === 'outbound-rtp' && r.kind === 'video') videoPacketsSent += r.packetsSent || 0;
        if (r.type === 'remote-inbound-rtp' && r.kind === 'video') videoPacketsLost += r.packetsLost || 0;
      });

      const ms = rtt !== null ? rtt * 1000 : null;
      const level = ms === null ? 'unknown' : ms < 80 ? 'good' : ms < 200 ? 'medium' : 'poor';
      const colors = { good: 'var(--success)', medium: '#f0b232', poor: 'var(--danger)', unknown: 'var(--border)' };
      const li = document.getElementById(`peer-${username}`);
      if (!li) continue;
      const dot = li.querySelector('.quality-dot');
      if (!dot) continue;
      dot.style.background = colors[level];
      dot.title = ms !== null ? `${Math.round(ms)} ms` : 'Ölçülüyor...';

      // Adaptif bitrate — ekran paylaşımı aktifken
      if (vid.screenTrack) {
        const screenSender = pc.getSenders().find(s => s.track?.id === vid.screenTrack?.id);
        if (screenSender) {
          const total = videoPacketsSent + videoPacketsLost;
          const lossRate = total > 200 ? videoPacketsLost / total : 0;
          const max = screenMaxBps();
          const params = screenSender.getParameters();
          if (params.encodings?.length) {
            const current = params.encodings[0].maxBitrate;
            if (current === undefined) {
              // İlk başarılı renegotiation sonrası — başlangıç bitrate'i ayarla
              params.encodings[0].maxBitrate = max;
              screenSender.setParameters(params).catch(() => {});
            } else {
              let next;
              if (lossRate > 0.08)       next = Math.max(300_000, Math.round(current * 0.75));
              else if (lossRate < 0.02)  next = Math.min(max, Math.round(current * 1.1));
              if (next !== undefined && Math.abs(next - current) > 50_000) {
                params.encodings[0].maxBitrate = next;
                screenSender.setParameters(params).catch(() => {});
              }
            }
          }
        }
      }
    } catch {}
  }
}
setInterval(updatePeerStats, 4000);

// ── Sinyal sunucusu bağlantısı ────────────────────────────────

// intent: 'create' | 'join'  — enterRoom çağrıldığında ayarlanır
let joinIntent = 'create';

function connectSignaling() {
  let ws;
  try {
    ws = new WebSocket(getSignalUrl());
  } catch {
    appendSystemMessage('Geçersiz sunucu adresi.');
    setConnStatus('disconnected');
    return;
  }
  state.ws = ws;

  ws.addEventListener('open', () => {
    reconn.attempts = 0; // başarılı bağlantıda sayacı sıfırla
    setConnStatus('connected');
    ws.send(JSON.stringify({
      type: 'join',
      code: state.channelCode,
      username: state.username,
      intent: joinIntent,
    }));
    addParticipant(state.username, true);
  });

  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    switch (msg.type) {
      case 'peers':
        msg.peers.forEach(p => {
          addParticipant(p.username);
          createPeerConnection(p.username, true);
        });
        break;
      case 'peer-joined':
        addParticipant(msg.username);
        appendSystemMessage(`${msg.username} kanala katıldı`);
        playSound('join');
        break;
      case 'peer-left': {
        const leftPeer = peers.get(msg.username);
        if (leftPeer) {
          leftPeer.pc.close();
          peers.delete(msg.username);
        }
        remoteAudio.get(msg.username)?.remove();
        remoteAudio.delete(msg.username);
        const leftScreenKey = `${msg.username}-screen`;
        remoteAudio.get(leftScreenKey)?.srcObject && (remoteAudio.get(leftScreenKey).srcObject = null);
        remoteAudio.delete(leftScreenKey);
        remoteVolumes.delete(msg.username);
        [...videoTiles.keys()]
          .filter(id => id.startsWith(`remote-${msg.username}-`))
          .forEach(removeVideoTile);
        removeParticipant(msg.username);
        appendSystemMessage(`${msg.username} kanaldan ayrıldı`);
        playSound('leave');
        break;
      }
      case 'signal':
        handleSignal(msg);
        break;
      case 'error': {
        const errorMessages = {
          CHANNEL_NOT_FOUND: 'Kanal bulunamadı. Kodu kontrol et.',
          USERNAME_TAKEN: 'Bu kullanıcı adı kanalda zaten kullanımda.',
        };
        if (errorMessages[msg.code]) {
          ws.close();
          state.ws = null;
          state.channelCode = null;
          showScreen('screen-channel');
          const errEl = document.getElementById('join-error');
          if (errEl) {
            errEl.textContent = errorMessages[msg.code];
            setTimeout(() => { errEl.textContent = ''; }, 4000);
          }
        }
        break;
      }
    }
  });

  ws.addEventListener('close', () => {
    if (!state.channelCode) return; // kasıtlı ayrılma
    setConnStatus('reconnecting');
    appendSystemMessage('Bağlantı kesildi, yeniden bağlanılıyor…');
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    setConnStatus('disconnected');
  });
}

// ── Mikrofon yönetimi ─────────────────────────────────────────
async function enableMic() {
  if (mic.stream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(), video: false });
    mic.stream = stream;
    mic.track  = stream.getAudioTracks()[0];
    mic.track.enabled = false; // başlangıçta kapalı

    // Tüm bağlı peer'lara track ekle (renegotiation tetikler)
    peers.forEach(({ pc }) => pc.addTrack(mic.track, stream));

    startSpeakingDetection(stream);
    return true;
  } catch {
    appendSystemMessage('Mikrofon izni alınamadı.');
    return false;
  }
}

function disableMic() {
  if (!mic.stream) return;
  mic.track.enabled = false;
  mic.stream.getTracks().forEach(t => t.stop());
  mic.stream = null;
  mic.track  = null;
  if (mic.speakTimer) { clearInterval(mic.speakTimer); mic.speakTimer = null; }
  if (mic.audioCtx)   { mic.audioCtx.close(); mic.audioCtx = null; }
  mic.analyser = null;
  mic.mode = 'off';
  broadcastSpeaking(false);
}

function setMicEnabled(enabled) {
  if (!mic.track) return;
  mic.track.enabled = enabled;
  if (!enabled) broadcastSpeaking(false);
}

async function restartMicWithCurrentSettings() {
  if (!mic.stream) return;
  const wasEnabled = mic.track.enabled;
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(), video: false });
    const newTrack  = newStream.getAudioTracks()[0];
    newTrack.enabled = wasEnabled;
    peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) sender.replaceTrack(newTrack);
      else        pc.addTrack(newTrack, newStream);
    });
    if (mic.speakTimer) { clearInterval(mic.speakTimer); mic.speakTimer = null; }
    if (mic.audioCtx)   { mic.audioCtx.close();           mic.audioCtx  = null; }
    mic.analyser = null;
    mic.stream.getTracks().forEach(t => t.stop());
    mic.stream = newStream;
    mic.track  = newTrack;
    startSpeakingDetection(newStream);
  } catch {
    appendSystemMessage('Ses aygıtı değiştirilemedi.');
  }
}

async function applyOutputDevice(deviceId) {
  for (const el of remoteAudio.values()) {
    if (typeof el.setSinkId === 'function') {
      await el.setSinkId(deviceId).catch(() => {});
    }
  }
}

// ── Konuşma tespiti ───────────────────────────────────────────
function startSpeakingDetection(stream) {
  mic.audioCtx  = new AudioContext();
  mic.analyser  = mic.audioCtx.createAnalyser();
  mic.analyser.fftSize = 512;
  mic.audioCtx.createMediaStreamSource(stream).connect(mic.analyser);

  const data = new Uint8Array(mic.analyser.frequencyBinCount);
  mic.speakTimer = setInterval(() => {
    if (!mic.track?.enabled) {
      if (mic.isSpeaking) { mic.isSpeaking = false; broadcastSpeaking(false); setSpeaking(state.username, false); }
      return;
    }
    mic.analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const speaking = avg > mic.speakThreshold;
    if (speaking !== mic.isSpeaking) {
      mic.isSpeaking = speaking;
      broadcastSpeaking(speaking);
      setSpeaking(state.username, speaking);
    }
  }, 80);
}

function broadcastSpeaking(active) {
  broadcastControl({ type: 'speaking', active });
}

// ── PTT Tuş Ataması ───────────────────────────────────────────

// binding: { type: 'key', code: 'Space', label: 'Boşluk' }
//        | { type: 'mouse', button: 3, label: 'Fare Geri' }
const DEFAULT_PTT = { type: 'key', code: 'Space', label: 'Boşluk' };

let pttBinding = (() => {
  try { return JSON.parse(localStorage.getItem('stormic_ptt')) || DEFAULT_PTT; }
  catch { return DEFAULT_PTT; }
})();

function savePttBinding(binding) {
  pttBinding = binding;
  localStorage.setItem('stormic_ptt', JSON.stringify(binding));
  updatePttKeyDisplay();
}

function updatePttKeyDisplay() {
  const el = document.getElementById('ptt-key-display');
  if (el) el.textContent = pttBinding.label;
}

function keyLabel(code) {
  const map = {
    Space: 'Boşluk', CapsLock: 'Caps Lock', Tab: 'Tab',
    Enter: 'Enter', Backspace: 'Geri Al', Delete: 'Sil',
    Insert: 'Ekle', Home: 'Home', End: 'End',
    PageUp: 'Page Up', PageDown: 'Page Down',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'Esc', PrintScreen: 'PrtSc', ScrollLock: 'Scroll Lock',
    Pause: 'Pause', NumLock: 'Num Lock',
  };
  if (map[code]) return map[code];
  if (/^F\d+$/.test(code)) return code;
  if (code.startsWith('Key'))    return code.slice(3);
  if (code.startsWith('Digit'))  return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

function mouseButtonLabel(button) {
  return { 1: 'Fare Orta', 2: 'Fare Sağ', 3: 'Fare Geri', 4: 'Fare İleri' }[button] ?? `Fare ${button}`;
}

// ── Mikrofon tuş ataması ──────────────────────────────────────
let micToggleBinding = (() => {
  try { return JSON.parse(localStorage.getItem('stormic_mic_toggle')) || null; }
  catch { return null; }
})();

function saveMicToggleBinding(binding) {
  micToggleBinding = binding;
  localStorage.setItem('stormic_mic_toggle', JSON.stringify(binding));
  updateMicKeyDisplay();
}

function clearMicToggleBinding() {
  micToggleBinding = null;
  localStorage.removeItem('stormic_mic_toggle');
  updateMicKeyDisplay();
}

function updateMicKeyDisplay() {
  const el = document.getElementById('mic-key-display');
  if (el) el.textContent = micToggleBinding ? micToggleBinding.label : '—';
}

// ── Ayarlar paneli ────────────────────────────────────────────
const settingsPanel   = document.getElementById('settings-panel');
const btnSettings     = document.getElementById('btn-settings');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnRebindPtt    = document.getElementById('btn-rebind-ptt');
const btnRebindMic    = document.getElementById('btn-rebind-mic');
const btnClearMic     = document.getElementById('btn-clear-mic');

// 'ptt' | 'mic' | null
let rebindTarget = null;

async function populateDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const inputSel  = document.getElementById('sel-input-device');
  const outputSel = document.getElementById('sel-output-device');
  if (!inputSel || !outputSel) return;

  const savedInput  = localStorage.getItem('stormic_input_device')  || '';
  const savedOutput = localStorage.getItem('stormic_output_device') || '';

  const rebuild = (sel, kind, savedId, defaultLabel) => {
    const prev = sel.value;
    sel.innerHTML = `<option value="">${defaultLabel}</option>`;
    devices.filter(d => d.kind === kind).forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || d.deviceId.slice(0, 12);
      sel.appendChild(opt);
    });
    sel.value = savedId || prev || '';
  };

  rebuild(inputSel,  'audioinput',  savedInput,  'Varsayılan');
  rebuild(outputSel, 'audiooutput', savedOutput, 'Varsayılan');
}

btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.toggle('hidden');
  btnSettings.classList.toggle('active', !settingsPanel.classList.contains('hidden'));
  if (!settingsPanel.classList.contains('hidden')) populateDevices();
});

btnSettingsClose.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  btnSettings.classList.remove('active');
  stopRebinding(false);
});

document.addEventListener('click', (e) => {
  if (!settingsPanel.contains(e.target) && e.target !== btnSettings) {
    settingsPanel.classList.add('hidden');
    btnSettings.classList.remove('active');
    stopRebinding(false);
  }
});

btnRebindPtt.addEventListener('click', (e) => {
  e.stopPropagation();
  if (rebindTarget === 'ptt') stopRebinding(false);
  else startRebinding('ptt');
});

btnRebindMic.addEventListener('click', (e) => {
  e.stopPropagation();
  if (rebindTarget === 'mic') stopRebinding(false);
  else startRebinding('mic');
});

btnClearMic.addEventListener('click', (e) => {
  e.stopPropagation();
  clearMicToggleBinding();
  stopRebinding(false);
});

function startRebinding(target) {
  rebindTarget = target;
  const btn = target === 'ptt' ? btnRebindPtt : btnRebindMic;
  const other = target === 'ptt' ? btnRebindMic : btnRebindPtt;
  btn.textContent = 'Tuşa bas...';
  btn.classList.add('listening');
  other.textContent = 'Değiştir';
  other.classList.remove('listening');
}

function stopRebinding(save, binding = null) {
  const target = rebindTarget;
  rebindTarget = null;
  btnRebindPtt.textContent = 'Değiştir';
  btnRebindPtt.classList.remove('listening');
  btnRebindMic.textContent = 'Değiştir';
  btnRebindMic.classList.remove('listening');
  if (!save || !binding) return;
  if (target === 'ptt') savePttBinding(binding);
  else if (target === 'mic') saveMicToggleBinding(binding);
}

// Klavye ile atama
document.addEventListener('keydown', (e) => {
  if (!rebindTarget) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') { stopRebinding(false); return; }
  if (['F5', 'F11', 'F12'].includes(e.code)) return;
  stopRebinding(true, { type: 'key', code: e.code, label: keyLabel(e.code) });
}, true);

// Fare düğmesiyle atama (sol tık hariç)
document.addEventListener('mousedown', (e) => {
  if (!rebindTarget) return;
  if (e.button === 0) return;
  e.preventDefault();
  e.stopPropagation();
  stopRebinding(true, { type: 'mouse', button: e.button, label: mouseButtonLabel(e.button) });
}, true);

// ── Kontrol butonları ─────────────────────────────────────────
const btnPtt    = document.getElementById('btn-ptt');
const btnMic    = document.getElementById('btn-mic');
const btnCam    = document.getElementById('btn-cam');
const btnScreen = document.getElementById('btn-screen');

function resetControlButtons() {
  [btnPtt, btnMic, btnCam, btnScreen].forEach(b => b.classList.remove('active', 'ptt-active'));
}

// Mikrofon toggle (açık mikrofon modu)
btnMic.addEventListener('click', async () => {
  if (mic.mode === 'open') {
    disableMic();
    btnMic.classList.remove('active');
    btnMic.textContent = '🔇 Mikrofon';
    mic.mode = 'off';
  } else {
    // PTT stream'i zaten açıksa tekrar getUserMedia çağırmaya gerek yok
    if (!mic.stream) {
      const ok = await enableMic();
      if (!ok) return;
    }
    mic.mode = 'open';
    setMicEnabled(true);
    btnMic.classList.add('active');
    btnMic.textContent = '🎙️ Mikrofon';
  }
});

// PTT aktifleştir / bırak
async function activatePtt() {
  if (rebindTarget) return;
  if (mic.mode === 'open') return;
  if (!mic.stream) {
    const ok = await enableMic();
    if (!ok) return;
    mic.mode = 'ptt';
  }
  setMicEnabled(true);
  btnPtt.classList.add('ptt-active');
}

function deactivatePtt() {
  if (mic.mode !== 'ptt') return;
  setMicEnabled(false);
  btnPtt.classList.remove('ptt-active');
}

// PTT butonu (fare)
btnPtt.addEventListener('mousedown', activatePtt);
btnPtt.addEventListener('mouseup',    deactivatePtt);
btnPtt.addEventListener('mouseleave', deactivatePtt);

// PTT klavye kısayolu
document.addEventListener('keydown', (e) => {
  if (rebindTarget) return;
  if (document.activeElement?.tagName === 'INPUT') return;
  // Mikrofon toggle
  if (micToggleBinding?.type === 'key' && e.code === micToggleBinding.code && !e.repeat) {
    e.preventDefault();
    btnMic.click();
    return;
  }
  if (pttBinding.type !== 'key' || e.code !== pttBinding.code || e.repeat) return;
  e.preventDefault();
  activatePtt();
});

document.addEventListener('keyup', (e) => {
  if (pttBinding.type !== 'key' || e.code !== pttBinding.code) return;
  deactivatePtt();
});

// PTT fare yan tuşu kısayolu
document.addEventListener('mousedown', (e) => {
  if (rebindTarget) return;
  // Mikrofon toggle
  if (micToggleBinding?.type === 'mouse' && e.button === micToggleBinding.button) {
    btnMic.click();
    return;
  }
  if (pttBinding.type !== 'mouse' || e.button !== pttBinding.button) return;
  activatePtt();
});

document.addEventListener('mouseup', (e) => {
  if (pttBinding.type !== 'mouse' || e.button !== pttBinding.button) return;
  deactivatePtt();
});

// ── Kamera ────────────────────────────────────────────────────
btnCam.addEventListener('click', async () => {
  if (vid.cameraStream) {
    disableCamera();
    btnCam.classList.remove('active');
  } else {
    const ok = await enableCamera();
    if (ok) btnCam.classList.add('active');
  }
});

async function enableCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    vid.cameraStream = stream;
    vid.cameraTrack  = stream.getVideoTracks()[0];

    peers.forEach(({ pc }) => pc.addTrack(vid.cameraTrack, stream));
    broadcastControl({ type: 'video-track', trackId: vid.cameraTrack.id, kind: 'camera' });

    const tileId = 'local-camera';
    addVideoTile(tileId, state.username + ' (sen)', stream, 'camera', true);

    vid.cameraTrack.onended = () => {
      disableCamera();
      btnCam.classList.remove('active');
    };
    return true;
  } catch {
    appendSystemMessage('Kamera erişimi reddedildi.');
    return false;
  }
}

function disableCamera() {
  if (!vid.cameraStream) return;
  vid.cameraStream.getTracks().forEach(t => t.stop());
  vid.cameraStream = null;
  vid.cameraTrack  = null;
  removeVideoTile('local-camera');
  broadcastControl({ type: 'video-stop', kind: 'camera' });
}

// ── Ekran paylaşımı ───────────────────────────────────────────
const screenWrap    = document.getElementById('screen-wrap');
const screenOptions = document.getElementById('screen-options');
const btnStartScreen = document.getElementById('btn-start-screen');

let screenCfg = { width: 1280, height: 720, fps: 30, audio: false };

// Hazır ayar seçimi
screenOptions.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    screenOptions.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const presets = {
      presentation: { width: 1920, height: 1080, fps: 5 },
      gaming:       { width: 1280, height: 720,  fps: 60 },
      lowband:      { width: 854,  height: 480,  fps: 15 },
    };
    const p = presets[btn.dataset.preset];
    if (p) {
      screenCfg.width = p.width; screenCfg.height = p.height; screenCfg.fps = p.fps;
      screenOptions.querySelectorAll('[data-res]').forEach(b =>
        b.classList.toggle('active', Number(b.dataset.res) === p.width));
      screenOptions.querySelectorAll('[data-fps]').forEach(b =>
        b.classList.toggle('active', Number(b.dataset.fps) === p.fps));
    }
  });
});

// Çözünürlük seçimi
screenOptions.querySelectorAll('[data-res]').forEach(btn => {
  btn.addEventListener('click', () => {
    screenOptions.querySelectorAll('[data-res]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    screenCfg.width  = Number(btn.dataset.res);
    screenCfg.height = Number(btn.dataset.h);
    screenOptions.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
  });
});

// FPS seçimi
screenOptions.querySelectorAll('[data-fps]').forEach(btn => {
  btn.addEventListener('click', () => {
    screenOptions.querySelectorAll('[data-fps]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    screenCfg.fps = Number(btn.dataset.fps);
    screenOptions.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
  });
});

// Sistem sesi toggle
const btnScreenAudio = document.getElementById('btn-screen-audio');
if (btnScreenAudio) {
  btnScreenAudio.addEventListener('click', (e) => {
    e.stopPropagation();
    screenCfg.audio = !screenCfg.audio;
    btnScreenAudio.classList.toggle('active', screenCfg.audio);
    btnScreenAudio.textContent = screenCfg.audio ? 'Açık' : 'Kapalı';
  });
}

btnScreen.addEventListener('click', (e) => {
  e.stopPropagation();
  if (vid.screenStream) {
    disableScreenShare();
    btnScreen.classList.remove('active');
    return;
  }
  screenOptions.classList.toggle('hidden');
});

btnStartScreen.addEventListener('click', async () => {
  screenOptions.classList.add('hidden');
  const ok = await enableScreenShare();
  if (ok) btnScreen.classList.add('active');
});

document.addEventListener('click', (e) => {
  if (!screenWrap.contains(e.target)) screenOptions.classList.add('hidden');
});

async function pickScreenSource() {
  if (!window.electron?.getSources) return null;
  return new Promise(resolve => {
    const modal   = document.getElementById('source-picker-modal');
    const grid    = document.getElementById('source-picker-grid');
    const btnOk   = document.getElementById('btn-source-confirm');
    const btnCancel = document.getElementById('btn-source-cancel');
    let selectedId = null;

    window.electron.getSources().then(sources => {
      grid.innerHTML = '';
      sources.forEach(src => {
        const card = document.createElement('div');
        card.className = 'source-card';
        card.innerHTML = `<img src="${src.thumbnail}" /><div class="source-card-name">${escapeHtml(src.name)}</div>`;
        card.addEventListener('click', () => {
          grid.querySelectorAll('.source-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          selectedId = src.id;
          btnOk.disabled = false;
        });
        grid.appendChild(card);
      });
      modal.classList.remove('hidden');
    }).catch(() => resolve(null));

    function cleanup() {
      modal.classList.add('hidden');
      grid.innerHTML = '';
      btnOk.disabled = true;
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
    }
    function onOk()     { cleanup(); resolve(selectedId); }
    function onCancel() { cleanup(); resolve(null); }
    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

async function enableScreenShare() {
  try {
    // Electron'da pencere/ekran seçici
    if (window.electron?.getSources) {
      const sourceId = await pickScreenSource();
      if (!sourceId) return false;
      window.electron.setScreenShareConfig({ sourceId, audio: screenCfg.audio });
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width:     { ideal: screenCfg.width },
        height:    { ideal: screenCfg.height },
        frameRate: { ideal: screenCfg.fps },
      },
      audio: screenCfg.audio,
    });

    vid.screenStream = stream;
    vid.screenTrack  = stream.getVideoTracks()[0];

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) vid.screenAudioTrack = audioTracks[0];

    peers.forEach(({ pc }) => {
      pc.addTrack(vid.screenTrack, stream);
      if (vid.screenAudioTrack) pc.addTrack(vid.screenAudioTrack, stream);
    });
    broadcastControl({ type: 'video-track', trackId: vid.screenTrack.id, kind: 'screen' });
    if (vid.screenAudioTrack) {
      broadcastControl({ type: 'screen-audio-track', trackId: vid.screenAudioTrack.id });
    }

    // Bağlı peer'lara bitrate uygula
    const maxBps = screenMaxBps();
    peers.forEach(({ pc }) => {
      const sender = pc.getSenders().find(s => s.track?.id === vid.screenTrack?.id);
      if (sender) applyBitrate(sender, maxBps);
    });

    const tileId = 'local-screen';
    addVideoTile(tileId, state.username + ' (ekran)', stream, 'screen', true);

    vid.screenTrack.onended = () => {
      disableScreenShare();
      btnScreen.classList.remove('active');
    };
    return true;
  } catch {
    appendSystemMessage('Ekran paylaşımı iptal edildi.');
    return false;
  }
}

function disableScreenShare() {
  if (!vid.screenStream) return;
  const hadAudio = vid.screenAudioTrack !== null;
  vid.screenStream.getTracks().forEach(t => t.stop());
  vid.screenStream     = null;
  vid.screenTrack      = null;
  vid.screenAudioTrack = null;
  removeVideoTile('local-screen');
  broadcastControl({ type: 'video-stop', kind: 'screen' });
  if (hadAudio) broadcastControl({ type: 'screen-audio-stop' });
}

// ── Video tile yönetimi ───────────────────────────────────────
const videoArea      = document.getElementById('video-area');
const spotlightVideo = document.getElementById('spotlight-video');
const spotlightLabel = document.getElementById('spotlight-label');
const videoStrip     = document.getElementById('video-strip');
let   activeSpotlightId = null;

function setSpotlight(id) {
  const entry = videoTiles.get(id);
  if (!entry) return;
  activeSpotlightId = id;
  spotlightVideo.srcObject = entry.stream;
  spotlightVideo.muted = entry.muted;
  spotlightLabel.textContent = entry.label;
  videoStrip.querySelectorAll('.strip-tile').forEach(t => t.classList.remove('active'));
  entry.el.classList.add('active');
  const isLocalCam = id === 'local-camera';
  btnMirror.classList.toggle('hidden', !isLocalCam);
  spotlightVideo.style.transform = (isLocalCam && localCameraMirrored) ? 'scaleX(-1)' : '';
}

function updateStripVisibility() {
  videoStrip.classList.toggle('visible', videoTiles.size > 1);
}

function addVideoTile(id, label, stream, kind, muted = false) {
  if (videoTiles.has(id)) return;

  const tile = document.createElement('div');
  tile.className = `strip-tile strip-tile-${kind}`;
  tile.title = label;
  tile.innerHTML = `
    <video autoplay playsinline></video>
    <div class="strip-tile-label">${escapeHtml(label)}</div>`;
  const videoEl = tile.querySelector('video');
  videoEl.muted = true;
  videoEl.srcObject = stream;
  tile.addEventListener('click', () => setSpotlight(id));
  videoStrip.appendChild(tile);

  videoTiles.set(id, { el: tile, stream, label, kind, muted });
  videoArea.classList.add('active');
  updateStripVisibility();

  if (videoTiles.size === 1) setSpotlight(id);
}

function removeVideoTile(id) {
  const entry = videoTiles.get(id);
  if (!entry) return;
  entry.el.remove();
  videoTiles.delete(id);

  if (videoTiles.size === 0) {
    videoArea.classList.remove('active');
    spotlightVideo.srcObject = null;
    activeSpotlightId = null;
  } else if (activeSpotlightId === id) {
    setSpotlight(videoTiles.keys().next().value);
  }
  updateStripVisibility();
}

document.getElementById('btn-fullscreen').addEventListener('click', () => {
  const el = document.getElementById('video-spotlight');
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});

let localCameraMirrored = false;
const btnMirror = document.getElementById('btn-mirror');
btnMirror.addEventListener('click', () => {
  localCameraMirrored = !localCameraMirrored;
  spotlightVideo.style.transform = localCameraMirrored ? 'scaleX(-1)' : '';
  btnMirror.classList.toggle('active', localCameraMirrored);
});

// Başlangıçta tuş adlarını göster
updatePttKeyDisplay();
updateMicKeyDisplay();

// ── Ses ayarları ──────────────────────────────────────────────
function initAudioToggle(btnId, storageKey, defaultVal) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const current = () => localStorage.getItem(storageKey) !== null
    ? localStorage.getItem(storageKey) !== 'false'
    : defaultVal;
  const render = (val) => {
    btn.textContent = val ? 'Açık' : 'Kapalı';
    btn.classList.toggle('active', val);
  };
  render(current());
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const next = !current();
    localStorage.setItem(storageKey, next);
    render(next);
    await restartMicWithCurrentSettings();
  });
}

initAudioToggle('btn-noise-supp',  'stormic_noise_suppression', true);
initAudioToggle('btn-echo-cancel', 'stormic_echo_cancellation', true);
initAudioToggle('btn-agc',         'stormic_agc',               false);

// Giriş aygıtı değişince mikrofonu yeniden başlat
document.getElementById('sel-input-device')?.addEventListener('change', async (e) => {
  localStorage.setItem('stormic_input_device', e.target.value);
  await restartMicWithCurrentSettings();
});

// Çıkış aygıtı değişince mevcut seslere uygula
document.getElementById('sel-output-device')?.addEventListener('change', async (e) => {
  const deviceId = e.target.value;
  localStorage.setItem('stormic_output_device', deviceId);
  await applyOutputDevice(deviceId);
});

// Konuşma eşiği slider
const rangeThreshold = document.getElementById('range-threshold');
const thresholdVal   = document.getElementById('threshold-val');
if (rangeThreshold) {
  const saved = Number(localStorage.getItem('stormic_speak_threshold') || 8);
  rangeThreshold.value     = saved;
  if (thresholdVal) thresholdVal.textContent = saved;
  rangeThreshold.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    mic.speakThreshold = v;
    localStorage.setItem('stormic_speak_threshold', v);
    if (thresholdVal) thresholdVal.textContent = v;
  });
}

// Yeni bağlanan ses elementine kayıtlı çıkış aygıtını uygula
const _origRemoteAudioSet = remoteAudio.set.bind(remoteAudio);
remoteAudio.set = (key, el) => {
  const deviceId = localStorage.getItem('stormic_output_device') || '';
  if (deviceId && typeof el.setSinkId === 'function') {
    el.setSinkId(deviceId).catch(() => {});
  }
  return _origRemoteAudioSet(key, el);
};

// ── Sunucu URL ayarı (kanal ekranı) ──────────────────────────
const inputSignalUrlChannel = document.getElementById('input-signal-url-channel');
const serverSettingBody     = document.getElementById('server-setting-body');
const urlSaveFeedback       = document.getElementById('url-save-feedback');

if (inputSignalUrlChannel) {
  inputSignalUrlChannel.value = getSignalUrl();

  document.getElementById('btn-toggle-server').addEventListener('click', () => {
    serverSettingBody.classList.toggle('hidden');
    if (!serverSettingBody.classList.contains('hidden')) {
      inputSignalUrlChannel.focus();
    }
  });

  document.getElementById('btn-save-url-channel').addEventListener('click', saveSignalUrl);
  inputSignalUrlChannel.addEventListener('keydown', e => { if (e.key === 'Enter') saveSignalUrl(); });

  function saveSignalUrl() {
    const url = inputSignalUrlChannel.value.trim();
    if (!url) return;
    localStorage.setItem('stormic_signal_url', url);
    urlSaveFeedback.textContent = 'Kaydedildi!';
    setTimeout(() => { urlSaveFeedback.textContent = ''; }, 2500);
    // Oda içi ayarlar panelindeki input'u da güncelle
    const inner = document.getElementById('input-signal-url');
    if (inner) inner.value = url;
  }
}

// Oda içi ayarlar paneli URL sync
const inputSignalUrl = document.getElementById('input-signal-url');
if (inputSignalUrl) {
  inputSignalUrl.value = getSignalUrl();
  document.getElementById('btn-save-url')?.addEventListener('click', () => {
    const url = inputSignalUrl.value.trim();
    if (!url) return;
    localStorage.setItem('stormic_signal_url', url);
    if (inputSignalUrlChannel) inputSignalUrlChannel.value = url;
    const btn = document.getElementById('btn-save-url');
    btn.textContent = 'Kaydedildi';
    setTimeout(() => { btn.textContent = 'Kaydet'; }, 2000);
  });
}

// ── Chat mesajları ────────────────────────────────────────────
const msgInput   = document.getElementById('msg-input');
const messagesEl = document.getElementById('messages');

document.getElementById('btn-send').addEventListener('click', sendChatMessage);
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });

function sendChatMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = '';
  broadcastControl({ type: 'chat', username: state.username, text });
  appendChatMessage(state.username, text, true);
}

function appendChatMessage(author, text, isSelf = false) {
  const time  = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const color = usernameColor(author);
  const div   = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `
    <div class="meta">
      <span class="name" style="color:${color}">${escapeHtml(author)}${isSelf ? ' <span class="self-tag">(sen)</span>' : ''}</span>
      <span class="time">${time}</span>
    </div>
    <div class="body">${escapeHtml(text)}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'message system';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Dosya transferi ───────────────────────────────────────────
function sendFiles(files) {
  for (const file of files) sendFile(file);
}

function sendFile(file) {
  const id = Math.random().toString(36).slice(2, 10);
  file.arrayBuffer().then(buffer => {
    const meta = JSON.stringify({ type: 'file-meta', id, name: file.name, size: file.size, mime: file.type });
    const done = JSON.stringify({ type: 'file-done', id });
    peers.forEach(({ dc }) => {
      if (dc?.readyState !== 'open') return;
      dc.send(meta);
      for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
        dc.send(buffer.slice(offset, offset + CHUNK_SIZE));
      }
      dc.send(done);
    });
    appendFileMessage(state.username, file.name, new Blob([buffer], { type: file.type }), true);
  });
}

function appendFileProgressMessage(author, filename, totalSize) {
  const time  = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const color = usernameColor(author);
  const div   = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `
    <div class="meta">
      <span class="name" style="color:${color}">${escapeHtml(author)}</span>
      <span class="time">${time}</span>
    </div>
    <div class="body">
      <div class="file-progress">
        <span class="file-progress-name">${escapeHtml(filename)}</span>
        <div class="file-progress-bar-wrap"><div class="file-progress-bar" style="width:0%"></div></div>
        <span class="file-progress-pct">0% — ${formatBytes(totalSize)}</span>
      </div>
    </div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function finalizeFileProgressMessage(msgEl, author, filename, blob) {
  if (!msgEl) { appendFileMessage(author, filename, blob); return; }
  const url     = URL.createObjectURL(blob);
  const isImage = blob.type.startsWith('image/');
  const bodyEl  = msgEl.querySelector('.body');
  if (!bodyEl) return;
  const content = isImage
    ? `<a href="${url}" target="_blank"><img src="${url}" class="file-image" alt="${escapeHtml(filename)}" /></a>`
    : `<a href="${url}" download="${escapeHtml(filename)}" class="file-download">
         <span class="file-icon">📄</span>
         <span class="file-info">
           <span class="file-name">${escapeHtml(filename)}</span>
           <span class="file-size">${formatBytes(blob.size)}</span>
         </span>
         <span class="file-dl">⬓</span>
       </a>`;
  bodyEl.innerHTML = content;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendFileMessage(author, filename, blob, isSelf = false) {
  const time    = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const color   = usernameColor(author);
  const url     = URL.createObjectURL(blob);
  const isImage = blob.type.startsWith('image/');
  const div     = document.createElement('div');
  div.className = 'message';

  const content = isImage
    ? `<a href="${url}" target="_blank"><img src="${url}" class="file-image" alt="${escapeHtml(filename)}" /></a>`
    : `<a href="${url}" download="${escapeHtml(filename)}" class="file-download">
         <span class="file-icon">📄</span>
         <span class="file-info">
           <span class="file-name">${escapeHtml(filename)}</span>
           <span class="file-size">${formatBytes(blob.size)}</span>
         </span>
         <span class="file-dl">⬓</span>
       </a>`;

  div.innerHTML = `
    <div class="meta">
      <span class="name" style="color:${color}">${escapeHtml(author)}${isSelf ? ' <span class="self-tag">(sen)</span>' : ''}</span>
      <span class="time">${time}</span>
    </div>
    <div class="body">${content}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

document.getElementById('file-input').addEventListener('change', e => {
  sendFiles(e.target.files);
  e.target.value = '';
});

// ── Emoji picker ──────────────────────────────────────────────
const EMOJIS = [
  '😀','😂','😍','🥹','😭','😤','🤔','😎','🤗','😴','🙄','😅',
  '👍','👎','❤️','🔥','💯','🎉','🙏','👋','✅','❌','💀','🫡',
  '🤝','💪','🎮','🚀','👀','🤣','😬','🥳','😇','🤯','😱','⚡',
];

const emojiPicker = document.getElementById('emoji-picker');
const btnEmoji    = document.getElementById('btn-emoji');

EMOJIS.forEach(emoji => {
  const btn = document.createElement('button');
  btn.className = 'emoji-btn';
  btn.textContent = emoji;
  btn.addEventListener('click', () => {
    const pos = msgInput.selectionStart ?? msgInput.value.length;
    const val = msgInput.value;
    msgInput.value = val.slice(0, pos) + emoji + val.slice(pos);
    msgInput.selectionStart = msgInput.selectionEnd = pos + emoji.length;
    msgInput.focus();
    emojiPicker.classList.add('hidden');
  });
  emojiPicker.appendChild(btn);
});

btnEmoji.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPicker.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!emojiPicker.classList.contains('hidden') &&
      !emojiPicker.contains(e.target) &&
      e.target !== btnEmoji) {
    emojiPicker.classList.add('hidden');
  }
});

const dropOverlay = document.getElementById('drop-overlay');
const roomScreen  = document.getElementById('screen-room');

roomScreen.addEventListener('dragover', e => { e.preventDefault(); dropOverlay.classList.add('visible'); });
dropOverlay.addEventListener('dragleave', () => dropOverlay.classList.remove('visible'));
dropOverlay.addEventListener('dragover',  e => e.preventDefault());
dropOverlay.addEventListener('drop', e => {
  e.preventDefault();
  dropOverlay.classList.remove('visible');
  sendFiles(e.dataTransfer.files);
});
