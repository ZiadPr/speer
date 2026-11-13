import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { LanguageCode } from '../types/index.ts';
import en from './locales/en.ts';
import ar from './locales/ar.ts';
import fr from './locales/fr.ts';

const SETTINGS_STORAGE_KEY = 'speer-settings';

export function detectInitialLanguage(): LanguageCode {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { language?: string } };
      const saved = parsed?.state?.language;
      if (saved === 'en' || saved === 'ar' || saved === 'fr') {
        return saved;
      }
    }
  } catch {
    // ignore storage read failure
  }

  const navLang = (navigator.language || 'en').toLowerCase();
  if (navLang.startsWith('ar')) return 'ar';
  if (navLang.startsWith('fr')) return 'fr';
  return 'en';
}

export function applyDocumentDirection(lang: LanguageCode) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

const initialLanguage = detectInitialLanguage();
applyDocumentDirection(initialLanguage);

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
    fr: { translation: fr },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
