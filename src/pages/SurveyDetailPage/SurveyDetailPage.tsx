import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Undo2,
  GitCompareArrows,
  CircleCheck,
  SkipForward,
  Scale,
} from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import { useSurveyStore } from '@/store/useSurveyStore';
import type { SurveyBatch } from '@/types/survey';
import type { AtomicChange, ResolvedEntry } from '@/utils/survey';
import {
  FIELD_LABELS,
  EXP_FIELD_LABELS,
  formatFieldValue,
  formatExpFieldValue,
  benchNameOf,
} from '@/utils/survey';
import { TIME_PERIOD_LABELS } from '@/types';

const STATUS_META = {
  pending: { label: '待应用', className: 'bg-ochre/10 text-ochre', icon: Clock },
  applied: { label: '已应用', className: 'bg-moss-green/10 text-moss-green', icon: CheckCircle2 },
  blocked: { label: '被拦下', className: 'bg-red-500/10 text-red-500', icon: AlertTriangle },
  revoked: { label: '已撤销', className: 'bg-ink-light/10 text-ink-light', icon: Undo2 },
} as const;

function entryTitle(entry: ResolvedEntry, batch: SurveyBatch, benches: ReturnType<typeof useBenchStore.getState>['benches']): string {
  const c = entry.change;
  const name = benchNameOf(c.benchId, benches, batch);
  switch (c.kind) {
    case 'addBench':
      return `新增档案「${c.bench?.name ?? ''}」`;
    case 'removeBench':
      return `移除档案「${name}」`;
    case 'setField':
      return `${name} · ${FIELD_LABELS[c.field ?? ''] ?? c.field}`;
    case 'addExp':
      return `${name} · 新增${TIME_PERIOD_LABELS[c.exp!.timePeriod]}时段记录`;
    case 'setExpField':
      return `${name} · ${TIME_PERIOD_LABELS[c.timePeriod!]}时段 · ${EXP_FIELD_LABELS[c.field ?? ''] ?? c.field}`;
  }
}

function formatValueFor(change: AtomicChange, value: unknown): string {
  if (change.kind === 'setField') return formatFieldValue(change.field!, value);
  if (change.kind === 'setExpField') return formatExpFieldValue(change.field!, value);
  if (value === null) return '移除';
  if (typeof value === 'object' && value !== null) {
    if ('name' in value) return `「${(value as { name: string }).name}」`;
    if ('timePeriod' in value) {
      const exp = value as { timePeriod: keyof typeof TIME_PERIOD_LABELS; rating: number };
      return `${TIME_PERIOD_LABELS[exp.timePeriod]} · ${exp.rating} 星`;
    }
  }
  return String(value ?? '—');
}

function sideLabels(change: AtomicChange): { current: string; incoming: string } {
  switch (change.kind) {
    case 'setField':
    case 'setExpField':
      return { current: '采信当前档案', incoming: '采信勘测批次' };
    case 'addBench':
      return { current: '保留当前档案', incoming: '以批次新档覆盖' };
    case 'removeBench':
      return { current: '保留该档案（不移除）', incoming: '移除该档案' };
    case 'addExp':
      return { current: '保留现有时段记录', incoming: '以批次记录覆盖' };
  }
}

