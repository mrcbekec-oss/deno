import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

interface User {
  id: string;
  name: string;
  avatar: string;
  color: string;
  status: string;
  socket: WebSocket;
  roomId: string;
}

interface Room {
  id: string;
  name: string;
  theme: string;
  users: Map<string, User>;
  orders: Order[];
  playlist: Song[];
  currentSong: Song | null;
}

interface Order {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  item: string;
  emoji: string;
  category: string;
  timestamp: number;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  addedBy: string;
  emoji: string;
}

const rooms = new Map<string, Room>();
const users = new Map<string, User>();

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function broadcast(room: Room, message: unknown, excludeId?: string) {
  const data = JSON.stringify(message);
  for (const [uid, u] of room.users) {
    if (uid !== excludeId && u.socket.readyState === 1) {
      try { u.socket.send(data); } catch (_) { /* skip */ }
    }
  }
}

function sendTo(user: User, message: unknown) {
  if (user.socket.readyState === 1) {
    try { user.socket.send(JSON.stringify(message)); } catch (_) { /* skip */ }
  }
}

function getRoomState(room: Room) {
  return {
    type: "room_state",
    room: {
      id: room.id,
      name: room.name,
      theme: room.theme,
      users: [...room.users.values()].map(u => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color, status: u.status })),
      orders: room.orders.slice(-20),
      playlist: room.playlist,
      currentSong: room.currentSong,
    },
  };
}

function handleWebSocket(socket: WebSocket) {
  let myId: string | null = null;

  socket.addEventListener("open", () => {
    console.log("WS: bağlandı");
  });

  socket.addEventListener("message", (event) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(event.data as string); } catch { return; }

    const type = msg.type as string;

    if (type === "join_room") {
      const userId = crypto.randomUUID();
      myId = userId;

      let roomId = (msg.roomId as string) || "";
      let room = rooms.get(roomId);

      if (!room) {
        roomId = generateRoomCode();
        room = { id: roomId, name: (msg.roomName as string) || "Arkadaş Odası", theme: "cafe", users: new Map(), orders: [], playlist: [], currentSong: null };
        rooms.set(roomId, room);
        console.log(`Oda oluşturuldu: ${roomId}`);
      }

      const user: User = { id: userId, name: (msg.name as string) || "Misafir", avatar: (msg.avatar as string) || "😊", color: (msg.color as string) || "#7c3aed", status: "Çevrimiçi", socket, roomId };
      room.users.set(userId, user);
      users.set(userId, user);

      console.log(`Kullanıcı katıldı: ${user.name} → oda ${roomId}`);

      sendTo(user, { type: "joined", userId, roomId });
      sendTo(user, getRoomState(room));
      broadcast(room, { type: "user_joined", user: { id: userId, name: user.name, avatar: user.avatar, color: user.color, status: user.status } }, userId);
      broadcast(room, { type: "system_message", text: `${user.name} odaya katıldı! 🎉`, timestamp: Date.now() }, userId);

    } else if (myId) {
      const user = users.get(myId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      if (type === "chat_message") {
        const msg2 = { type: "chat_message", id: crypto.randomUUID(), userId: myId, userName: user.name, userAvatar: user.avatar, userColor: user.color, text: msg.text as string, timestamp: Date.now() };
        broadcast(room, msg2);
        sendTo(user, msg2);

      } else if (type === "order") {
        const order: Order = { id: crypto.randomUUID(), userId: myId, userName: user.name, userColor: user.color, item: msg.item as string, emoji: msg.emoji as string, category: msg.category as string, timestamp: Date.now() };
        room.orders.push(order);
        if (room.orders.length > 50) room.orders.shift();
        const om = { type: "new_order", order };
        broadcast(room, om); sendTo(user, om);

      } else if (type === "reaction") {
        const rm = { type: "reaction", userId: myId, userName: user.name, emoji: msg.emoji as string, timestamp: Date.now() };
        broadcast(room, rm); sendTo(user, rm);

      } else if (type === "add_song") {
        const song: Song = { id: crypto.randomUUID(), title: msg.title as string, artist: (msg.artist as string) || "", addedBy: user.name, emoji: "🎵" };
        room.playlist.push(song);
        if (!room.currentSong) room.currentSong = song;
        const sm = { type: "song_added", song, playlist: room.playlist, currentSong: room.currentSong };
        broadcast(room, sm); sendTo(user, sm);

      } else if (type === "change_theme") {
        room.theme = msg.theme as string;
        const tm = { type: "theme_changed", theme: room.theme, changedBy: user.name };
        broadcast(room, tm); sendTo(user, tm);

      } else if (type === "status_update") {
        user.status = msg.status as string;
        const su = { type: "user_status_updated", userId: myId, status: user.status };
        broadcast(room, su); sendTo(user, su);

      } else if (type === "dice_roll") {
        const result = Math.floor(Math.random() * 6) + 1;
        const dm = { type: "dice_result", userId: myId, userName: user.name, result, timestamp: Date.now() };
        broadcast(room, dm); sendTo(user, dm);

      } else if (type === "poll_create") {
        const pm = { type: "poll_created", id: crypto.randomUUID(), question: msg.question as string, options: msg.options as string[], createdBy: user.name, timestamp: Date.now() };
        broadcast(room, pm); sendTo(user, pm);

      } else if (type === "poll_vote") {
        const vm = { type: "poll_vote", pollId: msg.pollId as string, userId: myId, userName: user.name, option: msg.option as string };
        broadcast(room, vm); sendTo(user, vm);

      } else if (type === "ping") {
        sendTo(user, { type: "pong" });
      }
    }
  });

  socket.addEventListener("close", () => {
    if (!myId) return;
    const user = users.get(myId);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (room) {
      room.users.delete(myId);
      broadcast(room, { type: "user_left", userId: myId, userName: user.name });
      broadcast(room, { type: "system_message", text: `${user.name} odadan ayrıldı 👋`, timestamp: Date.now() });
      if (room.users.size === 0) setTimeout(() => { if (rooms.get(user.roomId)?.users.size === 0) rooms.delete(user.roomId); }, 300_000);
    }
    users.delete(myId);
    console.log(`Kullanıcı ayrıldı: ${user.name}`);
  });

  socket.addEventListener("error", (e) => {
    console.error("WS hatası:", e);
  });
}

const PORT = 8080;

Deno.serve({ port: PORT, onListen: () => console.log(`🏠 SanalOda: http://localhost:${PORT}`) }, async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/ws") {
    const upgrade = req.headers.get("upgrade") || "";
    if (upgrade.toLowerCase() !== "websocket") {
      return new Response("WebSocket gerekli", { status: 426 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket);
    return response;
  }

  if (url.pathname.startsWith("/api/room/")) {
    const roomId = url.pathname.split("/")[3];
    const room = rooms.get(roomId);
    return new Response(JSON.stringify(room ? { exists: true, id: room.id, name: room.name, userCount: room.users.size } : { exists: false }), { headers: { "content-type": "application/json" } });
  }

  return serveDir(req, { fsRoot: "./public", urlRoot: "" });
});
