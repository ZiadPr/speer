import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { probeRegionalIceServers } from '../lib/iceProbe.ts';
import { listMediaDevices, type MediaDeviceList } from '../lib/mediaDevices.ts';
import { useCallStore } from '../stores/useCallStore.ts';
import { useSettingsStore } from '../stores/useSettingsStore.ts';
import type {
  LanguageCode,
  RegionCode,
  RegionalIceServer,
  ThemeMode,
  VideoFrameRate,
  VideoResolution,
} from '../types/index.ts';

type SettingsTab = 'general' | 'audio' | 'video' | 'connection';

interface ToggleRowProps {
  label: string;
  note?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, note, checked, onChange }: ToggleRowProps) {
  return (
    <div className="py-3 border-b border-neutral-200 dark:border-neutral-800 last:border-b-0">
      <label className="flex items-center justify-between gap-4 cursor-pointer min-h-[44px]">
        <span className="text-sm font-medium text-black dark:text-white">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
            checked
              ? 'bg-black border-black dark:bg-white dark:border-white'
              : 'bg-neutral-200 border-neutral-300 dark:bg-neutral-800 dark:border-neutral-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full transition-transform ${
              checked
                ? 'translate-x-5 rtl:-translate-x-5 bg-white dark:bg-black'
                : 'translate-x-1 rtl:-translate-x-1 bg-black dark:bg-white'
            }`}
          />
        </button>
      </label>
      {note && <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{note}</p>}
    </div>
  );
}

export function SettingsDrawer() {
  const { t } = useTranslation();
  const settingsOpen = useCallStore((s) => s.settingsOpen);
  const setSettingsOpen = useCallStore((s) => s.setSettingsOpen);

  const settings = useSettingsStore();
  const [tab, setTab] = useState<SettingsTab>('general');
  const [devices, setDevices] = useState<MediaDeviceList>({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
  });
  const [regions, setRegions] = useState<RegionalIceServer[]>([]);

  useEffect(() => {
    if (!settingsOpen) return;
    void listMediaDevices().then(setDevices);
    void probeRegionalIceServers().then(setRegions);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: t('settings.tabs.general') },
    { id: 'audio', label: t('settings.tabs.audio') },
    { id: 'video', label: t('settings.tabs.video') },
    { id: 'connection', label: t('settings.tabs.connection') },
  ];

  const getRegionRtt = (code: Exclude<RegionCode, 'auto'>) => {
    const found = regions.find((r) => r.region === code);
    return found?.rttMs != null ? ` (${found.rttMs} ms)` : '';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        className="w-full max-w-md h-full bg-white dark:bg-black text-black dark:text-white border-s border-neutral-200 dark:border-neutral-800 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label={t('settings.close')}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-3 border-b border-neutral-200 dark:border-neutral-800 flex gap-1 overflow-x-auto">
          {tabs.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3 min-h-[44px] text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-black dark:border-white text-black dark:text-white'
                    : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {tab === 'general' && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('settings.general.language')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { code: 'en', label: 'English' },
                      { code: 'ar', label: 'العربية' },
                      { code: 'fr', label: 'Français' },
                    ] as { code: LanguageCode; label: string }[]
                  ).map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => settings.setSetting('language', item.code)}
                      className={`min-h-[44px] px-3 text-sm font-medium rounded-md border transition-colors cursor-pointer ${
                        settings.language === item.code
                          ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                          : 'border-neutral-300 dark:border-neutral-700 hover:border-black dark:hover:border-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('settings.general.theme')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => settings.setSetting('theme', mode)}
                      className={`min-h-[44px] px-3 text-sm font-medium rounded-md border transition-colors cursor-pointer ${
                        settings.theme === mode
                          ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                          : 'border-neutral-300 dark:border-neutral-700 hover:border-black dark:hover:border-white'
                      }`}
                    >
                      {t(`settings.general.themes.${mode}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'audio' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="settings-mic">
                  {t('settings.audio.input')}
                </label>
                <select
                  id="settings-mic"
                  value={settings.audioInputId}
                  onChange={(e) => settings.setSetting('audioInputId', e.target.value)}
                  className="w-full min-h-[44px] px-3 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-black dark:text-white"
                >
                  <option value="">{t('prejoin.defaultDevice')}</option>
                  {devices.audioInputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `${t('settings.audio.input')} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="settings-spk">
                  {t('settings.audio.output')}
                </label>
                <select
                  id="settings-spk"
                  value={settings.audioOutputId}
                  onChange={(e) => settings.setSetting('audioOutputId', e.target.value)}
                  className="w-full min-h-[44px] px-3 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-black dark:text-white"
                >
                  <option value="">{t('prejoin.defaultDevice')}</option>
                  {devices.audioOutputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `${t('settings.audio.output')} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2">
                <ToggleRow
                  label={t('settings.audio.noiseSuppression')}
                  checked={settings.noiseSuppression}
                  onChange={(v) => settings.setSetting('noiseSuppression', v)}
                />
                <ToggleRow
                  label={t('settings.audio.echoCancellation')}
                  checked={settings.echoCancellation}
                  onChange={(v) => settings.setSetting('echoCancellation', v)}
                />
                <ToggleRow
                  label={t('settings.audio.autoGainControl')}
                  checked={settings.autoGainControl}
                  onChange={(v) => settings.setSetting('autoGainControl', v)}
                />
                <ToggleRow
                  label={t('settings.audio.muteOnJoin')}
                  checked={settings.muteOnJoin}
                  onChange={(v) => settings.setSetting('muteOnJoin', v)}
                />
              </div>
            </div>
          )}

          {tab === 'video' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="settings-cam">
                  {t('settings.video.camera')}
                </label>
                <select
                  id="settings-cam"
                  value={settings.videoInputId}
                  onChange={(e) => settings.setSetting('videoInputId', e.target.value)}
                  className="w-full min-h-[44px] px-3 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-black dark:text-white"
                >
                  <option value="">{t('prejoin.defaultDevice')}</option>
                  {devices.videoInputs.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `${t('settings.video.camera')} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('settings.video.resolution')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['480p', '720p', '1080p'] as VideoResolution[]).map((res) => (
                    <button
                      key={res}
                      type="button"
                      onClick={() => settings.setSetting('resolution', res)}
                      className={`min-h-[44px] px-3 text-sm font-mono tabular-nums font-medium rounded-md border transition-colors cursor-pointer ${
                        settings.resolution === res
                          ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                          : 'border-neutral-300 dark:border-neutral-700 hover:border-black dark:hover:border-white'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('settings.video.frameRate')}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {([15, 24, 30, 60] as VideoFrameRate[]).map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      onClick={() => settings.setSetting('frameRate', fps)}
                      className={`min-h-[44px] px-2 text-sm font-mono tabular-nums font-medium rounded-md border transition-colors cursor-pointer ${
                        settings.frameRate === fps
                          ? 'bg-black text-white border-black dark:bg-white dark:text-black dark:border-white'
                          : 'border-neutral-300 dark:border-neutral-700 hover:border-black dark:hover:border-white'
                      }`}
                    >
                      {fps}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <ToggleRow
                  label={t('settings.video.mirrorSelfView')}
                  checked={settings.mirrorSelfView}
                  onChange={(v) => settings.setSetting('mirrorSelfView', v)}
                />
                <ToggleRow
                  label={t('settings.video.backgroundBlur')}
                  checked={settings.backgroundBlur}
                  onChange={(v) => settings.setSetting('backgroundBlur', v)}
                />
              </div>
            </div>
          )}

          {tab === 'connection' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" htmlFor="settings-region">
                  {t('settings.connection.preferredRegion')}
                </label>
                <select
                  id="settings-region"
                  value={settings.preferredRegion}
                  onChange={(e) => settings.setSetting('preferredRegion', e.target.value as RegionCode)}
                  className="w-full min-h-[44px] px-3 text-sm rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-black text-black dark:text-white"
                >
                  <option value="auto">{t('settings.connection.regions.auto')}</option>
                  <option value="us">
                    {t('settings.connection.regions.us')}
                    {getRegionRtt('us')}
                  </option>
                  <option value="eu">
                    {t('settings.connection.regions.eu')}
                    {getRegionRtt('eu')}
                  </option>
                  <option value="ap">
                    {t('settings.connection.regions.ap')}
                    {getRegionRtt('ap')}
                  </option>
                  <option value="sa">
                    {t('settings.connection.regions.sa')}
                    {getRegionRtt('sa')}
                  </option>
                </select>
              </div>

              <div className="pt-2">
                <ToggleRow
                  label={t('settings.connection.hideMyIp')}
                  note={t('settings.connection.hideMyIpNote')}
                  checked={settings.hideMyIp}
                  onChange={(v) => settings.setSetting('hideMyIp', v)}
                />
                <ToggleRow
                  label={t('settings.connection.showLiveStats')}
                  checked={settings.showLiveStats}
                  onChange={(v) => settings.setSetting('showLiveStats', v)}
                />
                <ToggleRow
                  label={t('settings.connection.e2ee')}
                  checked={settings.e2eeEnabled}
                  onChange={(v) => settings.setSetting('e2eeEnabled', v)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => settings.resetDefaults()}
            className="w-full min-h-[44px] px-4 text-sm font-medium rounded-md border border-neutral-300 dark:border-neutral-700 hover:border-black dark:hover:border-white transition-colors cursor-pointer"
          >
            {t('settings.resetDefaults')}
          </button>
        </div>
      </div>
    </div>
  );
}
