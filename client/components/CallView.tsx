import {
  Activity,
  Check,
  Copy,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Video,
  VideoOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaDeviceList } from '../lib/mediaDevices.ts';
import { useCallStore } from '../stores/useCallStore.ts';
import { useSettingsStore } from '../stores/useSettingsStore.ts';
import { StatsOverlay } from './StatsOverlay.tsx';

interface CallViewProps {
  devices: MediaDeviceList;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onChangeDevice: (kind: 'audioInputId' | 'audioOutputId' | 'videoInputId', id: string) => void;
  onLeave: () => void;
}

export function CallView({
  devices,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onChangeDevice,
  onLeave,
}: CallViewProps) {
  const { t } = useTranslation();
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const roomCode = useCallStore((s) => s.roomCode);
  const roomSecret = useCallStore((s) => s.roomSecret);
  const micMuted = useCallStore((s) => s.micMuted);
  const cameraOff = useCallStore((s) => s.cameraOff);
  const isScreenSharing = useCallStore((s) => s.isScreenSharing);
  const peerConnected = useCallStore((s) => s.peerConnected);
  const peerLeft = useCallStore((s) => s.peerLeft);
  const e2eeActive = useCallStore((s) => s.e2eeActive);
  const sasCode = useCallStore((s) => s.sasCode);
  const relayActive = useCallStore((s) => s.relayActive);
  const statsPanelOpen = useCallStore((s) => s.statsPanelOpen);
  const setStatsPanelOpen = useCallStore((s) => s.setStatsPanelOpen);
  const setSettingsOpen = useCallStore((s) => s.setSettingsOpen);

  const audioInputId = useSettingsStore((s) => s.audioInputId);
  const audioOutputId = useSettingsStore((s) => s.audioOutputId);
  const videoInputId = useSettingsStore((s) => s.videoInputId);
  const mirrorSelfView = useSettingsStore((s) => s.mirrorSelfView);
  const showLiveStats = useSettingsStore((s) => s.showLiveStats);

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const [devicePopoverOpen, setDevicePopoverOpen] = useState(false);
  const [sasOpen, setSasOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/r/${roomCode}#${roomSecret}`;
  const showStats = showLiveStats || statsPanelOpen;

  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    el.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    const el = remoteVideoRef.current as (HTMLVideoElement & {
      setSinkId?: (id: string) => Promise<void>;
    }) | null;
    if (!el || typeof el.setSinkId !== 'function') return;
    void el.setSinkId(audioOutputId || '').catch(() => {});
  }, [audioOutputId, remoteStream]);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (localStream && (!cameraOff || isScreenSharing)) {
      el.srcObject = localStream;
    } else {
      el.srcObject = null;
    }
  }, [localStream, cameraOff, isScreenSharing]);

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative h-dvh w-full bg-white dark:bg-black text-black dark:text-white overflow-hidden flex flex-col">
      {/* Top minimal telemetry/room bar */}
      <header className="relative z-20 px-4 sm:px-6 h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-black/90 backdrop-blur-xs flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg font-extrabold tracking-tight leading-none shrink-0">S</span>
          <span className="text-xs font-mono tabular-nums text-neutral-600 dark:text-neutral-400 truncate">
            {roomCode}
          </span>
          {relayActive && (
            <>
              <span aria-hidden="true" className="text-neutral-400">
                ·
              </span>
              <span className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                {t('call.relayActive')}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {e2eeActive && sasCode && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSasOpen((v) => !v)}
                className="min-h-[40px] px-2.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-xs font-medium inline-flex items-center gap-1.5 hover:border-black dark:hover:border-white transition-colors whitespace-nowrap cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>{t('call.e2eeBadge')}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{sasCode}</span>
              </button>

              {sasOpen && (
                <div className="absolute end-0 top-12 w-60 p-3.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black shadow-sm space-y-1.5 z-30">
                  <div className="text-xs font-semibold">{t('call.sasLabel')}</div>
                  <div className="text-xl font-mono tabular-nums font-bold tracking-wider">
                    {sasCode}
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {t('call.sasHint')}
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('call.settings')}
            title={t('call.settings')}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-800 hover:border-black dark:hover:border-white transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Video Stage */}
      <main className="relative flex-1 bg-neutral-100 dark:bg-neutral-950 flex items-center justify-center overflow-hidden">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="px-6 text-center space-y-4">
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {peerLeft
                ? t('call.peerDisconnected')
                : peerConnected
                  ? t('call.connecting')
                  : t('call.waitingForPeer')}
            </p>
            <button
              type="button"
              onClick={handleCopyInvite}
              className="min-h-[44px] px-4 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-xs font-medium inline-flex items-center gap-2 hover:border-black dark:hover:border-white transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t('call.copied') : t('call.copyInvite')}</span>
            </button>
          </div>
        )}

        {/* Live Stats Overlay */}
        {showStats && (
          <div className="absolute top-4 end-4 z-20">
            <StatsOverlay />
          </div>
        )}

        {/* Local Self-View PiP */}
        <div className="absolute bottom-24 end-4 z-20 w-32 sm:w-52 aspect-video rounded-lg overflow-hidden border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black flex items-center justify-center shadow-sm">
          {localStream && (!cameraOff || isScreenSharing) ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${
                mirrorSelfView && !isScreenSharing ? '-scale-x-100' : ''
              }`}
            />
          ) : (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {t('call.you')}
            </span>
          )}
        </div>

        {/* Device Quick-Switch Popover */}
        {devicePopoverOpen && (
          <div className="absolute bottom-24 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 z-30 w-80 max-w-[calc(100vw-2rem)] p-4 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black shadow-md space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {t('prejoin.camera')}
              </label>
              <select
                value={videoInputId}
                onChange={(e) => onChangeDevice('videoInputId', e.target.value)}
                className="w-full min-h-[40px] px-2.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black"
              >
                <option value="">{t('prejoin.defaultDevice')}</option>
                {devices.videoInputs.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `${t('prejoin.camera')} ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {t('prejoin.microphone')}
              </label>
              <select
                value={audioInputId}
                onChange={(e) => onChangeDevice('audioInputId', e.target.value)}
                className="w-full min-h-[40px] px-2.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black"
              >
                <option value="">{t('prejoin.defaultDevice')}</option>
                {devices.audioInputs.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `${t('prejoin.microphone')} ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {t('prejoin.speaker')}
              </label>
              <select
                value={audioOutputId}
                onChange={(e) => onChangeDevice('audioOutputId', e.target.value)}
                className="w-full min-h-[40px] px-2.5 text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black"
              >
                <option value="">{t('prejoin.defaultDevice')}</option>
                {devices.audioOutputs.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `${t('prejoin.speaker')} ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Bottom Control Dock */}
        <div className="absolute bottom-4 inset-x-0 z-20 flex justify-center px-3">
          <div className="inline-flex items-center gap-1.5 sm:gap-2 p-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white/95 dark:bg-black/95 backdrop-blur-xs shadow-sm">
            <button
              type="button"
              onClick={onToggleMic}
              aria-label={micMuted ? t('call.unmute') : t('call.mute')}
              title={micMuted ? t('call.unmute') : t('call.mute')}
              className={`min-h-[44px] min-w-[44px] px-3 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                micMuted
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
              }`}
            >
              {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onToggleCamera}
              aria-label={cameraOff ? t('call.cameraOn') : t('call.cameraOff')}
              title={cameraOff ? t('call.cameraOn') : t('call.cameraOff')}
              className={`min-h-[44px] min-w-[44px] px-3 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                cameraOff
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
              }`}
            >
              {cameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setDevicePopoverOpen((v) => !v)}
              aria-label={t('call.switchDevices')}
              title={t('call.switchDevices')}
              className={`min-h-[44px] min-w-[44px] px-3 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                devicePopoverOpen
                  ? 'bg-neutral-200 dark:bg-neutral-800'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onToggleScreenShare}
              aria-label={isScreenSharing ? t('call.stopSharing') : t('call.shareScreen')}
              title={isScreenSharing ? t('call.stopSharing') : t('call.shareScreen')}
              className={`min-h-[44px] min-w-[44px] px-3 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                isScreenSharing
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
              }`}
            >
              {isScreenSharing ? (
                <MonitorOff className="w-4 h-4" />
              ) : (
                <Monitor className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setStatsPanelOpen(!statsPanelOpen)}
              aria-label={t('call.stats')}
              title={t('call.stats')}
              className={`min-h-[44px] min-w-[44px] px-3 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                showStats
                  ? 'bg-neutral-200 dark:bg-neutral-800'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-900'
              }`}
            >
              <Activity className="w-4 h-4" />
            </button>

            <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-800 mx-0.5" />

            <button
              type="button"
              onClick={onLeave}
              aria-label={t('call.leave')}
              title={t('call.leave')}
              className="min-h-[44px] px-4 rounded-md bg-black text-white dark:bg-white dark:text-black text-xs font-medium inline-flex items-center gap-2 hover:opacity-90 transition-opacity whitespace-nowrap cursor-pointer"
            >
              <PhoneOff className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">{t('call.leave')}</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
