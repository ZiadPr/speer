import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n, { applyDocumentDirection, detectInitialLanguage } from '../i18n/index.ts';
import type { SettingsState, ThemeMode } from '../types/index.ts';

const DEFAULT_SETTINGS = {
  language: detectInitialLanguage(),
  theme: 'system' as ThemeMode,

  audioInputId: '',
  audioOutputId: '',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  muteOnJoin: false,

  videoInputId: '',
  resolution: '720p' as const,
  frameRate: 30 as const,
  mirrorSelfView: true,
  backgroundBlur: false,

  preferredRegion: 'auto' as const,
  hideMyIp: false,
  showLiveStats: false,
  e2eeEnabled: true,
};

export function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const shouldDark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', shouldDark);
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      setSetting: (key, value) => {
        set({ [key]: value } as Partial<SettingsState>);

        if (key === 'language' && typeof value === 'string') {
          void i18n.changeLanguage(value);
          applyDocumentDirection(value as SettingsState['language']);
        }
        if (key === 'theme') {
          applyThemeMode(value as ThemeMode);
        }
      },

      resetDefaults: () => {
        const freshLanguage = detectInitialLanguage();
        set({
          ...DEFAULT_SETTINGS,
          language: freshLanguage,
        });
        void i18n.changeLanguage(freshLanguage);
        applyDocumentDirection(freshLanguage);
        applyThemeMode(DEFAULT_SETTINGS.theme);
      },
    }),
    {
      name: 'speer-settings',
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        audioInputId: state.audioInputId,
        audioOutputId: state.audioOutputId,
        noiseSuppression: state.noiseSuppression,
        echoCancellation: state.echoCancellation,
        autoGainControl: state.autoGainControl,
        muteOnJoin: state.muteOnJoin,
        videoInputId: state.videoInputId,
        resolution: state.resolution,
        frameRate: state.frameRate,
        mirrorSelfView: state.mirrorSelfView,
        backgroundBlur: state.backgroundBlur,
        preferredRegion: state.preferredRegion,
        hideMyIp: state.hideMyIp,
        showLiveStats: state.showLiveStats,
        e2eeEnabled: state.e2eeEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        void i18n.changeLanguage(state.language);
        applyDocumentDirection(state.language);
        applyThemeMode(state.theme);
      },
    }
  )
);
