'use strict';

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
  // Eski peer bağlantılarını temizle (bekleyen zamanlayıcıları da iptal et)
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
  preDeafVolumes.clear();
  [...videoTiles.keys()].filter(id => id.startsWith('remote-')).forEach(removeVideoTile);
  document.getElementById('participants-list').innerHTML = '';
  // Yeniden bağlan
  connectSignaling();
}

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

    // Kanala ilk katılımda mikrofonu otomatik aç
    if (!deafened && mic.mode === 'off') {
      enableMic().then(ok => {
        if (!ok) return;
        mic.mode = 'open';
        setMicEnabled(true);
        btnMic.classList.add('active');
        btnMic.textContent = '🎙️ Mikrofon';
      });
    }
  });

  ws.addEventListener('message', ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
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
          if (leftPeer.disconnectTimer) { clearTimeout(leftPeer.disconnectTimer); leftPeer.disconnectTimer = null; }
          leftPeer.pc.close();
          peers.delete(msg.username);
        }
        const leftAudioEl = remoteAudio.get(msg.username);
        if (leftAudioEl) { leftAudioEl.srcObject = null; leftAudioEl.remove(); }
        remoteAudio.delete(msg.username);
        const leftScreenKey = `${msg.username}-screen`;
        const leftScreenEl = remoteAudio.get(leftScreenKey);
        if (leftScreenEl) { leftScreenEl.srcObject = null; }
        remoteAudio.delete(leftScreenKey);
        remoteVolumes.delete(msg.username);
        cleanupRemoteGain(msg.username);
        // BUG-02 & BUG-03: Ekran sesi GainNode + volume temizliği
        cleanupScreenGainNode(leftScreenKey);
        remoteScreenVolumes.delete(leftScreenKey);
        updateScreenAudioVol();
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
          USERNAME_TAKEN:    'Bu kullanıcı adı kanalda zaten kullanımda.',
          CHANNEL_FULL:      'Kanal dolu, başka bir kanal dene.',
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
