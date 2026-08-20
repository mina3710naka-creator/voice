(() => {
  "use strict";

  const SAMPLE_RATE = 16000;
  const TARGET_PEAK = 0.85;
  const MAX_GAIN = 3;
  const SILENCE_PEAK = 0.03;

  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let muteGain = null;
  let mediaStream = null;
  let ready = false;

  let recording = false;
  let activeChunks = [];

  // Mic + processing graph is created once, immediately, and kept alive
  // for the app's lifetime so recordings never pay device-acquisition
  // latency; start()/stop() just toggle whether audio is retained.
  // (An earlier version also kept a rolling pre-roll buffer to catch
  // speech starting right at the hotkey press, but that ended up
  // capturing whatever unrelated audio happened just before the key was
  // pressed too, so it was removed.)
  async function initAudio() {
    if (ready) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // No speaker output is ever routed back (muteGain silences the
          // loop), so echo cancellation has nothing to cancel and can
          // only attenuate the signal. Noise suppression is skipped too:
          // it tends to shave off quiet/breathy speech onsets.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });

      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      });
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      muteGain = audioContext.createGain();
      muteGain.gain.value = 0;

      processorNode.onaudioprocess = (event) => {
        if (!recording) return;
        const input = event.inputBuffer.getChannelData(0);
        activeChunks.push(new Float32Array(input));
      };

      sourceNode.connect(processorNode);
      processorNode.connect(muteGain);
      muteGain.connect(audioContext.destination);

      ready = true;
    } catch (err) {
      window.recorderBridge.sendError(String(err && err.message ? err.message : err));
    }
  }

  async function start() {
    if (recording) return;
    if (!ready) await initAudio();
    if (!ready) return;
    activeChunks = [];
    recording = true;
  }

  // Gently boosts clearly-quiet recordings so soft speech is picked up
  // more reliably. Kept conservative (small max gain, a silence floor
  // below which nothing is touched) so background noise doesn't get
  // amplified into something whisper.cpp mistakes for speech.
  function normalizePeak(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    if (peak < SILENCE_PEAK) return samples; // too quiet to safely boost
    const gain = Math.min(TARGET_PEAK / peak, MAX_GAIN);
    if (gain <= 1.05) return samples; // already loud enough
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    return samples;
  }

  function stop() {
    if (!recording) return;
    recording = false;

    const totalLength = activeChunks.reduce((sum, c) => sum + c.length, 0);
    let merged = new Float32Array(totalLength);
    let offset = 0;
    for (const c of activeChunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    activeChunks = [];

    if (totalLength === 0) {
      window.recorderBridge.sendError("音声が録音されませんでした");
      return;
    }

    merged = normalizePeak(merged);
    const wavBuffer = encodeWav(merged, SAMPLE_RATE);
    window.recorderBridge.sendData(wavBuffer);
  }

  window.recorderBridge.onStart(start);
  window.recorderBridge.onStop(stop);

  initAudio();
})();
