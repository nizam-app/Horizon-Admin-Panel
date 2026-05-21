/** Horizon admin API helpers (pairs with horizon-backend). */

import { apiBase as resolvedApiBase, requireApiBase } from './apiBase.js';

export function apiBase() {
  return resolvedApiBase();
}

export class ApiAuthError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

function authHdr(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJson(res) {
  return res.json().catch(() => ({}));
}

async function handleResponse(res, data) {
  if (res.status === 401) throw new ApiAuthError(typeof data?.error === 'string' ? data.error : 'Session expired');
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`);
  return data;
}

export async function loginAdmin(email, password) {
  const res = await fetch(`${requireApiBase()}/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson(res);
  return handleResponse(res, data);
}

export async function listClaims(token, query = {}) {
  const qp = new URLSearchParams();
  if (query.status && query.status !== 'All') qp.set('status', query.status);
  if (query.q) qp.set('q', String(query.q).trim());
  if (query.paymentStatus) qp.set('paymentStatus', query.paymentStatus);
  const qs = qp.toString();
  const res = await fetch(`${requireApiBase()}/v1/admin/claims${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json', ...authHdr(token) },
  });
  const data = await parseJson(res);
  await handleResponse(res, data);
  return data.claims || [];
}

export async function getClaim(token, id) {
  const claimId = normalizeClaimId(id);
  if (!claimId) throw new Error('Invalid claim id');
  const res = await fetch(`${requireApiBase()}/v1/admin/claims/${encodeURIComponent(claimId)}`, {
    headers: { Accept: 'application/json', ...authHdr(token) },
  });
  const data = await parseJson(res);
  await handleResponse(res, data);
  return data.claim;
}

/** 24-char hex MongoDB ObjectId string for claim routes. */
export function normalizeClaimId(raw) {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (/^[a-f\d]{24}$/i.test(s)) return s;
    return '';
  }
  if (typeof raw === 'object') {
    if (typeof raw.$oid === 'string') return normalizeClaimId(raw.$oid);
    if (typeof raw.toHexString === 'function') {
      const hex = raw.toHexString();
      if (/^[a-f\d]{24}$/i.test(hex)) return hex;
    }
    if (typeof raw.toString === 'function') {
      const s = raw.toString();
      if (/^[a-f\d]{24}$/i.test(s)) return s;
    }
  }
  return '';
}

export function claimFromApi(raw) {
  const { _id: _mongoId, id: _legacyId, ...rest } = raw && typeof raw === 'object' ? raw : {};
  const resolvedId =
    normalizeClaimId(raw?._id) ||
    normalizeClaimId(_mongoId) ||
    normalizeClaimId(raw?.id) ||
    normalizeClaimId(_legacyId);
  return {
    ...rest,
    _id: resolvedId || undefined,
    id: resolvedId,
    data: { ...(raw.data || {}) },
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : null,
    caseFiles: Array.isArray(raw.caseFiles) ? raw.caseFiles : [],
    quoteOptions: Array.isArray(raw.quoteOptions) ? raw.quoteOptions : [],
    parts: Array.isArray(raw.parts) ? raw.parts : [],
    adminNote: raw.adminNote ?? '',
    paymentStatus: raw.paymentStatus ?? 'pending',
    quotePrice: raw.quotePrice ?? null,
    insuranceApprovedPrice: raw.insuranceApprovedPrice ?? null,
  };
}

/**
 * All admin-editable workspace fields sent to PATCH /v1/admin/claims/:id.
 * (Claim status uses the same endpoint via patchClaimStatus. PDFs use POST/DELETE /files.)
 */
export function mapQuoteOptionsForApi(quoteOptions) {
  return (quoteOptions || []).map((q) => ({
    id: String(q.id || '').trim() || `quote-${Date.now()}`,
    supplier: String(q.supplier ?? '').trim(),
    amount: typeof q.amount === 'number' && !Number.isNaN(q.amount) ? q.amount : Number(q.amount) || 0,
    reference: String(q.reference ?? '').trim(),
    notes: String(q.notes ?? '').trim(),
  }));
}

export function mapPartsForApi(parts) {
  return (parts || []).map((p) => ({
    id: String(p.id || '').trim() || `part-${Date.now()}`,
    company: String(p.company ?? '').trim(),
    amount: typeof p.amount === 'number' && !Number.isNaN(p.amount) ? p.amount : Number(p.amount) || 0,
    status: String(p.status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending',
    notes: String(p.notes ?? '').trim(),
  }));
}

export function buildAdminPersistBody(claim) {
  return {
    quotePrice: claim.quotePrice ?? null,
    insuranceApprovedPrice: claim.insuranceApprovedPrice ?? null,
    quoteOptions: mapQuoteOptionsForApi(claim.quoteOptions),
    primaryQuoteId: claim.primaryQuoteId ?? null,
    finalQuoteId: claim.finalQuoteId ?? null,
    paymentStatus: claim.paymentStatus ?? 'pending',
    adminNote: claim.adminNote ?? '',
    parts: mapPartsForApi(claim.parts),
  };
}

/** @deprecated Use buildAdminPersistBody */
export const buildWorkspacePatchBody = buildAdminPersistBody;

export async function patchClaimWorkspace(token, id, body) {
  const claimId = normalizeClaimId(id);
  if (!claimId) throw new Error('Invalid claim id');
  const res = await fetch(`${requireApiBase()}/v1/admin/claims/${encodeURIComponent(claimId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHdr(token) },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  await handleResponse(res, data);
  return claimFromApi(data.claim);
}

/** Save full admin workspace for a claim (pricing, quotes, parts, notes, payment). */
export async function persistAdminWorkspace(token, claim) {
  const claimId = normalizeClaimId(claim?.id ?? claim?._id);
  if (!claimId) throw new Error('Invalid claim id');
  return patchClaimWorkspace(token, claimId, buildAdminPersistBody(claim));
}

/** Save admin note only (PATCH /v1/admin/claims/:id). */
export async function persistAdminNote(token, claimId, adminNote) {
  return patchClaimWorkspace(token, claimId, { adminNote: adminNote ?? '' });
}

/** Save supplier part lines only. */
export async function persistParts(token, claimId, parts) {
  return patchClaimWorkspace(token, claimId, { parts: mapPartsForApi(parts) });
}

/** Save repair quote lines and optional primary/final selection. */
export async function persistQuoteWorkspace(token, claimId, { quoteOptions, primaryQuoteId, finalQuoteId }) {
  const body = {};
  if (quoteOptions !== undefined) body.quoteOptions = mapQuoteOptionsForApi(quoteOptions);
  if (primaryQuoteId !== undefined) body.primaryQuoteId = primaryQuoteId || null;
  if (finalQuoteId !== undefined) body.finalQuoteId = finalQuoteId || null;
  return patchClaimWorkspace(token, claimId, body);
}

/** Save payment status only. */
export async function persistPaymentStatus(token, claimId, paymentStatus) {
  return patchClaimWorkspace(token, claimId, { paymentStatus: paymentStatus ?? 'pending' });
}

/** Save one or both price fields (PATCH /v1/admin/claims/:id). Only keys present on `prices` are sent. */
export async function persistClaimPrices(token, claimId, prices) {
  const body = {};
  if (Object.prototype.hasOwnProperty.call(prices, 'quotePrice')) {
    body.quotePrice = prices.quotePrice ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(prices, 'insuranceApprovedPrice')) {
    body.insuranceApprovedPrice = prices.insuranceApprovedPrice ?? null;
  }
  if (Object.keys(body).length === 0) throw new Error('No price fields to save');
  return patchClaimWorkspace(token, claimId, body);
}

export async function patchClaimStatus(token, id, status) {
  return patchClaimWorkspace(token, id, { status });
}

export async function uploadClaimPdf(token, claimId, file) {
  const id = normalizeClaimId(claimId);
  if (!id) throw new Error('Invalid claim id');
  const fd = new FormData();
  fd.append('pdf', file, file.name);
  const res = await fetch(`${requireApiBase()}/v1/admin/claims/${encodeURIComponent(id)}/files`, {
    method: 'POST',
    headers: { ...authHdr(token) },
    body: fd,
  });
  const data = await parseJson(res);
  await handleResponse(res, data);
  return Array.isArray(data.caseFiles) ? data.caseFiles : [];
}

export async function deleteClaimPdf(token, claimId, fileId) {
  const id = normalizeClaimId(claimId);
  if (!id) throw new Error('Invalid claim id');
  const res = await fetch(
    `${requireApiBase()}/v1/admin/claims/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json', ...authHdr(token) },
    }
  );
  const data = await parseJson(res);
  await handleResponse(res, data);
  return Array.isArray(data.caseFiles) ? data.caseFiles : [];
}
