import { create } from 'zustand';
import type { Bench, BenchExperience, MaterialType, OrientationType, ShadeLevelType, NoiseLevelType } from '@/types';
import type { DirectOp, FieldDivergence } from '@/types/survey';
import { loadBenches, saveBenches } from '@/utils/storage';
import { generateId } from '@/utils/comfort';
import { mockBenches } from '@/data/mockBenches';
import { useSurveyStore } from '@/store/useSurveyStore';

interface BenchState {
  benches: Bench[];
  searchQuery: string;
  materialFilter: MaterialType | null;
  orientationFilter: OrientationType | null;
  shadeFilter: ShadeLevelType | null;
  noiseFilter: NoiseLevelType | null;
  initialized: boolean;
}

export interface UpdateBenchOptions {
  /** 用户编辑时所见的基准快照：用于写入前检出跨标签页同字段分叉 */
  base?: Partial<Bench> | null;
  /** 人工确认后强制写入（仍会在日志中保留基准，供重放时说明） */
  force?: boolean;
}

export interface UpdateBenchResult {
  ok: boolean;
  conflicts?: FieldDivergence[];
}

interface BenchActions {
  initialize: () => void;
  setSearchQuery: (query: string) => void;
  setMaterialFilter: (material: MaterialType | null) => void;
  setOrientationFilter: (orientation: OrientationType | null) => void;
  setShadeFilter: (shade: ShadeLevelType | null) => void;
  setNoiseFilter: (noise: NoiseLevelType | null) => void;
  clearFilters: () => void;
  addBench: (bench: Omit<Bench, 'id' | 'createdAt' | 'updatedAt' | 'experiences'>) => void;
  updateBench: (id: string, updates: Partial<Bench>, options?: UpdateBenchOptions) => UpdateBenchResult;
  deleteBench: (id: string) => void;
  getBenchById: (id: string) => Bench | undefined;
  addExperience: (benchId: string, experience: Omit<BenchExperience, 'id' | 'benchId'>) => void;
  updateExperience: (benchId: string, expId: string, updates: Partial<BenchExperience>) => void;
  deleteExperience: (benchId: string, expId: string) => void;
  getFilteredBenches: () => Bench[];
}

const initialState: BenchState = {
  benches: [],
  searchQuery: '',
  materialFilter: null,
  orientationFilter: null,
  shadeFilter: null,
  noiseFilter: null,
  initialized: false,
};

const NON_FIELD_KEYS = ['id', 'createdAt', 'updatedAt', 'experiences'];

function syncSurvey() {
  useSurveyStore.getState().syncFromStorage();
}

function recordOps(ops: DirectOp[]) {
  useSurveyStore.getState().recordDirectOps(ops);
}

