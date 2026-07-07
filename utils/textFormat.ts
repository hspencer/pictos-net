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
