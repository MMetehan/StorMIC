'use strict';

// ── Sabitler ──────────────────────────────────────────────────
const DEFAULT_SIGNAL_URL = window.__STORMIC_SIGNAL_URL__ || window.electron?.signalUrl || '';
const CHUNK_SIZE = 16384; // 16 KB

function getSignalUrl() {
  return localStorage.getItem('stormic_signal_url') || DEFAULT_SIGNAL_URL;
}

// RTC_CONFIG — sunucudan güncel ICE yapılandırması yüklenmeden önce kullanılan varsayılan
let RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turns:openrelay.metered.ca:443',
      ],
      username:   'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 4,    // önceden toplanacak aday sayısını sınırla
  rtcpMuxPolicy:        'require',
  // bundlePolicy kasıtlı olarak varsayılanda bırakıldı ('balanced').
  // 'max-bundle' tek DTLS tüneline bağlar; ICE restart/renegotiaton
  // sırasında SRTP context kalıcı bozulmasına yol açar.
};

/**
 * Sinyal sunucusundan güncel ICE yapılandırmasını çek ve RTC_CONFIG'i güncelle.
 * Sunucu yanıt vermezse sessizce geçilir (varsayılan config kullanılır).
 */
async function loadRtcConfig(signalUrl) {
  if (!signalUrl) return;
  try {
    const httpUrl = signalUrl.replace(/^wss?:/, m => m === 'wss:' ? 'https:' : 'http:');
    const origin  = new URL(httpUrl).origin;
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${origin}/config`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const cfg = await res.json();
      // BUG-16: İçerik doğrulaması — her sunucuda urls alanı olmalı
      if (Array.isArray(cfg?.iceServers) && cfg.iceServers.length &&
          cfg.iceServers.every(s => s && (Array.isArray(s.urls) ? s.urls.length : s.urls))) {
        RTC_CONFIG = { ...RTC_CONFIG, iceServers: cfg.iceServers };
      }
    }
  } catch { /* sunucu erişilemez veya timeout — varsayılan config korunur */ }
}
