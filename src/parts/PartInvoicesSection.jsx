import { useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { resolveClaimFileHref } from '../api.js';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { purchaseInputClass } from './partUtils.js';

export function PartInvoicesSection({
  part,
  readOnly,
  partNextInvoiceNumber,
  onNextInvoiceNumberChange,
  partInvoiceBusyId,
  onUpload,
  onInvoiceNumberChange,
  onRemoveInvoice,
}) {
  const invoices = part.invoices ?? [];
  const busy = partInvoiceBusyId === part.id;
  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const confirmRemoveInvoice = async () => {
    if (!invoiceToDelete || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await onRemoveInvoice(invoiceToDelete.id);
      setInvoiceToDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (readOnly) {
    if (invoices.length === 0) return <p className="text-sm text-zinc-500">No invoices</p>;
    return (
      <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200/90 bg-white">
        {invoices.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <span className="font-mono font-medium text-zinc-900">{inv.invoiceNumber || '—'}</span>
            {inv.fileUrl ? (
              <a
                href={resolveClaimFileHref(inv.fileUrl)}
                target="_blank"
                rel="noreferrer"
                className="text-2xs font-semibold text-indigo-700 hover:underline"
              >
                {inv.fileName || 'View PDF'}
              </a>
            ) : (
              <span className="text-2xs text-zinc-500">{inv.fileName || '—'}</span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  const deleteLabel = invoiceToDelete?.invoiceNumber?.trim() || invoiceToDelete?.fileName || 'this invoice';

  return (
    <>
      <ConfirmDialog
        open={Boolean(invoiceToDelete)}
        title="Remove invoice?"
        description={
          <>
            This will remove <span className="font-medium text-zinc-900">{deleteLabel}</span> from this part line and
            delete the uploaded PDF from the case.
          </>
        }
        confirmLabel="Remove invoice"
        cancelLabel="Keep invoice"
        variant="danger"
        busy={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) setInvoiceToDelete(null);
        }}
        onConfirm={confirmRemoveInvoice}
      />
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200/90 bg-white">
        <div className="border-b border-zinc-100 bg-zinc-50/90 px-4 py-3">
          <h4 className="text-xs font-semibold text-zinc-900">Invoices</h4>
          <p className="mt-0.5 text-2xs leading-relaxed text-zinc-600">
            Add each invoice number with its PDF. You can attach multiple invoices to this part line.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-[220px]">
              <label htmlFor={`next-inv-num-${part.id}`} className="text-2xs font-medium text-zinc-700">
                Invoice number
              </label>
              <input
                id={`next-inv-num-${part.id}`}
                type="text"
                value={partNextInvoiceNumber ?? ''}
                onChange={(e) => onNextInvoiceNumberChange(e.target.value)}
                placeholder="e.g. INV-1042"
                className={`${purchaseInputClass} mt-1`}
              />
            </div>
            <label
              className={`inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold shadow-sm transition ${
                busy
                  ? 'cursor-wait border border-zinc-200 bg-zinc-100 text-zinc-500'
                  : 'border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              <Upload className="h-4 w-4" strokeWidth={2} />
              {busy ? 'Uploading…' : 'Upload PDF'}
              <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy} onChange={onUpload} />
            </label>
          </div>
          {invoices.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-6 text-center text-xs text-zinc-500">
              No invoices yet — enter a number above and upload a PDF.
            </p>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[480px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-zinc-200 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                    <th className="w-[140px] px-3 py-2">Invoice #</th>
                    <th className="px-3 py-2">Document</th>
                    <th className="w-[120px] px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="bg-white hover:bg-zinc-50/50">
                      <td className="px-3 py-2 align-middle">
                        <input
                          type="text"
                          value={inv.invoiceNumber ?? ''}
                          onChange={(e) => onInvoiceNumberChange(inv.id, e.target.value)}
                          placeholder="Invoice #"
                          className="h-9 w-full max-w-[200px] rounded-lg border border-zinc-200 px-2.5 font-mono text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20"
                        />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-rose-600" strokeWidth={2} />
                          <span className="truncate text-sm text-zinc-700" title={inv.fileName}>
                            {inv.fileName || 'PDF document'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {inv.fileUrl ? (
                            <a
                              href={resolveClaimFileHref(inv.fileUrl)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center rounded-lg border border-zinc-200 bg-white px-2.5 text-2xs font-semibold text-zinc-800 hover:bg-zinc-50"
                            >
                              Open
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setInvoiceToDelete(inv)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200/90 text-rose-700 hover:bg-rose-50"
                            aria-label="Remove invoice"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={2} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
