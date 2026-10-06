import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  FileCheck2,
  FileSearch,
  FileText,
  Gavel,
  Inbox,
  Landmark,
  ListFilter,
  LogOut,
  Package,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  CalendarDays,
  Check,
  Upload,
  UserCircle,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';

import * as api from './api.js';
import {
  canManageAttendance,
  canAccessSettings,
  canManageHr,
  canManagePartsCrud,
  canViewParts,
  canWriteClaims,
  isKnownStaffRole,
  ROLE_OPTIONS,
  sidebarRoleLabel,
} from './auth/roles.js';
import { AttendancePanel } from './AttendancePanel.jsx';
import { EmployeesPanel } from './EmployeesPanel.jsx';
import { SalariesPanel } from './SalariesPanel.jsx';
import { SettingsPanel } from './settings/SettingsPanel.jsx';
import { PartsManagementPanel } from './parts/PartsManagementPanel.jsx';
import { PartLineFields } from './parts/PartLineFields.jsx';
import {
  applyPartSuggestion,
  catalogLinkSnapshot,
  updatePartInList,
} from './parts/partsInvoiceHelpers.js';
import {
  applySharedContextToPart,
  cloneParts,
  extractPartSharedContext,
  newPartInvoiceId,
  newPartLine,
  normalizePartInvoicesFromRow,
  normalizePartRow,
  partsEqual,
  partsSnapshot,
  purchaseInputClass,
} from './parts/partUtils.js';
import { DamageDiagramViewer } from './DamageDiagramViewer.jsx';
import { AttachmentPreview, SubmissionImage, MemberSubmissionPanel } from './MemberSubmissionPanel.jsx';
import { buildClaimExportHtml, openClaimExportPrint } from './claimExportHtml.js';
import { BuyerPdfClaimModal } from './BuyerPdfClaimModal.jsx';
import {
  mergeAttachmentLists,
  resolveChecklistFlag,
  resolveDamageDiagramFromDamage,
  submissionSource,
} from './memberSubmissionUtils.js';
import { alertError, alertWarning, confirmDialog, confirmDelete } from './swal.js';

/** Payment status is only `pending` or `completed`; maps legacy stored values. */
function normalizePaymentStatus(raw) {
  const s = String(raw ?? '').trim();
  if (s === 'completed') return 'completed';
  if (s === 'payment' || s === 'received' || s === 'approved') return 'completed';
  return 'pending';
}

const resolveClaimFileHref = api.resolveClaimFileHref;

const detailFields = [
  { label: 'Owner', getter: (data) => data.memberVehicle?.ownerName },
  { label: 'Vehicle', getter: (data) => [data.memberVehicle?.make, data.memberVehicle?.model].filter(Boolean).join(' ') },
  { label: 'Suburb', getter: (data) => data.incident?.suburb },
  { label: 'Road Surface', getter: (data) => data.incident?.roadSurface },
  { label: 'Other Parties', getter: (data) => (data.otherParties?.length ?? 0).toString() },
];

const CLAIM_STATUSES = ['Pending Review', 'Approved', 'Rejected', 'Litigation', 'Recovery', 'Completed', 'Rental'];
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
  { id: 'overview', label: 'Summary' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'submission', label: 'Member submission' },
  { id: 'documents', label: 'Checklist' },
  { id: 'quotes', label: 'Insurance quote' },
  { id: 'parts', label: 'Parts' },
  { id: 'claimFormPdf', label: 'Claim form PDF' },
];

function newQuoteLine() {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, supplier: '', amount: 0, reference: '', notes: '', fileId: null, fileName: '', fileUrl: '' };
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

function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.email || !data?.token || !isKnownStaffRole(data.role)) return null;
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

function CopyTextButton({ text, title }) {
  const [copied, setCopied] = useState(false);
  const value = String(text ?? '').trim();
  const onCopy = useCallback(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } finally {
          document.body.removeChild(ta);
        }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    },
    [value]
  );
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex shrink-0 rounded-md p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      title={copied ? 'Copied' : title}
      aria-label={title}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" strokeWidth={2.5} /> : <Copy className="h-3 w-3" strokeWidth={2} />}
    </button>
  );
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

