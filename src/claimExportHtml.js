/** Printable member claim report with submitted fields and evidence images. */

import { damageDiagramExportHtml } from './DamageDiagramViewer.jsx';
import { resolveDamageDiagramFromDamage } from './memberSubmissionUtils.js';
import { apiBase } from './api.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function strVal(value) {
  if (value == null || value === '') return 'Not supplied';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || 'Not supplied';
  return String(value);
}

function hasPrintableValue(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  if (Array.isArray(value)) return value.some(hasPrintableValue);
  return String(value).trim() !== '';
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

function fieldRows(pairs, { keepEmptyLabels = [] } = {}) {
  const required = new Set(keepEmptyLabels);
  const rows = pairs
    .filter(([label, value]) => required.has(label) || hasPrintableValue(value))
    .map(
      ([label, value]) =>
        `<tr><th>${esc(label)}</th><td>${esc(strVal(value)).replace(/\n/g, '<br/>')}</td></tr>`,
    )
    .join('');
  return rows || '<tr><td colspan="2" class="muted">No details supplied.</td></tr>';
}

function section(title, rowsHtml, extraHtml = '') {
  return `
    <section class="section">
      <h2>${esc(title)}</h2>
      <table class="fields">${rowsHtml}</table>
      ${extraHtml}
    </section>`;
}

function panel(title, contentHtml) {
  return `
    <section class="section">
      <h2>${esc(title)}</h2>
      ${contentHtml || '<p class="muted">No details supplied.</p>'}
    </section>`;
}

function fileDisplayName(file, groupTitle, index) {
  return file?.name || file?.originalName || `${groupTitle} ${index + 1}`;
}

function attachmentImagesHtml(files, groupTitle) {
  const items = Array.isArray(files) ? files : [];
  if (!items.length) return '';
  return items
    .map((file, index) => {
      const name = esc(fileDisplayName(file, groupTitle, index));
      const dataUrl = typeof file?.dataUrl === 'string' ? file.dataUrl.trim() : '';
      const storedUrl = typeof file?.url === 'string' ? file.url.trim() : typeof file?.fileUrl === 'string' ? file.fileUrl.trim() : '';
      const href = resolveFileHref(dataUrl || storedUrl);
      const mimeType = String(file?.mimeType || '').toLowerCase();
      if (dataUrl.startsWith('data:image/')) {
        return `<figure class="figure"><figcaption>${name}</figcaption><img src="${dataUrl}" alt="${name}" /></figure>`;
      }
      if (storedUrl && (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)(?:$|\?)/i.test(storedUrl))) {
        return `<figure class="figure"><figcaption>${name}</figcaption><img src="${esc(href)}" alt="${name}" /></figure>`;
      }
      if (dataUrl.startsWith('data:application/pdf') || /\.pdf(?:$|\?)/i.test(storedUrl)) {
        return `<figure class="figure file-card"><figcaption>${name}</figcaption><p>PDF attached. Open the claim in admin to view or download the original file.</p></figure>`;
      }
      return `<figure class="figure file-card"><figcaption>${name}</figcaption><p>File recorded${file?.source ? ` (${esc(file.source)})` : ''}. Preview unavailable.</p></figure>`;
    })
    .join('');
}

function gallerySection(title, files) {
  const html = attachmentImagesHtml(files, title);
  if (!html) return '';
  return panel(title, `<div class="gallery">${html}</div>`);
}

function normalizeWitnesses(data, payload) {
  if (Array.isArray(payload?.witnessDetails) && payload.witnessDetails.length) return payload.witnessDetails;
  const w = data?.witnessDetails;
  if (!w || typeof w !== 'object' || Array.isArray(w)) return [];
  return [
    { name: w.witness1Name, address: w.witness1Address, mobile: w.witness1Mobile, email: w.witness1Email },
    { name: w.witness2Name, address: w.witness2Address, mobile: w.witness2Mobile, email: w.witness2Email },
  ].filter((item) => item.name || item.address || item.mobile || item.email);
}

function evidenceIndex(items) {
  const rows = items
    .filter((item) => item.count > 0 || item.required)
    .map(
      (item) => `
        <div class="evidence-item ${item.count > 0 ? 'is-complete' : 'is-missing'}">
          <span>${esc(item.label)}</span>
          <strong>${item.count > 0 ? `${item.count} file${item.count === 1 ? '' : 's'}` : 'Not supplied'}</strong>
        </div>`,
    )
    .join('');
  return rows ? `<div class="evidence-index">${rows}</div>` : '<p class="muted">No evidence files supplied.</p>';
}

function peoplePanels(title, people, buildRows) {
  if (!people.length) return section(title, fieldRows([[title, 'None recorded']], { keepEmptyLabels: [title] }));
  const html = people
    .map((person, index) => `
      <div class="subpanel">
        <h3>${esc(`${title.replace(/s$/, '')} ${index + 1}`)}</h3>
        <table class="fields">${fieldRows(buildRows(person))}</table>
      </div>`)
    .join('');
  return panel(title, html);
}

