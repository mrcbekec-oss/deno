// ─── State ───────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const ME = {
  name: params.get('name') || 'Misafir',
  avatar: params.get('avatar') || '😊',
  color: params.get('color') || '#7c3aed',
  id: null,
};
const ACTION = params.get('action') || 'create';
const INITIAL_ROOM_ID = params.get('roomId') || null;
const ROOM_NAME = params.get('roomName') || 'Arkadaş Odası';

let ws = null;
let roomId = null;
let users = {};
let polls = {};
let currentTheme = 'cafe';
let tableItems = [];
let roomShown = false;

// ─── Menu Data ──────────────────────────────────────────
const MENU = {
  food: [
    { name: 'Margherita', emoji: '🍕', price: '₺120' },
    { name: 'Burger', emoji: '🍔', price: '₺95' },
    { name: 'Sushi', emoji: '🍣', price: '₺150' },
    { name: 'Tavuk Döner', emoji: '🌯', price: '₺80' },
    { name: 'Lazanya', emoji: '🍝', price: '₺110' },
    { name: 'Salata', emoji: '🥗', price: '₺65' },
    { name: 'Taco', emoji: '🌮', price: '₺85' },
    { name: 'Hot Dog', emoji: '🌭', price: '₺55' },
  ],
  drink: [
    { name: 'Kahve', emoji: '☕', price: '₺35' },
    { name: 'Çay', emoji: '🍵', price: '₺15' },
    { name: 'Limonata', emoji: '🍋', price: '₺45' },
    { name: 'Meyve Suyu', emoji: '🧃', price: '₺40' },
    { name: 'Smoothie', emoji: '🥤', price: '₺70' },
    { name: 'Kola', emoji: '🥤', price: '₺30' },
    { name: 'Bira', emoji: '🍺', price: '₺55' },
    { name: 'Kokteyl', emoji: '🍹', price: '₺90' },
  ],
  dessert: [
    { name: 'Çikolatalı Kek', emoji: '🍰', price: '₺75' },
    { name: 'Dondurma', emoji: '🍦', price: '₺50' },
    { name: 'Kurabiye', emoji: '🍪', price: '₺35' },
    { name: 'Tatlı', emoji: '🍮', price: '₺60' },
    { name: 'Çikolata', emoji: '🍫', price: '₺40' },
    { name: 'Baklava', emoji: '🍯', price: '₺80' },
    { name: 'Waffle', emoji: '🧇', price: '₺85' },
    { name: 'Krep', emoji: '🥞', price: '₺65' },
  ],
};

// ─── WebSocket Init ──────────────────────────────────────
function connectWebSocket() {
  updateConnectStatus('Sunucuya bağlanılıyor...', 30);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    updateConnectStatus('Odaya bağlanılıyor...', 60);
    const payload = {
      type: 'join_room',
      name: ME.name,
      avatar: ME.avatar,
      color: ME.color,
      roomName: ROOM_NAME,
    };
    if (ACTION === 'join' && INITIAL_ROOM_ID) {
      payload.roomId = INITIAL_ROOM_ID.toUpperCase();
    }
    ws.send(JSON.stringify(payload));
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    if (!roomShown) {
      updateConnectStatus('❌ Sunucu bağlantısı kesildi!', 100);
    }
  });

  ws.addEventListener('error', () => {
    updateConnectStatus('❌ Sunucuya bağlanılamadı! Deno sunucusunu çalıştır.', 100);
  });
}