export const useBenchStore = create<BenchState & BenchActions>((set, get) => ({
  ...initialState,

  initialize: () => {
    const stored = loadBenches();
    if (stored.length > 0) {
      set({ benches: stored, initialized: true });
    } else {
      set({ benches: mockBenches, initialized: true });
      saveBenches(mockBenches);
    }
    // 联动初始化勘测批次对账台（首次以当前档案为基准版本）
    useSurveyStore.getState().initialize();
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setMaterialFilter: (material) => set({ materialFilter: material }),
  setOrientationFilter: (orientation) => set({ orientationFilter: orientation }),
  setShadeFilter: (shade) => set({ shadeFilter: shade }),
  setNoiseFilter: (noise) => set({ noiseFilter: noise }),

  clearFilters: () => set({
    searchQuery: '',
    materialFilter: null,
    orientationFilter: null,
    shadeFilter: null,
    noiseFilter: null,
  }),

  addBench: (benchData) => {
    syncSurvey();
    const now = new Date().toISOString();
    const newBench: Bench = {
      ...benchData,
      id: generateId(),
      experiences: [],
      createdAt: now,
      updatedAt: now,
    };
    const newBenches = [newBench, ...get().benches];
    set({ benches: newBenches });
    saveBenches(newBenches);
    recordOps([{ kind: 'addBench', bench: newBench }]);
  },

  updateBench: (id, updates, options) => {
    // 先与另一侧合并，基于最新档案判定分叉
    syncSurvey();
    const now = new Date().toISOString();
    const { experiences, ...scalarUpdates } = updates;
    const fresh = get().benches.find((b) => b.id === id);

    // 写入前拦下：用户所见的基准与当前档案在同一字段上分叉，且提交值也不是当前值
    if (!options?.force && options?.base && fresh) {
      const conflicts: FieldDivergence[] = [];
      for (const [field, incoming] of Object.entries(scalarUpdates)) {
        if (NON_FIELD_KEYS.includes(field)) continue;
        const baseValue = (options.base as Record<string, unknown>)[field];
        const currentValue = (fresh as unknown as Record<string, unknown>)[field];
        if (currentValue !== baseValue && incoming !== currentValue) {
          conflicts.push({ benchId: id, field, baseValue, currentValue, incomingValue: incoming });
        }
      }
      if (conflicts.length > 0) {
        return { ok: false, conflicts };
      }
    }

    const newBenches = get().benches.map((bench) =>
      bench.id === id
        ? { ...bench, ...updates, updatedAt: now }
        : bench
    );
    set({ benches: newBenches });
    saveBenches(newBenches);

    const ops: DirectOp[] = [];
    if (Object.keys(scalarUpdates).length > 0) {
      // 日志记录写入者所见的基准值，供重放时检出并说明跨标签页分叉
      const base: Record<string, unknown> = {};
      for (const field of Object.keys(scalarUpdates)) {
        if (NON_FIELD_KEYS.includes(field)) continue;
        base[field] =
          options?.base && field in options.base
            ? (options.base as Record<string, unknown>)[field]
            : fresh
              ? (fresh as unknown as Record<string, unknown>)[field]
              : undefined;
      }
      ops.push({ kind: 'setFields', benchId: id, fields: { ...scalarUpdates, updatedAt: now }, base });
    }
    if (experiences) {
      ops.push({ kind: 'setExperiences', benchId: id, experiences, updatedAt: now });
    }
    recordOps(ops);
    return { ok: true };
  },

  deleteBench: (id) => {
    syncSurvey();
    const newBenches = get().benches.filter((bench) => bench.id !== id);
    set({ benches: newBenches });
    saveBenches(newBenches);
    recordOps([{ kind: 'removeBench', benchId: id }]);
  },

  getBenchById: (id) => {
    return get().benches.find((bench) => bench.id === id);
  },

  addExperience: (benchId, experienceData) => {
    syncSurvey();
    const now = new Date().toISOString();
    const newExperience: BenchExperience = {
      ...experienceData,
      id: generateId(),
      benchId,
    };
    let newExperiences: BenchExperience[] = [];
    const newBenches = get().benches.map((bench) => {
      if (bench.id !== benchId) return bench;
      newExperiences = [...bench.experiences, newExperience];
      return { ...bench, experiences: newExperiences, updatedAt: now };
    });
    set({ benches: newBenches });
    saveBenches(newBenches);
    recordOps([{ kind: 'setExperiences', benchId, experiences: newExperiences, updatedAt: now }]);
  },

  updateExperience: (benchId, expId, updates) => {
    syncSurvey();
    const now = new Date().toISOString();
    let newExperiences: BenchExperience[] = [];
    const newBenches = get().benches.map((bench) => {
      if (bench.id !== benchId) return bench;
      newExperiences = bench.experiences.map((exp) =>
        exp.id === expId ? { ...exp, ...updates } : exp
      );
      return { ...bench, experiences: newExperiences, updatedAt: now };
    });
    set({ benches: newBenches });
    saveBenches(newBenches);
    recordOps([{ kind: 'setExperiences', benchId, experiences: newExperiences, updatedAt: now }]);
  },

  deleteExperience: (benchId, expId) => {
    syncSurvey();
    const now = new Date().toISOString();
    let newExperiences: BenchExperience[] = [];
    const newBenches = get().benches.map((bench) => {
      if (bench.id !== benchId) return bench;
      newExperiences = bench.experiences.filter((exp) => exp.id !== expId);
      return { ...bench, experiences: newExperiences, updatedAt: now };
    });
    set({ benches: newBenches });
    saveBenches(newBenches);
    recordOps([{ kind: 'setExperiences', benchId, experiences: newExperiences, updatedAt: now }]);
  },

  getFilteredBenches: () => {
    const { benches, searchQuery, materialFilter, orientationFilter, shadeFilter, noiseFilter } = get();

    return benches.filter((bench) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchName = bench.name.toLowerCase().includes(query);
        const matchLocation = bench.location.toLowerCase().includes(query);
        const matchReview = bench.review.toLowerCase().includes(query);
        if (!matchName && !matchLocation && !matchReview) return false;
      }

      if (materialFilter && bench.material !== materialFilter) return false;
      if (orientationFilter && bench.orientation !== orientationFilter) return false;
      if (shadeFilter && bench.shadeLevel !== shadeFilter) return false;
      if (noiseFilter && bench.noiseLevel !== noiseFilter) return false;

      return true;
    });
  },
}));
