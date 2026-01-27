import { useState, useEffect } from 'react';
import { translations, type Locale } from '../locales';

const STORAGE_KEY = 'pictonet_v19_uiLang';

/**
 * Custom i18n hook for PICTOS.NET
 * Provides translation function with variable interpolation and automatic locale detection
 */
export const useTranslation = () => {
  const [lang, setLangState] = useState<Locale>(() => {
    // 1. Check for saved preference
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved === 'en-GB' || saved === 'es-419') return saved;

    // 2. Detect browser locale
    const browserLang = navigator.language || (navigator.languages && navigator.languages[0]);
    if (browserLang) {
      if (browserLang.startsWith('en')) return 'en-GB';
      if (browserLang.startsWith('es')) return 'es-419';
    }

    // 3. Default fallback
    return 'es-419';
  });

  // Persist language preference
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

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
    setLang: setLangState  // Function to change locale
  };
};
