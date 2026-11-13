import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCallStore } from '../stores/useCallStore.ts';
import { useSettingsStore } from '../stores/useSettingsStore.ts';
import type { LanguageCode } from '../types/index.ts';

interface HeaderProps {
  onGoHome?: () => void;
}

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ar', label: 'AR' },
  { code: 'fr', label: 'FR' },
];

export function Header({ onGoHome }: HeaderProps) {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const setSettingsOpen = useCallStore((s) => s.setSettingsOpen);

  return (
    <header className="w-full border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={onGoHome}
          className="inline-flex items-center gap-2.5 text-black dark:text-white whitespace-nowrap shrink-0 min-h-[44px] cursor-pointer"
          aria-label={t('appName')}
        >
          <span className="text-2xl font-extrabold tracking-tight leading-none">S</span>
          <span className="text-base font-semibold tracking-tight">{t('appName')}</span>
        </button>

        <div className="flex items-center gap-3 shrink-0">
          <div
            className="inline-flex items-center border border-neutral-200 dark:border-neutral-800 rounded-md p-0.5"
            role="group"
            aria-label={t('settings.general.language')}
          >
            {LANGUAGES.map((item) => {
              const active = language === item.code;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setSetting('language', item.code)}
                  className={`px-2.5 min-h-[36px] text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-black text-white dark:bg-white dark:text-black'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('settings.title')}
            title={t('settings.title')}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-800 text-black dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
