import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const SELFIE_SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: SELFIE_SEGMENTER_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    })();
  }

  try {
    return await segmenterPromise;
  } catch (err) {
    segmenterPromise = null;
    throw err;
  }
}

export interface BackgroundBlurPipeline {
  outputTrack: MediaStreamTrack;
  destroy: () => void;
}

export async function createBackgroundBlurPipeline(
  rawVideoTrack: MediaStreamTrack,
  fps: number
): Promise<BackgroundBlurPipeline> {
  const segmenter = await getSegmenter();

  const settings = rawVideoTrack.getSettings();
  const width = settings.width || 640;
  const height = settings.height || 480;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([rawVideoTrack]);
  await video.play();

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d', { alpha: false });
  if (!outCtx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d');

  const fgCanvas = document.createElement('canvas');
  fgCanvas.width = width;
  fgCanvas.height = height;
  const fgCtx = fgCanvas.getContext('2d');

  if (!maskCtx || !fgCtx) {
    throw new Error('Offscreen canvas contexts unavailable');
  }

  let running = true;
  let rafId = 0;
  let lastTimestamp = -1;
  let maskImageData: ImageData | null = null;

  const renderFrame = () => {
    if (!running) return;
    rafId = requestAnimationFrame(renderFrame);

    if (video.readyState < 2) return;
    const now = performance.now();
    if (now <= lastTimestamp) return;
    lastTimestamp = now;

    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;
    if (outCanvas.width !== vw || outCanvas.height !== vh) {
      outCanvas.width = vw;
      outCanvas.height = vh;
      maskCanvas.width = vw;
      maskCanvas.height = vh;
      fgCanvas.width = vw;
      fgCanvas.height = vh;
      maskImageData = null;
    }

    const result = segmenter.segmentForVideo(video, now);
    const masks = result.confidenceMasks;

    if (!masks || masks.length === 0) {
      outCtx.drawImage(video, 0, 0, vw, vh);
      result.close();
      return;
    }

    // Confidence mask: index 0 is foreground person confidence in [0, 1]
    const confidenceMask = masks[0];
    const maskW = confidenceMask.width;
    const maskH = confidenceMask.height;
    const data = confidenceMask.getAsFloat32Array();

    if (!maskImageData || maskImageData.width !== maskW || maskImageData.height !== maskH) {
      maskImageData = new ImageData(maskW, maskH);
    }

    const pixels = maskImageData.data;
    for (let i = 0; i < data.length; i++) {
      const alpha = Math.max(0, Math.min(255, Math.round(data[i] * 255)));
      const offset = i * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = alpha;
    }

    // Draw scaled mask
    maskCtx.clearRect(0, 0, vw, vh);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = maskW;
    tempCanvas.height = maskH;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.putImageData(maskImageData, 0, 0);
      maskCtx.drawImage(tempCanvas, 0, 0, vw, vh);
    }

    // Composite blurred background
    outCtx.save();
    outCtx.filter = 'blur(14px)';
    outCtx.drawImage(video, 0, 0, vw, vh);
    outCtx.restore();

    // Extract sharp foreground using alpha mask
    fgCtx.clearRect(0, 0, vw, vh);
    fgCtx.globalCompositeOperation = 'source-over';
    fgCtx.drawImage(maskCanvas, 0, 0, vw, vh);
    fgCtx.globalCompositeOperation = 'source-in';
    fgCtx.drawImage(video, 0, 0, vw, vh);

    // Draw sharp foreground over blurred background
    outCtx.drawImage(fgCanvas, 0, 0, vw, vh);

    result.close();
  };

  rafId = requestAnimationFrame(renderFrame);
  const capturedStream = outCanvas.captureStream(fps);
  const outputTrack = capturedStream.getVideoTracks()[0];

  return {
    outputTrack,
    destroy: () => {
      running = false;
      cancelAnimationFrame(rafId);
      outputTrack.stop();
      video.pause();
      video.srcObject = null;
    },
  };
}
