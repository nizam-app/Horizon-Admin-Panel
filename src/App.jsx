import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck2,
  FileSearch,
  FileText,
  Gavel,
  Inbox,
  Landmark,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Package,
  Plus,
  Search,
  Shield,
  Trash2,
  Upload,
  UserCircle,
  X,
  XCircle,
} from 'lucide-react';

import * as api from './api.js';
import { DamageDiagramViewer } from './DamageDiagramViewer.jsx';
import { MemberSubmissionPanel } from './MemberSubmissionPanel.jsx';
import { buildClaimExportHtml, openClaimExportPrint } from './claimExportHtml.js';
import { resolveDamageDiagramFromDamage } from './memberSubmissionUtils.js';

/** Payment status is only `pending` or `completed`; maps legacy stored values. */
function normalizePaymentStatus(raw) {
  const s = String(raw ?? '').trim();
  if (s === 'completed') return 'completed';
  if (s === 'payment' || s === 'received' || s === 'approved') return 'completed';
  return 'pending';
}

/** Open PDF / file links from `/uploads/...` on the API origin. */
function resolveClaimFileHref(urlOrDataUrl) {
  const u = String(urlOrDataUrl || '');
  if (!u || u.startsWith('data:') || u.startsWith('blob:')) return u || '#';
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  const base = api.apiBase();
  if (!base) return '#';
  return `${base}${u.startsWith('/') ? u : `/${u}`}`;
}

const detailFields = [
  { label: 'Owner', getter: (data) => data.memberVehicle?.ownerName },
  { label: 'Vehicle', getter: (data) => [data.memberVehicle?.make, data.memberVehicle?.model].filter(Boolean).join(' ') },
  { label: 'Suburb', getter: (data) => data.incident?.suburb },
  { label: 'Road Surface', getter: (data) => data.incident?.roadSurface },
  { label: 'Other Parties', getter: (data) => (data.otherParties?.length ?? 0).toString() },
];

const queueHighlights = [
  {
    title: 'Review posture',
    text: 'Prioritize incomplete claims first, then move to liability confirmation and workshop intake.',
  },
  {
    title: 'Operational workflow',
    text: 'Open a claim, validate details, request documents if needed, then approve or reject.',
  },
  {
    title: 'Export handoff',
    text: 'Use the export action when a printable summary is needed for insurers or workshop files.',
  },
];

const CLAIM_STATUSES = ['Pending Review', 'Approved', 'Rejected', 'Litigation', 'Recovery'];
const STATUS_OPTIONS = ['All', ...CLAIM_STATUSES];

function statusFilterLabel(option) {
  if (option === 'All') return 'All';
  if (option === 'Pending Review') return 'Pending';
  return option;
}

const PAYMENT_STATUS_OPTIONS = [
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Completed' },
];

const PART_STATUS_OPTIONS = [
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Completed' },
];

const MODAL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'submission', label: 'Member submission' },
  { id: 'records', label: 'Vehicle & incident' },
  { id: 'parties', label: 'Parties & witnesses' },
  { id: 'quotes', label: 'Insurance quote' },
  { id: 'payments', label: 'Purchase' },
];

function newQuoteLine() {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, supplier: '', amount: 0, reference: '', notes: '' };
}

function parseMoneyInput(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function moneyAmountsEqual(stored, draftRaw) {
  const draft = parseMoneyInput(draftRaw);
  if (stored == null && draft == null) return true;
  if (stored == null || draft == null) return false;
  return Number(stored) === Number(draft);
}

/** Save vs update label for fields already stored on the server. */
function saveUpdateLabel({ hasSaved, busy, entity }) {
  if (busy) return hasSaved ? `Updating ${entity}…` : `Saving ${entity}…`;
  return hasSaved ? `Update ${entity}` : `Save ${entity}`;
}

const AUTH_STORAGE_KEY = 'horizon_admin_session';

const ROLE_OPTIONS = [
  { id: 'admin', label: 'Administrator', icon: Shield },
  { id: 'moderator', label: 'Moderator', icon: UserCircle },
];

function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.email || !data?.token || (data.role !== 'admin' && data.role !== 'moderator')) return null;
    return {
      email: data.email,
      displayName: data.displayName || data.email,
      role: data.role,
      token: data.token,
    };
  } catch {
    return null;
  }
}

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts[0]?.length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return '??';
}

function claimMongoId(item) {
  return api.normalizeClaimId(item?.id) || api.normalizeClaimId(item?._id);
}

function claimRef(item) {
  const intake = typeof item?.intakeReference === 'string' ? item.intakeReference.trim() : '';
  if (intake) return intake;
  const ref = typeof item?.reference === 'string' ? item.reference.trim() : '';
  if (ref) return ref;
  const id = api.normalizeClaimId(item?.id ?? item?._id);
  if (id) return id.length > 12 ? `${id.slice(0, 12)}…` : id;
  return 'Claim';
}

/** Both refs for print / PDF export (member code + internal). */
function claimExportRefSummary(item) {
  const lines = [];
  if (item?.intakeReference) lines.push(`Member reference: ${item.intakeReference}`);
  if (item?.reference) lines.push(`System reference: ${item.reference}`);
  return lines.length ? lines.join(' · ') : claimRef(item);
}

function shareOfTotal(part, total) {
  if (!total) return '0';
  return Math.round((part / total) * 100).toString();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}

async function fileToCaseFile(file) {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const dataUrl = await readFileAsDataUrl(file);
  if (!String(dataUrl).startsWith('data:application/pdf')) {
    throw new Error('Not a PDF');
  }
  return {
    id,
    name: file.name || 'document.pdf',
    size: file.size,
    uploadedAt: new Date().toISOString().slice(0, 10),
    dataUrl,
    url: dataUrl,
  };
}

function formatAud(amount) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(
    amount ?? 0,
  );
}

