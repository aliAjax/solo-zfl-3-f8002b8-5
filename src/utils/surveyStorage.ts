import type { Bench } from '@/types';
import type { JournalEntry, SurveyBatch } from '@/types/survey';

const BASE_KEY = 'bench-survey-base';
const JOURNAL_KEY = 'bench-survey-journal';
const BATCHES_KEY = 'bench-survey-batches';
const TOMBSTONES_KEY = 'bench-survey-tombstones';
const SYNC_ACK_KEY = 'bench-survey-sync-ack';

export const SURVEY_STORAGE_KEYS = [BASE_KEY, JOURNAL_KEY, BATCHES_KEY, TOMBSTONES_KEY];

/** 仅在内容变化时写入，避免多标签页之间互相触发无效同步事件 */
function writeKey(key: string, value: string): void {
  try {
    if (localStorage.getItem(key) !== value) {
      localStorage.setItem(key, value);
    }
  } catch (error) {
    console.error('Failed to save survey data to localStorage:', error);
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? (JSON.parse(data) as T) : fallback;
  } catch (error) {
    console.error('Failed to load survey data from localStorage:', error);
    return fallback;
  }
}

export function loadSurveyBase(): Bench[] | null {
  return readJson<Bench[] | null>(BASE_KEY, null);
}

export function saveSurveyBase(base: Bench[]): void {
  writeKey(BASE_KEY, JSON.stringify(base));
}

export function loadJournal(): JournalEntry[] {
  return readJson<JournalEntry[]>(JOURNAL_KEY, []);
}

export function saveJournal(journal: JournalEntry[]): void {
  writeKey(JOURNAL_KEY, JSON.stringify(journal));
}

export function loadBatches(): SurveyBatch[] {
  return readJson<SurveyBatch[]>(BATCHES_KEY, []);
}

export function saveBatches(batches: SurveyBatch[]): void {
  writeKey(BATCHES_KEY, JSON.stringify(batches));
}

/** 已删除批次的墓碑：防止合并时从另一侧复活 */
export function loadTombstones(): string[] {
  return readJson<string[]>(TOMBSTONES_KEY, []);
}

export function saveTombstones(ids: string[]): void {
  writeKey(TOMBSTONES_KEY, JSON.stringify(ids));
}

/** 跨标签页冲突的已读版本位 */
export function loadSyncAck(): number {
  return readJson<number>(SYNC_ACK_KEY, 0);
}

export function saveSyncAck(version: number): void {
  writeKey(SYNC_ACK_KEY, JSON.stringify(version));
}
