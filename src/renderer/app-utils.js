'use strict';

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
    const t = ctx.currentTime;
    if (type === 'join') {
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.frequency.setValueAtTime(820, t);
      osc.frequency.setValueAtTime(1040, t + 0.12);
      osc.start(t); osc.stop(t + 0.35);
    } else if (type === 'leave') {
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.frequency.setValueAtTime(1040, t);
      osc.frequency.setValueAtTime(700, t + 0.14);
      osc.start(t); osc.stop(t + 0.35);
    } else if (type === 'mic-on') {
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.frequency.setValueAtTime(600, t);
      osc.frequency.setValueAtTime(900, t + 0.14);
      osc.start(t); osc.stop(t + 0.2);
    } else if (type === 'mic-off') {
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.frequency.setValueAtTime(900, t);
      osc.frequency.setValueAtTime(500, t + 0.14);
      osc.start(t); osc.stop(t + 0.2);
    } else if (type === 'deaf-on') {
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.setValueAtTime(440, t + 0.08);
      osc.frequency.setValueAtTime(580, t + 0.14);
      osc.frequency.setValueAtTime(360, t + 0.22);
      osc.start(t); osc.stop(t + 0.28);
    } else if (type === 'deaf-off') {
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.setValueAtTime(660, t + 0.08);
      osc.frequency.setValueAtTime(520, t + 0.14);
      osc.frequency.setValueAtTime(760, t + 0.22);
      osc.start(t); osc.stop(t + 0.28);
    } else if (type === 'mention') {
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.frequency.setValueAtTime(1200, t);
      osc.frequency.setValueAtTime(1600, t + 0.06);
      osc.frequency.setValueAtTime(1200, t + 0.18);
      osc.start(t); osc.stop(t + 0.4);
    }
    osc.onended = () => ctx.close();
  } catch {}
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function copyToClipboard(text, feedbackEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (!feedbackEl) return;
    feedbackEl.textContent = 'Kopyalandı!';
    setTimeout(() => { feedbackEl.textContent = ''; }, 2000);
  });
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Ekran geçişleri ───────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
