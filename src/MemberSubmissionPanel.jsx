import { useCallback, useState } from 'react';
import { DamageDiagramViewer } from './DamageDiagramViewer.jsx';
import {
  mergeAttachmentLists,
  normalizeWitnesses,
  resolveDamageDiagramFromDamage,
  strVal,
  submissionSource,
} from './memberSubmissionUtils.js';
import { MemberSubmissionEditPanel } from './MemberSubmissionEditPanel.jsx';
import * as api from './api.js';

function resolveFileHref(urlOrDataUrl) {
  const value = String(urlOrDataUrl || '').trim();
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return value;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  const base = api.apiBase();
  return base ? `${base}${value.startsWith('/') ? value : `/${value}`}` : value;
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasValue);
  return String(value).trim() !== '';
}

function joinParts(...parts) {
  return parts.flat().filter(hasValue).join(', ');
}

function DetailCard({ title, items, emptyText = 'No submitted details.' }) {
  const rows = (Array.isArray(items) ? items : []).filter(([, value]) => hasValue(value));
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
      <div className="border-b border-zinc-100 bg-zinc-50/50 px-3 py-2.5 sm:px-4">
        <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
      </div>
      {rows.length ? (
        <dl className="divide-y divide-zinc-100 px-3 sm:px-4">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[minmax(0,104px)_1fr] gap-3 py-2.5 sm:grid-cols-[minmax(0,140px)_1fr]">
              <dt className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
              <dd className="text-sm leading-relaxed text-zinc-800">{strVal(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="px-3 py-4 text-sm text-zinc-500 sm:px-4">{emptyText}</p>
      )}
    </div>
  );
}

function SectionHeader({ title, description, meta }) {
  return (
    <div className="flex flex-col gap-1 border-t border-zinc-200/80 pt-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-relaxed text-zinc-600">{description}</p> : null}
      </div>
      {meta ? <p className="shrink-0 text-2xs font-semibold uppercase tracking-wider text-zinc-500">{meta}</p> : null}
    </div>
  );
}

function ReviewStat({ label, value, helper }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 shadow-inner">
      <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-zinc-950">{strVal(value)}</p>
      {helper ? <p className="mt-0.5 truncate text-2xs text-zinc-500">{helper}</p> : null}
    </div>
  );
}

function EvidenceChip({ label, count = 0, present = false }) {
  const isPresent = present || count > 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-2xs font-semibold ${
        isPresent
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-zinc-200 bg-white text-zinc-500'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isPresent ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
      {label}
      {count > 0 ? <span className="font-mono tabular-nums">{count}</span> : null}
    </span>
  );
}

export function SubmissionImage({ label, src }) {
  const imageSrc = resolveFileHref(src);
  if (!imageSrc) return null;
  return (
    <div className="rounded-xl border border-zinc-200/90 bg-white p-2.5 shadow-inner sm:p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
        <a
          href={imageSrc}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-2xs font-semibold text-zinc-800 hover:bg-zinc-100"
        >
          View image
        </a>
      </div>
      <img src={imageSrc} alt={label} className="mt-2 max-h-44 w-full rounded-lg border border-zinc-100 object-contain sm:max-h-56 lg:max-h-64" />
    </div>
  );
}

export function AttachmentPreview({ file, index, groupTitle }) {
  const name = file?.name || `${groupTitle} ${index + 1}`;
  const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl.trim() : '';
  const storedUrl = typeof file?.url === 'string' ? file.url.trim() : typeof file?.fileUrl === 'string' ? file.fileUrl.trim() : '';
  const mimeType = String(file?.mimeType || '').toLowerCase();
  const isStoredImage = storedUrl && (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(storedUrl));
  const isStoredPdf = storedUrl && (mimeType === 'application/pdf' || /\.pdf(?:$|\?)/i.test(storedUrl));

  if (dataUrl.startsWith('data:image/')) {
    return <SubmissionImage label={name} src={dataUrl} />;
  }

  if (isStoredImage) {
    return <SubmissionImage label={name} src={storedUrl} />;
  }

  if (dataUrl.startsWith('data:application/pdf') || dataUrl.startsWith('data:application/octet-stream') || isStoredPdf || storedUrl) {
    const href = resolveFileHref(dataUrl || storedUrl);
    return (
      <div className="rounded-xl border border-zinc-200/90 bg-white p-3 shadow-inner">
        <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{name}</p>
        <p className="mt-2 text-sm text-zinc-600">File attached with submission</p>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          download={name.endsWith('.pdf') ? name : `${name}.pdf`}
          className="mt-3 inline-flex rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100"
        >
          Open file
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-3">
      <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{name}</p>
      <p className="mt-2 text-sm text-zinc-600">
        Filename recorded{file?.source ? ` (${file.source})` : ''}. No preview stored.
      </p>
    </div>
  );
}

export function AttachmentGallery({ title, attachments }) {
  const items = Array.isArray(attachments) ? attachments : [];
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
        <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-2xs font-semibold text-zinc-600">
          {items.length} file{items.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((file, index) => (
          <AttachmentPreview key={file.id || `${file.name}-${index}`} file={file} index={index} groupTitle={title} />
        ))}
      </div>
    </div>
  );
}

