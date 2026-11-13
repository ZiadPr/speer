import { useCallback, useEffect, useRef, useState } from 'react';
import { CallView } from './components/CallView.tsx';
import { ErrorBanner } from './components/ErrorBanner.tsx';
import { Header } from './components/Header.tsx';
import { HomeView } from './components/HomeView.tsx';
import { PreJoinView } from './components/PreJoinView.tsx';
import { SettingsDrawer } from './components/SettingsDrawer.tsx';
import './i18n/index.ts';
import {
  deriveRoomId,
  generateRoomCode,
  generateRoomSecret,
  normalizeRoomCode,
} from './lib/crypto.ts';
import { probeRegionalIceServers } from './lib/iceProbe.ts';
import {
  acquireManagedMedia,
  listMediaDevices,
  type ManagedLocalMedia,
  type MediaDeviceList,
} from './lib/mediaDevices.ts';
import { WebRtcCallManager } from './lib/webrtcManager.ts';
import { useCallStore } from './stores/useCallStore.ts';
import { applyThemeMode, useSettingsStore } from './stores/useSettingsStore.ts';

function parseRoomTarget(raw: string, hashFallback = ''): { code: string; secret: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let pathPart = trimmed;
  let hashPart = hashFallback.replace(/^#/, '');

  try {
    if (trimmed.includes('://') || trimmed.startsWith('/')) {
      const url = new URL(trimmed, window.location.origin);
      pathPart = url.pathname;
      if (url.hash) hashPart = url.hash.replace(/^#/, '');
    } else if (trimmed.includes('#')) {
      const idx = trimmed.indexOf('#');
      pathPart = trimmed.slice(0, idx);
      hashPart = trimmed.slice(idx + 1);
    }
  } catch {
    return null;
  }

  const rMatch = pathPart.match(/\/r\/([a-zA-Z0-9-]+)/i);
  const candidateCode = rMatch ? rMatch[1] : pathPart;
  const code = normalizeRoomCode(candidateCode);

  if (code.length !== 8) {
    return null;
  }

  return { code, secret: hashPart.trim() };
}

export default function App() {
  const view = useCallStore((s) => s.view);
  const roomId = useCallStore((s) => s.roomId);
  const roomSecret = useCallStore((s) => s.roomSecret);
  const isCreator = useCallStore((s) => s.isCreator);
  const micMuted = useCallStore((s) => s.micMuted);
  const cameraOff = useCallStore((s) => s.cameraOff);
  const isScreenSharing = useCallStore((s) => s.isScreenSharing);

  const settings = useSettingsStore();

  const mediaRef = useRef<ManagedLocalMedia | null>(null);
  const rtcRef = useRef<WebRtcCallManager | null>(null);
  const [devices, setDevices] = useState<MediaDeviceList>({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
  });

  // Sync theme mode and system preference changes
  useEffect(() => {
    applyThemeMode(settings.theme);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => {
      if (useSettingsStore.getState().theme === 'system') {
        applyThemeMode('system');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings.theme]);

  // Measure regional STUN RTT on load
  useEffect(() => {
    void probeRegionalIceServers();
  }, []);

  const stopMediaAndCall = useCallback(() => {
    rtcRef.current?.destroy();
    rtcRef.current = null;
    mediaRef.current?.stopAll();
    mediaRef.current = null;
  }, []);

  const setupLocalMedia = useCallback(async () => {
    const s = useSettingsStore.getState();
    const call = useCallStore.getState();

    mediaRef.current?.stopAll();
    mediaRef.current = null;

    try {
      const managed = await acquireManagedMedia({
        audioInputId: s.audioInputId,
        videoInputId: s.videoInputId,
        resolution: s.resolution,
        frameRate: s.frameRate,
        noiseSuppression: s.noiseSuppression,
        echoCancellation: s.echoCancellation,
        autoGainControl: s.autoGainControl,
        backgroundBlur: s.backgroundBlur,
        onBlurError: () => {
          useCallStore.getState().setError('BLUR_FAILED');
          useSettingsStore.getState().setSetting('backgroundBlur', false);
        },
      });

      mediaRef.current = managed;

      const audioTrack = managed.stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !s.muteOnJoin;
      }
      call.setMicMuted(s.muteOnJoin);

      const videoTrack = managed.stream.getVideoTracks()[0];
      call.setCameraOff(!videoTrack);
      call.setLocalStream(managed.stream);

      const listed = await listMediaDevices();
      setDevices(listed);
      return managed;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        call.setError('MEDIA_DENIED');
      } else {
        call.setError('MEDIA_UNAVAILABLE');
      }
      return null;
    }
  }, []);

  const enterPreJoin = useCallback(
    async (code: string, secret: string, creator: boolean) => {
      const derivedId = await deriveRoomId(code);
      window.history.replaceState(null, '', `/r/${code}#${secret}`);
      useCallStore.getState().setRoom({
        roomCode: code,
        roomSecret: secret,
        roomId: derivedId,
        isCreator: creator,
      });
      useCallStore.getState().setView('prejoin');
      await setupLocalMedia();
    },
    [setupLocalMedia]
  );

  // Check URL /r/CODE#SECRET on initial load
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/r/')) {
      const parsed = parseRoomTarget(path, window.location.hash);
      if (!parsed) {
        useCallStore.getState().setError('INVALID_ROOM');
        window.history.replaceState(null, '', '/');
        return;
      }
      if (!parsed.secret) {
        useCallStore.getState().setError('INVALID_LINK');
        window.history.replaceState(null, '', '/');
        return;
      }
      void enterPreJoin(parsed.code, parsed.secret, false);
    }
  }, [enterPreJoin]);

  // Listen for device changes
  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const onDeviceChange = () => {
      void listMediaDevices().then(setDevices);
    };
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, []);

  // Re-apply audio/video constraints dynamically when settings change during prejoin or call
  useEffect(() => {
    const managed = mediaRef.current;
    if (!managed) return;
    managed.setNoiseSuppression(settings.noiseSuppression);
  }, [settings.noiseSuppression]);

  useEffect(() => {
    const managed = mediaRef.current;
    if (!managed || isScreenSharing) return;

    let cancelled = false;
    void managed.setBackgroundBlur(settings.backgroundBlur, settings.frameRate).then((res) => {
      if (cancelled || !res.track) return;
      useCallStore.getState().setLocalStream(new MediaStream(managed.stream.getTracks()));
      if (rtcRef.current) {
        void rtcRef.current.replaceVideoTrack(res.track, true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [settings.backgroundBlur, settings.frameRate, isScreenSharing]);

  useEffect(() => {
    const managed = mediaRef.current;
    if (!managed?.rawAudioTrack) return;
    void managed.rawAudioTrack
      .applyConstraints({
        echoCancellation: settings.echoCancellation,
        autoGainControl: settings.autoGainControl,
      })
      .catch(() => {});
  }, [settings.echoCancellation, settings.autoGainControl]);

  const handleCreateRoom = async () => {
    useCallStore.getState().setError(null);
    const code = generateRoomCode();
    const secret = generateRoomSecret();
    await enterPreJoin(code, secret, true);
  };

  const handleJoinInput = async (raw: string) => {
    useCallStore.getState().setError(null);
    const parsed = parseRoomTarget(raw);
    if (!parsed) {
      useCallStore.getState().setError('INVALID_ROOM');
      return;
    }
    if (!parsed.secret) {
      useCallStore.getState().setError('INVALID_LINK');
      return;
    }
    await enterPreJoin(parsed.code, parsed.secret, false);
  };

  const handleChangeDevice = async (
    kind: 'audioInputId' | 'audioOutputId' | 'videoInputId',
    id: string
  ) => {
    useSettingsStore.getState().setSetting(kind, id);
    if (kind === 'audioOutputId') return;

    const managed = await setupLocalMedia();
    if (managed && rtcRef.current) {
      const audioTrack = managed.stream.getAudioTracks()[0] ?? null;
      const videoTrack = managed.stream.getVideoTracks()[0] ?? null;
      await rtcRef.current.replaceAudioTrack(audioTrack);
      if (!useCallStore.getState().isScreenSharing) {
        await rtcRef.current.replaceVideoTrack(videoTrack, true);
      }
    }
  };

  const handleToggleMic = () => {
    const nextMuted = !micMuted;
    useCallStore.getState().setMicMuted(nextMuted);
    const stream = mediaRef.current?.stream;
    stream?.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
  };

  const handleToggleCamera = () => {
    const nextOff = !cameraOff;
    useCallStore.getState().setCameraOff(nextOff);
    const stream = mediaRef.current?.stream;
    stream?.getVideoTracks().forEach((t) => {
      t.enabled = !nextOff;
    });
  };

  const handleJoinCall = async () => {
    let localStream = mediaRef.current?.stream ?? null;
    if (!localStream) {
      const acquired = await setupLocalMedia();
      localStream = acquired?.stream ?? null;
    }
    if (!localStream) return;

    useCallStore.getState().setView('call');
    const manager = new WebRtcCallManager();
    rtcRef.current = manager;
    await manager.connect({
      roomId,
      roomSecret,
      isCreator,
      localStream,
    });
  };

  const handleToggleScreenShare = async () => {
    await rtcRef.current?.toggleScreenShare();
  };

  const handleLeave = useCallback(() => {
    stopMediaAndCall();
    useCallStore.getState().resetCall();
    window.history.replaceState(null, '', '/');
  }, [stopMediaAndCall]);

  useEffect(() => {
    return () => {
      stopMediaAndCall();
    };
  }, [stopMediaAndCall]);

  const getMicLevel = useCallback(() => {
    return mediaRef.current?.getMicLevel() ?? 0;
  }, []);

  return (
    <div
      dir={settings.language === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-dvh flex flex-col bg-white dark:bg-black text-black dark:text-white"
    >
      {view !== 'call' && <Header onGoHome={handleLeave} />}
      <ErrorBanner />

      {view === 'home' && (
        <HomeView onCreateRoom={() => void handleCreateRoom()} onJoinInput={(v) => void handleJoinInput(v)} />
      )}

      {view === 'prejoin' && (
        <PreJoinView
          devices={devices}
          getMicLevel={getMicLevel}
          onToggleMic={handleToggleMic}
          onToggleCamera={handleToggleCamera}
          onChangeDevice={(k, id) => void handleChangeDevice(k, id)}
          onJoinCall={() => void handleJoinCall()}
          onBack={handleLeave}
        />
      )}

      {view === 'call' && (
        <CallView
          devices={devices}
          onToggleMic={handleToggleMic}
          onToggleCamera={handleToggleCamera}
          onToggleScreenShare={() => void handleToggleScreenShare()}
          onChangeDevice={(k, id) => void handleChangeDevice(k, id)}
          onLeave={handleLeave}
        />
      )}

      <SettingsDrawer />
    </div>
  );
}
