(() => {
  "use strict";

  const binPathEl = document.getElementById("binPath");
  const modelPathEl = document.getElementById("modelPath");
  const launchAtLoginEl = document.getElementById("launchAtLogin");
  const cleanupFillersEl = document.getElementById("cleanupFillers");
  const maxSecondsEl = document.getElementById("maxSeconds");
  const customVocabularyEl = document.getElementById("customVocabulary");
  const engineStatusEl = document.getElementById("engineStatus");

  async function refresh() {
    const state = await window.settingsBridge.getState();
    binPathEl.value = state.settings.whisperBinPath || "";
    modelPathEl.value = state.settings.whisperModelPath || "";
    launchAtLoginEl.checked = !!state.settings.launchAtLogin;
    cleanupFillersEl.checked = !!state.settings.cleanupFillers;
    maxSecondsEl.value = state.settings.maxRecordingSeconds || 60;
    customVocabularyEl.value = state.settings.customVocabulary || "";

    if (state.engineReady) {
      engineStatusEl.innerHTML =
        `<span class="ok">✅ 準備完了</span> — ${state.usingBundled ? "同梱の音声認識エンジンを使用中" : "カスタム設定を使用中"}`;
    } else {
      engineStatusEl.innerHTML =
        `<span class="bad">⚠️ 音声認識エンジンが見つかりません</span><br>` +
        `whisper-cli.exe と モデルファイル(ggml-*.bin) のパスを指定してください。`;
    }
  }

  document.getElementById("pickBin").addEventListener("click", async () => {
    const p = await window.settingsBridge.pickFile("bin");
    if (p) binPathEl.value = p;
  });

  document.getElementById("pickModel").addEventListener("click", async () => {
    const p = await window.settingsBridge.pickFile("model");
    if (p) modelPathEl.value = p;
  });

  document.getElementById("saveBtn").addEventListener("click", async () => {
    await window.settingsBridge.save({
      whisperBinPath: binPathEl.value.trim(),
      whisperModelPath: modelPathEl.value.trim(),
      launchAtLogin: launchAtLoginEl.checked,
      cleanupFillers: cleanupFillersEl.checked,
      maxRecordingSeconds: Number(maxSecondsEl.value) || 60,
      customVocabulary: customVocabularyEl.value.trim(),
    });
    await refresh();
  });

  document.getElementById("closeBtn").addEventListener("click", () => {
    window.settingsBridge.close();
  });

  refresh();
})();
