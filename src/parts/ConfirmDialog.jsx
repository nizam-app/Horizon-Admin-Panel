import { useEffect } from 'react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === 'danger'
      ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/80'
      : 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500/80';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/55 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sheet-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-base font-semibold text-zinc-950">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{description}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-2xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`inline-flex h-9 items-center justify-center rounded-lg px-4 text-2xs font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}
          >
            {busy ? 'Removing…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
