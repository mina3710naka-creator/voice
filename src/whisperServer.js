const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const whisperEngine = require("./whisperEngine");

// Runs whisper.cpp's HTTP server (bundled alongside whisper-cli.exe) so
// the model is loaded into memory once and reused across recordings,
// instead of paying disk-load + init cost on every single Ctrl+Shift
// press. Falls back silently to the per-request whisper-cli path
// (whisperEngine.transcribe) if the server binary is missing or fails
// to start.

const HOST = "127.0.0.1";
const PORT = 39871;
const BASE_URL = `http://${HOST}:${PORT}`;
const READY_TIMEOUT_MS = 30000;

let serverProcess = null;
let serverReady = false;
let startPromise = null;

function findServerBin(binPath) {
  const p = path.join(path.dirname(binPath), "whisper-server.exe");
  return fs.existsSync(p) ? p : null;
}

async function pingReady() {
  try {
    const res = await fetch(BASE_URL, { method: "GET" });
    return res.status < 500;
  } catch {
    return false;
  }
}

function start(settings) {
  if (serverReady) return Promise.resolve(true);
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const engine = whisperEngine.resolveEngine(settings);
    if (!engine.ready) return false;

    const serverBin = findServerBin(engine.binPath);
    if (!serverBin) return false;

    try {
      serverProcess = spawn(
        serverBin,
        [
          "-m", engine.modelPath,
          "--host", HOST,
          "--port", String(PORT),
          "-t", String(whisperEngine.threadCount()),
        ],
        { windowsHide: true }
      );
    } catch {
      serverProcess = null;
      return false;
    }

    serverProcess.on("exit", () => {
      serverProcess = null;
      serverReady = false;
    });
    serverProcess.on("error", () => {
      serverProcess = null;
      serverReady = false;
    });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!serverProcess) return false; // died before becoming ready
      if (await pingReady()) {
        serverReady = true;
        return true;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  })();

  startPromise.finally(() => { startPromise = null; });
  return startPromise;
}

function stop() {
  if (serverProcess) {
    try { serverProcess.kill(); } catch { /* already gone */ }
  }
  serverProcess = null;
  serverReady = false;
}

async function restart(settings) {
  stop();
  return start(settings);
}

function isReady() {
  return serverReady;
}

async function transcribe(wavBuffer, settings) {
  if (!serverReady) throw new Error("whisper-server is not ready");

  const form = new FormData();
  form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "audio.wav");
  form.append("language", "ja");
  form.append("no_timestamps", "true");
  form.append("beam_size", "1");
  form.append("no_speech_thold", "0.75");
  form.append("no_fallback", "true");
  form.append("response_format", "json");

  const vocabulary = (settings.customVocabulary || "").trim();
  if (vocabulary) form.append("prompt", vocabulary);

  const res = await fetch(`${BASE_URL}/inference`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`whisper-server error: ${res.status}`);
  const data = await res.json();
  return (data.text || "").trim();
}

module.exports = { start, stop, restart, isReady, transcribe };
