'use strict';

// ── Dosya transferi ───────────────────────────────────────────
const SEND_BUFFER_HIGH = 256 * 1024; // 256 KB — akış kontrolü eşiği
const SEND_BUFFER_LOW  =  64 * 1024; // 64 KB  — devam eşiği

async function sendChunked(dc, buffer, done) {
  for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
    if (dc.readyState !== 'open') return;
    // Tamponu taşıyorsa boşalmasını bekle (backpressure)
    if (dc.bufferedAmount > SEND_BUFFER_HIGH) {
      await new Promise(resolve => {
        dc.bufferedAmountLowThreshold = SEND_BUFFER_LOW;
        dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; resolve(); };
      });
      if (dc.readyState !== 'open') return;
    }
    dc.send(buffer.slice(offset, offset + CHUNK_SIZE));
  }
  if (dc.readyState === 'open') dc.send(done);
}

function sendFiles(files) {
  for (const file of files) sendFile(file);
}

function sendFile(file) {
  const id = Math.random().toString(36).slice(2, 10);
  file.arrayBuffer().then(buffer => {
    const meta = JSON.stringify({ type: 'file-meta', id, name: file.name, size: file.size, mime: file.type });
    const done = JSON.stringify({ type: 'file-done', id });
    peers.forEach(({ dc }) => {
      if (dc?.readyState !== 'open') return;
      dc.send(meta);
      sendChunked(dc, buffer, done);
    });
    appendFileMessage(state.username, file.name, new Blob([buffer], { type: file.type }), true);
  });
}

function appendFileProgressMessage(author, filename, totalSize) {
  const time  = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const color = usernameColor(author);
  const div   = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `
    <div class="meta">
      <span class="name" style="color:${color}">${escapeHtml(author)}</span>
      <span class="time">${time}</span>
    </div>
    <div class="body">
      <div class="file-progress">
        <span class="file-progress-name">${escapeHtml(filename)}</span>
        <div class="file-progress-bar-wrap"><div class="file-progress-bar" style="width:0%"></div></div>
        <span class="file-progress-pct">0% — ${formatBytes(totalSize)}</span>
      </div>
    </div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function finalizeFileProgressMessage(msgEl, author, filename, blob) {
  if (!msgEl) { appendFileMessage(author, filename, blob); return; }
  const url     = URL.createObjectURL(blob);
  const isImage = blob.type.startsWith('image/');
  const bodyEl  = msgEl.querySelector('.body');
  if (!bodyEl) return;
  const content = isImage
    ? `<a href="${url}" target="_blank"><img src="${url}" class="file-image" alt="${escapeHtml(filename)}" /></a>`
    : `<a href="${url}" download="${escapeHtml(filename)}" class="file-download">
         <span class="file-icon">📄</span>
         <span class="file-info">
           <span class="file-name">${escapeHtml(filename)}</span>
           <span class="file-size">${formatBytes(blob.size)}</span>
         </span>
         <span class="file-dl">⬓</span>
       </a>`;
  bodyEl.innerHTML = content;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendFileMessage(author, filename, blob, isSelf = false) {
  const time    = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const color   = usernameColor(author);
  const url     = URL.createObjectURL(blob);
  const isImage = blob.type.startsWith('image/');
  const div     = document.createElement('div');
  div.className = 'message';

  const content = isImage
    ? `<a href="${url}" target="_blank"><img src="${url}" class="file-image" alt="${escapeHtml(filename)}" /></a>`
    : `<a href="${url}" download="${escapeHtml(filename)}" class="file-download">
         <span class="file-icon">📄</span>
         <span class="file-info">
           <span class="file-name">${escapeHtml(filename)}</span>
           <span class="file-size">${formatBytes(blob.size)}</span>
         </span>
         <span class="file-dl">⬓</span>
       </a>`;

  div.innerHTML = `
    <div class="meta">
      <span class="name" style="color:${color}">${escapeHtml(author)}${isSelf ? ' <span class="self-tag">(sen)</span>' : ''}</span>
      <span class="time">${time}</span>
    </div>
    <div class="body">${content}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

document.getElementById('file-input').addEventListener('change', e => {
  sendFiles(e.target.files);
  e.target.value = '';
});

const dropOverlay = document.getElementById('drop-overlay');
const roomScreen  = document.getElementById('screen-room');

roomScreen.addEventListener('dragover', e => { e.preventDefault(); dropOverlay.classList.add('visible'); });
dropOverlay.addEventListener('dragleave', () => dropOverlay.classList.remove('visible'));
dropOverlay.addEventListener('dragover',  e => e.preventDefault());
dropOverlay.addEventListener('drop', e => {
  e.preventDefault();
  dropOverlay.classList.remove('visible');
  sendFiles(e.dataTransfer.files);
});

// ── Otomatik güncelleme bildirimi ─────────────────────────────
if (window.electron?.onUpdateStatus) {
  const updateBanner  = document.getElementById('update-banner');
  const updateMsg     = document.getElementById('update-msg');
  const btnInstall    = document.getElementById('btn-install-update');
  const btnDismiss    = document.getElementById('btn-dismiss-update');

  window.electron.onUpdateStatus(status => {
    updateBanner.classList.remove('hidden');
    if (status === 'downloading') {
      updateMsg.textContent = 'Güncelleme indiriliyor...';
      btnInstall.classList.add('hidden');
    } else if (status === 'ready') {
      updateMsg.textContent = 'Yeni sürüm hazır!';
      btnInstall.classList.remove('hidden');
    }
  });

  btnInstall.addEventListener('click', () => window.electron.installUpdate());
  btnDismiss.addEventListener('click', () => updateBanner.classList.add('hidden'));
}
