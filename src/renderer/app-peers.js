'use strict';

// ── Codec tercihleri ──────────────────────────────────────────
// VP9: ekran paylaşımı ve kamera için H.264'ten daha iyi sıkıştırma
// Opus: ses için standart; bu fonksiyon tercih sırasını açıkça belirtir
function setVideoCodecPreference(pc, sender) {
  if (typeof RTCRtpSender.getCapabilities !== 'function') return;
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
  const ordered = [
    ...codecs.filter(c => c.mimeType === 'video/VP9'),
    ...codecs.filter(c => c.mimeType === 'video/H264'),
    ...codecs.filter(c => c.mimeType !== 'video/VP9' && c.mimeType !== 'video/H264'),
  ];
  if (!ordered.length) return;
  const transceiver = pc.getTransceivers().find(t => t.sender === sender);
  if (transceiver) try { transceiver.setCodecPreferences(ordered); } catch {}
}

function setAudioCodecPreference(pc, sender) {
  if (typeof RTCRtpSender.getCapabilities !== 'function') return;
  const codecs = RTCRtpSender.getCapabilities('audio')?.codecs ?? [];
  const ordered = [
    ...codecs.filter(c => c.mimeType === 'audio/opus'),
    ...codecs.filter(c => c.mimeType !== 'audio/opus'),
  ];
  if (!ordered.length) return;
  const transceiver = pc.getTransceivers().find(t => t.sender === sender);
  if (transceiver) try { transceiver.setCodecPreferences(ordered); } catch {}
}

// ── WebRTC peer bağlantısı ────────────────────────────────────
function createPeerConnection(remoteUsername, initiator) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const peerState = {
    pc, dc: null, incoming: null, initiator, makingOffer: false,
    cameraSender: null, screenSender: null, screenAudioSender: null,
    disconnectTimer: null,
  };
  peers.set(remoteUsername, peerState);

  // Mevcut track'leri ekle (sender referanslarını sakla — replaceTrack için)
  // Her track için codec tercihi de hemen ayarlanır (offer oluşmadan önce geçerli olur)
  if (mic.track && mic.stream) {
    const s = pc.addTrack(mic.track, mic.stream);
    setAudioCodecPreference(pc, s);
  }
  if (vid.cameraTrack && vid.cameraStream) {
    peerState.cameraSender = pc.addTrack(vid.cameraTrack, vid.cameraStream);
    setVideoCodecPreference(pc, peerState.cameraSender);
  }
  if (vid.screenTrack && vid.screenStream) {
    peerState.screenSender = pc.addTrack(vid.screenTrack, vid.screenStream);
    setVideoCodecPreference(pc, peerState.screenSender);
  }
  if (vid.screenAudioTrack && vid.screenStream) {
    peerState.screenAudioSender = pc.addTrack(vid.screenAudioTrack, vid.screenStream);
  }

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
    if (s === 'connected') {
      // Ekran paylaşımı bitrate'i (adaptif — updatePeerStats tarafından da yönetilir)
      if (peerState.screenSender) applyBitrate(peerState.screenSender, screenMaxBps());
      // Kamera bitrate'i — çözünürlüğe göre hedef
      if (peerState.cameraSender) applyBitrate(peerState.cameraSender, cameraMaxBps());
      // Ses bitrate'i — Opus 128 kbps (ses kalitesi için yeterli)
      const audioSender = pc.getSenders().find(se => se.track?.kind === 'audio');
      if (audioSender) applyBitrate(audioSender, 128_000);
    }
    if (s === 'failed') {
      // ICE yeniden başlatmayı dene
      if (!peerState.iceRestarted && peerState.initiator) {
        peerState.iceRestarted = true;
        pc.restartIce();
        return;
      }
      cleanupPeer(remoteUsername);
    } else if (s === 'closed') {
      cleanupPeer(remoteUsername);
    } else if (s === 'disconnected') {
      // Disconnected geçici olabilir (ağ geçişi vb.) — 6 sn bekle
      if (!peerState.disconnectTimer) {
        peerState.disconnectTimer = setTimeout(() => {
          peerState.disconnectTimer = null;
          if (pc.connectionState === 'disconnected') cleanupPeer(remoteUsername);
        }, 6000);
      }
    } else if (peerState.disconnectTimer) {
      // Bağlantı kurtarıldı — zamanlayıcıyı iptal et
      clearTimeout(peerState.disconnectTimer);
      peerState.disconnectTimer = null;
    }
  };

  function cleanupPeer(username) {
    if (!peers.has(username)) return;
    const ps = peers.get(username);
    // Bekleyen zamanlayıcıları temizle
    if (ps.disconnectTimer) { clearTimeout(ps.disconnectTimer); ps.disconnectTimer = null; }
    ps.pc.close();
    peers.delete(username);
    removeParticipant(username);
    cleanupRemoteGain(username);
    const audioEl = remoteAudio.get(username);
    if (audioEl) { audioEl.srcObject = null; audioEl.remove(); }
    remoteAudio.delete(username);
    const screenKey = `${username}-screen`;
    const screenEl = remoteAudio.get(screenKey);
    if (screenEl) { screenEl.srcObject = null; }
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
        const storedVol = remoteVolumes.get(remoteUsername) ?? 1;
        audioEl.volume = deafened ? 0 : Math.min(1, storedVol);
        remoteAudio.set(remoteUsername, audioEl);
        audioEl.srcObject = stream;
        if (!deafened && storedVol > 1) ensureGainNode(remoteUsername, audioEl);
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
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'signal', to, data }));
  }
}

function handleSignal({ from, data }) {
  switch (data.type) {
    case 'offer': {
      if (!peers.has(from)) createPeerConnection(from, false);
      const peer = peers.get(from);
      const { pc } = peer;

      // Çakışma kontrolü: initiator (impolite) → gelen offer'ı yoksay
      const collision = peer.makingOffer || pc.signalingState !== 'stable';
      if (collision && peer.initiator) return;

      // Non-initiator (polite) → çakışmada kendi offer'ımızı geri çek, gelen offer'ı işle
      (async () => {
        try {
          if (collision) {
            try { await pc.setLocalDescription({ type: 'rollback' }); } catch {}
            peer.makingOffer = false;
          }
          await pc.setRemoteDescription(data.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(from, { type: 'answer', sdp: pc.localDescription });
        } catch {}
      })();
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
    case 'chat-gif':
      appendGifMessage(msg.username, msg.url);
      break;
    case 'chat-kura':
      appendKuraMessage(msg.username, msg.choices, msg.winners);
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
      updateScreenAudioVol();
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

// ── Bağlantı kalitesi + adaptif bitrate ───────────────────────
async function updatePeerStats() {
  for (const [username, peerState] of peers) {
    const { pc } = peerState;
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
        const screenSender = peerState.screenSender;
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
let _peerStatsTimer = null;

function startPeerStats() {
  if (_peerStatsTimer) return;
  _peerStatsTimer = setInterval(updatePeerStats, 4000);
}

function stopPeerStats() {
  if (_peerStatsTimer) { clearInterval(_peerStatsTimer); _peerStatsTimer = null; }
}

startPeerStats();
