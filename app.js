(() => {
  "use strict";

  const statusEl = document.getElementById("status");
  const interimEl = document.getElementById("interim");
  const outputEl = document.getElementById("output");
  const copyBtn = document.getElementById("copyBtn");
  const clearBtn = document.getElementById("clearBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const aiRefineToggle = document.getElementById("aiRefineToggle");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const supportWarning = document.getElementById("supportWarning");

  const IDLE_TEXT = "Ctrl + Shift を押しながら話してください";
  const RECORDING_TEXT = "🔴 録音中...";

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let isRecording = false;
  let finalTranscript = "";
  let lastInsertionRange = null;

  // ---- Settings persistence ----
  aiRefineToggle.checked = localStorage.getItem("voice_app_ai_refine") === "true";
  apiKeyInput.value = localStorage.getItem("voice_app_api_key") || "";

  aiRefineToggle.addEventListener("change", () => {
    localStorage.setItem("voice_app_ai_refine", String(aiRefineToggle.checked));
  });
  apiKeyInput.addEventListener("input", () => {
    localStorage.setItem("voice_app_api_key", apiKeyInput.value.trim());
  });

  settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
  });

  // ---- Toolbar actions ----
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(outputEl.value);
      flashButton(copyBtn, "コピーしました");
    } catch {
      outputEl.select();
      document.execCommand("copy");
      flashButton(copyBtn, "コピーしました");
    }
  });

  clearBtn.addEventListener("click", () => {
    outputEl.value = "";
    outputEl.focus();
  });

  function flashButton(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  // ---- Speech recognition setup ----
  if (!SpeechRecognitionImpl) {
    supportWarning.classList.remove("hidden");
  }

  function createRecognition() {
    const rec = new SpeechRecognitionImpl();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      interimEl.textContent = interim;
    };

    rec.onerror = (event) => {
      console.error("SpeechRecognition error:", event.error);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        statusEl.textContent = "マイクの使用が許可されていません";
      }
    };

    rec.onend = async () => {
      interimEl.textContent = "";
      const raw = finalTranscript.trim();
      finalTranscript = "";

      if (raw) {
        statusEl.textContent = "整形中...";
        let cleaned = cleanTranscript(raw);
        if (aiRefineToggle.checked && apiKeyInput.value.trim()) {
          cleaned = await refineWithOpenAI(cleaned);
        }
        insertIntoTextarea(cleaned);
      }

      isRecording = false;
      statusEl.classList.remove("recording");
      statusEl.textContent = IDLE_TEXT;
    };

    return rec;
  }

  function startRecording() {
    if (!SpeechRecognitionImpl || isRecording) return;
    isRecording = true;
    finalTranscript = "";
    lastInsertionRange = {
      start: outputEl.selectionStart,
      end: outputEl.selectionEnd,
    };
    recognition = createRecognition();
    try {
      recognition.start();
      statusEl.textContent = RECORDING_TEXT;
      statusEl.classList.add("recording");
    } catch (err) {
      console.error(err);
      isRecording = false;
    }
  }

  function stopRecording() {
    if (!isRecording || !recognition) return;
    recognition.stop();
  }

  // ---- Global hotkey: Ctrl + Shift ----
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && !isRecording) {
      startRecording();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (isRecording && (!e.ctrlKey || !e.shiftKey)) {
      stopRecording();
    }
  });

  window.addEventListener("blur", () => {
    if (isRecording) stopRecording();
  });

  // ---- Text insertion ----
  function insertIntoTextarea(text) {
    if (!text) return;
    const el = outputEl;
    const pos = lastInsertionRange || { start: el.value.length, end: el.value.length };
    const before = el.value.slice(0, pos.start);
    const after = el.value.slice(pos.end);
    const needsSpaceBefore = before.length > 0 && !/[\s\n]$/.test(before);
    const insertText = (needsSpaceBefore ? "\n" : "") + text;
    el.value = before + insertText + after;
    const caret = (before + insertText).length;
    el.focus();
    el.setSelectionRange(caret, caret);
  }

  // ---- Rule-based cleanup: remove filler words, stutters, etc. ----
  const FILLERS = [
    "えーと", "えっと", "ええと", "えー", "あのー", "あの",
    "まぁ", "まあ", "なんか", "うーんと", "うーん", "んーと", "んー",
    "そのー", "その", "あーっと", "あー", "はいはい",
  ].sort((a, b) => b.length - a.length);

  const FILLER_PATTERN = new RegExp(FILLERS.join("|"), "g");

  function cleanTranscript(text) {
    if (!text) return "";
    let t = text;

    // Remove filler / hesitation words
    t = t.replace(FILLER_PATTERN, "");

    // Collapse stuttered repeated characters (e.g. "ああああ" -> "あ")
    t = t.replace(/(.)\1{2,}/g, "$1");

    // Collapse repeated punctuation
    t = t.replace(/[、。]{2,}/g, (m) => m[0]);

    // Collapse whitespace
    t = t.replace(/[ \t]{2,}/g, " ").trim();

    // Strip leading stray punctuation left behind after filler removal
    t = t.replace(/^[、。\s]+/, "");

    return t;
  }

  // ---- Optional AI-based refinement (typo/grammar correction) ----
  async function refineWithOpenAI(text) {
    const key = localStorage.getItem("voice_app_api_key");
    if (!key) return text;
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "あなたは音声認識結果を整形するアシスタントです。誤字脱字や言い間違いを自然に修正し、" +
                "フィラー語（えー、あの、なんか等）を除去し、意味を変えずに読みやすい日本語にしてください。" +
                "余計な説明や前置きは付けず、修正後のテキストのみを出力してください。",
            },
            { role: "user", content: text },
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || text;
    } catch (err) {
      console.error("AI refine failed, falling back to rule-based result:", err);
      return text;
    }
  }
})();
