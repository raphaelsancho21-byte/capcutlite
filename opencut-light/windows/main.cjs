const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

let server = null;
let win = null;
let stopping = false;

function freePort() {
  return new Promise((resolve, reject) => {
    const sock = net.createServer();
    sock.once("error", reject);
    sock.listen(0, "127.0.0.1", () => {
      const addr = sock.address();
      const port = typeof addr === "object" ? addr.port : null;
      sock.close(() => port ? resolve(port) : reject(new Error("No available local port")));
    });
  });
}

function waitForServer(url, deadline = Date.now() + 90000) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(url, response => {
        response.resume();
        resolve();
      }).on("error", err => {
        if (Date.now() >= deadline) reject(err);
        else setTimeout(attempt, 600);
      }).setTimeout(3500, function () { this.destroy(); });
    };
    attempt();
  });
}

async function start() {
  const root = path.join(__dirname, "web");
  const entry = path.join(root, "server.js");
  if (!fs.existsSync(entry)) {
    throw new Error("Missing OpenCut server.js in Windows package.");
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [entry], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      // Do not expose the server to the local network.
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  server.on("error", err => {
    if (!stopping) dialog.showErrorBox("CapCut 2 Light", "Falha no servidor: " + err.message);
  });

  win = new BrowserWindow({
    width: 1320, height: 850, minWidth: 900, minHeight: 600,
    backgroundColor: "#111319",
    title: "CapCut 2 Light",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({url: target}) => {
    if (target.startsWith(url + "/")) return { action: "allow" };
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url + "/") && target !== url) event.preventDefault();
  });
  await win.loadURL("data:text/html;charset=UTF-8,%3Chtml%20style%3D%22background%3A%23111319%3Bcolor%3Awhite%3Bfont-family%3Asans-serif%3Btext-align%3Acenter%3Bpadding%3A20vh%22%3ECarregando%20CapCut%202%20Light...%3C%2Fhtml%3E");
  await waitForServer(url);
  if (!win.isDestroyed()) await win.loadURL(url);
}

app.whenReady().then(() => start().catch(error => {
  dialog.showErrorBox("CapCut 2 Light", "Não foi possível iniciar o editor.\n\n" + error.message);
  app.quit();
}));

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  stopping = true;
  if (server && !server.killed) server.kill();
});
