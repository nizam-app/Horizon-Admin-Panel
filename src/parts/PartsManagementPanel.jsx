import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Package,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import * as api from '../api.js';
import { alertError, alertWarning, confirmDialog } from '../swal.js';
import { canAddParts, canEditPartLines, canManagePartsCrud } from '../auth/roles.js';
import { labelClass, useHrLoadError } from '../hrPanelUtils.js';
import { HrFilterBar, HrPageHeader, HrSearchField, hrCardClass, hrPrimaryBtn, hrSecondaryBtn } from '../hr/HrUi.jsx';
import { PartLineFields, PartStatusBadge } from './PartLineFields.jsx';
import {
  applyPartSuggestion,
  catalogLinkSnapshot,
  removePartInvoiceFile,
  updatePartInList,
  uploadPartInvoice,
} from './partsInvoiceHelpers.js';
import {
  claimRefLabel,
  normalizeClaimLookupKey,
  extractPartSharedContext,
  formatAud,
  newPartLine,
  newPartLineFromSharedContext,
  normalizePartRow,
  purchaseInputClass,
  validatePartLineDraft,
} from './partUtils.js';

function registryRowAsPart(row) {
  if (row?.part && typeof row.part === 'object') return row.part;
  return {
    company: row?.supplier,
    orderDate: row?.orderDate,
    tentativeReceivedDate: row?.tentativeReceivedDate,
    receivedBy: row?.part?.receivedBy,
    status: row?.status,
    notes: row?.part?.notes,
    supplierId: row?.part?.supplierId,
  };
}

