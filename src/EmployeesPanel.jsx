import { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import * as api from './api.js';
import { HrDateInput, HrField, HrTextInput } from './hr/HrForm.jsx';
import { HrPageHeader, HrSearchField, HrSectionTitle, hrCardClass, hrCardHeaderClass, hrPrimaryBtn } from './hr/HrUi.jsx';
import { useHrLoadError } from './hrPanelUtils.js';

const emptyForm = {
  employeeNumber: '',
  displayName: '',
  email: '',
  phone: '',
  department: '',
  jobTitle: '',
  hireDate: '',
  status: 'active',
};

export function EmployeesPanel({ token, onAuthError }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const out = await api.listEmployees(token, { q: search.trim() || undefined });
      setEmployees(out.employees);
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    } finally {
      setLoading(false);
    }
  }, [token, search, onAuthError]);

  useEffect(() => {
    const t = window.setTimeout(load, search ? 280 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError('');
    try {
      await api.createEmployee(token, {
        ...form,
        hireDate: form.hireDate || null,
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
    if (!token || !window.confirm('Mark this employee as inactive?')) return;
    try {
      await api.deactivateEmployee(token, id);
      await load();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <HrPageHeader
        icon={Users}
        title="Employees"
        description="Manage workforce records for attendance and payroll."
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
          </div>
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <button type="submit" disabled={saving} className={hrPrimaryBtn}>
              {saving ? 'Saving…' : 'Create employee'}
            </button>
          </div>
        </div>
      </form>
      <div className={hrCardClass}>
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100/90 bg-zinc-50/40 px-4 py-3 sm:px-5">
          <div className="min-w-[14rem] max-w-md flex-1">
            <HrSearchField
              value={search}
              onChange={(ev) => setSearch(ev.target.value)}
              placeholder="Search name, #, email…"
            />
          </div>
          <span className="text-2xs font-medium text-zinc-500">{loading ? 'Loading…' : `${employees.length} record(s)`}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-100 bg-zinc-50/80 text-2xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 sm:px-5">#</th>
                <th className="px-4 py-2.5 sm:px-5">Name</th>
                <th className="px-4 py-2.5 sm:px-5">Department</th>
                <th className="px-4 py-2.5 sm:px-5">Status</th>
                <th className="px-4 py-2.5 sm:px-5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-zinc-50/80">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-700 sm:px-5">{emp.employeeNumber}</td>
                  <td className="px-4 py-3 font-medium text-zinc-900 sm:px-5">{emp.displayName}</td>
                  <td className="px-4 py-3 text-zinc-600 sm:px-5">{emp.department || '—'}</td>
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
                    {emp.status === 'active' ? (
                      <button type="button" onClick={() => deactivate(emp.id)} className="text-2xs font-semibold text-rose-600 hover:text-rose-700">
                        Deactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!loading && employees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-500 sm:px-5">No employees yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
