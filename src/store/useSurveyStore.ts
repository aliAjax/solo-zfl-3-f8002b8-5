import { create } from 'zustand';
import type { Bench } from '@/types';
import type { DirectOp, JournalEntry, SurveyBatch, SyncConflict } from '@/types/survey';
import {
  loadSurveyBase,
  saveSurveyBase,
  loadJournal,
  saveJournal,
  loadBatches,
  saveBatches,
  loadTombstones,
  saveTombstones,
  loadSyncAck,
  saveSyncAck,
  SURVEY_STORAGE_KEYS,
} from '@/utils/surveyStorage';
import { saveBenches } from '@/utils/storage';
import {
  applyResolved,
  buildBlockReasons,
  cloneBenches,
  foldJournal,
  mergeBatches,
  mergeJournals,
  resolveBatch,
  stateBeforeBatch,
} from '@/utils/survey';
import type { BatchResolution } from '@/utils/survey';
import { generateId } from '@/utils/comfort';
import { useBenchStore } from '@/store/useBenchStore';

export interface CreateBatchInput {
  title: string;
  surveyor: string;
  note: string;
  adds: SurveyBatch['adds'];
  fieldChanges: SurveyBatch['fieldChanges'];
  expChanges: SurveyBatch['expChanges'];
  removals: SurveyBatch['removals'];
}

interface SurveyState {
  /** 基准档案（所有批次与直接编辑的重放起点） */
  baseArchive: Bench[];
  journal: JournalEntry[];
  batches: SurveyBatch[];
  initialized: boolean;
  /** 重放时检出的跨标签页同字段编辑冲突 */
  syncConflicts: SyncConflict[];
  /** 冲突警示已读到的档案版本 */
  syncAckedVersion: number;
  syncListening: boolean;
}

interface SurveyActions {
  initialize: () => void;
  currentVersion: () => number;
  /** 与 localStorage 双向合并：本地未持久化的变更并入存储，存储中另一侧的变更并入本地 */
  syncFromStorage: () => void;
  startSyncListener: () => void;
  recordDirectOps: (ops: DirectOp[]) => void;
  createBatch: (input: CreateBatchInput) => SurveyBatch;
  deleteBatch: (id: string) => { ok: boolean; error?: string };
  setAdjudication: (batchId: string, key: string, side: 'current' | 'incoming') => void;
  setSkipped: (batchId: string, key: string, skip: boolean) => void;
  getBatchById: (id: string) => SurveyBatch | undefined;
  hasApplyEntry: (batchId: string) => boolean;
  /** 顺序检查：返回阻挡本批次应用的更早批次 */
  orderBlocker: (batch: SurveyBatch) => SurveyBatch | undefined;
  getPreflight: (batchId: string) => BatchResolution | null;
  applyBatch: (id: string) => { ok: boolean; error?: string };
  revokeBatch: (id: string) => void;
  refold: (applyBatchId?: string) => void;
  ackSyncConflicts: () => void;
}

const initialState: SurveyState = {
  baseArchive: [],
  journal: [],
  batches: [],
  initialized: false,
  syncConflicts: [],
  syncAckedVersion: 0,
  syncListening: false,
};

/** 单调递增的时间戳：保证同一标签页内日志条目的因果顺序 */
function nextAt(journal: JournalEntry[]): string {
  const now = Date.now();
  const last = journal.length > 0 ? Date.parse(journal[journal.length - 1].at) : 0;
  const base = Number.isNaN(last) ? 0 : last;
  return new Date(Math.max(now, base + 1)).toISOString();
}

/** 批次用户输入时间的单调递增版本：保证合并时较新的状态一定胜出 */
function bumpBatchTime(batch: SurveyBatch): string {
  const prev = Date.parse(batch.updatedAt ?? batch.createdAt);
  const base = Number.isNaN(prev) ? 0 : prev;
  return new Date(Math.max(Date.now(), base + 1)).toISOString();
}