function MemberSubmissionView({ claimItem }) {
  const { payload, data, src, submission } = submissionSource(claimItem);
  if (!payload) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-600">
        No raw member submission stored for this claim (older records may only have summary fields).
      </p>
    );
  }

  const mv = { ...(data.memberVehicle || {}), ...(src.memberVehicle || {}) };
  const dr = { ...(data.driver || {}), ...(src.driver || {}) };
  const inc = { ...(data.incident || {}), ...(src.incident || {}) };
  const dmg = { ...(data.damage || {}), ...(src.damage || {}) };
  const diagramResolved = resolveDamageDiagramFromDamage(dmg);
  const diagram = dmg.diagram || {};

  const licenseFront = mergeAttachmentLists(src.driverLicenseFrontAttachments, submission.driverLicenseFrontAttachments);
  const licenseBack = mergeAttachmentLists(src.driverLicenseBackAttachments, submission.driverLicenseBackAttachments);
  const taxiFiles = mergeAttachmentLists(src.taxiAuthorityAttachments, submission.taxiAuthorityAttachments);
  const regFiles = mergeAttachmentLists(src.registrationAttachments, submission.registrationAttachments);
  const scenePhotos = mergeAttachmentLists(diagram.scenePhotos);
  const detailPhotos = mergeAttachmentLists(diagram.detailPhotos);
  const sketchUploads = mergeAttachmentLists(src.accidentSketch?.attachments);
  const witnesses = normalizeWitnesses(data, payload);
  const parties = src.otherParties || data.otherParties || [];
  const driverName = dr.name || joinParts(dr.firstName, dr.lastName);
  const vehicleName = joinParts([mv.make, mv.model].filter(Boolean).join(' '), mv.plateNumber);
  const incidentLocation = joinParts(inc.streetName, inc.suburb);
  const evidenceCount =
    licenseFront.length +
    licenseBack.length +
    taxiFiles.length +
    regFiles.length +
    scenePhotos.length +
    detailPhotos.length +
    sketchUploads.length +
    (src.accidentSketch?.diagramDataUrl ? 1 : 0) +
    (src.declaration?.signatureDataUrl ? 1 : 0);
  const damageEvidenceCount = scenePhotos.length + detailPhotos.length + diagramResolved.markers.length + diagramResolved.strokes.length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200/90 bg-white p-3 shadow-inner sm:p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-zinc-900">Submission overview</h3>
            <p className="mt-1 text-sm leading-relaxed text-zinc-600">
              Member-submitted answers are grouped for review. Supporting images stay beside the section they explain.
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <ReviewStat label="Vehicle" value={vehicleName || mv.plateNumber} helper={mv.claimType} />
          <ReviewStat label="Driver" value={driverName} helper={dr.isOwner ? `Owner: ${strVal(dr.isOwner)}` : null} />
          <ReviewStat label="Incident" value={inc.date} helper={incidentLocation} />
          <ReviewStat label="Evidence" value={`${evidenceCount} item${evidenceCount === 1 ? '' : 's'}`} helper={`${parties.length} parties, ${witnesses.length} witnesses`} />
        </div>
        <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
          <EvidenceChip label="Licence" count={licenseFront.length + licenseBack.length} />
          <EvidenceChip label="Registration" count={regFiles.length} />
          <EvidenceChip label="Taxi authority" count={taxiFiles.length} />
          <EvidenceChip label="Sketch" count={sketchUploads.length} present={Boolean(src.accidentSketch?.diagramDataUrl)} />
          <EvidenceChip label="Damage" count={scenePhotos.length + detailPhotos.length} present={damageEvidenceCount > 0} />
          <EvidenceChip label="Signature" present={Boolean(src.declaration?.signatureDataUrl)} />
        </div>
      </div>

      <SectionHeader
        title="Claimant, vehicle and driver"
        description="Identity and contact details captured from the first two member steps."
        meta="Review first"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <DetailCard
          title="Vehicle"
          items={[
            ['Member number', mv.memberNumber],
            ['Claim type', mv.claimType],
            ['Plate', mv.plateNumber],
            ['Make / model', [mv.make, mv.model].filter(hasValue).join(' ')],
            ['Kilometers', mv.kilometers],
            ['Month / year', mv.monthYear],
            ['Owner', mv.ownerName],
            ['Address', mv.address],
            ['Mobile', mv.mobile],
            ['Email', mv.email],
          ]}
        />
        <DetailCard
          title="Driver details"
          items={[
            ['Name', driverName],
            ['Is owner', dr.isOwner],
            ['Address', dr.address || joinParts(dr.streetAddress, dr.suburb, dr.state, dr.postcode)],
            ['Mobile', dr.mobile],
            ['Email', dr.email],
            ['Licence no.', dr.licenceNumber],
            ['Licence expiry', dr.expiryDate],
            ['Date of birth', dr.dateOfBirth],
            ['Years held', dr.yearOfHold],
            ['Relationship', dr.relationship],
            ['Alcohol / drugs', dr.alcoholOrDrug],
            ['Breath test', dr.breathTest],
            ['Police reported', dr.policeReported],
            ['Police report no.', dr.policeReportNumber],
            ['At fault', dr.atFault],
            ['Admitted liability', dr.admittedLiability],
            ['Other driver liability', dr.otherDriverAdmittedLiability],
          ]}
        />
      </div>
      {(taxiFiles.length > 0 || regFiles.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AttachmentGallery title="Registration" attachments={regFiles} />
          <AttachmentGallery title="Taxi authority" attachments={taxiFiles} />
        </div>
      )}
      {(licenseFront.length > 0 || licenseBack.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AttachmentGallery title="Driver licence - front" attachments={licenseFront} />
          <AttachmentGallery title="Driver licence - back" attachments={licenseBack} />
        </div>
      )}

      <SectionHeader
        title="Incident context"
        description="Where and how the accident happened, followed by the member sketch when supplied."
        meta={incidentLocation}
      />
      <DetailCard
        title="Incident"
        items={[
          ['Date', inc.date],
          ['Day', inc.day],
          ['Time', inc.time],
          ['Street', inc.streetName],
          ['Suburb', inc.suburb],
          ['Address detail', inc.addressDetailOptional],
          ['Road surface', inc.roadSurface],
          ['Vehicle state', inc.coveredVehicleState],
          ['Traffic controls', inc.trafficControls],
          ['Other vehicles count', inc.numberOfVehicles],
          ['Your speed', inc.estimatedSpeed],
          ['Other speed', inc.estimatedOtherSpeed],
          ['Description', inc.description],
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SubmissionImage label="Accident sketch" src={src.accidentSketch?.diagramDataUrl} />
        <AttachmentGallery title="Accident sketch uploads" attachments={sketchUploads} />
      </div>

      <SectionHeader
        title="Damage and towing"
        description="Vehicle condition, towing notes, diagram markings, and submitted damage photos."
        meta={`${damageEvidenceCount} visual item${damageEvidenceCount === 1 ? '' : 's'}`}
      />
      <DetailCard
        title="Damage & towing"
        items={[
          ['Claiming damage', dmg.claimingDamage],
          ['Towed', dmg.towed],
          ['Tow company', dmg.towCompany],
          ['Tow location', dmg.towLocation],
          ['Distance towed', dmg.distanceTowed],
          ['Vehicle location', dmg.currentVehicleLocation],
          ['Damage markers', diagramResolved.markers.length],
          ['Damage drawings', diagramResolved.strokes.length],
        ]}
      />

      <DamageDiagramViewer damage={dmg} />

      <AttachmentGallery title="Damage — scene photos" attachments={scenePhotos} />
      <AttachmentGallery title="Damage — close-up photos" attachments={detailPhotos} />

      <SectionHeader
        title="Other people involved"
        description="Third-party and witness information from the member intake."
        meta={`${parties.length} parties / ${witnesses.length} witnesses`}
      />
      {parties.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-zinc-900">Other parties ({parties.length})</h3>
          {parties.map((party, i) => {
            const partyFront = mergeAttachmentLists(party.licenceFrontAttachments);
            const partyBack = mergeAttachmentLists(party.licenceBackAttachments);
            return (
              <div key={`party-${i}`} className="space-y-3">
                <DetailCard
                  title={`Party ${i + 1} — ${party.plateNumber || 'No plate'}`}
                  items={[
                    ['Driver', party.driverName],
                    ['Make / model / colour', [party.make, party.model, party.color].filter(Boolean).join(' / ')],
                    ['Owner', party.ownerDetails],
                    ['Address', party.address],
                    ['Contact', [party.mobile, party.email].filter(Boolean).join(' · ')],
                    ['Licence', party.licenceNumber],
                    ['Insurance', party.insuranceCompany],
                    ['Claim no.', party.claimNumber],
                  ]}
                />
                <AttachmentGallery title={`Party ${i + 1} — licence front`} attachments={partyFront} />
                <AttachmentGallery title={`Party ${i + 1} — licence back`} attachments={partyBack} />
              </div>
            );
          })}
        </div>
      )}

      {witnesses.length > 0 && (
        <DetailCard
          title="Witnesses"
          items={witnesses.flatMap((w, i) => [
            [`Witness ${i + 1} name`, w.name],
            [`Witness ${i + 1} contact`, [w.mobile, w.email].filter(Boolean).join(' · ')],
            [`Witness ${i + 1} address`, w.address],
          ])}
        />
      )}

      {!parties.length && !witnesses.length ? (
        <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5 text-sm text-zinc-600">
          No other parties or witnesses were submitted for this claim.
        </p>
      ) : null}

      <SectionHeader
        title="Declaration"
        description="Member acknowledgement and signature captured at submission."
        meta={src.declaration?.date}
      />
      <DetailCard
        title="Declaration"
        items={[
          ['Agreed', src.declaration?.agreed],
          ['Signed by', src.declaration?.signedBy],
          ['Print name', src.declaration?.typedName],
          ['Date', src.declaration?.date],
        ]}
      />

      <SubmissionImage label="Signature" src={src.declaration?.signatureDataUrl} />
    </div>
  );
}

