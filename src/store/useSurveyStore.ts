import { create } from 'zustand';
import type { Bench } from '@/types';
import type { DirectOp, JournalEntry, SurveyBatch } from '@/types/survey';
import {
  loadSurveyBase,
  saveSurveyBase,
  loadJournal,
  saveJournal,
  loadBatches,
  saveBatches,
} from '@/utils/surveyStorage';
import { saveBenches } from '@/utils/storage';
import {
  applyResolved,
  buildBlockReasons,
  cloneBenches,
  foldJournal,
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
}

interface SurveyActions {
  initialize: () => void;
  currentVersion: () => number;
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
  refold: () => void;
}

const initialState: SurveyState = {
  baseArchive: [],
  journal: [],
  batches: [],
  initialized: false,
};

function persistBatches(batches: SurveyBatch[]) {
  saveBatches(batches);
}

export const useSurveyStore = create<SurveyState & SurveyActions>((set, get) => ({
  ...initialState,

  initialize: () => {
    if (get().initialized) return;
    const base = loadSurveyBase();
    if (base) {
      set({ baseArchive: base, journal: loadJournal(), batches: loadBatches(), initialized: true });
    } else {
      // 首次启用：以当前档案为基准版本 v0
      const seeded = cloneBenches(useBenchStore.getState().benches);
      set({ baseArchive: seeded, journal: [], batches: [], initialized: true });
      saveSurveyBase(seeded);
      saveJournal([]);
      saveBatches([]);
    }
  },

  currentVersion: () => get().journal.length,

  recordDirectOps: (ops) => {
    if (!get().initialized || ops.length === 0) return;
    const journal: JournalEntry[] = [
      ...get().journal,
      { type: 'direct', version: get().journal.length + 1, at: new Date().toISOString(), ops },
    ];
    set({ journal });
    saveJournal(journal);
  },

  createBatch: (input) => {
    const seq = Math.max(0, ...get().batches.map((b) => b.seq)) + 1;
    const batch: SurveyBatch = {
      id: generateId(),
      seq,
      title: input.title,
      surveyor: input.surveyor,
      note: input.note,
      createdAt: new Date().toISOString(),
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
    const batches = [...get().batches, batch];
    set({ batches });
    persistBatches(batches);
    return batch;
  },

  deleteBatch: (id) => {
    const batch = get().batches.find((b) => b.id === id);
    if (!batch) return { ok: false, error: '批次不存在' };
    const inChain = get().journal.some((e) => e.type === 'apply' && e.batchId === id);
    if (batch.status === 'applied' || (inChain && batch.status !== 'revoked')) {
      return { ok: false, error: '该批次已进入应用链，请先撤销' };
    }
    const batches = get().batches.filter((b) => b.id !== id);
    set({ batches });
    persistBatches(batches);
    return { ok: true };
  },

  setAdjudication: (batchId, key, side) => {
    const batches = get().batches.map((b) =>
      b.id === batchId ? { ...b, adjudications: { ...b.adjudications, [key]: side } } : b
    );
    set({ batches });
    persistBatches(batches);
  },

  setSkipped: (batchId, key, skip) => {
    const batches = get().batches.map((b) => {
      if (b.id !== batchId) return b;
      const skipped = skip ? [...new Set([...b.skipped, key])] : b.skipped.filter((k) => k !== key);
      return { ...b, skipped };
    });
    set({ batches });
    persistBatches(batches);
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
    const batch = get().batches.find((b) => b.id === id);
    if (!batch) return { ok: false, error: '批次不存在' };
    if (batch.status === 'applied') return { ok: false, error: '批次已应用' };
    if (batch.status === 'revoked') return { ok: false, error: '批次已撤销，不能再次应用' };

    if (get().hasApplyEntry(id)) {
      // 在应用链中被拦下的批次：裁决/跳过已更新，重放日志重新归位
      get().refold();
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
      const batches = get().batches.map((b) =>
        b.id === id
          ? { ...b, status: 'blocked' as const, blockReasons: buildBlockReasons(resolution, get().batches) }
          : b
      );
      set({ batches });
      persistBatches(batches);
      return { ok: false, error: '存在未裁决的冲突或无法应用的条目，已拦下该批次' };
    }

    const newBenches = applyResolved(live, resolution);
    useBenchStore.setState({ benches: newBenches });
    saveBenches(newBenches);

    const now = new Date().toISOString();
    const journal: JournalEntry[] = [
      ...get().journal,
      { type: 'apply', version: get().journal.length + 1, at: now, batchId: id },
    ];
    const batches = get().batches.map((b) =>
      b.id === id
        ? { ...b, status: 'applied' as const, appliedAt: now, appliedVersion: journal.length, blockReasons: [] }
        : b
    );
    set({ journal, batches });
    saveJournal(journal);
    persistBatches(batches);
    return { ok: true };
  },

  revokeBatch: (id) => {
    const batch = get().batches.find((b) => b.id === id);
    if (!batch) return;
    const inChain = get().hasApplyEntry(id);
    if (batch.status !== 'applied' && !(batch.status === 'blocked' && inChain)) return;

    const now = new Date().toISOString();
    const journal: JournalEntry[] = [
      ...get().journal,
      { type: 'revoke', version: get().journal.length + 1, at: now, batchId: id },
    ];
    const batches = get().batches.map((b) =>
      b.id === id ? { ...b, status: 'revoked' as const, revokedAt: now, blockReasons: [] } : b
    );
    set({ journal, batches });
    saveJournal(journal);
    persistBatches(batches);

    // 撤销后重放：不依赖它的批次自动重放，依赖同一字段的批次拦下并指出依赖
    get().refold();
  },

  refold: () => {
    const { baseArchive, journal, batches } = get();
    const { benches, outcomes } = foldJournal(baseArchive, journal, batches);

    const newBatches = batches.map((b) => {
      if (b.status === 'revoked') return b;
      const outcome = outcomes.get(b.id);
      if (!outcome) return b;
      if (outcome.status === 'applied') {
        const applyEntry = journal.find((e) => e.type === 'apply' && e.batchId === b.id);
        return {
          ...b,
          status: 'applied' as const,
          blockReasons: [],
          appliedVersion: applyEntry?.version ?? b.appliedVersion,
        };
      }
      return { ...b, status: 'blocked' as const, blockReasons: outcome.reasons };
    });

    set({ batches: newBatches });
    persistBatches(newBatches);

    useBenchStore.setState({ benches });
    saveBenches(benches);
  },
}));
