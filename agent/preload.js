// agent/preload.js

const { contextBridge } = require("electron");
const { io } = require("socket.io-client");

// Render’daki uzakyardim server URL’in
const SIGNAL_SERVER_URL = "https://uzakyardim.onrender.com";

let socket = null;

contextBridge.exposeInMainWorld("agentApi", {
  connect: (roomId, logCb, statusCb) => {
    try {
      if (!roomId || !roomId.trim()) {
        statusCb("Lütfen geçerli bir Oda ID girin.");
        return;
      }

      const agentId = Math.random().toString(36).slice(2);
      statusCb("Sunucuya bağlanılıyor...");

      socket = io(SIGNAL_SERVER_URL, {
        transports: ["websocket"]
      });

      socket.on("connect", () => {
        logCb("Sunucuya bağlanıldı. Socket ID: " + socket.id);
        statusCb("Bağlı");

        socket.emit("agent-register", {
          roomId: roomId.trim(),
          agentId,
          role: "agent"
        });

        logCb(`Odaya agent olarak kaydedildi. Room: ${roomId}, AgentId: ${agentId}`);
      });

      socket.on("disconnect", () => {
        logCb("Sunucu bağlantısı kesildi.");
        statusCb("Bağlı değil");
      });

      // Uzmandan gelen komutlar
      socket.on("agent-command", (command) => {
        logCb("Komut alındı: " + JSON.stringify(command));

        if (command.type === "show-message") {
          // Şimdilik basit: browser tarafında alert göster
          alert("Uzaktan Destek Mesajı:\n\n" + command.text);
        }
      });
    } catch (err) {
      console.error(err);
      statusCb("Hata: " + err.message);
    }
  },

  disconnect: (logCb, statusCb) => {
    if (socket) {
      socket.disconnect();
      socket = null;
      logCb("Bağlantı kapatıldı.");
      statusCb("Bağlı değil");
    }
  }
});