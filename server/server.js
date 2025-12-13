// server/server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("Bir kullanıcı bağlandı:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`${socket.id} odaya katıldı: ${roomId}`);
    socket.to(roomId).emit("user-joined", socket.id);
  });

  // WebRTC offer/answer/iceCandidate mesajlarını taşıma
  socket.on("signal", ({ roomId, data }) => {
    socket.to(roomId).emit("signal", {
      from: socket.id,
      data,
    });
  });

  // Destek verenin tıkladığı noktaları host'a ilet (pointer)
  socket.on("pointer", ({ roomId, x, y, type }) => {
    socket.to(roomId).emit("pointer", { x, y, type });
  });

  // Basit chat mesajlarını oda içindeki diğer tarafa ilet
  socket.on("chat-message", ({ roomId, text, role }) => {
    // Gönderen hariç odaya yayınla
    socket.to(roomId).emit("chat-message", { text, role });
  });

  socket.on("disconnect", () => {
    console.log("Kullanıcı ayrıldı:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server ${PORT} portunda çalışıyor`);
});