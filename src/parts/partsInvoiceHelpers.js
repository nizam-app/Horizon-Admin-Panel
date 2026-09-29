import * as api from '../api.js';
import { newPartInvoiceId, normalizePartRow } from './partUtils.js';

export async function uploadPartInvoice({ token, claimId, file, invoiceNumber }) {
  if (!file || !token || !claimId) throw new Error('Missing upload context');
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    throw new Error('Please upload a PDF invoice.');
  }
  const caseFiles = await api.uploadClaimPdf(token, claimId, file);
  const uploaded = caseFiles[caseFiles.length - 1];
  if (!uploaded) throw new Error('Upload failed');
  return {
    id: newPartInvoiceId(),
    invoiceNumber: String(invoiceNumber ?? '').trim(),
    fileId: uploaded.id,
    fileName: uploaded.name,
    fileUrl: uploaded.url,
  };
}

export async function removePartInvoiceFile({ token, claimId, fileId }) {
  if (token && fileId && claimId) {
    await api.deleteClaimPdf(token, claimId, fileId);
  }
}

export function catalogLinkSnapshot(part) {
  if (part?._linkCompany != null || part?._linkPartName != null) {
    return {
      company: part._linkCompany ?? part.company,
      partName: part._linkPartName ?? part.partName,
    };
  }
  if (part?.supplierPartId) {
    return {
      company: part._linkCompany ?? part.company,
      partName: part._linkPartName ?? part.partName,
    };
  }
  return null;
}

export function applyPartSuggestion(part, suggestion) {
  const partName = String(suggestion?.partName ?? '').trim();
  const amount = suggestion?.amount ?? '';
  const listPriceSnapshot = suggestion?.listPriceSnapshot ?? null;
  return normalizePartRow({
    ...part,
    partName,
    amount,
    listPriceSnapshot,
    supplierId: null,
    supplierPartId: null,
    _linkCompany: part.company,
    _linkPartName: partName,
  });
}

/** @deprecated use applyPartSuggestion */
export function applyCatalogToPart(part, catalogRow) {
  return applyPartSuggestion(part, {
    partName: catalogRow.partName,
    amount: catalogRow.amount,
    listPriceSnapshot: catalogRow.listPriceSnapshot,
  });
}

export function clearPartSuggestionLink(part) {
  return normalizePartRow({
    ...part,
    supplierId: null,
    supplierPartId: null,
    listPriceSnapshot: null,
    _linkCompany: undefined,
    _linkPartName: undefined,
  });
}

/** @deprecated use clearPartSuggestionLink */
export function clearPartCatalogLink(part) {
  return clearPartSuggestionLink(part);
}

export function updatePartInList(part, field, raw, linkSnapshot = null) {
  const next = { ...part };
  if (field === 'amount' || field === 'quotePrice') {
    const s = String(raw).replace(/,/g, '');
    if (s === '' || /^\d*\.?\d*$/.test(s)) next[field] = s;
    return normalizePartRow(next);
  }
  next[field] = raw;
  if (linkSnapshot && (field === 'company' || field === 'partName')) {
    const companyDrift = field === 'company' && String(raw).trim() !== String(linkSnapshot.company ?? '').trim();
    const nameDrift = field === 'partName' && String(raw).trim() !== String(linkSnapshot.partName ?? '').trim();
    if (companyDrift || nameDrift) {
      next.supplierId = null;
      next.supplierPartId = null;
      next.listPriceSnapshot = null;
      next._linkCompany = undefined;
      next._linkPartName = undefined;
    }
  }
  return normalizePartRow(next);
}
