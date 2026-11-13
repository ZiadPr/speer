import { ArrowLeft, Check, Copy, Mic, MicOff, Share2, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MediaDeviceList } from '../lib/mediaDevices.ts';
import { useCallStore } from '../stores/useCallStore.ts';
import { useSettingsStore } from '../stores/useSettingsStore.ts';

interface PreJoinViewProps {
  devices: MediaDeviceList;
  getMicLevel: () => number;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onChangeDevice: (kind: 'audioInputId' | 'audioOutputId' | 'videoInputId', id: string) => void;
  onJoinCall: () => void;
  onBack: () => void;
}

export function PreJoinView({
  devices,
  getMicLevel,
  onToggleMic,
  onToggleCamera,
  onChangeDevice,
  onJoinCall,
  onBack,
}: PreJoinViewProps) {
  const { t } = useTranslation();
  const localStream = useCallStore((s) => s.localStream);
  const roomCode = useCallStore((s) => s.roomCode);
  const roomSecret = useCallStore((s) => s.roomSecret);
  const isCreator = useCallStore((s) => s.isCreator);
  const micMuted = useCallStore((s) => s.micMuted);
  const cameraOff = useCallStore((s) => s.cameraOff);

  const audioInputId = useSettingsStore((s) => s.audioInputId);
  const audioOutputId = useSettingsStore((s) => s.audioOutputId);
  const videoInputId = useSettingsStore((s) => s.videoInputId);
  const mirrorSelfView = useSettingsStore((s) => s.mirrorSelfView);
  const backgroundBlur = useSettingsStore((s) => s.backgroundBlur);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/r/${roomCode}#${roomSecret}`;
  const canNativeShare = typeof navigator.share === 'function';

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (localStream && !cameraOff) {
      videoEl.srcObject = localStream;
    } else {
      videoEl.srcObject = null;
    }
  }, [localStream, cameraOff]);

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setMicLevel(micMuted ? 0 : getMicLevel());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [getMicLevel, micMuted]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleShare = async () => {
    if (!canNativeShare) return;
    try {
      await navigator.share({
        title: t('appName'),
        url: shareUrl,
      });
    } catch {
      // User cancelled share
    }
  };

  return (
    <main className="flex-1 px-4 sm:px-8 py-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] px-3 -ms-3 inline-flex items-center gap-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            <span>{t('prejoin.back')}</span>
          </button>

          <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
            <span>{t('prejoin.roomCode')}</span>
            <span aria-hidden="true">·</span>
            <span className="text-black dark:text-white font-medium">{roomCode}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
          <div className="space-y-4">
            <div className="relative aspect-video w-full rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-950 flex items-center justify-center">
              {!cameraOff && localStream?.getVideoTracks().length ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${mirrorSelfView ? '-scale-x-100' : ''}`}
                />
              ) : (
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {t('prejoin.cameraOff')}
                </span>
              )}

              <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onToggleMic}
                    aria-label={micMuted ? t('call.unmute') : t('call.mute')}
                    title={micMuted ? t('call.unmute') : t('call.mute')}
                    className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md border transition-colors cursor-pointer ${
                      micMuted
                        ? 'bg-white text-black border-black dark:bg-black dark:text-white dark:border-white'
                        : 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                    }`}
                  >
                    {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  <button
                    type="button"
                    onClick={onToggleCamera}
                    aria-label={cameraOff ? t('call.cameraOn') : t('call.cameraOff')}
                    title={cameraOff ? t('call.cameraOn') : t('call.cameraOff')}
                    className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md border transition-colors cursor-pointer ${
                      cameraOff
                        ? 'bg-white text-black border-black dark:bg-black dark:text-white dark:border-white'
                        : 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                    }`}
                  >
                    {cameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                  </button>
                </div>

                {backgroundBlur && !cameraOff && (
                  <span className="text-xs px-2.5 py-1 rounded bg-white/90 dark:bg-black/90 text-black dark:text-white border border-neutral-300 dark:border-neutral-700">
                    {t('prejoin.blurActive')}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-md border border-neutral-200 dark:border-neutral-800">
              <input
                type="text"
                dir="ltr"
                readOnly
                value={shareUrl}
                aria-label={t('prejoin.roomCode')}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 bg-transparent text-xs font-mono text-start text-neutral-700 dark:text-neutral-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="min-h-[40px] px-3 rounded-md border border-neutral-300 dark:border-neutral-700 text-xs font-medium inline-flex items-center gap-1.5 hover:border-black dark:hover:border-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? t('prejoin.copied') : t('prejoin.copyLink')}</span>
              </button>
              {canNativeShare && (
                <button
                  type="button"
                  onClick={handleShare}
                  aria-label={t('prejoin.shareLink')}
                  title={t('prejoin.shareLink')}
                  className="min-h-[40px] px-3 rounded-md border border-neutral-300 dark:border-neutral-700 text-xs font-medium inline-flex items-center gap-1.5 hover:border-black dark:hover:border-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{t('prejoin.shareLink')}</span>
                </button>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400">
                <span>{t('prejoin.micLevel')}</span>
                <span className="font-mono tabular-nums">{Math.round(micLevel * 100)}%</span>
              </div>
              <div
                className="h-2 w-full rounded-sm bg-neutral-200 dark:bg-neutral-800 overflow-hidden"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(micLevel * 100)}
                aria-label={t('prejoin.micLevel')}
              >
                <div
                  className="h-full bg-black dark:bg-white transition-transform duration-75 origin-left rtl:origin-right"
                  style={{ transform: `scaleX(${micLevel})` }}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5" htmlFor="prejoin-cam">
                  {t('prejoin.camera')}
                </label>
                <select
                  id="prejoin-cam"
                  value={videoInputId}
                  onChange={(e) => onChangeDevice('videoInputId', e.target.value)}
                  className="w-full min-h-[44px] px-3 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-black dark:text-white"
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
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5" htmlFor="prejoin-mic">
                  {t('prejoin.microphone')}
                </label>
                <select
                  id="prejoin-mic"
                  value={audioInputId}
                  onChange={(e) => onChangeDevice('audioInputId', e.target.value)}
                  className="w-full min-h-[44px] px-3 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-black dark:text-white"
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
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1.5" htmlFor="prejoin-spk">
                  {t('prejoin.speaker')}
                </label>
                <select
                  id="prejoin-spk"
                  value={audioOutputId}
                  onChange={(e) => onChangeDevice('audioOutputId', e.target.value)}
                  className="w-full min-h-[44px] px-3 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-black dark:text-white"
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

            <button
              type="button"
              onClick={onJoinCall}
              className="w-full min-h-[48px] px-5 rounded-md bg-black text-white dark:bg-white dark:text-black font-medium text-sm hover:opacity-90 active:scale-[0.99] transition-all whitespace-nowrap cursor-pointer"
            >
              {isCreator ? t('prejoin.startCall') : t('prejoin.joinCall')}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
