/** Full printable HTML export — member payload + admin workspace fields + embedded images. */

import { damageDiagramExportHtml } from './DamageDiagramViewer.jsx';
import { resolveDamageDiagramFromDamage } from './memberSubmissionUtils.js';
import { apiBase } from './api.js';

const CHECKLIST_LABELS = {
  license: 'Driver licence',
  taxiAuthority: 'Taxi authority',
  registration: 'Copy of registration',
  otherDemand: 'Other party demand',
  policeReport: 'Police report',
  excessPayment: 'Excess payment',
  repairQuote: 'Repair quote',
  otherParties: 'Other parties detail',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function strVal(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || '—';
  return String(v);
}

function mergeLists(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const file of list) {
      if (!file || typeof file !== 'object') continue;
      const key = file.id || `${file.name}:${file.dataUrl?.length || file.url?.length || file.fileUrl?.length || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(file);
    }
  }
  return out;
}

function resolveFileHref(urlOrDataUrl) {
  const value = String(urlOrDataUrl || '').trim();
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) return value;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  const base = apiBase();
  return base ? `${base}${value.startsWith('/') ? value : `/${value}`}` : value;
}

function submissionFromClaim(item) {
  const payload = item?.payload && typeof item.payload === 'object' ? item.payload : null;
  const data = item?.data ?? {};
  const submission = {
    ...(data.submission && typeof data.submission === 'object' ? data.submission : {}),
  };
  const src = payload ? { ...data, ...payload } : data;
  return { payload, data, src, submission };
}

function fieldRows(pairs) {
  return pairs
    .map(
      ([label, value]) =>
        `<tr><th>${esc(label)}</th><td>${esc(strVal(value)).replace(/\n/g, '<br/>')}</td></tr>`,
    )
    .join('');
}

function section(title, rowsHtml, extraHtml = '') {
  return `
    <section class="section">
      <h2>${esc(title)}</h2>
      <table class="fields">${rowsHtml}</table>
      ${extraHtml}
    </section>`;
}

function attachmentImagesHtml(files, groupTitle) {
  const items = Array.isArray(files) ? files : [];
  if (!items.length) return '';
  return items
    .map((file, index) => {
      const name = esc(file?.name || `${groupTitle} ${index + 1}`);
      const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl.trim() : '';
      const storedUrl = typeof file?.url === 'string' ? file.url.trim() : typeof file?.fileUrl === 'string' ? file.fileUrl.trim() : '';
      const href = resolveFileHref(dataUrl || storedUrl);
      const mimeType = String(file?.mimeType || '').toLowerCase();
      if (dataUrl.startsWith('data:image/')) {
        return `<figure class="figure"><figcaption>${name}</figcaption><img src="${dataUrl}" alt="${name}" /></figure>`;
      }
      if (storedUrl && (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif)(?:$|\?)/i.test(storedUrl))) {
        return `<figure class="figure"><figcaption>${name}</figcaption><img src="${esc(href)}" alt="${name}" /></figure>`;
      }
      if (dataUrl.startsWith('data:application/pdf')) {
        return `<figure class="figure"><figcaption>${name}</figcaption><p class="muted">PDF attached — open this claim in the admin portal to download the file.</p></figure>`;
      }
      return `<figure class="figure"><figcaption>${name}</figcaption><p class="muted">Filename recorded${file?.source ? ` (${esc(file.source)})` : ''}. No preview stored.</p></figure>`;
    })
    .join('');
}

function gallerySection(title, files) {
  const html = attachmentImagesHtml(files, title);
  if (!html) return '';
  return `<section class="section"><h2>${esc(title)}</h2><div class="gallery">${html}</div></section>`;
}

function normalizeWitnesses(data, payload) {
  if (Array.isArray(payload?.witnessDetails) && payload.witnessDetails.length) return payload.witnessDetails;
  const w = data?.witnessDetails;
  if (!w || typeof w !== 'object' || Array.isArray(w)) return [];
  return [
    { name: w.witness1Name, address: w.witness1Address, mobile: w.witness1Mobile, email: w.witness1Email },
    { name: w.witness2Name, address: w.witness2Address, mobile: w.witness2Mobile, email: w.witness2Email },
  ].filter((x) => x.name || x.address || x.mobile || x.email);
}

/**
 * @param {object} item — claim row from admin API (must include payload when possible)
 * @param {{ refSummary: string, formatAud: (n:number)=>string, paymentLabel: string }} meta
 */
export function buildClaimExportHtml(item, meta) {
  const { payload, data, src, submission } = submissionFromClaim(item);
  if (!payload) {
    return `<html><body><p>No member submission payload stored for this claim.</p></body></html>`;
  }

  const mv = { ...(data.memberVehicle || {}), ...(src.memberVehicle || {}) };
  const dr = { ...(data.driver || {}), ...(src.driver || {}) };
  const inc = { ...(data.incident || {}), ...(src.incident || {}) };
  const dmg = { ...(data.damage || {}), ...(src.damage || {}) };
  const diagram = dmg.diagram || {};
  const checklist = { ...(submission.checklist || {}), ...(src.checklist || {}) };

  const licenseFront = mergeLists(src.driverLicenseFrontAttachments, submission.driverLicenseFrontAttachments);
  const licenseBack = mergeLists(src.driverLicenseBackAttachments, submission.driverLicenseBackAttachments);
  const taxiFiles = mergeLists(src.taxiAuthorityAttachments, submission.taxiAuthorityAttachments);
  const regFiles = mergeLists(src.registrationAttachments, submission.registrationAttachments);
  const scenePhotos = mergeLists(diagram.scenePhotos);
  const detailPhotos = mergeLists(diagram.detailPhotos);
  const sketchUploads = mergeLists(src.accidentSketch?.attachments);
  const parties = src.otherParties || data.otherParties || [];
  const witnesses = normalizeWitnesses(data, payload);

  const checklistRows = Object.entries(CHECKLIST_LABELS)
    .map(([key, label]) => [label, checklist[key] ? 'Selected' : 'Not selected'])
    .concat([
      ['Excess applicability', src.excessPaymentApplicability || submission.excessPaymentApplicability],
      ['Excess amount', src.excessPaymentAmount || submission.excessPaymentAmount],
      ['Repair quote ref.', src.repairQuoteRef || submission.repairQuoteRef],
    ]);

  const quoteOptions = item.quoteOptions ?? [];
  const primaryQuote = quoteOptions.find((q) => q.id === item.primaryQuoteId);
  const finalQuote = quoteOptions.find((q) => q.id === item.finalQuoteId);
  const parts = item.parts ?? [];
  const caseFiles = item.caseFiles ?? [];

  const partySections = parties
    .map((party, i) => {
      const front = mergeLists(party.licenceFrontAttachments);
      const back = mergeLists(party.licenceBackAttachments);
      return (
        section(
          `Other party ${i + 1}`,
          fieldRows([
            ['Plate', party.plateNumber],
            ['Make / model / colour', [party.make, party.model, party.color].filter(Boolean).join(' / ')],
            ['Driver', party.driverName],
            ['Owner', party.ownerDetails],
            ['Address', party.address],
            ['Contact', [party.mobile, party.email].filter(Boolean).join(' · ')],
            ['Licence', party.licenceNumber],
            ['Insurance', party.insuranceCompany],
            ['Claim no.', party.claimNumber],
          ]),
        ) +
        gallerySection(`Party ${i + 1} — licence front`, front) +
        gallerySection(`Party ${i + 1} — licence back`, back)
      );
    })
    .join('');

  const witnessSections =
    witnesses.length > 0
      ? witnesses
          .map((w, i) =>
            section(
              `Witness ${i + 1}`,
              fieldRows([
                ['Name', w.name],
                ['Address', w.address],
                ['Mobile', w.mobile],
                ['Email', w.email],
              ]),
            ),
          )
          .join('')
      : section('Witnesses', fieldRows([['Witnesses', 'None recorded']]));

  const partsRows =
    parts.length > 0
      ? parts
          .map(
            (p, i) =>
              `<tr>
                <td>${i + 1}</td>
                <td>${esc(p.company)}</td>
                <td>${esc(p.partName)}</td>
                <td>${esc(meta.formatAud(p.amount))}</td>
                <td>${p.quotePrice == null ? '—' : esc(meta.formatAud(p.quotePrice))}</td>
                <td>${p.quotePrice == null ? '—' : esc(meta.formatAud((Number(p.amount) || 0) - (Number(p.quotePrice) || 0)))}</td>
                <td>${esc(p.orderDate)}</td>
                <td>${esc(p.status)}</td>
              </tr>`,
          )
          .join('')
      : '<tr><td colspan="8">No purchase lines.</td></tr>';

  const diagramResolved = resolveDamageDiagramFromDamage(dmg);
  const markerCount = diagramResolved.markers.length;
  const strokeCount = diagramResolved.strokes.length;

  const body = `
    <header>
      <h1>Horizon Smash Repairs — Full claim export</h1>
      <p class="ref">${esc(meta.refSummary)}</p>
      <p class="meta">
        <strong>Plate:</strong> ${esc(item.plateNumber)} ·
        <strong>Driver:</strong> ${esc(item.driverName)} ·
        <strong>Status:</strong> ${esc(item.status)} ·
        <strong>Incident:</strong> ${esc(item.dateOfIncident)} ·
        <strong>Exported:</strong> ${esc(new Date().toLocaleString())}
      </p>
    </header>

    ${section('1. Checklist & documents', fieldRows(checklistRows))}
    ${gallerySection('Driver licence — front', licenseFront)}
    ${gallerySection('Driver licence — back', licenseBack)}
    ${gallerySection('Taxi authority', taxiFiles)}
    ${gallerySection('Copy of registration', regFiles)}

    ${section(
      '2. Member & vehicle',
      fieldRows([
        ['Member number', mv.memberNumber],
        ['Claim type', mv.claimType],
        ['Plate', mv.plateNumber],
        ['Make', mv.make],
        ['Model', mv.model],
        ['Kilometers', mv.kilometers],
        ['Month / year', mv.monthYear],
        ['Owner', mv.ownerName],
        ['Address', mv.address],
        ['Mobile', mv.mobile],
        ['Email', mv.email],
      ]),
    )}

    ${section(
      '3. Driver',
      fieldRows([
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
      ]),
    )}

    ${section(
      '4. Incident',
      fieldRows([
        ['Date', inc.date],
        ['Day', inc.day],
        ['Time', inc.time],
        ['Street', inc.streetName],
        ['Suburb', inc.suburb],
        ['Address detail', inc.addressDetailOptional],
        ['Road surface', inc.roadSurface],
        ['Vehicle state', inc.coveredVehicleState],
        ['Traffic controls', inc.trafficControls],
        ['Other vehicles', inc.numberOfVehicles],
        ['Your speed', inc.estimatedSpeed],
        ['Other speed', inc.estimatedOtherSpeed],
        ['Description', inc.description],
      ]),
    )}

    ${section(
      '5. Accident sketch',
      fieldRows([['Canvas diagram', src.accidentSketch?.diagramDataUrl ? 'Yes' : 'No']]),
      attachmentImagesHtml(
        src.accidentSketch?.diagramDataUrl ? [{ name: 'Sketch canvas', dataUrl: src.accidentSketch.diagramDataUrl }] : [],
        'Sketch',
      ),
    )}
    ${gallerySection('Sketch uploads', sketchUploads)}

    ${section(
      '6. Damage & towing',
      fieldRows([
        ['Claiming damage', dmg.claimingDamage],
        ['Towed', dmg.towed],
        ['Tow company', dmg.towCompany],
        ['Tow location', dmg.towLocation],
        ['Distance towed', dmg.distanceTowed],
        ['Vehicle location', dmg.currentVehicleLocation],
        ['Damage markers', markerCount],
        ['Damage drawings', strokeCount],
      ]),
    )}
    ${damageDiagramExportHtml(dmg)}
    ${gallerySection('Damage — scene photos', scenePhotos)}
    ${gallerySection('Damage — close-up photos', detailPhotos)}

    ${partySections || section('7. Other parties', fieldRows([['Other parties', 'None recorded']]))}
    ${witnessSections}

    ${section(
      '9. Declaration',
      fieldRows([
        ['Agreed', src.declaration?.agreed],
        ['Signed by', src.declaration?.signedBy],
        ['Print name', src.declaration?.typedName],
        ['Date', src.declaration?.date],
      ]),
      attachmentImagesHtml(
        src.declaration?.signatureDataUrl ? [{ name: 'Signature', dataUrl: src.declaration.signatureDataUrl }] : [],
        'Signature',
      ),
    )}

    ${section(
      '10. Admin workspace',
      fieldRows([
        ['Quote price', item.quotePrice != null ? meta.formatAud(item.quotePrice) : '—'],
        ['Insurance price', item.insuranceApprovedPrice != null ? meta.formatAud(item.insuranceApprovedPrice) : '—'],
        ['Primary quote', primaryQuote ? `${primaryQuote.supplier} (${meta.formatAud(primaryQuote.amount)})` : '—'],
        ['Final quote', finalQuote ? `${finalQuote.supplier} (${meta.formatAud(finalQuote.amount)})` : '—'],
        ['Payment status', meta.paymentLabel],
        ['Admin note', item.adminNote || '—'],
        ['Case PDF files', caseFiles.length ? caseFiles.map((f) => f.name).join(', ') : '—'],
      ]),
    )}

    <section class="section">
      <h2>11. Purchase lines</h2>
      <table class="parts">
        <thead><tr><th>#</th><th>Supplier</th><th>Part</th><th>Amount</th><th>Quote</th><th>Difference</th><th>Order</th><th>Status</th></tr></thead>
        <tbody>${partsRows}</tbody>
      </table>
    </section>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Claim ${esc(item.intakeReference || item.plateNumber)}</title>
  <style>
    @page { margin: 14mm; }
    body { font-family: Inter, system-ui, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.45; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    h2 { font-size: 14px; margin: 0 0 10px; color: #0f766e; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    .ref { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
    .meta { color: #475569; font-size: 12px; margin: 12px 0 24px; }
    .section { margin-top: 22px; break-inside: avoid-page; }
    table.fields { width: 100%; border-collapse: collapse; }
    table.fields th { text-align: left; vertical-align: top; width: 34%; padding: 6px 10px 6px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    table.fields td { padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
    table.parts { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.parts th, table.parts td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
    .gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .figure { margin: 0; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafafa; break-inside: avoid; }
    .figure img { display: block; width: 100%; max-height: 320px; object-fit: contain; margin-top: 8px; }
    figcaption { font-size: 10px; font-weight: 600; color: #475569; }
    .muted { color: #64748b; font-size: 11px; margin: 8px 0 0; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function openClaimExportPrint(html) {
  const printable = window.open('', '_blank', 'width=1100,height=900');
  if (!printable) {
    window.alert('Pop-up blocked. Allow pop-ups to export PDF, then try again.');
    return;
  }
  printable.document.write(html);
  printable.document.close();
  printable.focus();
  setTimeout(() => printable.print(), 400);
}
