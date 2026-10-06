import { useCallback, useEffect, useState } from 'react';
import { Eye, Pencil, UserX, Users } from 'lucide-react';
import * as api from './api.js';
import { EmployeeProfileModal } from './hr/EmployeeProfileModal.jsx';
import { HrDateInput, HrField, HrMoneyInput, HrSelect, HrTextInput } from './hr/HrForm.jsx';
import { labelClass } from './hrPanelUtils.js';
import { formatMoneyPerHour } from './hr/money.js';
import {
  HrPageHeader,
  HrSearchField,
  HrSectionTitle,
  hrCardClass,
  hrCardHeaderClass,
  hrPrimaryBtn,
} from './hr/HrUi.jsx';
import { useHrLoadError } from './hrPanelUtils.js';
import { confirmDialog } from './swal.js';

const actionBtn =
  'inline-flex h-8 items-center justify-center gap-1 rounded-lg border px-2.5 text-2xs font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60';

const emptyForm = {
  employeeNumber: '',
  displayName: '',
  email: '',
  phone: '',
  department: '',
  jobTitle: '',
  hireDate: '',
  hourlyRate: '',
  status: 'active',
};

export function EmployeesPanel({ token, onAuthError }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMode, setProfileMode] = useState('view');
  const [profileEmployeeId, setProfileEmployeeId] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const out = await api.listEmployees(token, {
        q: search.trim() || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setEmployees(out.employees);
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    } finally {
      setLoading(false);
    }
  }, [token, search, statusFilter, onAuthError]);

  useEffect(() => {
    const t = window.setTimeout(load, search ? 280 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  const openView = (id) => {
    setProfileEmployeeId(id);
    setProfileMode('view');
    setProfileOpen(true);
  };

  const openEdit = (id) => {
    setProfileEmployeeId(id);
    setProfileMode('edit');
    setProfileOpen(true);
  };

  const closeProfile = () => {
    setProfileOpen(false);
    setProfileEmployeeId(null);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      await api.createEmployee(token, {
        ...form,
        hireDate: form.hireDate || null,
        hourlyRate: Number(form.hourlyRate),
        payCurrency: 'AUD',
      });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (id) => {
    if (!token || !(await confirmDialog('They will no longer appear in active employee lists.', 'Deactivate employee?'))) return;
    try {
      await api.deactivateEmployee(token, id);
      await load();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    }
  };

  return (
    <div className="space-y-4">
      <HrPageHeader
        icon={Users}
        title="Employees"
        description="Manage workforce records for attendance and payroll. Changing hourly rate only affects new attendance; past days and payments stay the same."
      />
      {error ? (
        <div className="rounded-xl border border-rose-200/90 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm">{error}</div>
      ) : null}
      <form onSubmit={onSubmit} className={hrCardClass}>
        <div className={hrCardHeaderClass}>
          <HrSectionTitle title="Add employee" subtitle="New hire or contractor profile" />
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <HrField label="Employee #">
              <HrTextInput
                value={form.employeeNumber}
                onChange={(ev) => setForm((f) => ({ ...f, employeeNumber: ev.target.value }))}
                placeholder="e.g. 001"
                required
                autoComplete="off"
              />
            </HrField>
            <HrField label="Display name">
              <HrTextInput
                value={form.displayName}
                onChange={(ev) => setForm((f) => ({ ...f, displayName: ev.target.value }))}
                placeholder="Full name"
                required
                autoComplete="name"
              />
            </HrField>
            <HrField label="Email">
              <HrTextInput
                type="email"
                value={form.email}
                onChange={(ev) => setForm((f) => ({ ...f, email: ev.target.value }))}
                placeholder="name@company.com"
                autoComplete="email"
              />
            </HrField>
            <HrField label="Department">
              <HrTextInput
                value={form.department}
                onChange={(ev) => setForm((f) => ({ ...f, department: ev.target.value }))}
                placeholder="e.g. Development"
              />
            </HrField>
            <HrField label="Job title">
              <HrTextInput
                value={form.jobTitle}
                onChange={(ev) => setForm((f) => ({ ...f, jobTitle: ev.target.value }))}
                placeholder="e.g. Technician"
              />
            </HrField>
            <HrField label="Hire date">
              <HrDateInput value={form.hireDate} onChange={(ev) => setForm((f) => ({ ...f, hireDate: ev.target.value }))} />
            </HrField>
            <HrField label="Hourly rate">
              <HrMoneyInput
                value={form.hourlyRate}
                onChange={(ev) => setForm((f) => ({ ...f, hourlyRate: ev.target.value }))}
                placeholder="0.00"
                required
              />
            </HrField>
          </div>
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <button type="submit" disabled={saving} className={hrPrimaryBtn}>
              {saving ? 'Saving…' : 'Create employee'}
            </button>
          </div>
        </div>
      </form>
      <div className={hrCardClass}>
        <div className="flex flex-wrap items-end gap-3 border-b border-zinc-100/90 bg-zinc-50/40 px-4 py-3 sm:px-5">
          <div className="min-w-[14rem] max-w-md flex-1">
            <HrSearchField
              value={search}
              onChange={(ev) => setSearch(ev.target.value)}
              placeholder="Search name, #, email…"
            />
          </div>
          <div className="w-full min-w-[10rem] sm:w-auto">
            <span className={labelClass}>Status</span>
            <div className="mt-1.5">
              <HrSelect
                value={statusFilter}
                onChange={(ev) => setStatusFilter(ev.target.value)}
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </HrSelect>
            </div>
          </div>
          <span className="pb-2 text-2xs font-medium text-zinc-500 sm:pb-2.5">
            {loading ? 'Loading…' : `${employees.length} record(s)`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50/80 text-2xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 sm:px-5">#</th>
                <th className="px-4 py-2.5 sm:px-5">Name</th>
                <th className="px-4 py-2.5 sm:px-5">Department</th>
                <th className="px-4 py-2.5 sm:px-5">Job title</th>
                <th className="px-4 py-2.5 sm:px-5">Rate</th>
                <th className="px-4 py-2.5 sm:px-5">Status</th>
                <th className="px-4 py-2.5 text-right sm:px-5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-zinc-50/80">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-700 sm:px-5">{emp.employeeNumber}</td>
                  <td className="px-4 py-3 font-medium text-zinc-900 sm:px-5">{emp.displayName}</td>
                  <td className="px-4 py-3 text-zinc-600 sm:px-5">{emp.department || '—'}</td>
                  <td className="px-4 py-3 text-zinc-600 sm:px-5">{emp.jobTitle || '—'}</td>
                  <td className="px-4 py-3 tabular-nums text-zinc-700 sm:px-5">{formatMoneyPerHour(emp.hourlyRate)}</td>
                  <td className="px-4 py-3 sm:px-5">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold capitalize ${
                        emp.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100'
                          : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200'
                      }`}
                    >
                      {emp.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right sm:px-5">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openView(emp.id)}
                        className={`${actionBtn} border-zinc-200/90 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50`}
                      >
                        <Eye className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(emp.id)}
                        className={`${actionBtn} border-indigo-200/90 bg-indigo-50 text-indigo-900 hover:bg-indigo-100`}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                        Edit
                      </button>
                      {emp.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => deactivate(emp.id)}
                          className={`${actionBtn} border-rose-200/90 bg-rose-50 text-rose-800 hover:bg-rose-100`}
                        >
                          <UserX className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          Deactivate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && employees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-500 sm:px-5">No employees yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <EmployeeProfileModal
        open={profileOpen}
        mode={profileMode}
        employeeId={profileEmployeeId}
        token={token}
        onClose={closeProfile}
        onSaved={() => void load()}
        onAuthError={onAuthError}
        onSwitchToEdit={() => setProfileMode('edit')}
      />
    </div>
  );
}
