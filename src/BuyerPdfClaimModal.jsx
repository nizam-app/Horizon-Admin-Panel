import { useRef, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import * as api from './api.js';

const emptyDraft = () => ({
  memberVehicle: {
    memberNumber: '',
    plateNumber: '',
    make: '',
    model: '',
    ownerName: '',
    address: '',
    mobile: '',
    email: '',
  },
  driver: {
    firstName: '',
    lastName: '',
    name: '',
    mobile: '',
    email: '',
    licenceNumber: '',
    streetAddress: '',
    suburb: '',
    state: '',
    postcode: '',
  },
  incident: {
    date: '',
    time: '',
    streetName: '',
    suburb: '',
    description: '',
  },
  otherParties: [],
});

function mergeDraft(raw) {
  const base = emptyDraft();
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    memberVehicle: { ...base.memberVehicle, ...(d.memberVehicle || {}) },
    driver: { ...base.driver, ...(d.driver || {}) },
    incident: { ...base.incident, ...(d.incident || {}) },
    otherParties: Array.isArray(d.otherParties) ? d.otherParties : [],
  };
}

function Field({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-[13px] text-zinc-900 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-900 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
        />
      )}
    </label>
  );
}

/**
 * Admin-only: upload scanned buyer PDF → OCR review → create claim in the same queue.
 */
