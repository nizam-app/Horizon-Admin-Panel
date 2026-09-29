import { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import * as api from './api.js';
import { HrDateInput, HrField, HrMoneyInput, HrMonthSelect, HrSelect, HrTextInput } from './hr/HrForm.jsx';
import { HrPageHeader, HrSectionTitle, hrCardClass, hrCardHeaderClass, hrPrimaryBtn } from './hr/HrUi.jsx';
import { useHrLoadError } from './hrPanelUtils.js';

const currentYear = new Date().getFullYear();

export function SalariesPanel({ token, onAuthError }) {
  const [employees, setEmployees] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    employeeId: '',
    periodYear: currentYear,
    periodMonth: new Date().getMonth() + 1,
    amount: '',
    currency: 'NZD',
    payDate: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const employeeName = (id) => employees.find((e) => e.id === id)?.displayName ?? id;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [empOut, salOut] = await Promise.all([
        api.listEmployees(token, { status: 'active' }),
        api.listSalaries(token),
      ]);
      setEmployees(empOut.employees);
      setSalaries(salOut.salaries);
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    } finally {
      setLoading(false);
    }
  }, [token, onAuthError]);

  useEffect(() => {
    load();
  }, [load]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!token || !form.employeeId) return;
    setSaving(true);
    setError('');
    try {
      await api.createSalary(token, {
        employeeId: form.employeeId,
        periodYear: Number(form.periodYear),
        periodMonth: Number(form.periodMonth),
        amount: Number(form.amount),
        currency: form.currency,
        payDate: form.payDate || null,
        notes: form.notes,
      });
      setForm((f) => ({ ...f, amount: '', notes: '', payDate: '' }));
      await load();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!token || !window.confirm('Delete this salary record?')) return;
    try {
      await api.deleteSalary(token, id);
      await load();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    }
  };

  const yearOptions = [];
  for (let y = currentYear + 1; y >= currentYear - 5; y -= 1) yearOptions.push(y);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <HrPageHeader icon={Wallet} title="Salaries" description="Record monthly pay per employee." />
      {error ? (
        <div className="rounded-xl border border-rose-200/90 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm">{error}</div>
      ) : null}
      <form onSubmit={onSubmit} className={hrCardClass}>
        <div className={hrCardHeaderClass}>
          <HrSectionTitle title="Add salary record" subtitle="One row per employee per month" />
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-12">
            <HrField label="Employee" className="lg:col-span-6">
              <HrSelect
                value={form.employeeId}
                onChange={(ev) => setForm((f) => ({ ...f, employeeId: ev.target.value }))}
                required
              >
                <option value="">Select employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName} ({e.employeeNumber})
                  </option>
                ))}
              </HrSelect>
            </HrField>
            <HrField label="Year" className="lg:col-span-3">
              <HrSelect
                value={form.periodYear}
                onChange={(ev) => setForm((f) => ({ ...f, periodYear: ev.target.value }))}
                required
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </HrSelect>
            </HrField>
            <HrField label="Month" className="lg:col-span-3">
              <HrMonthSelect
                value={form.periodMonth}
                onChange={(ev) => setForm((f) => ({ ...f, periodMonth: Number(ev.target.value) }))}
              />
            </HrField>
            <HrField label="Amount" className="lg:col-span-4">
              <HrMoneyInput
                value={form.amount}
                onChange={(ev) => setForm((f) => ({ ...f, amount: ev.target.value }))}
                placeholder="0.00"
                required
              />
            </HrField>
            <HrField label="Pay date" className="lg:col-span-4">
              <HrDateInput value={form.payDate} onChange={(ev) => setForm((f) => ({ ...f, payDate: ev.target.value }))} />
            </HrField>
            <HrField label="Notes (optional)" className="lg:col-span-4">
              <HrTextInput
                value={form.notes}
                onChange={(ev) => setForm((f) => ({ ...f, notes: ev.target.value }))}
                placeholder="Optional"
              />
            </HrField>
          </div>
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <button type="submit" disabled={saving || !employees.length} className={hrPrimaryBtn}>
              {saving ? 'Saving…' : 'Add salary'}
            </button>
            {!employees.length && !loading ? (
              <p className="mt-2 text-2xs text-zinc-500">Add an active employee before recording salary.</p>
            ) : null}
          </div>
        </div>
      </form>
      <div className={`${hrCardClass} overflow-x-auto`}>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200/80 bg-zinc-50/95 text-2xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-semibold sm:px-5">Employee</th>
              <th className="px-4 py-3 font-semibold sm:px-5">Period</th>
              <th className="px-4 py-3 font-semibold sm:px-5">Amount</th>
              <th className="px-4 py-3 text-right font-semibold sm:px-5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {salaries.map((row) => (
              <tr key={row.id} className="hover:bg-zinc-50/80">
                <td className="px-4 py-3 font-medium text-zinc-900 sm:px-5">{employeeName(row.employeeId)}</td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-700 sm:px-5">
                  {row.periodYear}-{String(row.periodMonth).padStart(2, '0')}
                </td>
                <td className="px-4 py-3 text-zinc-800 sm:px-5">
                  <span className="font-semibold tabular-nums">{row.currency}</span>{' '}
                  {Number(row.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right sm:px-5">
                  <button type="button" onClick={() => remove(row.id)} className="text-2xs font-semibold text-rose-600 hover:text-rose-700">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!loading && salaries.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-zinc-500 sm:px-5">No salary records yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
