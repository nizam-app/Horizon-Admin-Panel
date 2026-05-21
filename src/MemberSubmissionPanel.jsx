const CHECKLIST_LABELS = {
  license: 'Driver licence',
  taxiAuthority: 'Taxi authority',
  registration: 'Registration',
  otherDemand: 'Other party demand',
  policeReport: 'Police report',
  excessPayment: 'Excess payment',
  repairQuote: 'Repair quote',
  otherParties: 'Other parties detail',
};

function strVal(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || '—';
  return String(v);
}

function formatAttachmentNames(list) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return '—';
  return items
    .map((f) => `${f?.name || 'file'}${f?.source ? ` (${f.source})` : ''}`)
    .join(', ');
}

function normalizeWitnesses(data, payload) {
  if (Array.isArray(payload?.witnessDetails) && payload.witnessDetails.length) {
    return payload.witnessDetails;
  }
  const w = data?.witnessDetails;
  if (!w || typeof w !== 'object' || Array.isArray(w)) return [];
  return [
    { name: w.witness1Name, address: w.witness1Address, mobile: w.witness1Mobile, email: w.witness1Email },
    { name: w.witness2Name, address: w.witness2Address, mobile: w.witness2Mobile, email: w.witness2Email },
  ].filter((x) => x.name || x.address || x.mobile || x.email);
}

function submissionSource(claimItem) {
  const payload = claimItem?.payload && typeof claimItem.payload === 'object' ? claimItem.payload : null;
  const data = claimItem?.data ?? {};
  return { payload, data, src: payload || data };
}

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

export function MemberSubmissionPanel({ claimItem }) {
  const { payload, data, src } = submissionSource(claimItem);
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
  const checklist = src.checklist || {};
  const witnesses = normalizeWitnesses(data, payload);
  const parties = src.otherParties || data.otherParties || [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Full intake as submitted through the member portal (including sketch and signature when provided).
      </p>

      <DetailCard
        title="Checklist"
        items={[
          ...Object.entries(CHECKLIST_LABELS).map(([key, label]) => [label, checklist[key] ? 'Selected' : 'Not selected']),
          ['Excess applicability', src.excessPaymentApplicability],
          ['Excess amount', src.excessPaymentAmount],
          ['Repair quote ref.', src.repairQuoteRef],
          ['Licence (front) files', formatAttachmentNames(src.driverLicenseFrontAttachments)],
          ['Licence (back) files', formatAttachmentNames(src.driverLicenseBackAttachments)],
          ['Taxi authority files', formatAttachmentNames(src.taxiAuthorityAttachments)],
          ['Registration files', formatAttachmentNames(src.registrationAttachments)],
        ]}
      />

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
          ['Scene photos', formatAttachmentNames(dmg.diagram?.scenePhotos)],
          ['Detail photos', formatAttachmentNames(dmg.diagram?.detailPhotos)],
        ]}
      />

      {parties.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-zinc-900">Other parties ({parties.length})</h3>
          {parties.map((party, i) => (
            <DetailCard
              key={`party-${i}`}
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
          ))}
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

      {Array.isArray(src.accidentSketch?.attachments) && src.accidentSketch.attachments.length > 0 && (
        <DetailCard title="Sketch uploads" items={[['Files', formatAttachmentNames(src.accidentSketch.attachments)]]} />
      )}
    </div>
  );
}
