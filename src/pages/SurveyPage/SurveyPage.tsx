import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Undo2,
  Trash2,
  ChevronRight,
  ClipboardList,
  History,
} from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import { useSurveyStore } from '@/store/useSurveyStore';
import type { BatchStatus, SurveyBatch } from '@/types/survey';
import { FIELD_LABELS, benchNameOf, formatFieldValue } from '@/utils/survey';

const STATUS_META: Record<BatchStatus, { label: string; className: string }> = {
  pending: { label: '待应用', className: 'bg-ochre/10 text-ochre' },
  applied: { label: '已应用', className: 'bg-moss-green/10 text-moss-green' },
  blocked: { label: '被拦下', className: 'bg-red-500/10 text-red-500' },
  revoked: { label: '已撤销', className: 'bg-ink-light/10 text-ink-light' },
};

function StatusBadge({ status }: { status: BatchStatus }) {
  const meta = STATUS_META[status];
  const Icon =
    status === 'applied' ? CheckCircle2 : status === 'blocked' ? AlertTriangle : status === 'revoked' ? Undo2 : Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.className}`}>
      <Icon className="w-3.5 h-3.5" />
      {meta.label}
    </span>
  );
}

export default function SurveyPage() {
  const navigate = useNavigate();
  const { benches, initialize: initBench, initialized: benchReady } = useBenchStore();
  const {
    batches,
    journal,
    syncConflicts,
    syncAckedVersion,
    initialized,
    initialize,
    revokeBatch,
    deleteBatch,
    hasApplyEntry,
    orderBlocker,
    ackSyncConflicts,
  } = useSurveyStore();
  const [confirmRevoke, setConfirmRevoke] = useState<SurveyBatch | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SurveyBatch | null>(null);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!benchReady) initBench();
    if (!initialized) initialize();
  }, [benchReady, initialized, initBench, initialize]);

  const sorted = [...batches].sort((a, b) => a.seq - b.seq);
  const version = journal.length;
  const visibleConflicts = syncConflicts.filter((c) => c.version > syncAckedVersion);

  const counts = {
    pending: batches.filter((b) => b.status === 'pending').length,
    applied: batches.filter((b) => b.status === 'applied').length,
    blocked: batches.filter((b) => b.status === 'blocked').length,
    revoked: batches.filter((b) => b.status === 'revoked').length,
  };

  const handleDelete = () => {
    if (!confirmDelete) return;
    const result = deleteBatch(confirmDelete.id);
    if (!result.ok) {
      setDeleteError(result.error ?? '删除失败');
      return;
    }
    setConfirmDelete(null);
    setDeleteError('');
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-deep-brown mb-1">勘测批次对账台</h2>
          <p className="text-ink-light text-sm">每次勘测记一个批次，与当前档案对账后按顺序应用</p>
        </div>
        <button
          onClick={() => navigate('/survey/new')}
          className="flex items-center gap-1.5 px-4 py-2 bg-moss-green text-white rounded-lg font-medium text-sm hover:bg-moss-light transition-colors shadow-md hover:shadow-lg"
        >
          <Plus className="w-4 h-4" />
          新建勘测批次
        </button>
      </div>

      {visibleConflicts.length > 0 && (
        <div className="mb-6 p-4 bg-ochre/10 border border-ochre/30 rounded-xl fade-in">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-ochre">
              <AlertTriangle className="w-4 h-4" />
              检测到 {visibleConflicts.length} 项跨标签页同字段修改（未静默覆盖，已保留后写入的值）
            </div>
            <button
              onClick={ackSyncConflicts}
              className="px-3 py-1 text-xs text-ochre hover:bg-ochre/10 rounded-lg transition-colors flex-shrink-0"
            >
              知道了
            </button>
          </div>
          <div className="space-y-1">
            {visibleConflicts.map((c, i) => (
              <p key={`${c.benchId}-${c.field}-${i}`} className="text-xs text-ink-light pl-5">
                · {benchNameOf(c.benchId, benches)} · {FIELD_LABELS[c.field] ?? c.field}：保留「
                {formatFieldValue(c.field, c.keptValue)}」，覆盖了「{formatFieldValue(c.field, c.droppedValue)}」
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="paper-texture rounded-xl shadow-paper p-3 text-center">
          <div className="flex items-center justify-center gap-1 text-ink-light text-xs mb-1">
            <History className="w-3.5 h-3.5" />
            档案版本
          </div>
          <div className="font-serif text-xl font-semibold text-deep-brown">v{version}</div>
        </div>
        {(
          [
            ['pending', '待应用'],
            ['applied', '已应用'],
            ['blocked', '被拦下'],
            ['revoked', '已撤销'],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="paper-texture rounded-xl shadow-paper p-3 text-center">
            <div className="text-ink-light text-xs mb-1">{label}</div>
            <div className="font-serif text-xl font-semibold text-deep-brown">{counts[key]}</div>
          </div>
        ))}
      </div>

      {sorted.length > 0 ? (
        <div className="space-y-4">
          {sorted.map((batch, index) => {
            const blocker = batch.status === 'pending' || batch.status === 'blocked' ? orderBlocker(batch) : undefined;
            const inChain = hasApplyEntry(batch.id);
            const canRevoke = batch.status === 'applied' || (batch.status === 'blocked' && inChain);
            const canDelete =
              batch.status === 'revoked' || ((batch.status === 'pending' || batch.status === 'blocked') && !inChain);

            return (
              <div
                key={batch.id}
                className={`paper-texture rounded-xl shadow-paper p-5 fade-in opacity-0 stagger-${Math.min(index + 1, 6)}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className="flex-1 min-w-0 cursor-pointer group"
                    onClick={() => navigate(`/survey/${batch.id}`)}
                  >
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs font-mono text-ink-light/70">#{batch.seq}</span>
                      <h3 className="font-serif font-semibold text-deep-brown group-hover:text-moss-green transition-colors">
                        {batch.title}
                      </h3>
                      <StatusBadge status={batch.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-light">
                      <span>勘测人：{batch.surveyor || '未署名'}</span>
                      <span>记录于 {new Date(batch.createdAt).toLocaleString('zh-CN')}</span>
                      <span>基准版本 v{batch.baseVersion}</span>
                      {batch.status === 'applied' && batch.appliedAt && (
                        <span className="text-moss-green">
                          应用于 {new Date(batch.appliedAt).toLocaleString('zh-CN')}（v{batch.appliedVersion}）
                        </span>
                      )}
                      {batch.status === 'revoked' && batch.revokedAt && (
                        <span className="text-ink-light/70">
                          撤销于 {new Date(batch.revokedAt).toLocaleString('zh-CN')}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      <span className="text-xs px-2 py-0.5 bg-moss-green/5 text-deep-brown rounded">
                        新增 {batch.adds.length}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-ochre/5 text-deep-brown rounded">
                        字段改动 {batch.fieldChanges.length}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-moss-green/5 text-deep-brown rounded">
                        时段增改 {batch.expChanges.length}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-red-500/5 text-deep-brown rounded">
                        移除 {batch.removals.length}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canRevoke && (
                      <button
                        onClick={() => setConfirmRevoke(batch)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-ochre hover:bg-ochre/10 rounded-lg transition-colors"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        {batch.status === 'applied' ? '整批撤销' : '撤回'}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => {
                          setDeleteError('');
                          setConfirmDelete(batch);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/survey/${batch.id}`)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs text-moss-green hover:bg-moss-green/10 rounded-lg transition-colors"
                    >
                      {batch.status === 'pending' || batch.status === 'blocked' ? '对账' : '查看'}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {blocker && (
                  <div className="mt-3 text-xs text-ink-light bg-warm-beige/70 rounded-lg px-3 py-2">
                    批次需按顺序应用：请先处理 #{blocker.seq}「{blocker.title}」
                  </div>
                )}

                {batch.status === 'blocked' && batch.blockReasons.length > 0 && (
                  <div className="mt-3 p-3 bg-red-500/5 border border-red-500/15 rounded-lg space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      应用被拦下（{batch.blockReasons.length} 项）
                    </div>
                    {batch.blockReasons.slice(0, 4).map((reason) => (
                      <div key={reason.key} className="text-xs text-ink-light pl-5">
                        · {reason.message}
                        {reason.dependsOn && reason.dependsOn.length > 0 && (
                          <span className="text-ochre">
                            （依赖已撤销批次：{reason.dependsOn.map((d) => `#${d.seq}「${d.title}」`).join('、')}）
                          </span>
                        )}
                      </div>
                    ))}
                    {batch.blockReasons.length > 4 && (
                      <div className="text-xs text-ink-light/60 pl-5">…等 {batch.blockReasons.length} 项</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-moss-green/10 flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="w-8 h-8 text-moss-green/50" />
          </div>
          <h3 className="font-serif text-lg font-medium text-deep-brown mb-2">还没有勘测批次</h3>
          <p className="text-ink-light text-sm mb-4">
            每次实地勘测记为一个批次，写明基准版本与增改内容，与当前档案对账后再应用
          </p>
          <button
            onClick={() => navigate('/survey/new')}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-moss-green text-white rounded-lg text-sm hover:bg-moss-light transition-colors"
          >
            <Plus className="w-4 h-4" />
            记录第一个批次
          </button>
        </div>
      )}

      {confirmRevoke && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="paper-texture rounded-xl shadow-paper-hover p-6 max-w-sm w-full fade-in">
            <h3 className="font-serif text-lg font-semibold text-deep-brown mb-2">
              {confirmRevoke.status === 'applied' ? '整批撤销' : '撤回批次'}
            </h3>
            <p className="text-ink-light text-sm mb-2">
              确定要撤销批次 #{confirmRevoke.seq}「{confirmRevoke.title}」吗？
            </p>
            <p className="text-ink-light/80 text-xs mb-6 leading-relaxed">
              撤销后系统将重放后续批次：不依赖它的批次会自动重放；依赖同一字段的批次会被拦下并指出依赖，已做的裁决会保留。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRevoke(null)}
                className="flex-1 px-4 py-2 text-sm text-deep-brown bg-warm-beige hover:bg-warm-beige/80 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  revokeBatch(confirmRevoke.id);
                  setConfirmRevoke(null);
                }}
                className="flex-1 px-4 py-2 text-sm text-white bg-ochre hover:bg-ochre-light rounded-lg transition-colors"
              >
                确认撤销
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="paper-texture rounded-xl shadow-paper-hover p-6 max-w-sm w-full fade-in">
            <h3 className="font-serif text-lg font-semibold text-deep-brown mb-2">删除批次</h3>
            <p className="text-ink-light text-sm mb-2">
              确定要删除批次 #{confirmDelete.seq}「{confirmDelete.title}」吗？此操作无法恢复。
            </p>
            {deleteError && <p className="text-red-500 text-xs mb-2">{deleteError}</p>}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setConfirmDelete(null);
                  setDeleteError('');
                }}
                className="flex-1 px-4 py-2 text-sm text-deep-brown bg-warm-beige hover:bg-warm-beige/80 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
