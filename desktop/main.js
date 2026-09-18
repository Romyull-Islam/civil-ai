/* Civil AI desktop shell. In production it starts the bundled Next.js standalone server on a free localhost port
 * and opens it in a BrowserWindow; in dev it just points at the running `next dev` server (CIVIL_AI_DEV_URL). */
const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const fs = require("fs");

let serverProc = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on("error", reject);
  });
}

function waitFor(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      fetch(url).then((r) => (r.ok ? resolve() : retry())).catch(retry);
    };
    const retry = () => (Date.now() - start > timeoutMs ? reject(new Error("Server did not start in time")) : setTimeout(tick, 300));
    tick();
  });
}

async function startServer() {
  const appDir = path.join(process.resourcesPath, "app");
  const serverJs = path.join(appDir, "server.js");
  if (!fs.existsSync(serverJs)) throw new Error(`Bundled server not found at ${serverJs}. Build the web app and run prepare-app.`);
  const port = await freePort();
  // Persist user data (nothing server-side today, but keep a stable cwd for future SQLite etc.)
  const userData = app.getPath("userData");
  serverProc = spawn(process.execPath, [serverJs], {
    cwd: appDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", CIVIL_AI_USER_DATA: userData, CIVIL_AI_DESKTOP: "1", CIVIL_AI_MODE: "desktop" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  const url = `http://127.0.0.1:${port}`;
  await waitFor(`${url}/api/health`);
  // Built-in local model: start it if installed; on first run, install the model recommended for this PC automatically
  // (the chat page shows the download progress). Runs in the background and never blocks the window.
  fetch(`${url}/api/local`).then((r) => r.json()).then((st) => {
    if (!st || !st.enabled) return;
    if (!st.entitled) return; // offline model is a plan feature; the Settings page explains how to unlock it
    const action = st.activeModel && st.binaryInstalled ? "start" : "setup";
    return fetch(`${url}/api/local`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
  }).catch(() => {});
  return url;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: "#0f1216",
    title: "Civil AI",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  try {
    const url = process.env.CIVIL_AI_DEV_URL || (await startServer());
    await win.loadURL(url);
    // Headless verification hook: CIVIL_AI_SCREENSHOT=/path/out.png captures the window and exits (used by smoke tests).
    if (process.env.CIVIL_AI_SCREENSHOT) {
      await new Promise((r) => setTimeout(r, 4000));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.CIVIL_AI_SCREENSHOT, img.toPNG());
      app.quit();
    }
  } catch (e) {
    dialog.showErrorBox("Civil AI failed to start", String(e && e.message ? e.message : e));
    app.quit();
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ]));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (serverProc) { try { serverProc.kill(); } catch { /* ignore */ } } });
