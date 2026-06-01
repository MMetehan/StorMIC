'use strict';

// ── Video tile yönetimi ───────────────────────────────────────
const videoArea      = document.getElementById('video-area');
const spotlightVideo = document.getElementById('spotlight-video');
const spotlightLabel = document.getElementById('spotlight-label');
const videoStrip     = document.getElementById('video-strip');
let   activeSpotlightId = null;

// ── Kontrol butonları (video bağımlı) ─────────────────────────
const btnCam    = document.getElementById('btn-cam');
const btnScreen = document.getElementById('btn-screen');

// ── Ekran paylaşımı ───────────────────────────────────────────
const screenWrap    = document.getElementById('screen-wrap');
const screenOptions = document.getElementById('screen-options');
const btnStartScreen = document.getElementById('btn-start-screen');

let screenCfg = { width: 1280, height: 720, fps: 30, audio: false };
let localCameraMirrored = false;
const btnMirror = document.getElementById('btn-mirror');

// ── Kamera yapılandırması ─────────────────────────────────────
function getCameraConfig() {
  return {
    width:  Number(localStorage.getItem('stormic_cam_width'))  || 1280,
    height: Number(localStorage.getItem('stormic_cam_height')) || 720,
    fps:    Number(localStorage.getItem('stormic_cam_fps'))    || 30,
  };
}

// ── Bitrate yardımcıları ──────────────────────────────────────
function screenMaxBps() {
  // Yüksek FPS'de daha fazla bant genişliği gerekir
  const fpsMul = screenCfg.fps >= 100 ? 2.5 : screenCfg.fps >= 60 ? 1.5 : 1;
  let base;
  if (screenCfg.width >= 1920) base = 8_000_000;
  else if (screenCfg.width >= 1280) base = 4_000_000;
  else base = 2_000_000;
  return Math.round(base * fpsMul);
}

function cameraMaxBps() {
  const { width } = getCameraConfig();
  if (width >= 1920) return 4_000_000; // 1080p → 4 Mbps
  if (width >= 1280) return 2_000_000; // 720p  → 2 Mbps
  return 1_000_000;                    // 480p  → 1 Mbps
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
  // Kaydedilmiş ses seviyesini uygula
  const savedVol = remoteScreenVolumes.get(screenKey) ?? 1;
  if (deafened) {
    audioEl.volume = 0;
  } else if (savedVol > 1) {
    ensureScreenGainNode(screenKey, audioEl);
  } else {
    audioEl.volume = Math.max(0, Math.min(1, savedVol));
  }
  updateScreenAudioVol();
  updateStreamVolOverlay();
  pending.track.onended = () => {
    if (remoteAudio.get(screenKey) === audioEl) {
      audioEl.srcObject = null;
      remoteAudio.delete(screenKey);
      cleanupScreenGainNode(screenKey);
      updateScreenAudioVol();
      updateStreamVolOverlay();
    }
  };
}

// ── Kamera ────────────────────────────────────────────────────
function buildCameraConstraints() {
  const { width, height, fps } = getCameraConfig();
  return {
    video: {
      width:       { ideal: width },
      height:      { ideal: height },
      frameRate:   { ideal: fps },
      aspectRatio: { ideal: 16 / 9 },
    },
    audio: false,
  };
}

async function restartCameraWithCurrentSettings() {
  if (!vid.cameraStream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(buildCameraConstraints());
    const newTrack = stream.getVideoTracks()[0];
    peers.forEach((peerState) => {
      if (peerState.cameraSender) peerState.cameraSender.replaceTrack(newTrack).catch(() => {});
    });
    vid.cameraStream.getTracks().forEach(t => t.stop());
    vid.cameraStream = stream;
    vid.cameraTrack  = newTrack;
    const tile = videoTiles.get('local-camera');
    if (tile) tile.stream = stream;
    const tileVideo = videoTiles.get('local-camera')?.el?.querySelector('video');
    if (tileVideo) tileVideo.srcObject = stream;
    if (activeSpotlightId === 'local-camera') spotlightVideo.srcObject = stream;
    newTrack.onended = () => { disableCamera(); btnCam.classList.remove('active'); };
  } catch {
    appendSystemMessage('Kamera yeniden başlatılamadı.');
  }
}