/**
 * @param {object} item - claim row from admin API, including payload where available.
 * @param {{ refSummary: string, formatAud: (n:number)=>string, paymentLabel: string }} meta
 */
export function buildClaimExportHtml(item, meta) {
  const { payload, data, src, submission } = submissionFromClaim(item);
  if (!payload) {
    return '<html><body><p>No member submission payload stored for this claim.</p></body></html>';
  }

  const mv = { ...(data.memberVehicle || {}), ...(src.memberVehicle || {}) };
  const dr = { ...(data.driver || {}), ...(src.driver || {}) };
  const inc = { ...(data.incident || {}), ...(src.incident || {}) };
  const dmg = { ...(data.damage || {}), ...(src.damage || {}) };
  const diagram = dmg.diagram || {};
  const sketch = src.accidentSketch || {};
  const declaration = src.declaration || {};

  const licenseFront = mergeLists(src.driverLicenseFrontAttachments, submission.driverLicenseFrontAttachments);
  const licenseBack = mergeLists(src.driverLicenseBackAttachments, submission.driverLicenseBackAttachments);
  const taxiFiles = mergeLists(src.taxiAuthorityAttachments, submission.taxiAuthorityAttachments);
  const regFiles = mergeLists(src.registrationAttachments, submission.registrationAttachments);
  const scenePhotos = mergeLists(diagram.scenePhotos);
  const detailPhotos = mergeLists(diagram.detailPhotos);
  const sketchUploads = mergeLists(sketch.attachments);
  const signatureFiles = declaration.signatureDataUrl ? [{ name: 'Declaration signature', dataUrl: declaration.signatureDataUrl }] : [];
  const parties = Array.isArray(src.otherParties || data.otherParties) ? src.otherParties || data.otherParties : [];
  const witnesses = normalizeWitnesses(data, payload);
  const diagramResolved = resolveDamageDiagramFromDamage(dmg);

  const evidenceItems = [
    { label: 'Driver licence front', count: licenseFront.length, required: true },
    { label: 'Driver licence back', count: licenseBack.length, required: true },
    { label: 'Registration', count: regFiles.length, required: true },
    { label: 'Taxi authority', count: taxiFiles.length, required: false },
    { label: 'Accident sketch', count: (sketch.diagramDataUrl ? 1 : 0) + sketchUploads.length, required: false },
    { label: 'Damage photos', count: scenePhotos.length + detailPhotos.length, required: true },
    { label: 'Declaration signature', count: signatureFiles.length, required: true },
  ];

  const summaryRows = fieldRows(
    [
      ['Claim reference', item.intakeReference],
      ['System reference', item.systemReference],
      ['Plate', item.plateNumber || mv.plateNumber],
      ['Driver', item.driverName || dr.name || [dr.firstName, dr.lastName].filter(Boolean).join(' ')],
      ['Incident date', item.dateOfIncident || inc.date],
      ['Submitted', item.submittedAt || item.createdAt],
    ],
    { keepEmptyLabels: ['Claim reference', 'Plate', 'Driver', 'Incident date'] },
  );

  const reportBody = `
    <header class="cover">
      <p class="eyebrow">Member Claim Report</p>
      <h1>Horizon Smash Repairs</h1>
      <p class="ref">${esc(meta.refSummary)}</p>
      <div class="cover-meta">
        <div><span>Plate</span><strong>${esc(item.plateNumber || mv.plateNumber || 'Not supplied')}</strong></div>
        <div><span>Driver</span><strong>${esc(item.driverName || dr.name || 'Not supplied')}</strong></div>
        <div><span>Incident</span><strong>${esc(item.dateOfIncident || inc.date || 'Not supplied')}</strong></div>
        <div><span>Exported</span><strong>${esc(new Date().toLocaleString())}</strong></div>
      </div>
    </header>

    ${section('1. Claim summary', summaryRows)}
    ${panel('2. Evidence index', evidenceIndex(evidenceItems))}

    ${section(
      '3. Member and vehicle',
      fieldRows(
        [
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
        ],
        { keepEmptyLabels: ['Plate', 'Owner'] },
      ),
    )}
    ${gallerySection('Registration evidence', regFiles)}

    ${section(
      '4. Driver',
      fieldRows(
        [
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
        ],
        { keepEmptyLabels: ['Name', 'Licence no.'] },
      ),
    )}
    ${gallerySection('Driver licence - front', licenseFront)}
    ${gallerySection('Driver licence - back', licenseBack)}
    ${gallerySection('Taxi authority', taxiFiles)}

    ${section(
      '5. Incident',
      fieldRows(
        [
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
        ],
        { keepEmptyLabels: ['Date', 'Description'] },
      ),
    )}

    ${section(
      '6. Accident sketch',
      fieldRows([['Canvas diagram', sketch.diagramDataUrl ? 'Yes' : 'No']]),
      attachmentImagesHtml(sketch.diagramDataUrl ? [{ name: 'Sketch canvas', dataUrl: sketch.diagramDataUrl }] : [], 'Sketch canvas'),
    )}
    ${gallerySection('Sketch uploads', sketchUploads)}

    ${section(
      '7. Damage and towing',
      fieldRows([
        ['Claiming damage', dmg.claimingDamage],
        ['Towed', dmg.towed],
        ['Tow company', dmg.towCompany],
        ['Tow location', dmg.towLocation],
        ['Distance towed', dmg.distanceTowed],
        ['Vehicle location', dmg.currentVehicleLocation],
        ['Damage markers', diagramResolved.markers.length],
        ['Damage drawings', diagramResolved.strokes.length],
      ]),
    )}
    ${damageDiagramExportHtml(dmg)}
    ${gallerySection('Damage - scene photos', scenePhotos)}
    ${gallerySection('Damage - close-up photos', detailPhotos)}

    ${peoplePanels('8. Other parties', parties, (party) => [
      ['Plate', party.plateNumber],
      ['Make / model / colour', [party.make, party.model, party.color].filter(Boolean).join(' / ')],
      ['Driver', party.driverName],
      ['Owner', party.ownerDetails],
      ['Address', party.address],
      ['Contact', [party.mobile, party.email].filter(Boolean).join(' / ')],
      ['Licence', party.licenceNumber],
      ['Insurance', party.insuranceCompany],
      ['Claim no.', party.claimNumber],
    ])}

    ${peoplePanels('9. Witnesses', witnesses, (witness) => [
      ['Name', witness.name],
      ['Address', witness.address],
      ['Mobile', witness.mobile],
      ['Email', witness.email],
    ])}

    ${section(
      '10. Declaration',
      fieldRows(
        [
          ['Agreed', declaration.agreed],
          ['Signed by', declaration.signedBy],
          ['Print name', declaration.typedName],
          ['Date', declaration.date],
        ],
        { keepEmptyLabels: ['Agreed', 'Print name'] },
      ),
      attachmentImagesHtml(signatureFiles, 'Signature'),
    )}
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Claim ${esc(item.intakeReference || item.plateNumber || 'report')}</title>
  <style>
    @page { margin: 12mm; }
    * { box-sizing: border-box; }
    body { max-width: 980px; margin: 0 auto; padding: 26px 28px 34px; font-family: Inter, Arial, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.45; background: #fff; }
    .cover { text-align: center; border: 1px solid #dbe7e4; border-top: 4px solid #0f766e; border-radius: 10px; padding: 20px 22px 18px; margin-bottom: 22px; break-inside: avoid; page-break-inside: avoid; }
    h1 { font-size: 25px; line-height: 1.1; margin: 2px 0 8px; color: #0f172a; }
    .eyebrow { margin: 0; color: #0f766e; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; }
    h2 { font-size: 14px; margin: 0 0 10px; color: #0f766e; border-bottom: 1px solid #dbe7e4; padding-bottom: 7px; }
    h3 { margin: 0 0 8px; font-size: 12px; color: #111827; }
    .ref { margin: 0; font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
    .cover-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 16px; text-align: left; }
    .cover-meta div, .evidence-item, .subpanel { border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
    .cover-meta div { padding: 9px 10px; min-height: 52px; }
    .cover-meta span, .evidence-item span { display: block; margin-bottom: 3px; color: #64748b; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
    .cover-meta strong, .evidence-item strong { display: block; color: #111827; font-size: 12px; line-height: 1.25; overflow-wrap: anywhere; }
    .section { margin-top: 18px; padding-top: 2px; break-inside: avoid-page; page-break-inside: avoid; }
    .subpanel { padding: 12px; margin-top: 10px; background: #fff; }
    .evidence-index { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .evidence-item { padding: 9px 10px; }
    .evidence-item.is-complete { border-color: #a7f3d0; background: #ecfdf5; }
    .evidence-item.is-missing { border-color: #fed7aa; background: #fff7ed; }
    table.fields { width: 100%; border-collapse: collapse; }
    table.fields th { text-align: left; vertical-align: top; width: 30%; padding: 7px 14px 7px 0; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; border-bottom: 1px solid #edf2f7; }
    table.fields td { padding: 7px 0; border-bottom: 1px solid #edf2f7; color: #111827; overflow-wrap: anywhere; }
    .gallery { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: start; }
    .figure { margin: 0; padding: 9px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fafafa; break-inside: avoid; page-break-inside: avoid; }
    .figure img { display: block; width: 100%; max-height: 245px; object-fit: contain; margin-top: 7px; border-radius: 5px; background: #fff; }
    .file-card p { margin: 8px 0 0; color: #475569; }
    figcaption { font-size: 9px; font-weight: 700; color: #475569; overflow-wrap: anywhere; }
    .muted { color: #64748b; font-size: 11px; margin: 8px 0 0; }
    @media print {
      body { max-width: none; padding: 0; }
      .cover { border-radius: 0; }
      .figure img { max-height: 230px; }
    }
  </style>
</head>
<body>${reportBody}</body>
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
