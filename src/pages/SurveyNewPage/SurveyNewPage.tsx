import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Save, Trash2, Sunrise, Sun, Sunset, Moon, CloudSun } from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import { useSurveyStore } from '@/store/useSurveyStore';
import {
  MATERIAL_LABELS,
  ORIENTATION_LABELS,
  SHADE_LABELS,
  NOISE_LABELS,
  STAY_DURATION_LABELS,
  TIME_PERIOD_LABELS,
} from '@/types';
import type {
  MaterialType,
  OrientationType,
  ShadeLevelType,
  NoiseLevelType,
  StayDurationType,
  TimePeriodType,
} from '@/types';
import type { ScalarField } from '@/types/survey';
import { FIELD_LABELS, formatFieldValue } from '@/utils/survey';
import { generateId } from '@/utils/comfort';
import Rating from '@/components/Rating/Rating';

const timePeriodIcons: Record<TimePeriodType, typeof Sunrise> = {
  morning: Sunrise,
  noon: Sun,
  afternoon: CloudSun,
  evening: Sunset,
  night: Moon,
};

interface DraftAdd {
  key: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
  material: MaterialType;
  orientation: OrientationType;
  hasBackrest: boolean;
  shadeLevel: ShadeLevelType;
  noiseLevel: NoiseLevelType;
  stayDuration: StayDurationType;
  rating: number;
  review: string;
}

interface DraftField {
  key: string;
  benchId: string;
  field: ScalarField | '';
  incoming: unknown;
}

interface DraftExp {
  key: string;
  benchId: string;
  mode: 'add' | 'update';
  expId: string;
  timePeriod: TimePeriodType;
  notes: string;
  rating: number;
}

interface DraftRemoval {
  key: string;
  benchId: string;
}

const SELECTABLE_FIELDS = Object.keys(FIELD_LABELS) as ScalarField[];

function newDraftAdd(): DraftAdd {
  return {
    key: generateId(),
    name: '',
    location: '',
    lat: 31.23,
    lng: 121.47,
    material: 'wood',
    orientation: 'south',
    hasBackrest: true,
    shadeLevel: 'partial',
    noiseLevel: 'moderate',
    stayDuration: 'medium',
    rating: 3,
    review: '',
  };
}

/** 按字段类型渲染取值输入 */
function FieldValueInput({
  field,
  value,
  onChange,
}: {
  field: ScalarField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const className =
    'w-full px-3 py-2 text-sm bg-white/60 border border-deep-brown/10 rounded-md text-deep-brown focus:bg-white';

  if (field === 'material' || field === 'orientation' || field === 'shadeLevel' || field === 'noiseLevel' || field === 'stayDuration') {
    const labels =
      field === 'material'
        ? MATERIAL_LABELS
        : field === 'orientation'
          ? ORIENTATION_LABELS
          : field === 'shadeLevel'
            ? SHADE_LABELS
            : field === 'noiseLevel'
              ? NOISE_LABELS
              : STAY_DURATION_LABELS;
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)} className={`${className} cursor-pointer`}>
        {Object.entries(labels).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    );
  }
  if (field === 'hasBackrest') {
    return (
      <select
        value={value ? 'yes' : 'no'}
        onChange={(e) => onChange(e.target.value === 'yes')}
        className={`${className} cursor-pointer`}
      >
        <option value="yes">有</option>
        <option value="no">无</option>
      </select>
    );
  }
  if (field === 'rating') {
    return <Rating value={Number(value) || 3} onChange={(v) => onChange(v)} size="sm" />;
  }
  if (field === 'lat' || field === 'lng') {
    return (
      <input
        type="number"
        step="0.0001"
        value={Number(value)}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={className}
      />
    );
  }
  return (
    <input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  );
}

