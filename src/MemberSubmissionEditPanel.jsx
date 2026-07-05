import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Eye, ExternalLink, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';

import { DamageDiagramViewer } from './DamageDiagramViewer.jsx';
import * as api from './api.js';
import {
  buildAllSubmissionDrafts,
  CHECKLIST_LABELS,
  fileToAttachment,
  prepareSectionForSave,
  submissionSource,
  submissionSyncKey,
  YES_NO_OPTIONS,
} from './memberSubmissionUtils.js';

const SECTION_NAV = [
  { id: 'checklist', label: 'Checklist' },
  { id: 'memberVehicle', label: 'Vehicle' },
  { id: 'driver', label: 'Driver' },
  { id: 'incident', label: 'Incident' },
  { id: 'damage', label: 'Damage' },
  { id: 'otherParties', label: 'Other parties' },
  { id: 'witnessDetails', label: 'Witnesses' },
  { id: 'declaration', label: 'Declaration' },
];

const inputClass =
  'mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-inner outline-none placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15';
const labelClass = 'text-2xs font-semibold uppercase tracking-wider text-zinc-500';

function resolveFileHref(urlOrDataUrl) {
  const value = String(urlOrDataUrl || '').trim();
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return value;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  const base = api.apiBase();
  return base ? `${base}${value.startsWith('/') ? value : `/${value}`}` : value;
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function TextInput({ label, value, onChange, type = 'text', placeholder = '', className = '' }) {
  return (
    <Field label={label} className={className}>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </Field>
  );
}

function TextArea({ label, value, onChange, rows = 3, className = '' }) {
  return (
    <Field label={label} className={className}>
      <textarea
        rows={rows}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} resize-y`}
      />
    </Field>
  );
}

function YesNoSelect({ label, value, onChange, allowEmpty = true, className = '' }) {
  return (
    <Field label={label} className={className}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {allowEmpty ? <option value="">—</option> : null}
        {YES_NO_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ChecklistToggle({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-zinc-200/90 bg-zinc-50/80 px-3 py-2.5 text-sm text-zinc-800 shadow-inner transition hover:bg-white">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500/30"
      />
      <span>{label}</span>
    </label>
  );
}

function SectionSaveBar({ saveState, onSave, onReset, dirty, errorMessage }) {
  const isSaving = saveState === 'saving';
  const isSaved = saveState === 'saved';
  const isError = saveState === 'error' || Boolean(errorMessage);

  return (
    <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
      {errorMessage ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-800">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-2xs text-zinc-500">
          {dirty ? 'You have unsaved changes' : 'This section is up to date'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {isSaved && (
            <span className="inline-flex items-center gap-1 text-2xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              Saved successfully
            </span>
          )}
          {isError && !errorMessage ? (
            <span className="text-2xs font-semibold text-rose-600">Save failed</span>
          ) : null}
          {dirty && onReset ? (
            <button
              type="button"
              onClick={onReset}
              disabled={isSaving}
              className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              Discard changes
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || !dirty}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditSection({
  sectionId,
  title,
  description,
  children,
  saveState,
  dirty,
  onSave,
  onReset,
  errorMessage,
  isOpen,
  onToggle,
}) {
  if (!isOpen) return null;
  return (
    <section id={`edit-section-${sectionId}`} className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
      <button
        type="button"
        onClick={isOpen ? undefined : onToggle}
        className="flex w-full items-start justify-between gap-3 border-b border-zinc-100 bg-zinc-50/50 px-4 py-3 text-left sm:px-5"
      >
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
          {description ? <p className="mt-1 text-2xs leading-relaxed text-zinc-500">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {dirty ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              Unsaved
            </span>
          ) : null}
          <span className="text-zinc-400">{isOpen ? '▾' : '▸'}</span>
        </div>
      </button>
      {isOpen ? (
        <>
          <div className="px-4 py-4 sm:px-5">{children}</div>
          <div className="px-4 pb-4 sm:px-5">
            <SectionSaveBar
              saveState={saveState}
              dirty={dirty}
              onSave={onSave}
              onReset={onReset}
              errorMessage={errorMessage}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

function attachmentKind(file) {
  const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl.trim() : '';
  const storedUrl = typeof file?.url === 'string' ? file.url.trim() : typeof file?.fileUrl === 'string' ? file.fileUrl.trim() : '';
  const mimeType = String(file?.mimeType || '').toLowerCase();
  if (dataUrl.startsWith('data:image/')) return 'image';
  if (dataUrl.startsWith('data:application/pdf') || dataUrl.startsWith('data:application/octet-stream')) return 'pdf';
  if (storedUrl && (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)(?:$|\?)/i.test(storedUrl))) return 'image';
  if (storedUrl && (mimeType === 'application/pdf' || /\.pdf(?:$|\?)/i.test(storedUrl))) return 'pdf';
  return 'file';
}

function AttachmentPreviewDialog({ files, index, onChangeIndex, onClose }) {
  const list = Array.isArray(files) ? files : [];
  const file = index == null ? null : list[index];

  useEffect(() => {
    if (!file) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && list.length > 1) onChangeIndex((index - 1 + list.length) % list.length);
      if (e.key === 'ArrowRight' && list.length > 1) onChangeIndex((index + 1) % list.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, index, list.length, onChangeIndex, onClose]);

  if (!file) return null;

  const name = file.name || 'Attachment';
  const dataUrl = typeof file.dataUrl === 'string' ? file.dataUrl.trim() : '';
  const storedUrl = typeof file.url === 'string' ? file.url.trim() : typeof file.fileUrl === 'string' ? file.fileUrl.trim() : '';
  const fileHref = resolveFileHref(dataUrl || storedUrl);
  const kind = attachmentKind(file);
  const canNavigate = list.length > 1;
  const previous = () => onChangeIndex((index - 1 + list.length) % list.length);
  const next = () => onChangeIndex((index + 1) % list.length);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/70 p-3 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${name}`}
        className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sheet-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200/90 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-950">{name}</p>
            <p className="text-2xs text-zinc-500">
              {file.source || 'upload'}
              {list.length > 1 ? ` · ${index + 1} of ${list.length}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {fileHref ? (
              <a
                href={fileHref}
                target="_blank"
                rel="noreferrer"
                download={name}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-800 hover:bg-zinc-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 bg-zinc-100 lg:grid-cols-[1fr_220px]">
          <div className="relative min-h-0 overflow-auto p-3">
            {canNavigate ? (
              <>
                <button
                  type="button"
                  onClick={previous}
                  className="absolute left-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-zinc-950/55 text-white shadow-lg backdrop-blur transition hover:bg-zinc-950/75"
                  aria-label="Previous attachment"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="absolute right-4 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-zinc-950/55 text-white shadow-lg backdrop-blur transition hover:bg-zinc-950/75"
                  aria-label="Next attachment"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : null}
            {kind === 'image' && fileHref ? (
              <img src={fileHref} alt={name} className="mx-auto max-h-[78dvh] max-w-full rounded-lg bg-white object-contain shadow-sm" />
            ) : kind === 'pdf' ? (
              <iframe title={name} src={fileHref} className="h-[78dvh] w-full rounded-lg border border-zinc-200 bg-white" />
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-600">
                This attachment has no preview data. Use Open if available.
              </div>
            )}
          </div>
          <aside className="hidden min-h-0 overflow-y-auto border-l border-zinc-200 bg-white p-3 lg:block">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-zinc-500">Attachments</p>
            <div className="space-y-2">
              {list.map((item, itemIndex) => {
                const itemKind = attachmentKind(item);
                return (
                  <button
                    key={item.id || `${item.name}-${itemIndex}`}
                    type="button"
                    onClick={() => onChangeIndex(itemIndex)}
                    className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left transition ${
                      itemIndex === index
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-950'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    {itemKind === 'image' ? (
                      <img src={resolveFileHref(item.dataUrl || item.url || item.fileUrl)} alt="" className="h-10 w-10 shrink-0 rounded-md border border-zinc-200 object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-[10px] font-semibold uppercase text-zinc-500">
                        {itemKind}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{item.name || 'Attachment'}</span>
                      <span className="block text-2xs opacity-70">{item.source || 'upload'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function AttachmentEditor({ title, files, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(null);
  const list = Array.isArray(files) ? files : [];

  const removeAt = (index) => onChange(list.filter((_, i) => i !== index));

  const addFiles = async (fileList) => {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const file of picked) added.push(await fileToAttachment(file));
      onChange([...list, ...added]);
    } catch (e) {
      window.alert(e?.message || 'Could not add file');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <AttachmentPreviewDialog files={list} index={previewIndex} onChangeIndex={setPreviewIndex} onClose={() => setPreviewIndex(null)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={labelClass}>{title}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-2xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Add file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500">
          No files attached
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((file, index) => {
            const preview = attachmentKind(file) === 'image';
            const previewSrc = resolveFileHref(file.dataUrl || file.url || file.fileUrl);
            return (
              <li
                key={file.id || `${file.name}-${index}`}
                className="group flex items-start gap-3 rounded-lg border border-zinc-200/90 bg-zinc-50/80 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/30"
              >
                <button
                  type="button"
                  onClick={() => setPreviewIndex(index)}
                  className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-white text-2xs font-semibold text-zinc-500 ring-offset-2 transition group-hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  aria-label={`Preview ${file.name || 'attachment'}`}
                >
                  {preview && previewSrc ? (
                    <img src={previewSrc} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center uppercase">{attachmentKind(file)}</span>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/0 text-white opacity-0 transition group-hover:bg-zinc-950/35 group-hover:opacity-100">
                    <Eye className="h-4 w-4" />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">{file.name || 'file'}</p>
                  <p className="text-2xs text-zinc-500">{file.source || 'upload'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                  aria-label="Remove file"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function useSectionSave(onSaveSection, baseline) {
  const [states, setStates] = useState({});
  const [errors, setErrors] = useState({});

  const save = useCallback(
    async (section, draft) => {
      setStates((s) => ({ ...s, [section]: 'saving' }));
      setErrors((e) => ({ ...e, [section]: '' }));
      try {
        const payload = prepareSectionForSave(section, draft, baseline);
        await onSaveSection(section, payload);
        setStates((s) => ({ ...s, [section]: 'saved' }));
        window.setTimeout(() => {
          setStates((s) => (s[section] === 'saved' ? { ...s, [section]: 'idle' } : s));
        }, 3000);
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'Could not save. Check your connection and try again.';
        setErrors((e) => ({ ...e, [section]: msg }));
        setStates((s) => ({ ...s, [section]: 'error' }));
      }
    },
    [onSaveSection, baseline],
  );

  return { states, errors, save };
}

function emptyParty() {
  return {
    plateNumber: '',
    make: '',
    model: '',
    color: '',
    driverName: '',
    ownerDetails: '',
    address: '',
    mobile: '',
    email: '',
    licenceNumber: '',
    expiryDate: '',
    dateOfBirth: '',
    insuranceCompany: '',
    claimNumber: '',
    licenceFrontAttachments: [],
    licenceBackAttachments: [],
  };
}

export function MemberSubmissionEditPanel({ claimItem, onSaveSection }) {
  const { payload } = submissionSource(claimItem);
  const syncKey = submissionSyncKey(claimItem);
  const [loadedKey, setLoadedKey] = useState(syncKey);
  const [baseline, setBaseline] = useState(() => buildAllSubmissionDrafts(claimItem));
  const [openSection, setOpenSection] = useState('memberVehicle');
  const { states, errors, save } = useSectionSave(onSaveSection, baseline);

  const [checklistDraft, setChecklistDraft] = useState(() => baseline.checklist);
  const [mvDraft, setMvDraft] = useState(() => baseline.memberVehicle);
  const [driverDraft, setDriverDraft] = useState(() => baseline.driver);
  const [incidentDraft, setIncidentDraft] = useState(() => baseline.incident);
  const [damageDraft, setDamageDraft] = useState(() => baseline.damage);
  const [partiesDraft, setPartiesDraft] = useState(() => baseline.otherParties);
  const [witnessDraft, setWitnessDraft] = useState(() => baseline.witnessDetails);
  const [declDraft, setDeclDraft] = useState(() => baseline.declaration);

  useEffect(() => {
    if (syncKey === loadedKey) return;
    const next = buildAllSubmissionDrafts(claimItem);
    setBaseline(next);
    setChecklistDraft(next.checklist);
    setMvDraft(next.memberVehicle);
    setDriverDraft(next.driver);
    setIncidentDraft(next.incident);
    setDamageDraft(next.damage);
    setPartiesDraft(next.otherParties);
    setWitnessDraft(next.witnessDetails);
    setDeclDraft(next.declaration);
    setLoadedKey(syncKey);
  }, [syncKey, loadedKey, claimItem]);

  const dirty = useMemo(
    () => ({
      checklist: JSON.stringify(checklistDraft) !== JSON.stringify(baseline.checklist),
      memberVehicle: JSON.stringify(mvDraft) !== JSON.stringify(baseline.memberVehicle),
      driver: JSON.stringify(driverDraft) !== JSON.stringify(baseline.driver),
      incident: JSON.stringify(incidentDraft) !== JSON.stringify(baseline.incident),
      damage: JSON.stringify(damageDraft) !== JSON.stringify(baseline.damage),
      otherParties: JSON.stringify(partiesDraft) !== JSON.stringify(baseline.otherParties),
      witnessDetails: JSON.stringify(witnessDraft) !== JSON.stringify(baseline.witnessDetails),
      declaration: JSON.stringify(declDraft) !== JSON.stringify(baseline.declaration),
    }),
    [baseline, checklistDraft, mvDraft, driverDraft, incidentDraft, damageDraft, partiesDraft, witnessDraft, declDraft],
  );

  const scrollToSection = (id) => {
    setOpenSection(id);
    window.requestAnimationFrame(() => {
      document.getElementById(`edit-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (!payload) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">
        No member submission stored — editing is unavailable for this record.
      </p>
    );
  }

  const trafficControlsText = Array.isArray(incidentDraft.trafficControls)
    ? incidentDraft.trafficControls.join(', ')
    : '';

  const { src } = submissionSource(claimItem);
  const anyDirty = Object.values(dirty).some(Boolean);
  const mergedSaveState = (...sections) => {
    if (sections.some((section) => states[section] === 'saving')) return 'saving';
    if (sections.some((section) => states[section] === 'error')) return 'error';
    if (sections.some((section) => states[section] === 'saved')) return 'saved';
    return 'idle';
  };
  const mergedError = (...sections) => sections.map((section) => errors[section]).find(Boolean) || '';
  const saveVehicleSection = async () => {
    if (dirty.memberVehicle) await save('memberVehicle', mvDraft);
    if (dirty.checklist) await save('checklist', checklistDraft);
  };
  const saveDriverSection = async () => {
    if (dirty.driver) await save('driver', driverDraft);
    if (dirty.checklist) await save('checklist', checklistDraft);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-indigo-200/90 bg-indigo-50/60 px-4 py-3.5">
        <p className="text-sm font-medium text-indigo-950">Edit member submission</p>
        <p className="mt-1 text-2xs leading-relaxed text-indigo-900/80">
          Open a section below, make your changes, then click <strong>Save changes</strong>. Only the open section needs
          saving — other tabs and PDF export update automatically after each save.
        </p>
        {anyDirty ? (
          <p className="mt-2 text-2xs font-medium text-amber-900">Some sections have unsaved changes.</p>
        ) : null}
      </div>

      <nav className="sticky top-0 z-[1] -mx-1 flex flex-wrap gap-1.5 rounded-xl border border-zinc-200/90 bg-white/95 p-2 shadow-sm backdrop-blur-sm">
        {SECTION_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => scrollToSection(item.id)}
            className={`rounded-lg px-2.5 py-1.5 text-2xs font-semibold transition ${
              openSection === item.id
                ? 'bg-indigo-600 text-white'
                : dirty[item.id]
                  ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
                  : 'bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            {item.label}
            {dirty[item.id] ? ' •' : ''}
          </button>
        ))}
      </nav>

      <EditSection
        sectionId="checklist"
        title="Checklist & documents"
        description="Checklist flags, excess/repair references, and uploaded documents."
        isOpen={openSection === 'checklist'}
        onToggle={() => setOpenSection((s) => (s === 'checklist' ? '' : 'checklist'))}
        saveState={states.checklist}
        errorMessage={errors.checklist}
        dirty={dirty.checklist}
        onReset={() => setChecklistDraft(baseline.checklist)}
        onSave={() => save('checklist', checklistDraft)}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(CHECKLIST_LABELS).map(([key, label]) => (
            <ChecklistToggle
              key={key}
              label={label}
              checked={checklistDraft.checklist?.[key]}
              onChange={(checked) =>
                setChecklistDraft((d) => ({ ...d, checklist: { ...d.checklist, [key]: checked } }))
              }
            />
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <TextInput label="Excess applicability" value={checklistDraft.excessPaymentApplicability} onChange={(v) => setChecklistDraft((d) => ({ ...d, excessPaymentApplicability: v }))} />
          <TextInput label="Excess amount" value={checklistDraft.excessPaymentAmount} onChange={(v) => setChecklistDraft((d) => ({ ...d, excessPaymentAmount: v }))} />
          <TextInput label="Repair quote ref." value={checklistDraft.repairQuoteRef} onChange={(v) => setChecklistDraft((d) => ({ ...d, repairQuoteRef: v }))} />
        </div>
      </EditSection>

      <EditSection
        sectionId="memberVehicle"
        title="Member & vehicle"
        isOpen={openSection === 'memberVehicle'}
        onToggle={() => setOpenSection((s) => (s === 'memberVehicle' ? '' : 'memberVehicle'))}
        saveState={mergedSaveState('memberVehicle', 'checklist')}
        errorMessage={mergedError('memberVehicle', 'checklist')}
        dirty={dirty.memberVehicle || dirty.checklist}
        onReset={() => {
          setMvDraft(baseline.memberVehicle);
          setChecklistDraft(baseline.checklist);
        }}
        onSave={saveVehicleSection}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextInput label="Member number" value={mvDraft.memberNumber} onChange={(v) => setMvDraft((d) => ({ ...d, memberNumber: v }))} />
          <TextInput label="Claim type" value={mvDraft.claimType} onChange={(v) => setMvDraft((d) => ({ ...d, claimType: v }))} />
          <TextInput label="Plate number" value={mvDraft.plateNumber} onChange={(v) => setMvDraft((d) => ({ ...d, plateNumber: v }))} />
          <TextInput label="Make" value={mvDraft.make} onChange={(v) => setMvDraft((d) => ({ ...d, make: v }))} />
          <TextInput label="Model" value={mvDraft.model} onChange={(v) => setMvDraft((d) => ({ ...d, model: v }))} />
          <TextInput label="Kilometers" value={mvDraft.kilometers} onChange={(v) => setMvDraft((d) => ({ ...d, kilometers: v }))} />
          <TextInput label="Month / year" value={mvDraft.monthYear} onChange={(v) => setMvDraft((d) => ({ ...d, monthYear: v }))} />
          <TextInput label="Owner name" value={mvDraft.ownerName} onChange={(v) => setMvDraft((d) => ({ ...d, ownerName: v }))} />
          <TextInput label="Mobile" value={mvDraft.mobile} onChange={(v) => setMvDraft((d) => ({ ...d, mobile: v }))} />
          <TextInput label="Email" value={mvDraft.email} onChange={(v) => setMvDraft((d) => ({ ...d, email: v }))} />
        </div>
        <TextArea label="Address" className="mt-4" value={mvDraft.address} onChange={(v) => setMvDraft((d) => ({ ...d, address: v }))} />
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <AttachmentEditor title="Registration" files={checklistDraft.registrationAttachments} onChange={(files) => setChecklistDraft((d) => ({ ...d, registrationAttachments: files }))} />
          <AttachmentEditor title="Taxi authority" files={checklistDraft.taxiAuthorityAttachments} onChange={(files) => setChecklistDraft((d) => ({ ...d, taxiAuthorityAttachments: files }))} />
        </div>
      </EditSection>

      <EditSection
        sectionId="driver"
        title="Driver"
        isOpen={openSection === 'driver'}
        onToggle={() => setOpenSection((s) => (s === 'driver' ? '' : 'driver'))}
        saveState={mergedSaveState('driver', 'checklist')}
        errorMessage={mergedError('driver', 'checklist')}
        dirty={dirty.driver || dirty.checklist}
        onReset={() => {
          setDriverDraft(baseline.driver);
          setChecklistDraft(baseline.checklist);
        }}
        onSave={saveDriverSection}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextInput label="Full name" value={driverDraft.name || [driverDraft.firstName, driverDraft.lastName].filter(Boolean).join(' ')} onChange={(v) => setDriverDraft((d) => ({ ...d, name: v }))} />
          <TextInput label="First name" value={driverDraft.firstName} onChange={(v) => setDriverDraft((d) => ({ ...d, firstName: v }))} />
          <TextInput label="Last name" value={driverDraft.lastName} onChange={(v) => setDriverDraft((d) => ({ ...d, lastName: v }))} />
          <YesNoSelect label="Is owner" value={driverDraft.isOwner} onChange={(v) => setDriverDraft((d) => ({ ...d, isOwner: v }))} />
          <TextInput label="Mobile" value={driverDraft.mobile} onChange={(v) => setDriverDraft((d) => ({ ...d, mobile: v }))} />
          <TextInput label="Email" value={driverDraft.email} onChange={(v) => setDriverDraft((d) => ({ ...d, email: v }))} />
          <TextInput label="Licence no." value={driverDraft.licenceNumber} onChange={(v) => setDriverDraft((d) => ({ ...d, licenceNumber: v }))} />
          <TextInput label="Licence expiry" type="date" value={driverDraft.expiryDate} onChange={(v) => setDriverDraft((d) => ({ ...d, expiryDate: v }))} />
          <TextInput label="Date of birth" type="date" value={driverDraft.dateOfBirth} onChange={(v) => setDriverDraft((d) => ({ ...d, dateOfBirth: v }))} />
          <TextInput label="Years held" value={driverDraft.yearOfHold} onChange={(v) => setDriverDraft((d) => ({ ...d, yearOfHold: v }))} />
          <TextInput label="Relationship" value={driverDraft.relationship} onChange={(v) => setDriverDraft((d) => ({ ...d, relationship: v }))} />
          <YesNoSelect label="Alcohol / drugs" value={driverDraft.alcoholOrDrug} onChange={(v) => setDriverDraft((d) => ({ ...d, alcoholOrDrug: v }))} />
          <YesNoSelect label="Breath test" value={driverDraft.breathTest} onChange={(v) => setDriverDraft((d) => ({ ...d, breathTest: v }))} />
          <YesNoSelect label="Police reported" value={driverDraft.policeReported} onChange={(v) => setDriverDraft((d) => ({ ...d, policeReported: v }))} />
          <TextInput label="Police report no." value={driverDraft.policeReportNumber} onChange={(v) => setDriverDraft((d) => ({ ...d, policeReportNumber: v }))} />
          <YesNoSelect label="At fault" value={driverDraft.atFault} onChange={(v) => setDriverDraft((d) => ({ ...d, atFault: v }))} />
          <YesNoSelect label="Admitted liability" value={driverDraft.admittedLiability} onChange={(v) => setDriverDraft((d) => ({ ...d, admittedLiability: v }))} />
          <YesNoSelect label="Other driver liability" value={driverDraft.otherDriverAdmittedLiability} onChange={(v) => setDriverDraft((d) => ({ ...d, otherDriverAdmittedLiability: v }))} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextInput label="Street" value={driverDraft.streetAddress} onChange={(v) => setDriverDraft((d) => ({ ...d, streetAddress: v }))} />
          <TextInput label="Suburb" value={driverDraft.suburb} onChange={(v) => setDriverDraft((d) => ({ ...d, suburb: v }))} />
          <TextInput label="State" value={driverDraft.state} onChange={(v) => setDriverDraft((d) => ({ ...d, state: v }))} />
          <TextInput label="Postcode" value={driverDraft.postcode} onChange={(v) => setDriverDraft((d) => ({ ...d, postcode: v }))} />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <AttachmentEditor title="Driver licence - front" files={checklistDraft.driverLicenseFrontAttachments} onChange={(files) => setChecklistDraft((d) => ({ ...d, driverLicenseFrontAttachments: files }))} />
          <AttachmentEditor title="Driver licence - back" files={checklistDraft.driverLicenseBackAttachments} onChange={(files) => setChecklistDraft((d) => ({ ...d, driverLicenseBackAttachments: files }))} />
        </div>
      </EditSection>

      <EditSection
        sectionId="incident"
        title="Incident"
        isOpen={openSection === 'incident'}
        onToggle={() => setOpenSection((s) => (s === 'incident' ? '' : 'incident'))}
        saveState={states.incident}
        errorMessage={errors.incident}
        dirty={dirty.incident}
        onReset={() => setIncidentDraft(baseline.incident)}
        onSave={() => save('incident', incidentDraft)}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextInput label="Date" type="date" value={incidentDraft.date} onChange={(v) => setIncidentDraft((d) => ({ ...d, date: v }))} />
          <TextInput label="Time" type="time" value={incidentDraft.time} onChange={(v) => setIncidentDraft((d) => ({ ...d, time: v }))} />
          <TextInput label="Street" value={incidentDraft.streetName} onChange={(v) => setIncidentDraft((d) => ({ ...d, streetName: v }))} />
          <TextInput label="Suburb" value={incidentDraft.suburb} onChange={(v) => setIncidentDraft((d) => ({ ...d, suburb: v }))} />
          <TextInput label="Road surface" value={incidentDraft.roadSurface} onChange={(v) => setIncidentDraft((d) => ({ ...d, roadSurface: v }))} />
          <TextInput label="Vehicle state" value={incidentDraft.coveredVehicleState} onChange={(v) => setIncidentDraft((d) => ({ ...d, coveredVehicleState: v }))} />
          <TextInput label="Other vehicles count" value={incidentDraft.numberOfVehicles} onChange={(v) => setIncidentDraft((d) => ({ ...d, numberOfVehicles: v }))} />
          <TextInput label="Your speed" value={incidentDraft.estimatedSpeed} onChange={(v) => setIncidentDraft((d) => ({ ...d, estimatedSpeed: v }))} />
          <TextInput label="Other speed" value={incidentDraft.estimatedOtherSpeed} onChange={(v) => setIncidentDraft((d) => ({ ...d, estimatedOtherSpeed: v }))} />
        </div>
        <TextInput label="Traffic controls (comma-separated)" className="mt-4" value={trafficControlsText} onChange={(v) => setIncidentDraft((d) => ({ ...d, trafficControls: v.split(',').map((s) => s.trim()).filter(Boolean) }))} />
        <TextArea label="Address detail" className="mt-4" value={incidentDraft.addressDetailOptional} onChange={(v) => setIncidentDraft((d) => ({ ...d, addressDetailOptional: v }))} />
        <TextArea label="Description" className="mt-4" rows={4} value={incidentDraft.description} onChange={(v) => setIncidentDraft((d) => ({ ...d, description: v }))} />
        {src.accidentSketch?.diagramDataUrl?.startsWith('data:image/') ? (
          <div className="mt-5 overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
            <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-3">
              <h3 className="text-[13px] font-semibold text-zinc-900">Accident sketch</h3>
              <p className="mt-1 text-2xs text-zinc-500">Member drawing from the accident scene step.</p>
            </div>
            <div className="p-4">
              <img src={src.accidentSketch.diagramDataUrl} alt="Sketch" className="max-h-56 rounded-lg border border-zinc-200 object-contain" />
            </div>
          </div>
        ) : null}
      </EditSection>

      <EditSection
        sectionId="damage"
        title="Damage & towing"
        isOpen={openSection === 'damage'}
        onToggle={() => setOpenSection((s) => (s === 'damage' ? '' : 'damage'))}
        saveState={states.damage}
        errorMessage={errors.damage}
        dirty={dirty.damage}
        onReset={() => setDamageDraft(baseline.damage)}
        onSave={() => save('damage', damageDraft)}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <YesNoSelect label="Claiming damage" value={damageDraft.claimingDamage} onChange={(v) => setDamageDraft((d) => ({ ...d, claimingDamage: v }))} />
          <YesNoSelect label="Towed" value={damageDraft.towed} onChange={(v) => setDamageDraft((d) => ({ ...d, towed: v }))} />
          <TextInput label="Tow company" value={damageDraft.towCompany} onChange={(v) => setDamageDraft((d) => ({ ...d, towCompany: v }))} />
          <TextInput label="Distance towed" value={damageDraft.distanceTowed} onChange={(v) => setDamageDraft((d) => ({ ...d, distanceTowed: v }))} />
        </div>
        <TextArea label="Tow location" className="mt-4" value={damageDraft.towLocation} onChange={(v) => setDamageDraft((d) => ({ ...d, towLocation: v }))} />
        <TextArea label="Current vehicle location" className="mt-4" value={damageDraft.currentVehicleLocation} onChange={(v) => setDamageDraft((d) => ({ ...d, currentVehicleLocation: v }))} />
        <DamageDiagramViewer damage={damageDraft} className="mt-5" title="Damage diagram (member markings)" />
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <AttachmentEditor title="Scene photos" files={damageDraft.diagram?.scenePhotos} onChange={(files) => setDamageDraft((d) => ({ ...d, diagram: { ...d.diagram, scenePhotos: files } }))} />
          <AttachmentEditor title="Detail photos" files={damageDraft.diagram?.detailPhotos} onChange={(files) => setDamageDraft((d) => ({ ...d, diagram: { ...d.diagram, detailPhotos: files } }))} />
        </div>
      </EditSection>

      <EditSection
        sectionId="otherParties"
        title="Other parties"
        description="Add, edit, or remove other vehicles involved."
        isOpen={openSection === 'otherParties'}
        onToggle={() => setOpenSection((s) => (s === 'otherParties' ? '' : 'otherParties'))}
        saveState={states.otherParties}
        errorMessage={errors.otherParties}
        dirty={dirty.otherParties}
        onReset={() => setPartiesDraft(baseline.otherParties)}
        onSave={() => save('otherParties', { otherParties: partiesDraft })}
      >
        {partiesDraft.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">No other parties recorded</p>
        ) : null}
        <div className="space-y-4">
          {partiesDraft.map((party, index) => (
            <div key={`party-edit-${index}`} className="rounded-xl border border-zinc-200/90 bg-zinc-50/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-zinc-900">Party {index + 1}</p>
                <button type="button" onClick={() => setPartiesDraft((rows) => rows.filter((_, i) => i !== index))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2 text-2xs font-semibold text-rose-600 hover:bg-rose-50">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[['plateNumber', 'Plate'], ['driverName', 'Driver'], ['make', 'Make'], ['model', 'Model'], ['color', 'Colour'], ['mobile', 'Mobile'], ['email', 'Email'], ['licenceNumber', 'Licence no.'], ['insuranceCompany', 'Insurance'], ['claimNumber', 'Claim no.']].map(([field, lbl]) => (
                  <TextInput key={field} label={lbl} value={party[field]} onChange={(v) => setPartiesDraft((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: v } : row)))} />
                ))}
              </div>
              <TextArea label="Owner details" className="mt-3" value={party.ownerDetails} onChange={(v) => setPartiesDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ownerDetails: v } : row)))} />
              <TextArea label="Address" className="mt-3" value={party.address} onChange={(v) => setPartiesDraft((rows) => rows.map((row, i) => (i === index ? { ...row, address: v } : row)))} />
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <AttachmentEditor title="Licence front" files={party.licenceFrontAttachments} onChange={(files) => setPartiesDraft((rows) => rows.map((row, i) => (i === index ? { ...row, licenceFrontAttachments: files } : row)))} />
                <AttachmentEditor title="Licence back" files={party.licenceBackAttachments} onChange={(files) => setPartiesDraft((rows) => rows.map((row, i) => (i === index ? { ...row, licenceBackAttachments: files } : row)))} />
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setPartiesDraft((rows) => [...rows, emptyParty()])} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-800 hover:bg-zinc-50">
          <Plus className="h-3.5 w-3.5" /> Add other party
        </button>
      </EditSection>

      <EditSection
        sectionId="witnessDetails"
        title="Witnesses"
        isOpen={openSection === 'witnessDetails'}
        onToggle={() => setOpenSection((s) => (s === 'witnessDetails' ? '' : 'witnessDetails'))}
        saveState={states.witnessDetails}
        errorMessage={errors.witnessDetails}
        dirty={dirty.witnessDetails}
        onReset={() => setWitnessDraft(baseline.witnessDetails)}
        onSave={() => save('witnessDetails', { witnessDetails: witnessDraft })}
      >
        <div className="grid gap-5 lg:grid-cols-2">
          {witnessDraft.map((w, index) => (
            <div key={`witness-${index}`} className="rounded-xl border border-zinc-200/90 bg-zinc-50/50 p-4">
              <p className="mb-3 text-xs font-semibold text-zinc-900">Witness {index + 1}</p>
              <div className="space-y-3">
                <TextInput label="Name" value={w.name} onChange={(v) => setWitnessDraft((rows) => rows.map((row, i) => (i === index ? { ...row, name: v } : row)))} />
                <TextInput label="Mobile" value={w.mobile} onChange={(v) => setWitnessDraft((rows) => rows.map((row, i) => (i === index ? { ...row, mobile: v } : row)))} />
                <TextInput label="Email" value={w.email} onChange={(v) => setWitnessDraft((rows) => rows.map((row, i) => (i === index ? { ...row, email: v } : row)))} />
                <TextArea label="Address" value={w.address} onChange={(v) => setWitnessDraft((rows) => rows.map((row, i) => (i === index ? { ...row, address: v } : row)))} />
              </div>
            </div>
          ))}
        </div>
      </EditSection>

      <EditSection
        sectionId="declaration"
        title="Declaration"
        description="Update declaration text fields. Signature image is preserved from the original submission."
        isOpen={openSection === 'declaration'}
        onToggle={() => setOpenSection((s) => (s === 'declaration' ? '' : 'declaration'))}
        saveState={states.declaration}
        errorMessage={errors.declaration}
        dirty={dirty.declaration}
        onReset={() => setDeclDraft(baseline.declaration)}
        onSave={() => save('declaration', declDraft)}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm">
            <input type="checkbox" checked={Boolean(declDraft.agreed)} onChange={(e) => setDeclDraft((d) => ({ ...d, agreed: e.target.checked }))} className="h-4 w-4 rounded border-zinc-300 text-indigo-600" />
            Declaration agreed
          </label>
          <TextInput label="Signed by (role)" value={declDraft.signedBy} onChange={(v) => setDeclDraft((d) => ({ ...d, signedBy: v }))} />
          <TextInput label="Print name" value={declDraft.typedName} onChange={(v) => setDeclDraft((d) => ({ ...d, typedName: v }))} />
          <TextInput label="Date signed" type="date" value={declDraft.date} onChange={(v) => setDeclDraft((d) => ({ ...d, date: v }))} />
        </div>
        {declDraft.signatureDataUrl?.startsWith('data:image/') ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
            <p className={labelClass}>Signature (read-only)</p>
            <img src={declDraft.signatureDataUrl} alt="Signature" className="mt-2 max-h-24 rounded border border-zinc-200 bg-white object-contain" />
          </div>
        ) : null}
      </EditSection>

    </div>
  );
}
