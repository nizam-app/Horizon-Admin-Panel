export const CHECKLIST_LABELS = {
  license: 'Driver licence',
  taxiAuthority: 'Taxi authority',
  registration: 'Registration',
  otherDemand: 'Other party demand',
  policeReport: 'Police report',
  excessPayment: 'Excess payment',
  repairQuote: 'Repair quote',
  otherParties: 'Other parties detail',
};

export const YES_NO_OPTIONS = ['Yes', 'No'];

export function normalizeYesNoValue(v) {
  if (v === true || v === 'true' || v === 1 || v === '1') return 'Yes';
  if (v === false || v === 'false' || v === 0 || v === '0') return 'No';
  if (v === 'Yes' || v === 'No') return v;
  return v == null || v === '' ? '' : String(v);
}

export function submissionSyncKey(claimItem) {
  const id = claimItem?.id || claimItem?._id || '';
  const raw = claimItem?.updatedAt;
  const ts =
    raw == null
      ? ''
      : typeof raw === 'string'
        ? raw
        : raw instanceof Date
          ? raw.toISOString()
          : String(raw);
  return `${id}|${ts}`;
}

function stripUnchangedAttachments(files, baselineFiles) {
  if (!Array.isArray(files)) return [];
  const baseById = new Map(
    (baselineFiles || []).filter((f) => f?.id).map((f) => [String(f.id), f]),
  );
  return files.map((f) => {
    if (!f) return f;
    if (!f.id || !f.dataUrl) return f;
    const base = baseById.get(String(f.id));
    if (base?.dataUrl && base.dataUrl === f.dataUrl) {
      return { id: f.id, name: f.name, source: f.source || 'upload' };
    }
    return f;
  });
}

export function buildAllSubmissionDrafts(claimItem) {
  const { payload, data, src, submission } = submissionSource(claimItem);
  return {
    checklist: buildChecklistDraft(src, submission),
    memberVehicle: buildMemberVehicleDraft(data, src),
    driver: buildDriverDraft(data, src),
    incident: buildIncidentDraft(data, src),
    damage: buildDamageDraft(data, src),
    otherParties: buildOtherPartiesDraft(data, src),
    witnessDetails: buildWitnessesDraft(data, payload),
    declaration: buildDeclarationDraft(src),
  };
}

/** Shrink PATCH body — omit unchanged attachment blobs (server merges by file id). */
export function prepareSectionForSave(section, draft, baseline) {
  switch (section) {
    case 'checklist': {
      const b = baseline.checklist;
      return {
        ...draft,
        driverLicenseFrontAttachments: stripUnchangedAttachments(
          draft.driverLicenseFrontAttachments,
          b.driverLicenseFrontAttachments,
        ),
        driverLicenseBackAttachments: stripUnchangedAttachments(
          draft.driverLicenseBackAttachments,
          b.driverLicenseBackAttachments,
        ),
        taxiAuthorityAttachments: stripUnchangedAttachments(
          draft.taxiAuthorityAttachments,
          b.taxiAuthorityAttachments,
        ),
        registrationAttachments: stripUnchangedAttachments(
          draft.registrationAttachments,
          b.registrationAttachments,
        ),
      };
    }
    case 'damage': {
      const b = baseline.damage?.diagram || {};
      return {
        ...draft,
        diagram: {
          ...draft.diagram,
          scenePhotos: stripUnchangedAttachments(draft.diagram?.scenePhotos, b.scenePhotos),
          detailPhotos: stripUnchangedAttachments(draft.diagram?.detailPhotos, b.detailPhotos),
        },
      };
    }
    case 'otherParties': {
      const parties = Array.isArray(draft.otherParties) ? draft.otherParties : [];
      return {
        otherParties: parties.map((party, i) => {
          const base = baseline.otherParties?.[i] || {};
          return {
            ...party,
            licenceFrontAttachments: stripUnchangedAttachments(
              party.licenceFrontAttachments,
              base.licenceFrontAttachments,
            ),
            licenceBackAttachments: stripUnchangedAttachments(
              party.licenceBackAttachments,
              base.licenceBackAttachments,
            ),
          };
        }),
      };
    }
    case 'declaration': {
      const { signatureDataUrl: _sig, ...rest } = draft;
      return rest;
    }
    default:
      return draft;
  }
}

export function strVal(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || '—';
  return String(v);
}