function newPartLine() {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `part-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    company: '',
    partName: '',
    amount: '',
    quotePrice: '',
    orderDate: '',
    tentativeReceivedDate: '',
    receivedBy: '',
    invoices: [],
    status: 'pending',
    notes: '',
  };
}

function newPartInvoiceId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePartInvoicesFromRow(p) {
  if (Array.isArray(p?.invoices) && p.invoices.length > 0) {
    return p.invoices.map((inv) => ({
      id: String(inv.id || newPartInvoiceId()),
      invoiceNumber: String(inv.invoiceNumber ?? ''),
      fileId: inv.fileId ?? null,
      fileName: String(inv.fileName ?? ''),
      fileUrl: String(inv.fileUrl ?? ''),
    }));
  }
  if (p?.invoiceFileId || p?.invoiceNumber || p?.invoiceFileName) {
    return [
      {
        id: newPartInvoiceId(),
        invoiceNumber: String(p.invoiceNumber ?? ''),
        fileId: p.invoiceFileId ?? null,
        fileName: String(p.invoiceFileName ?? ''),
        fileUrl: String(p.invoiceFileUrl ?? ''),
      },
    ];
  }
  return [];
}

function normalizePartRow(p) {
  return {
    ...p,
    quotePrice: p?.quotePrice ?? '',
    invoices: normalizePartInvoicesFromRow(p),
  };
}

function cloneParts(parts) {
  return (parts ?? []).map((p) => normalizePartRow(p));
}

function cloneQuoteOptions(options) {
  return (options ?? []).map((q) => ({ ...q }));
}

function partAmountInputValue(amount) {
  if (amount === '' || amount == null) return '';
  return String(amount);
}

function partAmountNumber(amount) {
  return parseMoneyInput(amount === '' || amount == null ? '' : String(amount)) ?? 0;
}

function partOptionalMoneyNumber(amount) {
  return parseMoneyInput(amount === '' || amount == null ? '' : String(amount));
}

function partsSnapshot(parts) {
  return cloneParts(parts)
    .map((p) => ({
      id: String(p.id || ''),
      company: String(p.company ?? ''),
      partName: String(p.partName ?? ''),
      amount: partAmountNumber(p.amount),
      quotePrice: partOptionalMoneyNumber(p.quotePrice),
      orderDate: String(p.orderDate ?? ''),
      tentativeReceivedDate: String(p.tentativeReceivedDate ?? ''),
      receivedBy: String(p.receivedBy ?? ''),
      invoices: normalizePartInvoicesFromRow(p).map((inv) => ({
        id: String(inv.id),
        invoiceNumber: String(inv.invoiceNumber ?? ''),
        fileId: inv.fileId == null ? null : String(inv.fileId),
        fileName: String(inv.fileName ?? ''),
        fileUrl: String(inv.fileUrl ?? ''),
      })),
      status: String(p.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending',
      notes: String(p.notes ?? ''),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function PurchaseField({ label, children, className = '' }) {
  return (
    <div className={className}>
      <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const purchaseInputClass =
  'h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20';

function ConfirmDialog({
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
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className="w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sheet-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title" className="font-display text-base font-semibold text-zinc-950">
          {title}
        </h3>
        <p id="confirm-dialog-desc" className="mt-2 text-sm leading-relaxed text-zinc-600">
          {description}
        </p>
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

const DELETE_CONFIRM_WORD = 'delete';

function ClaimDeleteConfirmDialog({
  open,
  claimItem,
  busy = false,
  errorMessage = '',
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef(null);
  const canConfirm = typed.trim().toLowerCase() === DELETE_CONFIRM_WORD;

  useEffect(() => {
    if (!open) {
      setTyped('');
      return undefined;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, busy, onCancel]);

  if (!open || !claimItem) return null;

  const refLabel = claimItem.intakeReference || claimItem.reference || claimItem.plateNumber || 'this claim';
  const driverLine = claimItem.driverName ? ` · ${claimItem.driverName}` : '';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="claim-delete-title"
        aria-describedby="claim-delete-desc"
        className="w-full max-w-lg rounded-2xl border border-rose-200/90 bg-white p-5 shadow-sheet-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
            <Trash2 className="h-5 w-5" strokeWidth={2} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="claim-delete-title" className="font-display text-base font-semibold text-zinc-950">
              Delete claim permanently?
            </h3>
            <p id="claim-delete-desc" className="mt-2 text-sm leading-relaxed text-zinc-600">
              You are about to delete{' '}
              <span className="font-mono font-semibold text-zinc-900">{refLabel}</span>
              {driverLine}. This removes the full member submission, admin workspace (quotes, parts, notes),
              uploaded PDFs, and cannot be undone.
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-1.5 rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-3 text-2xs leading-relaxed text-rose-950">
          <li>Member reference: {claimItem.intakeReference || '—'}</li>
          <li>System reference: {claimItem.reference || '—'}</li>
          <li>Plate: {claimItem.plateNumber || '—'}</li>
          <li>Status: {claimItem.status || '—'}</li>
        </ul>

        <label className="mt-4 block">
          <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
            Type <span className="font-mono normal-case text-zinc-800">{DELETE_CONFIRM_WORD}</span> to confirm
          </span>
          <input
            ref={inputRef}
            type="text"
            value={typed}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder={DELETE_CONFIRM_WORD}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 font-mono text-sm text-zinc-900 shadow-inner outline-none placeholder:text-zinc-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/15 disabled:opacity-60"
          />
        </label>

        {errorMessage ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-2xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !canConfirm}
            onClick={onConfirm}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-rose-600 px-4 text-2xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete claim permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PurchaseInvoicesSection({
  part,
  isModerator,
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

  const requestRemoveInvoice = (inv) => setInvoiceToDelete(inv);

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

  if (isModerator) {
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
          This will remove <span className="font-medium text-zinc-900">{deleteLabel}</span> from this purchase
          line and delete the uploaded PDF from the case. This cannot be undone until you upload it again.
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
          Add each invoice number with its PDF. You can attach multiple invoices to this purchase line.
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
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={busy}
              onChange={onUpload}
            />
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
                        aria-label={`Invoice number for ${inv.fileName || 'document'}`}
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
                          onClick={() => requestRemoveInvoice(inv)}
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

function partsEqual(a, b) {
  return JSON.stringify(partsSnapshot(a)) === JSON.stringify(partsSnapshot(b));
}

function quoteOptionsSnapshot(options) {
  return cloneQuoteOptions(options)
    .map((q) => ({
      id: String(q.id || ''),
      supplier: String(q.supplier ?? ''),
      amount: Number(q.amount) || 0,
      reference: String(q.reference ?? ''),
      notes: String(q.notes ?? ''),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function quoteOptionsEqual(a, b) {
  return JSON.stringify(quoteOptionsSnapshot(a)) === JSON.stringify(quoteOptionsSnapshot(b));
}

function paymentStatusLabel(raw) {
  const id = normalizePaymentStatus(raw);
  return PAYMENT_STATUS_OPTIONS.find((o) => o.id === id)?.label ?? 'Pending';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password) {
      setError('Enter email and password.');
      return;
    }
    if (!api.apiBase()) {
      setError(
        'API URL is not configured for this build. In Netlify: Site configuration → Environment variables → add VITE_API_BASE_URL (your public HTTPS API, no trailing slash), then redeploy.',
      );
      return;
    }
    setBusy(true);
    try {
      const out = await api.loginAdmin(normalized, password);
      const session = {
        email: out.user.email,
        displayName: out.user.displayName,
        role: out.user.role,
        token: out.token,
      };
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      onLoggedIn(session);
    } catch (err) {
      setError(err.message || 'Email or password is not valid for this workspace.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-mesh-dark px-4 py-12 text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2240%22%20height=%2240%22%3E%3Cpath%20d=%22M0%2040h40M40%200v40%22%20fill=%22none%22%20stroke=%22%23fff%22%20stroke-opacity=%22.03%22%20stroke-width=%221%22/%3E%3C/svg%3E')]" aria-hidden />
      <div className="relative w-full max-w-[440px]">
        <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-white/15 to-white/5 opacity-60 blur-sm" aria-hidden />
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/40 p-8 shadow-sheet-lg backdrop-blur-2xl sm:p-10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-lg font-bold tracking-tight text-white shadow-glow">
                H
              </div>
              <div>
                <p className="font-display text-xl font-semibold tracking-tight text-white">Horizon Smash</p>
                <p className="mt-0.5 text-2xs font-medium uppercase tracking-[0.2em] text-zinc-500">Repairs · Console</p>
              </div>
            </div>
          </div>
          <p className="mt-8 text-sm leading-relaxed text-zinc-400">
            Sign in to the operations console. Your account role determines whether you can change claim disposition or
            review records read-only.
          </p>
          <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
            <div>
              <label htmlFor="horizon-email" className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                Work email
              </label>
              <input
                id="horizon-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 text-sm text-zinc-100 shadow-inner outline-none ring-indigo-500/0 transition placeholder:text-zinc-600 focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/25"
                placeholder="name@company.com"
                required
              />
            </div>
            <div>
              <label htmlFor="horizon-password" className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                Password
              </label>
              <input
                id="horizon-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 text-sm text-zinc-100 shadow-inner outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/25"
                placeholder="••••••••"
                required
              />
            </div>
            {error && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="group relative h-11 w-full overflow-hidden rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:from-indigo-400 hover:to-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="relative z-10">{busy ? 'Signing in…' : 'Continue to workspace'}</span>
              <span className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 transition group-hover:opacity-100" aria-hidden />
            </button>
          </form>
          {/* <div className="mt-8 rounded-xl border border-white/5 bg-zinc-950/50 px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Demo access</p>
            {api.apiBase() ? (
              <p className="mt-2 font-mono text-2xs leading-relaxed text-zinc-500">
                Backend auth on <span className="text-zinc-400">{api.apiBase()}</span>. Run{' '}
                <span className="text-zinc-400">npm run seed:staff</span> once, then{' '}
                <span className="text-zinc-400">admin@horizon.smash</span> · <span className="text-zinc-400">admin123</span>
                <br />
                Moderator: <span className="text-zinc-400">moderator@horizon.smash</span> ·{' '}
                <span className="text-zinc-400">mod123</span>
              </p>
            ) : (
              <p className="mt-2 text-2xs leading-relaxed text-amber-200/90">
                Production build has no API URL. Add <span className="font-mono text-zinc-300">VITE_API_BASE_URL</span> in
                Netlify environment variables (your deployed API over <span className="font-mono">https://</span>), redeploy, and add this Netlify URL to your API CORS list. Browsers block calling a LAN or HTTP API from this HTTPS page.
              </p>
            )}
          </div> */}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(readStoredSession);
  const [claims, setClaims] = useState([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [pendingDeleteClaim, setPendingDeleteClaim] = useState(null);
  const [claimDeleteBusy, setClaimDeleteBusy] = useState(false);
  const [claimDeleteError, setClaimDeleteError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [workspaceSave, setWorkspaceSave] = useState('idle');

  const persistTimersRef = useRef({});
  const persistWorkspaceBodiesRef = useRef({});
  const workspacePersistSeqRef = useRef(0);

  const logout = useCallback(() => {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    Object.values(persistTimersRef.current || {}).forEach((t) => window.clearTimeout(t));
    persistTimersRef.current = {};
    persistWorkspaceBodiesRef.current = {};
    setSession(null);
    setSelectedClaim(null);
    setClaims([]);
    setClaimsError('');
  }, []);

  const loadClaims = useCallback(
    async (token, { status = statusFilter, q = searchTerm } = {}) => {
      const rows = await api.listClaims(token, {
        status,
        q: String(q || '').trim() || undefined,
      });
      return rows.map(api.claimFromApi);
    },
    [statusFilter, searchTerm]
  );

  const applyClaimFromServer = useCallback((serverClaim) => {
    const norm = api.claimFromApi(serverClaim);
    const cid = claimMongoId(norm);
    if (!cid) return norm;
    setClaims((curr) => curr.map((c) => (claimMongoId(c) === cid ? norm : c)));
    setSelectedClaim((cur) => (cur && claimMongoId(cur) === cid ? norm : cur));
    return norm;
  }, []);

  const runWorkspacePersist = useCallback(
    async (id, body, seq) => {
      if (!session?.token || session.role !== 'admin' || !body) return;
      const claimId = api.normalizeClaimId(id);
      if (!claimId) throw new Error('Invalid claim id');
      const updated = await api.patchClaimWorkspace(session.token, claimId, body);
      if (seq != null && seq !== workspacePersistSeqRef.current) return updated;
      applyClaimFromServer(updated);
      setWorkspaceSave('saved');
      return updated;
    },
    [session, applyClaimFromServer]
  );

  const scheduleWorkspacePersist = useCallback(
    (id, mergedClaim) => {
      if (!session?.token || session.role !== 'admin') return;
      const claimId = api.normalizeClaimId(id) || claimMongoId(mergedClaim);
      if (!claimId) {
        setWorkspaceSave('error');
        return;
      }
      persistWorkspaceBodiesRef.current[claimId] = api.buildAdminPersistBody(mergedClaim);
      setWorkspaceSave('saving');
      window.clearTimeout(persistTimersRef.current[claimId]);
      const seq = ++workspacePersistSeqRef.current;
      persistTimersRef.current[claimId] = window.setTimeout(async () => {
        const body = persistWorkspaceBodiesRef.current[claimId];
        if (!body || !session?.token) return;
        try {
          await runWorkspacePersist(claimId, body, seq);
        } catch (e) {
          console.error(e);
          setWorkspaceSave('error');
          if (e instanceof api.ApiAuthError) logout();
        }
      }, 420);
    },
    [session, logout, runWorkspacePersist]
  );

  const flushWorkspacePersist = useCallback(
    async (claim) => {
      const claimId = claimMongoId(claim);
      if (!claimId || !session?.token || session.role !== 'admin') return;
      window.clearTimeout(persistTimersRef.current[claimId]);
      const body = persistWorkspaceBodiesRef.current[claimId] || api.buildAdminPersistBody(claim);
      setWorkspaceSave('saving');
      try {
        await runWorkspacePersist(claimId, body);
        delete persistWorkspaceBodiesRef.current[claimId];
      } catch (e) {
        console.error(e);
        setWorkspaceSave('error');
      }
    },
    [session, runWorkspacePersist]
  );

  const closeClaimModal = useCallback(() => {
    setSelectedClaim(null);
  }, []);

  const saveClaimPrices = useCallback(
    async (fields) => {
      if (!session?.token || session.role !== 'admin' || !selectedClaim) {
        throw new Error('Not authorized');
      }
      const claimId = claimMongoId(selectedClaim);
      if (!claimId) throw new Error('Invalid claim id');
      setWorkspaceSave('saving');
      try {
        const updated = await api.persistClaimPrices(session.token, claimId, fields);
        applyClaimFromServer(updated);
        const pending = persistWorkspaceBodiesRef.current[claimId];
        if (pending) {
          if (Object.prototype.hasOwnProperty.call(fields, 'quotePrice')) {
            pending.quotePrice = updated.quotePrice ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(fields, 'insuranceApprovedPrice')) {
            pending.insuranceApprovedPrice = updated.insuranceApprovedPrice ?? null;
          }
        }
        setWorkspaceSave('saved');
        return updated;
      } catch (e) {
        setWorkspaceSave('error');
        if (e instanceof api.ApiAuthError) logout();
        throw e;
      }
    },
    [session, selectedClaim, applyClaimFromServer, logout]
  );

  const saveAdminNote = useCallback(
    async (note) => {
      if (!session?.token || session.role !== 'admin' || !selectedClaim) {
        throw new Error('Not authorized');
      }
      const claimId = claimMongoId(selectedClaim);
      if (!claimId) throw new Error('Invalid claim id');
      const updated = await api.persistAdminNote(session.token, claimId, note);
      applyClaimFromServer(updated);
      return updated;
    },
    [session, selectedClaim, applyClaimFromServer]
  );

  const saveParts = useCallback(
    async (parts) => {
      if (!session?.token || session.role !== 'admin' || !selectedClaim) {
        throw new Error('Not authorized');
      }
      const claimId = claimMongoId(selectedClaim);
      if (!claimId) throw new Error('Invalid claim id');
      const updated = await api.persistParts(session.token, claimId, parts);
      applyClaimFromServer(updated);
      return updated;
    },
    [session, selectedClaim, applyClaimFromServer]
  );

  const saveQuoteWorkspace = useCallback(
    async (payload) => {
      if (!session?.token || session.role !== 'admin' || !selectedClaim) {
        throw new Error('Not authorized');
      }
      const claimId = claimMongoId(selectedClaim);
      if (!claimId) throw new Error('Invalid claim id');
      const updated = await api.persistQuoteWorkspace(session.token, claimId, payload);
      applyClaimFromServer(updated);
      return updated;
    },
    [session, selectedClaim, applyClaimFromServer]
  );

  const savePaymentStatus = useCallback(
    async (paymentStatus) => {
      if (!session?.token || session.role !== 'admin' || !selectedClaim) {
        throw new Error('Not authorized');
      }
      const claimId = claimMongoId(selectedClaim);
      if (!claimId) throw new Error('Invalid claim id');
      const updated = await api.persistPaymentStatus(session.token, claimId, paymentStatus);
      applyClaimFromServer(updated);
      return updated;
    },
    [session, selectedClaim, applyClaimFromServer]
  );

  const saveMemberSubmission = useCallback(
    async (section, data) => {
      if (!session?.token || session.role !== 'admin' || !selectedClaim) {
        throw new Error('Not authorized');
      }
      const claimId = claimMongoId(selectedClaim);
      if (!claimId) throw new Error('Invalid claim id');
      const updated = await api.patchMemberSubmission(session.token, claimId, section, data);
      applyClaimFromServer(updated);
      return updated;
    },
    [session, selectedClaim, applyClaimFromServer]
  );

  const deleteClaimRecord = useCallback(
    async (claimId) => {
      if (!session?.token || session.role !== 'admin') {
        throw new Error('Only administrators can delete claims');
      }
      const id = api.normalizeClaimId(claimId);
      if (!id) throw new Error('Invalid claim id');
      await api.deleteClaim(session.token, id);
      setClaims((curr) => curr.filter((c) => claimMongoId(c) !== id));
      setSelectedClaim(null);
    },
    [session],
  );

  const requestDeleteClaim = useCallback((item) => {
    if (!item) return;
    setClaimDeleteError('');
    setPendingDeleteClaim(item);
  }, []);

  const confirmDeleteClaim = useCallback(async () => {
    if (!pendingDeleteClaim || claimDeleteBusy) return;
    const claimId = claimMongoId(pendingDeleteClaim);
    if (!claimId) {
      setClaimDeleteError('Invalid claim id — refresh the queue and try again.');
      return;
    }
    setClaimDeleteBusy(true);
    setClaimDeleteError('');
    try {
      await deleteClaimRecord(claimId);
      setPendingDeleteClaim(null);
    } catch (e) {
      if (e instanceof api.ApiAuthError) {
        logout();
        setPendingDeleteClaim(null);
      } else {
        setClaimDeleteError(e?.message ? String(e.message) : 'Could not delete claim. Try again.');
      }
    } finally {
      setClaimDeleteBusy(false);
    }
  }, [pendingDeleteClaim, claimDeleteBusy, deleteClaimRecord, logout]);

  useEffect(() => {
    if (!session?.token) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setClaimsLoading(true);
      setClaimsError('');
      try {
        const mapped = await loadClaims(session.token);
        if (!cancelled) setClaims(mapped);
      } catch (e) {
        if (!cancelled) {
          if (e instanceof api.ApiAuthError) logout();
          else setClaimsError(e.message || 'Could not load claims.');
        }
      } finally {
        if (!cancelled) setClaimsLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session?.token, statusFilter, searchTerm, loadClaims, logout]);

  useEffect(() => {
    if (!session?.token) return;
    const onFocus = () => {
      loadClaims(session.token)
        .then(setClaims)
        .catch((e) => {
          if (e instanceof api.ApiAuthError) logout();
        });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [session?.token, loadClaims, logout]);

  useEffect(() => {
    if (!selectedClaim) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeClaimModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClaim, closeClaimModal]);

  const metrics = useMemo(() => {
    const pending = claims.filter((item) => item.status === 'Pending Review').length;
    const approved = claims.filter((item) => item.status === 'Approved').length;
    const rejected = claims.filter((item) => item.status === 'Rejected').length;
    const litigation = claims.filter((item) => item.status === 'Litigation').length;
    const recovery = claims.filter((item) => item.status === 'Recovery').length;
    return { total: claims.length, pending, approved, rejected, litigation, recovery };
  }, [claims]);

  const filteredClaims = claims;

  if (!session) {
    return <LoginScreen onLoggedIn={setSession} />;
  }

  const updateClaimStatus = async (id, status) => {
    const claimId = claimMongoId({ id, _id: id });
    if (!claimId) {
      window.alert('Invalid claim id — refresh the page, then open this claim again from the queue.');
      return;
    }
    const sameClaim = (item) => claimMongoId(item) === claimId;
    const previousClaims = claims;
    const previousSelected = selectedClaim;
    setClaims((current) => current.map((item) => (sameClaim(item) ? { ...item, status } : item)));
    setSelectedClaim((current) => (current && sameClaim(current) ? { ...current, status } : current));
    if (!session.token || session.role !== 'admin') return;
    try {
      const updated = await api.patchClaimStatus(session.token, claimId, status);
      applyClaimFromServer(updated);
    } catch (e) {
      console.error(e);
      setClaims(previousClaims);
      setSelectedClaim(previousSelected);
      window.alert(
        `Could not update status on server: ${e.message || String(e)}. If you use Litigation or Recovery, redeploy the backend on Render (or run the latest API locally).`,
      );
    }
  };

  const patchClaim = (id, partialOrFn) => {
    const claimId = api.normalizeClaimId(id);
    let mergedSnapshot = null;
    const mergeInto = (item) => {
      if (!item) return item;
      const itemClaimId = claimMongoId(item);
      if (claimId) {
        if (!itemClaimId || itemClaimId !== claimId) return item;
      } else if (String(item.id) !== String(id)) {
        return item;
      }
      const merged =
        typeof partialOrFn === 'function' ? partialOrFn(item) : { ...item, ...partialOrFn };
      const out = Object.prototype.hasOwnProperty.call(merged, 'paymentStatus')
        ? { ...merged, paymentStatus: normalizePaymentStatus(merged.paymentStatus) }
        : merged;
      const resolvedId = claimMongoId(out) || claimId;
      mergedSnapshot = resolvedId ? { ...out, id: resolvedId, _id: resolvedId } : out;
      return mergedSnapshot;
    };
    setClaims((current) => current.map(mergeInto));
    setSelectedClaim((current) => mergeInto(current));
  };

  const exportClaimToPdf = async (item) => {
    const claimId = api.normalizeClaimId(item?.id ?? item?._id);
    const filename = `claim-${item?.intakeReference || claimId || 'export'}.pdf`;

    if (session?.token && claimId) {
      try {
        await api.downloadClaimExportPdf(session.token, claimId, filename);
        return;
      } catch (e) {
        if (e instanceof api.ApiAuthError) {
          logout();
          return;
        }
        console.warn('Server PDF export failed, using browser print fallback:', e);
      }
    }

    openClaimExportPrint(
      buildClaimExportHtml(item, {
        refSummary: claimExportRefSummary(item),
        formatAud,
        paymentLabel: paymentStatusLabel(item.paymentStatus),
      }),
    );
  };

  const openRow = async (item) => {
    if (!session?.token) return;
    const rowId = api.normalizeClaimId(item?.id ?? item?._id);
    if (!rowId) {
      window.alert('This claim has an invalid id in the list. Refresh the page or contact support.');
      return;
    }
    setSelectedClaim({ ...api.claimFromApi({ ...item, id: rowId }), _detailLoading: true });
    try {
      const full = await api.getClaim(session.token, rowId);
      setSelectedClaim(api.claimFromApi(full));
    } catch (e) {
      if (e instanceof api.ApiAuthError) logout();
      else {
        console.warn(e);
        setSelectedClaim(item);
      }
    }
  };
  const t = metrics.total;
  const roleMeta = ROLE_OPTIONS.find((r) => r.id === session.role) ?? ROLE_OPTIONS[0];
  const userInitials = initialsFromName(session.displayName);
  const isModerator = session.role === 'moderator';

  return (
    <div className="min-h-screen bg-mesh-app font-sans text-zinc-900 antialiased">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="relative flex w-full flex-col border-b border-zinc-800/90 bg-zinc-950 text-zinc-100 shadow-[4px_0_24px_-8px_rgba(0,0,0,0.25)] lg:w-[236px] lg:shrink-0 lg:border-b-0 lg:border-r lg:border-zinc-800/90">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_100%_60%_at_0%_0%,rgba(99,102,241,0.12),transparent_50%)] opacity-90"
            aria-hidden
          />
          <div className="relative flex h-14 items-center gap-3 border-b border-zinc-800/80 px-4 lg:h-[56px] lg:px-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 text-sm font-bold tracking-tight text-white shadow-glow">
              H
            </div>
            <div className="min-w-0 leading-tight">
              <p className="font-display truncate text-[15px] font-semibold tracking-tight text-white">Horizon Smash</p>
              <p className="truncate text-2xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                Repairs · {isModerator ? 'Moderator' : 'Administrator'}
              </p>
            </div>
          </div>

          <nav className="relative flex flex-1 flex-col gap-4 overflow-y-auto scrollbar-thin p-2 lg:py-4">
            <div>
              <p className="px-2.5 pb-2 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Workspace</p>
              <div
                className="flex items-center gap-2.5 rounded-xl bg-zinc-800/80 px-3 py-2.5 text-[13px] font-medium text-white shadow-lift ring-1 ring-white/10"
                aria-current="page"
              >
                <Inbox className="h-4 w-4 shrink-0 text-indigo-300" strokeWidth={2} />
                <span>Claims queue</span>
              </div>
            </div>
          </nav>

          <div className="relative border-t border-zinc-800/90 p-3">
            <div className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 px-2.5 py-2.5 shadow-inner">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 font-mono text-2xs font-semibold text-zinc-300 ring-1 ring-zinc-700/80">
                {userInitials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-2xs font-semibold text-zinc-100">{session.displayName}</p>
                <p className="truncate text-2xs text-zinc-500">{roleMeta.label}</p>
                <p className="truncate font-mono text-[10px] text-zinc-600">{session.email}</p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700/90 text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/70 shadow-lift backdrop-blur-xl supports-[backdrop-filter]:bg-white/55">
            <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-5 lg:px-8">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-2xs text-zinc-500 sm:gap-3">
                <span className="hidden font-semibold uppercase tracking-wider text-zinc-400 sm:inline">Operations</span>
                <ChevronRight className="hidden h-3 w-3 shrink-0 text-zinc-300 sm:inline" aria-hidden />
                <span className="truncate font-medium text-zinc-800">Claims queue</span>
                <span className="hidden h-3 w-px shrink-0 bg-zinc-200 sm:inline" aria-hidden />
                <span className="hidden truncate text-zinc-500 sm:inline">Review and disposition</span>
                <span className="rounded-lg border border-zinc-200/90 bg-zinc-50 px-2 py-0.5 font-medium text-zinc-800 shadow-sm">
                  {roleMeta.label}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden rounded-lg border border-zinc-200/90 bg-white px-2 py-0.5 font-mono text-2xs font-medium text-zinc-600 shadow-sm sm:inline">
                  {new Date().toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })}
                </span>
                <span className="rounded-lg border border-emerald-200/90 bg-emerald-50 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-emerald-900 shadow-sm">
                  Live
                </span>
              </div>
            </div>
          </header>

          <div className="border-b border-zinc-200/70 bg-gradient-to-b from-white via-white to-zinc-50/90 px-4 py-6 sm:px-5 lg:px-8">
            <div className="flex flex-col gap-1 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-zinc-950 sm:text-[1.65rem] sm:leading-tight">
                  Claims management
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600">
                  {isModerator
                    ? 'Read-only access: use the queue and case file to review every field (overview, vehicle and incident, parties and witnesses). You cannot change claim status, request documents on behalf of the system, or export from this role.'
                    : 'Review, approve, and export accident claims. Administrators may change claim disposition.'}
                </p>
              </div>
              <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-2xs text-zinc-500 lg:mt-0 lg:justify-end">
                <div className="flex gap-1.5">
                  <dt className="text-zinc-400">Portfolio</dt>
                  <dd className="font-mono font-semibold text-zinc-800">{metrics.total} open</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-zinc-400">Filtered</dt>
                  <dd className="font-mono font-semibold text-zinc-800">{filteredClaims.length} rows</dd>
                </div>
              </dl>
            </div>
          </div>

          <main className="flex-1 overflow-auto scrollbar-thin px-4 py-5 sm:px-5 lg:px-8 lg:py-7">
            <>
            {claimsError ? (
              <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{claimsError}</div>
            ) : null}
            {claimsLoading ? (
              <div className="mb-5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">Loading claims from API…</div>
            ) : null}
            {isModerator && (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/90 to-white px-4 py-3 shadow-card sm:items-center sm:px-5">
                <span className="mt-0.5 shrink-0 rounded-lg border border-indigo-300/80 bg-white px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-indigo-900 shadow-sm sm:mt-0">
                  Read-only
                </span>
                <p className="text-2xs leading-relaxed text-zinc-700 sm:text-xs">
                  You can search, filter, and open any claim to view the same data as an administrator. Status changes and exports are reserved for administrators.
                </p>
              </div>
            )}
            <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 sm:gap-4">
              <MetricCard
                title="Total claims"
                value={metrics.total}
                caption="All records in the active portfolio."
                icon={FileCheck2}
                tone="slate"
              />
              <MetricCard
                title="Pending review"
                value={metrics.pending}
                caption={t ? `${shareOfTotal(metrics.pending, t)}% of portfolio` : '—'}
                icon={FileSearch}
                tone="amber"
              />
              <MetricCard
                title="Approved"
                value={metrics.approved}
                caption={t ? `${shareOfTotal(metrics.approved, t)}% of portfolio` : '—'}
                icon={CheckCircle2}
                tone="emerald"
              />
              <MetricCard
                title="Rejected"
                value={metrics.rejected}
                caption={t ? `${shareOfTotal(metrics.rejected, t)}% of portfolio` : '—'}
                icon={XCircle}
                tone="rose"
              />
              <MetricCard
                title="Litigation"
                value={metrics.litigation}
                caption={t ? `${shareOfTotal(metrics.litigation, t)}% of portfolio` : '—'}
                icon={Gavel}
                tone="violet"
              />
              <MetricCard
                title="Recovery"
                value={metrics.recovery}
                caption={t ? `${shareOfTotal(metrics.recovery, t)}% of portfolio` : '—'}
                icon={Landmark}
                tone="sky"
              />
            </section>

            <section className="mt-2 grid gap-6 xl:grid-cols-[1fr_300px]">
              <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-card">
                <div className="border-b border-zinc-100 px-4 py-4 sm:px-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h2 className="font-display text-base font-semibold tracking-tight text-zinc-950">Submitted claims</h2>
                      <p className="mt-1 text-sm text-zinc-600">Search and filter the intake queue. Select a row to open the case file.</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:max-w-xl">
                      <label className="group relative min-w-0 flex-1 sm:max-w-xs lg:max-w-[280px]">
                        <span className="sr-only">Search claims</span>
                        <Search
                          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 transition group-focus-within:text-indigo-600"
                          strokeWidth={2}
                        />
                        <input
                          type="search"
                          value={searchTerm}
                          onChange={(event) => setSearchTerm(event.target.value)}
                          placeholder="Search plate, driver, date…"
                          className="h-10 w-full rounded-xl border border-zinc-200/90 bg-zinc-50/80 pl-10 pr-3 text-[13px] text-zinc-900 shadow-inner outline-none transition placeholder:text-zinc-400 focus:border-indigo-400/80 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </label>
                      <div
                        className="flex max-w-full flex-wrap gap-1 rounded-xl border border-zinc-200/90 bg-zinc-100/90 p-0.5 shadow-inner"
                        role="group"
                        aria-label="Filter by status"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setStatusFilter(option)}
                            className={`whitespace-nowrap rounded-lg px-2.5 py-2 text-2xs font-semibold uppercase tracking-wide transition ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 sm:px-3 ${
                              statusFilter === option
                                ? 'bg-white text-zinc-900 shadow-lift ring-1 ring-zinc-200/80'
                                : 'text-zinc-600 hover:text-zinc-900'
                            }`}
                          >
                            {statusFilterLabel(option)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-2 border-t border-zinc-100 pt-4 sm:grid-cols-3">
                    <QueueStat label="Awaiting action" value={metrics.pending} />
                    <QueueStat label="In view" value={filteredClaims.length} />
                    <QueueStat label="High priority" value={claims.filter((item) => item.priority === 'High').length} />
                  </div>
                </div>

                <div className="overflow-x-auto scrollbar-thin">
                  <table className="min-w-[800px] w-full border-collapse text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50/95">
                        <th className="w-10 px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">#</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500" title="Member portal code (HR-…) and internal id (HRZ-…)">
                          Reference
                        </th>
                        <th className="min-w-[140px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Plate</th>
                        <th className="min-w-[160px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Driver</th>
                        <th className="whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Submitted</th>
                        <th className="whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Incident</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Payment</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Priority</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Status</th>
                        <th className="w-[72px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                          {isModerator ? '' : 'Actions'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {filteredClaims.map((item, index) => {
                        const active = selectedClaim?.id === item.id;
                        return (
                          <tr
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => openRow(item)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openRow(item);
                              }
                            }}
                            className={`cursor-pointer transition ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/90 ${
                              active ? 'bg-indigo-50/80 shadow-[inset_3px_0_0_0_rgb(99,102,241)]' : 'hover:bg-zinc-50/90'
                            }`}
                          >
                            <td className="px-3 py-2.5 font-mono text-2xs tabular-nums text-zinc-400">{index + 1}</td>
                            <td className="px-3 py-2.5 font-mono text-2xs text-zinc-500">
                              {item.intakeReference ? (
                                <div className="min-w-0">
                                  <div className="font-semibold text-zinc-800" title="Code from the public claim portal">
                                    {item.intakeReference}
                                  </div>
                                  {item.reference ? (
                                    <div className="mt-0.5 truncate text-zinc-400" title="Internal system reference">
                                      {item.reference}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-zinc-600">{claimRef(item)}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    item.priority === 'High'
                                      ? 'bg-rose-500'
                                      : item.priority === 'Needs Docs'
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                  }`}
                                  title={item.priority}
                                  aria-hidden
                                />
                                <span className="font-mono text-[13px] font-semibold text-zinc-900">{item.plateNumber}</span>
                              </div>
                            </td>
                            <td className="max-w-[200px] px-3 py-2.5">
                              <p className="truncate font-medium text-zinc-900">{item.driverName}</p>
                              <p className="truncate text-2xs text-zinc-500">{item.summary}</p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-2xs tabular-nums text-zinc-600">
                              {item.submittedAt}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-2xs tabular-nums text-zinc-600">
                              {item.dateOfIncident}
                            </td>
                            <td className="px-3 py-2.5">
                              <PaymentStatusBadge status={item.paymentStatus ?? 'pending'} />
                            </td>
                            <td className="px-3 py-2.5">
                              <PriorityBadge priority={item.priority} />
                            </td>
                            <td className="px-3 py-2.5">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                {!isModerator ? (
                                  <button
                                    type="button"
                                    onClick={() => requestDeleteClaim(item)}
                                    title="Delete claim"
                                    aria-label={`Delete claim ${item.intakeReference || item.plateNumber || item.driverName}`}
                                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-zinc-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/80"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                                  </button>
                                ) : null}
                                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" strokeWidth={2} aria-hidden />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!filteredClaims.length && (
                        <tr>
                          <td colSpan={10} className="px-4 py-12">
                            <div className="mx-auto max-w-md rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-5 py-8 text-center shadow-inner">
                              <p className="text-sm font-semibold text-zinc-900">No matching claims</p>
                              <p className="mt-1.5 text-sm text-zinc-600">
                                Adjust search or status filters to broaden the result set.
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="flex min-w-0 flex-col gap-4">
                <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-card">
                  <div className="flex gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-700 shadow-inner">
                      <Shield className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Policy</p>
                      <p className="mt-1 text-sm leading-snug text-zinc-600">
                        {isModerator
                          ? 'Moderators have full visibility into claim records for oversight and triage. Disposition, document requests, and exports are administrator-only.'
                          : 'Use documented criteria when changing status. Export generates an insurer-ready print layout.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-card">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Workflow</p>
                  <ol className="mt-3 space-y-3">
                    {(isModerator
                      ? ['Scan the queue and filters', 'Open a row to read the full case file (all tabs)']
                      : ['Validate intake data', 'Confirm liability signals', 'Record disposition', 'Export if required']
                    ).map((step, i) => (
                      <li key={step} className="flex gap-3 text-sm text-zinc-700">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-zinc-200/90 bg-zinc-50 font-mono text-2xs font-semibold text-zinc-600 shadow-inner">
                          {i + 1}
                        </span>
                        <span className="pt-0.5 leading-snug">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-card">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Guidance</p>
                  <ul className="mt-3 space-y-3">
                    <AdminHint
                      icon={LayoutDashboard}
                      title="Queue hygiene"
                      text={isModerator ? 'Use search and status filters to narrow the list; all columns remain visible.' : 'Process incoming claims and keep the queue moving.'}
                    />
                    <AdminHint
                      icon={MapPinned}
                      title="Case file"
                      text={
                        isModerator
                          ? 'Open any row: Overview, Vehicle & incident, and Parties & witnesses match the administrator view (read-only).'
                          : 'Open any row for structured fields and disposition actions.'
                      }
                    />
                    {!isModerator && (
                      <AdminHint icon={Download} title="Print handoff" text="Export for workshop or insurer packets." />
                    )}
                  </ul>
                </div>

                <div className="rounded-2xl border border-zinc-200/90 bg-gradient-to-b from-zinc-50/90 to-white p-5 shadow-inner">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Checklist</p>
                  {isModerator ? (
                    <p className="mt-2.5 text-sm leading-relaxed text-zinc-700">
                      For status changes, document requests, or PDF exports, ask an <span className="font-medium text-zinc-900">Administrator</span> to act in this workspace.
                    </p>
                  ) : (
                    <ul className="mt-2.5 space-y-2">
                      {queueHighlights.map((item) => (
                        <li key={item.title} className="border-l-2 border-indigo-300/80 pl-3 text-sm text-zinc-700">
                          <span className="font-medium text-zinc-900">{item.title}.</span>{' '}
                          <span className="text-zinc-600">{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </aside>
            </section>
              </>
          </main>
        </div>
      </div>

      {selectedClaim && (
        <ClaimModal
          claimItem={selectedClaim}
          role={session.role}
          authToken={session.token}
          workspaceSave={workspaceSave}
          onClose={closeClaimModal}
          onApprove={() => updateClaimStatus(claimMongoId(selectedClaim), 'Approved')}
          onReject={() => updateClaimStatus(claimMongoId(selectedClaim), 'Rejected')}
          onLitigation={() => updateClaimStatus(claimMongoId(selectedClaim), 'Litigation')}
          onRecovery={() => updateClaimStatus(claimMongoId(selectedClaim), 'Recovery')}
          onReopen={() => updateClaimStatus(claimMongoId(selectedClaim), 'Pending Review')}
          onExport={() => exportClaimToPdf(selectedClaim)}
          onPatchClaim={patchClaim}
          onUpdatePrices={saveClaimPrices}
          onSaveAdminNote={saveAdminNote}
          onSaveParts={saveParts}
          onSaveQuoteWorkspace={saveQuoteWorkspace}
          onSavePaymentStatus={savePaymentStatus}
          onSaveMemberSubmission={saveMemberSubmission}
          onRequestDelete={() => requestDeleteClaim(selectedClaim)}
        />
      )}

      <ClaimDeleteConfirmDialog
        open={Boolean(pendingDeleteClaim)}
        claimItem={pendingDeleteClaim}
        busy={claimDeleteBusy}
        errorMessage={claimDeleteError}
        onConfirm={confirmDeleteClaim}
        onCancel={() => {
          if (!claimDeleteBusy) {
            setPendingDeleteClaim(null);
            setClaimDeleteError('');
          }
        }}
      />
    </div>
  );
}

function MetricCard({ title, value, caption, icon: Icon, tone }) {
  const tones = {
    slate: 'border-zinc-200/90 bg-white text-zinc-700',
    amber: 'border-amber-200/80 bg-amber-50/50 text-amber-900',
    emerald: 'border-emerald-200/80 bg-emerald-50/50 text-emerald-900',
    rose: 'border-rose-200/80 bg-rose-50/50 text-rose-900',
    violet: 'border-violet-200/80 bg-violet-50/50 text-violet-900',
    sky: 'border-sky-200/80 bg-sky-50/50 text-sky-900',
  };

  return (
    <div
      className={`rounded-2xl border px-3 py-3 shadow-card transition ease-out hover:shadow-card-hover sm:px-4 sm:py-4 ${tones[tone]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums tracking-tight text-zinc-950">{value}</p>
          <p className="mt-1 text-2xs leading-relaxed text-zinc-600">{caption}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50/80 text-zinc-600 shadow-inner">
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles =
    status === 'Approved'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : status === 'Rejected'
        ? 'border-rose-200 bg-rose-50 text-rose-900'
        : status === 'Litigation'
          ? 'border-violet-200 bg-violet-50 text-violet-900'
          : status === 'Recovery'
            ? 'border-sky-200 bg-sky-50 text-sky-900'
            : 'border-amber-200 bg-amber-50 text-amber-950';

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${styles}`}
    >
      {statusFilterLabel(status)}
    </span>
  );
}

function PriorityBadge({ priority }) {
  const styles =
    priority === 'High'
      ? 'border-rose-200 bg-white text-rose-800'
      : priority === 'Needs Docs'
        ? 'border-amber-200 bg-white text-amber-950'
        : 'border-zinc-200/90 bg-white text-zinc-700';

  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-2xs font-semibold ${styles}`}>{priority}</span>
  );
}

function PaymentStatusBadge({ status }) {
  const id = normalizePaymentStatus(status);
  const styles =
    id === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-amber-200 bg-amber-50 text-amber-950';

  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${styles}`}
    >
      {paymentStatusLabel(id)}
    </span>
  );
}

function PartStatusBadge({ status }) {
  const id = status === 'completed' ? 'completed' : 'pending';
  const styles =
    id === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-amber-200 bg-amber-50 text-amber-950';

  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-2xs font-semibold capitalize ${styles}`}
    >
      {id}
    </span>
  );
}

function QueueStat({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-xl border border-zinc-100 bg-zinc-50/90 px-3 py-2 shadow-inner">
      <span className="text-2xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900">{value}</span>
    </div>
  );
}

function AdminHint({ icon: Icon, title, text }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-600 shadow-inner">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="mt-0.5 text-2xs leading-relaxed text-zinc-600">{text}</p>
      </div>
    </li>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div className="border-b border-zinc-100 py-2.5 last:border-0 sm:grid sm:grid-cols-[minmax(0,140px)_1fr] sm:gap-3 sm:py-2">
      <dt className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900 sm:mt-0">{value || '—'}</dd>
    </div>
  );
}

function DetailCard({ title, items }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
      <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
      </div>
      <dl className="divide-y divide-zinc-100 px-4 py-1">
        {items.map(([label, value]) => (
          <div key={label} className="grid gap-0.5 py-2.5 sm:grid-cols-[minmax(0,120px)_1fr] sm:gap-3">
            <dt className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
            <dd className="text-sm text-zinc-900">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function OperationalPill({ title, text }) {
  return (
    <div className="rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 shadow-inner">
      <p className="text-xs font-semibold text-zinc-900">{title}</p>
      <p className="mt-1 text-2xs leading-relaxed text-zinc-600">{text}</p>
    </div>
  );
}

function CaseWorkspaceStat({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-zinc-200/90 bg-white text-zinc-950';
  return (
    <div className={`rounded-xl border px-3 py-2.5 shadow-inner ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value || '—'}</p>
    </div>
  );
}

function CaseWorkspaceAsideRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 py-2.5 last:border-b-0">
      <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="max-w-[11rem] text-right text-sm font-medium text-zinc-900">{value || '—'}</span>
    </div>
  );
}

function priceDraftFromClaim(item) {
  return {
    quote: item?.quotePrice != null && item.quotePrice !== '' ? String(item.quotePrice) : '',
    insurance:
      item?.insuranceApprovedPrice != null && item.insuranceApprovedPrice !== ''
        ? String(item.insuranceApprovedPrice)
        : '',
  };
}

function ClaimModal({
  claimItem,
  role,
  authToken,
  workspaceSave,
  onClose,
  onApprove,
  onReject,
  onLitigation,
  onRecovery,
  onReopen,
  onExport,
  onPatchClaim,
  onUpdatePrices,
  onSaveAdminNote,
  onSaveParts,
  onSaveQuoteWorkspace,
  onSavePaymentStatus,
  onSaveMemberSubmission,
  onRequestDelete,
}) {
  const [tab, setTab] = useState('overview');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [priceDraft, setPriceDraft] = useState(() => priceDraftFromClaim(claimItem));
  const [quoteSave, setQuoteSave] = useState('idle');
  const [quoteSaveKind, setQuoteSaveKind] = useState(null);
  const [insuranceSave, setInsuranceSave] = useState('idle');
  const [insuranceSaveKind, setInsuranceSaveKind] = useState(null);
  const [adminNoteDraft, setAdminNoteDraft] = useState(() => claimItem.adminNote ?? '');
  const [adminNoteSave, setAdminNoteSave] = useState('idle');
  const [adminNoteSaveKind, setAdminNoteSaveKind] = useState(null);
  const [partsDraft, setPartsDraft] = useState(() => cloneParts(claimItem.parts));
  const [partsSave, setPartsSave] = useState('idle');
  const [partsSaveKind, setPartsSaveKind] = useState(null);
  const [partInvoiceBusyId, setPartInvoiceBusyId] = useState(null);
  const [partNextInvoiceNumber, setPartNextInvoiceNumber] = useState({});
  const [quoteOptionsDraft, setQuoteOptionsDraft] = useState(() => cloneQuoteOptions(claimItem.quoteOptions));
  const [primaryQuoteIdDraft, setPrimaryQuoteIdDraft] = useState(claimItem.primaryQuoteId ?? null);
  const [finalQuoteIdDraft, setFinalQuoteIdDraft] = useState(claimItem.finalQuoteId ?? null);
  const [repairQuotesSave, setRepairQuotesSave] = useState('idle');
  const [repairQuotesSaveKind, setRepairQuotesSaveKind] = useState(null);
  const [paymentStatusDraft, setPaymentStatusDraft] = useState(() =>
    normalizePaymentStatus(claimItem.paymentStatus),
  );
  const [paymentSave, setPaymentSave] = useState('idle');
  const [paymentSaveKind, setPaymentSaveKind] = useState(null);
  const isModerator = role === 'moderator';
  const fileInputRef = useRef(null);
  const tabRailRef = useRef(null);

  const openDeleteDialog = () => onRequestDelete?.();

  const scrollTabRail = (direction) => {
    const rail = tabRailRef.current;
    if (!rail) return;
    rail.scrollBy({
      left: direction * Math.max(180, rail.clientWidth * 0.72),
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    setTab('overview');
  }, [claimItem.id, claimItem._id]);

  useEffect(() => {
    const rail = tabRailRef.current;
    if (!rail) return;
    const active = rail.querySelector('[data-active-tab="true"]');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [tab]);

  useEffect(() => {
    setPriceDraft(priceDraftFromClaim(claimItem));
    setQuoteSave('idle');
    setQuoteSaveKind(null);
    setInsuranceSave('idle');
    setInsuranceSaveKind(null);
  }, [claimItem.id, claimItem._id, claimItem.quotePrice, claimItem.insuranceApprovedPrice]);

  useEffect(() => {
    setAdminNoteDraft(claimItem.adminNote ?? '');
    setAdminNoteSave('idle');
    setAdminNoteSaveKind(null);
    setPartsDraft(cloneParts(claimItem.parts));
    setPartsSave('idle');
    setPartsSaveKind(null);
    setQuoteOptionsDraft(cloneQuoteOptions(claimItem.quoteOptions));
    setPrimaryQuoteIdDraft(claimItem.primaryQuoteId ?? null);
    setFinalQuoteIdDraft(claimItem.finalQuoteId ?? null);
    setRepairQuotesSave('idle');
    setRepairQuotesSaveKind(null);
    setPaymentStatusDraft(normalizePaymentStatus(claimItem.paymentStatus));
    setPaymentSave('idle');
    setPaymentSaveKind(null);
  }, [claimItem.id, claimItem._id]);

  const patch = (partialOrFn) => {
    const claimId = claimMongoId(claimItem);
    onPatchClaim(claimId || claimItem.id, partialOrFn);
  };

  const handleSaveQuotePrice = async () => {
    if (isModerator || !onUpdatePrices) return;
    const amount = parseMoneyInput(priceDraft.quote);
    if (amount == null) {
      window.alert('Enter a quote price before saving.');
      return;
    }
    const wasUpdate = quotePrice != null;
    setQuoteSave('saving');
    setQuoteSaveKind(null);
    try {
      const updated = await onUpdatePrices({ quotePrice: amount });
      setPriceDraft((d) => ({ ...d, ...priceDraftFromClaim(updated) }));
      setQuoteSaveKind(wasUpdate ? 'updated' : 'saved');
      setQuoteSave('saved');
    } catch (e) {
      setQuoteSave('error');
      window.alert(e?.message ? String(e.message) : 'Could not save quote price.');
    }
  };

  const handleSaveInsurancePrice = async () => {
    if (isModerator || !onUpdatePrices) return;
    const amount = parseMoneyInput(priceDraft.insurance);
    if (amount == null) {
      window.alert('Enter an insurance company price before saving.');
      return;
    }
    const wasUpdate = insuranceApprovedPrice != null;
    setInsuranceSave('saving');
    setInsuranceSaveKind(null);
    try {
      const updated = await onUpdatePrices({ insuranceApprovedPrice: amount });
      setPriceDraft((d) => ({ ...d, ...priceDraftFromClaim(updated) }));
      setInsuranceSaveKind(wasUpdate ? 'updated' : 'saved');
      setInsuranceSave('saved');
    } catch (e) {
      setInsuranceSave('error');
      window.alert(e?.message ? String(e.message) : 'Could not save insurance company price.');
    }
  };

  const handleSaveAdminNote = async () => {
    if (isModerator || !onSaveAdminNote) return;
    const wasUpdate = (claimItem.adminNote ?? '').trim().length > 0;
    setAdminNoteSave('saving');
    setAdminNoteSaveKind(null);
    try {
      const updated = await onSaveAdminNote(adminNoteDraft);
      setAdminNoteDraft(updated.adminNote ?? '');
      setAdminNoteSaveKind(wasUpdate ? 'updated' : 'saved');
      setAdminNoteSave('saved');
    } catch (e) {
      setAdminNoteSave('error');
      window.alert(e?.message ? String(e.message) : 'Could not save admin note.');
    }
  };

  const patchQuoteFieldDraft = (quoteId, field, rawValue) => {
    setQuoteOptionsDraft((rows) =>
      rows.map((opt) => {
        if (opt.id !== quoteId) return opt;
        if (field === 'amount') {
          const n = Number(String(rawValue).replace(/,/g, ''));
          return { ...opt, amount: Number.isFinite(n) && n >= 0 ? n : 0 };
        }
        return { ...opt, [field]: rawValue };
      }),
    );
    if (repairQuotesSave === 'saved') setRepairQuotesSave('idle');
    setRepairQuotesSaveKind(null);
  };

  const caseFiles = claimItem.caseFiles ?? [];
  const quoteOptions = quoteOptionsDraft;
  const quotePrice = claimItem.quotePrice ?? null;
  const insuranceApprovedPrice = claimItem.insuranceApprovedPrice ?? null;
  const claimStatus = claimItem.status ?? 'Pending Review';
  const isPendingReview = claimStatus === 'Pending Review';
  const memberRepairQuoteRef =
    claimItem.payload?.repairQuoteRef ||
    claimItem.payload?.checklist?.repairQuoteRef ||
    claimItem.data?.repairQuoteRef ||
    '';

  const data = claimItem.data ?? {};
  const otherParties = data.otherParties ?? [];
  const witnessDetails = data.witnessDetails ?? {};
  const towingSummary = [
    data.damage?.towed ? `Towed: ${data.damage.towed}` : null,
    data.damage?.towCompany ? `Tow company: ${data.damage.towCompany}` : null,
    data.damage?.towLocation ? `Tow destination: ${data.damage.towLocation}` : null,
    data.damage?.currentVehicleLocation ? `Vehicle now at: ${data.damage.currentVehicleLocation}` : null,
  ].filter(Boolean);
  const mergedDamage = { ...(data.damage || {}), ...(claimItem.payload?.damage || {}) };
  const damageDiagramResolved = resolveDamageDiagramFromDamage(mergedDamage);
  const damageMarkerCount = damageDiagramResolved.markers.length;
  const damageStrokeCount = damageDiagramResolved.strokes.length;

  const paymentStatus = paymentStatusDraft;
  const adminNote = claimItem.adminNote ?? '';
  const hasSavedAdminNote = adminNote.trim().length > 0;
  const isAdminNoteDirty = adminNoteDraft !== adminNote;
  const hasSavedQuotePrice = quotePrice != null;
  const isQuotePriceDirty = !moneyAmountsEqual(quotePrice, priceDraft.quote);
  const hasSavedInsurancePrice = insuranceApprovedPrice != null;
  const isInsurancePriceDirty = !moneyAmountsEqual(insuranceApprovedPrice, priceDraft.insurance);
  const savedParts = claimItem.parts ?? [];
  const parts = partsDraft;
  const partsPendingCount = parts.filter((p) => p.status === 'pending').length;
  const partsSummaryText = savedParts.length
    ? `${savedParts.length} line(s) · ${savedParts.filter((p) => p.status === 'pending').length} pending · ${savedParts.filter((p) => p.status === 'completed').length} completed`
    : undefined;
  const hasSavedParts = savedParts.length > 0;
  const isPartsDirty = !partsEqual(partsDraft, savedParts);
  const savedQuoteOptions = claimItem.quoteOptions ?? [];
  const hasSavedRepairQuotes = savedQuoteOptions.length > 0;
  const isRepairQuotesDirty =
    !quoteOptionsEqual(quoteOptionsDraft, savedQuoteOptions) ||
    (primaryQuoteIdDraft ?? null) !== (claimItem.primaryQuoteId ?? null) ||
    (finalQuoteIdDraft ?? null) !== (claimItem.finalQuoteId ?? null);
  const savedPaymentStatus = normalizePaymentStatus(claimItem.paymentStatus);
  const isPaymentDirty = paymentStatusDraft !== savedPaymentStatus;

  const updatePartDraft = (partId, field, raw) => {
    setPartsDraft((rows) =>
      rows.map((p) => {
        if (p.id !== partId) return p;
        if (field === 'amount' || field === 'quotePrice') {
          const s = String(raw).replace(/,/g, '');
          if (s === '' || /^\d*\.?\d*$/.test(s)) return { ...p, [field]: s };
          return p;
        }
        return { ...p, [field]: raw };
      }),
    );
    if (partsSave === 'saved') setPartsSave('idle');
    setPartsSaveKind(null);
  };
  const addPart = () => {
    if (isModerator) return;
    setPartsDraft((rows) => [...rows, newPartLine()]);
    if (partsSave === 'saved') setPartsSave('idle');
    setPartsSaveKind(null);
  };
  const removePart = (partId) => {
    if (isModerator) return;
    setPartsDraft((rows) => rows.filter((p) => p.id !== partId));
    if (partsSave === 'saved') setPartsSave('idle');
    setPartsSaveKind(null);
  };

  const updatePartInvoiceNumber = (partId, invoiceId, invoiceNumber) => {
    setPartsDraft((rows) =>
      rows.map((p) =>
        p.id === partId
          ? {
              ...p,
              invoices: (p.invoices ?? []).map((inv) =>
                inv.id === invoiceId ? { ...inv, invoiceNumber } : inv,
              ),
            }
          : p,
      ),
    );
    if (partsSave === 'saved') setPartsSave('idle');
    setPartsSaveKind(null);
  };

  const removePartInvoice = async (partId, invoiceId) => {
    if (isModerator) return;
    const part = partsDraft.find((p) => p.id === partId);
    const inv = (part?.invoices ?? []).find((row) => row.id === invoiceId);
    if (!inv) return;
    if (authToken && inv.fileId) {
      try {
        const caseFiles = await api.deleteClaimPdf(authToken, claimMongoId(claimItem), inv.fileId);
        patch((prev) => ({ ...prev, caseFiles }));
      } catch (e) {
        console.error(e);
      }
    }
    setPartsDraft((rows) =>
      rows.map((p) =>
        p.id === partId ? { ...p, invoices: (p.invoices ?? []).filter((row) => row.id !== invoiceId) } : p,
      ),
    );
    if (partsSave === 'saved') setPartsSave('idle');
    setPartsSaveKind(null);
  };

  const handlePartInvoiceUpload = async (partId, ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || isModerator || !authToken) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      window.alert('Please upload a PDF invoice.');
      return;
    }
    const claimId = claimMongoId(claimItem);
    if (!claimId) {
      window.alert('Invalid claim id — close and reopen this case.');
      return;
    }
    const invoiceNumber = String(partNextInvoiceNumber[partId] ?? '').trim();
    setPartInvoiceBusyId(partId);
    try {
      const caseFiles = await api.uploadClaimPdf(authToken, claimId, file);
      const uploaded = caseFiles[caseFiles.length - 1];
      if (!uploaded) throw new Error('Upload failed');
      const newRow = {
        id: newPartInvoiceId(),
        invoiceNumber,
        fileId: uploaded.id,
        fileName: uploaded.name,
        fileUrl: uploaded.url,
      };
      setPartsDraft((rows) =>
        rows.map((p) => (p.id === partId ? { ...p, invoices: [...(p.invoices ?? []), newRow] } : p)),
      );
      setPartNextInvoiceNumber((prev) => ({ ...prev, [partId]: '' }));
      patch((prev) => ({ ...prev, caseFiles }));
      if (partsSave === 'saved') setPartsSave('idle');
      setPartsSaveKind(null);
    } catch (e) {
      window.alert(e?.message ? String(e.message) : 'Could not upload invoice.');
    } finally {
      setPartInvoiceBusyId(null);
    }
  };

  const addQuote = () => {
    if (isModerator) return;
    setQuoteOptionsDraft((rows) => [...rows, newQuoteLine()]);
    if (repairQuotesSave === 'saved') setRepairQuotesSave('idle');
    setRepairQuotesSaveKind(null);
  };

  const handleSaveParts = async () => {
    if (isModerator || !onSaveParts) return;
    const wasUpdate = hasSavedParts;
    setPartsSave('saving');
    setPartsSaveKind(null);
    try {
      const updated = await onSaveParts(partsDraft);
      setPartsDraft(cloneParts(updated.parts));
      setPartsSaveKind(wasUpdate ? 'updated' : 'saved');
      setPartsSave('saved');
    } catch (e) {
      setPartsSave('error');
      window.alert(e?.message ? String(e.message) : 'Could not save purchase lines.');
    }
  };

  const handleSaveRepairQuotes = async () => {
    if (isModerator || !onSaveQuoteWorkspace) return;
    const wasUpdate = hasSavedRepairQuotes;
    setRepairQuotesSave('saving');
    setRepairQuotesSaveKind(null);
    try {
      const updated = await onSaveQuoteWorkspace({
        quoteOptions: quoteOptionsDraft,
        primaryQuoteId: primaryQuoteIdDraft,
        finalQuoteId: finalQuoteIdDraft,
      });
      setQuoteOptionsDraft(cloneQuoteOptions(updated.quoteOptions));
      setPrimaryQuoteIdDraft(updated.primaryQuoteId ?? null);
      setFinalQuoteIdDraft(updated.finalQuoteId ?? null);
      setRepairQuotesSaveKind(wasUpdate ? 'updated' : 'saved');
      setRepairQuotesSave('saved');
    } catch (e) {
      setRepairQuotesSave('error');
      window.alert(e?.message ? String(e.message) : 'Could not save repair quotes.');
    }
  };

  const handleSavePaymentStatus = async () => {
    if (isModerator || !onSavePaymentStatus) return;
    const wasUpdate = true;
    setPaymentSave('saving');
    setPaymentSaveKind(null);
    try {
      const updated = await onSavePaymentStatus(paymentStatusDraft);
      setPaymentStatusDraft(normalizePaymentStatus(updated.paymentStatus));
      setPaymentSaveKind(wasUpdate ? 'updated' : 'saved');
      setPaymentSave('saved');
    } catch (e) {
      setPaymentSave('error');
      window.alert(e?.message ? String(e.message) : 'Could not save payment status.');
    }
  };

  const handlePdfInput = async (ev) => {
    const picked = [...(ev.target.files || [])].filter((f) => f.type === 'application/pdf');
    ev.target.value = '';
    if (!picked.length || isModerator) return;
    const MAX_FALLBACK_BYTES = Number(import.meta.env.VITE_MAX_ADMIN_PDF_BYTES || 25 * 1024 * 1024);
    const ok = [];
    const skip = [];
    for (const f of picked) {
      if (f.size > MAX_FALLBACK_BYTES) skip.push(f.name);
      else ok.push(f);
    }
    if (skip.length) {
      window.alert(`These files were skipped (limit ${formatFileSize(MAX_FALLBACK_BYTES)}): ${skip.join(', ')}`);
    }
    if (!ok.length) return;
    setPdfBusy(true);
    try {
      if (authToken) {
        const claimId = api.normalizeClaimId(claimItem.id ?? claimItem._id);
        if (!claimId) {
          window.alert('Invalid claim id — close this case and open it again from the queue.');
          return;
        }
        let nextList = [...(claimItem.caseFiles ?? [])];
        for (const f of ok) {
          nextList = await api.uploadClaimPdf(authToken, claimId, f);
        }
        patch((prev) => ({ ...prev, caseFiles: nextList, id: claimId, _id: claimId }));
      } else {
        const added = await Promise.all(ok.map((f) => fileToCaseFile(f)));
        patch((prev) => ({
          ...prev,
          caseFiles: [...(prev.caseFiles ?? []), ...added],
        }));
      }
    } catch (e) {
      window.alert(e?.message ? String(e.message) : 'Could not upload one or more PDFs.');
    } finally {
      setPdfBusy(false);
    }
  };

  const removePdf = async (fileId) => {
    if (isModerator) return;
    const list = claimItem.caseFiles ?? [];
    const target = list.find((f) => f.id === fileId);
    const remote = authToken && target?.url?.startsWith('/uploads/');
    if (remote) {
      setPdfBusy(true);
      try {
        const cf = await api.deleteClaimPdf(authToken, claimMongoId(claimItem), fileId);
        patch((prev) => ({ ...prev, caseFiles: cf }));
      } catch (e) {
        window.alert(e?.message ? String(e.message) : 'Could not delete file.');
      } finally {
        setPdfBusy(false);
      }
      return;
    }
    if (target?.url?.startsWith('blob:')) URL.revokeObjectURL(target.url);
    patch((prev) => ({
      ...prev,
      caseFiles: (prev.caseFiles ?? []).filter((f) => f.id !== fileId),
    }));
  };

  const activeTabLabel = MODAL_TABS.find((item) => item.id === tab)?.label || 'Case file';
  const quoteSummary =
    quotePrice != null
      ? formatAud(quotePrice)
      : insuranceApprovedPrice != null
        ? formatAud(insuranceApprovedPrice)
        : 'Not set';
  const sidebarNote = adminNote.trim()
    ? `${adminNote.trim().slice(0, 110)}${adminNote.trim().length > 110 ? '...' : ''}`
    : 'No admin note';

  return (
    <div className="fixed inset-0 z-50 flex bg-zinc-950/55 p-0 backdrop-blur-sm lg:p-3">
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden border border-zinc-200/90 bg-zinc-50 shadow-sheet-lg lg:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-modal-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200/90 bg-white px-3 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-2xs text-zinc-500">
              <span className="font-mono font-medium text-zinc-600" title="Member portal save code">
                {claimRef(claimItem)}
              </span>
              {claimItem.reference && claimItem.intakeReference && claimItem.reference !== claimItem.intakeReference ? (
                <>
                  <span className="text-zinc-300" aria-hidden>
                    ·
                  </span>
                  <span className="font-mono text-zinc-400" title="Internal system reference">
                    {claimItem.reference}
                  </span>
                </>
              ) : null}
              <span className="text-zinc-300" aria-hidden>
                ·
              </span>
              <span>Claims</span>
              <ChevronRight className="h-3 w-3 text-zinc-300" aria-hidden />
              <span>{activeTabLabel}</span>
            </div>
            <h2 id="claim-modal-title" className="font-display mt-1.5 truncate text-lg font-semibold tracking-tight text-zinc-950 sm:text-2xl">
              {claimItem.driverName || 'Unnamed driver'}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-lg border border-zinc-200/90 bg-zinc-50 px-2 py-1 font-mono text-sm font-semibold text-zinc-800">
                {claimItem.plateNumber || 'No plate'}
              </span>
              <StatusBadge status={claimItem.status} />
            </div>
            <p className="mt-3 hidden max-w-4xl text-sm leading-relaxed text-zinc-600 sm:block">{claimItem.summary || 'No summary recorded.'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isModerator && (
              <span className="hidden rounded-lg border border-zinc-300/90 bg-zinc-100 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-zinc-800 shadow-inner sm:inline-flex">
                View only
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 focus-visible:ring-offset-2"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-zinc-200/90 bg-zinc-50/80 px-3 py-2.5 sm:px-6 lg:grid-cols-4 lg:py-3">
          <CaseWorkspaceStat label="Submitted" value={claimItem.submittedAt} />
          <CaseWorkspaceStat label="Incident" value={claimItem.dateOfIncident} />
          <CaseWorkspaceStat label="Quote" value={quoteSummary} tone={quotePrice != null || insuranceApprovedPrice != null ? 'good' : 'warn'} />
          <CaseWorkspaceStat label="Payment" value={paymentStatusLabel(paymentStatus)} tone={paymentStatus === 'completed' ? 'good' : 'warn'} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <nav className="shrink-0 border-b border-zinc-200/90 bg-white lg:w-64 lg:border-b-0 lg:border-r lg:px-4 lg:py-3">
            <div className="flex items-center gap-1.5 px-2 py-2.5 lg:block lg:px-0 lg:py-0">
              <button
                type="button"
                onClick={() => scrollTabRail(-1)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm active:scale-95 lg:hidden"
                aria-label="Previous tabs"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2} />
              </button>
              <div ref={tabRailRef} className="scrollbar-none flex min-w-0 flex-1 gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
                {MODAL_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    data-active-tab={tab === item.id ? 'true' : undefined}
                    className={`flex h-10 min-w-[8.5rem] max-w-[11rem] flex-none items-center justify-center gap-2 rounded-xl px-3 text-center text-xs font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 lg:h-auto lg:min-w-0 lg:max-w-none lg:justify-between lg:py-2.5 lg:text-left ${
                      tab === item.id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 lg:bg-transparent'
                    }`}
                  >
                    <span className="truncate">{item.label}</span>
                    {tab === item.id ? <ChevronRight className="hidden h-4 w-4 lg:block" strokeWidth={2} /> : null}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => scrollTabRail(1)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm active:scale-95 lg:hidden"
                aria-label="Next tabs"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </nav>

          <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin bg-zinc-50/70 px-3 py-3 sm:px-6 sm:py-5">
            <div className="mx-auto max-w-6xl">
            {tab === 'submission' && (
              <MemberSubmissionPanel
                claimItem={claimItem}
                readOnly={isModerator}
                onSaveSection={isModerator ? undefined : onSaveMemberSubmission}
              />
            )}

            {tab === 'overview' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Reference codes</h3>
                  <p className="mt-1 text-2xs leading-relaxed text-zinc-500">
                    For this claim only. The member code is the “Claim reference code” from the public portal; the system id is the internal file reference.
                  </p>
                  <dl className="mt-3 divide-y divide-zinc-100">
                    <SummaryItem
                      label="Member portal"
                      value={
                        claimItem.intakeReference ? (
                          <span className="font-mono text-sm font-medium text-zinc-950">{claimItem.intakeReference}</span>
                        ) : (
                          '—'
                        )
                      }
                    />
                    <SummaryItem
                      label="System reference"
                      value={
                        claimItem.reference ? (
                          <span className="font-mono text-sm font-medium text-zinc-950">{claimItem.reference}</span>
                        ) : (
                          '—'
                        )
                      }
                    />
                  </dl>
                </div>
                <div className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Case facts</h3>
                  <dl className="mt-1 divide-y divide-zinc-100">
                    <SummaryItem label="Status" value={claimItem.status} />
                    <SummaryItem label="Submitted" value={claimItem.submittedAt} />
                    <SummaryItem label="Incident date" value={claimItem.dateOfIncident} />
                    <SummaryItem label="Plate" value={claimItem.plateNumber} />
                    <SummaryItem
                      label="PDFs on file"
                      value={caseFiles.length ? `${caseFiles.length} PDF${caseFiles.length === 1 ? '' : 's'}` : undefined}
                    />
                    <SummaryItem
                      label="Quote price (you set)"
                      value={quotePrice != null ? formatAud(quotePrice) : undefined}
                    />
                    <SummaryItem
                      label="Insurance company price"
                      value={insuranceApprovedPrice != null ? formatAud(insuranceApprovedPrice) : undefined}
                    />
                    <SummaryItem label="Payment" value={paymentStatusLabel(paymentStatus)} />
                    <SummaryItem
                      label="Admin note"
                      value={
                        adminNote.trim()
                          ? `${adminNote.trim().slice(0, 140)}${adminNote.trim().length > 140 ? '…' : ''}`
                          : undefined
                      }
                    />
                    <SummaryItem label="Purchase" value={partsSummaryText} />
                  </dl>
                  {!isModerator && (
                    <div className="mt-4 rounded-xl border border-indigo-200/90 bg-indigo-50/70 p-3.5">
                      <p className="text-xs leading-relaxed text-indigo-950">
                        Changes save to Horizon API (insurance quote, purchase lines, notes). Upload PDFs on the insurance quote tab.
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab('quotes')}
                        className="mt-2.5 inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                        Open insurance quote
                      </button>
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Summary</h3>
                  <dl className="mt-1 divide-y divide-zinc-100">
                    {detailFields.map((field) => (
                      <SummaryItem key={field.label} label={field.label} value={field.getter(data)} />
                    ))}
                    <SummaryItem label="Description" value={data.incident?.description || claimItem.summary} />
                  </dl>
                </div>
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold text-zinc-900">Review signals</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <OperationalPill
                      title="Liability"
                      text={
                        data.driver?.admittedLiability || data.driver?.otherDriverAdmittedLiability
                          ? 'Liability indicators were captured in the claim.'
                          : 'No liability admission noted in this record.'
                      }
                    />
                    <OperationalPill
                      title="Damage mapping"
                      text={
                        damageMarkerCount || damageStrokeCount
                          ? `${damageMarkerCount} marker(s) and ${damageStrokeCount} drawing(s) on the vehicle diagram.`
                          : 'No visual damage markers or drawings were placed.'
                      }
                    />
                    <OperationalPill
                      title="Third parties"
                      text={
                        otherParties.length
                          ? `${otherParties.length} other party record(s) attached.`
                          : 'No other party records were attached.'
                      }
                    />
                  </div>
                </div>
                {!isModerator && onRequestDelete ? (
                  <section className="rounded-xl border border-rose-200/90 bg-rose-50/40 p-4 shadow-inner">
                    <h3 className="text-[13px] font-semibold text-rose-950">Danger zone</h3>
                    <p className="mt-1 text-2xs leading-relaxed text-rose-900/80">
                      Permanently remove this claim from the queue. Member submission, admin notes, quotes, purchase
                      lines, and uploaded PDFs will be deleted. This action cannot be undone.
                    </p>
                    <button
                      type="button"
                      onClick={openDeleteDialog}
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-rose-300/90 bg-white px-3 text-2xs font-semibold text-rose-800 shadow-sm transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/80"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      Delete this claim…
                    </button>
                  </section>
                ) : null}
              </div>
            )}

            {tab === 'records' && (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailCard
                    title="Claimant and driver"
                    items={[
                      ['Owner', data.memberVehicle?.ownerName],
                      ['Driver', claimItem.driverName],
                      ['Vehicle', [data.memberVehicle?.make, data.memberVehicle?.model].filter(Boolean).join(' ')],
                      ['Claim type', data.memberVehicle?.claimType],
                    ]}
                  />
                  <DetailCard
                    title="Incident context"
                    items={[
                      ['Street', data.incident?.streetName],
                      ['Suburb', data.incident?.suburb],
                      ['Road surface', data.incident?.roadSurface],
                      ['Traffic controls', data.incident?.trafficControls?.join(', ')],
                    ]}
                  />
                </div>
                <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
                  <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5">
                    <h3 className="text-[13px] font-semibold text-zinc-900">Towing and damage</h3>
                  </div>
                  <dl className="grid gap-0 px-4 sm:grid-cols-2 sm:divide-x sm:divide-zinc-100">
                    <div className="divide-y divide-zinc-100 py-1 sm:pr-4">
                      <SummaryItem label="Claiming damage" value={data.damage?.claimingDamage} />
                      <SummaryItem label="Vehicle towed" value={data.damage?.towed} />
                    </div>
                    <div className="divide-y divide-zinc-100 py-1 sm:pl-4">
                      <SummaryItem
                        label="Damage markings"
                        value={
                          damageMarkerCount || damageStrokeCount
                            ? `${damageMarkerCount} marker(s), ${damageStrokeCount} drawing(s)`
                            : 'None mapped'
                        }
                      />
                      <SummaryItem label="Current vehicle location" value={data.damage?.currentVehicleLocation} />
                    </div>
                  </dl>
                  {towingSummary.length > 0 && (
                    <div className="border-t border-zinc-100 px-4 py-3">
                      <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Handling notes</p>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {towingSummary.map((item) => (
                          <span
                            key={item}
                            className="rounded-lg border border-zinc-200/90 bg-zinc-50 px-2.5 py-1.5 font-mono text-2xs text-zinc-700 shadow-inner"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <DamageDiagramViewer damage={mergedDamage} />
              </div>
            )}

            {tab === 'parties' && (
              <div className="grid gap-4 lg:grid-cols-2">
                <DetailCard
                  title="Witness details"
                  items={[
                    ['Witness 1', witnessDetails.witness1Name],
                    ['Witness 1 mobile', witnessDetails.witness1Mobile],
                    ['Witness 2', witnessDetails.witness2Name],
                    ['Witness 2 mobile', witnessDetails.witness2Mobile],
                  ]}
                />
                <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
                  <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5">
                    <h3 className="text-[13px] font-semibold text-zinc-900">Other parties involved</h3>
                  </div>
                  <div className="p-4">
                    {otherParties.length ? (
                      <ul className="space-y-3">
                        {otherParties.map((party, index) => (
                          <li
                            key={`${party.plateNumber || 'party'}-${index}`}
                            className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 p-3 shadow-inner"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-zinc-900">Vehicle {index + 1}</span>
                              <span className="rounded-lg border border-zinc-200/90 bg-white px-1.5 py-0.5 font-mono text-2xs font-semibold text-zinc-700 shadow-sm">
                                {party.plateNumber || 'No plate'}
                              </span>
                            </div>
                            <dl className="mt-2 space-y-1 text-sm text-zinc-600">
                              <div>
                                <dt className="inline text-2xs font-semibold uppercase text-zinc-500">Driver </dt>
                                <dd className="inline text-zinc-800">{party.driverName || '—'}</dd>
                              </div>
                              <div>
                                <dt className="inline text-2xs font-semibold uppercase text-zinc-500">Vehicle </dt>
                                <dd className="inline">{[party.make, party.model, party.color].filter(Boolean).join(' / ') || '—'}</dd>
                              </div>
                              <div>
                                <dt className="inline text-2xs font-semibold uppercase text-zinc-500">Insurance </dt>
                                <dd className="inline">{party.insuranceCompany || '—'}</dd>
                              </div>
                            </dl>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500 shadow-inner">
                        No other party records were attached to this claim.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'quotes' && (
              <div className="space-y-6">
                <section className="rounded-xl border border-indigo-200/80 bg-indigo-50/20 p-4 shadow-inner sm:p-5">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Pricing</h3>
                  <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                    <span className="font-medium text-zinc-800">Quote price</span> is set by your repair shop.{' '}
                    <span className="font-medium text-zinc-800">Authorized amount</span> is the insurer-approved figure — enter it when you receive approval.
                  </p>
                  {memberRepairQuoteRef ? (
                    <p className="mt-2 text-2xs text-zinc-600">
                      Member repair quote ref:{' '}
                      <span className="font-mono font-medium text-zinc-800">{memberRepairQuoteRef}</span>
                    </p>
                  ) : null}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`quote-price-${claimItem.id}`} className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                        Quote price
                      </label>
                      <p className="mt-0.5 text-2xs text-zinc-500">Set by Horizon Smash Repairs</p>
                      {!isModerator ? (
                        <>
                          <input
                            id={`quote-price-${claimItem.id}`}
                            type="number"
                            min={0}
                            step={0.01}
                            value={priceDraft.quote}
                            onChange={(e) => {
                              setPriceDraft((d) => ({ ...d, quote: e.target.value }));
                              if (quoteSave === 'saved') setQuoteSave('idle');
                              setQuoteSaveKind(null);
                            }}
                            placeholder="0.00"
                            className="mt-1.5 h-10 w-full rounded-lg border border-zinc-200 bg-white px-2.5 font-mono text-sm text-zinc-900 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                          />
                          <p className="mt-1 font-mono text-2xs text-zinc-500">
                            {quotePrice != null
                              ? `Quote price: ${formatAud(quotePrice)}`
                              : priceDraft.quote !== ''
                                ? formatAud(parseMoneyInput(priceDraft.quote) ?? 0)
                                : 'Not set'}
                          </p>
                          <button
                            type="button"
                            onClick={handleSaveQuotePrice}
                            disabled={
                              quoteSave === 'saving' ||
                              parseMoneyInput(priceDraft.quote) == null ||
                              (!isQuotePriceDirty && hasSavedQuotePrice)
                            }
                            className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-indigo-600 px-3 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          >
                            {saveUpdateLabel({
                              hasSaved: hasSavedQuotePrice,
                              busy: quoteSave === 'saving',
                              entity: 'quote price',
                            })}
                          </button>
                          {quoteSave === 'saved' && quotePrice != null && (
                            <p className="mt-1.5 text-2xs font-medium text-emerald-700">
                              {quoteSaveKind === 'updated' ? 'Quote price updated' : 'Quote price saved'} (
                              {formatAud(quotePrice)}).
                            </p>
                          )}
                          {quoteSave === 'error' && (
                            <p className="mt-1.5 text-2xs font-medium text-rose-700">Save failed — try again.</p>
                          )}
                        </>
                      ) : (
                        <p className="mt-1.5 font-mono text-lg font-semibold text-zinc-900">
                          {quotePrice != null ? formatAud(quotePrice) : '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor={`insurance-approved-${claimItem.id}`}
                        className="text-2xs font-semibold uppercase tracking-wider text-zinc-500"
                      >
                        Insurance company price
                      </label>
                      <p className="mt-0.5 text-2xs text-zinc-500">Authorized amount</p>
                      {!isModerator ? (
                        <>
                          <input
                            id={`insurance-approved-${claimItem.id}`}
                            type="number"
                            min={0}
                            step={0.01}
                            value={priceDraft.insurance}
                            onChange={(e) => {
                              setPriceDraft((d) => ({ ...d, insurance: e.target.value }));
                              if (insuranceSave === 'saved') setInsuranceSave('idle');
                              setInsuranceSaveKind(null);
                            }}
                            placeholder="0.00"
                            className="mt-1.5 h-10 w-full rounded-lg border border-zinc-200 bg-white px-2.5 font-mono text-sm text-zinc-900 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                          />
                          <p className="mt-1 font-mono text-2xs text-zinc-500">
                            {insuranceApprovedPrice != null
                              ? `Authorized amount: ${formatAud(insuranceApprovedPrice)}`
                              : priceDraft.insurance !== ''
                                ? formatAud(parseMoneyInput(priceDraft.insurance) ?? 0)
                                : 'Not set'}
                          </p>
                          <button
                            type="button"
                            onClick={handleSaveInsurancePrice}
                            disabled={
                              insuranceSave === 'saving' ||
                              parseMoneyInput(priceDraft.insurance) == null ||
                              (!isInsurancePriceDirty && hasSavedInsurancePrice)
                            }
                            className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-indigo-600 px-3 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          >
                            {saveUpdateLabel({
                              hasSaved: hasSavedInsurancePrice,
                              busy: insuranceSave === 'saving',
                              entity: 'insurance price',
                            })}
                          </button>
                          {insuranceSave === 'saved' && insuranceApprovedPrice != null && (
                            <p className="mt-1.5 text-2xs font-medium text-emerald-700">
                              {insuranceSaveKind === 'updated' ? 'Insurance price updated' : 'Insurance price saved'}{' '}
                              ({formatAud(insuranceApprovedPrice)}).
                            </p>
                          )}
                          {insuranceSave === 'error' && (
                            <p className="mt-1.5 text-2xs font-medium text-rose-700">Save failed — try again.</p>
                          )}
                        </>
                      ) : (
                        <p className="mt-1.5 font-mono text-lg font-semibold text-zinc-900">
                          {insuranceApprovedPrice != null ? formatAud(insuranceApprovedPrice) : '—'}
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[13px] font-semibold text-zinc-900">Case PDFs</h3>
                      <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                        PDFs are uploaded to your Horizon API (<span className="font-semibold">{api.apiBase()}</span>) under
                        <span className="font-mono"> /uploads</span>. Administrators can attach files up to the server limit
                        (defaults to 25&nbsp;MB per file).
                      </p>
                    </div>
                    {!isModerator && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="application/pdf,.pdf"
                          multiple
                          className="sr-only"
                          onChange={handlePdfInput}
                        />
                        <button
                          type="button"
                          disabled={pdfBusy}
                          onClick={() => !pdfBusy && fileInputRef.current?.click()}
                          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-indigo-200/90 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-wait disabled:opacity-70"
                        >
                          <Upload className="h-4 w-4" strokeWidth={2} />
                          {pdfBusy ? (authToken ? 'Uploading…' : 'Reading PDF…') : 'Upload PDF'}
                        </button>
                      </>
                    )}
                  </div>
                  {caseFiles.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                      No PDFs uploaded yet.
                    </p>
                  ) : (
                    <ul className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
                      {caseFiles.map((file) => (
                        <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-3 first:pt-3">
                          <FileText className="h-4 w-4 shrink-0 text-indigo-600" strokeWidth={2} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                            <p className="text-2xs text-zinc-500">
                              {formatFileSize(file.size)} · {file.uploadedAt}
                            </p>
                          </div>
                          <a
                            href={resolveClaimFileHref(file.dataUrl || file.url)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-zinc-200 px-2 py-1 text-2xs font-semibold text-zinc-700 hover:bg-zinc-50"
                          >
                            Open
                          </a>
                          {!isModerator && (
                            <button
                              type="button"
                              disabled={pdfBusy}
                              onClick={() => removePdf(file.id)}
                              className="rounded-lg border border-rose-200/90 p-1.5 text-rose-700 hover:bg-rose-50"
                              aria-label={`Remove ${file.name}`}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[13px] font-semibold text-zinc-900">Repair quotes</h3>
                      <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                        Optional workshop lines. Add notes on each quote for internal context.
                      </p>
                    </div>
                    {!isModerator && (
                      <button
                        type="button"
                        onClick={addQuote}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200/90 bg-indigo-50 px-2.5 text-2xs font-semibold text-indigo-900 hover:bg-indigo-100"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        Add quote
                      </button>
                    )}
                  </div>
                  {quoteOptions.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                      No repair quotes yet. Add a line to compare workshops.
                    </p>
                  ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {quoteOptions.map((q) => (
                        <div
                          key={q.id}
                          className="rounded-xl border border-zinc-200/90 bg-zinc-50/40 px-4 py-4 shadow-inner"
                        >
                          {!isModerator ? (
                            <div className="space-y-3">
                              <input
                                type="text"
                                value={q.supplier}
                                onChange={(e) => patchQuoteFieldDraft(q.id, 'supplier', e.target.value)}
                                aria-label="Workshop or supplier"
                                placeholder="Workshop"
                                className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                                autoComplete="off"
                              />
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={Number.isFinite(q.amount) ? q.amount : 0}
                                onChange={(e) => patchQuoteFieldDraft(q.id, 'amount', e.target.value)}
                                aria-label="Amount in Australian dollars"
                                placeholder="0"
                                className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 font-mono text-sm text-zinc-900 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                              />
                              <p className="font-mono text-2xs text-zinc-500 tabular-nums">{formatAud(q.amount)}</p>
                              <div>
                                <label htmlFor={`quote-notes-${q.id}`} className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                                  Notes
                                </label>
                                <textarea
                                  id={`quote-notes-${q.id}`}
                                  rows={3}
                                  value={q.notes ?? ''}
                                  onChange={(e) => patchQuoteFieldDraft(q.id, 'notes', e.target.value)}
                                  placeholder="e.g. Waiting on insurer, includes OEM parts…"
                                  className="mt-1 w-full resize-y rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-900 shadow-inner outline-none placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p className="font-mono text-xl font-semibold tabular-nums text-zinc-900">
                                {formatAud(q.amount)}
                              </p>
                              <p className="text-sm font-semibold text-zinc-900">{q.supplier}</p>
                              {(q.notes ?? '').trim() ? (
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">{q.notes}</p>
                              ) : null}
                            </div>
                          )}
                        </div>
                    ))}
                  </div>
                  )}
                  {!isModerator && (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={handleSaveRepairQuotes}
                        disabled={repairQuotesSave === 'saving' || (!isRepairQuotesDirty && hasSavedRepairQuotes)}
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-indigo-600 px-4 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saveUpdateLabel({
                          hasSaved: hasSavedRepairQuotes,
                          busy: repairQuotesSave === 'saving',
                          entity: 'repair quotes',
                        })}
                      </button>
                      {repairQuotesSave === 'saved' && (
                        <p className="mt-1.5 text-2xs font-medium text-emerald-700">
                          {repairQuotesSaveKind === 'updated' ? 'Repair quotes updated.' : 'Repair quotes saved.'}
                        </p>
                      )}
                      {repairQuotesSave === 'error' && (
                        <p className="mt-1.5 text-2xs font-medium text-rose-700">Could not save — try again.</p>
                      )}
                      {hasSavedRepairQuotes && !isRepairQuotesDirty && repairQuotesSave !== 'saved' && (
                        <p className="mt-1.5 text-2xs text-zinc-500">Repair quotes are saved. Edit a field to enable Update.</p>
                      )}
                      {isRepairQuotesDirty && repairQuotesSave !== 'saved' && (
                        <p className="mt-1.5 text-2xs text-amber-800">You have unsaved changes.</p>
                      )}
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:p-5">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-700 shadow-inner">
                      <Banknote className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[13px] font-semibold text-zinc-900">Payment status</h3>
                      <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                        Track whether payment for this claim is still pending or marked completed.
                      </p>
                      <div className="mt-3 max-w-xs">
                        <label htmlFor={`pay-status-${claimItem.id}`} className="sr-only">
                          Payment status
                        </label>
                        <select
                          id={`pay-status-${claimItem.id}`}
                          value={paymentStatus}
                          disabled={isModerator}
                          onChange={(e) => {
                            setPaymentStatusDraft(normalizePaymentStatus(e.target.value));
                            if (paymentSave === 'saved') setPaymentSave('idle');
                            setPaymentSaveKind(null);
                          }}
                          className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm font-medium text-zinc-900 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:bg-zinc-100"
                        >
                          {PAYMENT_STATUS_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {!isModerator && (
                        <button
                          type="button"
                          onClick={handleSavePaymentStatus}
                          disabled={paymentSave === 'saving' || !isPaymentDirty}
                          className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-indigo-600 px-4 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {saveUpdateLabel({
                            hasSaved: true,
                            busy: paymentSave === 'saving',
                            entity: 'payment status',
                          })}
                        </button>
                      )}
                      {paymentSave === 'saved' && (
                        <p className="mt-1.5 text-2xs font-medium text-emerald-700">Payment status updated.</p>
                      )}
                      {paymentSave === 'error' && (
                        <p className="mt-1.5 text-2xs font-medium text-rose-700">Could not save — try again.</p>
                      )}
                      {isPaymentDirty && paymentSave !== 'saved' && (
                        <p className="mt-1.5 text-2xs text-amber-800">You have unsaved changes.</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      <PaymentStatusBadge status={paymentStatus} />
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:p-5">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Admin note</h3>
                  <p className="mt-1 text-2xs text-zinc-600">
                    Internal notes visible to administrators and moderators on this case file.
                  </p>
                  <label htmlFor={`admin-note-${claimItem.id}`} className="sr-only">
                    Admin note
                  </label>
                  <textarea
                    id={`admin-note-${claimItem.id}`}
                    rows={5}
                    value={isModerator ? adminNote : adminNoteDraft}
                    readOnly={isModerator}
                    onChange={(e) => {
                      if (isModerator) return;
                      setAdminNoteDraft(e.target.value);
                      if (adminNoteSave === 'saved') setAdminNoteSave('idle');
                      setAdminNoteSaveKind(null);
                    }}
                    placeholder="e.g. Called member — awaiting bank details."
                    className="mt-3 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-inner outline-none placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 read-only:bg-zinc-50 read-only:text-zinc-700"
                  />
                  {!isModerator && (
                    <>
                      <button
                        type="button"
                        onClick={handleSaveAdminNote}
                        disabled={
                          adminNoteSave === 'saving' ||
                          !adminNoteDraft.trim() ||
                          (!isAdminNoteDirty && hasSavedAdminNote)
                        }
                        className="mt-3 inline-flex h-9 items-center justify-center rounded-lg bg-indigo-600 px-4 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saveUpdateLabel({
                          hasSaved: hasSavedAdminNote,
                          busy: adminNoteSave === 'saving',
                          entity: 'admin note',
                        })}
                      </button>
                      {adminNoteSave === 'saved' && (
                        <p className="mt-1.5 text-2xs font-medium text-emerald-700">
                          {adminNoteSaveKind === 'updated' ? 'Admin note updated.' : 'Admin note saved.'}
                        </p>
                      )}
                      {adminNoteSave === 'error' && (
                        <p className="mt-1.5 text-2xs font-medium text-rose-700">Could not save — try again.</p>
                      )}
                      {hasSavedAdminNote && !isAdminNoteDirty && adminNoteSave !== 'saved' && (
                        <p className="mt-1.5 text-2xs text-zinc-500">Note is saved. Edit the text above to enable Update.</p>
                      )}
                      {hasSavedAdminNote && isAdminNoteDirty && adminNoteSave !== 'saved' && (
                        <p className="mt-1.5 text-2xs text-amber-800">You have unsaved changes.</p>
                      )}
                    </>
                  )}
                </section>
              </div>
            )}

            {tab === 'payments' && (
              <div className="space-y-6">
                <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-700 shadow-inner">
                        <Package className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <div>
                        <h3 className="text-[13px] font-semibold text-zinc-900">Purchase</h3>
                        <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                          Supplier, part details, dates, invoice upload (PDF), and line status. Save purchase lines when finished.
                        </p>
                      </div>
                    </div>
                    {!isModerator && (
                      <button
                        type="button"
                        onClick={addPart}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200/90 bg-indigo-50 px-2.5 text-2xs font-semibold text-indigo-900 hover:bg-indigo-100"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        Add part line
                      </button>
                    )}
                  </div>

                  {parts.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                      No part lines yet.
                      {!isModerator && ' Use Add part line to create a row.'}
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {parts.map((p, index) => (
                        <div
                          key={p.id}
                          className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm"
                        >
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                              Purchase line {index + 1}
                            </p>
                            {!isModerator && (
                              <button
                                type="button"
                                onClick={() => removePart(p.id)}
                                className="rounded-lg border border-rose-200/90 p-1.5 text-rose-700 hover:bg-rose-50"
                                aria-label="Remove purchase line"
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={2} />
                              </button>
                            )}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <PurchaseField label="Supplier name">
                              {!isModerator ? (
                                <input
                                  type="text"
                                  value={p.company}
                                  onChange={(e) => updatePartDraft(p.id, 'company', e.target.value)}
                                  className={purchaseInputClass}
                                  placeholder="Supplier name"
                                />
                              ) : (
                                <span className="text-sm text-zinc-900">{p.company || '—'}</span>
                              )}
                            </PurchaseField>
                            <PurchaseField label="Parts name">
                              {!isModerator ? (
                                <input
                                  type="text"
                                  value={p.partName ?? ''}
                                  onChange={(e) => updatePartDraft(p.id, 'partName', e.target.value)}
                                  className={purchaseInputClass}
                                  placeholder="Parts name"
                                />
                              ) : (
                                <span className="text-sm text-zinc-900">{p.partName || '—'}</span>
                              )}
                            </PurchaseField>
                            <PurchaseField label="Amount (AUD)">
                              {!isModerator ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={partAmountInputValue(p.amount)}
                                  onChange={(e) => updatePartDraft(p.id, 'amount', e.target.value)}
                                  placeholder="0.00"
                                  className={`${purchaseInputClass} font-mono`}
                                />
                              ) : (
                                <span className="font-mono text-sm text-zinc-900">
                                  {formatAud(partAmountNumber(p.amount))}
                                </span>
                              )}
                            </PurchaseField>
                            <PurchaseField label="Quote price (AUD)">
                              {!isModerator ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={partAmountInputValue(p.quotePrice)}
                                  onChange={(e) => updatePartDraft(p.id, 'quotePrice', e.target.value)}
                                  placeholder="Manual quote"
                                  className={`${purchaseInputClass} font-mono`}
                                />
                              ) : (
                                <span className="font-mono text-sm text-zinc-900">
                                  {partOptionalMoneyNumber(p.quotePrice) == null
                                    ? '—'
                                    : formatAud(partOptionalMoneyNumber(p.quotePrice))}
                                </span>
                              )}
                              {partOptionalMoneyNumber(p.quotePrice) != null ? (
                                <p className="mt-1 text-2xs text-zinc-500">
                                  Difference: {formatAud(partAmountNumber(p.amount) - partOptionalMoneyNumber(p.quotePrice))}
                                </p>
                              ) : null}
                            </PurchaseField>
                            <PurchaseField label="Order date">
                              {!isModerator ? (
                                <input
                                  type="date"
                                  value={p.orderDate ?? ''}
                                  onChange={(e) => updatePartDraft(p.id, 'orderDate', e.target.value)}
                                  className={purchaseInputClass}
                                />
                              ) : (
                                <span className="text-sm text-zinc-900">{p.orderDate || '—'}</span>
                              )}
                            </PurchaseField>
                            <PurchaseField label="Tentative received date">
                              {!isModerator ? (
                                <input
                                  type="date"
                                  value={p.tentativeReceivedDate ?? ''}
                                  onChange={(e) =>
                                    updatePartDraft(p.id, 'tentativeReceivedDate', e.target.value)
                                  }
                                  className={purchaseInputClass}
                                />
                              ) : (
                                <span className="text-sm text-zinc-900">{p.tentativeReceivedDate || '—'}</span>
                              )}
                            </PurchaseField>
                            <PurchaseField label="Received by">
                              {!isModerator ? (
                                <input
                                  type="text"
                                  value={p.receivedBy ?? ''}
                                  onChange={(e) => updatePartDraft(p.id, 'receivedBy', e.target.value)}
                                  className={purchaseInputClass}
                                  placeholder="Name"
                                />
                              ) : (
                                <span className="text-sm text-zinc-900">{p.receivedBy || '—'}</span>
                              )}
                            </PurchaseField>
                            <PurchaseField label="Line status">
                              {!isModerator ? (
                                <select
                                  value={p.status === 'completed' ? 'completed' : 'pending'}
                                  onChange={(e) => updatePartDraft(p.id, 'status', e.target.value)}
                                  className={purchaseInputClass}
                                >
                                  {PART_STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.id} value={opt.id}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <PartStatusBadge status={p.status} />
                              )}
                            </PurchaseField>
                          </div>
                          <PurchaseInvoicesSection
                            part={p}
                            isModerator={isModerator}
                            partNextInvoiceNumber={partNextInvoiceNumber[p.id] ?? ''}
                            onNextInvoiceNumberChange={(value) =>
                              setPartNextInvoiceNumber((prev) => ({ ...prev, [p.id]: value }))
                            }
                            partInvoiceBusyId={partInvoiceBusyId}
                            onUpload={(e) => handlePartInvoiceUpload(p.id, e)}
                            onInvoiceNumberChange={(invoiceId, value) =>
                              updatePartInvoiceNumber(p.id, invoiceId, value)
                            }
                            onRemoveInvoice={(invoiceId) => removePartInvoice(p.id, invoiceId)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {!isModerator && (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={handleSaveParts}
                        disabled={partsSave === 'saving' || (!isPartsDirty && hasSavedParts)}
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-indigo-600 px-4 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saveUpdateLabel({
                          hasSaved: hasSavedParts,
                          busy: partsSave === 'saving',
                          entity: 'purchase lines',
                        })}
                      </button>
                      {partsSave === 'saved' && (
                        <p className="mt-1.5 text-2xs font-medium text-emerald-700">
                          {partsSaveKind === 'updated' ? 'Purchase lines updated.' : 'Purchase lines saved.'}
                        </p>
                      )}
                      {partsSave === 'error' && (
                        <p className="mt-1.5 text-2xs font-medium text-rose-700">Could not save — try again.</p>
                      )}
                      {hasSavedParts && !isPartsDirty && partsSave !== 'saved' && (
                        <p className="mt-1.5 text-2xs text-zinc-500">Purchase lines are saved. Edit a field to enable Update.</p>
                      )}
                      {isPartsDirty && partsSave !== 'saved' && (
                        <p className="mt-1.5 text-2xs text-amber-800">You have unsaved changes.</p>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
          </main>

          <aside className="hidden shrink-0 border-t border-zinc-200/90 bg-white px-4 py-4 lg:block lg:w-80 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:px-5">
            <div className="space-y-4">
              <section className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-3.5 shadow-inner">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Case snapshot</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-950">{claimRef(claimItem)}</p>
                  </div>
                  <StatusBadge status={claimItem.status} />
                </div>
                <div className="mt-3 divide-y divide-zinc-100">
                  <CaseWorkspaceAsideRow label="Plate" value={claimItem.plateNumber} />
                  <CaseWorkspaceAsideRow label="Driver" value={claimItem.driverName} />
                  <CaseWorkspaceAsideRow label="Incident" value={claimItem.dateOfIncident} />
                  <CaseWorkspaceAsideRow label="PDFs" value={caseFiles.length ? `${caseFiles.length} file(s)` : 'None'} />
                  <CaseWorkspaceAsideRow label="Purchase" value={partsSummaryText || 'No lines'} />
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200/90 bg-white p-3.5 shadow-inner">
                <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Financials</p>
                <div className="mt-3 grid gap-2">
                  <CaseWorkspaceStat label="Repair quote" value={quotePrice != null ? formatAud(quotePrice) : 'Not set'} tone={quotePrice != null ? 'good' : 'warn'} />
                  <CaseWorkspaceStat label="Insurance approved" value={insuranceApprovedPrice != null ? formatAud(insuranceApprovedPrice) : 'Not set'} tone={insuranceApprovedPrice != null ? 'good' : 'warn'} />
                  <CaseWorkspaceStat label="Payment" value={paymentStatusLabel(paymentStatus)} tone={paymentStatus === 'completed' ? 'good' : 'warn'} />
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200/90 bg-white p-3.5 shadow-inner">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Admin note</p>
                  {!isModerator ? (
                    <button
                      type="button"
                      onClick={() => setTab('quotes')}
                      className="text-2xs font-semibold text-indigo-700 hover:text-indigo-900"
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-700">{sidebarNote}</p>
              </section>

              {!isModerator ? (
                <section className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-3.5 shadow-inner">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Quick actions</p>
                  <div className="mt-3 grid gap-2">
                    <button
                      type="button"
                      onClick={onExport}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-zinc-200/90 bg-white px-3 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50"
                    >
                      <Download className="h-3.5 w-3.5" strokeWidth={2} />
                      Export PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab('submission')}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 transition hover:bg-indigo-100"
                    >
                      Review submission
                    </button>
                    {onRequestDelete ? (
                      <button
                        type="button"
                        onClick={openDeleteDialog}
                        className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-800 transition hover:bg-rose-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                        Delete claim
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          </aside>
        </div>

          {isModerator ? (
            <div className="flex shrink-0 flex-col gap-3 border-t border-zinc-200/90 bg-zinc-50/95 px-4 py-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-2xs leading-relaxed text-zinc-600 sm:max-w-xl sm:text-xs">
                This case file is read-only. You can read every tab and field shown to administrators; you cannot change
                status, request documents, export, upload PDFs, set primary or final quotes, payment status, admin notes,
                purchase lines, or otherwise modify the record from this role.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="h-10 shrink-0 rounded-xl border border-zinc-300/90 bg-white px-4 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
              >
                Close case file
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 flex-col gap-2 border-t border-zinc-200/90 bg-white/95 px-3 py-2.5 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.08)] backdrop-blur-md sm:px-6 sm:py-3">
              <div className="hidden flex-col gap-2 sm:flex sm:flex-row sm:items-center sm:justify-between">
                {onRequestDelete ? (
                  <button
                    type="button"
                    onClick={openDeleteDialog}
                    className="inline-flex h-9 items-center gap-1.5 self-start rounded-lg border border-rose-200/90 bg-rose-50 px-3 text-2xs font-semibold text-rose-800 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/80"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    Delete claim
                  </button>
                ) : (
                  <span className="hidden sm:block" aria-hidden />
                )}
                <p className="text-2xs text-zinc-500 sm:max-w-sm sm:text-right">
                  Use Save or Update on each section (insurance quote, purchase, admin note) to persist changes.
                </p>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
                <button
                  type="button"
                  onClick={onExport}
                  className="inline-flex h-10 min-w-[8rem] flex-none items-center justify-center gap-1.5 rounded-xl border border-zinc-200/90 bg-white px-3 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={2} />
                  Export PDF
                </button>
                {isPendingReview ? (
                  <>
                    <button
                      type="button"
                      onClick={onReject}
                      className="h-10 min-w-[6.5rem] flex-none rounded-xl border border-rose-200/90 bg-rose-50 px-3 text-xs font-semibold text-rose-900 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/80"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={onLitigation}
                      className="h-10 min-w-[7.25rem] flex-none rounded-xl border border-violet-200/90 bg-violet-50 px-3 text-xs font-semibold text-violet-900 transition hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/80"
                    >
                      Litigation
                    </button>
                    <button
                      type="button"
                      onClick={onRecovery}
                      className="h-10 min-w-[7rem] flex-none rounded-xl border border-sky-200/90 bg-sky-50 px-3 text-xs font-semibold text-sky-900 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80"
                    >
                      Recovery
                    </button>
                    <button
                      type="button"
                      onClick={onApprove}
                      className="h-10 min-w-[8rem] flex-none rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-md shadow-emerald-900/10 transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/80"
                    >
                      Approve claim
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={onReopen}
                      className="h-10 min-w-[12rem] flex-none rounded-xl border border-zinc-300/90 bg-zinc-100 px-3 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
                    >
                      Return to pending review
                    </button>
                    {claimStatus !== 'Litigation' && (
                      <button
                        type="button"
                        onClick={onLitigation}
                        className="h-10 min-w-[7.25rem] flex-none rounded-xl border border-violet-200/90 bg-violet-50 px-3 text-xs font-semibold text-violet-900 transition hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/80"
                      >
                        Litigation
                      </button>
                    )}
                    {claimStatus !== 'Recovery' && (
                      <button
                        type="button"
                        onClick={onRecovery}
                        className="h-10 min-w-[7rem] flex-none rounded-xl border border-sky-200/90 bg-sky-50 px-3 text-xs font-semibold text-sky-900 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80"
                      >
                        Recovery
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

export default App;
