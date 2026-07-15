/** Slug-safe filename: strips diacritics, lowercases, replaces non-alphanumeric with `_`. */
export const sanitizeFilename = (text: string, maxLength = 30): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, maxLength)
    .toLowerCase();

/**
 * Sentence case for utterance display: capitalize only the first letter,
 * preserving the rest as typed (proper nouns, acronyms, diacritics).
 * Mixed case reads better than all-caps — word shapes are more recognizable,
 * which matters for AAC accessibility.
 */
export const sentenceCase = (s: string): string => {
  const str = s || '';
  if (!str) return str;
  return str.charAt(0).toLocaleUpperCase() + str.slice(1);
};
