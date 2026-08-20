(() => {
  "use strict";

  const SAMPLE_RATE = 16000;
  const PREROLL_MS = 500;
  const PREROLL_SAMPLES = Math.round((SAMPLE_RATE * PREROLL_MS) / 1000);
  const TARGET_PEAK = 0.9;
  const MAX_GAIN = 8;

  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let muteGain = null;
  let mediaStream = null;
  let ready = false;

  // Rolling buffer of the most recent audio, always capturing in the
  // background so the instant the hotkey fires, the moment just before
  // it (and any speech that started right as the key went down) is
  // already on hand instead of being lost to mic/device startup time.
  let prerollBuffer = new Float32Array(PREROLL_SAMPLES);
  let prerollWritePos = 0;
  let prerollFilled = 0;

  let recording = false;
  let activeChunks = [];

  function pushToPreroll(input) {
    for (let i = 0; i < input.length; i++) {
      prerollBuffer[prerollWritePos] = input[i];
      prerollWritePos = (prerollWritePos + 1) % PREROLL_SAMPLES;
      if (prerollFilled < PREROLL_SAMPLES) prerollFilled++;
    }
  }

  function snapshotPreroll() {
    const out = new Float32Array(prerollFilled);
    const startPos = (prerollWritePos - prerollFilled + PREROLL_SAMPLES) % PREROLL_SAMPLES;
    for (let i = 0; i < prerollFilled; i++) {
      out[i] = prerollBuffer[(startPos + i) % PREROLL_SAMPLES];
    }
    return out;
  }

  // Mic + processing graph is created once, immediately, and kept alive
  // for the app's lifetime so recordings never pay device-acquisition
  // latency; start()/stop() just toggle whether audio is retained.
  async function initAudio() {
    if (ready) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // No speaker output is ever routed back (muteGain silences the
          // loop), so echo cancellation has nothing to cancel and can
          // only attenuate the signal. Noise suppression is skipped too:
          // it tends to shave off quiet/breathy speech onsets, which is
          // exactly what was getting lost.
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
        const input = event.inputBuffer.getChannelData(0);
        if (recording) {
          activeChunks.push(new Float32Array(input));
        } else {
          pushToPreroll(input);
        }
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
    activeChunks = [snapshotPreroll()];
    recording = true;
  }

  // Boosts quiet recordings up to a healthy peak level so soft speech
  // is recognized as reliably as loud speech, without blowing up pure
  // silence/noise into a wall of amplified hiss.
  function normalizePeak(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    if (peak < 0.01) return samples; // effectively silent, leave as-is
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
