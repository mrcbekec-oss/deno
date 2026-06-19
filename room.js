// ─── State ───────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const ME = {
  name: params.get('name') || 'Misafir',
  avatar: params.get('avatar') || '😊',
  color: params.get('color') || '#7c3aed',
  id: 'user_' + Math.random().toString(36).slice(2, 9),
};
const ACTION = params.get('action') || 'create';
const INITIAL_ROOM_ID = params.get('roomId') || null;
const ROOM_NAME = params.get('roomName') || 'Arkadaş Odası';

let db = null;
let roomId = null;
let users = {};
let polls = {};
let currentTheme = 'cafe';
let tableItems = [];
let unsubscribers = [];

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

// ─── Firebase Init ───────────────────────────────────────
async function initFirebase() {
  updateConnectStatus('Firebase bağlanıyor...', 30);

  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const { getDatabase, ref, push, set, onChildAdded, onValue, onDisconnect, serverTimestamp, remove } =
    await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');

  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  window._fbRef = ref;
  window._fbPush = push;
  window._fbSet = set;
  window._fbOnChildAdded = onChildAdded;
  window._fbOnValue = onValue;
  window._fbOnDisconnect = onDisconnect;
  window._fbServerTimestamp = serverTimestamp;
  window._fbRemove = remove;

  updateConnectStatus('Odaya bağlanılıyor...', 60);
  await joinOrCreateRoom();
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Room Join/Create ────────────────────────────────────
async function joinOrCreateRoom() {
  const { ref, set, onValue, push, onChildAdded, onDisconnect, serverTimestamp } = getHelpers();

  if (ACTION === 'join' && INITIAL_ROOM_ID) {
    // Var olan odaya katıl
    roomId = INITIAL_ROOM_ID.toUpperCase();
    const roomRef = ref(db, `rooms/${roomId}`);
    const snap = await new Promise(res => onValue(roomRef, res, { onlyOnce: true }));
    if (!snap.exists()) {
      updateConnectStatus('❌ Oda bulunamadı!', 100);
      setTimeout(() => location.href = 'index.html', 2000);
      return;
    }
    const roomData = snap.val();
    document.getElementById('headerRoomName').textContent = roomData.name || roomId;
  } else {
    // Yeni oda oluştur
    roomId = generateRoomCode();
    await set(ref(db, `rooms/${roomId}`), {
      name: ROOM_NAME,
      theme: 'cafe',
      createdAt: Date.now(),
    });
  }

  document.getElementById('headerRoomCode').textContent = roomId;

  // Kullanıcıyı odaya ekle
  const userRef = ref(db, `rooms/${roomId}/users/${ME.id}`);
  await set(userRef, {
    id: ME.id,
    name: ME.name,
    avatar: ME.avatar,
    color: ME.color,
    status: 'Çevrimiçi',
    joinedAt: Date.now(),
  });

  // Sekme kapanınca kullanıcıyı sil
  const disc = onDisconnect(userRef);
  disc.remove();

  updateConnectStatus('Odaya girildi! ✅', 100);

  // Dinleyicileri başlat
  subscribeToRoom();

  // Sisteme giriş mesajı gönder
  sendSystemMessage(`${ME.name} odaya katıldı! 🎉`);

  setTimeout(showRoom, 600);
}

// ─── Subscribe to Room ───────────────────────────────────
function subscribeToRoom() {
  const { ref, onValue, onChildAdded } = getHelpers();

  // Kullanıcılar
  const usersRef = ref(db, `rooms/${roomId}/users`);
  onValue(usersRef, (snap) => {
    users = snap.val() || {};
    renderUsers();
    renderAvatars();
  });

  // Tema
  const themeRef = ref(db, `rooms/${roomId}/theme`);
  onValue(themeRef, (snap) => {
    if (snap.val()) { currentTheme = snap.val(); applyTheme(currentTheme); }
  });

  // Mesajlar (sadece yeni gelenler)
  const msgsRef = ref(db, `rooms/${roomId}/messages`);
  onChildAdded(msgsRef, (snap) => {
    const msg = snap.val();
    if (!msg) return;
    if (msg.type === 'chat') {
      addChatMsg(msg);
      showSpeakBubble(msg.userId, msg.text);
    } else if (msg.type === 'system') {
      addSystemMsg(msg.text);
    } else if (msg.type === 'reaction') {
      spawnReaction(msg.emoji);
    } else if (msg.type === 'dice') {
      const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
      addSystemMsg(`${msg.userName} zar attı: ${faces[msg.result]} (${msg.result})`);
    } else if (msg.type === 'poll') {
      addPollMsg(msg);
    } else if (msg.type === 'poll_vote') {
      updatePollVote(msg);
    }
  });

  // Siparişler
  const ordersRef = ref(db, `rooms/${roomId}/orders`);
  onChildAdded(ordersRef, (snap) => {
    const order = snap.val();
    if (order) { addOrderToUI(order); addTableItem(order.emoji); }
  });

  // Müzik
  const playlistRef = ref(db, `rooms/${roomId}/playlist`);
  onChildAdded(playlistRef, (snap) => {
    const song = snap.val();
    if (song) addSongToUI(song);
  });

  const currentSongRef = ref(db, `rooms/${roomId}/currentSong`);
  onValue(currentSongRef, (snap) => {
    if (snap.val()) updateNowPlaying(snap.val());
  });
}

// ─── Helpers ─────────────────────────────────────────────
function getHelpers() {
  return {
    ref: window._fbRef,
    push: window._fbPush,
    set: window._fbSet,
    onChildAdded: window._fbOnChildAdded,
    onValue: window._fbOnValue,
    onDisconnect: window._fbOnDisconnect,
    serverTimestamp: window._fbServerTimestamp,
    remove: window._fbRemove,
  };
}

function pushMessage(data) {
  const { ref, push } = getHelpers();
  push(ref(db, `rooms/${roomId}/messages`), { ...data, timestamp: Date.now() });
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
  pushMessage({ type: 'chat', userId: ME.id, userName: ME.name, userAvatar: ME.avatar, userColor: ME.color, text });
  input.value = '';
}

function addEmoji(emoji) {
  const input = document.getElementById('chatInput');
  input.value += emoji;
  input.focus();
}

function sendReaction(emoji) {
  pushMessage({ type: 'reaction', userId: ME.id, userName: ME.name, emoji });
}

function sendSystemMessage(text) {
  pushMessage({ type: 'system', text });
}

function rollDice() {
  const result = Math.floor(Math.random() * 6) + 1;
  pushMessage({ type: 'dice', userId: ME.id, userName: ME.name, result });
}

function updateStatus(status) {
  const { ref, set } = getHelpers();
  set(ref(db, `rooms/${roomId}/users/${ME.id}/status`), status);
}

function changeTheme(theme) {
  const { ref, set } = getHelpers();
  set(ref(db, `rooms/${roomId}/theme`), theme);
  toggleThemePanel();
}

function addSong() {
  const title = document.getElementById('songTitle').value.trim();
  const artist = document.getElementById('songArtist').value.trim();
  if (!title) return;
  const { ref, push, set } = getHelpers();
  const songRef = push(ref(db, `rooms/${roomId}/playlist`));
  const song = { id: songRef.key, title, artist, addedBy: ME.name, emoji: '🎵' };
  set(songRef, song);
  // İlk şarkıysa currentSong yap
  const { onValue } = getHelpers();
  onValue(ref(db, `rooms/${roomId}/currentSong`), (snap) => {
    if (!snap.val()) set(ref(db, `rooms/${roomId}/currentSong`), song);
  }, { onlyOnce: true });
  document.getElementById('songTitle').value = '';
  document.getElementById('songArtist').value = '';
}

function createPoll() {
  const question = document.getElementById('pollQuestion').value.trim();
  const o1 = document.getElementById('pollOpt1').value.trim();
  const o2 = document.getElementById('pollOpt2').value.trim();
  const o3 = document.getElementById('pollOpt3').value.trim();
  if (!question || !o1 || !o2) return showToast('⚠️ Soru ve en az 2 seçenek gerekli!');
  const pollId = 'poll_' + Math.random().toString(36).slice(2, 9);
  pushMessage({ type: 'poll', pollId, question, options: [o1, o2, ...(o3 ? [o3] : [])], createdBy: ME.name });
  closePollModal();
}

function votePoll(pollId, option) {
  pushMessage({ type: 'poll_vote', pollId, voterId: ME.id, userName: ME.name, option });
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
  const { ref, push, set } = getHelpers();
  const orderRef = push(ref(db, `rooms/${roomId}/orders`));
  set(orderRef, {
    id: orderRef.key,
    userId: ME.id, userName: ME.name, userColor: ME.color,
    item: name, emoji, category, timestamp: Date.now(),
  });
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
initFirebase().catch(err => {
  updateConnectStatus('❌ Firebase bağlantı hatası! Config dosyasını kontrol et.', 100);
  console.error(err);
});
