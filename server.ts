import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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
  createdAt: number;
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
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function broadcast(room: Room, message: unknown, excludeUserId?: string) {
  const data = JSON.stringify(message);
  for (const [userId, user] of room.users) {
    if (userId !== excludeUserId && user.socket.readyState === WebSocket.OPEN) {
      try {
        user.socket.send(data);
      } catch (_) { /* ignore */ }
    }
  }
}

function sendTo(user: User, message: unknown) {
  if (user.socket.readyState === WebSocket.OPEN) {
    try {
      user.socket.send(JSON.stringify(message));
    } catch (_) { /* ignore */ }
  }
}

function getRoomState(room: Room) {
  return {
    type: "room_state",
    room: {
      id: room.id,
      name: room.name,
      theme: room.theme,
      users: Array.from(room.users.values()).map((u) => ({
        id: u.id,
        name: u.name,
        avatar: u.avatar,
        color: u.color,
        status: u.status,
      })),
      orders: room.orders.slice(-20),
      playlist: room.playlist,
      currentSong: room.currentSong,
    },
  };
}

function handleWebSocket(socket: WebSocket) {
  let currentUserId: string | null = null;

  socket.onopen = () => {
    console.log("Yeni bağlantı açıldı");
  };

  socket.onmessage = (event) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    const type = msg.type as string;

    if (type === "join_room") {
      const userId = crypto.randomUUID();
      currentUserId = userId;

      let roomId = msg.roomId as string;
      let room: Room;

      if (roomId && rooms.has(roomId)) {
        room = rooms.get(roomId)!;
      } else {
        roomId = generateRoomCode();
        room = {
          id: roomId,
          name: (msg.roomName as string) || "Arkadaş Odası",
          theme: "cafe",
          users: new Map(),
          orders: [],
          playlist: [],
          currentSong: null,
          createdAt: Date.now(),
        };
        rooms.set(roomId, room);
      }

      const user: User = {
        id: userId,
        name: (msg.name as string) || "Misafir",
        avatar: (msg.avatar as string) || "😊",
        color: (msg.color as string) || "#6366f1",
        status: "Çevrimiçi",
        socket,
        roomId,
      };

      room.users.set(userId, user);
      users.set(userId, user);

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

    } else if (type === "chat_message" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      const message = {
        type: "chat_message",
        id: crypto.randomUUID(),
        userId: currentUserId,
        userName: user.name,
        userAvatar: user.avatar,
        userColor: user.color,
        text: msg.text as string,
        timestamp: Date.now(),
      };

      broadcast(room, message);
      sendTo(user, message);

    } else if (type === "order" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      const order: Order = {
        id: crypto.randomUUID(),
        userId: currentUserId,
        userName: user.name,
        userColor: user.color,
        item: msg.item as string,
        emoji: msg.emoji as string,
        category: msg.category as string,
        timestamp: Date.now(),
      };

      room.orders.push(order);
      if (room.orders.length > 50) room.orders.shift();

      const orderMsg = { type: "new_order", order };
      broadcast(room, orderMsg);
      sendTo(user, orderMsg);

    } else if (type === "reaction" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      const reactionMsg = {
        type: "reaction",
        userId: currentUserId,
        userName: user.name,
        emoji: msg.emoji as string,
        timestamp: Date.now(),
      };
      broadcast(room, reactionMsg);
      sendTo(user, reactionMsg);

    } else if (type === "add_song" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      const song: Song = {
        id: crypto.randomUUID(),
        title: msg.title as string,
        artist: msg.artist as string,
        addedBy: user.name,
        emoji: msg.emoji as string || "🎵",
      };

      room.playlist.push(song);
      if (!room.currentSong) room.currentSong = song;

      const songMsg = { type: "song_added", song, playlist: room.playlist, currentSong: room.currentSong };
      broadcast(room, songMsg);
      sendTo(user, songMsg);

    } else if (type === "change_theme" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      room.theme = msg.theme as string;
      const themeMsg = { type: "theme_changed", theme: room.theme, changedBy: user.name };
      broadcast(room, themeMsg);
      sendTo(user, themeMsg);

    } else if (type === "status_update" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      user.status = msg.status as string;
      const statusMsg = { type: "user_status_updated", userId: currentUserId, status: user.status };
      broadcast(room, statusMsg);
      sendTo(user, statusMsg);

    } else if (type === "dice_roll" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      const result = Math.floor(Math.random() * 6) + 1;
      const diceMsg = { type: "dice_result", userId: currentUserId, userName: user.name, result, timestamp: Date.now() };
      broadcast(room, diceMsg);
      sendTo(user, diceMsg);

    } else if (type === "poll_create" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      const pollMsg = {
        type: "poll_created",
        id: crypto.randomUUID(),
        question: msg.question as string,
        options: msg.options as string[],
        votes: {},
        createdBy: user.name,
        timestamp: Date.now(),
      };
      broadcast(room, pollMsg);
      sendTo(user, pollMsg);

    } else if (type === "poll_vote" && currentUserId) {
      const user = users.get(currentUserId);
      if (!user) return;
      const room = rooms.get(user.roomId);
      if (!room) return;

      const voteMsg = {
        type: "poll_vote",
        pollId: msg.pollId as string,
        userId: currentUserId,
        userName: user.name,
        option: msg.option as string,
      };
      broadcast(room, voteMsg);
      sendTo(user, voteMsg);
    }
  };

  socket.onclose = () => {
    if (!currentUserId) return;
    const user = users.get(currentUserId);
    if (!user) return;

    const room = rooms.get(user.roomId);
    if (room) {
      room.users.delete(currentUserId);
      broadcast(room, {
        type: "user_left",
        userId: currentUserId,
        userName: user.name,
      });
      broadcast(room, {
        type: "system_message",
        text: `${user.name} odadan ayrıldı 👋`,
        timestamp: Date.now(),
      });

      if (room.users.size === 0) {
        setTimeout(() => {
          if (rooms.get(user.roomId)?.users.size === 0) {
            rooms.delete(user.roomId);
            console.log(`Oda silindi: ${user.roomId}`);
          }
        }, 300000); // 5 dk sonra sil
      }
    }

    users.delete(currentUserId);
    console.log(`Kullanıcı ayrıldı: ${user.name}`);
  };

  socket.onerror = (e) => console.error("WebSocket hatası:", e);
}

const PORT = 8080;

await serve((req) => {
  const url = new URL(req.url);

  if (url.pathname === "/ws") {
    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      handleWebSocket(socket);
      return response;
    }
    return new Response("WebSocket bağlantısı gerekli", { status: 400 });
  }

  // API: oda bilgisi
  if (url.pathname.startsWith("/api/room/")) {
    const roomId = url.pathname.split("/")[3];
    const room = rooms.get(roomId);
    if (room) {
      return new Response(JSON.stringify({
        exists: true,
        id: room.id,
        name: room.name,
        userCount: room.users.size,
      }), { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ exists: false }), { headers: { "content-type": "application/json" } });
  }

  return serveDir(req, { fsRoot: "./public", urlRoot: "" });
}, { port: PORT, onListen: () => console.log(`🏠 Sanal Oda sunucusu çalışıyor: http://localhost:${PORT}`) });
