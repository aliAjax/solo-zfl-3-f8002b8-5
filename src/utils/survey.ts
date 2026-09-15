import type { Bench, BenchExperience, TimePeriodType } from '@/types';
import {
  MATERIAL_LABELS,
  ORIENTATION_LABELS,
  SHADE_LABELS,
  NOISE_LABELS,
  STAY_DURATION_LABELS,
  TIME_PERIOD_LABELS,
} from '@/types';
import type {
  AtomicChange as AtomicChangeT,
  SurveyBatch,
  BatchResolution as BatchResolutionT,
} from './surveyTypes';

export * from './surveyTypes';

// ---------------------------------------------------------------------------
// 变更键：bench-exist:{id} / bench:{id}:{field} / exp-exist:{bid}:{eid} / exp:{bid}:{eid}:{field}
// ---------------------------------------------------------------------------

export function benchExistKey(benchId: string): string {
  return `bench-exist:${benchId}`;
}
export function benchFieldKey(benchId: string, field: string): string {
  return `bench:${benchId}:${field}`;
}
export function expExistKey(benchId: string, expId: string): string {
  return `exp-exist:${benchId}:${expId}`;
}
export function expFieldKey(benchId: string, expId: string, field: string): string {
  return `exp:${benchId}:${expId}:${field}`;
}