async function enableCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(buildCameraConstraints());
    vid.cameraStream = stream;
    vid.cameraTrack  = stream.getVideoTracks()[0];

    peers.forEach((peerState) => {
      if (peerState.cameraSender) {
        peerState.cameraSender.replaceTrack(vid.cameraTrack).catch(() => {});
      } else {
        peerState.cameraSender = peerState.pc.addTrack(vid.cameraTrack, stream);
        setVideoCodecPreference(peerState.pc, peerState.cameraSender);
      }
    });
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
  // Sender'ı kaldır ve null'a çek: tekrar açılınca addTrack() kullanılsın.
  // replaceTrack() karşı tarafta ontrack tetiklemez → 2. açılışta tile oluşmaz.
  peers.forEach((peerState) => {
    if (peerState.cameraSender) {
      try { peerState.pc.removeTrack(peerState.cameraSender); } catch {}
      peerState.cameraSender = null;
    }
  });
  vid.cameraStream.getTracks().forEach(t => t.stop());
  vid.cameraStream = null;
  vid.cameraTrack  = null;
  removeVideoTile('local-camera');
  broadcastControl({ type: 'video-stop', kind: 'camera' });
}

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
      const screenSources = sources.filter(s => s.id.startsWith('screen:'));
      sources.forEach(src => {
        const card = document.createElement('div');
        card.className = 'source-card';
        const isScreen = src.id.startsWith('screen:');
        const label = isScreen
          ? (screenSources.length > 1 ? `Tüm Ekran ${screenSources.indexOf(src) + 1}` : 'Tüm Ekran')
          : src.name;
        card.innerHTML = `<img src="${src.thumbnail}" /><div class="source-card-name">${escapeHtml(label)}</div>`;
        card.addEventListener('click', () => {
          grid.querySelectorAll('.source-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          selectedId = src.id;
          btnOk.disabled = false;
        });
        grid.appendChild(card);
      });
      modal.classList.remove('hidden');
    }).catch(() => { cleanup(); resolve(null); });

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

    peers.forEach((peerState) => {
      const { pc } = peerState;
      if (peerState.screenSender) {
        peerState.screenSender.replaceTrack(vid.screenTrack).catch(() => {});
      } else {
        peerState.screenSender = pc.addTrack(vid.screenTrack, stream);
        setVideoCodecPreference(pc, peerState.screenSender);
      }
      if (vid.screenAudioTrack) {
        if (peerState.screenAudioSender) {
          peerState.screenAudioSender.replaceTrack(vid.screenAudioTrack).catch(() => {});
        } else {
          peerState.screenAudioSender = pc.addTrack(vid.screenAudioTrack, stream);
        }
      }
    });
    broadcastControl({ type: 'video-track', trackId: vid.screenTrack.id, kind: 'screen' });
    if (vid.screenAudioTrack) {
      broadcastControl({ type: 'screen-audio-track', trackId: vid.screenAudioTrack.id });
    }

    // Bağlı peer'lara bitrate uygula
    const maxBps = screenMaxBps();
    peers.forEach((peerState) => {
      if (peerState.screenSender) applyBitrate(peerState.screenSender, maxBps);
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
  // Sender'ları kaldır ve null'a çek: tekrar açılınca addTrack() kullanılsın.
  // replaceTrack() karşı tarafta ontrack tetiklemez → 2. açılışta yayın görünmez.
  peers.forEach((peerState) => {
    if (peerState.screenSender) {
      try { peerState.pc.removeTrack(peerState.screenSender); } catch {}
      peerState.screenSender = null;
    }
    if (peerState.screenAudioSender) {
      try { peerState.pc.removeTrack(peerState.screenAudioSender); } catch {}
      peerState.screenAudioSender = null;
    }
  });
  vid.screenStream.getTracks().forEach(t => t.stop());
  vid.screenStream     = null;
  vid.screenTrack      = null;
  vid.screenAudioTrack = null;
  removeVideoTile('local-screen');
  broadcastControl({ type: 'video-stop', kind: 'screen' });
  if (hadAudio) broadcastControl({ type: 'screen-audio-stop' });
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
    updateStreamVolOverlay();
  } else if (activeSpotlightId === id) {
    setSpotlight(videoTiles.keys().next().value);
  }
  updateStripVisibility();
}

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
  updateScreenAudioVol();
  updateStreamVolOverlay();
}

