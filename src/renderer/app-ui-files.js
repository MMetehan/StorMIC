'use strict';

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB

// ── Gönderme ──────────────────────────────────────────────────
const SEND_BUFFER_HIGH = 256 * 1024;
const SEND_BUFFER_LOW  =  64 * 1024;

async function sendChunkedLazy(dc, file, onProgress, cancelRef) {
  const totalSize = file.size;
  let offset = 0;
  while (offset < totalSize) {
    if (cancelRef.cancelled || dc.readyState !== 'open') return false;
    if (dc.bufferedAmount > SEND_BUFFER_HIGH) {
      await new Promise(resolve => {
        dc.bufferedAmountLowThreshold = SEND_BUFFER_LOW;
        const cleanup = () => {
          dc.onbufferedamountlow = null;
          dc.removeEventListener('close', cleanup);
          resolve();
        };
        dc.onbufferedamountlow = cleanup;
        dc.addEventListener('close', cleanup);
      });
      if (cancelRef.cancelled || dc.readyState !== 'open') return false;
    }
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const buf = await chunk.arrayBuffer();
    if (cancelRef.cancelled) return false;
    try { dc.send(buf); } catch { return false; }
    offset += buf.byteLength;
    onProgress(Math.min(100, Math.round(offset / totalSize * 100)));
  }
  return true;
}

function sendFiles(files) {
  for (const file of files) sendFile(file);
}

async function sendFile(file) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
  const cancelRef = { cancelled: false };

  // Gönderenin progress mesajı
  const msgEl = appendSendProgressMessage(state.username, file.name, file.size, () => {
    cancelRef.cancelled = true;
    const cancelMsg = JSON.stringify({ type: 'file-cancel', id });
    peers.forEach(({ dc }) => { if (dc?.readyState === 'open') dc.send(cancelMsg); });
    const bodyEl = msgEl?.querySelector('.body');
    if (bodyEl) bodyEl.innerHTML = `<div class="file-cancelled">✕ ${escapeHtml(file.name)} — gönderim iptal edildi</div>`;
  });

  const meta = JSON.stringify({ type: 'file-meta', id, name: file.name, size: file.size, mime: file.type });
  const doneMsg = JSON.stringify({ type: 'file-done', id });

  // Herkese meta gönder
  const openDcs = [];
  peers.forEach(({ dc }) => { if (dc?.readyState === 'open') { dc.send(meta); openDcs.push(dc); } });
  if (!openDcs.length) { if (msgEl) msgEl.remove(); return; }

  let finished = false;
  // Tüm peer'lara paralel gönder (her biri için ayrı okuma — lazy)
  await Promise.all(openDcs.map(dc =>
    sendChunkedLazy(dc, file, pct => {
      if (!finished) {
        const bar = msgEl?.querySelector('.file-progress-bar');
        const pctEl = msgEl?.querySelector('.file-progress-pct');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '% — ' + formatBytes(file.size);
      }
    }, cancelRef)
  ));

  if (cancelRef.cancelled) return;
  finished = true;
  openDcs.forEach(dc => { if (dc.readyState === 'open') dc.send(doneMsg); });

  // Gönderenin kendi görünümü: küçük dosya ise inline, büyük ise download linki
  const blob = file.slice(0, file.size, file.type);
  finalizeSendMessage(msgEl, file.name, blob);
}

function appendSendProgressMessage(author, filename, totalSize, onCancel) {
  const div = buildMessageEl(author, true);
  div.querySelector('.body').innerHTML = `
    <div class="file-progress">
      <div class="file-progress-header">
        <span class="file-progress-name">${escapeHtml(filename)}</span>
        <button class="file-cancel-btn" title="Gönderimi İptal Et">✕</button>
      </div>
      <div class="file-progress-bar-wrap"><div class="file-progress-bar" style="width:0%"></div></div>
      <span class="file-progress-pct">0% — ${formatBytes(totalSize)}</span>
    </div>`;
  div.querySelector('.file-cancel-btn').addEventListener('click', onCancel);
  appendMessage(div);
  return div;
}