export function mergeAttachmentLists(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const file of list) {
      if (!file || typeof file !== 'object') continue;
      const key = file.id || `${file.name || 'file'}:${file.dataUrl?.length || 0}:${file.source || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(file);
    }
  }
  return out;
}

export function formatAttachmentNames(list) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return '—';
  return items
    .map((f) => {
      const name = f?.name || 'file';
      const source = f?.source ? ` (${f.source})` : '';
      const embedded = f?.dataUrl ? ' · file attached' : '';
      return `${name}${source}${embedded}`;
    })
    .join(', ');
}

export function resolveChecklistFlag(checklist, key, attachmentLists = []) {
  if (checklist?.[key]) return true;
  return attachmentLists.some((list) => Array.isArray(list) && list.length > 0);
}

export function normalizeWitnesses(data, payload) {
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

export function submissionSource(claimItem) {
  const payload = claimItem?.payload && typeof claimItem.payload === 'object' ? claimItem.payload : null;
  const data = claimItem?.data ?? {};
  const submission = {
    ...(data.submission && typeof data.submission === 'object' ? data.submission : {}),
    ...(payload?.submission && typeof payload.submission === 'object' ? payload.submission : {}),
  };
  const src = payload ? { ...data, ...payload } : data;
  return { payload, data, src, submission };
}

export function buildChecklistDraft(src, submission) {
  const checklist = { ...(submission.checklist || {}), ...(src.checklist || {}) };
  return {
    checklist,
    excessPaymentApplicability: src.excessPaymentApplicability || submission.excessPaymentApplicability || '',
    excessPaymentAmount: src.excessPaymentAmount || submission.excessPaymentAmount || '',
    repairQuoteRef: src.repairQuoteRef || submission.repairQuoteRef || '',
    driverLicenseFrontAttachments: mergeAttachmentLists(
      src.driverLicenseFrontAttachments,
      submission.driverLicenseFrontAttachments,
    ),
    driverLicenseBackAttachments: mergeAttachmentLists(
      src.driverLicenseBackAttachments,
      submission.driverLicenseBackAttachments,
    ),
    taxiAuthorityAttachments: mergeAttachmentLists(
      src.taxiAuthorityAttachments,
      submission.taxiAuthorityAttachments,
    ),
    registrationAttachments: mergeAttachmentLists(
      src.registrationAttachments,
      submission.registrationAttachments,
    ),
  };
}

export function buildMemberVehicleDraft(data, src) {
  return { ...(data.memberVehicle || {}), ...(src.memberVehicle || {}) };
}

export function buildDriverDraft(data, src) {
  const dr = { ...(data.driver || {}), ...(src.driver || {}) };
  return {
    ...dr,
    isOwner: normalizeYesNoValue(dr.isOwner),
    alcoholOrDrug: normalizeYesNoValue(dr.alcoholOrDrug),
    breathTest: normalizeYesNoValue(dr.breathTest),
    policeReported: normalizeYesNoValue(dr.policeReported),
    atFault: normalizeYesNoValue(dr.atFault),
    admittedLiability: normalizeYesNoValue(dr.admittedLiability),
    otherDriverAdmittedLiability: normalizeYesNoValue(dr.otherDriverAdmittedLiability),
  };
}

export function buildIncidentDraft(data, src) {
  const inc = { ...(data.incident || {}), ...(src.incident || {}) };
  return {
    ...inc,
    trafficControls: Array.isArray(inc.trafficControls)
      ? inc.trafficControls
      : String(inc.trafficControls || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
  };
}

export function buildDamageDraft(data, src) {
  const dmg = { ...(data.damage || {}), ...(src.damage || {}) };
  const diagram = dmg.diagram || {};
  return {
    claimingDamage: normalizeYesNoValue(dmg.claimingDamage),
    towed: normalizeYesNoValue(dmg.towed),
    towCompany: dmg.towCompany ?? '',
    towLocation: dmg.towLocation ?? '',
    distanceTowed: dmg.distanceTowed ?? '',
    currentVehicleLocation: dmg.currentVehicleLocation ?? '',
    diagram: {
      markers: diagram.markers || [],
      strokes: diagram.strokes || [],
      scenePhotos: mergeAttachmentLists(diagram.scenePhotos),
      detailPhotos: mergeAttachmentLists(diagram.detailPhotos),
    },
  };
}

export function buildOtherPartiesDraft(data, src) {
  const parties = src.otherParties || data.otherParties || [];
  return parties.map((p) => ({
    ...p,
    licenceFrontAttachments: mergeAttachmentLists(p.licenceFrontAttachments),
    licenceBackAttachments: mergeAttachmentLists(p.licenceBackAttachments),
  }));
}

export function buildWitnessesDraft(data, payload) {
  const list = normalizeWitnesses(data, payload);
  while (list.length < 2) list.push({ name: '', address: '', mobile: '', email: '' });
  return list.slice(0, 2);
}

export function buildDeclarationDraft(src) {
  const d = src.declaration || {};
  return {
    agreed: Boolean(d.agreed),
    signedBy: d.signedBy ?? '',
    typedName: d.typedName ?? '',
    date: d.date ?? '',
    signatureDataUrl: d.signatureDataUrl ?? '',
  };
}

export async function fileToAttachment(file, maxBytes = 6 * 1024 * 1024) {
  if (!file || file.size > maxBytes) {
    throw new Error(`File must be under ${Math.round(maxBytes / (1024 * 1024))} MB`);
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: file.name,
    source: 'upload',
    dataUrl: String(dataUrl),
  };
}
