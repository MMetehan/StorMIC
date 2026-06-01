'use strict';

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

// ── Oda ───────────────────────────────────────────────────────
async function enterRoom() {
  document.getElementById('room-code-display').textContent = state.channelCode;
  document.getElementById('participants-list').innerHTML = '';
  document.getElementById('messages').innerHTML = '';
  showScreen('screen-room');
  startPeerStats();
  // Sinyal sunucusundan güncel ICE yapılandırmasını al (TURN kimlik bilgileri dahil)
  await loadRtcConfig(getSignalUrl());
  connectSignaling();
}

function leaveRoom() {
  if (reconn.timer) { clearTimeout(reconn.timer); reconn.timer = null; }
  reconn.attempts = 0;
  stopPeerStats();
  deafened = false;
  preDeafVolumes.clear();
  disableMic();
  disableCamera();
  disableScreenShare();
  peers.forEach((peerState) => {
    if (peerState.disconnectTimer) clearTimeout(peerState.disconnectTimer);
    peerState.pc.close();
  });
  peers.clear();
  remoteAudio.forEach(el => { el.srcObject = null; });
  remoteAudio.clear();
  remoteGains.forEach(g => { try { g.disconnect(); } catch {} });
  remoteGains.clear();
  // BUG-02 & BUG-03: Ekran sesi GainNode ve volume map temizliği
  remoteScreenGains.forEach(g => { try { g.disconnect(); } catch {} });
  remoteScreenGains.clear();
  remoteScreenVolumes.clear();
  // BUG-17: Mention popup'ı sıfırla
  hideMentionPopup();
  [...videoTiles.keys()].forEach(removeVideoTile);
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.channelCode = null;
  setConnStatus('idle');
  resetControlButtons();
  showScreen('screen-channel');
}

document.getElementById('btn-copy-room-code').addEventListener('click', () => {
  copyToClipboard(state.channelCode, null);
});

document.getElementById('btn-leave').addEventListener('click', leaveRoom);
