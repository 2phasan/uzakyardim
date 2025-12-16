// agent/main.js
const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 520,
    title: "Uzakyardim Agent",
    resizable: false,
    webPreferences: {
      nodeIntegration: true,      // Kolaylık için açık
      contextIsolation: false     // Şimdilik kapalı (ileride sıkılaştırırız)
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Mac'te cmd+Q kapanana kadar açık kalabilir, ama agent için
  // hem Mac hem Windows'ta kapanınca uygulamayı sonlandırıyoruz.
  app.quit();
});