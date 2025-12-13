// server/server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// Her yerden gelen isteğe izin ver (şimdilik)
// İleride sadece kendi domainini yazabiliriz.
app.use(
  cors({
    origin: "*",
  })
);

app.get("/", (req, res) => {
  res.send("uzakyardim signaling server is running");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Odaya katılma
io.on("connection", (socket) => {
  console.log("Yeni bağlantı:", socket.id);

  socket.on("join-room", (roomId) => {
    console.log(`Kullanıcı ${socket.id} oda ${roomId} odasına katıldı`);
    socket.join(roomId);
    // Odadaki diğerlerine haber ver (örneğin host ise yeni viewer geldi)
    socket.to(roomId).emit("user-joined");
  });

  // WebRTC sinyalleme (offer/answer/candidate)
  socket.on("signal", ({ roomId, data }) => {
    if (!roomId || !data) return;
    socket.to(roomId).emit("signal", { from: socket.id, data });
  });

  // Destek verenin tıkladığı nokta (pointer)
  socket.on("pointer", (payload) => {
    const { roomId, ...rest } = payload || {};
    if (!roomId) return;
    socket.to(roomId).emit("pointer", rest);
  });

  // Chat mesajı
  socket.on("chat-message", ({ roomId, text, role }) => {
    if (!roomId || !text) return;
    socket.to(roomId).emit("chat-message", { text, role });
  });

  socket.on("disconnect", () => {
    console.log("Bağlantı koptu:", socket.id);
  });
});

// Render gibi ortamlarda PORT environment'tan gelir
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Signaling server ${PORT} portunda çalışıyor`);
});