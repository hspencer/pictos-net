import { useSyncExternalStore } from 'react';
import { translations, type Locale } from '../locales';

const STORAGE_KEY = 'pictonet_v19_uiLang';

const LOCALE_EVENT = 'pictonet-ui-language';
const getLocale = (): Locale => {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  if (saved === 'en-GB' || saved === 'es-419') return saved;
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en-GB' : 'es-419';
};
const subscribe = (listener: () => void) => {
  window.addEventListener(LOCALE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(LOCALE_EVENT, listener); window.removeEventListener('storage', listener); };
};

/** Every mounted consumer observes the same UI locale, including memoized rows. */
export const useTranslation = () => {
  const lang = useSyncExternalStore(subscribe, getLocale, getLocale);
  const setLang = (locale: Locale) => {
    localStorage.setItem(STORAGE_KEY, locale);
    window.dispatchEvent(new Event(LOCALE_EVENT));
  };

  /**
   * Translation function with variable interpolation
   * @param key - Dot-notation translation key (e.g., 'header.title')
   * @param vars - Optional variables for interpolation (e.g., { count: 5 })
   * @returns Translated string with variables interpolated
   */
  const t = (key: string, vars?: Record<string, any>): string => {
    const keys = key.split('.');
    let value: any = translations[lang];

    // Navigate through nested object
    for (const k of keys) {
      value = value?.[k];
      if (!value) break;
    }

    // Fallback to Spanish if translation not found in current language
    if (typeof value !== 'string') {
      value = translations['es-419'];
      for (const k of keys) {
        value = value?.[k];
        if (!value) break;
      }
    }

    // Last resort: return key itself and warn
    if (typeof value !== 'string') {
      console.warn(`[i18n] Missing translation: ${key}`);
      return key;
    }

    // Simple variable interpolation
    if (vars) {
      return value.replace(/\{(\w+)\}/g, (match, varName) => {
        return vars[varName] !== undefined ? String(vars[varName]) : match;
      });
    }

    return value;
  };

  return {
    t,              // Translation function
    lang,           // Current locale
    setLang  // Function to change locale
  };
};