function caseFilePdfDownloadName(name) {
  const base = String(name || 'document').trim() || 'document';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

function CasePdfFileActions({ file }) {
  const href = resolveClaimFileHref(file?.dataUrl || file?.url);
  if (!href) return null;
  const downloadName = caseFilePdfDownloadName(file?.name);
  const linkClass =
    'rounded-lg border border-zinc-200 px-2 py-1 text-2xs font-semibold text-zinc-700 hover:bg-zinc-50';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
        Open
      </a>
      <a href={href} download={downloadName} className={`inline-flex items-center gap-1 ${linkClass}`}>
        <Download className="h-3 w-3" strokeWidth={2} aria-hidden />
        Download
      </a>
    </div>
  );
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

function quoteOptionsSnapshot(options) {
  return cloneQuoteOptions(options)
    .map((q) => ({
      id: String(q.id || ''),
      supplier: String(q.supplier ?? ''),
      amount: Number(q.amount) || 0,
      reference: String(q.reference ?? ''),
      notes: String(q.notes ?? ''),
      fileId: q.fileId == null || q.fileId === '' ? null : String(q.fileId),
      fileName: String(q.fileName ?? ''),
      fileUrl: String(q.fileUrl ?? ''),
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

function yesish(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  return raw === true || ['yes', 'y', 'true', '1', 'selected'].includes(s);
}

function hasValue(raw) {
  if (raw == null) return false;
  if (Array.isArray(raw)) return raw.length > 0;
  if (typeof raw === 'object') return Object.values(raw).some(hasValue);
  return String(raw).trim().length > 0;
}

function claimDocumentChecklist(item) {
  const { payload, data, src, submission } = submissionSource(item);
  const checklist = { ...(submission.checklist || {}), ...(src.checklist || {}) };
  const damage = { ...(data.damage || {}), ...(payload?.damage || {}) };
  const diagram = damage.diagram || {};
  const damageResolved = resolveDamageDiagramFromDamage(damage);
  const licenseFront = mergeAttachmentLists(src.driverLicenseFrontAttachments, submission.driverLicenseFrontAttachments);
  const licenseBack = mergeAttachmentLists(src.driverLicenseBackAttachments, submission.driverLicenseBackAttachments);
  const taxiAuthority = mergeAttachmentLists(src.taxiAuthorityAttachments, submission.taxiAuthorityAttachments);
  const registration = mergeAttachmentLists(src.registrationAttachments, submission.registrationAttachments);
  const scenePhotos = mergeAttachmentLists(diagram.scenePhotos);
  const detailPhotos = mergeAttachmentLists(diagram.detailPhotos);
  const sketchUploads = mergeAttachmentLists(src.accidentSketch?.attachments);
  const policeReported = yesish(data.driver?.policeReported || src.driver?.policeReported);
  const signatureDataUrl = src.declaration?.signatureDataUrl || data.declaration?.signatureDataUrl;
  const sketchImage = src.accidentSketch?.diagramDataUrl;

  const rows = [
    {
      id: 'license',
      label: 'Driver licence',
      required: true,
      complete: licenseFront.length > 0 && licenseBack.length > 0,
      detail: [licenseFront.length ? 'front' : '', licenseBack.length ? 'back' : ''].filter(Boolean).join(' + '),
    },
    {
      id: 'registration',
      label: 'Registration',
      required: true,
      complete: registration.length > 0,
      detail: registration.length ? `${registration.length} file(s)` : '',
    },
    {
      id: 'damagePhotos',
      label: 'Damage photos',
      required: true,
      complete: scenePhotos.length > 0 || detailPhotos.length > 0,
      detail: scenePhotos.length || detailPhotos.length ? `${scenePhotos.length + detailPhotos.length} photo(s)` : '',
    },
    {
      id: 'damageMap',
      label: 'Damage diagram',
      required: true,
      complete: damageResolved.markers.length > 0 || damageResolved.strokes.length > 0,
      detail:
        damageResolved.markers.length || damageResolved.strokes.length
          ? `${damageResolved.markers.length} marker(s), ${damageResolved.strokes.length} drawing(s)`
          : '',
    },
    {
      id: 'signature',
      label: 'Declaration signature',
      required: true,
      complete: typeof signatureDataUrl === 'string' && signatureDataUrl.startsWith('data:image/'),
      detail: signatureDataUrl ? 'signed' : '',
    },
    {
      id: 'policeReport',
      label: 'Police report',
      required: policeReported,
      complete: !policeReported || resolveChecklistFlag(checklist, 'policeReport'),
      detail: policeReported ? 'reported to police' : 'not required',
    },
    {
      id: 'taxiAuthority',
      label: 'Taxi authority',
      required: resolveChecklistFlag(checklist, 'taxiAuthority', [taxiAuthority]),
      complete: !resolveChecklistFlag(checklist, 'taxiAuthority', [taxiAuthority]) || taxiAuthority.length > 0,
      detail: taxiAuthority.length ? `${taxiAuthority.length} file(s)` : '',
    },
    {
      id: 'accidentSketch',
      label: 'Accident sketch',
      required: false,
      complete: Boolean(sketchImage || sketchUploads.length),
      detail: sketchImage ? 'drawing attached' : sketchUploads.length ? `${sketchUploads.length} upload(s)` : 'optional',
    },
  ];

  return rows.map((row) => ({
    ...row,
    missing: row.required && !row.complete,
  }));
}

function claimEvidenceGroups(item) {
  const { payload, data, src, submission } = submissionSource(item);
  const damage = { ...(data.damage || {}), ...(payload?.damage || {}) };
  const diagram = damage.diagram || {};
  const parties = src.otherParties || data.otherParties || [];
  const groups = [];

  const pushFiles = (id, title, files, category = 'other') => {
    const list = mergeAttachmentLists(files);
    if (list.length) groups.push({ id, title, type: 'files', files: list, category });
  };
  const pushImage = (id, title, srcValue, category = 'other') => {
    if (typeof srcValue === 'string' && srcValue.trim()) {
      groups.push({ id, title, type: 'image', src: srcValue, category });
    }
  };

  pushFiles('driver-license-front', 'Driver licence - front', mergeAttachmentLists(src.driverLicenseFrontAttachments, submission.driverLicenseFrontAttachments), 'licence');
  pushFiles('driver-license-back', 'Driver licence - back', mergeAttachmentLists(src.driverLicenseBackAttachments, submission.driverLicenseBackAttachments), 'licence');
  pushFiles('registration', 'Registration', mergeAttachmentLists(src.registrationAttachments, submission.registrationAttachments), 'vehicle');
  pushFiles('taxi-authority', 'Taxi authority', mergeAttachmentLists(src.taxiAuthorityAttachments, submission.taxiAuthorityAttachments), 'vehicle');
  pushFiles('police-report', 'Police report', mergeAttachmentLists(src.policeReportAttachments, submission.policeReportAttachments), 'documents');
  pushImage('accident-sketch', 'Accident sketch', src.accidentSketch?.diagramDataUrl, 'sketch');
  pushFiles('sketch-uploads', 'Accident sketch uploads', mergeAttachmentLists(src.accidentSketch?.attachments), 'sketch');
  pushFiles('damage-scene', 'Damage scene photos', mergeAttachmentLists(diagram.scenePhotos), 'damage');
  pushFiles('damage-detail', 'Damage close-up photos', mergeAttachmentLists(diagram.detailPhotos), 'damage');
  pushFiles('other-demand', 'Other party demand', mergeAttachmentLists(src.otherDemandAttachments, submission.otherDemandAttachments), 'parties');
  pushFiles('repair-quote', 'Repair quote files', mergeAttachmentLists(src.repairQuoteAttachments, submission.repairQuoteAttachments), 'documents');

  parties.forEach((party, index) => {
    pushFiles(`party-${index}-front`, `Other party ${index + 1} licence - front`, mergeAttachmentLists(party.licenceFrontAttachments), 'parties');
    pushFiles(`party-${index}-back`, `Other party ${index + 1} licence - back`, mergeAttachmentLists(party.licenceBackAttachments), 'parties');
  });

  pushImage('signature', 'Declaration signature', src.declaration?.signatureDataUrl || data.declaration?.signatureDataUrl, 'signature');
  return groups;
}

function EvidenceWorkspace({ groups, onOpenSubmission }) {
  const total = groups.reduce((sum, group) => sum + (group.type === 'files' ? group.files.length : 1), 0);
  const [activeCategory, setActiveCategory] = useState('all');
  const evidenceItems = groups.flatMap((group) =>
    group.type === 'image'
      ? [{ id: group.id, type: 'image', title: group.title, category: group.category || 'other', src: group.src }]
      : group.files.map((file, index) => ({
          id: `${group.id}-${file.id || file.name || index}`,
          type: 'file',
          title: group.title,
          category: group.category || 'other',
          file,
          index,
        })),
  );
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'licence', label: 'Licence' },
    { id: 'vehicle', label: 'Vehicle docs' },
    { id: 'damage', label: 'Damage' },
    { id: 'sketch', label: 'Sketch' },
    { id: 'documents', label: 'Documents' },
    { id: 'parties', label: 'Parties' },
    { id: 'signature', label: 'Signature' },
  ]
    .map((filter) => ({
      ...filter,
      count:
        filter.id === 'all'
          ? evidenceItems.length
          : evidenceItems.filter((item) => item.category === filter.id).length,
    }))
    .filter((filter) => filter.id === 'all' || filter.count > 0);
  const visibleItems =
    activeCategory === 'all'
      ? evidenceItems
      : evidenceItems.filter((item) => item.category === activeCategory);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-zinc-900">Evidence gallery</h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-600">
              Member-submitted images and files are arranged as a scan-friendly evidence board.
            </p>
          </div>
          <span className="inline-flex w-fit rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-zinc-600">
            {total} item{total === 1 ? '' : 's'}
          </span>
        </div>
        {filters.length > 1 ? (
          <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
            {filters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setActiveCategory(filter.id)}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-2xs font-semibold transition ${
                  activeCategory === filter.id
                    ? 'border-zinc-950 bg-zinc-950 text-white'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                {filter.label}
                <span className={`font-mono tabular-nums ${activeCategory === filter.id ? 'text-white/75' : 'text-zinc-500'}`}>
                  {filter.count}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {visibleItems.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleItems.map((item) => (
            <div key={item.id} className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="min-w-0 truncate text-[13px] font-semibold text-zinc-900">{item.title}</h4>
                <span className="shrink-0 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  {filters.find((filter) => filter.id === item.category)?.label || 'File'}
                </span>
              </div>
              {item.type === 'image' ? (
                <SubmissionImage label={item.title} src={item.src} />
              ) : (
                <AttachmentPreview file={item.file} index={item.index} groupTitle={item.title} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <section className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-10 text-center shadow-inner">
          <p className="text-sm font-semibold text-zinc-900">No evidence files found</p>
          <p className="mt-1 text-sm text-zinc-600">Review the member submission if this claim should include uploaded evidence.</p>
          <button
            type="button"
            onClick={onOpenSubmission}
            className="mt-4 inline-flex h-9 items-center rounded-lg bg-indigo-600 px-3 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Open member submission
          </button>
        </section>
      )}
    </div>
  );
}

function buildClaimSignals(item) {
  const { data, src } = submissionSource(item);
  const documents = claimDocumentChecklist(item);
  const missingDocs = documents.filter((row) => row.missing);
  const risks = [];
  const actions = [];
  const paymentStatus = normalizePaymentStatus(item?.paymentStatus);
  const otherParties = Array.isArray(src.otherParties) ? src.otherParties : Array.isArray(data.otherParties) ? data.otherParties : [];
  const witnesses = data.witnessDetails || {};

  if (otherParties.length > 0) risks.push(`${otherParties.length} other party${otherParties.length === 1 ? '' : 'ies'}`);
  if (yesish(data.driver?.admittedLiability || src.driver?.admittedLiability)) risks.push('Driver admitted liability');
  if (yesish(data.driver?.otherDriverAdmittedLiability || src.driver?.otherDriverAdmittedLiability)) risks.push('Other driver admitted liability');
  if (yesish(data.driver?.policeReported || src.driver?.policeReported)) risks.push('Police reported');
  if (yesish(data.damage?.towed || src.damage?.towed)) risks.push('Vehicle towed');
  if (hasValue(witnesses)) risks.push('Witness recorded');

  if (missingDocs.length) actions.push(`Request ${missingDocs[0].label.toLowerCase()}`);
  if (item?.status === 'Pending Review' && !missingDocs.length) actions.push('Review and set disposition');
  if (item?.quotePrice == null) actions.push('Set repair quote');
  if (item?.insuranceApprovedPrice == null) actions.push('Record insurer amount');
  if (paymentStatus === 'pending') actions.push('Confirm payment');

  const attentionLevel =
    missingDocs.length > 0 || risks.length > 2
      ? 'high'
      : actions.length > 0 || risks.length > 0
        ? 'medium'
        : 'low';

  return {
    documents,
    missingDocs,
    risks,
    actions,
    nextAction: actions[0] || 'No immediate action',
    attentionLevel,
  };
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
            Sign in to the operations console. Administrator and super administrator roles have full workspace access.
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
                Super admin: <span className="text-zinc-400">superadmin@horizon.smash</span> ·{' '}
                <span className="text-zinc-400">super123</span>
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
  const [claimModalInitialTab, setClaimModalInitialTab] = useState('overview');
  const [pendingDeleteClaim, setPendingDeleteClaim] = useState(null);
  const [claimDeleteBusy, setClaimDeleteBusy] = useState(false);
  const [claimDeleteError, setClaimDeleteError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [workspaceSave, setWorkspaceSave] = useState('idle');
  const [buyerPdfModalOpen, setBuyerPdfModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalClaims, setTotalClaims] = useState(0);
  const [statusTotals, setStatusTotals] = useState({});
  const [activeWorkspace, setActiveWorkspace] = useState('claims');
  const PAGE_SIZE = 20;

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
    setActiveWorkspace('claims');
  }, []);

  useEffect(() => {
    if (!session) return;
    const allowed = ['claims'];
    if (canManageAttendance(session.role)) allowed.push('attendance');
    if (canViewParts(session.role)) allowed.push('parts');
    if (canManageHr(session.role)) allowed.push('employees', 'salaries');
    if (canAccessSettings(session.role)) allowed.push('settings');
    if (!allowed.includes(activeWorkspace)) {
      setActiveWorkspace('claims');
    }
  }, [session, activeWorkspace]);

  const loadClaims = useCallback(
    async (token, { status = statusFilter, q = searchTerm, page = currentPage } = {}) => {
      return api.listClaims(token, {
        status,
        q: String(q || '').trim() || undefined,
        page,
        limit: PAGE_SIZE,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusFilter, searchTerm, currentPage]
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
      if (!session?.token || !canWriteClaims(session.role) || !body) return;
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
      if (!session?.token || !canWriteClaims(session.role)) return;
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
      if (!claimId || !session?.token || !canWriteClaims(session.role)) return;
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
      if (!session?.token || !canWriteClaims(session.role) || !selectedClaim) {
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
      if (!session?.token || !canWriteClaims(session.role) || !selectedClaim) {
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
      if (!session?.token || !canWriteClaims(session.role) || !selectedClaim) {
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
      if (!session?.token || !canWriteClaims(session.role) || !selectedClaim) {
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
      if (!session?.token || !canWriteClaims(session.role) || !selectedClaim) {
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
      if (!session?.token || !canWriteClaims(session.role) || !selectedClaim) {
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
      if (!session?.token || !canWriteClaims(session.role)) {
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
        const result = await loadClaims(session.token);
        if (!cancelled) {
          setClaims(result.claims);
          setTotalClaims(result.total);
          setTotalPages(result.totalPages);
          setStatusTotals(result.statusTotals);
        }
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
  }, [session?.token, statusFilter, searchTerm, currentPage, loadClaims, logout]);

  useEffect(() => {
    if (!session?.token) return;
    const onFocus = () => {
      loadClaims(session.token)
        .then((result) => {
          setClaims(result.claims);
          setTotalClaims(result.total);
          setTotalPages(result.totalPages);
          setStatusTotals(result.statusTotals);
        })
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
    const t = statusTotals;
    return {
      total: (t['Pending Review'] ?? 0) + (t['Approved'] ?? 0) + (t['Rejected'] ?? 0) + (t['Litigation'] ?? 0) + (t['Recovery'] ?? 0) + (t['Completed'] ?? 0) + (t['Rental'] ?? 0),
      pending: t['Pending Review'] ?? 0,
      approved: t['Approved'] ?? 0,
      rejected: t['Rejected'] ?? 0,
      litigation: t['Litigation'] ?? 0,
      recovery: t['Recovery'] ?? 0,
      completed: t['Completed'] ?? 0,
      rental: t['Rental'] ?? 0,
    };
  }, [statusTotals]);

  const filteredClaims = claims;

  const handleSettingsProfileSaved = useCallback(
    ({ displayName }) => {
      const name = String(displayName ?? '').trim();
      if (!name || !session) return;
      const next = { ...session, displayName: name };
      setSession(next);
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
    },
    [session],
  );

  if (!session) {
    return <LoginScreen onLoggedIn={setSession} />;
  }

  const updateClaimStatus = async (id, status) => {
    const claimId = claimMongoId({ id, _id: id });
    if (!claimId) {
      void alertWarning('Refresh the page, then open this claim again from the queue.', 'Invalid claim id');
      return;
    }
    const sameClaim = (item) => claimMongoId(item) === claimId;
    const previousClaims = claims;
    const previousSelected = selectedClaim;
    setClaims((current) => current.map((item) => (sameClaim(item) ? { ...item, status } : item)));
    setSelectedClaim((current) => (current && sameClaim(current) ? { ...current, status } : current));
    if (!session.token || !canWriteClaims(session.role)) return;
    try {
      const updated = await api.patchClaimStatus(session.token, claimId, status);
      applyClaimFromServer(updated);
    } catch (e) {
      console.error(e);
      setClaims(previousClaims);
      setSelectedClaim(previousSelected);
      void alertError(
        `Could not update status on server: ${e.message || String(e)}. If you use Litigation, Recovery, Completed, or Rental, ensure the backend is on the latest version.`,
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

  const openClaimById = async (claimId, tab = 'parts') => {
    if (!session?.token) return;
    const rowId = api.normalizeClaimId(claimId);
    if (!rowId) return;
    setClaimModalInitialTab(tab);
    setActiveWorkspace('claims');
    setSelectedClaim({ id: rowId, _detailLoading: true });
    try {
      const full = await api.getClaim(session.token, rowId);
      setSelectedClaim(api.claimFromApi(full));
    } catch (e) {
      if (e instanceof api.ApiAuthError) logout();
      else void alertError(e?.message || 'Could not open claim');
    }
  };

  const openRow = async (item) => {
    if (!session?.token) return;
    setClaimModalInitialTab('overview');
    const rowId = api.normalizeClaimId(item?.id ?? item?._id);
    if (!rowId) {
      void alertWarning('Refresh the page or contact support.', 'Invalid claim id');
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
  const claimsReadOnly = !canWriteClaims(session.role);
  const showAttendanceNav = canManageAttendance(session.role);
  const showPartsNav = canViewParts(session.role);
  const showHrNav = canManageHr(session.role);
  const showSettingsNav = canAccessSettings(session.role);
  const workspaceTitles = {
    claims: 'Claims queue',
    attendance: 'Attendance',
    parts: 'Parts Management',
    employees: 'Employees',
    salaries: 'Salaries',
    settings: 'Settings',
  };

  return (
    <div className="h-screen overflow-hidden bg-mesh-app font-sans text-zinc-900 antialiased">
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <aside className="relative flex w-full shrink-0 flex-col overflow-hidden border-b border-zinc-800/90 bg-zinc-950 text-zinc-100 shadow-[4px_0_24px_-8px_rgba(0,0,0,0.25)] lg:h-full lg:w-[260px] lg:border-b-0 lg:border-r lg:border-zinc-800/90">
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
              <p className="truncate text-2xs font-medium uppercase tracking-[0.14em] text-zinc-400">
                Repairs · {sidebarRoleLabel(session.role)}
              </p>
            </div>
          </div>

          <nav className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-2 scrollbar-thin lg:py-4">
            <div>
              <p className="px-2.5 pb-2 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Workspace</p>
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setActiveWorkspace('claims')}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                    activeWorkspace === 'claims'
                      ? 'bg-zinc-800/80 text-white shadow-lift ring-1 ring-white/10'
                      : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-100'
                  }`}
                  aria-current={activeWorkspace === 'claims' ? 'page' : undefined}
                >
                  <Inbox className="h-4 w-4 shrink-0 text-indigo-300" strokeWidth={2} />
                  <span>Claims queue</span>
                </button>
                {showAttendanceNav ? (
                  <button
                    type="button"
                    onClick={() => setActiveWorkspace('attendance')}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                      activeWorkspace === 'attendance'
                        ? 'bg-zinc-800/80 text-white shadow-lift ring-1 ring-white/10'
                        : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-100'
                    }`}
                    aria-current={activeWorkspace === 'attendance' ? 'page' : undefined}
                  >
                    <CalendarDays className="h-4 w-4 shrink-0 text-sky-300" strokeWidth={2} />
                    <span>Attendance</span>
                  </button>
                ) : null}
                {showPartsNav ? (
                  <button
                    type="button"
                    onClick={() => setActiveWorkspace('parts')}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                      activeWorkspace === 'parts'
                        ? 'bg-zinc-800/80 text-white shadow-lift ring-1 ring-white/10'
                        : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-100'
                    }`}
                    aria-current={activeWorkspace === 'parts' ? 'page' : undefined}
                  >
                    <Package className="h-4 w-4 shrink-0 text-violet-300" strokeWidth={2} />
                    <span>Parts Management</span>
                  </button>
                ) : null}
                {showHrNav ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace('employees')}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                        activeWorkspace === 'employees'
                          ? 'bg-zinc-800/80 text-white shadow-lift ring-1 ring-white/10'
                          : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-100'
                      }`}
                      aria-current={activeWorkspace === 'employees' ? 'page' : undefined}
                    >
                      <Users className="h-4 w-4 shrink-0 text-emerald-300" strokeWidth={2} />
                      <span>Employees</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveWorkspace('salaries')}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                        activeWorkspace === 'salaries'
                          ? 'bg-zinc-800/80 text-white shadow-lift ring-1 ring-white/10'
                          : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-100'
                      }`}
                      aria-current={activeWorkspace === 'salaries' ? 'page' : undefined}
                    >
                      <Wallet className="h-4 w-4 shrink-0 text-amber-300" strokeWidth={2} />
                      <span>Salaries</span>
                    </button>
                  </>
                ) : null}
                {showSettingsNav ? (
                  <button
                    type="button"
                    onClick={() => setActiveWorkspace('settings')}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                      activeWorkspace === 'settings'
                        ? 'bg-zinc-800/80 text-white shadow-lift ring-1 ring-white/10'
                        : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-100'
                    }`}
                    aria-current={activeWorkspace === 'settings' ? 'page' : undefined}
                  >
                    <Settings className="h-4 w-4 shrink-0 text-zinc-300" strokeWidth={2} />
                    <span>Settings</span>
                  </button>
                ) : null}
              </div>
            </div>
          </nav>

          <div className="relative z-[1] mt-auto shrink-0 border-t border-zinc-800/90 bg-zinc-950/95 p-3 backdrop-blur-sm">
            <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/95 px-3 py-3 shadow-inner ring-1 ring-white/5">
              <div className="flex items-start gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 font-mono text-xs font-bold text-indigo-100 ring-1 ring-indigo-400/30">
                  {userInitials}
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="truncate text-sm font-semibold leading-tight text-white" title={session.displayName}>
                    {session.displayName}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-zinc-300" title={roleMeta.label}>
                    {sidebarRoleLabel(session.role)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-600/90 bg-zinc-800/80 text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80"
                  title="Sign out"
                  aria-label="Sign out"
                >
                  <LogOut className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
              <p
                className="mt-2.5 break-all text-xs leading-snug text-zinc-400"
                title={session.email}
              >
                {session.email}
              </p>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="z-10 shrink-0 border-b border-zinc-200/80 bg-white/80 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-white/65">
            <div className="flex h-11 items-center justify-between gap-4 px-3 sm:px-5 lg:px-8">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-2xs text-zinc-500 sm:gap-3">
                <span className="hidden font-semibold uppercase tracking-wider text-zinc-400 sm:inline">Operations</span>
                <ChevronRight className="hidden h-3 w-3 shrink-0 text-zinc-300 sm:inline" aria-hidden />
                <span className="truncate font-medium text-zinc-800">{workspaceTitles[activeWorkspace] ?? 'Claims queue'}</span>
                <span className="hidden h-3 w-px shrink-0 bg-zinc-200 sm:inline" aria-hidden />
                <span className="hidden truncate text-zinc-500 md:inline">Review</span>
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

          <main className="flex-1 overflow-auto scrollbar-thin px-3 py-3 sm:px-5 lg:px-8 lg:py-4">
            {activeWorkspace === 'attendance' && showAttendanceNav ? (
              <AttendancePanel token={session.token} onAuthError={logout} />
            ) : activeWorkspace === 'parts' && showPartsNav ? (
              <PartsManagementPanel
                token={session.token}
                sessionRole={session.role}
                onAuthError={logout}
                onOpenClaim={openClaimById}
              />
            ) : activeWorkspace === 'employees' && showHrNav ? (
              <EmployeesPanel token={session.token} onAuthError={logout} />
            ) : activeWorkspace === 'salaries' && showHrNav ? (
              <SalariesPanel token={session.token} onAuthError={logout} />
            ) : activeWorkspace === 'settings' && showSettingsNav ? (
              <SettingsPanel
                token={session.token}
                onAuthError={logout}
                onProfileSaved={handleSettingsProfileSaved}
              />
            ) : (
            <>
            {claimsError ? (
              <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{claimsError}</div>
            ) : null}
            {claimsReadOnly && (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-indigo-200/80 bg-gradient-to-r from-indigo-50/90 to-white px-4 py-3 shadow-card sm:items-center sm:px-5">
                <span className="mt-0.5 shrink-0 rounded-lg border border-indigo-300/80 bg-white px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-indigo-900 shadow-sm sm:mt-0">
                  Read-only
                </span>
                <p className="text-2xs leading-relaxed text-zinc-700 sm:text-xs">
                  You can search, filter, and open any claim to view the same data as an administrator. Status changes and exports are reserved for administrators.
                </p>
              </div>
            )}
            <section
              className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-9"
              aria-label="Claims portfolio statistics"
            >
              <MetricCard
                title="Total"
                value={metrics.total}
                caption="Full portfolio"
                icon={FileCheck2}
                tone="slate"
                active={statusFilter === 'All' && !searchTerm.trim()}
                onClick={() => {
                  setStatusFilter('All');
                  setCurrentPage(1);
                }}
              />
              <MetricCard
                title="Pending"
                value={metrics.pending}
                caption={t ? `${shareOfTotal(metrics.pending, t)}% of total` : '—'}
                icon={FileSearch}
                tone="amber"
                active={statusFilter === 'Pending Review'}
                onClick={() => {
                  setStatusFilter('Pending Review');
                  setCurrentPage(1);
                }}
              />
              <MetricCard
                title="Approved"
                value={metrics.approved}
                caption={t ? `${shareOfTotal(metrics.approved, t)}% of total` : '—'}
                icon={CheckCircle2}
                tone="emerald"
                active={statusFilter === 'Approved'}
                onClick={() => {
                  setStatusFilter('Approved');
                  setCurrentPage(1);
                }}
              />
              <MetricCard
                title="Rejected"
                value={metrics.rejected}
                caption={t ? `${shareOfTotal(metrics.rejected, t)}% of total` : '—'}
                icon={XCircle}
                tone="rose"
                active={statusFilter === 'Rejected'}
                onClick={() => {
                  setStatusFilter('Rejected');
                  setCurrentPage(1);
                }}
              />
              <MetricCard
                title="Litigation"
                value={metrics.litigation}
                caption={t ? `${shareOfTotal(metrics.litigation, t)}% of total` : '—'}
                icon={Gavel}
                tone="violet"
                active={statusFilter === 'Litigation'}
                onClick={() => {
                  setStatusFilter('Litigation');
                  setCurrentPage(1);
                }}
              />
              <MetricCard
                title="Recovery"
                value={metrics.recovery}
                caption={t ? `${shareOfTotal(metrics.recovery, t)}% of total` : '—'}
                icon={Landmark}
                tone="sky"
                active={statusFilter === 'Recovery'}
                onClick={() => {
                  setStatusFilter('Recovery');
                  setCurrentPage(1);
                }}
              />
              <MetricCard
                title="Completed"
                value={metrics.completed}
                caption={t ? `${shareOfTotal(metrics.completed, t)}% of total` : '—'}
                icon={BadgeCheck}
                tone="emerald"
                active={statusFilter === 'Completed'}
                onClick={() => {
                  setStatusFilter('Completed');
                  setCurrentPage(1);
                }}
              />
              <MetricCard
                title="Rental"
                value={metrics.rental}
                caption={t ? `${shareOfTotal(metrics.rental, t)}% of total` : '—'}
                icon={Car}
                tone="indigo"
                active={statusFilter === 'Rental'}
                onClick={() => {
                  setStatusFilter('Rental');
                  setCurrentPage(1);
                }}
              />
              <MetricCard
                title="Filtered"
                value={totalClaims}
                caption={
                  statusFilter === 'All' && !searchTerm.trim()
                    ? 'Matches current view'
                    : [statusFilter !== 'All' ? statusFilterLabel(statusFilter) : null, searchTerm.trim() ? 'Search' : null]
                        .filter(Boolean)
                        .join(' · ') || 'Matches current view'
                }
                icon={ListFilter}
                tone="indigo"
                className="col-span-2 sm:col-span-1"
              />
            </section>

            <section className="min-w-0">
              <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-card">
                <div className="border-b border-zinc-100 px-3 py-3 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h1 className="font-display text-base font-semibold tracking-tight text-zinc-950">Claims queue</h1>
                      <p className="mt-0.5 text-2xs text-zinc-500">
                        Use the summary cards above for status, or search below. Click a row to open the case file.
                      </p>
                    </div>
                    {(statusFilter !== 'All' || searchTerm.trim()) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStatusFilter('All');
                          setSearchTerm('');
                          setCurrentPage(1);
                        }}
                        className="h-9 shrink-0 self-start rounded-lg border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 sm:self-center"
                      >
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
                    {!claimsReadOnly ? (
                      <button
                        type="button"
                        onClick={() => setBuyerPdfModalOpen(true)}
                        className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 md:w-auto"
                      >
                        <Plus className="h-4 w-4" strokeWidth={2} />
                        New claim
                      </button>
                    ) : null}
                    <label className="group relative min-w-0 w-full md:flex-1">
                      <span className="sr-only">Search claims</span>
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 transition group-focus-within:text-indigo-600"
                        strokeWidth={2}
                      />
                      <input
                        type="search"
                        value={searchTerm}
                        onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }}
                        placeholder="Search plate, customer, driver, date…"
                        className="h-10 w-full rounded-xl border border-zinc-200/90 bg-zinc-50/80 pl-10 pr-3 text-[13px] text-zinc-900 shadow-inner outline-none transition placeholder:text-zinc-400 focus:border-indigo-400/80 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </label>
                    <label className="flex w-full shrink-0 flex-col gap-1 md:w-48">
                      <span className="sr-only">Filter by status</span>
                      <select
                        value={statusFilter}
                        onChange={(e) => {
                          setStatusFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="h-10 w-full rounded-xl border border-zinc-200/90 bg-zinc-50/80 px-2.5 text-[13px] font-medium text-zinc-900 shadow-inner outline-none focus:border-indigo-400/80 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                        aria-label="Filter by status"
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {statusFilterLabel(option)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="overflow-x-auto scrollbar-thin">
                  <table className="min-w-[1040px] w-full border-collapse text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50/95">
                        <th className="w-10 px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">#</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500" title="Member portal code (HR-…) and internal id (HRZ-…)">
                          Reference
                        </th>
                        <th className="min-w-[140px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Plate</th>
                        <th className="min-w-[160px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Driver</th>
                        <th className="min-w-[180px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Needs attention</th>
                        <th className="whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Submitted</th>
                        <th className="whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Incident</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Payment</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Priority</th>
                        <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Status</th>
                        <th className="w-[72px] px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                          {claimsReadOnly ? '' : 'Actions'}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {claimsLoading
                        ? Array.from({ length: 8 }).map((_, i) => (
                            <tr key={i} className="animate-pulse">
                              <td className="px-3 py-3"><div className="h-3 w-5 rounded bg-zinc-200" /></td>
                              <td className="px-3 py-3"><div className="h-3 w-28 rounded bg-zinc-200" /><div className="mt-1.5 h-2.5 w-20 rounded bg-zinc-100" /></td>
                              <td className="px-3 py-3"><div className="h-3 w-20 rounded bg-zinc-200" /></td>
                              <td className="px-3 py-3"><div className="h-3 w-28 rounded bg-zinc-200" /><div className="mt-1.5 h-2 w-36 rounded bg-zinc-100" /></td>
                              <td className="px-3 py-3"><div className="h-3 w-32 rounded bg-zinc-200" /></td>
                              <td className="px-3 py-3"><div className="h-3 w-20 rounded bg-zinc-200" /></td>
                              <td className="px-3 py-3"><div className="h-3 w-20 rounded bg-zinc-200" /></td>
                              <td className="px-3 py-3"><div className="h-5 w-16 rounded-full bg-zinc-200" /></td>
                              <td className="px-3 py-3"><div className="h-5 w-14 rounded-full bg-zinc-200" /></td>
                              <td className="px-3 py-3"><div className="h-5 w-20 rounded-full bg-zinc-200" /></td>
                              <td className="px-3 py-3"><div className="h-5 w-8 rounded bg-zinc-200" /></td>
                            </tr>
                          ))
                        : filteredClaims.map((item, index) => {
                        const active = selectedClaim?.id === item.id;
                        const signals = buildClaimSignals(item);
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
                            <td className="px-3 py-2.5 font-mono text-2xs tabular-nums text-zinc-400">{(currentPage - 1) * PAGE_SIZE + index + 1}</td>
                            <td className="px-3 py-2.5 font-mono text-2xs text-zinc-500">
                              {item.intakeReference ? (
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <span className="font-semibold text-zinc-800" title="Code from the public claim portal">
                                      {item.intakeReference}
                                    </span>
                                    <CopyTextButton text={item.intakeReference} title="Copy member reference" />
                                    {item.intakeSource === 'admin-buyer-pdf' ? (
                                      <span
                                        className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800"
                                        title="Created from buyer PDF by admin"
                                      >
                                        Buyer PDF
                                      </span>
                                    ) : null}
                                  </div>
                                  {item.reference ? (
                                    <div className="mt-0.5 flex min-w-0 items-center gap-1">
                                      <span className="min-w-0 truncate text-zinc-400" title="Internal system reference (claim ID)">
                                        {item.reference}
                                      </span>
                                      <CopyTextButton text={item.reference} title="Copy claim ID" />
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="flex min-w-0 items-center gap-1">
                                  <span className="truncate text-zinc-600">{claimRef(item)}</span>
                                  <CopyTextButton
                                    text={item.reference || claimMongoId(item)}
                                    title="Copy claim ID"
                                  />
                                </div>
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
                            <td className="px-3 py-2.5">
                              <AttentionSummary signals={signals} compact />
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
                                {!claimsReadOnly ? (
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
                      {!claimsLoading && !filteredClaims.length && (
                        <tr>
                          <td colSpan={11} className="px-4 py-12">
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
              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-3 py-3 sm:px-5">
                  <p className="text-2xs text-zinc-500">
                    Showing{' '}
                    <span className="font-semibold text-zinc-800">
                      {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, totalClaims)}
                    </span>{' '}
                    of <span className="font-semibold text-zinc-800">{totalClaims}</span> claims
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={currentPage <= 1 || claimsLoading}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="flex h-8 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-2xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                      Prev
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                      .reduce((acc, p, idx, arr) => {
                        if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((p, idx) =>
                        p === '...' ? (
                          <span key={`ellipsis-${idx}`} className="px-1 text-2xs text-zinc-400">…</span>
                        ) : (
                          <button
                            key={p}
                            type="button"
                            disabled={claimsLoading}
                            onClick={() => setCurrentPage(p)}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-2xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                              currentPage === p
                                ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                                : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-40'
                            }`}
                          >
                            {p}
                          </button>
                        )
                      )}
                    <button
                      type="button"
                      disabled={currentPage >= totalPages || claimsLoading}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="flex h-8 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-2xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
              </div>
            </section>
              </>
            )}
          </main>
        </div>
      </div>

      {selectedClaim && (
        <ClaimModal
          claimItem={selectedClaim}
          initialTab={claimModalInitialTab}
          role={session.role}
          authToken={session.token}
          workspaceSave={workspaceSave}
          onClose={closeClaimModal}
          onApprove={() => updateClaimStatus(claimMongoId(selectedClaim), 'Approved')}
          onReject={() => updateClaimStatus(claimMongoId(selectedClaim), 'Rejected')}
          onLitigation={() => updateClaimStatus(claimMongoId(selectedClaim), 'Litigation')}
          onRecovery={() => updateClaimStatus(claimMongoId(selectedClaim), 'Recovery')}
          onCompleted={() => updateClaimStatus(claimMongoId(selectedClaim), 'Completed')}
          onRental={() => updateClaimStatus(claimMongoId(selectedClaim), 'Rental')}
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

      {buyerPdfModalOpen && session?.token && !claimsReadOnly ? (
        <BuyerPdfClaimModal
          token={session.token}
          onClose={() => setBuyerPdfModalOpen(false)}
          onCreated={async (result) => {
            try {
              const pageResult = await loadClaims(session.token, { page: 1 });
              setCurrentPage(1);
              setClaims(pageResult.claims);
              setTotalClaims(pageResult.total);
              setTotalPages(pageResult.totalPages);
              setStatusTotals(pageResult.statusTotals);
              setClaimsError('');
              const created =
                result?.claim && typeof result.claim === 'object'
                  ? api.claimFromApi(result.claim)
                  : pageResult.claims.find((c) => claimMongoId(c) === api.normalizeClaimId(result?.id));
              if (created) {
                setSelectedClaim(created);
              }
            } catch (err) {
              if (err instanceof api.ApiAuthError) {
                logout();
                return;
              }
              setClaimsError(err?.message || 'Claim created but queue refresh failed');
            }
          }}
        />
      ) : null}

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

const METRIC_TONE = {
  slate: {
    card: 'from-zinc-50/80',
    iconWrap: 'bg-zinc-100 text-zinc-600 ring-zinc-200/80',
  },
  amber: {
    card: 'from-amber-50/70',
    iconWrap: 'bg-amber-100 text-amber-700 ring-amber-200/80',
  },
  emerald: {
    card: 'from-emerald-50/70',
    iconWrap: 'bg-emerald-100 text-emerald-700 ring-emerald-200/80',
  },
  rose: {
    card: 'from-rose-50/70',
    iconWrap: 'bg-rose-100 text-rose-700 ring-rose-200/80',
  },
  violet: {
    card: 'from-violet-50/70',
    iconWrap: 'bg-violet-100 text-violet-700 ring-violet-200/80',
  },
  sky: {
    card: 'from-sky-50/70',
    iconWrap: 'bg-sky-100 text-sky-700 ring-sky-200/80',
  },
  indigo: {
    card: 'from-indigo-50/70',
    iconWrap: 'bg-indigo-100 text-indigo-700 ring-indigo-200/80',
  },
};

function MetricCard({ title, value, caption, icon: Icon, tone = 'slate', onClick, active, className = '' }) {
  const palette = METRIC_TONE[tone] ?? METRIC_TONE.slate;
  const interactive = Boolean(onClick);
  const Wrapper = interactive ? 'button' : 'div';
  return (
    <Wrapper
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br to-white p-3.5 text-left shadow-card transition sm:p-4 ${
        active
          ? 'border-indigo-300/90 ring-2 ring-indigo-500/15'
          : 'border-zinc-200/90 hover:border-zinc-300/90 hover:shadow-lift'
      } ${palette.card} ${interactive ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40' : ''} ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums leading-none tracking-tight text-zinc-950 sm:text-[1.65rem]">
            {value}
          </p>
          {caption ? <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-zinc-500">{caption}</p> : null}
        </div>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset transition group-hover:scale-105 sm:h-10 sm:w-10 ${palette.iconWrap}`}
        >
          <Icon className="h-4 w-4 sm:h-[1.125rem] sm:w-[1.125rem]" strokeWidth={2} />
        </div>
      </div>
    </Wrapper>
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
            : status === 'Completed'
              ? 'border-teal-200 bg-teal-50 text-teal-900'
              : status === 'Rental'
                ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
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

function PdfPreviewDialog({ open, title, html, onClose, onPrint }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/65 p-3 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sheet-lg">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">PDF preview</p>
            <h3 className="mt-0.5 truncate text-sm font-semibold text-zinc-950">{title || 'Claim export'}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-2xs font-semibold text-white shadow-sm transition hover:bg-zinc-800"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
              aria-label="Close PDF preview"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
        <iframe
          title={title || 'Claim PDF preview'}
          srcDoc={html}
          className="min-h-0 flex-1 bg-white"
        />
      </div>
    </div>
  );
}

function AttentionSummary({ signals, compact = false }) {
  const level = signals?.attentionLevel || 'low';
  const styles =
    level === 'high'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : level === 'medium'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-emerald-200 bg-emerald-50 text-emerald-900';
  const Icon = level === 'low' ? CheckCircle2 : AlertTriangle;
  const missingCount = signals?.missingDocs?.length || 0;
  const riskCount = signals?.risks?.length || 0;

  return (
    <div className="min-w-0">
      <span className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-2xs font-semibold ${styles}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="truncate">{signals?.nextAction || 'No immediate action'}</span>
      </span>
      {!compact ? null : (
        <p className="mt-1 truncate text-2xs text-zinc-500">
          {missingCount ? `${missingCount} missing` : 'Docs ok'}
          {riskCount ? ` · ${riskCount} flag${riskCount === 1 ? '' : 's'}` : ''}
        </p>
      )}
    </div>
  );
}

function DocumentChecklist({ documents, onViewEvidence }) {
  const rows = Array.isArray(documents) ? documents : [];
  const required = rows.filter((row) => row.required);
  const missingRequired = required.filter((row) => !row.complete);
  const completeRequired = required.filter((row) => row.complete);
  const optionalRows = rows.filter((row) => !row.required);
  const completeRequiredCount = completeRequired.length;

  const renderRows = (items, emptyText) =>
    items.length ? (
      <div className="divide-y divide-zinc-100">
        {items.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900">{row.label}</p>
              <p className="mt-0.5 truncate text-2xs text-zinc-500">
                {row.required ? 'Required' : 'Optional'}
                {row.detail ? ` - ${row.detail}` : ''}
              </p>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-2xs font-semibold ${
                row.complete
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : row.required
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-600'
              }`}
            >
              {row.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
              {row.complete ? 'Complete' : row.required ? 'Missing' : 'Optional'}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <p className="px-4 py-3 text-sm text-zinc-500">{emptyText}</p>
    );

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
      <div className="flex flex-col gap-3 border-b border-zinc-100 bg-zinc-50/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-900">Checklist</h3>
          <p className="mt-0.5 text-2xs text-zinc-500">
            {completeRequiredCount}/{required.length} required complete
            {missingRequired.length ? ` - ${missingRequired.length} needs attention` : ''}
          </p>
        </div>
        {onViewEvidence ? (
          <button
            type="button"
            onClick={onViewEvidence}
            className="inline-flex h-9 w-fit items-center gap-2 rounded-lg bg-zinc-950 px-3 text-2xs font-semibold text-white shadow-sm transition hover:bg-zinc-800"
          >
            <FileSearch className="h-3.5 w-3.5" strokeWidth={2} />
            View evidence
          </button>
        ) : null}
      </div>
      <div className="divide-y divide-zinc-100">
        <section>
          <div className="flex items-center gap-2 px-4 py-2.5">
            <AlertTriangle className={`h-4 w-4 ${missingRequired.length ? 'text-rose-600' : 'text-emerald-600'}`} strokeWidth={2} />
            <h4 className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Needs attention</h4>
          </div>
          {renderRows(missingRequired, 'No missing required documents.')}
        </section>
        <section>
          <div className="flex items-center gap-2 px-4 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={2} />
            <h4 className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Complete required</h4>
          </div>
          {renderRows(completeRequired, 'No required documents have been completed yet.')}
        </section>
        {optionalRows.length ? (
          <section>
            <div className="px-4 py-2.5">
              <h4 className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Optional / supporting</h4>
            </div>
            {renderRows(optionalRows, 'No optional supporting evidence recorded.')}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function LegacyDocumentChecklist({ documents }) {
  const rows = Array.isArray(documents) ? documents : [];
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-zinc-900">Document completeness</h3>
        <span className="text-2xs font-semibold text-zinc-500">
          {rows.filter((row) => row.required && row.complete).length}/{rows.filter((row) => row.required).length} required
        </span>
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900">{row.label}</p>
              <p className="mt-0.5 truncate text-2xs text-zinc-500">
                {row.required ? 'Required' : 'Optional'}
                {row.detail ? ` · ${row.detail}` : ''}
              </p>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-2xs font-semibold ${
                row.complete
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : row.required
                    ? 'border-rose-200 bg-rose-50 text-rose-900'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-600'
              }`}
            >
              {row.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
              {row.complete ? 'Complete' : row.required ? 'Missing' : 'Optional'}
            </span>
          </div>
        ))}
      </div>
    </div>
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

function CaseFactChip({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'good'
      ? 'border-emerald-200 bg-emerald-50/80 text-emerald-950'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50/90 text-amber-950'
        : 'border-zinc-200/90 bg-white text-zinc-900';
  return (
    <div className={`flex min-w-[9.5rem] items-center justify-between gap-3 rounded-lg border px-2.5 py-1.5 shadow-inner ${toneClass}`}>
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider opacity-65">{label}</span>
      <span className="truncate text-right text-xs font-semibold">{value || '—'}</span>
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
  initialTab = 'overview',
  role,
  authToken,
  workspaceSave,
  onClose,
  onApprove,
  onReject,
  onLitigation,
  onRecovery,
  onCompleted,
  onRental,
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
  const [memberSubmissionDirty, setMemberSubmissionDirty] = useState(false);
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
  const [quotePdfBusyId, setQuotePdfBusyId] = useState(null);
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
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const claimsReadOnly = !canWriteClaims(role);
  const canFullPartsCrud = canManagePartsCrud(role);
  const partsFieldsReadOnly = claimsReadOnly || !canFullPartsCrud;
  const fileInputRef = useRef(null);
  const additionalFileInputRef = useRef(null);
  const rentalFileInputRef = useRef(null);
  const tabRailRef = useRef(null);

  const openDeleteDialog = () => onRequestDelete?.();
  const confirmLeaveMemberEdit = async () => {
    if (!memberSubmissionDirty) return true;
    return await confirmDialog(
      'You have unsaved member submission changes. Discard them and leave this edit session?',
      'Discard changes?',
    );
  };
  const navigateTab = async (nextTab) => {
    if (nextTab === tab) return;
    if (!(await confirmLeaveMemberEdit())) return;
    setMemberSubmissionDirty(false);
    setTab(nextTab);
  };
  const closeModal = async () => {
    if (!(await confirmLeaveMemberEdit())) return;
    onClose();
  };

  const scrollTabRail = (direction) => {
    const rail = tabRailRef.current;
    if (!rail) return;
    rail.scrollBy({
      left: direction * Math.max(180, rail.clientWidth * 0.72),
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    setTab(initialTab || 'overview');
    setMemberSubmissionDirty(false);
  }, [claimItem.id, claimItem._id, initialTab]);

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
    if (claimsReadOnly || !onUpdatePrices) return;
    const amount = parseMoneyInput(priceDraft.quote);
    if (amount == null) {
      void alertWarning('Enter a quote price before saving.');
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
      void alertError(e?.message ? String(e.message) : 'Could not save quote price.');
    }
  };

  const handleSaveInsurancePrice = async () => {
    if (claimsReadOnly || !onUpdatePrices) return;
    const amount = parseMoneyInput(priceDraft.insurance);
    if (amount == null) {
      void alertWarning('Enter an insurance company price before saving.');
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
      void alertError(e?.message ? String(e.message) : 'Could not save insurance company price.');
    }
  };

  const handleSaveAdminNote = async () => {
    if (claimsReadOnly || !onSaveAdminNote) return;
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
      void alertError(e?.message ? String(e.message) : 'Could not save admin note.');
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
  const isAdminBuyerPdf = claimItem.intakeSource === 'admin-buyer-pdf';
  const isRentalStatus = claimStatus === 'Rental';

  // Partition caseFiles by kind (exclude files linked to part invoices or repair quotes).
  const invoiceLinkedFileIds = new Set(
    partsDraft.flatMap((p) => (p.invoices ?? []).map((inv) => inv.fileId)).filter(Boolean),
  );
  const repairQuoteLinkedFileIds = new Set(
    quoteOptionsDraft.map((q) => q.fileId).filter(Boolean),
  );
  const linkedCaseFileIds = new Set([...invoiceLinkedFileIds, ...repairQuoteLinkedFileIds]);
  const nonInvoiceFiles = caseFiles.filter((f) => !linkedCaseFileIds.has(f.id));
  const hasExplicitIntake = nonInvoiceFiles.some((f) => f.kind === 'intake');
  // Legacy: admin-buyer-pdf claims created before `kind` was stored — treat first file as intake.
  const legacyFirstId =
    isAdminBuyerPdf && !hasExplicitIntake && nonInvoiceFiles.length > 0
      ? nonInvoiceFiles[0].id
      : null;
  const intakeFiles = nonInvoiceFiles.filter(
    (f) => f.kind === 'intake' || f.id === legacyFirstId,
  );
  // For buyer-pdf claims: 'general'/untagged files after the legacy first are shown as additional.
  const additionalFiles = nonInvoiceFiles.filter((f) => {
    if (f.kind === 'additional') return true;
    if (isAdminBuyerPdf && !['intake', 'rental'].includes(f.kind) && f.id !== legacyFirstId) return true;
    return false;
  });
  const rentalFiles = nonInvoiceFiles.filter((f) => f.kind === 'rental');
  // General files: non-buyer-pdf claims only (member claims), or tagged 'general' on member claims.
  const generalFiles = nonInvoiceFiles.filter(
    (f) => !isAdminBuyerPdf && !['intake', 'additional', 'rental'].includes(f.kind),
  );
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
  const caseSignals = buildClaimSignals(claimItem);

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

  const updatePartDraft = (partId, field, raw, linkSnapshot = null) => {
    setPartsDraft((rows) =>
      rows.map((p) => (p.id !== partId ? p : updatePartInList(p, field, raw, linkSnapshot))),
    );
    if (partsSave === 'saved') setPartsSave('idle');
    setPartsSaveKind(null);
  };
  const applyPartSuggestionToDraft = (partId, suggestion) => {
    setPartsDraft((rows) => rows.map((p) => (p.id !== partId ? p : applyPartSuggestion(p, suggestion))));
    if (partsSave === 'saved') setPartsSave('idle');
    setPartsSaveKind(null);
  };
  const addPart = (templatePart = null) => {
    if (claimsReadOnly || !canFullPartsCrud) return;
    const template =
      templatePart ?? (partsDraft.length > 0 ? partsDraft[partsDraft.length - 1] : null);
    const line = template
      ? applySharedContextToPart(newPartLine(), extractPartSharedContext(template))
      : newPartLine();
    setPartsDraft((rows) => [...rows, line]);
    if (partsSave === 'saved') setPartsSave('idle');
    setPartsSaveKind(null);
  };
  const addPartLike = (fromPartId) => {
    const template = partsDraft.find((row) => row.id === fromPartId);
    addPart(template || null);
  };
  const removePart = (partId) => {
    if (claimsReadOnly || !canFullPartsCrud) return;
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
    if (claimsReadOnly) return;
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

  const handleRepairQuotePdfUpload = async (quoteId, ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || claimsReadOnly || !authToken) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      void alertWarning('Please upload a PDF file.');
      return;
    }
    const claimId = claimMongoId(claimItem);
    if (!claimId) {
      void alertWarning('Close and reopen this case.', 'Invalid claim id');
      return;
    }
    setQuotePdfBusyId(quoteId);
    try {
      const nextCaseFiles = await api.uploadClaimPdf(authToken, claimId, file, { kind: 'general' });
      const uploaded = nextCaseFiles[nextCaseFiles.length - 1];
      if (!uploaded) throw new Error('Upload failed');
      const prevQuote = quoteOptionsDraft.find((q) => q.id === quoteId);
      setQuoteOptionsDraft((rows) =>
        rows.map((q) =>
          q.id === quoteId
            ? {
                ...q,
                fileId: uploaded.id,
                fileName: uploaded.name,
                fileUrl: uploaded.url,
              }
            : q,
        ),
      );
      let caseFilesAfter = nextCaseFiles;
      if (prevQuote?.fileId && prevQuote.fileId !== uploaded.id) {
        try {
          caseFilesAfter = await api.deleteClaimPdf(authToken, claimId, prevQuote.fileId);
        } catch {
          /* keep new upload */
        }
      }
      patch((prev) => ({ ...prev, caseFiles: caseFilesAfter }));
      if (repairQuotesSave === 'saved') setRepairQuotesSave('idle');
      setRepairQuotesSaveKind(null);
    } catch (e) {
      void alertError(e?.message ? String(e.message) : 'Could not upload quote PDF.');
    } finally {
      setQuotePdfBusyId(null);
    }
  };

  const handleRemoveRepairQuotePdf = async (quoteId) => {
    if (claimsReadOnly) return;
    const quote = quoteOptionsDraft.find((q) => q.id === quoteId);
    if (!quote?.fileId) return;
    if (authToken) {
      setQuotePdfBusyId(quoteId);
      try {
        const cf = await api.deleteClaimPdf(authToken, claimMongoId(claimItem), quote.fileId);
        patch((prev) => ({ ...prev, caseFiles: cf }));
      } catch (e) {
        void alertError(e?.message ? String(e.message) : 'Could not remove PDF.');
        setQuotePdfBusyId(null);
        return;
      }
      setQuotePdfBusyId(null);
    }
    setQuoteOptionsDraft((rows) =>
      rows.map((q) =>
        q.id === quoteId ? { ...q, fileId: null, fileName: '', fileUrl: '' } : q,
      ),
    );
    if (repairQuotesSave === 'saved') setRepairQuotesSave('idle');
    setRepairQuotesSaveKind(null);
  };

  const handlePartInvoiceUpload = async (partId, ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || claimsReadOnly || !authToken) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      void alertWarning('Please upload a PDF invoice.');
      return;
    }
    const claimId = claimMongoId(claimItem);
    if (!claimId) {
      void alertWarning('Close and reopen this case.', 'Invalid claim id');
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
      void alertError(e?.message ? String(e.message) : 'Could not upload invoice.');
    } finally {
      setPartInvoiceBusyId(null);
    }
  };

  const addQuote = () => {
    if (claimsReadOnly) return;
    setQuoteOptionsDraft((rows) => [...rows, newQuoteLine()]);
    if (repairQuotesSave === 'saved') setRepairQuotesSave('idle');
    setRepairQuotesSaveKind(null);
  };

  const handleSaveParts = async () => {
    if (claimsReadOnly) return;
    const wasUpdate = hasSavedParts;
    setPartsSave('saving');
    setPartsSaveKind(null);
    try {
      if (canFullPartsCrud && onSaveParts) {
        const updated = await onSaveParts(partsDraft);
        setPartsDraft(cloneParts(updated.parts));
      } else {
        const claimId = claimMongoId(claimItem);
        if (!claimId || !authToken) throw new Error('Invalid claim');
        const savedSnap = partsSnapshot(savedParts);
        const savedIds = new Set(savedSnap.map((s) => s.id));
        let lastParts = savedParts;
        for (const p of partsDraft) {
          const snap = partsSnapshot([p])[0];
          if (!savedIds.has(snap.id)) {
            const res = await api.createPartLine(authToken, claimId, api.mapPartsForApi([p])[0]);
            if (res.claim?.parts) lastParts = res.claim.parts;
            continue;
          }
          const prev = savedSnap.find((s) => s.id === snap.id);
          if (!prev) continue;
          const statusChanged = snap.status !== prev.status;
          const invChanged = JSON.stringify(snap.invoices) !== JSON.stringify(prev.invoices);
          if (!statusChanged && !invChanged) continue;
          const res = await api.patchPartLine(authToken, claimId, p.id, {
            status: snap.status,
            invoices: snap.invoices,
          });
          if (res.claim?.parts) lastParts = res.claim.parts;
        }
        setPartsDraft(cloneParts(lastParts));
        patch((prev) => ({ ...prev, parts: lastParts }));
      }
      setPartsSaveKind(wasUpdate ? 'updated' : 'saved');
      setPartsSave('saved');
    } catch (e) {
      setPartsSave('error');
      void alertError(e?.message ? String(e.message) : 'Could not save parts.');
    }
  };

  const handleSaveRepairQuotes = async () => {
    if (claimsReadOnly || !onSaveQuoteWorkspace) return;
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
      void alertError(e?.message ? String(e.message) : 'Could not save repair quotes.');
    }
  };

  const handleSavePaymentStatus = async () => {
    if (claimsReadOnly || !onSavePaymentStatus) return;
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
      void alertError(e?.message ? String(e.message) : 'Could not save payment status.');
    }
  };

  /** Generic pdf upload handler — pass kind to tag the file on the server. */
  const handlePdfInputWithKind = async (ev, kind = 'general') => {
    const picked = [...(ev.target.files || [])].filter((f) => f.type === 'application/pdf');
    ev.target.value = '';
    if (!picked.length || claimsReadOnly) return;
    const MAX_FALLBACK_BYTES = Number(import.meta.env.VITE_MAX_ADMIN_PDF_BYTES || 25 * 1024 * 1024);
    const ok = [];
    const skip = [];
    for (const f of picked) {
      if (f.size > MAX_FALLBACK_BYTES) skip.push(f.name);
      else ok.push(f);
    }
    if (skip.length) {
      void alertWarning(`These files were skipped (limit ${formatFileSize(MAX_FALLBACK_BYTES)}): ${skip.join(', ')}`, 'Files skipped');
    }
    if (!ok.length) return;
    setPdfBusy(true);
    try {
      if (authToken) {
        const claimId = api.normalizeClaimId(claimItem.id ?? claimItem._id);
        if (!claimId) {
          void alertWarning('Close this case and open it again from the queue.', 'Invalid claim id');
          return;
        }
        let nextList = [...(claimItem.caseFiles ?? [])];
        for (const f of ok) {
          nextList = await api.uploadClaimPdf(authToken, claimId, f, { kind });
        }
        patch((prev) => ({ ...prev, caseFiles: nextList, id: claimId, _id: claimId }));
      } else {
        const added = await Promise.all(ok.map(async (f) => {
          const base = await fileToCaseFile(f);
          return { ...base, kind };
        }));
        patch((prev) => ({
          ...prev,
          caseFiles: [...(prev.caseFiles ?? []), ...added],
        }));
      }
    } catch (e) {
      void alertError(e?.message ? String(e.message) : 'Could not upload one or more PDFs.');
    } finally {
      setPdfBusy(false);
    }
  };

  const handlePdfInput = (ev) => handlePdfInputWithKind(ev, 'general');
  const handleAdditionalPdfInput = (ev) => handlePdfInputWithKind(ev, 'additional');
  const handleRentalPdfInput = (ev) => handlePdfInputWithKind(ev, 'rental');

  const removePdf = async (fileId) => {
    if (claimsReadOnly) return;
    const list = claimItem.caseFiles ?? [];
    const target = list.find((f) => f.id === fileId);
    const remote = authToken && target?.url?.startsWith('/uploads/');
    if (remote) {
      setPdfBusy(true);
      try {
        const cf = await api.deleteClaimPdf(authToken, claimMongoId(claimItem), fileId);
        patch((prev) => ({ ...prev, caseFiles: cf }));
      } catch (e) {
        void alertError(e?.message ? String(e.message) : 'Could not delete file.');
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
  const evidenceGroups = claimEvidenceGroups(claimItem);
  const quoteSummary =
    quotePrice != null
      ? formatAud(quotePrice)
      : insuranceApprovedPrice != null
        ? formatAud(insuranceApprovedPrice)
        : 'Not set';
  const exportHtml = buildClaimExportHtml(claimItem, {
    refSummary: claimExportRefSummary(claimItem),
    formatAud,
    paymentLabel: paymentStatusLabel(claimItem.paymentStatus),
  });
  const previewTitle = `Claim ${claimItem.intakeReference || claimRef(claimItem) || ''}`.trim();

  return (
    <div className="fixed inset-0 z-50 flex bg-zinc-950/55 p-0 backdrop-blur-sm lg:p-3">
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden border border-zinc-200/90 bg-zinc-50 shadow-sheet-lg lg:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-modal-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200/90 bg-white px-3 py-2.5 sm:px-5 sm:py-3">
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
            <p className="mt-2 hidden max-w-4xl truncate text-sm leading-relaxed text-zinc-600 sm:block">{claimItem.summary || 'No summary recorded.'}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {memberSubmissionDirty ? (
              <span className="hidden rounded-lg border border-amber-300 bg-amber-50 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-amber-900 shadow-inner sm:inline-flex">
                Unsaved edits
              </span>
            ) : null}
            {claimsReadOnly && (
              <span className="hidden rounded-lg border border-zinc-300/90 bg-zinc-100 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-zinc-800 shadow-inner sm:inline-flex">
                View only
              </span>
            )}
            <button
              type="button"
              onClick={() => void closeModal()}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/90 bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 focus-visible:ring-offset-2"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b border-zinc-200/90 bg-zinc-50/80 px-3 py-1.5 sm:px-5">
          <div className="scrollbar-none flex gap-2 overflow-x-auto lg:grid lg:grid-cols-4 lg:overflow-visible">
            <CaseFactChip label="Submitted" value={claimItem.submittedAt} />
            <CaseFactChip label="Incident" value={claimItem.dateOfIncident} />
            <CaseFactChip label="Quote" value={quoteSummary} tone={quotePrice != null || insuranceApprovedPrice != null ? 'good' : 'warn'} />
            <CaseFactChip label="Payment" value={paymentStatusLabel(paymentStatus)} tone={paymentStatus === 'completed' ? 'good' : 'warn'} />
          </div>
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
                    onClick={() => void navigateTab(item.id)}
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

          <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin bg-zinc-50/70 px-3 py-3 sm:px-5 sm:py-4">
            <div className="w-full">
            {tab === 'submission' && (
              <MemberSubmissionPanel
                claimItem={claimItem}
                readOnly={claimsReadOnly}
                onSaveSection={claimsReadOnly ? undefined : onSaveMemberSubmission}
                onDirtyChange={setMemberSubmissionDirty}
              />
            )}

            {tab === 'evidence' && (
              <EvidenceWorkspace groups={evidenceGroups} onOpenSubmission={() => void navigateTab('submission')} />
            )}

            {tab === 'overview' && (
              <div className="space-y-4">
                <section className="rounded-xl border border-indigo-200/80 bg-white p-3.5 shadow-inner sm:p-4">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
                    <div className="min-w-0">
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-inner">
                          <ClipboardCheck className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-2xs font-semibold uppercase tracking-wider text-indigo-900">Case command center</p>
                          <h3 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-950">
                            {caseSignals.nextAction}
                          </h3>
                          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-600">
                            Confirm the required documents, review flags, then set quote/payment/disposition.
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <CaseWorkspaceStat
                          label="Documents"
                          value={caseSignals.missingDocs.length ? `${caseSignals.missingDocs.length} missing` : 'Complete'}
                          tone={caseSignals.missingDocs.length ? 'warn' : 'good'}
                        />
                        <CaseWorkspaceStat
                          label="Risk flags"
                          value={caseSignals.risks.length ? `${caseSignals.risks.length} flag(s)` : 'None'}
                          tone={caseSignals.risks.length ? 'warn' : 'good'}
                        />
                        <CaseWorkspaceStat
                          label="Admin action"
                          value={claimItem.status === 'Pending Review' ? 'Pending review' : claimItem.status}
                          tone={claimItem.status === 'Pending Review' ? 'warn' : 'good'}
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void navigateTab('evidence')}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50"
                        >
                          Review evidence
                        </button>
                        <button
                          type="button"
                          onClick={() => void navigateTab('submission')}
                          className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
                        >
                          Open full submission
                        </button>
                        {!claimsReadOnly ? (
                          <button
                            type="button"
                            onClick={() => void navigateTab('quotes')}
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-2xs font-semibold text-indigo-900 transition hover:bg-indigo-100"
                          >
                            Workshop / quote
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-3 shadow-inner">
                        <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Priority checklist</p>
                        {caseSignals.actions.length ? (
                          <ul className="mt-2 grid gap-1.5">
                            {caseSignals.actions.slice(0, 4).map((action) => (
                              <li key={action} className="flex items-start gap-2 text-sm text-zinc-700">
                                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" strokeWidth={2} />
                                <span>{action}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2 text-sm text-zinc-600">No immediate admin actions detected.</p>
                        )}
                      </div>
                      <div className="rounded-xl border border-zinc-200/90 bg-zinc-50/70 p-3 shadow-inner">
                        <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Handling flags</p>
                        {caseSignals.risks.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {caseSignals.risks.map((risk) => (
                              <span key={risk} className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-2xs font-semibold text-amber-950">
                                {risk}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-zinc-600">No special risk flags detected.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <DocumentChecklist documents={caseSignals.documents} onViewEvidence={() => void navigateTab('evidence')} />

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
                    <SummaryItem label="Parts" value={partsSummaryText} />
                  </dl>
                  {!claimsReadOnly && (
                    <div className="mt-4 rounded-xl border border-indigo-200/90 bg-indigo-50/70 p-3.5">
                      <p className="text-xs leading-relaxed text-indigo-950">
                        Changes save to Horizon API (insurance quote, purchase lines, notes). Upload claim form PDFs on the Claim form PDF tab.
                      </p>
                      <button
                        type="button"
                        onClick={() => void navigateTab('quotes')}
                        className="mt-2.5 inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                        Open insurance quote
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailCard
                    title="Vehicle and driver"
                    items={[
                      ['Owner', data.memberVehicle?.ownerName],
                      ['Driver', claimItem.driverName],
                      ['Plate', claimItem.plateNumber],
                      ['Vehicle', [data.memberVehicle?.make, data.memberVehicle?.model].filter(Boolean).join(' ')],
                      ['Claim type', data.memberVehicle?.claimType],
                    ]}
                  />
                  <DetailCard
                    title="Incident"
                    items={[
                      ['Date', claimItem.dateOfIncident],
                      ['Street', data.incident?.streetName],
                      ['Suburb', data.incident?.suburb],
                      ['Road surface', data.incident?.roadSurface],
                      ['Traffic controls', Array.isArray(data.incident?.trafficControls) ? data.incident.trafficControls.join(', ') : data.incident?.trafficControls],
                      ['Description', data.incident?.description || claimItem.summary],
                    ]}
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DetailCard
                    title="Damage and towing"
                    items={[
                      ['Claiming damage', data.damage?.claimingDamage],
                      ['Vehicle towed', data.damage?.towed],
                      ['Current location', data.damage?.currentVehicleLocation],
                      ['Damage markings', damageMarkerCount || damageStrokeCount ? `${damageMarkerCount} marker(s), ${damageStrokeCount} drawing(s)` : 'None mapped'],
                    ]}
                  />
                  <DetailCard
                    title="Parties and witnesses"
                    items={[
                      ['Other parties', otherParties.length ? `${otherParties.length} recorded` : 'None recorded'],
                      ['Witness 1', witnessDetails.witness1Name],
                      ['Witness 1 mobile', witnessDetails.witness1Mobile],
                      ['Witness 2', witnessDetails.witness2Name],
                      ['Witness 2 mobile', witnessDetails.witness2Mobile],
                    ]}
                  />
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
                {!claimsReadOnly && onRequestDelete ? (
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

            {tab === 'documents' && (
              <div className="space-y-4">
                <DocumentChecklist documents={caseSignals.documents} onViewEvidence={() => void navigateTab('evidence')} />
                <div className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner">
                  <h3 className="text-[13px] font-semibold text-zinc-900">Where to inspect files</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                    Licence, registration, photos, sketches, and declaration images live in Evidence.
                    Workshop PDFs and invoices are handled from Insurance quote and Purchase.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void navigateTab('evidence')}
                      className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-3 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
                    >
                      Open evidence
                    </button>
                    {!claimsReadOnly ? (
                      <button
                        type="button"
                        onClick={() => void navigateTab('parts')}
                        className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50"
                      >
                        Open parts tab
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {false && tab === 'records' && (
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

            {false && tab === 'parties' && (
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
                      {!claimsReadOnly ? (
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
                      {!claimsReadOnly ? (
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-[13px] font-semibold text-zinc-900">Repair quotes</h3>
                      <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                        Optional workshop lines. Add notes on each quote for internal context.
                      </p>
                    </div>
                    {!claimsReadOnly && (
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
                          {!claimsReadOnly ? (
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
                              <div>
                                <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                                  Quote PDF
                                </p>
                                {q.fileId ? (
                                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2">
                                    <FileText className="h-4 w-4 shrink-0 text-indigo-600" strokeWidth={2} />
                                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                                      {q.fileName || 'Quote.pdf'}
                                    </span>
                                    <CasePdfFileActions
                                      file={{ id: q.fileId, name: q.fileName, url: q.fileUrl }}
                                    />
                                    <button
                                      type="button"
                                      disabled={quotePdfBusyId === q.id}
                                      onClick={() => handleRemoveRepairQuotePdf(q.id)}
                                      className="rounded-lg border border-rose-200/90 p-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                      aria-label="Remove quote PDF"
                                    >
                                      <Trash2 className="h-4 w-4" strokeWidth={2} />
                                    </button>
                                  </div>
                                ) : (
                                  <label
                                    className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-4 text-center transition hover:border-indigo-300 hover:bg-indigo-50/40 ${quotePdfBusyId === q.id ? 'pointer-events-none opacity-60' : ''}`}
                                  >
                                    <Upload className="h-5 w-5 text-indigo-600" strokeWidth={2} />
                                    <span className="mt-1.5 text-xs font-semibold text-indigo-900">
                                      {quotePdfBusyId === q.id ? 'Uploading…' : 'Upload quote PDF'}
                                    </span>
                                    <span className="mt-0.5 text-2xs text-zinc-500">PDF only, up to 25&nbsp;MB</span>
                                    <input
                                      type="file"
                                      accept="application/pdf,.pdf"
                                      className="sr-only"
                                      disabled={quotePdfBusyId === q.id}
                                      onChange={(e) => handleRepairQuotePdfUpload(q.id, e)}
                                    />
                                  </label>
                                )}
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
                              {q.fileId ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                                    Quote PDF
                                  </span>
                                  <CasePdfFileActions
                                    file={{ id: q.fileId, name: q.fileName, url: q.fileUrl }}
                                  />
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                    ))}
                  </div>
                  )}
                  {!claimsReadOnly && (
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
                          disabled={claimsReadOnly}
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
                      {!claimsReadOnly && (
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
                    Internal notes visible to staff on this case file.
                  </p>
                  <label htmlFor={`admin-note-${claimItem.id}`} className="sr-only">
                    Admin note
                  </label>
                  <textarea
                    id={`admin-note-${claimItem.id}`}
                    rows={5}
                    value={claimsReadOnly ? adminNote : adminNoteDraft}
                    readOnly={claimsReadOnly}
                    onChange={(e) => {
                      if (claimsReadOnly) return;
                      setAdminNoteDraft(e.target.value);
                      if (adminNoteSave === 'saved') setAdminNoteSave('idle');
                      setAdminNoteSaveKind(null);
                    }}
                    placeholder="e.g. Called member — awaiting bank details."
                    className="mt-3 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-inner outline-none placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 read-only:bg-zinc-50 read-only:text-zinc-700"
                  />
                  {!claimsReadOnly && (
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

            {tab === 'parts' && (
              <div className="space-y-6">
                <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-zinc-50 text-zinc-700 shadow-inner">
                        <Package className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <div>
                        <h3 className="text-[13px] font-semibold text-zinc-900">Parts</h3>
                        <p className="mt-1 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                          Supplier, part details, dates, invoice upload (PDF), and line status. Super administrators can edit all fields; administrators can update status and invoices.
                        </p>
                      </div>
                    </div>
                    {!claimsReadOnly && canFullPartsCrud ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => addPart()}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200/90 bg-indigo-50 px-2.5 text-2xs font-semibold text-indigo-900 hover:bg-indigo-100"
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                          Add part line
                        </button>
                        <button
                          type="button"
                          onClick={() => addPart(partsDraft[partsDraft.length - 1])}
                          disabled={partsDraft.length === 0}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200/90 bg-white px-2.5 text-2xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                          Add another (same supplier & dates)
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {parts.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                      No part lines yet.
                      {!claimsReadOnly && ' Use Add part line to create a row.'}
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
                              Part line {index + 1}
                            </p>
                            {!claimsReadOnly && canFullPartsCrud && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => addPartLike(p.id)}
                                  className="rounded-lg border border-zinc-200/90 p-1.5 text-zinc-700 hover:bg-zinc-50"
                                  title="Add new line with same supplier and dates"
                                  aria-label="Copy supplier and dates to new line"
                                >
                                  <Copy className="h-4 w-4" strokeWidth={2} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePart(p.id)}
                                  className="rounded-lg border border-rose-200/90 p-1.5 text-rose-700 hover:bg-rose-50"
                                  aria-label="Remove purchase line"
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                                </button>
                              </div>
                            )}
                          </div>
                          <PartLineFields
                            part={p}
                            token={authToken}
                            catalogLinkSnapshot={catalogLinkSnapshot(p)}
                            detailsReadOnly={partsFieldsReadOnly && savedParts.some((s) => s.id === p.id)}
                            readOnly={claimsReadOnly}
                            partNextInvoiceNumber={partNextInvoiceNumber[p.id] ?? ''}
                            onNextInvoiceNumberChange={(value) =>
                              setPartNextInvoiceNumber((prev) => ({ ...prev, [p.id]: value }))
                            }
                            partInvoiceBusyId={partInvoiceBusyId}
                            onUpload={(e) => handlePartInvoiceUpload(p.id, e)}
                            onFieldChange={updatePartDraft}
                            onApplySuggestion={applyPartSuggestionToDraft}
                            onInvoiceNumberChange={(invoiceId, value) =>
                              updatePartInvoiceNumber(p.id, invoiceId, value)
                            }
                            onRemoveInvoice={(invoiceId) => removePartInvoice(p.id, invoiceId)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {!claimsReadOnly && (
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
                          entity: 'parts',
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

            {tab === 'claimFormPdf' && (
              <div className="space-y-6">
                {isAdminBuyerPdf ? (
                  <section className="rounded-xl border border-violet-200/70 bg-white p-4 shadow-inner sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 shadow-inner">
                          <FileText className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-[13px] font-semibold text-zinc-900">Claim form PDF</h3>
                          <p className="mt-0.5 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                            Original scanned claim form from admin OCR intake, plus any additional supporting PDFs.
                            Stored at <span className="font-semibold">{api.apiBase()}</span>
                            <span className="font-mono"> /uploads</span>.
                          </p>
                        </div>
                      </div>
                      {!claimsReadOnly && (
                        <>
                          <input
                            ref={additionalFileInputRef}
                            type="file"
                            accept="application/pdf,.pdf"
                            multiple
                            className="sr-only"
                            onChange={handleAdditionalPdfInput}
                          />
                          <button
                            type="button"
                            disabled={pdfBusy}
                            onClick={() => !pdfBusy && additionalFileInputRef.current?.click()}
                            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-indigo-200/90 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-wait disabled:opacity-70"
                          >
                            <Upload className="h-4 w-4" strokeWidth={2} />
                            {pdfBusy ? (authToken ? 'Uploading…' : 'Reading PDF…') : 'Upload document'}
                          </button>
                        </>
                      )}
                    </div>

                    <div className="mt-5 space-y-5">
                      <div>
                        <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                          Claim form PDF (intake)
                        </p>
                        {intakeFiles.length === 0 ? (
                          <p className="mt-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5 text-center text-sm text-zinc-500">
                            No claim form PDF on record.
                          </p>
                        ) : (
                          <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
                            {intakeFiles.map((file) => (
                              <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                                <FileText className="h-4 w-4 shrink-0 text-violet-600" strokeWidth={2} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                                  <p className="text-2xs text-zinc-500">
                                    {formatFileSize(file.size)} · {file.uploadedAt}
                                    <span className="ml-1.5 rounded border border-violet-200 bg-violet-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
                                      Intake
                                    </span>
                                  </p>
                                </div>
                                <CasePdfFileActions file={file} />
                                {!claimsReadOnly && (
                                  <button
                                    type="button"
                                    disabled={pdfBusy}
                                    onClick={() => {
                                      void (async () => {
                                        if (
                                          await confirmDelete(
                                            'Remove the original claim form PDF? This cannot be undone.',
                                            'Remove PDF?',
                                          )
                                        ) {
                                          removePdf(file.id);
                                        }
                                      })();
                                    }}
                                    className="rounded-lg border border-rose-200/90 p-1.5 text-rose-700 hover:bg-rose-50"
                                    aria-label={`Remove claim form PDF ${file.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="border-t border-zinc-100 pt-5">
                        <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">
                          Additional documents
                        </p>
                        {additionalFiles.length === 0 ? (
                          <p className="mt-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5 text-center text-sm text-zinc-500">
                            No additional documents yet. Use Upload document above.
                          </p>
                        ) : (
                          <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
                            {additionalFiles.map((file) => (
                              <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                                <FileText className="h-4 w-4 shrink-0 text-indigo-600" strokeWidth={2} />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                                  <p className="text-2xs text-zinc-500">
                                    {formatFileSize(file.size)} · {file.uploadedAt}
                                  </p>
                                </div>
                                <CasePdfFileActions file={file} />
                                {!claimsReadOnly && (
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
                      </div>
                    </div>
                  </section>
                ) : (
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
                      {!claimsReadOnly && (
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
                    {generalFiles.length === 0 ? (
                      <p className="mt-4 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                        No PDFs uploaded yet.
                      </p>
                    ) : (
                      <ul className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
                        {generalFiles.map((file) => (
                          <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-3 first:pt-3">
                            <FileText className="h-4 w-4 shrink-0 text-indigo-600" strokeWidth={2} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                              <p className="text-2xs text-zinc-500">
                                {formatFileSize(file.size)} · {file.uploadedAt}
                              </p>
                            </div>
                            <CasePdfFileActions file={file} />
                            {!claimsReadOnly && (
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
                )}

                {isRentalStatus && (
                  <section className="rounded-xl border border-indigo-200/70 bg-white p-4 shadow-inner sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 shadow-inner">
                          <Car className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-[13px] font-semibold text-zinc-900">Rental documents</h3>
                          <p className="mt-0.5 text-2xs leading-relaxed text-zinc-600 sm:text-xs">
                            Upload rental-related PDFs for this claim. Additional rental workflow features will be added in a future update.
                          </p>
                        </div>
                      </div>
                      {!claimsReadOnly && (
                        <>
                          <input
                            ref={rentalFileInputRef}
                            type="file"
                            accept="application/pdf,.pdf"
                            multiple
                            className="sr-only"
                            onChange={handleRentalPdfInput}
                          />
                          <button
                            type="button"
                            disabled={pdfBusy}
                            onClick={() => !pdfBusy && rentalFileInputRef.current?.click()}
                            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-indigo-200/90 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 disabled:cursor-wait disabled:opacity-70"
                          >
                            <Upload className="h-4 w-4" strokeWidth={2} />
                            {pdfBusy ? (authToken ? 'Uploading…' : 'Reading PDF…') : 'Upload rental PDF'}
                          </button>
                        </>
                      )}
                    </div>
                    {rentalFiles.length === 0 ? (
                      <p className="mt-4 rounded-xl border border-dashed border-indigo-100 bg-indigo-50/50 px-4 py-8 text-center text-sm text-indigo-500">
                        No rental documents uploaded yet.
                      </p>
                    ) : (
                      <ul className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-100">
                        {rentalFiles.map((file) => (
                          <li key={file.id} className="flex flex-wrap items-center gap-3 px-3 py-3 first:pt-3">
                            <Car className="h-4 w-4 shrink-0 text-indigo-600" strokeWidth={2} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                              <p className="text-2xs text-zinc-500">
                                {formatFileSize(file.size)} · {file.uploadedAt}
                              </p>
                            </div>
                            <CasePdfFileActions file={file} />
                            {!claimsReadOnly && (
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
                )}
              </div>
            )}
          </div>
          </main>
        </div>

        <PdfPreviewDialog
          open={pdfPreviewOpen}
          title={previewTitle}
          html={exportHtml}
          onClose={() => setPdfPreviewOpen(false)}
          onPrint={() => openClaimExportPrint(exportHtml)}
        />

          {claimsReadOnly ? (
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
                  onClick={() => setPdfPreviewOpen(true)}
                  className="inline-flex h-10 min-w-[8rem] flex-none items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 shadow-sm transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
                >
                  <FileSearch className="h-3.5 w-3.5" strokeWidth={2} />
                  Preview PDF
                </button>
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
                      onClick={onRental}
                      className="h-10 min-w-[7rem] flex-none rounded-xl border border-indigo-200/90 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
                    >
                      Rental
                    </button>
                    <button
                      type="button"
                      onClick={onCompleted}
                      className="h-10 min-w-[7.5rem] flex-none rounded-xl border border-teal-200/90 bg-teal-50 px-3 text-xs font-semibold text-teal-900 transition hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/80"
                    >
                      Completed
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
                    {claimStatus !== 'Rental' && (
                      <button
                        type="button"
                        onClick={onRental}
                        className="h-10 min-w-[7rem] flex-none rounded-xl border border-indigo-200/90 bg-indigo-50 px-3 text-xs font-semibold text-indigo-900 transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
                      >
                        Rental
                      </button>
                    )}
                    {claimStatus !== 'Completed' && (
                      <button
                        type="button"
                        onClick={onCompleted}
                        className="h-10 min-w-[7.5rem] flex-none rounded-xl border border-teal-200/90 bg-teal-50 px-3 text-xs font-semibold text-teal-900 transition hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/80"
                      >
                        Completed
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
