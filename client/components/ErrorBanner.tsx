import { AlertCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCallStore } from '../stores/useCallStore.ts';

export function ErrorBanner() {
  const { t } = useTranslation();
  const error = useCallStore((s) => s.error);
  const setError = useCallStore((s) => s.setError);

  if (!error) return null;

  return (
    <div
      role="alert"
      className="w-full border-b border-black dark:border-white bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-8 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p className="text-sm font-medium truncate">{t(`errors.${error}`)}</p>
        </div>
        <button
          type="button"
          onClick={() => setError(null)}
          aria-label={t('settings.close')}
          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors shrink-0 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
