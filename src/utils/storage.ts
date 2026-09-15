import type { Bench } from '@/types';

const STORAGE_KEY = 'bench-archive-data';

export function loadBenches(): Bench[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load benches from localStorage:', error);
  }
  return [];
}

export function saveBenches(benches: Bench[]): void {
  try {
    const value = JSON.stringify(benches);
    // 仅在内容变化时写入，避免多标签页之间互相触发无效同步事件
    if (localStorage.getItem(STORAGE_KEY) !== value) {
      localStorage.setItem(STORAGE_KEY, value);
    }
  } catch (error) {
    console.error('Failed to save benches to localStorage:', error);
  }
}

export function clearBenches(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to clear benches from localStorage:', error);
  }
}
