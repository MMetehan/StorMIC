'use strict';

// ── Volume popover ────────────────────────────────────────────
const volumePopover    = document.getElementById('volume-popover');
const volumePopoverName = document.getElementById('volume-popover-name');
const volumeSlider     = document.getElementById('volume-slider');
const volumeVal        = document.getElementById('volume-val');
const btnVolumeMute    = document.getElementById('btn-volume-mute');
let   volumePopoverTarget = null;

// Kalıcı ses seviyeleri: stormic_vol_<username> → 0-2 (localStorage)
function loadPersistedVolume(username) {
  const v = parseFloat(localStorage.getItem('stormic_vol_' + username));
  return isNaN(v) ? 1 : Math.max(0, Math.min(2, v));
}
function persistVolume(username, vol) {
  localStorage.setItem('stormic_vol_' + username, vol);
}

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
  if (volumePopoverTarget) {
    setRemoteVolume(volumePopoverTarget, vol);
    persistVolume(volumePopoverTarget, vol);
  }
});

btnVolumeMute.addEventListener('click', () => {
  const isMuted = Number(volumeSlider.value) === 0;
  const newVol = isMuted ? 100 : 0;
  volumeSlider.value = newVol;
  volumeVal.textContent = newVol + '%';
  btnVolumeMute.textContent = newVol === 0 ? 'Sesi Aç' : 'Sustur';
  btnVolumeMute.classList.toggle('active', newVol === 0);
  if (volumePopoverTarget) {
    setRemoteVolume(volumePopoverTarget, newVol / 100);
    persistVolume(volumePopoverTarget, newVol / 100);
  }
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
    // Kaydedilmiş ses seviyesini yükle
    const savedVol = loadPersistedVolume(username);
    if (savedVol !== 1) {
      remoteVolumes.set(username, savedVol);
    }
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

// ── Ortak peer/ses temizleme ──────────────────────────────────
function cleanupAllPeers() {
  peers.forEach((peerState) => {
    if (peerState.disconnectTimer) clearTimeout(peerState.disconnectTimer);
    peerState.pc.close();
  });
  peers.clear();
  remoteAudio.forEach(el => { el.srcObject = null; });
  remoteAudio.clear();
  remoteGains.forEach(g => { try { g.disconnect(); } catch {} });
  remoteGains.clear();
  remoteScreenGains.forEach(g => { try { g.disconnect(); } catch {} });
  remoteScreenGains.clear();
  remoteScreenVolumes.clear();
  preDeafVolumes.clear();
  [...videoTiles.keys()].filter(id => id.startsWith('remote-')).forEach(removeVideoTile);
  document.getElementById('participants-list').innerHTML = '';
}

// ── Oda ───────────────────────────────────────────────────────
function enterRoom() {
  document.getElementById('room-code-display').textContent = state.channelCode;
  document.getElementById('participants-list').innerHTML = '';
  document.getElementById('messages').innerHTML = '';
  showScreen('screen-room');
  startPeerStats();
  loadRtcConfig(getSignalUrl()); // fire-and-forget: peer bağlantısı kurulmadan önce büyük ihtimalle tamamlanır
  connectSignaling();
}

function leaveRoom() {
  if (reconn.timer) { clearTimeout(reconn.timer); reconn.timer = null; }
  reconn.attempts = 0;
  stopPeerStats();
  deafened = false;
  disableMic();
  disableCamera();
  disableScreenShare();
  cleanupAllPeers();
  hideMentionPopup();
  [...videoTiles.keys()].forEach(removeVideoTile);
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.channelCode = null;
  setConnStatus('idle');
  resetControlButtons();
  showScreen('screen-channel');
}

// ── Çıkış onayı overlay ───────────────────────────────────────
const leaveConfirmOverlay = document.getElementById('leave-confirm-overlay');

document.getElementById('btn-leave').addEventListener('click', () => {
  leaveConfirmOverlay.classList.remove('hidden');
});
document.getElementById('btn-leave-cancel').addEventListener('click', () => {
  leaveConfirmOverlay.classList.add('hidden');
});
document.getElementById('btn-leave-confirm').addEventListener('click', () => {
  leaveConfirmOverlay.classList.add('hidden');
  leaveRoom();
});

document.getElementById('btn-copy-room-code').addEventListener('click', () => {
  copyToClipboard(state.channelCode, null);
});