function StatCard({ title, value, icon: Icon, tone = 'slate' }) {
  const tones = {
    slate: 'from-zinc-50/80 text-zinc-600 bg-zinc-100',
    amber: 'from-amber-50/70 text-amber-700 bg-amber-100',
    emerald: 'from-emerald-50/70 text-emerald-700 bg-emerald-100',
    rose: 'from-rose-50/70 text-rose-700 bg-rose-100',
    indigo: 'from-indigo-50/70 text-indigo-700 bg-indigo-100',
  };
  const t = tones[tone] || tones.slate;
  return (
    <div className={`rounded-2xl border border-zinc-200/90 bg-gradient-to-br to-white p-4 shadow-card ${t.split(' ')[0]}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{title}</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-zinc-950">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${t.split(' ').slice(1).join(' ')}`}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 25;

const tableActionBtn =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-2xs font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60';

function claimIdDisplay(row) {
  const ref = claimRefLabel(row);
  if (ref && ref !== '—') return ref;
  return row.claimId ? String(row.claimId).slice(-8) : '—';
}

function PartsPaginationBar({ page, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= 0) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 bg-white px-4 py-2.5 text-2xs text-zinc-600">
      <span>
        Showing <span className="font-medium text-zinc-800">{from}–{to}</span> of{' '}
        <span className="font-medium text-zinc-800">{total}</span>
        <span className="mx-2 text-zinc-300">·</span>
        Page <span className="font-medium text-zinc-800">{page}</span> of {totalPages}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={hrSecondaryBtn}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className={hrSecondaryBtn}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function ClaimContextCard({
  reference,
  plateNumber,
  customerName,
  mongoId,
  onMongoIdChange,
  mongoEditable = false,
  claimInputInvalid = false,
  claimLookupLoading = false,
}) {
  const claimInputClass = claimInputInvalid
    ? `${purchaseInputClass} mt-1 font-mono text-xs border-rose-400 ring-2 ring-rose-500/25 focus:border-rose-500`
    : `${purchaseInputClass} mt-1 font-mono text-xs`;
  const vehicleLabel = claimLookupLoading ? 'Looking up…' : plateNumber || '—';
  const customerLabel = claimLookupLoading ? 'Looking up…' : customerName || '—';

  return (
    <div className="rounded-xl border border-zinc-200/90 bg-gradient-to-br from-zinc-50/90 to-white p-4 shadow-sm ring-1 ring-zinc-950/[0.03]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Claim reference</p>
          <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-950">{reference || '—'}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200/80 bg-white px-3 py-2.5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">Vehicle</p>
          <p className={`mt-1 text-sm font-medium leading-snug ${claimLookupLoading ? 'text-zinc-400' : 'text-zinc-900'}`}>
            {vehicleLabel}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200/80 bg-white px-3 py-2.5">
          <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-400">Customer</p>
          <p className={`mt-1 text-sm font-medium leading-snug ${claimLookupLoading ? 'text-zinc-400' : 'text-zinc-900'}`}>
            {customerLabel}
          </p>
        </div>
      </div>
      {mongoEditable ? (
        <div className="mt-3">
          <label className="block text-2xs font-semibold uppercase tracking-wider text-zinc-500">Claim ID</label>
          <input
            className={claimInputClass}
            value={mongoId}
            onChange={(e) => onMongoIdChange?.(e.target.value)}
            placeholder="Mongo ID, HRZ reference, or member code"
            aria-invalid={claimInputInvalid}
          />
          {claimInputInvalid ? (
            <p className="mt-1 text-2xs text-rose-600">
              No claim found for this ID. Paste the exact value from the Claim ID column (HRZ, member code, or Mongo id).
            </p>
          ) : (
            <p className="mt-1 text-2xs text-zinc-500">Vehicle and customer fill in automatically when the claim is found.</p>
          )}
        </div>
      ) : mongoId ? (
        <p className="mt-3 truncate font-mono text-[10px] text-zinc-400" title={mongoId}>
          ID: {mongoId}
        </p>
      ) : null}
    </div>
  );
}

export function PartsManagementPanel({ token, sessionRole, onAuthError, onOpenClaim }) {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [supplier, setSupplier] = useState('');
  const [hasInvoice, setHasInvoice] = useState('');
  const [receivedFrom, setReceivedFrom] = useState('');
  const [receivedTo, setReceivedTo] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editDraft, setEditDraft] = useState(() => newPartLine());
  const [editBusy, setEditBusy] = useState(false);
  const [editFieldErrors, setEditFieldErrors] = useState(null);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('');
  const [addFieldErrors, setAddFieldErrors] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addClaimId, setAddClaimId] = useState('');
  const [addClaimRef, setAddClaimRef] = useState('');
  const [addDraft, setAddDraft] = useState(() => newPartLine());
  const [addInvoiceNumber, setAddInvoiceNumber] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [lastAddSession, setLastAddSession] = useState(null);
  const [addClaimPreview, setAddClaimPreview] = useState(null);
  const [addClaimResolvedId, setAddClaimResolvedId] = useState('');
  const [addClaimLookup, setAddClaimLookup] = useState('idle');

  const canAdd = canAddParts(sessionRole);
  const canEdit = canEditPartLines(sessionRole);
  const addRepeatContext = Boolean(
    lastAddSession?.claimId && addClaimId.trim() === lastAddSession.claimId && String(addDraft.company ?? '').trim(),
  );
  const superCrud = canManagePartsCrud(sessionRole);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [sum, list] = await Promise.all([
        api.getPartsSummary(token),
        api.listPartsRegistry(token, {
          q: q.trim() || undefined,
          status: statusFilter || undefined,
          supplier: supplier.trim() || undefined,
          hasInvoice: hasInvoice || undefined,
          receivedFrom: receivedFrom || undefined,
          receivedTo: receivedTo || undefined,
          page,
          limit: PAGE_SIZE,
        }),
      ]);
      setSummary(sum);
      setRows(list.parts);
      setTotal(list.total);
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    } finally {
      setLoading(false);
    }
  }, [token, q, statusFilter, supplier, hasInvoice, receivedFrom, receivedTo, page, onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = normalizeClaimLookupKey(addClaimId);
    if (!addOpen || !token || !id) {
      setAddClaimPreview(null);
      setAddClaimResolvedId('');
      setAddClaimLookup('idle');
      return;
    }
    setAddClaimLookup('loading');
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .lookupClaimForParts(token, id)
        .then((hit) => {
          if (cancelled) return;
          const resolved = api.normalizeClaimId(hit?.claimId);
          setAddClaimResolvedId(resolved);
          setAddClaimLookup(resolved ? 'valid' : 'invalid');
          setAddClaimPreview({
            plateNumber: hit?.plateNumber || '',
            customerName: hit?.customerName || '',
            reference: hit?.intakeReference || hit?.reference || '',
          });
          setAddClaimRef(hit?.intakeReference || hit?.reference || id);
        })
        .catch(() => {
          if (!cancelled) {
            setAddClaimPreview(null);
            setAddClaimResolvedId('');
            setAddClaimLookup('invalid');
          }
        });
    }, 320);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [addOpen, addClaimId, token]);

  const openEditModal = async (row) => {
    if (!canEdit) return;
    setEditFieldErrors(null);
    setNextInvoiceNumber('');
    setEditRow(row);
    setEditDraft(normalizePartRow(row.part || {}));
    setEditOpen(true);
    try {
      const detail = await api.getPartLine(token, row.claimId, row.partId);
      setEditRow(detail.part);
      setEditDraft(normalizePartRow(detail.part?.part || row.part || {}));
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    }
  };

  const saveEdit = async () => {
    if (!editRow || !canEdit) return;
    const { valid, errors } = validatePartLineDraft(editDraft);
    if (!valid) {
      setEditFieldErrors(errors);
      return;
    }
    setEditFieldErrors(null);
    setEditBusy(true);
    try {
      const body = api.mapPartsForApi([{ ...editDraft, id: editRow.partId }])[0];
      await api.patchPartLine(token, editRow.claimId, editRow.partId, body);
      setEditOpen(false);
      setEditRow(null);
      await load();
    } catch (e) {
      await alertError(e?.message || 'Could not save part');
    } finally {
      setEditBusy(false);
    }
  };

  const removeLine = async () => {
    if (!editRow || !superCrud) return;
    if (!(await confirmDialog('Delete this part line from the claim?', 'Delete part line?'))) return;
    setEditBusy(true);
    try {
      await api.deletePartLine(token, editRow.claimId, editRow.partId);
      setEditOpen(false);
      setEditRow(null);
      await load();
    } catch (e) {
      await alertError(e?.message || 'Could not delete part');
    } finally {
      setEditBusy(false);
    }
  };

  const deleteRowInline = async (row) => {
    if (!superCrud) return;
    if (!(await confirmDialog('Delete this part line from the claim?', 'Delete part line?'))) return;
    setEditBusy(true);
    try {
      await api.deletePartLine(token, row.claimId, row.partId);
      await load();
    } catch (e) {
      await alertError(e?.message || 'Could not delete part');
    } finally {
      setEditBusy(false);
    }
  };

  const openAddModal = (seedRow = null) => {
    setAddClaimLookup('idle');
    setAddClaimResolvedId('');
    setAddInvoiceNumber('');
    if (seedRow) {
      setAddClaimId(seedRow.claimId || '');
      setAddClaimResolvedId(seedRow.claimId || '');
      setAddClaimLookup(seedRow.claimId ? 'valid' : 'idle');
      setAddClaimRef(claimRefLabel(seedRow));
      setAddClaimPreview({
        plateNumber: seedRow.plateNumber || '',
        customerName: seedRow.customerName || '',
        reference: claimRefLabel(seedRow),
      });
      setAddDraft(newPartLineFromSharedContext(extractPartSharedContext(registryRowAsPart(seedRow))));
    } else if (lastAddSession?.claimId) {
      setAddClaimId(lastAddSession.claimId);
      setAddClaimResolvedId(lastAddSession.claimId);
      setAddClaimLookup('valid');
      setAddClaimRef(lastAddSession.claimRef || '');
      setAddDraft(newPartLineFromSharedContext(lastAddSession.shared));
    } else {
      setAddClaimId('');
      setAddClaimRef('');
      setAddDraft(newPartLine());
    }
    setAddFieldErrors(null);
    setAddOpen(true);
  };

  const submitAdd = async ({ addAnother = false } = {}) => {
    const claimKey = addClaimId.trim();
    if (!claimKey) {
      setAddClaimLookup('invalid');
      await alertWarning('Enter a claim ID from the queue (Mongo ID, HRZ reference, or member code).');
      return;
    }
    if (addClaimLookup === 'invalid' || (addClaimLookup !== 'valid' && !addClaimResolvedId)) {
      setAddClaimLookup('invalid');
      await alertWarning('Claim not found. Check the ID and try again.');
      return;
    }
    const { valid, errors } = validatePartLineDraft(addDraft);
    if (!valid) {
      setAddFieldErrors(errors);
      return;
    }
    setAddFieldErrors(null);
    setAddBusy(true);
    try {
      const body = api.mapPartsForApi([addDraft])[0];
      const claimIdForApi = addClaimResolvedId || claimKey;
      await api.createPartLine(token, claimIdForApi, body);
      const shared = extractPartSharedContext(addDraft);
      const claimId = addClaimResolvedId || claimKey;
      const claimRef = addClaimRef || claimId.slice(-8);
      setLastAddSession({ claimId, claimRef, shared });
      if (addAnother) {
        setAddDraft(newPartLineFromSharedContext(shared));
        setAddInvoiceNumber('');
        await load();
      } else {
        setAddOpen(false);
        setAddDraft(newPartLine());
        setAddClaimId('');
        setAddClaimRef('');
        setAddInvoiceNumber('');
        await load();
      }
    } catch (e) {
      await alertError(e?.message || 'Could not add part');
    } finally {
      setAddBusy(false);
    }
  };

  const handleEditFieldChange = (_id, field, raw, linkSnapshot = null) => {
    setEditDraft((p) => updatePartInList(p, field, raw, linkSnapshot));
    if (editFieldErrors?.[field]) {
      setEditFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return Object.keys(next).length ? next : null;
      });
    }
  };

  const handleAddFieldChange = (_id, field, raw, linkSnapshot = null) => {
    setAddDraft((p) => updatePartInList(p, field, raw, linkSnapshot));
    if (addFieldErrors?.[field]) {
      setAddFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return Object.keys(next).length ? next : null;
      });
    }
  };

  const handleEditUpload = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !editRow) return;
    setInvoiceBusy(true);
    try {
      const inv = await uploadPartInvoice({
        token,
        claimId: editRow.claimId,
        file,
        invoiceNumber: nextInvoiceNumber,
      });
      setEditDraft((d) =>
        normalizePartRow({
          ...d,
          invoices: [...(d.invoices ?? []), inv],
        }),
      );
      setNextInvoiceNumber('');
    } catch (e) {
      await alertError(e?.message || 'Upload failed');
    } finally {
      setInvoiceBusy(false);
    }
  };

  const handleAddUpload = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !addClaimResolvedId) {
      await alertWarning('Enter a valid claim ID before uploading an invoice PDF.');
      return;
    }
    setInvoiceBusy(true);
    try {
      const inv = await uploadPartInvoice({
        token,
        claimId: addClaimResolvedId || addClaimId.trim(),
        file,
        invoiceNumber: addInvoiceNumber,
      });
      setAddDraft((p) =>
        normalizePartRow({
          ...p,
          invoices: [...(p.invoices ?? []), inv],
        }),
      );
      setAddInvoiceNumber('');
    } catch (e) {
      await alertError(e?.message || 'Upload failed');
    } finally {
      setInvoiceBusy(false);
    }
  };

  const addClaimReady = Boolean(addClaimId.trim() && addClaimLookup === 'valid' && addClaimResolvedId);

  const stats = useMemo(() => {
    const s = summary || {};
    return {
      total: s.total ?? 0,
      pending: s.pending ?? 0,
      completed: s.completed ?? 0,
      missing: s.missingInvoice ?? '—',
      amount: formatAud(s.totalAmount ?? 0),
    };
  }, [summary]);

  const colCount = 11;

  return (
    <div className="space-y-4">
      <HrPageHeader
        title="Parts Management"
        description="All part lines across claims. Administrators can add and edit lines, update status, and upload invoices. Super administrators can also delete lines."
        icon={Package}
      />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard title="Total lines" value={stats.total} icon={Package} tone="indigo" />
        <StatCard title="Pending" value={stats.pending} icon={Clock3} tone="amber" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} tone="emerald" />
        <StatCard title="Missing invoice" value={stats.missing} icon={FileText} tone="rose" />
        <div className="col-span-2 lg:col-span-1">
          <StatCard title="Total amount" value={stats.amount} icon={Package} tone="slate" />
        </div>
      </div>

      <div className={hrCardClass}>
        <HrFilterBar>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1">
              <HrSearchField
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search reference, plate, customer, supplier, part…"
              />
            </div>
            {canAdd ? (
              <button
                type="button"
                onClick={() => openAddModal()}
                className={`${hrPrimaryBtn} w-full shrink-0 sm:w-auto`}
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                Add part
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <div className="sm:col-span-1 lg:col-span-2">
              <label className={labelClass}>Status</label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className={`${purchaseInputClass} mt-1.5`}
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div className="sm:col-span-1 lg:col-span-3">
              <label className={labelClass}>Supplier</label>
              <input
                type="text"
                value={supplier}
                onChange={(e) => {
                  setSupplier(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter by supplier"
                className={`${purchaseInputClass} mt-1.5`}
              />
            </div>
            <div className="sm:col-span-1 lg:col-span-2">
              <label className={labelClass}>Invoice</label>
              <select
                value={hasInvoice}
                onChange={(e) => {
                  setHasInvoice(e.target.value);
                  setPage(1);
                }}
                className={`${purchaseInputClass} mt-1.5`}
              >
                <option value="">Any invoice</option>
                <option value="true">Has PDF</option>
                <option value="false">Missing PDF</option>
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <label className={labelClass}>Tentative received</label>
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <input
                  type="date"
                  value={receivedFrom}
                  onChange={(e) => {
                    setReceivedFrom(e.target.value);
                    setPage(1);
                  }}
                  className={`${purchaseInputClass} min-w-0 flex-1`}
                  aria-label="Received from"
                />
                <span className="shrink-0 text-2xs font-medium text-zinc-400">to</span>
                <input
                  type="date"
                  value={receivedTo}
                  onChange={(e) => {
                    setReceivedTo(e.target.value);
                    setPage(1);
                  }}
                  className={`${purchaseInputClass} min-w-0 flex-1`}
                  aria-label="Received to"
                />
              </div>
            </div>
          </div>
        </HrFilterBar>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50/80 text-2xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-3 font-semibold">Claim ID</th>
                <th className="px-3 py-3 font-semibold">Vehicle</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold">Supplier</th>
                <th className="px-3 py-3 font-semibold">Part</th>
                <th className="px-3 py-3 font-semibold">Amount</th>
                <th className="px-3 py-3 font-semibold">Order date</th>
                <th className="px-3 py-3 font-semibold">Tent. received</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Invoice</th>
                <th className="px-3 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-10 text-center text-zinc-500">Loading parts…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-10 text-center text-zinc-500">No part lines match your filters.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.claimId}-${row.partId}`} className="hover:bg-zinc-50/60">
                    <td className="px-3 py-2.5 font-mono text-xs text-zinc-800">{claimIdDisplay(row)}</td>
                    <td className="px-3 py-2.5 text-zinc-800">{row.plateNumber || '—'}</td>
                    <td className="px-3 py-2.5 text-zinc-800">{row.customerName || '—'}</td>
                    <td className="px-3 py-2.5 text-zinc-700">{row.supplier || '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-zinc-900">{row.partName || '—'}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-zinc-900">{formatAud(row.amount)}</td>
                    <td className="px-3 py-2.5 text-xs text-zinc-600">{row.orderDate || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-zinc-600">{row.tentativeReceivedDate || '—'}</td>
                    <td className="px-3 py-2.5">
                      <PartStatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2.5 text-2xs text-zinc-600">
                      {row.hasInvoice ? `Yes (${row.invoiceCount || 1})` : 'No'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canAdd ? (
                          <button
                            type="button"
                            onClick={() => openAddModal(row)}
                            className={`${tableActionBtn} border-emerald-200/90 bg-emerald-50 text-emerald-900 hover:bg-emerald-100`}
                          >
                            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                            Add another
                          </button>
                        ) : null}
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className={`${tableActionBtn} border-indigo-200/90 bg-indigo-50 text-indigo-900 hover:bg-indigo-100`}
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                            Edit
                          </button>
                        ) : null}
                        {superCrud ? (
                          <button
                            type="button"
                            disabled={editBusy}
                            onClick={() => deleteRowInline(row)}
                            className={`${tableActionBtn} border-rose-200/90 bg-rose-50 text-rose-900 hover:bg-rose-100`}
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE_SIZE ? (
          <div className="border-t border-zinc-100">
            <PartsPaginationBar page={page} total={total} onPageChange={setPage} />
          </div>
        ) : null}
      </div>

      {editOpen && editRow && canEdit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sheet-lg">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
              <h3 className="font-display text-base font-semibold text-zinc-950">Edit part line</h3>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {editFieldErrors ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-2xs text-rose-900">
                  Fix required fields below before saving.
                </div>
              ) : null}
              <ClaimContextCard
                reference={claimIdDisplay(editRow)}
                plateNumber={editRow.plateNumber}
                customerName={editRow.customerName}
                mongoId={editRow.claimId}
              />
              <PartLineFields
                part={editDraft}
                token={token}
                catalogLinkSnapshot={catalogLinkSnapshot(editDraft)}
                detailsReadOnly={false}
                readOnly={false}
                fieldErrors={editFieldErrors}
                partNextInvoiceNumber={nextInvoiceNumber}
                onNextInvoiceNumberChange={setNextInvoiceNumber}
                partInvoiceBusyId={invoiceBusy ? editDraft.id : null}
                onUpload={handleEditUpload}
                onFieldChange={handleEditFieldChange}
                onApplySuggestion={(_id, suggestion) =>
                  setEditDraft((p) => applyPartSuggestion(p, suggestion))
                }
                onInvoiceNumberChange={(invoiceId, value) =>
                  setEditDraft((p) =>
                    normalizePartRow({
                      ...p,
                      invoices: (p.invoices ?? []).map((inv) =>
                        inv.id === invoiceId ? { ...inv, invoiceNumber: value } : inv,
                      ),
                    }),
                  )
                }
                onRemoveInvoice={async (invoiceId) => {
                  const inv = (editDraft.invoices ?? []).find((r) => r.id === invoiceId);
                  await removePartInvoiceFile({ token, claimId: editRow.claimId, fileId: inv?.fileId });
                  setEditDraft((p) =>
                    normalizePartRow({
                      ...p,
                      invoices: (p.invoices ?? []).filter((r) => r.id !== invoiceId),
                    }),
                  );
                }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 p-4">
              <div className="flex flex-wrap gap-2">
                {onOpenClaim ? (
                  <button
                    type="button"
                    className={hrSecondaryBtn}
                    onClick={() => {
                      onOpenClaim(editRow.claimId, 'parts');
                      setEditOpen(false);
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open claim
                  </button>
                ) : null}
                {superCrud ? (
                  <button
                    type="button"
                    disabled={editBusy}
                    onClick={removeLine}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-2xs font-semibold text-rose-800 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete line
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={hrSecondaryBtn} onClick={() => setEditOpen(false)}>Cancel</button>
                <button type="button" disabled={editBusy} className={hrPrimaryBtn} onClick={saveEdit}>
                  {editBusy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {addOpen && canAdd ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sheet-lg">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
              <h3 className="font-display text-base font-semibold text-zinc-950">Add part to claim</h3>
              <button type="button" onClick={() => setAddOpen(false)} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-5">
              {addFieldErrors ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-2xs text-rose-900">
                  Fix required fields below before adding.
                </div>
              ) : null}
              <ClaimContextCard
                reference={addClaimRef || addClaimPreview?.reference || ''}
                plateNumber={addClaimPreview?.plateNumber}
                customerName={addClaimPreview?.customerName}
                mongoId={addClaimId}
                mongoEditable
                claimInputInvalid={addClaimLookup === 'invalid'}
                claimLookupLoading={addClaimLookup === 'loading'}
                onMongoIdChange={(value) => {
                  setAddClaimId(value);
                  if (!String(value).trim()) {
                    setAddClaimRef('');
                    setAddClaimResolvedId('');
                    setAddClaimLookup('idle');
                  }
                }}
              />
              <section
                className={`rounded-xl border border-zinc-200/90 p-4 ${addRepeatContext ? 'border-indigo-200/50 bg-indigo-50/20' : 'bg-zinc-50/30'}`}
              >
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">Shared details</h4>
                <p className="mt-0.5 text-2xs text-zinc-500">
                  {addRepeatContext
                    ? 'Supplier and dates carry over — update only if this order differs.'
                    : 'Supplier, order date, tentative received, status, and received by.'}
                </p>
                <div className="mt-3">
                  <PartLineFields
                    part={addDraft}
                    sectionMode="shared"
                    fieldErrors={addFieldErrors}
                    detailsReadOnly={false}
                    readOnly={false}
                    onFieldChange={handleAddFieldChange}
                  />
                </div>
              </section>
              <section className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm ring-1 ring-zinc-950/[0.02]">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">This line</h4>
                <p className="mt-0.5 text-2xs text-zinc-500">Part name, amount, and invoice for this row only.</p>
                <div className="mt-3">
                  <PartLineFields
                    part={addDraft}
                    token={token}
                    sectionMode="line"
                    fieldErrors={addFieldErrors}
                    catalogLinkSnapshot={catalogLinkSnapshot(addDraft)}
                    detailsReadOnly={false}
                    readOnly={false}
                    partNextInvoiceNumber={addInvoiceNumber}
                    onNextInvoiceNumberChange={setAddInvoiceNumber}
                    partInvoiceBusyId={invoiceBusy ? addDraft.id : null}
                    onUpload={handleAddUpload}
                    onFieldChange={handleAddFieldChange}
                    onApplySuggestion={(_id, suggestion) =>
                      setAddDraft((p) => applyPartSuggestion(p, suggestion))
                    }
                    onInvoiceNumberChange={(invoiceId, value) =>
                      setAddDraft((p) =>
                        normalizePartRow({
                          ...p,
                          invoices: (p.invoices ?? []).map((inv) =>
                            inv.id === invoiceId ? { ...inv, invoiceNumber: value } : inv,
                          ),
                        }),
                      )
                    }
                    onRemoveInvoice={async (invoiceId) => {
                      const inv = (addDraft.invoices ?? []).find((r) => r.id === invoiceId);
                      if (addClaimResolvedId) {
                        await removePartInvoiceFile({ token, claimId: addClaimResolvedId, fileId: inv?.fileId });
                      }
                      setAddDraft((p) =>
                        normalizePartRow({
                          ...p,
                          invoices: (p.invoices ?? []).filter((r) => r.id !== invoiceId),
                        }),
                      );
                    }}
                  />
                </div>
              </section>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-100 p-4">
              <button type="button" className={hrSecondaryBtn} onClick={() => setAddOpen(false)}>Cancel</button>
              <button
                type="button"
                disabled={addBusy || !addClaimReady}
                className={hrSecondaryBtn}
                onClick={() => submitAdd({ addAnother: true })}
              >
                {addBusy ? 'Adding…' : 'Add part & add another'}
              </button>
              <button type="button" disabled={addBusy || !addClaimReady} className={hrPrimaryBtn} onClick={() => submitAdd()}>
                {addBusy ? 'Adding…' : 'Add part'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
