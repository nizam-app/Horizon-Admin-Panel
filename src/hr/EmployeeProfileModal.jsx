import { useCallback, useEffect, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import * as api from '../api.js';
import { HrDateInput, HrField, HrMoneyInput, HrSelect, HrTextInput } from './HrForm.jsx';
import { formatMoneyPerHour } from './money.js';
import { hrPrimaryBtn, hrSecondaryBtn } from './HrUi.jsx';
import { useHrLoadError } from '../hrPanelUtils.js';

function isoToDateInput(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function employeeToForm(emp) {
  return {
    employeeNumber: emp.employeeNumber || '',
    displayName: emp.displayName || '',
    email: emp.email || '',
    phone: emp.phone || '',
    department: emp.department || '',
    jobTitle: emp.jobTitle || '',
    hireDate: isoToDateInput(emp.hireDate),
    hourlyRate: String(emp.hourlyRate ?? ''),
    status: emp.status || 'active',
  };
}

function DetailRow({ label, value }) {
  return (
    <div className="min-w-0 border-b border-zinc-100 py-3 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-2xs font-semibold uppercase tracking-wider text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm text-zinc-900 sm:col-span-2 sm:mt-0">{value || '—'}</dd>
    </div>
  );
}

export function EmployeeProfileModal({
  open,
  mode = 'view',
  employeeId,
  token,
  onClose,
  onSaved,
  onAuthError,
  onSwitchToEdit,
}) {
  const [employee, setEmployee] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token || !employeeId) return;
    setLoading(true);
    setError('');
    try {
      const emp = await api.getEmployee(token, employeeId);
      setEmployee(emp);
      setForm(employeeToForm(emp));
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    } finally {
      setLoading(false);
    }
  }, [token, employeeId, onAuthError]);

  useEffect(() => {
    if (!open || !employeeId) {
      setEmployee(null);
      setForm(null);
      setError('');
      return;
    }
    void load();
  }, [open, employeeId, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  const onSave = async (e) => {
    e.preventDefault();
    if (!token || !employeeId || !form) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateEmployee(token, employeeId, {
        employeeNumber: form.employeeNumber,
        displayName: form.displayName,
        email: form.email,
        phone: form.phone,
        department: form.department,
        jobTitle: form.jobTitle,
        hireDate: form.hireDate || null,
        hourlyRate: Number(form.hourlyRate),
        payCurrency: 'AUD',
        status: form.status,
      });
      setEmployee(updated);
      setForm(employeeToForm(updated));
      onSaved?.(updated);
      onClose();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const isEdit = mode === 'edit';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/55 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-profile-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sheet-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id="employee-profile-title" className="font-display text-lg font-semibold text-zinc-950">
              {isEdit ? 'Edit employee' : 'Employee details'}
            </h2>
            {employee ? (
              <p className="mt-0.5 truncate text-sm text-zinc-600">{employee.displayName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <div className="mb-4 rounded-xl border border-rose-200/90 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
          ) : null}
          {loading ? (
            <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>
          ) : null}
          {!loading && employee && !isEdit ? (
            <dl>
              <DetailRow label="Employee #" value={<span className="font-mono">{employee.employeeNumber}</span>} />
              <DetailRow label="Display name" value={employee.displayName} />
              <DetailRow label="Email" value={employee.email} />
              <DetailRow label="Phone" value={employee.phone} />
              <DetailRow label="Department" value={employee.department} />
              <DetailRow label="Job title" value={employee.jobTitle} />
              <DetailRow label="Hire date" value={isoToDateInput(employee.hireDate) || '—'} />
              <DetailRow label="Hourly rate" value={formatMoneyPerHour(employee.hourlyRate)} />
              <DetailRow
                label="Status"
                value={
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold capitalize ${
                      employee.status === 'active'
                        ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100'
                        : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200'
                    }`}
                  >
                    {employee.status}
                  </span>
                }
              />
              <DetailRow label="Record created" value={formatDateTime(employee.createdAt)} />
              <DetailRow label="Last updated" value={formatDateTime(employee.updatedAt)} />
            </dl>
          ) : null}
          {!loading && form && isEdit ? (
            <form id="employee-edit-form" onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
              <HrField label="Employee #">
                <HrTextInput
                  value={form.employeeNumber}
                  onChange={(ev) => setForm((f) => ({ ...f, employeeNumber: ev.target.value }))}
                  required
                />
              </HrField>
              <HrField label="Display name">
                <HrTextInput
                  value={form.displayName}
                  onChange={(ev) => setForm((f) => ({ ...f, displayName: ev.target.value }))}
                  required
                />
              </HrField>
              <HrField label="Email">
                <HrTextInput
                  type="email"
                  value={form.email}
                  onChange={(ev) => setForm((f) => ({ ...f, email: ev.target.value }))}
                />
              </HrField>
              <HrField label="Phone">
                <HrTextInput
                  value={form.phone}
                  onChange={(ev) => setForm((f) => ({ ...f, phone: ev.target.value }))}
                />
              </HrField>
              <HrField label="Department">
                <HrTextInput
                  value={form.department}
                  onChange={(ev) => setForm((f) => ({ ...f, department: ev.target.value }))}
                />
              </HrField>
              <HrField label="Job title">
                <HrTextInput
                  value={form.jobTitle}
                  onChange={(ev) => setForm((f) => ({ ...f, jobTitle: ev.target.value }))}
                />
              </HrField>
              <HrField label="Hire date">
                <HrDateInput value={form.hireDate} onChange={(ev) => setForm((f) => ({ ...f, hireDate: ev.target.value }))} />
              </HrField>
              <HrField label="Hourly rate">
                <HrMoneyInput
                  value={form.hourlyRate}
                  onChange={(ev) => setForm((f) => ({ ...f, hourlyRate: ev.target.value }))}
                  required
                />
              </HrField>
              <HrField label="Status" className="sm:col-span-2">
                <HrSelect value={form.status} onChange={(ev) => setForm((f) => ({ ...f, status: ev.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </HrSelect>
              </HrField>
              <p className="sm:col-span-2 text-2xs leading-relaxed text-zinc-500">
                Changing hourly rate only affects new attendance records. Past attendance snapshots and payment amounts are
                not recalculated.
              </p>
            </form>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className={hrSecondaryBtn}>
            {isEdit ? 'Cancel' : 'Close'}
          </button>
          {!isEdit && employee && onSwitchToEdit ? (
            <button type="button" onClick={onSwitchToEdit} className={hrPrimaryBtn}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </button>
          ) : null}
          {isEdit && form ? (
            <button type="submit" form="employee-edit-form" disabled={saving} className={hrPrimaryBtn}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
