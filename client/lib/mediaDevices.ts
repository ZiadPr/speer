import type { VideoFrameRate, VideoResolution } from '../types/index.ts';
import { createAudioPipeline, type AudioPipeline } from './audioProcessor.ts';
import { createBackgroundBlurPipeline, type BackgroundBlurPipeline } from './backgroundBlur.ts';

export interface MediaDeviceList {
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
}

export function getResolutionDimensions(resolution: VideoResolution): {
  width: number;
  height: number;
} {
  switch (resolution) {
    case '1080p':
      return { width: 1920, height: 1080 };
    case '720p':
      return { width: 1280, height: 720 };
    case '480p':
    default:
      return { width: 640, height: 480 };
  }
}

export async function listMediaDevices(): Promise<MediaDeviceList> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { audioInputs: [], audioOutputs: [], videoInputs: [] };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    audioInputs: devices.filter((d) => d.kind === 'audioinput'),
    audioOutputs: devices.filter((d) => d.kind === 'audiooutput'),
    videoInputs: devices.filter((d) => d.kind === 'videoinput'),
  };
}

export interface ManagedLocalMedia {
  stream: MediaStream;
  rawVideoTrack: MediaStreamTrack | null;
  rawAudioTrack: MediaStreamTrack | null;
  audioPipeline: AudioPipeline | null;
  blurPipeline: BackgroundBlurPipeline | null;
  getMicLevel: () => number;
  setNoiseSuppression: (enabled: boolean) => void;
  setBackgroundBlur: (enabled: boolean, fps: number) => Promise<{ ok: boolean; track: MediaStreamTrack | null }>;
  stopAll: () => void;
}

export async function acquireManagedMedia(options: {
  audioInputId: string;
  videoInputId: string;
  resolution: VideoResolution;
  frameRate: VideoFrameRate;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  backgroundBlur: boolean;
  onBlurError?: () => void;
}): Promise<ManagedLocalMedia> {
  const { width, height } = getResolutionDimensions(options.resolution);

  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: options.echoCancellation,
    autoGainControl: options.autoGainControl,
    noiseSuppression: options.noiseSuppression,
    channelCount: 1,
    sampleRate: 48000,
    ...(options.audioInputId ? { deviceId: { exact: options.audioInputId } } : {}),
  };

  const videoConstraints: MediaTrackConstraints = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: options.frameRate },
    ...(options.videoInputId ? { deviceId: { exact: options.videoInputId } } : {}),
  };

  let rawStream: MediaStream;
  try {
    rawStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: videoConstraints,
    });
  } catch {
    // Fallback: try audio-only if camera is unavailable
    rawStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    });
  }

  const rawAudioTrack = rawStream.getAudioTracks()[0] ?? null;
  const rawVideoTrack = rawStream.getVideoTracks()[0] ?? null;

  let audioPipeline: AudioPipeline | null = null;
  let processedAudioTrack: MediaStreamTrack | null = rawAudioTrack;

  if (rawAudioTrack) {
    try {
      audioPipeline = await createAudioPipeline(rawAudioTrack, options.noiseSuppression);
      processedAudioTrack = audioPipeline.outputTrack;
    } catch {
      processedAudioTrack = rawAudioTrack;
    }
  }

  let blurPipeline: BackgroundBlurPipeline | null = null;
  let processedVideoTrack: MediaStreamTrack | null = rawVideoTrack;

  if (rawVideoTrack && options.backgroundBlur) {
    try {
      blurPipeline = await createBackgroundBlurPipeline(rawVideoTrack, options.frameRate);
      processedVideoTrack = blurPipeline.outputTrack;
    } catch {
      options.onBlurError?.();
      processedVideoTrack = rawVideoTrack;
    }
  }

  const outputStream = new MediaStream();
  if (processedAudioTrack) outputStream.addTrack(processedAudioTrack);
  if (processedVideoTrack) outputStream.addTrack(processedVideoTrack);

  return {
    stream: outputStream,
    rawVideoTrack,
    rawAudioTrack,
    audioPipeline,
    blurPipeline,

    getMicLevel: () => audioPipeline?.getLevel() ?? 0,

    setNoiseSuppression: (enabled: boolean) => {
      if (rawAudioTrack) {
        void rawAudioTrack.applyConstraints({ noiseSuppression: enabled }).catch(() => {});
      }
      audioPipeline?.setRnnoiseEnabled(enabled);
    },

    setBackgroundBlur: async (enabled: boolean, fps: number) => {
      if (!rawVideoTrack) return { ok: false, track: null };

      const currentVideo = outputStream.getVideoTracks()[0];
      if (enabled) {
        if (blurPipeline) return { ok: true, track: blurPipeline.outputTrack };
        try {
          blurPipeline = await createBackgroundBlurPipeline(rawVideoTrack, fps);
          if (currentVideo && currentVideo !== blurPipeline.outputTrack) {
            outputStream.removeTrack(currentVideo);
          }
          outputStream.addTrack(blurPipeline.outputTrack);
          return { ok: true, track: blurPipeline.outputTrack };
        } catch {
          options.onBlurError?.();
          return { ok: false, track: rawVideoTrack };
        }
      } else {
        if (blurPipeline) {
          if (currentVideo) outputStream.removeTrack(currentVideo);
          blurPipeline.destroy();
          blurPipeline = null;
          outputStream.addTrack(rawVideoTrack);
        }
        return { ok: true, track: rawVideoTrack };
      }
    },

    stopAll: () => {
      blurPipeline?.destroy();
      blurPipeline = null;
      audioPipeline?.destroy();
      audioPipeline = null;
      rawStream.getTracks().forEach((t) => t.stop());
      outputStream.getTracks().forEach((t) => t.stop());
    },
  };
}
