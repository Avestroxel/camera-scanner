export type OcrLanguage = 'eng+ara' | 'eng' | 'ara';

export type MatchMode = 'contains' | 'exact' | 'fuzzy';

export type UILanguage = 'en' | 'ku' | 'ar';

export interface BoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  createdAt: number;
  isCompleted?: boolean;
  completedAt?: number;
}

export interface MatchedWord {
  id: string;
  text: string;
  normalizedText: string;
  confidence: number;
  bbox: BoundingBox;
  isMatch: boolean;
  score?: number;
  matchedItemId?: string;
  matchedItemText?: string;
}

export interface DetectedMatchGroup {
  item: ChecklistItem;
  words: MatchedWord[];
  primaryWord: MatchedWord;
}

export interface ScanResult {
  allWords: MatchedWord[];
  matchedWords: MatchedWord[];
  detectedGroups: DetectedMatchGroup[];
  fullText: string;
  processingTimeMs: number;
  frameWidth: number;
  frameHeight: number;
}