function updateStripVisibility() {
  videoStrip.classList.toggle('visible', videoTiles.size > 1);
}

function updateScreenAudioVol() {
  const volBar = document.getElementById('screen-audio-vol');
  if (!volBar) return;
  // activeSpotlightId: "remote-{username}-screen" → screenKey: "{username}-screen"
  const isRemoteScreen = activeSpotlightId?.startsWith('remote-') && activeSpotlightId?.endsWith('-screen');
  const screenKey = isRemoteScreen ? activeSpotlightId.slice('remote-'.length) : null;
  volBar.classList.toggle('hidden', !isRemoteScreen);
  if (isRemoteScreen && screenKey) {
    const vol = remoteScreenVolumes.get(screenKey) ?? 1;
    const pct = Math.round(vol * 100);
    document.getElementById('screen-audio-range').value = Math.min(200, pct);
    document.getElementById('screen-audio-val').textContent = `${pct}%`;
  }
}

// ── Yayın ses seviyesi overlay (hover, küçük ekran) ──────────
function updateStreamVolOverlay() {
  const overlay = document.getElementById('stream-vol-overlay');
  if (!overlay) return;
  // Yalnızca uzak ekran paylaşımlarında göster (kamera değil)
  const isRemoteScreen = activeSpotlightId?.startsWith('remote-') && activeSpotlightId?.endsWith('-screen');
  overlay.classList.toggle('hidden', !isRemoteScreen);
  if (isRemoteScreen) {
    const screenKey = activeSpotlightId.slice('remote-'.length);
    const vol = remoteScreenVolumes.get(screenKey) ?? 1;
    const pct = Math.round(vol * 100);
    const range = document.getElementById('stream-vol-range');
    const val   = document.getElementById('stream-vol-val');
    if (range) range.value = Math.min(200, pct);
    if (val)   val.textContent = pct + '%';
  }
}

// ── Event listeners ───────────────────────────────────────────
btnCam.addEventListener('click', async () => {
  if (vid.cameraStream) {
    disableCamera();
    btnCam.classList.remove('active');
  } else {
    const ok = await enableCamera();
    if (ok) btnCam.classList.add('active');
  }
});

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

function toggleFullscreen() {
  const el = document.getElementById('video-spotlight');
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.getElementById('video-spotlight').addEventListener('dblclick', toggleFullscreen);

// Tam ekran ses slider (içeride, fullscreen'da görünür)
document.getElementById('screen-audio-range').addEventListener('input', function () {
  const pct = parseInt(this.value, 10);
  document.getElementById('screen-audio-val').textContent = `${pct}%`;
  // Hover overlay ile senkronize et
  const rangeHover = document.getElementById('stream-vol-range');
  const valHover   = document.getElementById('stream-vol-val');
  if (rangeHover) rangeHover.value = pct;
  if (valHover)   valHover.textContent = pct + '%';
  const isRemoteScreen = activeSpotlightId?.startsWith('remote-') && activeSpotlightId?.endsWith('-screen');
  if (isRemoteScreen) {
    setScreenAudioVolume(activeSpotlightId.slice('remote-'.length), pct / 100);
  }
});

// Hover overlay ses slider (küçük ekranda görünür)
document.getElementById('stream-vol-range')?.addEventListener('input', function () {
  const pct = Number(this.value);
  const valEl = document.getElementById('stream-vol-val');
  if (valEl) valEl.textContent = pct + '%';
  // Tam ekran slider ile senkronize et
  const rangeFull = document.getElementById('screen-audio-range');
  const valFull   = document.getElementById('screen-audio-val');
  if (rangeFull) rangeFull.value = pct;
  if (valFull)   valFull.textContent = pct + '%';
  const isRemoteScreen = activeSpotlightId?.startsWith('remote-') && activeSpotlightId?.endsWith('-screen');
  if (isRemoteScreen) {
    setScreenAudioVolume(activeSpotlightId.slice('remote-'.length), pct / 100);
  }
});

btnMirror.addEventListener('click', () => {
  localCameraMirrored = !localCameraMirrored;
  spotlightVideo.style.transform = localCameraMirrored ? 'scaleX(-1)' : '';
  btnMirror.classList.toggle('active', localCameraMirrored);
});