function sendWs(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'join_error':
      updateConnectStatus('❌ Oda bulunamadı!', 100);
      setTimeout(() => { location.href = 'index.html'; }, 2000);
      break;

    case 'joined':
      ME.id = msg.userId;
      roomId = msg.roomId;
      document.getElementById('headerRoomCode').textContent = roomId;
      break;

    case 'room_state': {
      const room = msg.room;
      document.getElementById('headerRoomName').textContent = room.name || roomId;
      currentTheme = room.theme || 'cafe';
      applyTheme(currentTheme);

      users = {};
      (room.users || []).forEach(u => { users[u.id] = u; });
      renderUsers();
      renderAvatars();

      (room.orders || []).forEach(order => {
        addOrderToUI(order);
        addTableItem(order.emoji);
      });

      (room.playlist || []).forEach(song => addSongToUI(song));
      if (room.currentSong) updateNowPlaying(room.currentSong);

      updateConnectStatus('Odaya girildi! ✅', 100);
      if (!roomShown) {
        roomShown = true;
        setTimeout(showRoom, 600);
      }
      break;
    }

    case 'user_joined':
      users[msg.user.id] = msg.user;
      renderUsers();
      renderAvatars();
      break;

    case 'user_left':
      delete users[msg.userId];
      renderUsers();
      renderAvatars();
      break;

    case 'system_message':
      addSystemMsg(msg.text);
      break;

    case 'chat_message':
      addChatMsg(msg);
      showSpeakBubble(msg.userId, msg.text);
      break;

    case 'new_order':
      addOrderToUI(msg.order);
      addTableItem(msg.order.emoji);
      break;

    case 'reaction':
      spawnReaction(msg.emoji);
      break;

    case 'song_added':
      addSongToUI(msg.song);
      if (msg.currentSong) updateNowPlaying(msg.currentSong);
      break;

    case 'theme_changed':
      currentTheme = msg.theme;
      applyTheme(msg.theme);
      break;

    case 'user_status_updated':
      if (users[msg.userId]) {
        users[msg.userId].status = msg.status;
        renderUsers();
      }
      break;

    case 'dice_result': {
      const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
      addSystemMsg(`${msg.userName} zar attı: ${faces[msg.result]} (${msg.result})`);
      break;
    }

    case 'poll_created':
      addPollMsg({
        pollId: msg.id,
        question: msg.question,
        options: msg.options,
        createdBy: msg.createdBy,
      });
      break;

    case 'poll_vote':
      updatePollVote({
        pollId: msg.pollId,
        voterId: msg.userId,
        option: msg.option,
      });
      break;
  }
}

// ─── UI: Show Room ───────────────────────────────────────
function showRoom() {
  document.getElementById('connectScreen').style.display = 'none';
  document.getElementById('header').style.display = 'flex';
  document.getElementById('mainLayout').style.display = 'grid';
  renderMenu('food');
}

// ─── UI: Users ───────────────────────────────────────────
function renderUsers() {
  const list = document.getElementById('usersList');
  const online = document.getElementById('onlineUsers');
  const count = document.getElementById('userCount');
  const userArr = Object.values(users);
  count.textContent = userArr.length;

  list.innerHTML = userArr.map(u => `
    <div class="user-item">
      <div class="user-avatar-sm" style="border:2px solid ${u.color}">${u.avatar}</div>
      <div class="user-info-sm">
        <div class="user-name-sm" style="color:${u.color}">${u.name}${u.id === ME.id ? ' (sen)' : ''}</div>
        <div class="user-status-sm">${u.status || 'Çevrimiçi'}</div>
      </div>
      <div class="user-dot"></div>
    </div>
  `).join('');

  online.innerHTML = userArr.slice(0, 8).map(u => `
    <div class="online-avatar" style="border-color:${u.color}" title="${u.name}">${u.avatar}</div>
  `).join('');
}

// ─── UI: Avatars Ring ────────────────────────────────────
function renderAvatars() {
  const ring = document.getElementById('avatarsRing');
  const userArr = Object.values(users);
  ring.innerHTML = '';

  const W = ring.offsetWidth || 600;
  const H = ring.offsetHeight || 400;
  const cx = W / 2, cy = H / 2;
  const rx = Math.min(cx - 60, 220);
  const ry = Math.min(cy - 60, 160);

  userArr.forEach((u, i) => {
    const angle = (i / userArr.length) * 2 * Math.PI - Math.PI / 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const div = document.createElement('div');
    div.className = 'avatar-seat';
    div.id = `seat-${u.id}`;
    div.style.left = x + 'px';
    div.style.top = y + 'px';
    div.innerHTML = `
      <div class="avatar-bubble" style="border-color:${u.color};color:${u.color}" id="bubble-${u.id}">${u.avatar}</div>
      <div class="avatar-name-tag" style="color:${u.color}">${u.name}</div>
    `;
    ring.appendChild(div);
  });
}

