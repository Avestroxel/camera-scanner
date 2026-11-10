import { MatchMode } from '../types';

/**
 * Strips all spaces, symbols, and punctuation, preserving alphanumeric
 * characters in English, Arabic, and Kurdish.
 */
export function cleanAlphanumeric(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]/gu, '');
}

/**
 * Normalizes text across English, Arabic, and Kurdish scripts:
 * - Trims and lowercases
 * - Unifies Kurdish/Persian and Arabic glyph variants (ی -> ي, ک -> ك, ە -> ه)
 * - Removes Arabic/Kurdish diacritics (tashkeel, harakat, tatweel)
 * - Normalizes Eastern/Arabic digits (٠-٩, ۰-۹) to standard digits (0-9)
 */
export function normalizeText(input: string): string {
  if (!input) return '';

  let text = input.trim().toLowerCase();

  // Remove diacritics & tatweel
  text = text.replace(/[\u064B-\u065F\u0670\u0640]/g, '');

  // Normalize digits (Arabic-Indic and Eastern Arabic-Indic to standard)
  text = text.replace(/[٠۰]/g, '0')
             .replace(/[١۱]/g, '1')
             .replace(/[٢۲]/g, '2')
             .replace(/[٣۳]/g, '3')
             .replace(/[٤۴]/g, '4')
             .replace(/[٥۵]/g, '5')
             .replace(/[٦۶]/g, '6')
             .replace(/[٧۷]/g, '7')
             .replace(/[٨۸]/g, '8')
             .replace(/[٩۹]/g, '9');

  // Normalize common Arabic/Kurdish letter variants
  text = text.replace(/[يىێ]/g, 'ي')
             .replace(/[كک]/g, 'ك')
             .replace(/[ةەھ]/g, 'ه')
             .replace(/[إأآا]/g, 'ا')
             .replace(/[ۆؤ]/g, 'و');

  return text;
}

/**
 * Levenshtein Distance for fuzzy matching OCR errors
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

/**
 * Evaluates whether an OCR detected token (word or line) matches the target query
 */
export function checkMatch(
  detectedRaw: string,
  targetRaw: string,
  mode: MatchMode
): { isMatch: boolean; score: number } {
  if (!detectedRaw || !targetRaw) {
    return { isMatch: false, score: 0 };
  }

  const cleanTarget = cleanAlphanumeric(targetRaw);
  const cleanDetected = cleanAlphanumeric(detectedRaw);

  if (!cleanTarget || !cleanDetected) {
    return { isMatch: false, score: 0 };
  }

  // Exact alphanumeric match
  if (cleanDetected === cleanTarget) {
    return { isMatch: true, score: 1.0 };
  }

  // Exact normalized match (taking into account Kurdish/Arabic letter unification)
  const normTarget = normalizeText(cleanTarget);
  const normDetected = normalizeText(cleanDetected);
  if (normDetected === normTarget) {
    return { isMatch: true, score: 1.0 };
  }

  if (mode === 'exact') {
    return { isMatch: false, score: 0 };
  }

  // Substring match: detected text contains target (e.g. line contains "total" or "52.71")
  if (normDetected.includes(normTarget)) {
    return { isMatch: true, score: 0.95 };
  }

  // Or target contains detected if word is split (at least 3 characters)
  if (normTarget.length >= 4 && normTarget.includes(normDetected) && normDetected.length >= 3) {
    return { isMatch: true, score: 0.85 };
  }

  // Fuzzy match
  if (mode === 'fuzzy') {
    const maxLen = Math.max(normDetected.length, normTarget.length);
    if (maxLen >= 3) {
      const dist = levenshteinDistance(normDetected, normTarget);
      const similarity = 1 - dist / maxLen;

      // Allow 1 typo for 3-5 chars, 2 typos for 6+ chars
      const threshold = maxLen <= 4 ? 0.75 : maxLen <= 7 ? 0.70 : 0.65;
      if (similarity >= threshold) {
        return { isMatch: true, score: similarity };
      }
    }
  }

  return { isMatch: false, score: 0 };
}
