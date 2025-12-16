// agent/renderer.js
const { io } = require("socket.io-client");

const SIGNAL_URL = "https://uzakyardim.onrender.com";

let socket = null;
let currentRoomId = "";

// DOM referansları
const roomInput = document.getElementById("roomIdInput");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const statusBox = document.getElementById("statusBox");

function logStatus(text, type = "system") {
  const line = document.createElement("div");
  line.className = `status-line ${type}`;
  line.textContent = text;
  statusBox.appendChild(line);
  statusBox.scrollTop = statusBox.scrollHeight;
}

function setConnectedUI(connected) {
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;
  roomInput.disabled = connected;
}

function connectAgent() {
  const roomId = roomInput.value.trim();
  if (!roomId) {
    logStatus("Oda ID boş olamaz.", "error");
    return;
  }

  currentRoomId = roomId;

  logStatus("Sinyal sunucusuna bağlanılıyor...", "system");

  socket = io(SIGNAL_URL, {
    transports: ["websocket"]
  });

  socket.on("connect", () => {
    logStatus(`Sunucuya bağlanıldı (id: ${socket.id}).`, "ok");

    // Aynı oda ID ile agent olarak katıl
    socket.emit("join-room", {
      roomId: currentRoomId,
      role: "agent"
    });

    // Web arayüzündeki chatte görünsün diye basit bir mesaj gönderiyoruz
    socket.emit("chat-message", {
      roomId: currentRoomId,
      message: {
        id: `agent-${Date.now()}`,
        from: "Sistem",
        text: "Masaüstü agent bu odaya bağlandı.",
        ts: Date.now()
      }
    });

    logStatus(`Odaya katılım talebi gönderildi (#${currentRoomId}).`, "ok");
    setConnectedUI(true);
  });

  socket.on("disconnect", () => {
    logStatus("Sunucuyla bağlantı kesildi.", "error");
    setConnectedUI(false);
  });

  socket.on("connect_error", (err) => {
    logStatus(`Bağlantı hatası: ${err.message}`, "error");
  });

  // İleride: web arayüzünden gelecek komutlar (mouse/klavye, dosya vs.)
  // socket.on("agent-command", (cmd) => { ... });
}

function disconnectAgent() {
  if (socket) {
    socket.disconnect();
    socket = null;
    logStatus("Bağlantı istemci tarafından kapatıldı.", "system");
  }
  setConnectedUI(false);
}

// UI eventleri
connectBtn.addEventListener("click", () => {
  if (!socket) {
    connectAgent();
  }
});

disconnectBtn.addEventListener("click", () => {
  disconnectAgent();
});

// Enter ile bağlanma
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    connectAgent();
  }
});