function finalizeSendMessage(msgEl, filename, blob) {
  const bodyEl = msgEl?.querySelector('.body');
  if (!bodyEl) return;
  const url     = URL.createObjectURL(blob);
  const isImage = blob.type.startsWith('image/');
  const isVideo = blob.type.startsWith('video/');
  if (blob.size <= LARGE_FILE_THRESHOLD) {
    if (isImage) {
      bodyEl.innerHTML = `<a href="${url}" target="_blank"><img src="${url}" class="file-image" alt="${escapeHtml(filename)}" /></a>`;
    } else if (isVideo) {
      bodyEl.innerHTML = `<video src="${url}" controls class="file-video"></video>`;
    } else {
      bodyEl.innerHTML = buildDownloadHtml(url, filename, blob.size);
    }
  } else {
    bodyEl.innerHTML = buildDownloadHtml(url, filename, blob.size);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Alınan dosyaları göster (alıcı tarafı) ────────────────────
function showReceivedFile(author, filename, size, blob) {
  const div = buildMessageEl(author);
  const bodyEl = div.querySelector('.body');

  if (size <= LARGE_FILE_THRESHOLD) {
    // Küçük dosya: direkt inline göster
    const url     = URL.createObjectURL(blob);
    const isImage = blob.type.startsWith('image/');
    const isVideo = blob.type.startsWith('video/');
    if (isImage) {
      bodyEl.innerHTML = `<a href="${url}" target="_blank"><img src="${url}" class="file-image" alt="${escapeHtml(filename)}" /></a>`;
    } else if (isVideo) {
      bodyEl.innerHTML = `<video src="${url}" controls class="file-video"></video>`;
    } else {
      bodyEl.innerHTML = buildDownloadHtml(url, filename, size);
    }
  } else {
    // Büyük dosya: bulanık önizleme + indir butonu
    renderLargePlaceholder(bodyEl, filename, size, blob);
  }
  appendMessage(div);
}

function renderLargePlaceholder(bodyEl, filename, size, blob) {
  const isImage = blob.type.startsWith('image/');
  const isVideo = blob.type.startsWith('video/');

  let previewHtml = '';
  if (isImage) {
    const thumbUrl = URL.createObjectURL(blob);
    previewHtml = `<div class="file-large-preview-wrap">
      <img src="${thumbUrl}" class="file-large-preview-img" alt="" />
      <div class="file-large-preview-overlay"></div>
    </div>`;
  } else if (isVideo) {
    previewHtml = `<div class="file-large-icon">🎬</div>`;
  } else {
    previewHtml = `<div class="file-large-icon">📄</div>`;
  }

  const desc = isImage
    ? 'Görmek için indirin'
    : isVideo
    ? 'İzlemek için indirin'
    : 'Açmak için indirin';

  bodyEl.innerHTML = `
    <div class="file-large-card">
      ${previewHtml}
      <div class="file-large-info">
        <span class="file-large-name">${escapeHtml(filename)}</span>
        <span class="file-large-size">${formatBytes(size)}</span>
        <span class="file-large-desc">${desc}</span>
        <div class="file-large-actions">
          <button class="file-large-dl-btn">📥 İndir (${formatBytes(size)})</button>
        </div>
      </div>
    </div>`;

  bodyEl.querySelector('.file-large-dl-btn').addEventListener('click', async () => {
    await expandLargeFile(bodyEl, filename, size, blob);
  });
}

async function expandLargeFile(bodyEl, filename, size, blob) {
  const isImage = blob.type.startsWith('image/');
  const isVideo = blob.type.startsWith('video/');
  const url = URL.createObjectURL(blob);

  let contentHtml = '';
  if (isImage) {
    contentHtml = `<a href="${url}" target="_blank"><img src="${url}" class="file-image" alt="${escapeHtml(filename)}" /></a>`;
  } else if (isVideo) {
    contentHtml = `<video src="${url}" controls class="file-video"></video>`;
  } else {
    contentHtml = buildDownloadHtml(url, filename, size);
  }

  bodyEl.innerHTML = `${contentHtml}<div class="file-save-row">
    <span class="file-save-name">${escapeHtml(filename)} — ${formatBytes(size)}</span>
    <button class="file-save-btn">💾 Kaydet</button>
  </div>`;

  // Kaydet butonu: native save dialog
  bodyEl.querySelector('.file-save-btn')?.addEventListener('click', async () => {
    const buf = await blob.arrayBuffer();
    const ok = await window.electron?.saveFileDialog(filename, buf);
    if (ok) {
      const btn = bodyEl.querySelector('.file-save-btn');
      if (btn) { btn.textContent = '✓ Kaydedildi'; btn.disabled = true; }
    }
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function buildDownloadHtml(url, filename, size) {
  return `<a href="${url}" download="${escapeHtml(filename)}" class="file-download">
    <span class="file-icon">📄</span>
    <span class="file-info">
      <span class="file-name">${escapeHtml(filename)}</span>
      <span class="file-size">${formatBytes(size)}</span>
    </span>
    <span class="file-dl">⬓</span>
  </a>`;
}

// ── Drag & drop / file input ───────────────────────────────────
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
  const overlay   = document.getElementById('update-overlay');
  const msg       = document.getElementById('update-overlay-msg');
  const spinner   = document.getElementById('update-spinner');
  const actions   = document.getElementById('update-actions');
  const btnNow    = document.getElementById('btn-install-now');
  const btnLater  = document.getElementById('btn-install-later');

  window.electron.onUpdateStatus(status => {
    overlay.classList.remove('hidden');
    if (status === 'downloading') {
      msg.textContent = 'Güncelleme indiriliyor, lütfen bekleyin...';
      spinner.classList.remove('hidden');
      actions.classList.add('hidden');
    } else if (status === 'ready') {
      msg.textContent = 'Güncelleme hazır!';
      spinner.classList.add('hidden');
      actions.classList.remove('hidden');
    }
  });

  btnNow.addEventListener('click', () => window.electron.installUpdate());
  btnLater.addEventListener('click', () => overlay.classList.add('hidden'));
}
