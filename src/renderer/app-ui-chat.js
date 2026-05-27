'use strict';

// ── Chat mesajları ────────────────────────────────────────────
const msgInput     = document.getElementById('msg-input');
const messagesEl   = document.getElementById('messages');

// Link tıklamaları sistem tarayıcısında aç
messagesEl.addEventListener('click', e => {
  const link = e.target.closest('.chat-link');
  if (!link) return;
  e.preventDefault();
  const url = link.dataset.url;
  if (url) window.electron?.openExternal(url);
});

const mentionPopup = document.getElementById('mention-popup');

document.getElementById('btn-send').addEventListener('click', sendChatMessage);
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && mentionPopup.classList.contains('hidden')) sendChatMessage();
});

function sendChatMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = '';
  if (text.startsWith('/kura')) { handleKuraCommand(text); return; }
  broadcastControl({ type: 'chat', username: state.username, text });
  appendChatMessage(state.username, text, true);
}

function renderChatText(text) {
  const URL_RE = /https?:\/\/[^\s]+/g;
  const mentionize = str => str.replace(/@(\w+)/g, (_, name) => {
    const isMe = name === state.username;
    return `<span class="mention${isMe ? ' mention-me' : ''}" style="color:${usernameColor(name)}">@${name}</span>`;
  });
  let result = '';
  let last = 0;
  let m;
  while ((m = URL_RE.exec(text)) !== null) {
    result += mentionize(escapeHtml(text.slice(last, m.index)));
    const url = m[0];
    result += `<a class="chat-link" href="#" data-url="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    last = m.index + url.length;
  }
  result += mentionize(escapeHtml(text.slice(last)));
  return result;
}

function maybeFetchPreview(bodyEl, text) {
  if (!window.electron?.fetchOg) return;
  const m = text.match(/https?:\/\/[^\s]+/);
  if (!m) return;
  const url = m[0];
  window.electron.fetchOg(url).then(og => {
    if (!og) return;
    const card = document.createElement('div');
    card.className = 'link-preview';
    let inner = '';
    if (og.image) inner += `<img class="link-preview-image" src="${escapeHtml(og.image)}" alt="" loading="lazy" onerror="this.remove()" />`;
    inner += `<div class="link-preview-body">`;
    if (og.siteName) inner += `<div class="link-preview-site">${escapeHtml(og.siteName)}</div>`;
    if (og.title)    inner += `<div class="link-preview-title">${escapeHtml(og.title)}</div>`;
    if (og.description) inner += `<div class="link-preview-desc">${escapeHtml(og.description)}</div>`;
    inner += `</div>`;
    card.innerHTML = inner;
    card.addEventListener('click', () => window.electron.openExternal(url));
    bodyEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }).catch(() => {});
}

function appendChatMessage(author, text, isSelf = false) {
  if (!isSelf && state.username && text.includes('@' + state.username)) playSound('mention');
  const time  = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const color = usernameColor(author);
  const div   = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `
    <div class="meta">
      <span class="name" style="color:${color}">${escapeHtml(author)}${isSelf ? ' <span class="self-tag">(sen)</span>' : ''}</span>
      <span class="time">${time}</span>
    </div>
    <div class="body">${renderChatText(text)}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  maybeFetchPreview(div.querySelector('.body'), text);
}

function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'message system';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Kura sistemi ─────────────────────────────────────────────
function drawWinners(choices, count) {
  const pool    = [...choices];
  const winners = [];
  for (let i = 0; i < count; i++) {
    const range = pool.length * 1000;
    const roll  = Math.floor(Math.random() * range);
    const idx   = Math.floor(roll / 1000);
    winners.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return winners;
}

function handleKuraCommand(text) {
  const arg = text.slice('/kura'.length).trim();

  if (!arg || arg === 'help' || arg === 'yardım') {
    appendSystemMessage('── /kura Kullanımı ──────────────────────────');
    appendSystemMessage('/kura seçenek1, seçenek2, seçenek3');
    appendSystemMessage('/kura seçenek1, seçenek2, seçenek3 --- 2   (birden fazla kazanan)');
    appendSystemMessage('Örnek: /kura Ali, Veli, Ayşe --- 2');
    return;
  }

  const parts        = arg.split('---');
  const choicesPart  = parts[0].trim();
  const countPart    = parts[1]?.trim();
  const winnerCount  = Math.max(1, parseInt(countPart) || 1);
  const choices      = choicesPart.split(',').map(c => c.trim()).filter(Boolean);

  if (choices.length < 2) {
    appendSystemMessage('Kura için en az 2 seçenek gerekli.');
    return;
  }
  if (winnerCount >= choices.length) {
    appendSystemMessage(`Kazanan sayısı (${winnerCount}) seçenek sayısından (${choices.length}) az olmalı.`);
    return;
  }

  const winners = drawWinners(choices, winnerCount);
  broadcastControl({ type: 'chat-kura', username: state.username, choices, winners });
  appendKuraMessage(state.username, choices, winners, true);
}

function appendKuraMessage(author, choices, winners, isSelf = false) {
  const time  = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const color = usernameColor(author);
  const div   = document.createElement('div');
  div.className = 'message';

  const choicesHtml = choices.map(c =>
    `<span class="kura-choice${winners.includes(c) ? ' kura-winner' : ''}">${escapeHtml(c)}</span>`
  ).join('');

  const winnersHtml = winners.map(w =>
    `<span class="kura-winner">🏆 ${escapeHtml(w)}</span>`
  ).join('');

  div.innerHTML = `
    <div class="meta">
      <span class="name" style="color:${color}">${escapeHtml(author)}${isSelf ? ' <span class="self-tag">(sen)</span>' : ''}</span>
      <span class="time">${time}</span>
    </div>
    <div class="body">
      <div class="kura-card">
        <div class="kura-header">🎲 Kura Çekildi</div>
        <div class="kura-choices"><span class="kura-choices-label">Havuz:</span> ${choicesHtml}</div>
        <div class="kura-result-row">${winners.length > 1 ? `${winners.length} Kazanan:` : 'Kazanan:'} ${winnersHtml}</div>
      </div>
    </div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Mention popup ─────────────────────────────────────────────
let mentionIndex   = -1;
let mentionMatches = [];
let mentionStartPos = -1;

function getMentionInfo(input) {
  const val = input.value;
  const pos = input.selectionStart ?? val.length;
  const before = val.slice(0, pos);
  const m = before.match(/(?:^|\s)@(\w*)$/);
  if (!m) return null;
  return { query: m[1].toLowerCase(), start: before.lastIndexOf('@') };
}

function renderMentionPopup() {
  mentionPopup.innerHTML = '';
  mentionMatches.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'mention-item' + (i === mentionIndex ? ' mention-active' : '');
    const dot = document.createElement('span');
    dot.className = 'mention-dot';
    dot.style.background = usernameColor(name);
    const label = document.createElement('span');
    label.textContent = name;
    item.appendChild(dot);
    item.appendChild(label);
    item.addEventListener('mousedown', e => { e.preventDefault(); insertMention(name); });
    mentionPopup.appendChild(item);
  });
}

function insertMention(name) {
  const val   = msgInput.value;
  const pos   = msgInput.selectionStart ?? val.length;
  const before = val.slice(0, mentionStartPos);
  const after  = val.slice(pos);
  const space  = (after.length === 0 || after[0] === ' ') ? '' : ' ';
  msgInput.value = before + '@' + name + space + after;
  const newPos = before.length + 1 + name.length + space.length;
  msgInput.selectionStart = msgInput.selectionEnd = newPos;
  hideMentionPopup();
  msgInput.focus();
}

function hideMentionPopup() {
  mentionPopup.classList.add('hidden');
  mentionMatches = [];
  mentionIndex   = -1;
  mentionStartPos = -1;
}

msgInput.addEventListener('input', () => {
  const info = getMentionInfo(msgInput);
  if (!info) { hideMentionPopup(); return; }
  const all     = [...peers.keys()];
  const matches = info.query ? all.filter(n => n.toLowerCase().startsWith(info.query)) : all;
  if (!matches.length) { hideMentionPopup(); return; }
  mentionMatches  = matches;
  mentionIndex    = 0;
  mentionStartPos = info.start;
  renderMentionPopup();
  mentionPopup.classList.remove('hidden');
});

msgInput.addEventListener('keydown', e => {
  if (mentionPopup.classList.contains('hidden')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    mentionIndex = (mentionIndex + 1) % mentionMatches.length;
    renderMentionPopup();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    mentionIndex = (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
    renderMentionPopup();
  } else if ((e.key === 'Tab' || e.key === 'Enter') && mentionIndex >= 0) {
    e.preventDefault();
    insertMention(mentionMatches[mentionIndex]);
  } else if (e.key === 'Escape') {
    hideMentionPopup();
  }
});

// Popup dışına tıklanınca kapat
document.addEventListener('click', e => {
  if (!mentionPopup.contains(e.target) && e.target !== msgInput) hideMentionPopup();
});

// ── Emoji picker ──────────────────────────────────────────────
const EMOJI_CATEGORIES = [
  { icon: '😀', label: 'Yüzler', emojis: [
    '😀','😁','😂','🤣','😃','😄','😅','😆','😇','😈','👿',
    '😉','😊','😋','😌','😍','🥰','😘','😗','😙','😚',
    '🤩','🥳','😎','🤓','🧐','😐','😑','😶','🫥','😏',
    '😒','🙄','😬','🤥','😔','😪','😴','🤤','🥱','😷',
    '🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','😵‍💫',
    '🤯','🤠','🥸','🤡','🤫','🤭','🫢','🫣','🤔','🫠',
    '😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭',
    '😤','😠','😡','🤬','💀','☠️','💩','😱','😨','😰',
    '😥','😓','🤗','🫡','🫶','😮','😯','😲','😸','😹',
    '😺','😻','😼','😽','🙀','😿','😾','👻','👽','🤖',
    '👾','🎃','🫀','🫁','🧠','👁️','👅','👄','🫦',
  ]},
  { icon: '👋', label: 'El & Beden', emojis: [
    '👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘',
    '🤙','👈','👉','👆','👇','☝️','🫵','👋','🤚','🖐️',
    '✋','🖖','👌','🤌','🤏','🫰','🫳','🫴','🙌','👏',
    '🤝','🙏','✍️','💅','🫵','💪','🦾','🦿','🦵','🦶',
    '👂','🦻','👃','👀','👁️','🫀','🫁','🧠','🦷','🦴',
    '💋','👄','🫦','👅','💪','🤳','🙋','🙆','🙅','💁',
    '🤦','🤷','🙇','🧏','💆','💇','🚶','🧍','🧎','🏃',
  ]},
  { icon: '🐶', label: 'Hayvanlar', emojis: [
    '🐶','🐱','🐭','🐹','🐰','🦊','🦝','🐻','🐼','🐻‍❄️',
    '🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊',
    '🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗',
    '🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🦟',
    '🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑',
    '🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈',
    '🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏',
    '🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖',
    '🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐈','🐓',
    '🦃','🦤','🦚','🦜','🦢','🕊️','🐇','🦡','🦫','🦦',
    '🦥','🐁','🐀','🐿️','🦔','🐾','🐉','🐲','🌵','🎄',
  ]},
  { icon: '🍕', label: 'Yiyecek', emojis: [
    '🍎','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍑',
    '🍒','🍍','🥭','🥥','🥝','🍅','🫒','🥑','🥦','🥬',
    '🌽','🌶️','🫑','🥒','🧅','🧄','🥔','🍠','🥜','🫘',
    '🍞','🥐','🥖','🫓','🧀','🥚','🍳','🧇','🥞','🧈',
    '🍖','🍗','🥩','🥓','🍔','🍟','🌭','🍕','🫔','🌮',
    '🌯','🥙','🧆','🍛','🍜','🍝','🍣','🍱','🍘','🍙',
    '🍚','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬',
    '🍫','🍩','🍪','🌰','🍦','🍨','🍧','🧃','🥤','🧋',
    '☕','🍵','🫖','🍺','🍻','🥂','🍷','🥃','🍸','🍹',
    '🧉','🍾','🧊','🥄','🍴','🍽️','🥢','🫙',
  ]},
  { icon: '⚽', label: 'Spor & Eğlence', emojis: [
    '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱',
    '🏓','🏸','🥅','⛳','🎣','🤿','🎿','🛷','🥌','🎯',
    '🪃','🏋️','🤼','🤸','⛹️','🤺','🤾','🏊','🚴','🧘',
    '🎮','🕹️','🎲','♟️','🎭','🎨','🖼️','🎰','🎳','🎪',
    '🎤','🎧','🎼','🎵','🎶','🎸','🎹','🥁','🪘','🎷',
    '🎺','🪗','🎻','🪕','🎬','🎥','🎞️','🎠','🎡','🎢',
    '🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️',
    '🎪','🤹','🎭','🎨','🖌️','🖍️','✏️','📝',
  ]},
  { icon: '✈️', label: 'Seyahat', emojis: [
    '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐',
    '🛻','🚚','🚛','🚜','🛵','🏍️','🚲','🛴','🛺','🚁',
    '✈️','🛫','🛬','🚀','🛸','🛩️','⛵','🚢','🛳️','⛴️',
    '🚂','🚃','🚆','🚇','🚊','🚝','🚄','🚅','🛤️','⛽',
    '🗺️','🧭','🏔️','⛰️','🌋','🏕️','🏖️','🏜️','🏝️','🏟️',
    '🏛️','🏗️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨',
    '🏩','🏪','🏫','🏭','🏯','🏰','💒','🗼','🗽','⛪',
    '🕌','🛕','🕍','⛩️','🎑','🌁','🌃','🏙️','🌄','🌅',
    '🌆','🌇','🌉','🗺️','🧳','⛺','🎡','🎢','🎠',
  ]},
  { icon: '🌿', label: 'Doğa', emojis: [
    '🌸','🌺','🌻','🌹','🥀','🌷','💐','🌱','🪴','🌿',
    '☘️','🍀','🎍','🎋','🍃','🍂','🍁','🌾','🎄','🌴',
    '🌲','🌳','🪵','🪨','🌵','🐚','🪸','🌊','💧','🔥',
    '☀️','🌤️','⛅','🌥️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️',
    '⛄','🌬️','💨','🌪️','🌫️','🌈','☂️','⚡','🌑','🌒',
    '🌓','🌔','🌕','🌖','🌗','🌘','🌙','🌚','🌛','🌜',
    '🌝','🌞','⭐','🌟','💫','✨','🌠','☄️','🌌','🪐',
    '🌍','🌎','🌏','🗻','🏔️','🌋','🌁','🌀','🌈','⛅',
  ]},
  { icon: '💡', label: 'Nesneler', emojis: [
    '📱','💻','⌨️','🖥️','🖨️','🖱️','💽','💾','💿','📀',
    '📷','📸','📹','📼','☎️','📞','📟','📠','📺','📻',
    '🧭','⌚','⏱️','⏰','🕰️','⏳','⌛','📡','🔋','🔌',
    '💡','🔦','🕯️','🪔','🧯','💰','💴','💵','💶','💷',
    '💸','💳','🪙','💎','⚖️','🪜','🔧','🔨','⚒️','🛠️',
    '⛏️','🔩','🪛','🔑','🗝️','🔐','🔏','🔓','🔒','🗑️',
    '🧲','💊','🩹','🩺','🩻','🪥','🧴','🧷','🧹','🧺',
    '🧻','🚿','🛁','🧼','🫧','📦','📬','📮','✏️','📝',
    '📄','📊','📈','📉','📋','📁','📂','📚','📖','🔖',
    '🏷️','🧸','🪆','🖼️','🧩','🎁','🎀','🎈','🎊','🎉',
    '🎆','🎇','🧨','✨','🎍','🎋','🎃','🎄','🎑','🎐',
  ]},
  { icon: '💯', label: 'Semboller', emojis: [
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
    '❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟',
    '❣️','💯','✅','❌','❎','⭕','🔴','🟠','🟡','🟢',
    '🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺',
    '🔻','💠','🔘','🔳','🔲','🔥','💥','💢','💨','💦',
    '💧','✨','⭐','🌟','💫','⚡','🎉','🎊','🎈','🏆',
    '🥇','🎯','🚩','🏴','🏳️','🚫','⛔','📵','🔞','🔕',
    '🔇','🔈','🔉','🔊','📢','📣','🔔','🔕','🃏','🀄',
    '🎴','🔮','🪬','🧿','♻️','🔁','🔂','▶️','⏸️','⏹️',
    '⏺️','⏭️','⏮️','⏩','⏪','🔀','🔃','🔄','📶','📳',
    '📴','📵','💤','🆗','🆙','🆒','🆕','🆓','🆖','🅰️',
    '🅱️','🆎','🆑','🅾️','🆘','⚠️','🚸','🆚','🉐','🈹',
  ]},
];

const emojiPicker = document.getElementById('emoji-picker');
const btnEmoji    = document.getElementById('btn-emoji');

// Kategori çubuğu oluştur
const emojiCatBar = document.createElement('div');
emojiCatBar.className = 'emoji-cat-bar';
const emojiGrid = document.createElement('div');
emojiGrid.className = 'emoji-grid';

function renderEmojiGrid(emojis) {
  emojiGrid.innerHTML = '';
  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      const pos = msgInput.selectionStart ?? msgInput.value.length;
      const val = msgInput.value;
      msgInput.value = val.slice(0, pos) + emoji + val.slice(pos);
      msgInput.selectionStart = msgInput.selectionEnd = pos + emoji.length;
      msgInput.focus();
    });
    emojiGrid.appendChild(btn);
  });
}

EMOJI_CATEGORIES.forEach((cat, idx) => {
  const btn = document.createElement('button');
  btn.className = 'emoji-cat-btn' + (idx === 0 ? ' active' : '');
  btn.textContent = cat.icon;
  btn.title = cat.label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiCatBar.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderEmojiGrid(cat.emojis);
  });
  emojiCatBar.appendChild(btn);
});

emojiPicker.appendChild(emojiCatBar);
emojiPicker.appendChild(emojiGrid);
renderEmojiGrid(EMOJI_CATEGORIES[0].emojis);

btnEmoji.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = emojiPicker.classList.contains('hidden');
  emojiPicker.classList.toggle('hidden');
  if (willOpen) gifPicker.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!emojiPicker.classList.contains('hidden') &&
      !emojiPicker.contains(e.target) &&
      e.target !== btnEmoji) {
    emojiPicker.classList.add('hidden');
  }
});

// ── GIF picker ────────────────────────────────────────────────
const TENOR_KEY = 'LIVDSRZULELA';
const gifPicker  = document.getElementById('gif-picker');
const btnGif     = document.getElementById('btn-gif');
const gifSearch  = document.getElementById('gif-search');
const gifGrid    = document.getElementById('gif-grid');
let   gifSearchTimer = null;

btnGif.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = gifPicker.classList.contains('hidden');
  gifPicker.classList.toggle('hidden');
  if (willOpen) {
    emojiPicker.classList.add('hidden');
    gifSearch.value = '';
    gifSearch.focus();
    loadGifs('');
  }
});

document.addEventListener('click', (e) => {
  if (!gifPicker.classList.contains('hidden') &&
      !gifPicker.contains(e.target) &&
      e.target !== btnGif) {
    gifPicker.classList.add('hidden');
  }
});

gifSearch.addEventListener('keydown', e => e.stopPropagation());
gifSearch.addEventListener('input', () => {
  clearTimeout(gifSearchTimer);
  gifSearchTimer = setTimeout(() => loadGifs(gifSearch.value.trim()), 450);
});

async function loadGifs(query) {
  gifGrid.innerHTML = '<div class="gif-status">Yükleniyor...</div>';
  try {
    const url = query
      ? `https://api.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=20&contentfilter=medium`
      : `https://api.tenor.com/v1/trending?key=${TENOR_KEY}&limit=20&contentfilter=medium`;
    const res  = await fetch(url);
    const json = await res.json();
    gifGrid.innerHTML = '';
    const gifs = json.results ?? [];
    if (!gifs.length) {
      gifGrid.innerHTML = '<div class="gif-status">Sonuç yok.</div>';
      return;
    }
    gifs.forEach(g => {
      const thumb = g.media?.[0]?.tinygif?.url || g.media?.[0]?.gif?.url;
      const send  = g.media?.[0]?.mediumgif?.url || g.media?.[0]?.gif?.url;
      if (!thumb || !send) return;
      const item = document.createElement('div');
      item.className = 'gif-item';
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = g.title || 'GIF';
      img.loading = 'lazy';
      item.appendChild(img);
      item.addEventListener('click', () => {
        gifPicker.classList.add('hidden');
        broadcastControl({ type: 'chat-gif', username: state.username, url: send });
        appendGifMessage(state.username, send, true);
      });
      gifGrid.appendChild(item);
    });
  } catch {
    gifGrid.innerHTML = '<div class="gif-status">Yüklenemedi.</div>';
  }
}

function appendGifMessage(author, url, isSelf = false) {
  const time  = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const color = usernameColor(author);
  const div   = document.createElement('div');
  div.className = 'message';
  div.innerHTML = `
    <div class="meta">
      <span class="name" style="color:${color}">${escapeHtml(author)}${isSelf ? ' <span class="self-tag">(sen)</span>' : ''}</span>
      <span class="time">${time}</span>
    </div>
    <div class="body"><img src="${escapeHtml(url)}" class="chat-gif" alt="GIF" loading="lazy" /></div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