function showSpeakBubble(userId, text) {
  const bubble = document.getElementById(`bubble-${userId}`);
  const seat = document.getElementById(`seat-${userId}`);
  if (!bubble || !seat) return;
  bubble.classList.add('speaking');
  let existing = seat.querySelector('.avatar-chat-bubble');
  if (existing) existing.remove();
  const cb = document.createElement('div');
  cb.className = 'avatar-chat-bubble';
  cb.textContent = text.length > 40 ? text.slice(0, 37) + '...' : text;
  seat.appendChild(cb);
  setTimeout(() => { bubble.classList.remove('speaking'); cb.remove(); }, 4000);
}

// ─── UI: Chat ────────────────────────────────────────────
function addChatMsg(msg) {
  const el = document.getElementById('chatMessages');
  const isOwn = msg.userId === ME.id;
  const time = new Date(msg.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.className = `chat-msg ${isOwn ? 'own' : ''}`;
  div.innerHTML = `
    <div class="msg-avatar">${msg.userAvatar}</div>
    <div class="msg-content">
      <div class="msg-header" style="color:${msg.userColor}">${isOwn ? 'Sen' : msg.userName} · ${time}</div>
      <div class="msg-bubble">${escHtml(msg.text)}</div>
    </div>
  `;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function addSystemMsg(text) {
  const el = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function addPollMsg(poll) {
  const el = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.innerHTML = `
    <div class="poll-msg" id="poll-${poll.pollId}">
      <div class="poll-question">📊 ${escHtml(poll.question)}</div>
      ${poll.options.map(opt => `
        <div class="poll-option" onclick="votePoll('${poll.pollId}','${escHtml(opt)}')" data-option="${escHtml(opt)}">
          <span>${escHtml(opt)}</span><span class="vote-count" data-opt="${escHtml(opt)}">0 oy</span>
        </div>
      `).join('')}
      <div class="poll-by">📝 ${escHtml(poll.createdBy)} tarafından oluşturuldu</div>
    </div>
  `;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  polls[poll.pollId] = { ...poll, votes: {} };
}

function updatePollVote(msg) {
  const p = polls[msg.pollId];
  if (!p) return;
  p.votes[msg.voterId] = msg.option;
  const pollEl = document.getElementById(`poll-${msg.pollId}`);
  if (!pollEl) return;
  const counts = {};
  Object.values(p.votes).forEach(o => { counts[o] = (counts[o] || 0) + 1; });
  pollEl.querySelectorAll('.vote-count').forEach(el => {
    el.textContent = (counts[el.dataset.opt] || 0) + ' oy';
  });
  pollEl.querySelectorAll('.poll-option').forEach(el => {
    if (el.dataset.option === p.votes[ME.id]) el.classList.add('voted');
  });
}

// ─── Send Actions ─────────────────────────────────────────
function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  sendWs({ type: 'chat_message', text });
  input.value = '';
}

function addEmoji(emoji) {
  const input = document.getElementById('chatInput');
  input.value += emoji;
  input.focus();
}

function sendReaction(emoji) {
  sendWs({ type: 'reaction', emoji });
}

function rollDice() {
  sendWs({ type: 'dice_roll' });
}

function updateStatus(status) {
  sendWs({ type: 'status_update', status });
}

function changeTheme(theme) {
  sendWs({ type: 'change_theme', theme });
  toggleThemePanel();
}

function addSong() {
  const title = document.getElementById('songTitle').value.trim();
  const artist = document.getElementById('songArtist').value.trim();
  if (!title) return;
  sendWs({ type: 'add_song', title, artist });
  document.getElementById('songTitle').value = '';
  document.getElementById('songArtist').value = '';
}

function createPoll() {
  const question = document.getElementById('pollQuestion').value.trim();
  const o1 = document.getElementById('pollOpt1').value.trim();
  const o2 = document.getElementById('pollOpt2').value.trim();
  const o3 = document.getElementById('pollOpt3').value.trim();
  if (!question || !o1 || !o2) return showToast('⚠️ Soru ve en az 2 seçenek gerekli!');
  sendWs({ type: 'poll_create', question, options: [o1, o2, ...(o3 ? [o3] : [])] });
  closePollModal();
}

function votePoll(pollId, option) {
  sendWs({ type: 'poll_vote', pollId, option });
}

// ─── Menu ─────────────────────────────────────────────────
function renderMenu(category) {
  const el = document.getElementById('menuItems');
  el.innerHTML = MENU[category].map(item => `
    <div class="menu-item" onclick="orderItem('${escHtml(item.name)}','${item.emoji}','${category}')">
      <div class="menu-emoji">${item.emoji}</div>
      <div class="menu-name">${item.name}</div>
      <div class="menu-price">${item.price}</div>
    </div>
  `).join('');
}

function switchCategory(cat, btn) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMenu(cat);
}

function orderItem(name, emoji, category) {
  sendWs({ type: 'order', item: name, emoji, category });
  showToast(`${emoji} ${name} sipariş edildi!`);
}

function addOrderToUI(order) {
  const list = document.getElementById('ordersList');
  const div = document.createElement('div');
  div.className = 'order-item';
  const time = new Date(order.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `
    <div class="order-emoji">${order.emoji}</div>
    <div class="order-info">
      <div class="order-name">${escHtml(order.item)}</div>
      <div class="order-by" style="color:${order.userColor}">${escHtml(order.userName)} · ${time}</div>
    </div>
  `;
  list.insertBefore(div, list.firstChild);
  if (list.children.length > 20) list.lastChild.remove();
}

// ─── Table Items ──────────────────────────────────────────
function addTableItem(emoji) {
  tableItems.push(emoji);
  if (tableItems.length > 8) tableItems.shift();
  document.getElementById('tableItems').innerHTML = tableItems.map(e => `<div class="table-item">${e}</div>`).join('');
}

// ─── Reactions ────────────────────────────────────────────
function spawnReaction(emoji) {
  const layer = document.getElementById('reactionsLayer');
  const div = document.createElement('div');
  div.className = 'floating-reaction';
  div.textContent = emoji;
  div.style.left = (20 + Math.random() * 60) + '%';
  div.style.bottom = '20px';
  layer.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── Theme ────────────────────────────────────────────────
function applyTheme(theme) {
  document.getElementById('body').className = `theme-${theme}`;
}

// ─── Music ────────────────────────────────────────────────
function addSongToUI(song) {
  const el = document.getElementById('playlistEl');
  if (document.getElementById(`song-${song.id}`)) return;
  const div = document.createElement('div');
  div.className = 'playlist-item';
  div.id = `song-${song.id}`;
  div.innerHTML = `<span>🎵</span><div style="flex:1"><div style="font-weight:600">${escHtml(song.title)}</div><div style="font-size:0.7rem;color:#94a3b8">${escHtml(song.artist)} · ${escHtml(song.addedBy)}</div></div>`;
  el.appendChild(div);
}

function updateNowPlaying(song) {
  document.getElementById('nowPlaying').innerHTML = `<strong>♫ ${escHtml(song.title)}</strong> - ${escHtml(song.artist)}`;
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
  const active = document.getElementById(`song-${song.id}`);
  if (active) active.classList.add('active');
}

// ─── Panels ───────────────────────────────────────────────
function toggleThemePanel() {
  const el = document.getElementById('themePanel');
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

function toggleMusic() {
  const el = document.getElementById('musicPanel');
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}

function openPollModal() { document.getElementById('pollModal').style.display = 'flex'; }
function closePollModal(e) {
  if (!e || e.target === document.getElementById('pollModal'))
    document.getElementById('pollModal').style.display = 'none';
}

// ─── Connect Status ───────────────────────────────────────
function updateConnectStatus(text, pct) {
  document.getElementById('connectStatus').textContent = text;
  document.getElementById('connectFill').style.width = pct + '%';
}

// ─── Helpers ──────────────────────────────────────────────
function copyRoomCode() {
  navigator.clipboard.writeText(roomId).then(() => showToast('✅ Kod kopyalandı! Arkadaşlarına gönder.'));
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────
connectWebSocket();
