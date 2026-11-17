import { AlertTriangle, X } from 'lucide-react';

export interface WorkspaceConfirmPayload {
  title: string;
  actionLabel: string;
  description: string;
  details: Array<{ label: string; value: string }>;
  onConfirm: () => Promise<void> | void;
}

interface WorkspaceConfirmModalProps {
  payload: WorkspaceConfirmPayload | null;
  busy: boolean;
  onCancel: () => void;
}

export function WorkspaceConfirmModal({
  payload,
  busy,
  onCancel,
}: WorkspaceConfirmModalProps) {
  if (!payload) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-confirm-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-50 text-amber-700 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 id="workspace-confirm-title" className="text-lg font-semibold text-slate-900">
                {payload.title}
              </h3>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                {payload.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close confirmation dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2.5">
          {payload.details.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4 text-sm">
              <span className="text-slate-500 shrink-0">{row.label}</span>
              <span className="text-slate-900 font-medium text-right break-all">
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => payload.onConfirm()}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-800 rounded-lg hover:bg-blue-900 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {busy ? 'Processing...' : payload.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