export function BuyerPdfClaimModal({ token, onClose, onCreated }) {
  const fileInputRef = useRef(null);
  const [step, setStep] = useState('upload'); // upload | review
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [uploadToken, setUploadToken] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [extractedText, setExtractedText] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);

  const setMv = (key, value) =>
    setDraft((d) => ({ ...d, memberVehicle: { ...d.memberVehicle, [key]: value } }));
  const setDr = (key, value) => setDraft((d) => ({ ...d, driver: { ...d.driver, [key]: value } }));
  const setInc = (key, value) => setDraft((d) => ({ ...d, incident: { ...d.incident, [key]: value } }));

  const handleFile = async (file) => {
    if (!file || busy) return;
    setError('');
    setBusy(true);
    setFileName(file.name || 'buyer.pdf');
    try {
      const result = await api.parseBuyerPdf(token, file);
      setUploadToken(result.uploadToken || '');
      setDraft(mergeDraft(result.draft));
      setWarnings(Array.isArray(result.warnings) ? result.warnings : []);
      setExtractedText(String(result.extractedText || ''));
      setStep('review');
    } catch (err) {
      setError(err?.message || 'Could not process PDF');
      setStep('upload');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (busy || !uploadToken) return;
    setError('');
    const plate = String(draft.memberVehicle.plateNumber || '').trim();
    const driverName =
      String(draft.driver.name || '').trim() ||
      [draft.driver.firstName, draft.driver.lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
    const incidentDate = String(draft.incident.date || '').trim();
    if (!plate || !driverName || !incidentDate) {
      setError('Plate number, driver name, and incident date are required.');
      return;
    }
    setBusy(true);
    try {
      const claim = {
        ...draft,
        driver: {
          ...draft.driver,
          name: driverName,
          firstName: draft.driver.firstName || driverName.split(/\s+/)[0] || '',
          lastName:
            draft.driver.lastName ||
            driverName.split(/\s+/).slice(1).join(' ') ||
            '',
        },
      };
      const result = await api.createClaimFromBuyer(token, { claim, uploadToken });
      onCreated?.(result);
      onClose?.();
    } catch (err) {
      setError(err?.message || 'Could not create claim');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-zinc-950/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="buyer-pdf-claim-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={() => !busy && onClose?.()} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="buyer-pdf-claim-title" className="font-display text-base font-semibold text-zinc-950">
              New claim from buyer PDF
            </h2>
            <p className="text-2xs text-zinc-500">
              {step === 'upload' ? 'Upload a scanned PDF for OCR extraction' : 'Review and correct extracted fields, then submit'}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => onClose?.()}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {error ? (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</div>
          ) : null}

          {step === 'upload' ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
                <Upload className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900">Drop or choose a buyer PDF</p>
                <p className="mt-1 max-w-sm text-2xs text-zinc-500">
                  Scanned pages are OCR’d on the server. You will review fields before the claim is created.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
              >
                <FileText className="h-4 w-4" />
                {busy ? 'Processing OCR…' : 'Choose PDF'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-2xs text-zinc-600">
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <span className="truncate font-medium text-zinc-800">{fileName || 'buyer.pdf'}</span>
                <button
                  type="button"
                  disabled={busy}
                  className="ml-auto font-semibold text-indigo-700 hover:underline disabled:opacity-50"
                  onClick={() => {
                    setStep('upload');
                    setUploadToken('');
                    setWarnings([]);
                    setExtractedText('');
                    setDraft(emptyDraft());
                  }}
                >
                  Replace PDF
                </button>
              </div>

              {warnings.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-2xs text-amber-950">
                  <p className="font-semibold">OCR warnings</p>
                  <ul className="mt-1 list-inside list-disc">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <section>
                <h3 className="mb-2 text-2xs font-bold uppercase tracking-wider text-zinc-500">Member / vehicle</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Plate number *" value={draft.memberVehicle.plateNumber} onChange={(v) => setMv('plateNumber', v)} />
                  <Field label="Member number" value={draft.memberVehicle.memberNumber} onChange={(v) => setMv('memberNumber', v)} />
                  <Field label="Make" value={draft.memberVehicle.make} onChange={(v) => setMv('make', v)} />
                  <Field label="Model" value={draft.memberVehicle.model} onChange={(v) => setMv('model', v)} />
                  <Field label="Owner name" value={draft.memberVehicle.ownerName} onChange={(v) => setMv('ownerName', v)} />
                  <Field label="Mobile" value={draft.memberVehicle.mobile} onChange={(v) => setMv('mobile', v)} />
                  <Field label="Email" value={draft.memberVehicle.email} onChange={(v) => setMv('email', v)} type="email" />
                  <Field label="Address" value={draft.memberVehicle.address} onChange={(v) => setMv('address', v)} />
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-2xs font-bold uppercase tracking-wider text-zinc-500">Driver</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="First name" value={draft.driver.firstName} onChange={(v) => setDr('firstName', v)} />
                  <Field label="Last name" value={draft.driver.lastName} onChange={(v) => setDr('lastName', v)} />
                  <Field
                    label="Full name *"
                    value={draft.driver.name}
                    onChange={(v) => setDr('name', v)}
                    placeholder="Required if first/last empty"
                  />
                  <Field label="Licence number" value={draft.driver.licenceNumber} onChange={(v) => setDr('licenceNumber', v)} />
                  <Field label="Mobile" value={draft.driver.mobile} onChange={(v) => setDr('mobile', v)} />
                  <Field label="Email" value={draft.driver.email} onChange={(v) => setDr('email', v)} type="email" />
                  <Field label="Street" value={draft.driver.streetAddress} onChange={(v) => setDr('streetAddress', v)} />
                  <Field label="Suburb" value={draft.driver.suburb} onChange={(v) => setDr('suburb', v)} />
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-2xs font-bold uppercase tracking-wider text-zinc-500">Incident</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date *" value={draft.incident.date} onChange={(v) => setInc('date', v)} type="date" />
                  <Field label="Time" value={draft.incident.time} onChange={(v) => setInc('time', v)} />
                  <Field label="Street" value={draft.incident.streetName} onChange={(v) => setInc('streetName', v)} />
                  <Field label="Suburb" value={draft.incident.suburb} onChange={(v) => setInc('suburb', v)} />
                  <div className="sm:col-span-2">
                    <Field
                      label="Description"
                      value={draft.incident.description}
                      onChange={(v) => setInc('description', v)}
                      type="textarea"
                    />
                  </div>
                </div>
              </section>

              {extractedText ? (
                <div>
                  <button
                    type="button"
                    className="text-2xs font-semibold text-indigo-700 hover:underline"
                    onClick={() => setShowRaw((v) => !v)}
                  >
                    {showRaw ? 'Hide' : 'Show'} raw OCR text
                  </button>
                  {showRaw ? (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-700 whitespace-pre-wrap">
                      {extractedText}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 bg-zinc-50/80 px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onClose?.()}
            className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          {step === 'review' ? (
            <button
              type="button"
              disabled={busy || !uploadToken}
              onClick={() => void handleSubmit()}
              className="h-9 rounded-xl bg-indigo-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? 'Submitting…' : 'Create claim'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
