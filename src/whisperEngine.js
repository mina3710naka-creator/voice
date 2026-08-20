const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { app } = require("electron");

function bundledDir(name) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "whisper")
    : path.join(__dirname, "..", "resources", "whisper");
  return path.join(base, name);
}

function findBundledBin() {
  const dir = bundledDir("bin");
  const candidates = ["whisper-cli.exe", "main.exe"];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function findBundledModel() {
  const dir = bundledDir("models");
  if (!fs.existsSync(dir)) return "";
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".bin"));
  if (files.length === 0) return "";
  return path.join(dir, files[0]);
}

function resolveEngine(settings) {
  const binPath = settings.whisperBinPath || findBundledBin();
  const modelPath = settings.whisperModelPath || findBundledModel();
  const usingBundled = !settings.whisperBinPath && !settings.whisperModelPath;
  const ready = !!(binPath && fs.existsSync(binPath) && modelPath && fs.existsSync(modelPath));
  return { binPath, modelPath, ready, usingBundled };
}

function transcribe(wavBuffer, settings, { timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const { binPath, modelPath, ready } = resolveEngine(settings);
    if (!ready) {
      reject(new Error("音声認識エンジン（whisper-cli / モデル）が見つかりません。設定を確認してください。"));
      return;
    }

    const tmpDir = os.tmpdir();
    const id = crypto.randomBytes(6).toString("hex");
    const wavPath = path.join(tmpDir, `voice-input-${id}.wav`);
    const outBase = path.join(tmpDir, `voice-input-${id}`);
    const txtPath = `${outBase}.txt`;

    fs.writeFileSync(wavPath, Buffer.from(wavBuffer));

    const args = [
      "-m", modelPath, "-f", wavPath, "-l", "ja", "-nt", "-otxt", "-of", outBase,
      // Skip the temperature-fallback retry loop: it's the main source of
      // both slow transcriptions and hallucinated text (the model tends to
      // invent words when it retries low-confidence/quiet segments at
      // higher temperatures). Also raise the no-speech threshold so brief
      // pauses in natural speech are more readily treated as silence
      // instead of being transcribed into invented words.
      "-nf",
      "-nth", "0.75",
    ];
    const child = spawn(binPath, args, { windowsHide: true });

    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      cleanup();
      reject(new Error("音声認識がタイムアウトしました"));
    }, timeoutMs);

    function cleanup() {
      for (const p of [wavPath, txtPath]) {
        fs.promises.unlink(p).catch(() => {});
      }
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !fs.existsSync(txtPath)) {
        cleanup();
        reject(new Error(`音声認識に失敗しました (code ${code}): ${stderr.slice(0, 300)}`));
        return;
      }
      try {
        const text = fs.readFileSync(txtPath, "utf-8").trim();
        cleanup();
        resolve(text);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  });
}

module.exports = { resolveEngine, transcribe };
