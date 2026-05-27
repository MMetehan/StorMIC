'use strict';

// ── Uygulama durumu ───────────────────────────────────────────
const state = {
  username:    null,
  channelCode: null,
  ws:          null,
};

// username -> { pc, dc, incoming, initiator, makingOffer, cameraSender, screenSender, screenAudioSender, disconnectTimer }
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

// username -> HTMLAudioElement (uzak ses)
const remoteAudio = new Map();

// username -> GainNode (100% üzeri ses için Web Audio zinciri)
const remoteGains = new Map();

// username -> 0-2 (2.0 = %200)
const remoteVolumes = new Map();

let _sharedAudioCtx = null;
function sharedAudioContext() {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
    _sharedAudioCtx = new AudioContext();
  }
  if (_sharedAudioCtx.state === 'suspended') _sharedAudioCtx.resume().catch(() => {});
  return _sharedAudioCtx;
}

function ensureGainNode(username, audioEl) {
  if (remoteGains.has(username)) return remoteGains.get(username);
  const ctx = sharedAudioContext();
  const src = ctx.createMediaElementSource(audioEl);
  const gain = ctx.createGain();
  gain.gain.value = Math.max(0, remoteVolumes.get(username) ?? 1);
  src.connect(gain);
  gain.connect(ctx.destination);
  audioEl.volume = 1;
  remoteGains.set(username, gain);
  return gain;
}

function cleanupRemoteGain(username) {
  const gain = remoteGains.get(username);
  if (gain) {
    try { gain.disconnect(); } catch {}
    remoteGains.delete(username);
  }
}

// ── Sağır modu (kulaklık kapalı) ─────────────────────────────
let deafened = false;
const preDeafVolumes = new Map(); // ses seviyeleri geri yüklemek için

// ── Yeniden bağlanma durumu ───────────────────────────────────
const reconn = { timer: null, attempts: 0 };

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