export function parseKeyBenchId(key: string): string | null {
  const parts = key.split(':');
  if (parts[0] === 'bench-exist') return parts[1] ?? null;
  if (parts[0] === 'bench') return parts[1] ?? null;
  if (parts[0] === 'exp-exist') return parts[1] ?? null;
  if (parts[0] === 'exp') return parts[1] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// 批次展开为原子变更
// ---------------------------------------------------------------------------

export function expandBatch(batch: SurveyBatch): AtomicChangeT[] {
  const changes: AtomicChangeT[] = [];

  for (const add of batch.adds) {
    changes.push({
      key: benchExistKey(add.bench.id),
      kind: 'addBench',
      entryId: add.id,
      benchId: add.bench.id,
      bench: add.bench,
    });
  }

  for (const fc of batch.fieldChanges) {
    changes.push({
      key: benchFieldKey(fc.benchId, fc.field),
      kind: 'setField',
      entryId: fc.id,
      benchId: fc.benchId,
      field: fc.field,
      base: fc.base,
      incoming: fc.incoming,
    });
  }

  for (const ec of batch.expChanges) {
    if (ec.mode === 'add') {
      changes.push({
        key: expExistKey(ec.benchId, ec.expId),
        kind: 'addExp',
        entryId: ec.id,
        benchId: ec.benchId,
        expId: ec.expId,
        timePeriod: ec.timePeriod,
        exp: {
          id: ec.expId,
          benchId: ec.benchId,
          timePeriod: ec.timePeriod,
          notes: ec.notes,
          rating: ec.rating,
        },
      });
    } else {
      const base = ec.base ?? undefined;
      const incoming = { timePeriod: ec.timePeriod, notes: ec.notes, rating: ec.rating };
      (['timePeriod', 'notes', 'rating'] as const).forEach((field) => {
        const baseVal = base ? base[field] : undefined;
        // 与基准一致的部分无需进入对账
        if (base !== undefined && baseVal === incoming[field]) return;
        changes.push({
          key: expFieldKey(ec.benchId, ec.expId, field),
          kind: 'setExpField',
          entryId: ec.id,
          benchId: ec.benchId,
          expId: ec.expId,
          field,
          timePeriod: ec.timePeriod,
          base: baseVal,
          incoming: incoming[field],
        });
      });
    }
  }

  for (const rm of batch.removals) {
    changes.push({
      key: benchExistKey(rm.benchId),
      kind: 'removeBench',
      entryId: rm.id,
      benchId: rm.benchId,
      base: rm.base ?? undefined,
    });
  }

  return changes;
}

export function batchTouchedKeys(batch: SurveyBatch): Set<string> {
  return new Set(expandBatch(batch).map((c) => c.key));
}

// ---------------------------------------------------------------------------
// 三方对比：基准值 vs 当前档案值 vs 批次新值
// ---------------------------------------------------------------------------

interface AtomicStatus {
  status: 'clean' | 'noop' | 'conflict' | 'problem';
  problemType?: 'target-missing' | 'base-missing';
  message?: string;
  currentValue?: unknown;
  baseValue?: unknown;
  incomingValue?: unknown;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return a === b;
}

function normalizeExp(exp: BenchExperience) {
  return { id: exp.id, timePeriod: exp.timePeriod, notes: exp.notes, rating: exp.rating };
}

export function experiencesEqual(a: BenchExperience[], b: BenchExperience[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((exp, i) => JSON.stringify(normalizeExp(exp)) === JSON.stringify(normalizeExp(b[i])));
}

/** 比对长椅与基准快照是否一致（忽略 updatedAt） */
export function benchSnapshotEquals(current: Bench, snapshot: Bench): boolean {
  for (const field of ['name', 'location', 'lat', 'lng', 'material', 'orientation', 'hasBackrest', 'shadeLevel', 'noiseLevel', 'stayDuration', 'rating', 'review'] as const) {
    if (current[field] !== snapshot[field]) return false;
  }
  return experiencesEqual(current.experiences ?? [], snapshot.experiences ?? []);
}

function resolveAtomic(change: AtomicChangeT, benches: Bench[]): AtomicStatus {
  switch (change.kind) {
    case 'addBench': {
      const existing = benches.find((b) => b.id === change.bench!.id);
      if (!existing) return { status: 'clean' };
      if (benchSnapshotEquals(existing, change.bench!)) {
        return { status: 'noop', currentValue: existing, incomingValue: change.bench };
      }
      // 同 ID 已存在且内容不同：真冲突，需人工裁决
      return { status: 'conflict', currentValue: existing, incomingValue: change.bench };
    }

    case 'removeBench': {
      const existing = benches.find((b) => b.id === change.benchId);
      if (!existing) {
        return { status: 'problem', problemType: 'target-missing', message: '目标长椅在当前档案中不存在，无法移除' };
      }
      if (!change.base) {
        return { status: 'problem', problemType: 'base-missing', message: '批次缺少该长椅的基准快照，无法比对' };
      }
      const base = change.base as Bench;
      if (benchSnapshotEquals(existing, base)) {
        return { status: 'clean', currentValue: existing, baseValue: base, incomingValue: null };
      }
      // 基准之后档案又被改过：移除将丢失这些改动，需人工裁决
      return { status: 'conflict', currentValue: existing, baseValue: base, incomingValue: null };
    }

    case 'setField': {
      const bench = benches.find((b) => b.id === change.benchId);
      if (!bench) {
        return { status: 'problem', problemType: 'target-missing', message: '目标长椅在当前档案中不存在' };
      }
      if (change.base === undefined) {
        return { status: 'problem', problemType: 'base-missing', message: '批次缺少该字段的基准值，无法比对' };
      }
      const currentValue = (bench as unknown as Record<string, unknown>)[change.field!];
      if (valuesEqual(currentValue, change.incoming)) {
        return { status: 'noop', currentValue, baseValue: change.base, incomingValue: change.incoming };
      }
      if (valuesEqual(currentValue, change.base)) {
        return { status: 'clean', currentValue, baseValue: change.base, incomingValue: change.incoming };
      }
      return { status: 'conflict', currentValue, baseValue: change.base, incomingValue: change.incoming };
    }

    case 'addExp': {
      const bench = benches.find((b) => b.id === change.benchId);
      if (!bench) {
        return { status: 'problem', problemType: 'target-missing', message: '目标长椅在当前档案中不存在' };
      }
      const existingExp = bench.experiences.find((e) => e.id === change.exp!.id);
      if (!existingExp) return { status: 'clean' };
      if (JSON.stringify(normalizeExp(existingExp)) === JSON.stringify(normalizeExp(change.exp!))) {
        return { status: 'noop', currentValue: existingExp, incomingValue: change.exp };
      }
      return { status: 'conflict', currentValue: existingExp, incomingValue: change.exp };
    }

    case 'setExpField': {
      const bench = benches.find((b) => b.id === change.benchId);
      if (!bench) {
        return { status: 'problem', problemType: 'target-missing', message: '目标长椅在当前档案中不存在' };
      }
      const exp = bench.experiences.find((e) => e.id === change.expId);
      if (!exp) {
        return { status: 'problem', problemType: 'target-missing', message: '目标时段记录在当前档案中不存在' };
      }
      if (change.base === undefined) {
        return { status: 'problem', problemType: 'base-missing', message: '批次缺少该时段记录的基准值，无法比对' };
      }
      const currentValue = (exp as unknown as Record<string, unknown>)[change.field!];
      if (valuesEqual(currentValue, change.incoming)) {
        return { status: 'noop', currentValue, baseValue: change.base, incomingValue: change.incoming };
      }
      if (valuesEqual(currentValue, change.base)) {
        return { status: 'clean', currentValue, baseValue: change.base, incomingValue: change.incoming };
      }
      return { status: 'conflict', currentValue, baseValue: change.base, incomingValue: change.incoming };
    }
  }
}

export function resolveBatch(batch: SurveyBatch, benches: Bench[]): BatchResolutionT {
  const changes = expandBatch(batch);
  const entries = changes.map((change) => {
    const r = resolveAtomic(change, benches);
    let effective: 'incoming' | 'current' | 'skip' | 'noop' | null = null;
    if (r.status === 'clean') effective = 'incoming';
    else if (r.status === 'noop') effective = 'noop';
    else if (r.status === 'conflict') {
      effective = batch.adjudications[change.key] ?? null;
    } else {
      effective = batch.skipped.includes(change.key) ? 'skip' : null;
    }
    return { change, ...r, effective };
  });

  const unresolved = entries.filter((e) => e.effective === null);
  return {
    entries,
    canApply: unresolved.length === 0,
    unresolvedCount: unresolved.length,
    conflictCount: entries.filter((e) => e.status === 'conflict').length,
    problemCount: entries.filter((e) => e.status === 'problem').length,
    cleanCount: entries.filter((e) => e.status === 'clean').length,
    noopCount: entries.filter((e) => e.status === 'noop').length,
  };
}

// ---------------------------------------------------------------------------
// 应用变更
// ---------------------------------------------------------------------------

function applyAtomic(benches: Bench[], change: AtomicChangeT): Bench[] {
  switch (change.kind) {
    case 'addBench':
      return [change.bench!, ...benches.filter((b) => b.id !== change.bench!.id)];
    case 'removeBench':
      return benches.filter((b) => b.id !== change.benchId);
    case 'setField':
      return benches.map((b) =>
        b.id === change.benchId
          ? ({ ...b, [change.field!]: change.incoming } as Bench)
          : b
      );
    case 'addExp':
      return benches.map((b) =>
        b.id === change.benchId
          ? { ...b, experiences: [...b.experiences.filter((e) => e.id !== change.exp!.id), change.exp!] }
          : b
      );
    case 'setExpField':
      return benches.map((b) =>
        b.id === change.benchId
          ? {
              ...b,
              experiences: b.experiences.map((e) =>
                e.id === change.expId ? ({ ...e, [change.field!]: change.incoming } as BenchExperience) : e
              ),
            }
          : b
      );
  }
}

export function applyResolved(benches: Bench[], resolution: BatchResolutionT): Bench[] {
  let state = benches;
  for (const entry of resolution.entries) {
    if (entry.effective === 'incoming') {
      state = applyAtomic(state, entry.change);
    }
  }
  return state;
}

export function applyDirectOps(benches: Bench[], ops: import('./surveyTypes').DirectOpLike[]): Bench[] {
  let state = benches;
  for (const op of ops) {
    switch (op.kind) {
      case 'addBench':
        state = [op.bench, ...state.filter((b) => b.id !== op.bench.id)];
        break;
      case 'removeBench':
        state = state.filter((b) => b.id !== op.benchId);
        break;
      case 'setFields':
        state = state.map((b) => (b.id === op.benchId ? ({ ...b, ...op.fields } as Bench) : b));
        break;
      case 'setExperiences':
        state = state.map((b) =>
          b.id === op.benchId
            ? { ...b, experiences: op.experiences, ...(op.updatedAt ? { updatedAt: op.updatedAt } : {}) }
            : b
        );
        break;
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// 日志重放：从基准档案出发折叠整个日志
// ---------------------------------------------------------------------------

export function cloneBenches(benches: Bench[]): Bench[] {
  return JSON.parse(JSON.stringify(benches)) as Bench[];
}

export interface FoldOutcome {
  status: 'applied' | 'blocked';
  reasons: import('@/types/survey').BlockReason[];
}

export interface FoldResult {
  benches: Bench[];
  outcomes: Map<string, FoldOutcome>;
  /** 重放时检出的跨标签页同字段编辑冲突 */
  collisions: import('@/types/survey').SyncConflict[];
}

/** 查找导致某变更键被拦下的已撤销批次（依赖同一字段或同一长椅） */
export function findDependencies(
  key: string,
  batches: SurveyBatch[]
): { batchId: string; seq: number; title: string }[] {
  const deps: { batchId: string; seq: number; title: string }[] = [];
  const benchId = parseKeyBenchId(key);
  for (const b of batches) {
    if (b.status !== 'revoked') continue;
    const keys = batchTouchedKeys(b);
    const related = keys.has(key) || (benchId !== null && keys.has(benchExistKey(benchId)));
    if (related) {
      deps.push({ batchId: b.id, seq: b.seq, title: b.title });
    }
  }
  return deps;
}

export function buildBlockReasons(resolution: BatchResolutionT, batches: SurveyBatch[]): import('@/types/survey').BlockReason[] {
  return resolution.entries
    .filter((e) => e.effective === null)
    .map((e) => {
      const type = e.status === 'conflict' ? 'conflict' : e.problemType ?? 'conflict';
      const message =
        e.status === 'conflict'
          ? '存在未裁决的冲突'
          : e.message ?? '无法应用';
      return {
        key: e.change.key,
        type,
        message,
        dependsOn: findDependencies(e.change.key, batches),
      };
    });
}

/** 重放整个日志，返回最终档案与各批次的应用结果。
 *  被拦下的批次保持拦下状态（不因其变为可解而自动归位），
 *  只有 applyBatchId 指定的批次（用户显式点击应用）才会在本次重放中归位。 */
export function foldJournal(
  base: Bench[],
  journal: import('@/types/survey').JournalEntry[],
  batches: SurveyBatch[],
  applyBatchId?: string
): FoldResult {
  let state = cloneBenches(base);
  // 撤销是对整个历史生效的：先收集所有被撤销的批次，再从头折叠
  const excluded = new Set<string>(
    journal.filter((e) => e.type === 'revoke').map((e) => e.batchId)
  );
  batches.filter((b) => b.status === 'revoked').forEach((b) => excluded.add(b.id));
  const outcomes = new Map<string, FoldOutcome>();
  const collisions: import('@/types/survey').SyncConflict[] = [];

  for (const entry of journal) {
    if (entry.type === 'direct') {
      // 直改冲突检测：操作记录的基准值与重放时的当前值分叉，说明另一侧也改了同一字段
      for (const op of entry.ops) {
        if (op.kind !== 'setFields' || !op.base) continue;
        const bench = state.find((b) => b.id === op.benchId);
        if (!bench) continue;
        for (const [field, incoming] of Object.entries(op.fields)) {
          if (field === 'updatedAt' || field === 'createdAt' || field === 'id' || field === 'experiences') continue;
          const baseValue = op.base[field];
          if (baseValue === undefined) continue;
          const currentValue = (bench as unknown as Record<string, unknown>)[field];
          if (currentValue !== baseValue && currentValue !== incoming) {
            collisions.push({
              benchId: op.benchId,
              field,
              baseValue,
              droppedValue: currentValue,
              keptValue: incoming,
              at: entry.at,
              version: entry.version,
            });
          }
        }
      }
      state = applyDirectOps(state, entry.ops);
    } else if (entry.type === 'revoke') {
      continue;
    } else {
      if (excluded.has(entry.batchId)) continue;
      const batch = batches.find((b) => b.id === entry.batchId);
      if (!batch) continue;
      const resolution = resolveBatch(batch, state);
      const stickyBlocked = batch.status === 'blocked' && batch.id !== applyBatchId;
      if (!stickyBlocked && resolution.canApply) {
        state = applyResolved(state, resolution);
        outcomes.set(batch.id, { status: 'applied', reasons: [] });
      } else {
        outcomes.set(batch.id, { status: 'blocked', reasons: buildBlockReasons(resolution, batches) });
      }
    }
  }

  return { benches: state, outcomes, collisions };
}

/** 计算某批次应用条目之前的档案状态（用于被拦下批次的重新对账） */
export function stateBeforeBatch(
  base: Bench[],
  journal: import('@/types/survey').JournalEntry[],
  batches: SurveyBatch[],
  batchId: string
): Bench[] {
  let state = cloneBenches(base);
  const excluded = new Set<string>(
    journal.filter((e) => e.type === 'revoke').map((e) => e.batchId)
  );
  batches.filter((b) => b.status === 'revoked').forEach((b) => excluded.add(b.id));

  for (const entry of journal) {
    if (entry.type === 'apply' && entry.batchId === batchId) break;
    if (entry.type === 'direct') {
      state = applyDirectOps(state, entry.ops);
    } else if (entry.type === 'revoke') {
      continue;
    } else {
      if (excluded.has(entry.batchId)) continue;
      const batch = batches.find((b) => b.id === entry.batchId);
      if (!batch) continue;
      // 被拦下的批次保持拦下，不参与状态计算
      if (batch.status === 'blocked') continue;
      const resolution = resolveBatch(batch, state);
      if (resolution.canApply) {
        state = applyResolved(state, resolution);
      }
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// 跨标签页合并：日志按 id 求并集后重排版本，批次按 id 合并后重排序号
// ---------------------------------------------------------------------------

/** 合并多个日志：按条目 id 去重，按 (时间, id) 确定性排序，版本号重排为连续序号 */
export function mergeJournals(
  ...journals: import('@/types/survey').JournalEntry[][]
): import('@/types/survey').JournalEntry[] {
  const byId = new Map<string, import('@/types/survey').JournalEntry>();
  for (const journal of journals) {
    journal.forEach((entry, index) => {
      // 兼容旧数据：没有 id 的条目按原顺序补稳定 id
      const id =
        (entry as { id?: string }).id ??
        `mig-${String(index).padStart(6, '0')}-${entry.type}-${entry.at}`;
      if (!byId.has(id)) {
        byId.set(id, { ...entry, id } as import('@/types/survey').JournalEntry);
      }
    });
  }
  const sorted = [...byId.values()].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
  // 版本号重排，保证合并后档案版本连续
  return sorted.map((entry, i) => ({ ...entry, version: i + 1 }));
}

function batchFreshness(batch: SurveyBatch): string {
  return batch.updatedAt ?? batch.createdAt;
}

/** 同 id 批次合并：以较新副本为底，裁决与跳过取两侧并集（状态由日志重放重算） */
function mergeTwoBatches(x: SurveyBatch, y: SurveyBatch): SurveyBatch {
  const fx = batchFreshness(x);
  const fy = batchFreshness(y);
  let winner = x;
  let loser = y;
  if (fy > fx || (fy === fx && JSON.stringify(y) > JSON.stringify(x))) {
    winner = y;
    loser = x;
  }
  return {
    ...winner,
    adjudications: { ...loser.adjudications, ...winner.adjudications },
    skipped: [...new Set([...loser.skipped, ...winner.skipped])],
  };
}

/** 合并批次列表：按 id 求并集（墓碑中的 id 剔除），按 (序号, 创建时间, id) 重排连续序号 */
export function mergeBatches(
  local: SurveyBatch[],
  remote: SurveyBatch[],
  tombstones: string[] = []
): SurveyBatch[] {
  const tomb = new Set(tombstones);
  const byId = new Map<string, SurveyBatch>();
  for (const batch of [...local, ...remote]) {
    if (tomb.has(batch.id)) continue;
    const existing = byId.get(batch.id);
    byId.set(batch.id, existing ? mergeTwoBatches(existing, batch) : batch);
  }
  const sorted = [...byId.values()].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  });
  return sorted.map((batch, i) => ({ ...batch, seq: i + 1 }));
}

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------

export const FIELD_LABELS: Record<string, string> = {
  name: '名称',
  location: '位置',
  lat: '纬度',
  lng: '经度',
  material: '材质',
  orientation: '朝向',
  hasBackrest: '靠背',
  shadeLevel: '遮阴',
  noiseLevel: '噪音',
  stayDuration: '停留时长',
  rating: '综合评分',
  review: '评价',
};

export const EXP_FIELD_LABELS: Record<string, string> = {
  timePeriod: '时段',
  notes: '体验备注',
  rating: '时段评分',
};

export function formatFieldValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  switch (field) {
    case 'material':
      return MATERIAL_LABELS[value as keyof typeof MATERIAL_LABELS] ?? String(value);
    case 'orientation':
      return ORIENTATION_LABELS[value as keyof typeof ORIENTATION_LABELS] ?? String(value);
    case 'shadeLevel':
      return SHADE_LABELS[value as keyof typeof SHADE_LABELS] ?? String(value);
    case 'noiseLevel':
      return NOISE_LABELS[value as keyof typeof NOISE_LABELS] ?? String(value);
    case 'stayDuration':
      return STAY_DURATION_LABELS[value as keyof typeof STAY_DURATION_LABELS] ?? String(value);
    case 'hasBackrest':
      return value ? '有' : '无';
    case 'rating':
      return `${value} 星`;
    case 'lat':
    case 'lng':
      return Number(value).toFixed(4);
    default:
      return String(value);
  }
}

export function formatExpFieldValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field === 'timePeriod') {
    return TIME_PERIOD_LABELS[value as TimePeriodType] ?? String(value);
  }
  if (field === 'rating') return `${value} 星`;
  return String(value);
}

/** 按 当前档案 -> 批次快照 的顺序查找长椅名称 */
export function benchNameOf(benchId: string, benches: Bench[], batch?: SurveyBatch): string {
  const live = benches.find((b) => b.id === benchId);
  if (live) return live.name;
  if (batch) {
    const added = batch.adds.find((a) => a.bench.id === benchId);
    if (added) return added.bench.name;
    const removed = batch.removals.find((r) => r.benchId === benchId);
    if (removed?.base) return removed.base.name;
  }
  return '未知长椅';
}
