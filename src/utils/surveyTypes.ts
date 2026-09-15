import type { Bench, BenchExperience, TimePeriodType } from '@/types';
import type { DirectOp } from '@/types/survey';

export type { SurveyBatch, BlockReason, DirectOp } from '@/types/survey';

/** 直接编辑日志操作的宽松形态（供折叠函数使用） */
export type DirectOpLike = DirectOp;

/** 批次展开后的最小变更单元 */
export interface AtomicChange {
  key: string;
  kind: 'addBench' | 'removeBench' | 'setField' | 'addExp' | 'setExpField';
  /** 来源条目 id（批次录入项） */
  entryId: string;
  benchId: string;
  field?: string;
  expId?: string;
  /** 时段上下文（展示用） */
  timePeriod?: TimePeriodType;
  base?: unknown;
  incoming?: unknown;
  bench?: Bench;
  exp?: BenchExperience;
}

export interface ResolvedEntry {
  change: AtomicChange;
  status: 'clean' | 'noop' | 'conflict' | 'problem';
  problemType?: 'target-missing' | 'base-missing';
  message?: string;
  currentValue?: unknown;
  baseValue?: unknown;
  incomingValue?: unknown;
  /** 最终生效侧：null 表示尚未解决（未裁决/未跳过） */
  effective: 'incoming' | 'current' | 'skip' | 'noop' | null;
}

export interface BatchResolution {
  entries: ResolvedEntry[];
  canApply: boolean;
  unresolvedCount: number;
  conflictCount: number;
  problemCount: number;
  cleanCount: number;
  noopCount: number;
}
