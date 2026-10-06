import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Wallet } from 'lucide-react';
import * as api from './api.js';
import { HrDateInput, HrField, HrMoneyInput, HrSelect, HrTextInput } from './hr/HrForm.jsx';
import {
  HrFilterBar,
  HrPageHeader,
  HrSectionTitle,
  hrCardClass,
  hrCardHeaderClass,
  hrPrimaryBtn,
  hrSecondaryBtn,
} from './hr/HrUi.jsx';
import { formatMoney, formatMoneyPerHour } from './hr/money.js';
import { formatPayPeriodEndingLabel, formatWeekLabel, mondayWeekStart, payPeriodRangeEnding } from './hr/payrollUtils.js';
import { useHrLoadError } from './hrPanelUtils.js';
import { alertError, alertSuccess, confirmDelete } from './swal.js';

function localTodayIso() {
  return new Date().toLocaleDateString('en-CA');
}

export function SalariesPanel({ token, onAuthError }) {
  const [employees, setEmployees] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [summary, setSummary] = useState([]);
  const [byWeek, setByWeek] = useState([]);
  const [totals, setTotals] = useState({ hours: 0, earned: 0, paid: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const [filterWeekDate, setFilterWeekDate] = useState(localTodayIso());
  const [filterEmployeeId, setFilterEmployeeId] = useState('');

  const filterRange = useMemo(() => payPeriodRangeEnding(filterWeekDate), [filterWeekDate]);

  const [form, setForm] = useState({
    employeeId: '',
    weekDate: localTodayIso(),
    amount: '',
    payDate: localTodayIso(),
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const employeeName = (id) => employees.find((e) => e.id === id)?.displayName ?? id;
  const employeeRecord = (id) => employees.find((e) => e.id === id);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [empOut, salOut, payrollOut] = await Promise.all([
        api.listEmployees(token, { status: 'active' }),
        api.listSalaries(token, {
          from: filterRange.from,
          to: filterRange.to,
          employeeId: filterEmployeeId || undefined,
        }),
        api.fetchPayrollSummary(token, {
          from: filterRange.from,
          to: filterRange.to,
          employeeId: filterEmployeeId || undefined,
        }),
      ]);
      setEmployees(empOut.employees);
      setSalaries(salOut.salaries);
      setSummary(payrollOut.summary);
      setByWeek(payrollOut.byWeek || []);
      setTotals(payrollOut.totals);
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    } finally {
      setLoading(false);
    }
  }, [token, onAuthError, filterRange, filterEmployeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!token) return;
    if (!form.employeeId) {
      await alertError('Choose an employee before recording a payment.', 'Missing employee');
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      await alertError('Enter an amount greater than zero.', 'Invalid amount');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.createSalary(token, {
        employeeId: form.employeeId,
        weekStart: mondayWeekStart(form.weekDate),
        amount,
        currency: 'AUD',
        payDate: form.payDate || null,
        notes: form.notes,
      });
      setForm((f) => ({ ...f, amount: '', notes: '' }));
      await load();
      await alertSuccess('Payment recorded.', 'Payment saved');
    } catch (err) {
      const msg = useHrLoadError(err, onAuthError);
      setError(msg);
      await alertError(msg, 'Could not save payment');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!token || !(await confirmDelete('This payment record will be removed permanently.', 'Delete payment?'))) return;
    try {
      await api.deleteSalary(token, id);
      await load();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    }
  };

  const summaryByEmployee = useMemo(() => {
    const m = new Map();
    for (const s of summary) m.set(s.employeeId, s);
    return m;
  }, [summary]);

  const paymentRows = useMemo(() => {
    const sorted = [...salaries].sort((a, b) => {
      const da = a.payDate ? a.payDate.slice(0, 10) : '';
      const db = b.payDate ? b.payDate.slice(0, 10) : '';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
    const paidRunning = new Map();
    return sorted.map((row) => {
      const empTotal = summaryByEmployee.get(row.employeeId) || { earned: 0 };
      const running = (paidRunning.get(row.employeeId) || 0) + Number(row.amount || 0);
      paidRunning.set(row.employeeId, running);
      const balancePending = Math.max(0, Math.round((empTotal.earned - running) * 100) / 100);
      return { ...row, periodEarned: empTotal.earned, balancePending };
    }).reverse();
  }, [salaries, summaryByEmployee]);

  const outstandingByEmployee = useMemo(() => {
    const m = new Map();
    for (const w of byWeek) {
      if (w.pending <= 0) continue;
      const list = m.get(w.employeeId) || [];
      list.push(w);
      m.set(w.employeeId, list);
    }
    return m;
  }, [byWeek]);

  const onDownload = async () => {
    if (!token) return;
    setDownloading(true);
    setError('');
    try {
      await api.downloadPayrollStatement(token, {
        from: filterRange.from,
        to: filterRange.to,
        employeeId: filterEmployeeId || undefined,
      });
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <HrPageHeader
        icon={Wallet}
        title="Salaries"
        description="Totals for the selected period (may span more than one Mon–Sun pay week). Match Pay week to the week you are paying."
      />
      {error ? (
        <div className="rounded-xl border border-rose-200/90 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm">{error}</div>
      ) : null}

      <div className={hrCardClass}>
        <HrFilterBar meta={loading ? 'Loading…' : formatPayPeriodEndingLabel(filterWeekDate)}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <HrField label="Period end date" className="lg:col-span-4">
              <HrDateInput value={filterWeekDate} onChange={(ev) => setFilterWeekDate(ev.target.value)} />
            </HrField>
            <HrField label="Employee" className="lg:col-span-4">
              <HrSelect value={filterEmployeeId} onChange={(ev) => setFilterEmployeeId(ev.target.value)}>
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName} ({e.employeeNumber})
                  </option>
                ))}
              </HrSelect>
            </HrField>
            <div className="flex items-end gap-2 lg:col-span-4">
              <button type="button" onClick={onDownload} disabled={downloading} className={hrSecondaryBtn}>
                <Download className="h-3.5 w-3.5" aria-hidden />
                {downloading ? 'Preparing…' : 'Download statement'}
              </button>
            </div>
          </div>
          <p className="text-2xs text-zinc-500">
            Range {filterRange.from} → {filterRange.to}
          </p>
        </HrFilterBar>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200/80 bg-zinc-50/95 text-2xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold sm:px-5">Employee</th>
                <th className="px-4 py-3 font-semibold sm:px-5">Hours</th>
                <th className="px-4 py-3 font-semibold sm:px-5">Rate</th>
                <th className="px-4 py-3 font-semibold sm:px-5">Earned</th>
                <th className="px-4 py-3 font-semibold sm:px-5">Paid</th>
                <th className="px-4 py-3 font-semibold sm:px-5">Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {summary.map((row) => (
                <tr key={row.employeeId} className="hover:bg-zinc-50/80">
                  <td className="px-4 py-3 font-medium text-zinc-900 sm:px-5">{row.displayName}</td>
                  <td className="px-4 py-3 tabular-nums sm:px-5">{row.hours}</td>
                  <td className="px-4 py-3 tabular-nums text-zinc-700 sm:px-5">
                    {formatMoneyPerHour(row.hourlyRate)}
                  </td>
                  <td className="px-4 py-3 tabular-nums sm:px-5">{formatMoney(row.earned)}</td>
                  <td className="px-4 py-3 tabular-nums sm:px-5">{formatMoney(row.paid)}</td>
                  <td className="px-4 py-3 tabular-nums sm:px-5">
                    <span
                      className={
                        row.pending > 0
                          ? 'font-semibold text-amber-800'
                          : 'font-medium text-emerald-800'
                      }
                    >
                      {formatMoney(row.pending)}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && summary.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500 sm:px-5">
                    No payroll activity for this week. Log attendance with check-in and check-out times.
                  </td>
                </tr>
              ) : null}
            </tbody>
            {summary.length > 0 ? (
              <tfoot className="border-t border-zinc-200 bg-zinc-50/90 text-sm font-semibold text-zinc-800">
                <tr>
                  <td className="px-4 py-3 sm:px-5">Totals</td>
                  <td className="px-4 py-3 tabular-nums sm:px-5">{totals.hours}</td>
                  <td className="px-4 py-3 sm:px-5" />
                  <td className="px-4 py-3 tabular-nums sm:px-5">{formatMoney(totals.earned)}</td>
                  <td className="px-4 py-3 tabular-nums sm:px-5">{formatMoney(totals.paid)}</td>
                  <td className="px-4 py-3 tabular-nums sm:px-5">{formatMoney(totals.pending)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <form onSubmit={onSubmit} className={hrCardClass}>
        <div className={hrCardHeaderClass}>
          <HrSectionTitle title="Record payment" subtitle="Partial payments allowed for the selected pay week" />
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-12">
            <HrField label="Employee" className="lg:col-span-4">
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
            <HrField label="Pay week" className="lg:col-span-3">
              <HrDateInput
                value={form.weekDate}
                onChange={(ev) => setForm((f) => ({ ...f, weekDate: ev.target.value }))}
                required
              />
              <p className="mt-1 text-[10px] text-zinc-500">{formatWeekLabel(mondayWeekStart(form.weekDate))}</p>
              {form.employeeId && (outstandingByEmployee.get(form.employeeId) || []).length > 0 ? (
                <p className="mt-1 text-[10px] font-medium text-amber-800">
                  Outstanding:{' '}
                  {(outstandingByEmployee.get(form.employeeId) || [])
                    .map((w) => `${formatWeekLabel(w.weekStart)} ${formatMoney(w.pending)}`)
                    .join(' · ')}
                </p>
              ) : null}
            </HrField>
            <HrField label="Amount paid" className="lg:col-span-3">
              <HrMoneyInput
                value={form.amount}
                onChange={(ev) => setForm((f) => ({ ...f, amount: ev.target.value }))}
                placeholder="0.00"
                required
              />
            </HrField>
            <HrField label="Pay date" className="lg:col-span-2">
              <HrDateInput value={form.payDate} onChange={(ev) => setForm((f) => ({ ...f, payDate: ev.target.value }))} />
            </HrField>
            <HrField label="Notes (optional)" className="lg:col-span-12">
              <HrTextInput
                value={form.notes}
                onChange={(ev) => setForm((f) => ({ ...f, notes: ev.target.value }))}
                placeholder="Optional"
              />
            </HrField>
          </div>
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <button type="submit" disabled={saving || !employees.length} className={hrPrimaryBtn}>
              {saving ? 'Saving…' : 'Add payment'}
            </button>
            {form.employeeId && Number(employeeRecord(form.employeeId)?.hourlyRate || 0) === 0 ? (
              <p className="mt-2 text-2xs text-amber-700">This employee has no hourly rate set — earned amount will be zero.</p>
            ) : null}
          </div>
        </div>
      </form>

      <div className={`${hrCardClass} overflow-x-auto`}>
        <div className={hrCardHeaderClass}>
          <HrSectionTitle title="Payment history" subtitle="Each payment applies to one pay week (Monday start)" />
        </div>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200/80 bg-zinc-50/95 text-2xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-semibold sm:px-5">Employee</th>
              <th className="px-4 py-3 font-semibold sm:px-5">Pay week</th>
              <th className="px-4 py-3 font-semibold sm:px-5">Period earned</th>
              <th className="px-4 py-3 font-semibold sm:px-5">Paid</th>
              <th className="px-4 py-3 font-semibold sm:px-5">Balance</th>
              <th className="px-4 py-3 font-semibold sm:px-5">Pay date</th>
              <th className="px-4 py-3 text-right font-semibold sm:px-5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {paymentRows.map((row) => (
              <tr key={row.id} className="hover:bg-zinc-50/80">
                <td className="px-4 py-3 font-medium text-zinc-900 sm:px-5">{employeeName(row.employeeId)}</td>
                <td className="px-4 py-3 text-xs text-zinc-700 sm:px-5">
                  {row.weekStart
                    ? formatWeekLabel(String(row.weekStart).slice(0, 10))
                    : row.periodYear
                      ? `${row.periodYear}-${String(row.periodMonth).padStart(2, '0')}`
                      : '—'}
                </td>
                <td className="px-4 py-3 tabular-nums text-zinc-600 sm:px-5">{formatMoney(row.periodEarned)}</td>
                <td className="px-4 py-3 tabular-nums text-zinc-800 sm:px-5">{formatMoney(row.amount)}</td>
                <td className="px-4 py-3 tabular-nums sm:px-5">
                  <span
                    className={
                      row.balancePending > 0 ? 'font-semibold text-amber-800' : 'font-medium text-emerald-800'
                    }
                  >
                    {formatMoney(row.balancePending)}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-600 sm:px-5">
                  {row.payDate ? row.payDate.slice(0, 10) : '—'}
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
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-500 sm:px-5">No payments in this period.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