export default function SurveyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { benches, initialize: initBench, initialized: benchReady } = useBenchStore();
  const {
    batches,
    initialized,
    initialize,
    getPreflight,
    applyBatch,
    revokeBatch,
    setAdjudication,
    setSkipped,
    orderBlocker,
    hasApplyEntry,
  } = useSurveyStore();

  const [applyError, setApplyError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (!benchReady) initBench();
    if (!initialized) initialize();
  }, [benchReady, initialized, initBench, initialize]);

  const batch = batches.find((b) => b.id === id);

  if (!initialized || !benchReady) {
    return (
      <div className="container mx-auto px-4 py-6">
        <p className="text-center py-12 text-ink-light">加载中...</p>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="container mx-auto px-4 py-6">
        <button
          onClick={() => navigate('/survey')}
          className="flex items-center gap-2 text-ink-light hover:text-deep-brown mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">返回对账台</span>
        </button>
        <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
          <p className="text-ink-light">批次不存在或已被删除</p>
        </div>
      </div>
    );
  }

  const meta = STATUS_META[batch.status];
  const StatusIcon = meta.icon;
  const inChain = hasApplyEntry(batch.id);
  const actionable = batch.status === 'pending' || batch.status === 'blocked';
  const preflight = actionable ? getPreflight(batch.id) : null;
  const blocker = actionable ? orderBlocker(batch) : undefined;
  const canRevoke = batch.status === 'applied' || (batch.status === 'blocked' && inChain);

  const conflicts = preflight?.entries.filter((e) => e.status === 'conflict') ?? [];
  const problems = preflight?.entries.filter((e) => e.status === 'problem') ?? [];
  const autos = preflight?.entries.filter((e) => e.status === 'clean' || e.status === 'noop') ?? [];
  const canAttemptApply = !!preflight?.canApply && !blocker;

  const handleApply = () => {
    const result = applyBatch(batch.id);
    if (!result.ok) {
      setApplyError(result.error ?? '应用失败');
    } else {
      setApplyError('');
    }
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <button
        onClick={() => navigate('/survey')}
        className="flex items-center gap-2 text-ink-light hover:text-deep-brown mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">返回对账台</span>
      </button>

      <div className="max-w-3xl mx-auto space-y-6">
        {/* 批次信息 */}
        <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-mono text-ink-light/70">#{batch.seq}</span>
            <h1 className="font-serif text-xl font-bold text-deep-brown">{batch.title}</h1>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.className}`}
            >
              <StatusIcon className="w-3.5 h-3.5" />
              {meta.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-light">
            <span>勘测人：{batch.surveyor || '未署名'}</span>
            <span>记录于 {new Date(batch.createdAt).toLocaleString('zh-CN')}</span>
            <span>基准版本 v{batch.baseVersion}</span>
            {batch.appliedAt && (
              <span className="text-moss-green">
                应用于 {new Date(batch.appliedAt).toLocaleString('zh-CN')}（v{batch.appliedVersion}）
              </span>
            )}
            {batch.revokedAt && <span>撤销于 {new Date(batch.revokedAt).toLocaleString('zh-CN')}</span>}
          </div>
          {batch.note && <p className="mt-3 text-sm text-ink-light">{batch.note}</p>}
        </div>

        {/* 被拦下原因 */}
        {batch.status === 'blocked' && batch.blockReasons.length > 0 && (
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-xl fade-in opacity-0 stagger-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-red-500 mb-2">
              <AlertTriangle className="w-4 h-4" />
              应用被拦下
            </div>
            <div className="space-y-1.5">
              {batch.blockReasons.map((reason) => (
                <div key={reason.key} className="text-xs text-ink-light pl-5">
                  · {reason.message}
                  {reason.dependsOn && reason.dependsOn.length > 0 && (
                    <span className="text-ochre">
                      （依赖已撤销批次：{reason.dependsOn.map((d) => `#${d.seq}「${d.title}」`).join('、')}）
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 对账预检 + 裁决 */}
        {actionable && preflight && (
          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-2">
            <div className="flex items-center gap-2 mb-1">
              <GitCompareArrows className="w-5 h-5 text-moss-green" />
              <h2 className="font-serif text-lg font-semibold text-deep-brown">对账预检</h2>
            </div>
            <p className="text-xs text-ink-light mb-4">
              将批次、基准版本（v{batch.baseVersion}）与当前档案三方比对：一致的自动合并，只有真冲突才需要人工裁决。
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="text-center p-2.5 bg-moss-green/5 rounded-lg">
                <div className="font-serif text-lg font-semibold text-moss-green">{preflight.cleanCount}</div>
                <div className="text-xs text-ink-light">自动合并</div>
              </div>
              <div className="text-center p-2.5 bg-warm-beige/70 rounded-lg">
                <div className="font-serif text-lg font-semibold text-ink-light">{preflight.noopCount}</div>
                <div className="text-xs text-ink-light">无变化</div>
              </div>
              <div className="text-center p-2.5 bg-ochre/5 rounded-lg">
                <div className="font-serif text-lg font-semibold text-ochre">{preflight.conflictCount}</div>
                <div className="text-xs text-ink-light">待裁决冲突</div>
              </div>
              <div className="text-center p-2.5 bg-red-500/5 rounded-lg">
                <div className="font-serif text-lg font-semibold text-red-500">{preflight.problemCount}</div>
                <div className="text-xs text-ink-light">无法应用</div>
              </div>
            </div>

            {/* 冲突裁决 */}
            {conflicts.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center gap-1.5 text-sm font-medium text-deep-brown mb-3">
                  <Scale className="w-4 h-4 text-ochre" />
                  冲突裁决（{conflicts.filter((c) => batch.adjudications[c.change.key]).length}/{conflicts.length}）
                </div>
                <div className="space-y-3">
                  {conflicts.map((entry) => {
                    const key = entry.change.key;
                    const choice = batch.adjudications[key];
                    const labels = sideLabels(entry.change);
                    return (
                      <div key={key} className="p-4 bg-ochre/5 border border-ochre/20 rounded-lg">
                        <p className="text-sm font-medium text-deep-brown mb-3">{entryTitle(entry, batch, benches)}</p>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="p-2 bg-warm-beige/60 rounded-md">
                            <div className="text-[10px] text-ink-light/70 mb-0.5">基准值</div>
                            <div className="text-xs text-ink-light break-words">
                              {formatValueFor(entry.change, entry.baseValue)}
                            </div>
                          </div>
                          <div
                            className={`p-2 rounded-md cursor-pointer border-2 ${
                              choice === 'current' ? 'border-moss-green bg-moss-green/10' : 'border-transparent bg-warm-beige/60'
                            }`}
                            onClick={() => setAdjudication(batch.id, key, 'current')}
                          >
                            <div className="text-[10px] text-ink-light/70 mb-0.5">当前档案</div>
                            <div className="text-xs text-deep-brown break-words">
                              {formatValueFor(entry.change, entry.currentValue)}
                            </div>
                          </div>
                          <div
                            className={`p-2 rounded-md cursor-pointer border-2 ${
                              choice === 'incoming' ? 'border-moss-green bg-moss-green/10' : 'border-transparent bg-warm-beige/60'
                            }`}
                            onClick={() => setAdjudication(batch.id, key, 'incoming')}
                          >
                            <div className="text-[10px] text-ink-light/70 mb-0.5">勘测批次</div>
                            <div className="text-xs text-deep-brown break-words">
                              {formatValueFor(entry.change, entry.incomingValue)}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          {(['current', 'incoming'] as const).map((side) => (
                            <label key={side} className="flex items-center gap-1.5 cursor-pointer text-xs text-deep-brown">
                              <input
                                type="radio"
                                name={`adj-${key}`}
                                checked={choice === side}
                                onChange={() => setAdjudication(batch.id, key, side)}
                                className="text-moss-green focus:ring-moss-green"
                              />
                              {side === 'current' ? labels.current : labels.incoming}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 无法应用的条目 */}
            {problems.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center gap-1.5 text-sm font-medium text-deep-brown mb-3">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  无法应用的条目（{problems.length}）
                </div>
                <div className="space-y-2">
                  {problems.map((entry) => {
                    const key = entry.change.key;
                    const skipped = batch.skipped.includes(key);
                    return (
                      <div key={key} className="p-3 bg-red-500/5 border border-red-500/15 rounded-lg">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm text-deep-brown">{entryTitle(entry, batch, benches)}</p>
                            <p className="text-xs text-red-500 mt-0.5">
                              {entry.problemType === 'target-missing' ? '目标不存在：' : '基准缺失：'}
                              {entry.message}
                            </p>
                          </div>
                          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-ink-light flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={skipped}
                              onChange={(e) => setSkipped(batch.id, key, e.target.checked)}
                              className="text-moss-green focus:ring-moss-green"
                            />
                            跳过此条
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 自动合并清单 */}
            {autos.length > 0 && (
              <div className="mb-5">
                <div className="flex items-center gap-1.5 text-sm font-medium text-deep-brown mb-2">
                  <CircleCheck className="w-4 h-4 text-moss-green" />
                  自动合并（{autos.length}）
                </div>
                <div className="space-y-1">
                  {autos.map((entry) => (
                    <div
                      key={entry.change.key}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 bg-moss-green/5 rounded-md"
                    >
                      <span className="text-xs text-deep-brown">{entryTitle(entry, batch, benches)}</span>
                      <span className="text-xs text-ink-light">
                        {entry.status === 'noop' ? (
                          '无变化'
                        ) : (
                          <>
                            {formatValueFor(entry.change, entry.currentValue)}
                            <span className="mx-1 text-moss-green">→</span>
                            {formatValueFor(entry.change, entry.incomingValue)}
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {blocker && (
              <div className="mb-4 text-xs text-ink-light bg-warm-beige/70 rounded-lg px-3 py-2">
                批次需按顺序应用：请先处理 #{blocker.seq}「{blocker.title}」
              </div>
            )}

            {applyError && (
              <div className="mb-4 text-xs text-red-500 bg-red-500/5 rounded-lg px-3 py-2">{applyError}</div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleApply}
                disabled={!canAttemptApply}
                className={`flex-1 px-6 py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                  canAttemptApply
                    ? 'bg-moss-green text-white hover:bg-moss-light shadow-md hover:shadow-lg'
                    : 'bg-ink-light/15 text-ink-light/60 cursor-not-allowed'
                }`}
              >
              <CheckCircle2 className="w-4 h-4" />
                {preflight.unresolvedCount > 0
                  ? `还有 ${preflight.unresolvedCount} 项未解决，不能应用`
                  : blocker
                    ? '需按顺序应用'
                    : '确认应用该批次'}
              </button>
              {canRevoke && (
                <button
                  onClick={() => setConfirmRevoke(true)}
                  className="px-4 py-3 text-sm text-ochre hover:bg-ochre/10 rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <Undo2 className="w-4 h-4" />
                  撤回
                </button>
              )}
            </div>
            {preflight.unresolvedCount > 0 && (
              <p className="mt-2 text-xs text-ink-light/70 text-center">
                所有冲突裁决完毕、无法应用的条目处理（或跳过）后才能应用
              </p>
            )}
          </div>
        )}

        {/* 批次内容 */}
        <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-3">
          <h2 className="font-serif text-lg font-semibold text-deep-brown mb-4">批次内容</h2>

          {batch.adds.length + batch.fieldChanges.length + batch.expChanges.length + batch.removals.length === 0 && (
            <p className="text-sm text-ink-light/70">空批次</p>
          )}

          {batch.adds.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-deep-brown mb-2">新增（{batch.adds.length}）</h3>
              <div className="space-y-1.5">
                {batch.adds.map((a) => (
                  <div key={a.id} className="px-3 py-2 bg-moss-green/5 rounded-md text-xs text-deep-brown">
                    「{a.bench.name}」 · {a.bench.location} · {formatFieldValue('material', a.bench.material)} ·{' '}
                    {a.bench.rating} 星
                  </div>
                ))}
              </div>
            </div>
          )}

          {batch.fieldChanges.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-deep-brown mb-2">字段改动（{batch.fieldChanges.length}）</h3>
              <div className="space-y-1.5">
                {batch.fieldChanges.map((fc) => (
                  <div
                    key={fc.id}
                    className="px-3 py-2 bg-warm-cream/60 rounded-md text-xs text-deep-brown flex items-center justify-between gap-3"
                  >
                    <span>
                      {benchNameOf(fc.benchId, benches, batch)} · {FIELD_LABELS[fc.field]}
                    </span>
                    <span className="text-ink-light">
                      {formatFieldValue(fc.field, fc.base)}
                      <span className="mx-1 text-ochre">→</span>
                      {formatFieldValue(fc.field, fc.incoming)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batch.expChanges.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-deep-brown mb-2">时段体验增改（{batch.expChanges.length}）</h3>
              <div className="space-y-1.5">
                {batch.expChanges.map((ec) => (
                  <div key={ec.id} className="px-3 py-2 bg-warm-cream/60 rounded-md text-xs text-deep-brown">
                    <span className="font-medium">{benchNameOf(ec.benchId, benches, batch)}</span>
                    {ec.mode === 'add' ? (
                      <span>
                        {' '}
                        · 新增{TIME_PERIOD_LABELS[ec.timePeriod]}时段记录 · {ec.rating} 星
                        {ec.notes && <span className="text-ink-light">「{ec.notes}」</span>}
                      </span>
                    ) : (
                      <span>
                        {' '}
                        · 修改{TIME_PERIOD_LABELS[ec.timePeriod]}时段记录 · {ec.rating} 星
                        {ec.notes && <span className="text-ink-light">「{ec.notes}」</span>}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {batch.removals.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-deep-brown mb-2">移除（{batch.removals.length}）</h3>
              <div className="space-y-1.5">
                {batch.removals.map((rm) => (
                  <div key={rm.id} className="px-3 py-2 bg-red-500/5 rounded-md text-xs text-deep-brown">
                    移除「{rm.base?.name ?? benchNameOf(rm.benchId, benches, batch)}」
                    {rm.base && (
                      <span className="text-ink-light">
                        {' '}
                        · {rm.base.location} · {rm.base.experiences.length} 条时段记录
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 已应用：整批撤销 */}
        {batch.status === 'applied' && (
          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="font-serif text-lg font-semibold text-deep-brown mb-1">批次已应用</h2>
                <p className="text-xs text-ink-light leading-relaxed">
                  可整批撤销：撤销后系统会自动重放不依赖它的后续批次；依赖同一字段的批次会被拦下并指出依赖，已做的裁决保留。
                </p>
              </div>
              <button
                onClick={() => setConfirmRevoke(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-ochre border border-ochre/30 hover:bg-ochre/10 rounded-lg transition-colors flex-shrink-0"
              >
                <Undo2 className="w-4 h-4" />
                整批撤销
              </button>
            </div>
          </div>
        )}

        {batch.status === 'revoked' && (
          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-4">
            <div className="flex items-center gap-2 text-ink-light">
              <SkipForward className="w-4 h-4" />
              <p className="text-sm">该批次已撤销，不再参与档案合并；其记录与裁决保留用于审计。</p>
            </div>
          </div>
        )}
      </div>

      {confirmRevoke && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="paper-texture rounded-xl shadow-paper-hover p-6 max-w-sm w-full fade-in">
            <h3 className="font-serif text-lg font-semibold text-deep-brown mb-2">
              {batch.status === 'applied' ? '整批撤销' : '撤回批次'}
            </h3>
            <p className="text-ink-light text-sm mb-2">
              确定要撤销批次 #{batch.seq}「{batch.title}」吗？
            </p>
            <p className="text-ink-light/80 text-xs mb-6 leading-relaxed">
              撤销后系统将重放后续批次：不依赖它的批次自动重放；依赖同一字段的批次会被拦下并指出依赖，已做的裁决会保留。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRevoke(false)}
                className="flex-1 px-4 py-2 text-sm text-deep-brown bg-warm-beige hover:bg-warm-beige/80 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  revokeBatch(batch.id);
                  setConfirmRevoke(false);
                }}
                className="flex-1 px-4 py-2 text-sm text-white bg-ochre hover:bg-ochre-light rounded-lg transition-colors"
              >
                确认撤销
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
