'use strict';

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
const btnDeaf   = document.getElementById('btn-deaf');

function resetControlButtons() {
  [btnPtt, btnMic, btnCam, btnScreen].forEach(b => b.classList.remove('active', 'ptt-active'));
  btnPtt.disabled = false;
  btnMic.disabled = false;
  btnDeaf.classList.remove('deaf-active');
  btnDeaf.textContent = '🎧 Kulaklık';
  btnDeaf.title = 'Kulaklığı Kapat';
}

// Mikrofon toggle (açık mikrofon modu)
btnMic.addEventListener('click', async () => {
  if (deafened) return;
  if (mic.mode === 'open') {
    disableMic();
    btnMic.classList.remove('active');
    btnMic.textContent = '🔇 Mikrofon';
    mic.mode = 'off';
    playSound('mic-off');
  } else {
    // PTT stream'i zaten açıksa tekrar getUserMedia çağırmaya gerek yok
    if (!mic.stream) {
      const ok = await enableMic();
      if (!ok) return;
      // Async bekleyiş sırasında kullanıcı sağırlaşmış olabilir
      if (deafened) return;
    }
    mic.mode = 'open';
    setMicEnabled(true);
    btnMic.classList.add('active');
    btnMic.textContent = '🎙️ Mikrofon';
    playSound('mic-on');
  }
});

// PTT aktifleştir / bırak
async function activatePtt() {
  if (rebindTarget || deafened) return;
  if (mic.mode === 'open') return;
  if (!mic.stream) {
    const ok = await enableMic();
    if (!ok) return;
    // Async bekleyiş sırasında durum değişmiş olabilir (örn. kullanıcı sağırlaştı)
    if (mic.mode !== 'off' || deafened) return;
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

// Kulaklık toggle
btnDeaf.addEventListener('click', () => setDeafened(!deafened));

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
    if (!deafened) { e.preventDefault(); btnMic.click(); }
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

// Başlangıçta tuş adlarını göster
updatePttKeyDisplay();
updateMicKeyDisplay();
