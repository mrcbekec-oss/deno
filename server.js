const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { randomUUID } = require("crypto");

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const rooms = new Map();
const users = new Map();

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function broadcast(room, message, excludeId) {
  const data = JSON.stringify(message);
  for (const [uid, u] of room.users) {
    if (uid !== excludeId && u.socket.readyState === 1) {
      try { u.socket.send(data); } catch { /* skip */ }
    }
  }
}

function sendTo(user, message) {
  if (user.socket.readyState === 1) {
    try { user.socket.send(JSON.stringify(message)); } catch { /* skip */ }
  }
}

function getRoomState(room) {
  return {
    type: "room_state",
    room: {
      id: room.id,
      name: room.name,
      theme: room.theme,
      users: [...room.users.values()].map(u => ({
        id: u.id, name: u.name, avatar: u.avatar, color: u.color, status: u.status,
      })),
      orders: room.orders.slice(-20),
      playlist: room.playlist,
      currentSong: room.currentSong,
    },
  };
}

function handleMessage(socket, myIdRef, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  const type = msg.type;

  if (type === "join_room") {
    const userId = randomUUID();
    myIdRef.id = userId;

    const requestedRoomId = (msg.roomId || "").toUpperCase();
    let room = requestedRoomId ? rooms.get(requestedRoomId) : undefined;

    if (!room) {
      if (requestedRoomId) {
        try {
          socket.send(JSON.stringify({ type: "join_error", message: "Oda bulunamadı" }));
        } catch { /* skip */ }
        socket.close();
        return;
      }
      const roomId = generateRoomCode();
      room = {
        id: roomId,
        name: msg.roomName || "Arkadaş Odası",
        theme: "cafe",
        users: new Map(),
        orders: [],
        playlist: [],
        currentSong: null,
      };
      rooms.set(roomId, room);
      console.log(`Oda oluşturuldu: ${roomId}`);
    }

    const roomId = room.id;
    const user = {
      id: userId,
      name: msg.name || "Misafir",
      avatar: msg.avatar || "😊",
      color: msg.color || "#7c3aed",
      status: "Çevrimiçi",
      socket,
      roomId,
    };
    room.users.set(userId, user);
    users.set(userId, user);

    console.log(`Kullanıcı katıldı: ${user.name} → oda ${roomId}`);

    sendTo(user, { type: "joined", userId, roomId });
    sendTo(user, getRoomState(room));
    broadcast(room, {
      type: "user_joined",
      user: { id: userId, name: user.name, avatar: user.avatar, color: user.color, status: user.status },
    }, userId);
    broadcast(room, {
      type: "system_message",
      text: `${user.name} odaya katıldı! 🎉`,
      timestamp: Date.now(),
    }, userId);
    return;
  }

  const myId = myIdRef.id;
  if (!myId) return;

  const user = users.get(myId);
  if (!user) return;
  const room = rooms.get(user.roomId);
  if (!room) return;

  if (type === "chat_message") {
    const payload = {
      type: "chat_message",
      id: randomUUID(),
      userId: myId,
      userName: user.name,
      userAvatar: user.avatar,
      userColor: user.color,
      text: msg.text,
      timestamp: Date.now(),
    };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "order") {
    const order = {
      id: randomUUID(),
      userId: myId,
      userName: user.name,
      userColor: user.color,
      item: msg.item,
      emoji: msg.emoji,
      category: msg.category,
      timestamp: Date.now(),
    };
    room.orders.push(order);
    if (room.orders.length > 50) room.orders.shift();
    const payload = { type: "new_order", order };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "reaction") {
    const payload = {
      type: "reaction",
      userId: myId,
      userName: user.name,
      emoji: msg.emoji,
      timestamp: Date.now(),
    };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "add_song") {
    const song = {
      id: randomUUID(),
      title: msg.title,
      artist: msg.artist || "",
      addedBy: user.name,
      emoji: "🎵",
    };
    room.playlist.push(song);
    if (!room.currentSong) room.currentSong = song;
    const payload = { type: "song_added", song, playlist: room.playlist, currentSong: room.currentSong };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "change_theme") {
    room.theme = msg.theme;
    const payload = { type: "theme_changed", theme: room.theme, changedBy: user.name };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "status_update") {
    user.status = msg.status;
    const payload = { type: "user_status_updated", userId: myId, status: user.status };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "dice_roll") {
    const result = Math.floor(Math.random() * 6) + 1;
    const payload = { type: "dice_result", userId: myId, userName: user.name, result, timestamp: Date.now() };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "poll_create") {
    const payload = {
      type: "poll_created",
      id: randomUUID(),
      question: msg.question,
      options: msg.options,
      createdBy: user.name,
      timestamp: Date.now(),
    };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "poll_vote") {
    const payload = {
      type: "poll_vote",
      pollId: msg.pollId,
      userId: myId,
      userName: user.name,
      option: msg.option,
    };
    broadcast(room, payload);
    sendTo(user, payload);
  } else if (type === "ping") {
    sendTo(user, { type: "pong" });
  }
}

function handleDisconnect(myIdRef) {
  const myId = myIdRef.id;
  if (!myId) return;
  const user = users.get(myId);
  if (!user) return;
  const room = rooms.get(user.roomId);
  if (room) {
    room.users.delete(myId);
    broadcast(room, { type: "user_left", userId: myId, userName: user.name });
    broadcast(room, { type: "system_message", text: `${user.name} odadan ayrıldı 👋`, timestamp: Date.now() });
    if (room.users.size === 0) {
      setTimeout(() => {
        if (rooms.get(user.roomId)?.users.size === 0) rooms.delete(user.roomId);
      }, 300_000);
    }
  }
  users.delete(myId);
  console.log(`Kullanıcı ayrıldı: ${user.name}`);
}

function serveStatic(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === "/" ? "index.html" : req.url);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith("/api/room/")) {
    const roomId = url.pathname.split("/")[3];
    const room = rooms.get(roomId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(room
      ? { exists: true, id: room.id, name: room.name, userCount: room.users.size }
      : { exists: false }));
    return;
  }

  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  console.log("WS: bağlandı");
  const myIdRef = { id: null };

  socket.on("message", (data) => handleMessage(socket, myIdRef, data.toString()));
  socket.on("close", () => handleDisconnect(myIdRef));
  socket.on("error", (e) => console.error("WS hatası:", e));
});

server.listen(PORT, () => {
  console.log(`🏠 SanalOda: http://localhost:${PORT}`);
});
