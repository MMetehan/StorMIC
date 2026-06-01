'use strict';

// Versiyon numarasını titlebar'a yaz
const _vEl = document.getElementById('app-version');
if (_vEl && window.__STORMIC_VERSION__) _vEl.textContent = 'v' + window.__STORMIC_VERSION__;

// ── Ekran 1: Kullanıcı adı ────────────────────────────────────
const inputUsername = document.getElementById('input-username');

// Son kullanılan adı geri yükle
const _savedName = localStorage.getItem('stormic_username');
if (_savedName) inputUsername.value = _savedName;

function confirmUsername() {
  const name = inputUsername.value.trim();
  if (!name) return;
  state.username = name;
  localStorage.setItem('stormic_username', name);
  document.getElementById('welcome-text').textContent = `Merhaba, ${name}`;
  showScreen('screen-channel');
}

document.getElementById('btn-username-confirm').addEventListener('click', confirmUsername);
inputUsername.addEventListener('keydown', e => { if (e.key === 'Enter') confirmUsername(); });

document.getElementById('btn-edit-username').addEventListener('click', () => {
  showScreen('screen-username');
  inputUsername.select();
  inputUsername.focus();
});

// ── Ekran 2: Kanal oluştur / katıl ───────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  joinIntent = 'create';
  const code = randomCode();
  state.channelCode = code;
  document.getElementById('created-code').textContent = code;
  document.getElementById('copy-feedback').textContent = '';
  showScreen('screen-created');
});

document.getElementById('btn-copy').addEventListener('click', () => {
  copyToClipboard(state.channelCode, document.getElementById('copy-feedback'));
});

document.getElementById('btn-enter-channel').addEventListener('click', enterRoom);

const inputCode = document.getElementById('input-code');
inputCode.addEventListener('input', () => { inputCode.value = inputCode.value.toUpperCase(); });
document.getElementById('btn-join').addEventListener('click', () => {
  const code = inputCode.value.trim();
  if (code.length !== 6) return;
  joinIntent = 'join';
  state.channelCode = code;
  enterRoom();
});
inputCode.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});
