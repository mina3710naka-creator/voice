// Rule-based cleanup applied on top of whisper.cpp's transcription:
// strips common Japanese filler/hesitation words and stutter repeats.
// Whisper itself already produces fairly clean, typo-corrected text
// (unlike raw streaming ASR), so this pass mainly handles fillers.

const FILLERS = [
  "えーと", "えっと", "ええと", "えー",
  "あのー", "あの",
  "まぁ", "まあ",
  "なんか",
  "うーんと", "うーん", "んーと", "んー",
  "そのー", "その",
  "あーっと", "あー",
].sort((a, b) => b.length - a.length);

const FILLER_PATTERN = new RegExp(FILLERS.join("|"), "g");

function cleanTranscript(text) {
  if (!text) return "";
  let t = text;

  t = t.replace(FILLER_PATTERN, "");
  t = t.replace(/(.)\1{2,}/g, "$1");
  t = t.replace(/[、。]{2,}/g, (m) => m[0]);
  t = t.replace(/[ \t]{2,}/g, " ").trim();
  t = t.replace(/^[、。\s]+/, "");

  return t;
}

module.exports = { cleanTranscript };
