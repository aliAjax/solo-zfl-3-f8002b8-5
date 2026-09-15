import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  CloudSun,
  AlertTriangle,
} from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
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
  BenchExperience,
  Bench,
} from '@/types';
import type { FieldDivergence } from '@/types/survey';
import { FIELD_LABELS, formatFieldValue } from '@/utils/survey';
import Rating from '@/components/Rating/Rating';
import { generateId } from '@/utils/comfort';

export default function AddEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const { getBenchById, addBench, updateBench, initialize, initialized, addExperience, updateExperience, deleteExperience } = useBenchStore();
  const existingBench = id ? getBenchById(id) : undefined;

  const [formData, setFormData] = useState({
    name: '',
    location: '',
    lat: 31.23,
    lng: 121.47,
    material: 'wood' as MaterialType,
    orientation: 'south' as OrientationType,
    hasBackrest: true,
    shadeLevel: 'partial' as ShadeLevelType,
    noiseLevel: 'moderate' as NoiseLevelType,
    stayDuration: 'medium' as StayDurationType,
    rating: 3,
    review: '',
  });

  const [experiences, setExperiences] = useState<BenchExperience[]>([]);
  /** 表单加载时用户所见的基准快照，用于提交前检出跨标签页同字段分叉 */
  const [baseSnapshot, setBaseSnapshot] = useState<Bench | null>(null);
  const [divergences, setDivergences] = useState<FieldDivergence[] | null>(null);
  /** 每个档案只加载一次表单，避免后台同步冲刷编辑中的内容 */
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  useEffect(() => {
    if (isEdit && existingBench && initialized && loadedForRef.current !== id) {
      loadedForRef.current = id ?? null;
      setFormData({
        name: existingBench.name,
        location: existingBench.location,
        lat: existingBench.lat,
        lng: existingBench.lng,
        material: existingBench.material,
        orientation: existingBench.orientation,
        hasBackrest: existingBench.hasBackrest,
        shadeLevel: existingBench.shadeLevel,
        noiseLevel: existingBench.noiseLevel,
        stayDuration: existingBench.stayDuration,
        rating: existingBench.rating,
        review: existingBench.review,
      });
      setExperiences(existingBench.experiences || []);
      setBaseSnapshot(existingBench);
    }
  }, [isEdit, existingBench, initialized, id]);

  const handleChange = (field: string, value: string | number | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddExperience = () => {
    const newExp: BenchExperience = {
      id: generateId(),
      benchId: id || 'temp',
      timePeriod: 'morning',
      notes: '',
      rating: 3,
    };
    setExperiences([...experiences, newExp]);
  };

  const handleUpdateExperience = (expId: string, field: string, value: string | number) => {
    setExperiences(
      experiences.map((exp) =>
        exp.id === expId ? { ...exp, [field]: value } : exp
      )
    );
  };

  const handleDeleteExperience = (expId: string) => {
    setExperiences(experiences.filter((exp) => exp.id !== expId));
    if (isEdit && id) {
      deleteExperience(id, expId);
    }
  };

  const writeExperiences = (benchId: string) => {
    experiences.forEach((exp) => {
      const existingExp = getBenchById(benchId)?.experiences.find((e) => e.id === exp.id);
      if (existingExp) {
        updateExperience(benchId, exp.id, exp);
      } else {
        addExperience(benchId, exp);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      alert('请输入长椅名称');
      return;
    }
    if (!formData.location.trim()) {
      alert('请输入位置描述');
      return;
    }

    if (isEdit && id) {
      // 写入前检出跨标签页同字段分叉：被拦下则不写入任何数据
      const result = updateBench(id, formData, { base: baseSnapshot });
      if (!result.ok) {
        setDivergences(result.conflicts ?? []);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      writeExperiences(id);
    } else {
      addBench({
        ...formData,
      });
    }

    navigate(-1);
  };

  /** 人工裁决后强制提交：onlyCleanFields 为 true 时保留他人改动的字段，仅写入未分叉字段 */
  const handleForceSubmit = (onlyCleanFields: boolean) => {
    if (!id) return;
    const data: Record<string, unknown> = { ...formData };
    if (onlyCleanFields && divergences) {
      divergences.forEach((d) => {
        delete data[d.field];
      });
    }
    const result = updateBench(id, data, { base: baseSnapshot, force: true });
    if (result.ok) {
      writeExperiences(id);
      setDivergences(null);
      navigate(-1);
    }
  };

  /** 放弃本次修改：表单重置为档案当前值 */
  const handleDiscard = () => {
    if (id) {
      const fresh = getBenchById(id);
      if (fresh) {
        setFormData({
          name: fresh.name,
          location: fresh.location,
          lat: fresh.lat,
          lng: fresh.lng,
          material: fresh.material,
          orientation: fresh.orientation,
          hasBackrest: fresh.hasBackrest,
          shadeLevel: fresh.shadeLevel,
          noiseLevel: fresh.noiseLevel,
          stayDuration: fresh.stayDuration,
          rating: fresh.rating,
          review: fresh.review,
        });
        setExperiences(fresh.experiences || []);
        setBaseSnapshot(fresh);
      }
    }
    setDivergences(null);
  };

  const timePeriodIcons: Record<TimePeriodType, typeof Sunrise> = {
    morning: Sunrise,
    noon: Sun,
    afternoon: CloudSun,
    evening: Sunset,
    night: Moon,
  };

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
        <h1 className="font-serif text-2xl font-bold text-deep-brown mb-6">
          {isEdit ? '编辑长椅档案' : '添加长椅档案'}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-1">
            <h2 className="font-serif text-lg font-semibold text-deep-brown mb-4">
              基本信息
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  长椅名称 *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="给这张长椅起个名字"
                  className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown placeholder:text-ink-light/60 focus:bg-white transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  位置描述 *
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => handleChange('location', e.target.value)}
                  placeholder="例如：人民公园东门北侧"
                  className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown placeholder:text-ink-light/60 focus:bg-white transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-deep-brown mb-1.5">
                    纬度
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.lat}
                    onChange={(e) => handleChange('lat', parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown focus:bg-white transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-deep-brown mb-1.5">
                    经度
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.lng}
                    onChange={(e) => handleChange('lng', parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown focus:bg-white transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-2">
            <h2 className="font-serif text-lg font-semibold text-deep-brown mb-4">
              特征属性
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  材质
                </label>
                <select
                  value={formData.material}
                  onChange={(e) => handleChange('material', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown focus:bg-white cursor-pointer"
                >
                  {Object.entries(MATERIAL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  朝向
                </label>
                <select
                  value={formData.orientation}
                  onChange={(e) => handleChange('orientation', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown focus:bg-white cursor-pointer"
                >
                  {Object.entries(ORIENTATION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  遮阴情况
                </label>
                <select
                  value={formData.shadeLevel}
                  onChange={(e) => handleChange('shadeLevel', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown focus:bg-white cursor-pointer"
                >
                  {Object.entries(SHADE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  噪音等级
                </label>
                <select
                  value={formData.noiseLevel}
                  onChange={(e) => handleChange('noiseLevel', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown focus:bg-white cursor-pointer"
                >
                  {Object.entries(NOISE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  适合停留时长
                </label>
                <select
                  value={formData.stayDuration}
                  onChange={(e) => handleChange('stayDuration', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown focus:bg-white cursor-pointer"
                >
                  {Object.entries(STAY_DURATION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  是否有靠背
                </label>
                <div className="flex items-center gap-4 h-[42px]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="hasBackrest"
                      checked={formData.hasBackrest}
                      onChange={() => handleChange('hasBackrest', true)}
                      className="text-moss-green focus:ring-moss-green"
                    />
                    <span className="text-sm text-deep-brown">有</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="hasBackrest"
                      checked={!formData.hasBackrest}
                      onChange={() => handleChange('hasBackrest', false)}
                      className="text-moss-green focus:ring-moss-green"
                    />
                    <span className="text-sm text-deep-brown">无</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-3">
            <h2 className="font-serif text-lg font-semibold text-deep-brown mb-4">
              个人评价
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  综合评分
                </label>
                <Rating
                  value={formData.rating}
                  onChange={(value) => handleChange('rating', value)}
                  size="lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">
                  评价文字
                </label>
                <textarea
                  value={formData.review}
                  onChange={(e) => handleChange('review', e.target.value)}
                  placeholder="写下你对这张长椅的感受..."
                  rows={4}
                  className="w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown placeholder:text-ink-light/60 focus:bg-white transition-colors resize-none"
                />
              </div>
            </div>
          </div>

          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg font-semibold text-deep-brown">
                分时段体验
              </h2>
              <button
                type="button"
                onClick={handleAddExperience}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-moss-green hover:bg-moss-green/10 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加时段
              </button>
            </div>

            {experiences.length > 0 ? (
              <div className="space-y-4">
                {experiences.map((exp) => {
                  const TimeIcon = timePeriodIcons[exp.timePeriod];
                  return (
                    <div
                      key={exp.id}
                      className="p-4 bg-warm-cream/50 rounded-lg"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <TimeIcon className="w-5 h-5 text-ochre" />
                          <select
                            value={exp.timePeriod}
                            onChange={(e) =>
                              handleUpdateExperience(exp.id, 'timePeriod', e.target.value)
                            }
                            className="px-2 py-1 text-sm bg-white border border-deep-brown/10 rounded-md text-deep-brown cursor-pointer"
                          >
                            {Object.entries(TIME_PERIOD_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteExperience(exp.id)}
                          className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="mb-3">
                        <label className="text-xs text-ink-light mb-1 block">
                          时段评分
                        </label>
                        <Rating
                          value={exp.rating}
                          onChange={(value) =>
                            handleUpdateExperience(exp.id, 'rating', value)
                          }
                          size="sm"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-ink-light mb-1 block">
                          体验备注
                        </label>
                        <textarea
                          value={exp.notes}
                          onChange={(e) =>
                            handleUpdateExperience(exp.id, 'notes', e.target.value)
                          }
                          placeholder="记录这个时段的体验..."
                          rows={2}
                          className="w-full px-3 py-2 text-sm bg-white/60 border border-deep-brown/10 rounded-md text-deep-brown placeholder:text-ink-light/60 focus:bg-white resize-none"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-ink-light">
                  还没有添加时段体验
                </p>
                <p className="text-xs text-ink-light/60 mt-1">
                  可以记录早晨、中午、下午等不同时段的感受
                </p>
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
              {isEdit ? '保存修改' : '添加档案'}
            </button>
          </div>
        </form>
      </div>

      {divergences && divergences.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="paper-texture rounded-xl shadow-paper-hover p-6 max-w-lg w-full fade-in max-h-[85vh] overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-ochre" />
              <h3 className="font-serif text-lg font-semibold text-deep-brown">
                检测到同字段并发修改，已拦下本次写入
              </h3>
            </div>
            <p className="text-ink-light text-sm mb-4 leading-relaxed">
              另一标签页已修改了「{existingBench?.name ?? '该长椅'}」的同一字段。你的修改尚未写入，未覆盖任何数据。请核对后选择处理方式：
            </p>

            <div className="space-y-3 mb-5">
              {divergences.map((d) => (
                <div key={d.field} className="p-3 bg-ochre/5 border border-ochre/20 rounded-lg">
                  <p className="text-sm font-medium text-deep-brown mb-2">
                    {FIELD_LABELS[d.field] ?? d.field}
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 bg-warm-beige/60 rounded-md">
                      <div className="text-[10px] text-ink-light/70 mb-0.5">你看到的</div>
                      <div className="text-ink-light break-words">{formatFieldValue(d.field, d.baseValue)}</div>
                    </div>
                    <div className="p-2 bg-moss-green/10 rounded-md">
                      <div className="text-[10px] text-ink-light/70 mb-0.5">档案当前（保留）</div>
                      <div className="text-deep-brown break-words">{formatFieldValue(d.field, d.currentValue)}</div>
                    </div>
                    <div className="p-2 bg-red-500/5 rounded-md">
                      <div className="text-[10px] text-ink-light/70 mb-0.5">你提交的（被拦下）</div>
                      <div className="text-deep-brown break-words">{formatFieldValue(d.field, d.incomingValue)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {divergences.length < Object.keys(formData).length && (
                <button
                  onClick={() => handleForceSubmit(true)}
                  className="w-full px-4 py-2.5 text-sm text-white bg-moss-green hover:bg-moss-light rounded-lg transition-colors"
                >
                  保留他人改动，提交其余字段
                </button>
              )}
              <button
                onClick={() => handleForceSubmit(false)}
                className="w-full px-4 py-2.5 text-sm text-white bg-ochre hover:bg-ochre-light rounded-lg transition-colors"
              >
                仍要全部覆盖（以我的提交为准）
              </button>
              <button
                onClick={handleDiscard}
                className="w-full px-4 py-2.5 text-sm text-deep-brown bg-warm-beige hover:bg-warm-beige/80 rounded-lg transition-colors"
              >
                放弃本次修改，载入最新档案
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
