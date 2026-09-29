export const PART_STATUS_OPTIONS = [
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Completed' },
];

export const purchaseInputClass =
  'h-9 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20';

export function newPartInvoiceId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fields reused when adding another part line on the same claim/order. Invoices stay per line. */
export function extractPartSharedContext(part) {
  const p = part && typeof part === 'object' ? part : {};
  return {
    company: String(p.company ?? '').trim(),
    orderDate: String(p.orderDate ?? '').trim(),
    tentativeReceivedDate: String(p.tentativeReceivedDate ?? '').trim(),
    receivedBy: String(p.receivedBy ?? '').trim(),
    status: String(p.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending',
    notes: String(p.notes ?? '').trim(),
  };
}

/** New line with shared claim-order context; part name, amount, and invoices start empty. */
export function newPartLineFromSharedContext(shared) {
  const s = shared && typeof shared === 'object' ? shared : {};
  return normalizePartRow({
    ...newPartLine(),
    company: s.company ?? '',
    orderDate: s.orderDate ?? '',
    tentativeReceivedDate: s.tentativeReceivedDate ?? '',
    receivedBy: s.receivedBy ?? '',
    status: s.status ?? 'pending',
    notes: s.notes ?? '',
  });
}

export function applySharedContextToPart(part, shared) {
  const base = part && typeof part === 'object' ? part : newPartLine();
  const seeded = newPartLineFromSharedContext(shared);
  return normalizePartRow({
    ...base,
    ...seeded,
    id: base.id,
    partName: '',
    amount: '',
    quotePrice: '',
    invoices: [],
    supplierPartId: null,
    listPriceSnapshot: null,
    _linkCompany: undefined,
    _linkPartName: undefined,
  });
}

export function newPartLine() {
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
    supplierId: null,
    supplierPartId: null,
    listPriceSnapshot: null,
  };
}

export function normalizePartInvoicesFromRow(p) {
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

export function normalizePartRow(p) {
  return {
    ...p,
    quotePrice: p?.quotePrice ?? '',
    invoices: normalizePartInvoicesFromRow(p),
  };
}

export function cloneParts(parts) {
  return (parts ?? []).map((p) => normalizePartRow(p));
}

export function partAmountInputValue(amount) {
  if (amount === '' || amount == null) return '';
  return String(amount);
}

export function partAmountNumber(amount) {
  const n = Number(String(amount ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function partOptionalMoneyNumber(amount) {
  if (amount === '' || amount == null) return null;
  const n = Number(String(amount).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function partsSnapshot(parts) {
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
      supplierId: p.supplierId == null ? null : String(p.supplierId),
      supplierPartId: p.supplierPartId == null ? null : String(p.supplierPartId),
      listPriceSnapshot: partOptionalMoneyNumber(p.listPriceSnapshot),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function partsEqual(a, b) {
  return JSON.stringify(partsSnapshot(a)) === JSON.stringify(partsSnapshot(b));
}

export function partStatusLabel(status) {
  const id = String(status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending';
  return PART_STATUS_OPTIONS.find((o) => o.id === id)?.label ?? 'Pending';
}

export function formatAud(amount) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(
    amount ?? 0,
  );
}

export function claimRefLabel(row) {
  return row?.claimReference || row?.intakeReference || row?.claimId || '—';
}

export function normalizeClaimLookupKey(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

export function validatePartLineDraft(part) {
  const errors = {};
  if (!String(part?.company ?? '').trim()) errors.company = 'Supplier name is required';
  if (!String(part?.partName ?? '').trim()) errors.partName = 'Part name is required';
  const amountStr = String(part?.amount ?? '').replace(/,/g, '').trim();
  if (amountStr === '') errors.amount = 'Amount is required';
  else {
    const n = Number(amountStr);
    if (!Number.isFinite(n) || n < 0) errors.amount = 'Enter a valid amount';
  }
  if (!String(part?.orderDate ?? '').trim()) errors.orderDate = 'Order date is required';
  if (!String(part?.tentativeReceivedDate ?? '').trim()) {
    errors.tentativeReceivedDate = 'Tentative received date is required';
  }
  const st = String(part?.status || 'pending').toLowerCase();
  if (st !== 'pending' && st !== 'completed') errors.status = 'Line status is required';
  return { valid: Object.keys(errors).length === 0, errors };
}