export default function SurveyNewPage() {
  const navigate = useNavigate();
  const { benches, initialize: initBench, initialized: benchReady } = useBenchStore();
  const { initialized, initialize, createBatch, currentVersion } = useSurveyStore();

  const [title, setTitle] = useState('');
  const [surveyor, setSurveyor] = useState('');
  const [note, setNote] = useState('');
  const [adds, setAdds] = useState<DraftAdd[]>([]);
  const [fieldChanges, setFieldChanges] = useState<DraftField[]>([]);
  const [expChanges, setExpChanges] = useState<DraftExp[]>([]);
  const [removals, setRemovals] = useState<DraftRemoval[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!benchReady) initBench();
    if (!initialized) initialize();
  }, [benchReady, initialized, initBench, initialize]);

  const benchOptions = useMemo(() => benches.map((b) => ({ id: b.id, name: b.name })), [benches]);
  const benchById = (id: string) => benches.find((b) => b.id === id);

  const updateDraft = <T extends { key: string }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    key: string,
    patch: Partial<T>
  ) => {
    setter((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };
  const removeDraft = <T extends { key: string }>(
    setter: React.Dispatch<React.SetStateAction<T[]>>,
    key: string
  ) => {
    setter((prev) => prev.filter((d) => d.key !== key));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const problems: string[] = [];

    if (!title.trim()) problems.push('请填写批次标题');
    if (adds.length + fieldChanges.length + expChanges.length + removals.length === 0) {
      problems.push('批次内容为空：请至少添加一条新增、改动、时段增改或移除');
    }

    adds.forEach((d, i) => {
      if (!d.name.trim()) problems.push(`新增 #${i + 1}：请填写长椅名称`);
      if (!d.location.trim()) problems.push(`新增 #${i + 1}：请填写位置描述`);
    });

    const seenField = new Set<string>();
    fieldChanges.forEach((d, i) => {
      if (!d.benchId || !d.field) {
        problems.push(`字段改动 #${i + 1}：请选择长椅和字段`);
        return;
      }
      const dup = `${d.benchId}:${d.field}`;
      if (seenField.has(dup)) problems.push(`字段改动 #${i + 1}：同一字段重复改动`);
      seenField.add(dup);
      if (removals.some((r) => r.benchId === d.benchId)) {
        problems.push(`字段改动 #${i + 1}：该长椅已被列入移除，不能同时改动`);
      }
    });

    const seenExp = new Set<string>();
    expChanges.forEach((d, i) => {
      if (!d.benchId) {
        problems.push(`时段增改 #${i + 1}：请选择长椅`);
        return;
      }
      if (d.mode === 'update' && !d.expId) {
        problems.push(`时段增改 #${i + 1}：请选择要修改的时段记录`);
        return;
      }
      if (d.mode === 'update') {
        if (seenExp.has(d.expId)) problems.push(`时段增改 #${i + 1}：同一时段记录重复修改`);
        seenExp.add(d.expId);
      }
      if (removals.some((r) => r.benchId === d.benchId)) {
        problems.push(`时段增改 #${i + 1}：该长椅已被列入移除，不能同时增改时段`);
      }
    });

    const seenRemoval = new Set<string>();
    removals.forEach((d, i) => {
      if (!d.benchId) {
        problems.push(`移除 #${i + 1}：请选择长椅`);
        return;
      }
      if (seenRemoval.has(d.benchId)) problems.push(`移除 #${i + 1}：该长椅重复移除`);
      seenRemoval.add(d.benchId);
    });

    if (problems.length > 0) {
      setErrors(problems);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const now = new Date().toISOString();
    const batch = createBatch({
      title: title.trim(),
      surveyor: surveyor.trim(),
      note: note.trim(),
      adds: adds.map((d) => ({
        id: generateId(),
        bench: {
          id: generateId(),
          name: d.name.trim(),
          location: d.location.trim(),
          lat: d.lat,
          lng: d.lng,
          material: d.material,
          orientation: d.orientation,
          hasBackrest: d.hasBackrest,
          shadeLevel: d.shadeLevel,
          noiseLevel: d.noiseLevel,
          stayDuration: d.stayDuration,
          rating: d.rating,
          review: d.review.trim(),
          experiences: [],
          createdAt: now,
          updatedAt: now,
        },
      })),
      fieldChanges: fieldChanges.map((d) => {
        const bench = benchById(d.benchId)!;
        return {
          id: generateId(),
          benchId: d.benchId,
          field: d.field as ScalarField,
          base: bench[d.field as ScalarField],
          incoming: d.incoming,
        };
      }),
      expChanges: expChanges.map((d) => {
        if (d.mode === 'add') {
          return {
            id: generateId(),
            benchId: d.benchId,
            expId: generateId(),
            mode: 'add' as const,
            timePeriod: d.timePeriod,
            notes: d.notes.trim(),
            rating: d.rating,
            base: null,
          };
        }
        const bench = benchById(d.benchId)!;
        const exp = bench.experiences.find((x) => x.id === d.expId)!;
        return {
          id: generateId(),
          benchId: d.benchId,
          expId: d.expId,
          mode: 'update' as const,
          timePeriod: d.timePeriod,
          notes: d.notes.trim(),
          rating: d.rating,
          base: { timePeriod: exp.timePeriod, notes: exp.notes, rating: exp.rating },
        };
      }),
      removals: removals.map((d) => ({
        id: generateId(),
        benchId: d.benchId,
        base: JSON.parse(JSON.stringify(benchById(d.benchId)!)),
      })),
    });

    navigate(`/survey/${batch.id}`);
  };

  const inputClass =
    'w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown placeholder:text-ink-light/60 focus:bg-white transition-colors';
  const smallInputClass =
    'w-full px-3 py-2 text-sm bg-white/60 border border-deep-brown/10 rounded-md text-deep-brown focus:bg-white';

  return (
    <div className="container mx-auto px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-ink-light hover:text-deep-brown mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">返回</span>
      </button>

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-serif text-2xl font-bold text-deep-brown">新建勘测批次</h1>
          <span className="text-xs text-ink-light px-3 py-1.5 bg-warm-beige rounded-lg">
            基准版本：当前档案 v{currentVersion()}
          </span>
        </div>

        {errors.length > 0 && (
          <div className="mb-6 p-4 bg-red-500/5 border border-red-500/20 rounded-xl">
            <p className="text-sm font-medium text-red-500 mb-1">请先修正以下问题：</p>
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-red-500/90">
                · {err}
              </p>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="paper-texture rounded-xl shadow-paper p-6">
            <h2 className="font-serif text-lg font-semibold text-deep-brown mb-4">批次信息</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">批次标题 *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：2026 年春季人民公园复测"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-deep-brown mb-1.5">勘测人</label>
                  <input
                    type="text"
                    value={surveyor}
                    onChange={(e) => setSurveyor(e.target.value)}
                    placeholder="署名"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-deep-brown mb-1.5">备注</label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="本次勘测的范围与说明"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 新增长椅 */}
          <div className="paper-texture rounded-xl shadow-paper p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg font-semibold text-deep-brown">新增长椅（{adds.length}）</h2>
              <button
                type="button"
                onClick={() => setAdds([...adds, newDraftAdd()])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-moss-green hover:bg-moss-green/10 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加新档
              </button>
            </div>
            {adds.length === 0 ? (
              <p className="text-sm text-ink-light/70 text-center py-4">本次勘测没有新发现的长椅</p>
            ) : (
              <div className="space-y-4">
                {adds.map((d, i) => (
                  <div key={d.key} className="p-4 bg-warm-cream/50 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-deep-brown">新档 #{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeDraft(setAdds, d.key)}
                        className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={d.name}
                        onChange={(e) => updateDraft(setAdds, d.key, { name: e.target.value })}
                        placeholder="长椅名称 *"
                        className={smallInputClass}
                      />
                      <input
                        type="text"
                        value={d.location}
                        onChange={(e) => updateDraft(setAdds, d.key, { location: e.target.value })}
                        placeholder="位置描述 *"
                        className={smallInputClass}
                      />
                      <select
                        value={d.material}
                        onChange={(e) => updateDraft(setAdds, d.key, { material: e.target.value as MaterialType })}
                        className={`${smallInputClass} cursor-pointer`}
                      >
                        {Object.entries(MATERIAL_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <select
                        value={d.orientation}
                        onChange={(e) => updateDraft(setAdds, d.key, { orientation: e.target.value as OrientationType })}
                        className={`${smallInputClass} cursor-pointer`}
                      >
                        {Object.entries(ORIENTATION_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <select
                        value={d.shadeLevel}
                        onChange={(e) => updateDraft(setAdds, d.key, { shadeLevel: e.target.value as ShadeLevelType })}
                        className={`${smallInputClass} cursor-pointer`}
                      >
                        {Object.entries(SHADE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <select
                        value={d.noiseLevel}
                        onChange={(e) => updateDraft(setAdds, d.key, { noiseLevel: e.target.value as NoiseLevelType })}
                        className={`${smallInputClass} cursor-pointer`}
                      >
                        {Object.entries(NOISE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <select
                        value={d.stayDuration}
                        onChange={(e) => updateDraft(setAdds, d.key, { stayDuration: e.target.value as StayDurationType })}
                        className={`${smallInputClass} cursor-pointer`}
                      >
                        {Object.entries(STAY_DURATION_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <select
                        value={d.hasBackrest ? 'yes' : 'no'}
                        onChange={(e) => updateDraft(setAdds, d.key, { hasBackrest: e.target.value === 'yes' })}
                        className={`${smallInputClass} cursor-pointer`}
                      >
                        <option value="yes">有靠背</option>
                        <option value="no">无靠背</option>
                      </select>
                      <input
                        type="number"
                        step="0.0001"
                        value={d.lat}
                        onChange={(e) => updateDraft(setAdds, d.key, { lat: parseFloat(e.target.value) || 0 })}
                        placeholder="纬度"
                        className={smallInputClass}
                      />
                      <input
                        type="number"
                        step="0.0001"
                        value={d.lng}
                        onChange={(e) => updateDraft(setAdds, d.key, { lng: parseFloat(e.target.value) || 0 })}
                        placeholder="经度"
                        className={smallInputClass}
                      />
                      <div className="col-span-2 flex items-center gap-3">
                        <span className="text-xs text-ink-light">综合评分</span>
                        <Rating value={d.rating} onChange={(v) => updateDraft(setAdds, d.key, { rating: v })} size="sm" />
                      </div>
                      <textarea
                        value={d.review}
                        onChange={(e) => updateDraft(setAdds, d.key, { review: e.target.value })}
                        placeholder="评价文字"
                        rows={2}
                        className={`${smallInputClass} col-span-2 resize-none`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 字段改动 */}
          <div className="paper-texture rounded-xl shadow-paper p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg font-semibold text-deep-brown">字段改动（{fieldChanges.length}）</h2>
              <button
                type="button"
                onClick={() =>
                  setFieldChanges([...fieldChanges, { key: generateId(), benchId: '', field: '', incoming: '' }])
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-moss-green hover:bg-moss-green/10 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加改动
              </button>
            </div>
            {fieldChanges.length === 0 ? (
              <p className="text-sm text-ink-light/70 text-center py-4">没有字段改动</p>
            ) : (
              <div className="space-y-3">
                {fieldChanges.map((d) => {
                  const bench = d.benchId ? benchById(d.benchId) : undefined;
                  const baseValue = bench && d.field ? bench[d.field] : undefined;
                  return (
                    <div key={d.key} className="p-4 bg-warm-cream/50 rounded-lg">
                      <div className="flex items-center gap-3 flex-wrap">
                        <select
                          value={d.benchId}
                          onChange={(e) => {
                            const benchId = e.target.value;
                            const b = benchId ? benchById(benchId) : undefined;
                            updateDraft(setFieldChanges, d.key, {
                              benchId,
                              // 已选字段时同步刷新新值为该长椅的当前值
                              ...(b && d.field ? { incoming: b[d.field] } : {}),
                            });
                          }}
                          className={`${smallInputClass} flex-1 min-w-[160px] cursor-pointer`}
                        >
                          <option value="">选择长椅…</option>
                          {benchOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                        <select
                          value={d.field}
                          onChange={(e) => {
                            const field = e.target.value as ScalarField;
                            const b = d.benchId ? benchById(d.benchId) : undefined;
                            updateDraft(setFieldChanges, d.key, {
                              field,
                              incoming: b && field ? b[field] : '',
                            });
                          }}
                          className={`${smallInputClass} w-36 cursor-pointer`}
                        >
                          <option value="">选择字段…</option>
                          {SELECTABLE_FIELDS.map((f) => (
                            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeDraft(setFieldChanges, d.key)}
                          className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {bench && d.field && (
                        <div className="grid grid-cols-2 gap-3 mt-3">
                          <div>
                            <label className="text-xs text-ink-light mb-1 block">基准值（v{currentVersion()} 时的记录）</label>
                            <div className="px-3 py-2 text-sm bg-warm-beige/60 rounded-md text-ink-light">
                              {formatFieldValue(d.field, baseValue)}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-ink-light mb-1 block">勘测新值</label>
                            <FieldValueInput
                              field={d.field}
                              value={d.incoming}
                              onChange={(v) => updateDraft(setFieldChanges, d.key, { incoming: v })}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 时段体验增改 */}
          <div className="paper-texture rounded-xl shadow-paper p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg font-semibold text-deep-brown">时段体验增改（{expChanges.length}）</h2>
              <button
                type="button"
                onClick={() =>
                  setExpChanges([
                    ...expChanges,
                    { key: generateId(), benchId: '', mode: 'add', expId: '', timePeriod: 'morning', notes: '', rating: 3 },
                  ])
                }
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-moss-green hover:bg-moss-green/10 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加时段
              </button>
            </div>
            {expChanges.length === 0 ? (
              <p className="text-sm text-ink-light/70 text-center py-4">没有时段体验增改</p>
            ) : (
              <div className="space-y-3">
                {expChanges.map((d) => {
                  const bench = d.benchId ? benchById(d.benchId) : undefined;
                  const TimeIcon = timePeriodIcons[d.timePeriod];
                  return (
                    <div key={d.key} className="p-4 bg-warm-cream/50 rounded-lg">
                      <div className="flex items-center gap-3 flex-wrap">
                        <select
                          value={d.benchId}
                          onChange={(e) =>
                            updateDraft(setExpChanges, d.key, { benchId: e.target.value, expId: '' })
                          }
                          className={`${smallInputClass} flex-1 min-w-[140px] cursor-pointer`}
                        >
                          <option value="">选择长椅…</option>
                          {benchOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                        <select
                          value={d.mode}
                          onChange={(e) =>
                            updateDraft(setExpChanges, d.key, {
                              mode: e.target.value as 'add' | 'update',
                              expId: '',
                            })
                          }
                          className={`${smallInputClass} w-40 cursor-pointer`}
                        >
                          <option value="add">新增时段记录</option>
                          <option value="update">修改现有记录</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeDraft(setExpChanges, d.key)}
                          className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {d.mode === 'update' && bench && (
                        <div className="mt-3">
                          <select
                            value={d.expId}
                            onChange={(e) => {
                              const exp = bench.experiences.find((x) => x.id === e.target.value);
                              updateDraft(setExpChanges, d.key, {
                                expId: e.target.value,
                                timePeriod: exp?.timePeriod ?? 'morning',
                                notes: exp?.notes ?? '',
                                rating: exp?.rating ?? 3,
                              });
                            }}
                            className={`${smallInputClass} cursor-pointer`}
                          >
                            <option value="">选择要修改的时段记录…</option>
                            {bench.experiences.map((exp) => (
                              <option key={exp.id} value={exp.id}>
                                {TIME_PERIOD_LABELS[exp.timePeriod]} · {exp.rating} 星
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {(d.mode === 'add' || d.expId) && (
                        <div className="mt-3 space-y-3">
                          <div className="flex items-center gap-3">
                            <TimeIcon className="w-4 h-4 text-ochre" />
                            <select
                              value={d.timePeriod}
                              onChange={(e) =>
                                updateDraft(setExpChanges, d.key, { timePeriod: e.target.value as TimePeriodType })
                              }
                              className={`${smallInputClass} w-36 cursor-pointer`}
                            >
                              {Object.entries(TIME_PERIOD_LABELS).map(([v, l]) => (
                                <option key={v} value={v}>{l}</option>
                              ))}
                            </select>
                            <span className="text-xs text-ink-light">时段评分</span>
                            <Rating
                              value={d.rating}
                              onChange={(v) => updateDraft(setExpChanges, d.key, { rating: v })}
                              size="sm"
                            />
                          </div>
                          <textarea
                            value={d.notes}
                            onChange={(e) => updateDraft(setExpChanges, d.key, { notes: e.target.value })}
                            placeholder="体验备注"
                            rows={2}
                            className={`${smallInputClass} resize-none`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 移除 */}
          <div className="paper-texture rounded-xl shadow-paper p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg font-semibold text-deep-brown">移除长椅（{removals.length}）</h2>
              <button
                type="button"
                onClick={() => setRemovals([...removals, { key: generateId(), benchId: '' }])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加移除
              </button>
            </div>
            {removals.length === 0 ? (
              <p className="text-sm text-ink-light/70 text-center py-4">没有要移除的长椅</p>
            ) : (
              <div className="space-y-3">
                {removals.map((d) => {
                  const bench = d.benchId ? benchById(d.benchId) : undefined;
                  return (
                    <div key={d.key} className="p-4 bg-warm-cream/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <select
                          value={d.benchId}
                          onChange={(e) => updateDraft(setRemovals, d.key, { benchId: e.target.value })}
                          className={`${smallInputClass} flex-1 cursor-pointer`}
                        >
                          <option value="">选择要移除的长椅…</option>
                          {benchOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeDraft(setRemovals, d.key)}
                          className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {bench && (
                        <p className="mt-2 text-xs text-ink-light">
                          将记录基准快照：{MATERIAL_LABELS[bench.material]} · {SHADE_LABELS[bench.shadeLevel]} ·{' '}
                          {bench.rating} 星 · {bench.experiences.length} 条时段记录
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-4 pb-6">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 px-6 py-3 bg-warm-beige text-deep-brown rounded-xl font-medium hover:bg-warm-beige/80 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 bg-moss-green text-white rounded-xl font-medium hover:bg-moss-light transition-colors shadow-md hover:shadow-lg flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              保存批次并对账
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
