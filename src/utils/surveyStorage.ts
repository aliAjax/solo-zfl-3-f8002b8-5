import type { Bench } from '@/types';
import type { JournalEntry, SurveyBatch } from '@/types/survey';

const BASE_KEY = 'bench-survey-base';
const JOURNAL_KEY = 'bench-survey-journal';
const BATCHES_KEY = 'bench-survey-batches';

export function loadSurveyBase(): Bench[] | null {
  try {
    const data = localStorage.getItem(BASE_KEY);
    return data ? (JSON.parse(data) as Bench[]) : null;
  } catch (error) {
    console.error('Failed to load survey base from localStorage:', error);
    return null;
  }
}

export function saveSurveyBase(base: Bench[]): void {
  try {
    localStorage.setItem(BASE_KEY, JSON.stringify(base));
  } catch (error) {
    console.error('Failed to save survey base to localStorage:', error);
  }
}

export function loadJournal(): JournalEntry[] {
  try {
    const data = localStorage.getItem(JOURNAL_KEY);
    return data ? (JSON.parse(data) as JournalEntry[]) : [];
  } catch (error) {
    console.error('Failed to load survey journal from localStorage:', error);
    return [];
  }
}

export function saveJournal(journal: JournalEntry[]): void {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
  } catch (error) {
    console.error('Failed to save survey journal to localStorage:', error);
  }
}

export function loadBatches(): SurveyBatch[] {
  try {
    const data = localStorage.getItem(BATCHES_KEY);
    return data ? (JSON.parse(data) as SurveyBatch[]) : [];
  } catch (error) {
    console.error('Failed to load survey batches from localStorage:', error);
    return [];
  }
}

export function saveBatches(batches: SurveyBatch[]): void {
  try {
    localStorage.setItem(BATCHES_KEY, JSON.stringify(batches));
  } catch (error) {
    console.error('Failed to save survey batches to localStorage:', error);
  }
}
