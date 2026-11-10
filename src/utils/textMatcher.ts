import { MatchMode } from '../types';

/**
 * Normalizes text across English, Arabic, and Kurdish scripts:
 * - Trims and lowercases
 * - Unifies Kurdish/Persian and Arabic glyph variants (ی -> ي, ک -> ك, ە -> ه)
 * - Removes Arabic/Kurdish diacritics (tashkeel, harakat, tatweel)
 * - Normalizes Eastern/Arabic digits (٠-٩, ۰-۹) to standard digits (0-9)
 * - Strips common surrounding punctuation marks
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

  // Strip leading/trailing punctuation but keep numbers, letters and internal hyphens/dots
  text = text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

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
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Evaluates whether an OCR detected token matches the target query
 */
export function checkMatch(
  detectedRaw: string,
  targetRaw: string,
  mode: MatchMode
): { isMatch: boolean; score: number } {
  const targetNorm = normalizeText(targetRaw);
  const detectedNorm = normalizeText(detectedRaw);

  if (!targetNorm || !detectedNorm) {
    return { isMatch: false, score: 0 };
  }

  // Exact match
  if (detectedNorm === targetNorm) {
    return { isMatch: true, score: 1.0 };
  }

  if (mode === 'exact') {
    return { isMatch: false, score: 0 };
  }

  // Contains match (either detected contains target, or target contains detected for split words)
  if (detectedNorm.includes(targetNorm)) {
    return { isMatch: true, score: 0.9 };
  }

  if (targetNorm.length >= 4 && targetNorm.includes(detectedNorm) && detectedNorm.length >= 3) {
    return { isMatch: true, score: 0.8 };
  }

  // Fuzzy match
  if (mode === 'fuzzy') {
    const maxLen = Math.max(detectedNorm.length, targetNorm.length);
    if (maxLen >= 3) {
      const dist = levenshteinDistance(detectedNorm, targetNorm);
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
