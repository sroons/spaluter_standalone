const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const osc = require("osc");

const SC_OSC_PORT = 57130;
const APP_OSC_RECV_PORT = 57131;
const DEFAULT_SAMPLE_DIR = "/spaluter/samples/";

let mainWindow = null;
let sclangProc = null;
let oscPort = null;
let lastStatus = "Starting...";
const logBuffer = [];
let runtimeInjected = false;
let quittingApp = false;

function pushLog(text) {
  const line = String(text ?? "");
  logBuffer.push(line);
  if (logBuffer.length > 400) logBuffer.shift();
}

function detectSclangCommand() {
  if (process.env.SCLANG_PATH) return process.env.SCLANG_PATH;
  if (process.platform === "win32") return "sclang.exe";
  return "sclang";
}

function createOscClient() {
  oscPort = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: APP_OSC_RECV_PORT,
    remoteAddress: "127.0.0.1",
    remotePort: SC_OSC_PORT
  });

  oscPort.on("ready", () => {
    sendStatus("OSC ready");
  });

  oscPort.on("message", (msg) => {
    if (!mainWindow) return;
    if (msg.address === "/spaluter/status") {
      const s = String(msg.args?.[0] ?? "");
      sendStatus(s);
      if (s === "Runtime ready") {
        setTimeout(() => {
          sendLog("[BOOT] sending delayed /spaluter/start");
          sendOsc("/spaluter/start", []);
        }, 2000);
      }
    } else if (msg.address === "/spaluter/scope") {
      const samples = (Array.isArray(msg.args) ? msg.args : [])
        .map((arg) => {
          if (arg && typeof arg === "object" && Object.prototype.hasOwnProperty.call(arg, "value")) {
            return Number(arg.value);
          }
          return Number(arg);
        })
        .filter((value) => Number.isFinite(value))
        .slice(0, 128);
      if (samples.length > 0) {
        mainWindow.webContents.send("sc-scope", samples);
      }
    } else {
      sendLog(`[OSC] ${msg.address} ${JSON.stringify(msg.args || [])}`);
    }
  });

  oscPort.on("error", (err) => {
    sendStatus(`OSC error: ${err.message}`);
  });

  oscPort.open();
}

function sendStatus(text) {
  lastStatus = String(text ?? "");
  pushLog(`[STATUS] ${lastStatus}`);
  if (mainWindow) mainWindow.webContents.send("sc-status", lastStatus);
}

function sendLog(text) {
  const line = String(text ?? "");
  pushLog(line);
  if (mainWindow) mainWindow.webContents.send("sc-log", line);
}

function sendOsc(address, args = []) {
  if (!oscPort) return;
  oscPort.send({ address, args });
}

function isSupportedSampleFile(filePath) {
  return [".wav", ".aif", ".aiff", ".flac", ".ogg", ".mp3"].includes(path.extname(filePath).toLowerCase());
}

function startSuperCollider() {
  if (sclangProc) return;

  const cmd = detectSclangCommand();
  const runtimePath = path.join(__dirname, "sc", "runtime.scd");
  const patchPath = path.join(__dirname, "spaluter_supercollider.scd");

  sendStatus(`Starting sclang (${cmd})...`);
  sendLog(`[BOOT] runtime: ${runtimePath}`);
  sendLog(`[BOOT] patch:   ${patchPath}`);
  sendLog(`[BOOT] cwd:     ${__dirname}`);

  runtimeInjected = false;
  sclangProc = spawn(cmd, [], {
    cwd: __dirname,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });

  sclangProc.stdout.on("data", (buf) => {
    const text = buf.toString();
    sendLog(text);
    if (!runtimeInjected && text.includes("*** Welcome to SuperCollider")) {
      runtimeInjected = true;
      const escaped = runtimePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const escapedPatch = patchPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const script = `~spaluterPatchPath="${escapedPatch}"; this.executeFile("${escaped}");\n`;
      sendLog("[BOOT] injecting runtime.scd into sclang");
      sclangProc.stdin.write(script);
    }
  });

  sclangProc.stderr.on("data", (buf) => {
    const text = buf.toString();
    sendLog(`[ERR] ${text}`);
  });

  sclangProc.on("error", (err) => {
    sendStatus(`Failed to launch sclang: ${err.message}`);
    sendLog("Tip: install SuperCollider and ensure sclang is in PATH, or set SCLANG_PATH env var.");
    sclangProc = null;
  });

  sclangProc.on("close", (code) => {
    sendStatus(`sclang exited (${code})`);
    sclangProc = null;
    runtimeInjected = false;
  });
}

function stopSuperCollider() {
  return new Promise((resolve) => {
    if (!sclangProc) {
      resolve();
      return;
    }

    const procRef = sclangProc;
    const onClose = () => {
      procRef.removeListener("close", onClose);
      resolve();
    };
    procRef.on("close", onClose);

    try {
      sendStatus("Stopping synth runtime...");
      sendOsc("/spaluter/quit", []);
    } catch {
      // fall through to timeout kill
    }

    setTimeout(() => {
      if (sclangProc) {
        sendLog("[BOOT] force-killing sclang after timeout");
        sclangProc.kill();
      }
      resolve();
    }, 1500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  createOscClient();
  startSuperCollider();

  ipcMain.handle("sc:set-param", (_evt, payload) => {
    const { key, value } = payload || {};
    if (typeof key !== "string") return false;
    sendOsc("/spaluter/set", [key, Number(value)]);
    return true;
  });

  ipcMain.handle("sc:trigger", (_evt, action) => {
    if (action === "start") sendOsc("/spaluter/start", []);
    if (action === "stop") sendOsc("/spaluter/stop", []);
    if (action === "reset") sendOsc("/spaluter/reset", []);
    return true;
  });

  ipcMain.handle("sc:get-initial-state", () => {
    return { status: lastStatus, logs: [...logBuffer], sampleDefaultDir: DEFAULT_SAMPLE_DIR };
  });

  ipcMain.handle("samples:list", async (_evt, dirPath) => {
    const targetDir = (typeof dirPath === "string" && dirPath.trim().length > 0)
      ? dirPath.trim()
      : DEFAULT_SAMPLE_DIR;

    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => isSupportedSampleFile(name))
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, path: path.join(targetDir, name) }));

      sendLog(`[SAMPLE] Found ${files.length} files in ${targetDir}`);
      return { ok: true, directory: targetDir, files };
    } catch (err) {
      const message = `Failed to list samples in ${targetDir}: ${err.message}`;
      sendLog(`[SAMPLE] ${message}`);
      return { ok: false, directory: targetDir, files: [], error: message };
    }
  });

  ipcMain.handle("samples:load", (_evt, samplePath) => {
    if (typeof samplePath !== "string" || samplePath.trim().length === 0) return false;
    const trimmed = samplePath.trim();
    sendLog(`[SAMPLE] Loading: ${trimmed}`);
    sendOsc("/spaluter/load-sample", [trimmed]);
    return true;
  });
});

app.on("before-quit", (event) => {
  if (quittingApp) return;
  quittingApp = true;
  event.preventDefault();
  stopSuperCollider().finally(() => {
    if (oscPort) {
      try {
        oscPort.close();
      } catch {
        // ignore
      }
    }
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (!quittingApp) stopSuperCollider();
  if (oscPort) {
    try {
      oscPort.close();
    } catch {
      // ignore
    }
  }
  if (process.platform !== "darwin") app.quit();
});
