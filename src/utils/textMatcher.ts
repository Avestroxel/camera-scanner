import { MatchMode, ChecklistItem } from '../types';

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
  text = text
    .replace(/[٠۰]/g, '0')
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
  text = text
    .replace(/[يىێ]/g, 'ي')
    .replace(/[كک]/g, 'ك')
    .replace(/[ةەھ]/g, 'ه')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ۆؤ]/g, 'و');

  return text;
}

/**
 * Fast normalized alphanumeric cleaner for O(1) multi-target lookup.
 */
export function cleanNormalized(input: string): string {
  if (!input) return '';
  return normalizeText(input).replace(/[^a-z0-9\u0600-\u06FF]/gu, '');
}

/**
 * Normalizes common monospace thermal-printer OCR confusions (O<->0, I/l<->1)
 * ONLY for exact substring verification on alphanumeric serial codes.
 */
export function normalizeSerialLookalikes(input: string): string {
  if (!input) return '';
  return input
    .replace(/[oO]/g, '0')
    .replace(/[iIlL]/g, '1');
}

export interface PreparedTarget {
  item: ChecklistItem;
  rawTrimmed: string;
  cleanTarget: string;
  serialLookalikeTarget: string;
  parts: string[];
  isMultiWord: boolean;
}

/**
 * Pre-normalizes all active checklist items into an indexed lookup array
 * before scanning the OCR word matrix.
 */
export function prepareTargets(items: ChecklistItem[]): PreparedTarget[] {
  const prepared: PreparedTarget[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rawTrimmed = item.text.trim();
    const cleanTarget = cleanNormalized(rawTrimmed);
    if (!cleanTarget) continue;

    const rawParts = rawTrimmed
      .split(/\s+/)
      .map((p) => cleanNormalized(p))
      .filter(Boolean);

    prepared.push({
      item,
      rawTrimmed,
      cleanTarget,
      serialLookalikeTarget: normalizeSerialLookalikes(cleanTarget),
      parts: rawParts,
      isMultiWord: rawParts.length > 1,
    });
  }
  return prepared;
}

/**
 * Smart Sub-Token Slicing:
 * If a target ("PE510" or "netlify") is found inside a longer OCR token ("PE51000652D" or "camscanner07.netlify.app"),
 * calculates its exact horizontal slice (slicedX0, slicedX1) inside word.bbox.
 */
export function sliceSubTokenBbox(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  rawToken: string,
  rawTarget: string,
  cleanToken: string,
  cleanTarget: string
): { x0: number; y0: number; x1: number; y1: number } {
  const boxW = bbox.x1 - bbox.x0;
  if (boxW <= 0) return bbox;

  // 1. Direct index on normalized raw token (preserves punctuation spacing like dots/hyphens)
  const normRawToken = normalizeText(rawToken);
  const normRawTarget = normalizeText(rawTarget);
  let rawIdx = normRawToken.indexOf(normRawTarget);
  if (rawIdx < 0) {
    rawIdx = normalizeSerialLookalikes(normRawToken).indexOf(
      normalizeSerialLookalikes(normRawTarget)
    );
  }
  if (rawIdx >= 0 && normRawToken.length > normRawTarget.length) {
    const startRatio = rawIdx / normRawToken.length;
    const widthRatio = Math.min(1 - startRatio, normRawTarget.length / normRawToken.length);
    const slicedX0 = bbox.x0 + boxW * startRatio;
    const slicedX1 = slicedX0 + boxW * widthRatio;
    return {
      x0: slicedX0,
      y0: bbox.y0,
      x1: slicedX1,
      y1: bbox.y1,
    };
  }

  // 2. Fallback to cleaned alphanumeric ratio
  let idx = cleanToken.indexOf(cleanTarget);
  if (idx < 0) {
    idx = normalizeSerialLookalikes(cleanToken).indexOf(
      normalizeSerialLookalikes(cleanTarget)
    );
  }
  if (idx >= 0 && cleanToken.length > cleanTarget.length) {
    const startRatio = idx / cleanToken.length;
    const widthRatio = Math.min(1 - startRatio, cleanTarget.length / cleanToken.length);
    const slicedX0 = bbox.x0 + boxW * startRatio;
    const slicedX1 = slicedX0 + boxW * widthRatio;
    return {
      x0: slicedX0,
      y0: bbox.y0,
      x1: slicedX1,
      y1: bbox.y1,
    };
  }

  return bbox;
}

/**
 * Evaluates whether an OCR detected word strictly matches the target query
 * without false-positive fuzzy matches on unrelated serial numbers.
 */
export function checkMatch(
  detectedRaw: string,
  targetRaw: string,
  mode: MatchMode
): { isMatch: boolean; score: number } {
  if (!detectedRaw || !targetRaw) {
    return { isMatch: false, score: 0 };
  }

  const normTarget = cleanNormalized(targetRaw);
  const normDetected = cleanNormalized(detectedRaw);

  if (!normTarget || !normDetected) {
    return { isMatch: false, score: 0 };
  }

  if (normDetected === normTarget) {
    return { isMatch: true, score: 1.0 };
  }

  if (mode === 'exact') {
    return { isMatch: false, score: 0 };
  }

  if (normDetected.includes(normTarget)) {
    return { isMatch: true, score: 0.98 };
  }

  if (
    normTarget.length >= 3 &&
    normalizeSerialLookalikes(normDetected).includes(normalizeSerialLookalikes(normTarget))
  ) {
    return { isMatch: true, score: 0.95 };
  }

  return { isMatch: false, score: 0 };
}
