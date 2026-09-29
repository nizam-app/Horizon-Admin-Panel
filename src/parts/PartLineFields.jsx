import {
  PART_STATUS_OPTIONS,
  formatAud,
  partAmountInputValue,
  partAmountNumber,
  partOptionalMoneyNumber,
  partStatusLabel,
  purchaseInputClass,
} from './partUtils.js';
import { PartInvoicesSection } from './PartInvoicesSection.jsx';
import { SUPPLIER_SUGGESTIONS_LIST_ID, SupplierPartSuggestions } from './SupplierPartSuggestions.jsx';

function fieldClass(base, hasError) {
  return hasError ? `${base} border-rose-400 ring-1 ring-rose-200/80` : base;
}

function PurchaseField({ label, children, className = '', error }) {
  return (
    <div className={className}>
      <span className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <p className="mt-1 text-2xs text-rose-600">{error}</p> : null}
    </div>
  );
}

export function PartStatusBadge({ status }) {
  const done = String(status || '').toLowerCase() === 'completed';
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-2xs font-semibold ${
        done
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-amber-200 bg-amber-50 text-amber-950'
      }`}
    >
      {partStatusLabel(status)}
    </span>
  );
}

/**
 * Full purchase / part line form (same fields as claim Parts tab).
 * @param detailsReadOnly — supplier, amounts, dates (admin on existing lines)
 * @param readOnly — entire form including invoices
 */
export function PartLineFields({
  part,
  token = null,
  showCatalogPicker = true,
  catalogLinkSnapshot = null,
  detailsReadOnly = false,
  readOnly = false,
  partNextInvoiceNumber = '',
  onNextInvoiceNumberChange,
  partInvoiceBusyId = null,
  onUpload,
  onInvoiceNumberChange,
  onRemoveInvoice,
  onFieldChange,
  onApplySuggestion,
  /** 'shared' | 'line' | omit for full form */
  sectionMode = null,
  fieldErrors = null,
}) {
  const p = part;
  const err = fieldErrors && typeof fieldErrors === 'object' ? fieldErrors : {};
  const update = (field, raw) => {
    if (readOnly || !onFieldChange) return;
    onFieldChange(p.id, field, raw, catalogLinkSnapshot);
  };

  const sharedFields = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <PurchaseField label="Supplier name" error={err.company}>
        {!detailsReadOnly && !readOnly ? (
            <input
              type="text"
              value={p.company}
              onChange={(e) => update('company', e.target.value)}
              className={fieldClass(purchaseInputClass, err.company)}
              placeholder="Supplier name"
              list={token ? SUPPLIER_SUGGESTIONS_LIST_ID : undefined}
              autoComplete="off"
            />
        ) : (
          <span className="text-sm text-zinc-900">{p.company || '—'}</span>
        )}
      </PurchaseField>
      <PurchaseField label="Order date" error={err.orderDate}>
        {!detailsReadOnly && !readOnly ? (
          <input
            type="date"
            value={p.orderDate ?? ''}
            onChange={(e) => update('orderDate', e.target.value)}
            className={fieldClass(purchaseInputClass, err.orderDate)}
          />
        ) : (
          <span className="text-sm text-zinc-900">{p.orderDate || '—'}</span>
        )}
      </PurchaseField>
      <PurchaseField label="Tentative received date" error={err.tentativeReceivedDate}>
        {!detailsReadOnly && !readOnly ? (
          <input
            type="date"
            value={p.tentativeReceivedDate ?? ''}
            onChange={(e) => update('tentativeReceivedDate', e.target.value)}
            className={fieldClass(purchaseInputClass, err.tentativeReceivedDate)}
          />
        ) : (
          <span className="text-sm text-zinc-900">{p.tentativeReceivedDate || '—'}</span>
        )}
      </PurchaseField>
      <PurchaseField label="Received by">
        {!detailsReadOnly && !readOnly ? (
          <input
            type="text"
            value={p.receivedBy ?? ''}
            onChange={(e) => update('receivedBy', e.target.value)}
            className={purchaseInputClass}
            placeholder="Name"
          />
        ) : (
          <span className="text-sm text-zinc-900">{p.receivedBy || '—'}</span>
        )}
      </PurchaseField>
      <PurchaseField label="Line status" error={err.status}>
        {!readOnly ? (
          <select
            value={p.status === 'completed' ? 'completed' : 'pending'}
            onChange={(e) => update('status', e.target.value)}
            className={fieldClass(purchaseInputClass, err.status)}
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
  );

  const lineFields = (
    <>
      {showCatalogPicker && token && !detailsReadOnly ? (
        <SupplierPartSuggestions
          token={token}
          part={p}
          readOnly={readOnly}
          onApplySuggestion={(suggestion) => onApplySuggestion?.(p.id, suggestion)}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <PurchaseField label="Parts name" error={err.partName}>
          {!detailsReadOnly && !readOnly ? (
            <input
              type="text"
              value={p.partName ?? ''}
              onChange={(e) => update('partName', e.target.value)}
              className={fieldClass(purchaseInputClass, err.partName)}
              placeholder="Parts name"
            />
          ) : (
            <span className="text-sm text-zinc-900">{p.partName || '—'}</span>
          )}
        </PurchaseField>
        <PurchaseField label="Amount (AUD)" error={err.amount}>
          {!detailsReadOnly && !readOnly ? (
            <input
              type="text"
              inputMode="decimal"
              value={partAmountInputValue(p.amount)}
              onChange={(e) => update('amount', e.target.value)}
              placeholder="0.00"
              className={fieldClass(`${purchaseInputClass} font-mono`, err.amount)}
            />
          ) : (
            <span className="font-mono text-sm text-zinc-900">{formatAud(partAmountNumber(p.amount))}</span>
          )}
        </PurchaseField>
        <PurchaseField label="Quote price (AUD)">
          {!detailsReadOnly && !readOnly ? (
            <input
              type="text"
              inputMode="decimal"
              value={partAmountInputValue(p.quotePrice)}
              onChange={(e) => update('quotePrice', e.target.value)}
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
      </div>
      <PartInvoicesSection
        part={p}
        readOnly={readOnly}
        partNextInvoiceNumber={partNextInvoiceNumber}
        onNextInvoiceNumberChange={onNextInvoiceNumberChange}
        partInvoiceBusyId={partInvoiceBusyId}
        onUpload={onUpload}
        onInvoiceNumberChange={onInvoiceNumberChange}
        onRemoveInvoice={onRemoveInvoice}
      />
    </>
  );

  if (sectionMode === 'shared') return sharedFields;
  if (sectionMode === 'line') return lineFields;

  return (
    <>
      {sharedFields}
      <div className="mt-3">{lineFields}</div>
    </>
  );
}
