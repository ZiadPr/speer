import { ArrowRight, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeRoomCode } from '../lib/crypto.ts';

interface HomeViewProps {
  onCreateRoom: () => void;
  onJoinInput: (rawInput: string) => void;
}

export function HomeView({ onCreateRoom, onJoinInput }: HomeViewProps) {
  const { t } = useTranslation();
  const [joinOpen, setJoinOpen] = useState(false);
  const [input, setInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onJoinInput(input.trim());
  };

  const canSubmit = input.trim().length > 0 && (input.includes('#') || normalizeRoomCode(input).length >= 8);

  return (
    <main className="flex-1 flex items-center justify-center px-4 sm:px-8 py-12">
      <div className="w-full max-w-md space-y-10">
        <div className="space-y-4 flex flex-col items-center text-center">
          <div className="text-5xl font-extrabold tracking-tight leading-none select-none">S</div>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white border-double">
            {t('appName')}
          </h1>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={onCreateRoom}
            className="w-full min-h-[48px] px-5 rounded-md bg-black text-white dark:bg-white dark:text-black font-medium text-sm inline-flex items-center justify-between hover:opacity-90 active:scale-[0.99] transition-all whitespace-nowrap cursor-pointer"
          >
            <span>{t('home.createRoom')}</span>
            <Plus className="w-4 h-4 shrink-0" />
          </button>

          {!joinOpen ? (
            <button
              type="button"
              onClick={() => setJoinOpen(true)}
              className="w-full min-h-[48px] px-5 rounded-md border border-neutral-300 dark:border-neutral-700 text-black dark:text-white font-medium text-sm inline-flex items-center justify-between hover:border-black dark:hover:border-white transition-colors whitespace-nowrap cursor-pointer"
            >
              <span>{t('home.joinWithCode')}</span>
              <ArrowRight className="w-4 h-4 shrink-0 rtl:rotate-180" />
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-2.5 pt-1">
              <div className="flex gap-2">
                <input
                  type="text"
                  dir="ltr"
                  autoFocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t('home.codePlaceholder')}
                  aria-label={t('home.joinWithCode')}
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 min-w-0 min-h-[48px] px-3.5 rounded-md border border-black dark:border-white bg-white dark:bg-black text-black dark:text-white font-mono text-sm text-start placeholder:font-sans placeholder:text-neutral-400"
                />
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="min-h-[48px] px-5 rounded-md bg-black text-white dark:bg-white dark:text-black font-medium text-sm whitespace-nowrap shrink-0 disabled:opacity-35 disabled:cursor-not-allowed hover:opacity-90 transition-opacity cursor-pointer"
                >
                  {t('home.joinAction')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
