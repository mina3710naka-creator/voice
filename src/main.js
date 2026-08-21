const path = require("path");
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, screen, session } = require("electron");
const { uIOhook, UiohookKey } = require("uiohook-napi");

const store = require("./store");
const { cleanTranscript } = require("./textCleanup");
const whisperEngine = require("./whisperEngine");
const whisperServer = require("./whisperServer");
const { pasteText } = require("./paste");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let tray = null;
let overlayWin = null;
let recorderWin = null;
let settingsWin = null;

let isRecording = false;
let recordingSafetyTimer = null;
const pressedModifiers = new Set();

const MODIFIER_CODES = new Set([
  UiohookKey.Ctrl, UiohookKey.CtrlRight,
  UiohookKey.Shift, UiohookKey.ShiftRight,
]);

function isComboActive() {
  const ctrl = pressedModifiers.has(UiohookKey.Ctrl) || pressedModifiers.has(UiohookKey.CtrlRight);
  const shift = pressedModifiers.has(UiohookKey.Shift) || pressedModifiers.has(UiohookKey.ShiftRight);
  return ctrl && shift;
}

function iconPath(name) {
  return path.join(__dirname, "..", "assets", name);
}

// ---------- Overlay window (recording indicator) ----------

function createOverlayWindow() {
  const win = new BrowserWindow({
    width: 260,
    height: 56,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, "overlay.html"));

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  win.setPosition(x + width - 280, y + height - 90);

  return win;
}

function setOverlayStatus(text, state) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.webContents.send("overlay:status", { text, state });
}

function showOverlay(text, state) {
  if (!overlayWin || overlayWin.isDestroyed()) overlayWin = createOverlayWindow();
  setOverlayStatus(text, state);
  overlayWin.showInactive();
}

function hideOverlayAfter(ms) {
  setTimeout(() => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.hide();
  }, ms);
}

// ---------- Recorder window (hidden, captures mic audio) ----------

function createRecorderWindow() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload-recorder.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "recorder.html"));
  return win;
}

// ---------- Settings window ----------

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    title: "設定 - 音声入力アプリ",
    icon: iconPath("icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload-settings.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.on("closed", () => { settingsWin = null; });
}

ipcMain.handle("settings:get", () => {
  const settings = store.load();
  const engine = whisperEngine.resolveEngine(settings);
  return {
    settings,
    engineReady: engine.ready,
    usingBundled: engine.usingBundled,
    fastModeReady: whisperServer.isReady(),
  };
});

ipcMain.handle("settings:save", (_e, values) => {
  const next = store.save(values);
  applyLaunchAtLogin(next.launchAtLogin);
  // Engine/model may have changed -- restart the resident server so it
  // picks up the new model instead of continuing to serve the old one.
  whisperServer.restart(next).catch(() => {});
  return next;
});

ipcMain.handle("settings:pick-file", async (_e, kind) => {
  const filters = kind === "bin"
    ? [{ name: "実行ファイル", extensions: ["exe"] }]
    : [{ name: "音声モデル", extensions: ["bin"] }];
  const result = await dialog.showOpenDialog(settingsWin, {
    properties: ["openFile"],
    filters,
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.on("settings:close", () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

function applyLaunchAtLogin(enabled) {
  if (process.platform !== "win32") return;
  app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath });
}

// ---------- Recording pipeline ----------

function startRecording() {
  if (isRecording) return;
  isRecording = true;

  if (!recorderWin || recorderWin.isDestroyed()) recorderWin = createRecorderWindow();
  showOverlay("🔴 録音中...", "");

  const settings = store.load();
  const maxMs = Math.max(5, settings.maxRecordingSeconds || 60) * 1000;
  recordingSafetyTimer = setTimeout(() => {
    if (isRecording) stopRecording();
  }, maxMs);

  const send = () => recorderWin.webContents.send("rec:start");
  if (recorderWin.webContents.isLoading()) {
    recorderWin.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearTimeout(recordingSafetyTimer);

  if (recorderWin && !recorderWin.isDestroyed()) {
    recorderWin.webContents.send("rec:stop");
  }
  setOverlayStatus("📝 認識中...", "processing");
}

ipcMain.on("rec:data", async (_e, wavBuffer) => {
  try {
    const settings = store.load();
    const rawText = whisperServer.isReady()
      ? await whisperServer.transcribe(wavBuffer, settings)
      : await whisperEngine.transcribe(wavBuffer, settings);
    const finalText = settings.cleanupFillers ? cleanTranscript(rawText) : rawText.trim();

    if (finalText) {
      await pasteText(finalText);
      showOverlay(truncateForOverlay(finalText), "done");
    } else {
      showOverlay("（音声を認識できませんでした）", "error");
    }
  } catch (err) {
    console.error(err);
    showOverlay("⚠️ 認識エラーが発生しました", "error");
  } finally {
    hideOverlayAfter(1800);
  }
});

ipcMain.on("rec:error", (_e, message) => {
  console.error("recorder error:", message);
  isRecording = false;
  clearTimeout(recordingSafetyTimer);
  showOverlay(`⚠️ ${message}`, "error");
  hideOverlayAfter(2200);
});

function truncateForOverlay(text) {
  const max = 20;
  return text.length > max ? `✅ ${text.slice(0, max)}…` : `✅ ${text}`;
}

// ---------- Global hotkey (Ctrl+Shift, hold to talk) ----------

function setupGlobalHotkey() {
  uIOhook.on("keydown", (e) => {
    if (!MODIFIER_CODES.has(e.keycode)) return;
    pressedModifiers.add(e.keycode);
    if (isComboActive() && !isRecording) startRecording();
  });

  uIOhook.on("keyup", (e) => {
    if (!MODIFIER_CODES.has(e.keycode)) return;
    pressedModifiers.delete(e.keycode);
    if (isRecording && !isComboActive()) stopRecording();
  });

  uIOhook.start();
}

// ---------- Tray ----------

function createTray() {
  const trayIcon = nativeImage.createFromPath(iconPath("icon.png")).resize({ width: 32, height: 32 });
  tray = new Tray(trayIcon);
  tray.setToolTip("音声入力アプリ（Ctrl+Shiftで録音）");

  const menu = Menu.buildFromTemplate([
    { label: "Ctrl + Shift を押しながら話してください", enabled: false },
    { type: "separator" },
    { label: "設定を開く...", click: openSettingsWindow },
    { type: "separator" },
    { label: "終了", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", openSettingsWindow);
}

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  app.setAppUserModelId("com.kiritonakano.voiceinputapp");

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media");
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === "media");

  createTray();
  overlayWin = createOverlayWindow();
  recorderWin = createRecorderWindow();

  const settings = store.load();
  applyLaunchAtLogin(settings.launchAtLogin);

  const engine = whisperEngine.resolveEngine(settings);
  if (!engine.ready) {
    openSettingsWindow();
  } else {
    // Best-effort: if this fails to start (e.g. custom bin path without
    // whisper-server.exe alongside it), transcription just falls back to
    // spawning whisper-cli per request.
    whisperServer.start(settings).catch(() => {});
  }

  setupGlobalHotkey();
});

app.on("window-all-closed", (e) => {
  // Tray app: keep running even if all windows are closed.
  e.preventDefault();
});

app.on("before-quit", () => {
  try { uIOhook.stop(); } catch { /* already stopped */ }
  whisperServer.stop();
});

app.on("second-instance", () => {
  openSettingsWindow();
});
