(() => {
  "use strict";

  const SAMPLE_RATE = 16000;
  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let muteGain = null;
  let mediaStream = null;
  let chunks = [];
  let recording = false;

  async function start() {
    if (recording) return;
    chunks = [];
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
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
        chunks.push(new Float32Array(input));
      };

      sourceNode.connect(processorNode);
      processorNode.connect(muteGain);
      muteGain.connect(audioContext.destination);

      recording = true;
    } catch (err) {
      window.recorderBridge.sendError(String(err && err.message ? err.message : err));
    }
  }

  function stop() {
    if (!recording) return;
    recording = false;

    try {
      processorNode && processorNode.disconnect();
      sourceNode && sourceNode.disconnect();
      muteGain && muteGain.disconnect();
      mediaStream && mediaStream.getTracks().forEach((t) => t.stop());
      audioContext && audioContext.close();
    } catch {
      // best effort cleanup
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    chunks = [];

    if (totalLength === 0) {
      window.recorderBridge.sendError("音声が録音されませんでした");
      return;
    }

    const wavBuffer = encodeWav(merged, SAMPLE_RATE);
    window.recorderBridge.sendData(wavBuffer);
  }

  window.recorderBridge.onStart(start);
  window.recorderBridge.onStop(stop);
})();
