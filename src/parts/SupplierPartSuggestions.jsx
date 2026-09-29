import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { formatAud, partAmountNumber } from './partUtils.js';

/**
 * Read-only suggestions from prior claim part lines (not a supplier master).
 */
export function SupplierPartSuggestions({
  token,
  part,
  readOnly,
  onApplySuggestion,
  supplierListId = 'part-supplier-suggestions',
}) {
  const company = String(part?.company ?? '').trim();
  const [supplierNames, setSupplierNames] = useState([]);
  const [parts, setParts] = useState([]);
  const [loadingParts, setLoadingParts] = useState(false);

  useEffect(() => {
    if (!token || readOnly) return;
    const q = company.length >= 1 ? company : '';
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .listSupplierNameSuggestions(token, { q, limit: 40 })
        .then((out) => {
          if (!cancelled) setSupplierNames(out.suppliers || []);
        })
        .catch(() => {
          if (!cancelled) setSupplierNames([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [token, company, readOnly]);

  useEffect(() => {
    if (!token || !company || readOnly) {
      setParts([]);
      return;
    }
    let cancelled = false;
    setLoadingParts(true);
    api
      .listPartSuggestionsForSupplier(token, { supplier: company, limit: 50 })
      .then((out) => {
        if (!cancelled) setParts(out.parts || []);
      })
      .catch(() => {
        if (!cancelled) setParts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingParts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, company, readOnly]);

  if (readOnly) return null;

  return (
    <>
      <datalist id={supplierListId}>
        {supplierNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {company ? (
        <div className="mb-4 rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-4">
          <p className="text-2xs font-semibold uppercase tracking-wider text-indigo-900">
            Existing parts for this supplier
          </p>
          <p className="mt-0.5 text-2xs text-indigo-800/80">
            Select a prior part to fill name and price, or enter a new part below. Prices on old claims are not changed.
          </p>
          {loadingParts ? (
            <p className="mt-3 text-2xs text-zinc-600">Loading suggestions…</p>
          ) : parts.length === 0 ? (
            <p className="mt-3 text-2xs text-zinc-600">No prior parts for this supplier name yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {parts.map((row) => (
                <li key={row.partName}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-indigo-200/60 bg-white px-3 py-2 text-left text-sm hover:bg-indigo-50/80"
                    onClick={() =>
                      onApplySuggestion?.({
                        partName: row.partName,
                        amount: row.lastAmount,
                        listPriceSnapshot: row.lastAmount,
                      })
                    }
                  >
                    <span className="font-medium text-zinc-900">{row.partName}</span>
                    <span className="font-mono text-2xs tabular-nums text-zinc-700">{formatAud(row.lastAmount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {part?.listPriceSnapshot != null && part?.partName ? (
        <p className="mb-3 text-2xs text-zinc-600">
          Suggested price at pick: {formatAud(part.listPriceSnapshot)}
          {partAmountDiff(part)}
        </p>
      ) : null}
    </>
  );
}

function partAmountDiff(part) {
  const applied = partAmountNumber(part.amount);
  const snap = Number(part.listPriceSnapshot);
  if (!Number.isFinite(applied) || !Number.isFinite(snap) || applied === snap) return null;
  return ` · Applied: ${formatAud(applied)}`;
}

export const SUPPLIER_SUGGESTIONS_LIST_ID = 'part-supplier-suggestions';
