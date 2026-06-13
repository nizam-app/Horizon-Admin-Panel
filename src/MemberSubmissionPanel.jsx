import {
  CHECKLIST_LABELS,
  formatAttachmentNames,
  mergeAttachmentLists,
  normalizeWitnesses,
  resolveChecklistFlag,
  strVal,
  submissionSource,
} from './memberSubmissionUtils.js';
import { MemberSubmissionEditPanel } from './MemberSubmissionEditPanel.jsx';

function DetailCard({ title, items }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-inner">
      <div className="border-b border-zinc-100 bg-zinc-50/50 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
      </div>
      <dl className="divide-y divide-zinc-100 px-4">
        {items.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,140px)_1fr] sm:gap-3">
            <dt className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
            <dd className="text-sm leading-relaxed text-zinc-800">{strVal(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SubmissionImage({ label, dataUrl }) {
  const src = String(dataUrl || '').trim();
  if (!src.startsWith('data:image/')) return null;
  return (
    <div className="rounded-xl border border-zinc-200/90 bg-white p-3 shadow-inner">
      <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <img src={src} alt={label} className="mt-2 max-h-56 w-full rounded-lg border border-zinc-100 object-contain" />
    </div>
  );
}

function AttachmentPreview({ file, index, groupTitle }) {
  const name = file?.name || `${groupTitle} ${index + 1}`;
  const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl.trim() : '';

  if (dataUrl.startsWith('data:image/')) {
    return <SubmissionImage label={name} dataUrl={dataUrl} />;
  }

  if (dataUrl.startsWith('data:application/pdf') || dataUrl.startsWith('data:application/octet-stream')) {
    return (
      <div className="rounded-xl border border-zinc-200/90 bg-white p-3 shadow-inner">
        <p className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{name}</p>
        <p className="mt-2 text-sm text-zinc-600">PDF attached with submission</p>
        <a
          href={dataUrl}
          download={name.endsWith('.pdf') ? name : `${name}.pdf`}
          className="mt-3 inline-flex rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100"
        >
          Download PDF
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

function AttachmentGallery({ title, attachments }) {
  const items = Array.isArray(attachments) ? attachments : [];
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
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
  const diagram = dmg.diagram || {};
  const checklist = { ...(submission.checklist || {}), ...(src.checklist || {}) };

  const licenseFront = mergeAttachmentLists(src.driverLicenseFrontAttachments, submission.driverLicenseFrontAttachments);
  const licenseBack = mergeAttachmentLists(src.driverLicenseBackAttachments, submission.driverLicenseBackAttachments);
  const taxiFiles = mergeAttachmentLists(src.taxiAuthorityAttachments, submission.taxiAuthorityAttachments);
  const regFiles = mergeAttachmentLists(src.registrationAttachments, submission.registrationAttachments);
  const scenePhotos = mergeAttachmentLists(diagram.scenePhotos);
  const detailPhotos = mergeAttachmentLists(diagram.detailPhotos);
  const sketchUploads = mergeAttachmentLists(src.accidentSketch?.attachments);
  const witnesses = normalizeWitnesses(data, payload);
  const parties = src.otherParties || data.otherParties || [];

  const hasAnyChecklistData =
    Object.values(checklist).some(Boolean) ||
    licenseFront.length > 0 ||
    licenseBack.length > 0 ||
    taxiFiles.length > 0 ||
    regFiles.length > 0;

  const checklistSelected = (key) => {
    const attachmentMap = {
      license: [licenseFront, licenseBack],
      taxiAuthority: [taxiFiles],
      registration: [regFiles],
    };
    return resolveChecklistFlag(checklist, key, attachmentMap[key] || []) ? 'Selected' : 'Not selected';
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Full intake as submitted through the member portal (documents, sketch, signature, and damage photos when provided).
      </p>

      {!hasAnyChecklistData ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          This claim has no checklist or document data stored.
        </p>
      ) : null}

      <DetailCard
        title="Checklist"
        items={[
          ...Object.entries(CHECKLIST_LABELS).map(([key, label]) => [label, checklistSelected(key)]),
          ['Excess applicability', src.excessPaymentApplicability || submission.excessPaymentApplicability],
          ['Excess amount', src.excessPaymentAmount || submission.excessPaymentAmount],
          ['Repair quote ref.', src.repairQuoteRef || submission.repairQuoteRef],
          ['Licence (front) files', formatAttachmentNames(licenseFront)],
          ['Licence (back) files', formatAttachmentNames(licenseBack)],
          ['Taxi authority files', formatAttachmentNames(taxiFiles)],
          ['Registration files', formatAttachmentNames(regFiles)],
        ]}
      />

      <AttachmentGallery title="Driver licence — front" attachments={licenseFront} />
      <AttachmentGallery title="Driver licence — back" attachments={licenseBack} />
      <AttachmentGallery title="Taxi authority" attachments={taxiFiles} />
      <AttachmentGallery title="Copy of registration" attachments={regFiles} />

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailCard
          title="Member & vehicle"
          items={[
            ['Member number', mv.memberNumber],
            ['Claim type', mv.claimType],
            ['Plate', mv.plateNumber],
            ['Make / model', [mv.make, mv.model].filter(Boolean).join(' ')],
            ['Kilometers', mv.kilometers],
            ['Month / year', mv.monthYear],
            ['Owner', mv.ownerName],
            ['Address', mv.address],
            ['Mobile', mv.mobile],
            ['Email', mv.email],
          ]}
        />
        <DetailCard
          title="Driver"
          items={[
            ['Name', dr.name || [dr.firstName, dr.lastName].filter(Boolean).join(' ')],
            ['Is owner', dr.isOwner],
            ['Address', dr.address || [dr.streetAddress, dr.suburb, dr.state, dr.postcode].filter(Boolean).join(', ')],
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

      <DetailCard
        title="Damage & towing"
        items={[
          ['Claiming damage', dmg.claimingDamage],
          ['Towed', dmg.towed],
          ['Tow company', dmg.towCompany],
          ['Tow location', dmg.towLocation],
          ['Distance towed', dmg.distanceTowed],
          ['Vehicle location', dmg.currentVehicleLocation],
          ['Damage markers', Array.isArray(diagram.markers) ? diagram.markers.length : Object.keys(dmg.points || {}).length || 0],
          ['Scene photos', formatAttachmentNames(scenePhotos)],
          ['Detail photos', formatAttachmentNames(detailPhotos)],
        ]}
      />

      <AttachmentGallery title="Damage — scene photos" attachments={scenePhotos} />
      <AttachmentGallery title="Damage — close-up photos" attachments={detailPhotos} />

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
                    ['Licence (front)', formatAttachmentNames(partyFront)],
                    ['Licence (back)', formatAttachmentNames(partyBack)],
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

      <DetailCard
        title="Declaration"
        items={[
          ['Agreed', src.declaration?.agreed],
          ['Signed by', src.declaration?.signedBy],
          ['Print name', src.declaration?.typedName],
          ['Date', src.declaration?.date],
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SubmissionImage label="Accident sketch" dataUrl={src.accidentSketch?.diagramDataUrl} />
        <SubmissionImage label="Signature" dataUrl={src.declaration?.signatureDataUrl} />
      </div>

      <AttachmentGallery title="Sketch uploads" attachments={sketchUploads} />
    </div>
  );
}

export function MemberSubmissionPanel({ claimItem, readOnly = true, onSaveSection }) {
  if (!readOnly && onSaveSection) {
    return <MemberSubmissionEditPanel claimItem={claimItem} onSaveSection={onSaveSection} />;
  }
  return <MemberSubmissionView claimItem={claimItem} />;
}
