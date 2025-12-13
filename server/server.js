// server/server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/", (_req, res) => {
  res.send("Uzakyardim signalling server is running.");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// roomId -> { hostId?: string }
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join-room", ({ roomId, role }) => {
    if (!roomId || !role) return;

    console.log(`join-room: ${roomId} role=${role} socket=${socket.id}`);

    if (role === "host") {
      let room = rooms.get(roomId);
      if (!room) {
        room = {};
        rooms.set(roomId, room);
      }
      room.hostId = socket.id;
      socket.join(roomId);
      console.log(`Host joined room ${roomId}`);
    } else if (role === "viewer") {
      const room = rooms.get(roomId);
      if (!room || !room.hostId) {
        console.log(`room-not-found for viewer in room ${roomId}`);
        socket.emit("room-not-found");
        return;
      }
      socket.join(roomId);
      socket.to(roomId).emit("user-joined");
      console.log(`Viewer joined room ${roomId}`);
    }
  });

  socket.on("signal", ({ roomId, data }) => {
    if (!roomId || !data) return;
    socket.to(roomId).emit("signal", { from: socket.id, data });
  });

  socket.on("chat-message", ({ roomId, message }) => {
    if (!roomId || !message) return;
    io.to(roomId).emit("chat-message", message);
  });

  socket.on("remote-pointer", ({ roomId, x, y }) => {
    if (!roomId || typeof x !== "number" || typeof y !== "number") return;
    socket.to(roomId).emit("remote-pointer", { x, y });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    // Host ayrılmışsa ilgili odamı temizle
    for (const [roomId, room] of rooms.entries()) {
      if (room.hostId === socket.id) {
        rooms.delete(roomId);
        console.log(`Host left, room ${roomId} cleaned`);
        io.to(roomId).emit("chat-message", {
          id: `${roomId}-${Date.now()}`,
          from: "Sistem",
          text: "Destek alan oturumu kapattı.",
          ts: Date.now(),
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signalling server listening on port ${PORT}`);
});