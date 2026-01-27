import { type Locale } from '../locales';

/**
 * Detects the user's preferred language based on browser settings
 * Maps various language codes to supported locales
 */
export const detectUserLanguage = (): Locale => {
  const browserLang = navigator.language || (navigator.languages && navigator.languages[0]);

  if (browserLang) {
    // Map language codes to supported locales
    const langCode = browserLang.toLowerCase();

    // English variants → en-GB
    if (langCode.startsWith('en')) return 'en-GB';

    // Spanish variants → es-419
    if (langCode.startsWith('es')) return 'es-419';
  }

  // Default to Spanish (current UI language)
  return 'es-419';
};

/**
 * Validates if a string is a supported locale
 */
export const isValidLocale = (value: any): value is Locale => {
  return value === 'en-GB' || value === 'es-419';
};

/**
 * Gets the stored locale from localStorage or returns null
 */
export const getStoredLocale = (): Locale | null => {
  const stored = localStorage.getItem('pictonet_v19_uiLang');
  return isValidLocale(stored) ? stored : null;
};

/**
 * Stores the locale preference in localStorage
 */
export const setStoredLocale = (locale: Locale): void => {
  localStorage.setItem('pictonet_v19_uiLang', locale);
};