export const useSurveyStore = create<SurveyState & SurveyActions>((set, get) => ({
  ...initialState,

  initialize: () => {
    if (get().initialized) return;
    const base = loadSurveyBase();
    if (base) {
      set({
        baseArchive: base,
        journal: mergeJournals(loadJournal()),
        batches: mergeBatches(loadBatches(), [], loadTombstones()),
        syncAckedVersion: loadSyncAck(),
        initialized: true,
      });
    } else {
      // 首次启用：以当前档案为基准版本 v0
      const seeded = cloneBenches(useBenchStore.getState().benches);
      set({
        baseArchive: seeded,
        journal: [],
        batches: [],
        syncAckedVersion: loadSyncAck(),
        initialized: true,
      });
      saveSurveyBase(seeded);
      saveJournal([]);
      saveBatches([]);
    }
    // 以日志为准重放一次，自愈可能不一致的物化档案
    get().refold();
    get().startSyncListener();
  },

  currentVersion: () => get().journal.length,

  syncFromStorage: () => {
    if (!get().initialized) return;
    const remoteBase = loadSurveyBase();
    const remoteJournal = loadJournal();
    const remoteBatches = loadBatches();
    const tombstones = loadTombstones();
    const local = get();

    const mergedBase = local.baseArchive.length > 0 ? local.baseArchive : (remoteBase ?? []);
    const mergedJournal = mergeJournals(local.journal, remoteJournal);
    const mergedBatches = mergeBatches(local.batches, remoteBatches, tombstones);

    set({ baseArchive: mergedBase, journal: mergedJournal, batches: mergedBatches });
    saveSurveyBase(mergedBase);
    saveJournal(mergedJournal);
    saveBatches(mergedBatches);

    // 合并后重放：档案版本连续，冲突与依赖按顺序和三方比对规则重新判定
    get().refold();
  },

  startSyncListener: () => {
    if (get().syncListening || typeof window === 'undefined') return;
    set({ syncListening: true });
    window.addEventListener('storage', (e) => {
      if (e.key && !SURVEY_STORAGE_KEYS.includes(e.key) && e.key !== 'bench-archive-data') return;
      get().syncFromStorage();
    });
    window.addEventListener('focus', () => get().syncFromStorage());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') get().syncFromStorage();
    });
  },

  recordDirectOps: (ops) => {
    if (!get().initialized || ops.length === 0) return;
    const journal = get().journal;
    const entry: JournalEntry = {
      id: generateId(),
      type: 'direct',
      version: journal.length + 1,
      at: nextAt(journal),
      ops,
    };
    set({ journal: [...journal, entry] });
    get().syncFromStorage();
  },

  createBatch: (input) => {
    get().syncFromStorage();
    const now = new Date().toISOString();
    const seq = Math.max(0, ...get().batches.map((b) => b.seq)) + 1;
    const batch: SurveyBatch = {
      id: generateId(),
      seq,
      title: input.title,
      surveyor: input.surveyor,
      note: input.note,
      createdAt: now,
      updatedAt: now,
      baseVersion: get().journal.length,
      status: 'pending',
      adds: input.adds,
      fieldChanges: input.fieldChanges,
      expChanges: input.expChanges,
      removals: input.removals,
      adjudications: {},
      skipped: [],
      blockReasons: [],
    };
    set({ batches: [...get().batches, batch] });
    get().syncFromStorage();
    return get().batches.find((b) => b.id === batch.id) ?? batch;
  },

  deleteBatch: (id) => {
    get().syncFromStorage();
    const batch = get().batches.find((b) => b.id === id);
    if (!batch) return { ok: false, error: '批次不存在' };
    const inChain = get().journal.some((e) => e.type === 'apply' && e.batchId === id);
    if (batch.status === 'applied' || (inChain && batch.status !== 'revoked')) {
      return { ok: false, error: '该批次已进入应用链，请先撤销' };
    }
    // 墓碑机制：防止合并时该批次从另一侧复活
    const tombstones = [...new Set([...loadTombstones(), id])];
    saveTombstones(tombstones);
    set({ batches: get().batches.filter((b) => b.id !== id) });
    get().syncFromStorage();
    return { ok: true };
  },

  setAdjudication: (batchId, key, side) => {
    get().syncFromStorage();
    set({
      batches: get().batches.map((b) =>
        b.id === batchId
          ? { ...b, updatedAt: bumpBatchTime(b), adjudications: { ...b.adjudications, [key]: side } }
          : b
      ),
    });
    get().syncFromStorage();
  },

  setSkipped: (batchId, key, skip) => {
    get().syncFromStorage();
    set({
      batches: get().batches.map((b) => {
        if (b.id !== batchId) return b;
        const skipped = skip ? [...new Set([...b.skipped, key])] : b.skipped.filter((k) => k !== key);
        return { ...b, updatedAt: bumpBatchTime(b), skipped };
      }),
    });
    get().syncFromStorage();
  },

  getBatchById: (id) => get().batches.find((b) => b.id === id),

  hasApplyEntry: (batchId) => get().journal.some((e) => e.type === 'apply' && e.batchId === batchId),

  orderBlocker: (batch) => {
    return get()
      .batches.filter((b) => b.seq < batch.seq && b.status !== 'applied' && b.status !== 'revoked')
      .sort((a, b) => a.seq - b.seq)[0];
  },

  getPreflight: (batchId) => {
    const batch = get().batches.find((b) => b.id === batchId);
    if (!batch) return null;
    // 已进入应用链的批次，要对它当初在链中的位置重新对账；未进链的与当前档案对账
    const state = get().hasApplyEntry(batchId)
      ? stateBeforeBatch(get().baseArchive, get().journal, get().batches, batchId)
      : useBenchStore.getState().benches;
    return resolveBatch(batch, state);
  },

  applyBatch: (id) => {
    get().syncFromStorage();
    const batch = get().batches.find((b) => b.id === id);
    if (!batch) return { ok: false, error: '批次不存在' };
    if (batch.status === 'applied') return { ok: false, error: '批次已应用' };
    if (batch.status === 'revoked') return { ok: false, error: '批次已撤销，不能再次应用' };

    if (get().hasApplyEntry(id)) {
      // 在应用链中被拦下的批次：裁决/跳过已更新，显式应用后重放日志重新归位
      get().refold(id);
      const after = get().batches.find((b) => b.id === id);
      if (after?.status === 'applied') return { ok: true };
      return { ok: false, error: '仍有未裁决的冲突或无法应用的条目' };
    }

    const blocker = get().orderBlocker(batch);
    if (blocker) {
      return { ok: false, error: `批次需按顺序应用，请先处理 #${blocker.seq}「${blocker.title}」` };
    }

    const live = useBenchStore.getState().benches;
    const resolution = resolveBatch(batch, live);
    if (!resolution.canApply) {
      // 真冲突未裁决或存在无法应用的条目：拦下并说明
      set({
        batches: get().batches.map((b) =>
          b.id === id
            ? {
                ...b,
                updatedAt: bumpBatchTime(b),
                status: 'blocked' as const,
                blockReasons: buildBlockReasons(resolution, get().batches),
              }
            : b
        ),
      });
      get().syncFromStorage();
      return { ok: false, error: '存在未裁决的冲突或无法应用的条目，已拦下该批次' };
    }

    const newBenches = applyResolved(live, resolution);
    useBenchStore.setState({ benches: newBenches });
    saveBenches(newBenches);

    const now = new Date().toISOString();
    const journal = get().journal;
    const entry: JournalEntry = {
      id: generateId(),
      type: 'apply',
      version: journal.length + 1,
      at: nextAt(journal),
      batchId: id,
    };
    set({
      journal: [...journal, entry],
      batches: get().batches.map((b) =>
        b.id === id
          ? {
              ...b,
              updatedAt: bumpBatchTime(b),
              status: 'applied' as const,
              appliedAt: now,
              appliedVersion: journal.length + 1,
              blockReasons: [],
            }
          : b
      ),
    });
    get().syncFromStorage();
    return { ok: true };
  },

  revokeBatch: (id) => {
    get().syncFromStorage();
    const batch = get().batches.find((b) => b.id === id);
    if (!batch) return;
    const inChain = get().journal.some((e) => e.type === 'apply' && e.batchId === id);
    if (batch.status !== 'applied' && !(batch.status === 'blocked' && inChain)) return;

    const now = new Date().toISOString();
    const journal = get().journal;
    const entry: JournalEntry = {
      id: generateId(),
      type: 'revoke',
      version: journal.length + 1,
      at: nextAt(journal),
      batchId: id,
    };
    set({
      journal: [...journal, entry],
      batches: get().batches.map((b) =>
        b.id === id ? { ...b, status: 'revoked' as const, revokedAt: now, blockReasons: [] } : b
      ),
    });
    // 撤销后重放：不依赖它的批次自动重放，依赖同一字段的批次拦下并指出依赖
    get().syncFromStorage();
  },

  refold: (applyBatchId?: string) => {
    const { baseArchive, journal, batches } = get();
    const { benches, outcomes, collisions } = foldJournal(baseArchive, journal, batches, applyBatchId);

    const revokedIds = new Set(
      journal.filter((e) => e.type === 'revoke').map((e) => (e as { batchId: string }).batchId)
    );
    const newBatches = batches.map((b) => {
      if (revokedIds.has(b.id)) {
        const revokeEntry = [...journal].reverse().find((e) => e.type === 'revoke' && e.batchId === b.id);
        return {
          ...b,
          status: 'revoked' as const,
          revokedAt: b.revokedAt ?? revokeEntry?.at,
          blockReasons: [],
        };
      }
      const outcome = outcomes.get(b.id);
      if (!outcome) return b;
      if (outcome.status === 'applied') {
        const applyEntry = journal.find((e) => e.type === 'apply' && e.batchId === b.id);
        return {
          ...b,
          status: 'applied' as const,
          blockReasons: [],
          appliedVersion: applyEntry?.version ?? b.appliedVersion,
          appliedAt: b.appliedAt ?? applyEntry?.at,
        };
      }
      return { ...b, status: 'blocked' as const, blockReasons: outcome.reasons };
    });

    set({ batches: newBatches, syncConflicts: collisions });
    saveBatches(newBatches);

    useBenchStore.setState({ benches });
    saveBenches(benches);
  },

  ackSyncConflicts: () => {
    const version = get().journal.length;
    set({ syncAckedVersion: version });
    saveSyncAck(version);
  },
}));
