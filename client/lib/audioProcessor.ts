import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let cachedWasmBinary: ArrayBuffer | null = null;

async function getRnnoiseWasm(): Promise<ArrayBuffer> {
  if (cachedWasmBinary) return cachedWasmBinary;
  cachedWasmBinary = await loadRnnoise({
    url: rnnoiseWasmUrl,
    simdUrl: rnnoiseSimdWasmUrl,
  });
  return cachedWasmBinary;
}

export interface AudioPipeline {
  outputTrack: MediaStreamTrack;
  getLevel: () => number;
  setRnnoiseEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

export async function createAudioPipeline(
  rawAudioTrack: MediaStreamTrack,
  rnnoiseEnabled: boolean
): Promise<AudioPipeline> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx({ sampleRate: 48000 });

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume().catch(() => {});
  }

  const rawStream = new MediaStream([rawAudioTrack]);
  const source = audioCtx.createMediaStreamSource(rawStream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;

  const destination = audioCtx.createMediaStreamDestination();

  let rnnoiseNode: RnnoiseWorkletNode | null = null;
  let currentlyUsingRnnoise = false;

  async function initRnnoise(): Promise<RnnoiseWorkletNode | null> {
    if (rnnoiseNode) return rnnoiseNode;
    try {
      const wasmBinary = await getRnnoiseWasm();
      await audioCtx.audioWorklet.addModule(rnnoiseWorkletUrl);
      rnnoiseNode = new RnnoiseWorkletNode(audioCtx, {
        maxChannels: 1,
        wasmBinary,
      });
      return rnnoiseNode;
    } catch {
      return null;
    }
  }

  function connectGraph(useRnnoise: boolean) {
    try {
      source.disconnect();
      rnnoiseNode?.disconnect();
      analyser.disconnect();
    } catch {
      // ignore disconnect errors on fresh nodes
    }

    if (useRnnoise && rnnoiseNode) {
      source.connect(rnnoiseNode);
      rnnoiseNode.connect(analyser);
      currentlyUsingRnnoise = true;
    } else {
      source.connect(analyser);
      currentlyUsingRnnoise = false;
    }
    analyser.connect(destination);
  }

  if (rnnoiseEnabled) {
    const node = await initRnnoise();
    connectGraph(Boolean(node));
  } else {
    connectGraph(false);
  }

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  return {
    outputTrack: destination.stream.getAudioTracks()[0],

    getLevel: () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      return Math.min(1, rms * 3.5);
    },

    setRnnoiseEnabled: (enabled: boolean) => {
      if (enabled === currentlyUsingRnnoise) return;
      if (enabled) {
        void initRnnoise().then((node) => {
          if (audioCtx.state !== 'closed') {
            connectGraph(Boolean(node));
          }
        });
      } else {
        connectGraph(false);
      }
    },

    destroy: () => {
      try {
        source.disconnect();
        rnnoiseNode?.destroy();
        analyser.disconnect();
        destination.disconnect();
      } catch {
        // ignore
      }
      void audioCtx.close().catch(() => {});
    },
  };
}