export function MemberSubmissionPanel({ claimItem, readOnly = true, onSaveSection, onDirtyChange }) {
  const [editing, setEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const updateDirty = useCallback((dirty) => {
    setEditDirty(Boolean(dirty));
    onDirtyChange?.(Boolean(dirty));
  }, [onDirtyChange]);
  const leaveEditMode = () => {
    if (editDirty && !window.confirm('You have unsaved member submission changes. Discard them and return to review?')) {
      return;
    }
    updateDirty(false);
    setEditing(false);
  };
  if (!readOnly && onSaveSection && editing) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200/90 bg-amber-50/70 p-4 shadow-inner sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-amber-950">Editing member submission</h3>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
              Save or discard changes before moving to another claim area.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editDirty ? (
              <span className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-amber-900">
                Unsaved changes
              </span>
            ) : null}
          <button
            type="button"
            onClick={leaveEditMode}
            className="inline-flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-2xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50"
          >
            Back to review
          </button>
          </div>
        </div>
        <MemberSubmissionEditPanel claimItem={claimItem} onSaveSection={onSaveSection} onDirtyChange={updateDirty} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {!readOnly && onSaveSection ? (
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-200/90 bg-white p-4 shadow-inner sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-zinc-900">Member submission review</h3>
            <p className="mt-1 text-sm text-zinc-600">Review the submitted data first. Edit only when a field needs correction.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              updateDirty(false);
              setEditing(true);
            }}
            className="inline-flex h-9 w-fit items-center rounded-lg bg-indigo-600 px-3 text-2xs font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          >
            Edit submission
          </button>
        </div>
      ) : null}
      <MemberSubmissionView claimItem={claimItem} />
    </div>
  );
}
