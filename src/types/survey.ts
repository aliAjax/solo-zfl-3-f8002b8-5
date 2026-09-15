import type { Bench, BenchExperience, TimePeriodType } from '@/types';

/** 长椅可被批次改动的标量字段 */
export type ScalarField =
  | 'name'
  | 'location'
  | 'lat'
  | 'lng'
  | 'material'
  | 'orientation'
  | 'hasBackrest'
  | 'shadeLevel'
  | 'noiseLevel'
  | 'stayDuration'
  | 'rating'
  | 'review';

export const SCALAR_FIELDS: ScalarField[] = [
  'name',
  'location',
  'lat',
  'lng',
  'material',
  'orientation',
  'hasBackrest',
  'shadeLevel',
  'noiseLevel',
  'stayDuration',
  'rating',
  'review',
];

/** 时段体验可被批次改动的字段 */
export type ExpField = 'timePeriod' | 'notes' | 'rating';

export const EXP_FIELDS: ExpField[] = ['timePeriod', 'notes', 'rating'];

/** 批次条目：新增长椅（整档） */
export interface BatchAddBench {
  id: string;
  bench: Bench;
}

/** 批次条目：字段改动（记录基准值与勘测新值，用于三方对比） */
export interface BatchFieldChange {
  id: string;
  benchId: string;
  field: ScalarField;
  base: unknown;
  incoming: unknown;
}

/** 批次条目：时段体验增改 */
export interface BatchExpChange {
  id: string;
  benchId: string;
  expId: string;
  mode: 'add' | 'update';
  timePeriod: TimePeriodType;
  notes: string;
  rating: number;
  /** update 模式必填：该时段记录在基准版本中的值 */
  base?: { timePeriod: TimePeriodType; notes: string; rating: number } | null;
}

/** 批次条目：移除长椅（携带基准快照，用于冲突比对与说明） */
export interface BatchRemoveBench {
  id: string;
  benchId: string;
  base: Bench | null;
}

export type BatchStatus = 'pending' | 'applied' | 'blocked' | 'revoked';

export interface BlockReason {
  key: string;
  type: 'conflict' | 'target-missing' | 'base-missing';
  message: string;
  /** 导致被拦下的已撤销批次（依赖同一字段） */
  dependsOn?: { batchId: string; seq: number; title: string }[];
}

export interface SurveyBatch {
  id: string;
  seq: number;
  title: string;
  surveyor: string;
  note: string;
  createdAt: string;
  /** 最近一次用户输入（裁决/跳过/编辑）时间，用于跨标签页合并 */
  updatedAt?: string;
  /** 勘测所基于的档案版本 */
  baseVersion: number;
  status: BatchStatus;
  adds: BatchAddBench[];
  fieldChanges: BatchFieldChange[];
  expChanges: BatchExpChange[];
  removals: BatchRemoveBench[];
  /** 人工裁决：变更键 -> 采信哪一侧（已做的裁决持久保留） */
  adjudications: Record<string, 'current' | 'incoming'>;
  /** 无法应用而被人工跳过的变更键 */
  skipped: string[];
  blockReasons: BlockReason[];
  appliedAt?: string;
  appliedVersion?: number;
  revokedAt?: string;
}

/** 直接编辑（非批次）产生的日志操作 */
export type DirectOp =
  | { kind: 'addBench'; bench: Bench }
  | { kind: 'removeBench'; benchId: string }
  | { kind: 'setFields'; benchId: string; fields: Record<string, unknown>; base?: Record<string, unknown> }
  | { kind: 'setExperiences'; benchId: string; experiences: BenchExperience[]; updatedAt?: string };

/** 档案变更日志：追加式；id 全局唯一，版本号 = 合并后的条目序号（从 1 开始） */
export type JournalEntry =
  | { id: string; type: 'direct'; version: number; at: string; ops: DirectOp[] }
  | { id: string; type: 'apply'; version: number; at: string; batchId: string }
  | { id: string; type: 'revoke'; version: number; at: string; batchId: string };

/** 跨标签页同字段编辑冲突（重放日志时检出，不静默覆盖） */
export interface SyncConflict {
  benchId: string;
  field: string;
  /** 后写入一侧看到的基准值 */
  baseValue: unknown;
  /** 被覆盖的值（先写入一侧） */
  droppedValue: unknown;
  /** 保留的值（后写入一侧） */
  keptValue: unknown;
  at: string;
  /** 所在日志条目的版本号 */
  version: number;
}

/** 写入前检出的同字段并发分叉（另一侧已改动该字段，本次写入被拦下） */
export interface FieldDivergence {
  benchId: string;
  field: string;
  /** 当前用户看到的基准值 */
  baseValue: unknown;
  /** 档案当前值（另一侧已写入，保留） */
  currentValue: unknown;
  /** 当前用户提交的值（被拦下，未写入） */
  incomingValue: unknown;
}
