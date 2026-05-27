'use strict';

function getAudioConstraints() {
  const deviceId = localStorage.getItem('stormic_input_device') || '';
  const noise = localStorage.getItem('stormic_noise_suppression') !== 'false';
  const echo  = localStorage.getItem('stormic_echo_cancellation') !== 'false';
  const agc   = localStorage.getItem('stormic_agc') === 'true';
  const c = {
    noiseSuppression: noise,
    echoCancellation: echo,
    autoGainControl:  agc,
    sampleRate:   { ideal: 48000 }, // Opus için en uygun örnekleme hızı
    channelCount: { ideal: 1 },     // mono ses — bant genişliği daha verimli
    latency:      { ideal: 0.01 },  // 10 ms hedef gecikme
  };
  if (deviceId) c.deviceId = deviceId;
  return c;
}

function applyDeafState() {
  if (deafened) {
    remoteAudio.forEach((el, key) => {
      const gain = remoteGains.get(key);
      if (gain) {
        preDeafVolumes.set(key, gain.gain.value);
        gain.gain.value = 0;
      } else {
        preDeafVolumes.set(key, el.volume);
        el.volume = 0;
      }
    });
  } else {
    remoteAudio.forEach((el, key) => {
      const saved = preDeafVolumes.get(key) ?? (remoteVolumes.get(key) ?? 1);
      const gain = remoteGains.get(key);
      if (gain) {
        gain.gain.value = Math.max(0, saved);
      } else {
        el.volume = Math.max(0, Math.min(1, saved));
      }
    });
    preDeafVolumes.clear();
  }
}

function setDeafened(val) {
  deafened = val;
  playSound(deafened ? 'deaf-on' : 'deaf-off');
  if (deafened) {
    if (mic.mode !== 'off') {
      disableMic();
      btnMic.classList.remove('active');
      btnMic.textContent = '🔇 Mikrofon';
    }
    btnPtt.disabled = true;
    btnMic.disabled = true;
    btnDeaf.classList.add('deaf-active');
    btnDeaf.textContent = '🔕 Kulaklık';
    btnDeaf.title = 'Kulaklığı Aç';
  } else {
    btnPtt.disabled = false;
    btnMic.disabled = false;
    btnDeaf.classList.remove('deaf-active');
    btnDeaf.textContent = '🎧 Kulaklık';
    btnDeaf.title = 'Kulaklığı Kapat';
  }
  applyDeafState();
}

function setRemoteVolume(username, vol) {
  remoteVolumes.set(username, vol);
  if (deafened) return; // deaf modda gerçek sesi değiştirme, sadece kaydet
  const el = remoteAudio.get(username);
  if (!el) return;
  if (vol > 1) ensureGainNode(username, el);
  const gain = remoteGains.get(username);
  if (gain) {
    gain.gain.value = Math.max(0, vol);
  } else {
    el.volume = Math.max(0, Math.min(1, vol));
  }
}

// ── Mikrofon yönetimi ─────────────────────────────────────────
async function enableMic() {
  if (mic.stream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(), video: false });
    mic.stream = stream;
    mic.track  = stream.getAudioTracks()[0];
    mic.track.enabled = false; // başlangıçta kapalı

    peers.forEach((peerState) => {
      const { pc } = peerState;
      // Daha önce eklenmiş audio sender varsa replaceTrack kullan.
      // addTrack çağrılırsa her enable/disable döngüsünde yeni bir sender
      // eklenir → çift ses kanalı → renegotiation bozulması → ses gitmiyor.
      const existingSender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (existingSender) {
        existingSender.replaceTrack(mic.track);
      } else {
        const sender = pc.addTrack(mic.track, stream);
        setAudioCodecPreference(pc, sender); // Opus tercihini belirt
      }
    });

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

// Yeni bağlanan ses elementine kayıtlı çıkış aygıtını uygula
const _origRemoteAudioSet = remoteAudio.set.bind(remoteAudio);
remoteAudio.set = (key, el) => {
  const deviceId = localStorage.getItem('stormic_output_device') || '';
  if (deviceId && typeof el.setSinkId === 'function') {
    el.setSinkId(deviceId).catch(() => {});
  }
  return _origRemoteAudioSet(key, el);
};
