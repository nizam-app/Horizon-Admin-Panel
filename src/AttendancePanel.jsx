import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Download, Pencil, Trash2, UserRound } from 'lucide-react';
import * as api from './api.js';
import { inputClass, labelClass, useHrLoadError } from './hrPanelUtils.js';
import { PickerInput } from './PickerInput.jsx';
import {
  employeeInitials,
  HrFilterBar,
  HrFilterChip,
  HrPageHeader,
  HrSearchField,
  HrSectionTitle,
  hrCardClass,
  hrCardHeaderClass,
  hrPrimaryBtn,
  hrSecondaryBtn,
} from './hr/HrUi.jsx';
import { attendanceTimeRangeError, hoursFromAttendanceRow } from './hr/payrollUtils.js';
import { alertError, confirmDelete } from './swal.js';

const ATTENDANCE_PAGE_SIZE = 10;

const STATUS_OPTIONS = ['present', 'absent', 'leave', 'half-day'];

const STATUS_STYLES = {
  present: 'border-emerald-200/90 bg-emerald-50 text-emerald-900 ring-emerald-100',
  absent: 'border-rose-200/90 bg-rose-50 text-rose-900 ring-rose-100',
  leave: 'border-violet-200/90 bg-violet-50 text-violet-900 ring-violet-100',
  'half-day': 'border-amber-200/90 bg-amber-50 text-amber-950 ring-amber-100',
};

function statusLabel(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'half-day') return 'Half day';
  if (!key) return '—';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function statusBadgeClass(status) {
  const key = String(status || '').toLowerCase();
  return STATUS_STYLES[key] || 'border-zinc-200 bg-zinc-50 text-zinc-700 ring-zinc-100';
}

function AttendanceStatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-semibold tracking-wide ring-1 ring-inset ${statusBadgeClass(status)}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function localTodayIso() {
  return new Date().toLocaleDateString('en-CA');
}

function toTimeInputValue(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function formatTimesDisplay(checkIn, checkOut) {
  const a = toTimeInputValue(checkIn);
  const b = toTimeInputValue(checkOut);
  if (!a && !b) return '—';
  if (a && b) return `${a} – ${b}`;
  return a ? `${a} · checkout pending` : b;
}

function isEditableAttendanceDate(dateStr) {
  return dateStr === localTodayIso();
}

function filterMetaLine(listFilter, loading, count) {
  const parts = [];
  parts.push(loading ? 'Loading records…' : `${count} record${count === 1 ? '' : 's'}`);
  if (listFilter.name) parts.push(`name “${listFilter.name}”`);
  if (!listFilter.from && !listFilter.to) {
    parts.push('all dates');
  } else if (listFilter.from || listFilter.to) {
    const range =
      listFilter.from && listFilter.to && listFilter.from === listFilter.to
        ? listFilter.from
        : [listFilter.from || '…', listFilter.to || '…'].join(' → ');
    parts.push(range);
  }
  return parts.join(' · ');
}

function AttendancePaginationBar({ page, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / ATTENDANCE_PAGE_SIZE));
  if (total <= ATTENDANCE_PAGE_SIZE) return null;
  const from = (page - 1) * ATTENDANCE_PAGE_SIZE + 1;
  const to = Math.min(page * ATTENDANCE_PAGE_SIZE, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 bg-zinc-50/40 px-4 py-3 text-2xs text-zinc-600 sm:px-5">
      <span>
        Showing <span className="font-medium text-zinc-800">{from}–{to}</span> of{' '}
        <span className="font-medium text-zinc-800">{total}</span>
        <span className="mx-2 text-zinc-300">·</span>
        Page <span className="font-medium text-zinc-800">{page}</span> of {totalPages}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={hrSecondaryBtn}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className={hrSecondaryBtn}
          aria-label="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  );
}

async function resolveExistingRecord(token, employeeId, date, rows) {
  const hit = rows.find((r) => r.employeeId === employeeId && r.date === date);
  if (hit) return hit;
  if (!token || !employeeId || !date) return null;
  const { attendance } = await api.listAttendance(token, { from: date, to: date, employeeId });
  return attendance[0] || null;
}

export function AttendancePanel({ token, onAuthError }) {
  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    employeeId: '',
    date: localTodayIso(),
    status: 'present',
    checkIn: '',
    checkOut: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [rowDrafts, setRowDrafts] = useState({});
  const [rowSaving, setRowSaving] = useState({});
  const [listFilter, setListFilter] = useState({
    from: '',
    to: '',
    employeeId: '',
    name: '',
  });
  const [nameDraft, setNameDraft] = useState('');
  const nameDebounceRef = useRef(null);
  const [formExistingId, setFormExistingId] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [listPage, setListPage] = useState(1);
  const formSectionRef = useRef(null);

  const employeeName = (id) => employees.find((e) => e.id === id)?.displayName ?? id;

  const paginatedRows = useMemo(() => {
    const start = (listPage - 1) * ATTENDANCE_PAGE_SIZE;
    return rows.slice(start, start + ATTENDANCE_PAGE_SIZE);
  }, [rows, listPage]);

  useEffect(() => {
    setListPage(1);
  }, [listFilter.from, listFilter.to, listFilter.employeeId, listFilter.name]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(rows.length / ATTENDANCE_PAGE_SIZE));
    if (listPage > totalPages) setListPage(totalPages);
  }, [rows.length, listPage]);

  const syncRowDrafts = useCallback((attendance) => {
    const next = {};
    for (const row of attendance) {
      if (!isEditableAttendanceDate(row.date)) continue;
      next[row.id] = {
        checkIn: toTimeInputValue(row.checkIn),
        checkOut: toTimeInputValue(row.checkOut),
        status: row.status,
      };
    }
    setRowDrafts(next);
  }, []);

  const loadEmployees = useCallback(async () => {
    if (!token) return;
    try {
      const empOut = await api.listEmployees(token, { status: 'active' });
      setEmployees(empOut.employees);
    } catch (e) {
      setError(useHrLoadError(e, onAuthError));
    }
  }, [token, onAuthError]);

  const loadRows = useCallback(
    async (filterOverride) => {
      if (!token) return;
      const f = filterOverride ?? listFilter;
      setLoading(true);
      setError('');
      try {
        const attOut = await api.listAttendance(token, {
          from: f.from || undefined,
          to: f.to || undefined,
          employeeId: f.employeeId || undefined,
          q: f.name || undefined,
        });
        setRows(attOut.attendance);
        syncRowDrafts(attOut.attendance);
      } catch (e) {
        setError(useHrLoadError(e, onAuthError));
      } finally {
        setLoading(false);
      }
    },
    [token, onAuthError, listFilter, syncRowDrafts]
  );

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    window.clearTimeout(nameDebounceRef.current);
    nameDebounceRef.current = window.setTimeout(() => {
      setListFilter((f) => (f.name === nameDraft ? f : { ...f, name: nameDraft }));
    }, 320);
    return () => window.clearTimeout(nameDebounceRef.current);
  }, [nameDraft]);

  useEffect(() => {
    if (!token || !form.employeeId || !form.date) {
      setFormExistingId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const rec = await resolveExistingRecord(token, form.employeeId, form.date, rows);
      if (!cancelled) setFormExistingId(rec?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, form.employeeId, form.date, rows]);

  const loadIntoForm = (row) => {
    setForm({
      employeeId: row.employeeId,
      date: row.date,
      status: row.status,
      checkIn: toTimeInputValue(row.checkIn),
      checkOut: toTimeInputValue(row.checkOut),
      notes: '',
    });
    window.requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const loadFormForEmployeeDate = useCallback(
    async (employeeId, date) => {
      if (!employeeId) {
        setForm((f) => ({ ...f, employeeId: '', date, checkIn: '', checkOut: '' }));
        return;
      }
      const rec = token ? await resolveExistingRecord(token, employeeId, date, rows) : null;
      if (rec) loadIntoForm(rec);
      else setForm((f) => ({ ...f, employeeId, date, checkIn: '', checkOut: '' }));
    },
    [token, rows]
  );

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!token || !form.employeeId) return;
    setError('');
    const payload = {
      employeeId: form.employeeId,
      date: form.date,
      status: form.status,
      checkIn: form.checkIn || '',
      checkOut: form.checkOut || '',
      notes: form.notes || '',
    };
    const timeErr = attendanceTimeRangeError(payload);
    if (timeErr) {
      await alertError(timeErr, 'Invalid times');
      return;
    }
    setSaving(true);
    try {
      const existing = await resolveExistingRecord(token, form.employeeId, form.date, rows);
      if (existing) {
        await api.updateAttendance(token, existing.id, payload);
      } else {
        try {
          await api.createAttendance(token, payload);
        } catch (err) {
          if (String(err?.message || '').includes('already recorded')) {
            const again = await resolveExistingRecord(token, form.employeeId, form.date, []);
            if (again) await api.updateAttendance(token, again.id, payload);
            else throw err;
          } else throw err;
        }
      }
      const savedDate = form.date;
      const nextFilter = {
        ...listFilter,
        from: savedDate,
        to: savedDate,
        name: '',
      };
      setListFilter(nextFilter);
      setNameDraft('');
      await loadRows(nextFilter);
      setForm({
        employeeId: '',
        date: localTodayIso(),
        status: 'present',
        checkIn: '',
        checkOut: '',
        notes: '',
      });
      setFormExistingId(null);
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    } finally {
      setSaving(false);
    }
  };

  const saveRowTimes = async (row) => {
    if (!token) return;
    const draft = rowDrafts[row.id];
    if (!draft) return;
    setError('');
    const patch = {
      checkIn: draft.checkIn || '',
      checkOut: draft.checkOut || '',
      status: draft.status,
    };
    const timeErr = attendanceTimeRangeError(patch);
    if (timeErr) {
      await alertError(timeErr, 'Invalid times');
      return;
    }
    setRowSaving((s) => ({ ...s, [row.id]: true }));
    try {
      await api.updateAttendance(token, row.id, patch);
      await loadRows();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    } finally {
      setRowSaving((s) => ({ ...s, [row.id]: false }));
    }
  };

  const remove = async (id) => {
    if (!token || !(await confirmDelete('This attendance entry will be removed permanently.', 'Delete attendance?'))) return;
    try {
      await api.deleteAttendance(token, id);
      await loadRows();
    } catch (err) {
      setError(useHrLoadError(err, onAuthError));
    }
  };

  const isTodayFilter =
    listFilter.from === localTodayIso() && listFilter.to === localTodayIso();
  const isAllDatesFilter = !listFilter.from && !listFilter.to;

  const downloadStatement = async () => {
    if (!token) return;
    const from = listFilter.from;
    const to = listFilter.to;
    if (!from || !to) {
      setError('Set both From and To dates before downloading a statement.');
      return;
    }
    setDownloading(true);
    setError('');
    try {
      await api.downloadAttendanceStatement(token, {
        from,
        to,
        employeeId: listFilter.employeeId || undefined,
        q: listFilter.name || undefined,
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
        icon={CalendarClock}
        title="Attendance"
        description="Log or fix any day: use Edit on a row (opens the form above), correct times in 24-hour format, then Update attendance."
      />

      {error ? (
        <div className="rounded-xl border border-rose-200/90 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-sm">{error}</div>
      ) : null}

      <form ref={formSectionRef} onSubmit={onSubmit} className={hrCardClass}>
        <div className={hrCardHeaderClass}>
          <HrSectionTitle title="Log attendance" subtitle="Create or update a single day record" />
          {formExistingId ? (
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-2xs font-semibold text-indigo-800">
              Editing existing
            </span>
          ) : null}
        </div>
        <div className="space-y-5 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <label className={labelClass}>Employee</label>
              <select
                className={`mt-1.5 ${inputClass} h-10`}
                value={form.employeeId}
                onChange={(ev) => {
                  void loadFormForEmployeeDate(ev.target.value, form.date);
                }}
                required
              >
                <option value="">Select employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.displayName}</option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-3">
              <label className={labelClass}>Date</label>
              <PickerInput
                type="date"
                className="mt-1.5 h-10"
                value={form.date}
                onChange={(ev) => {
                  void loadFormForEmployeeDate(form.employeeId, ev.target.value);
                }}
                required
              />
            </div>
            <div className="lg:col-span-4">
              <label className={labelClass}>Status</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((s) => {
                  const active = form.status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, status: s }))}
                      className={`rounded-full border px-3 py-1.5 text-2xs font-semibold transition ${
                        active
                          ? `${statusBadgeClass(s)} ring-1 ring-inset`
                          : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                      }`}
                    >
                      {statusLabel(s)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="lg:col-span-3">
              <label className={labelClass}>Check in</label>
              <PickerInput
                type="time"
                className="mt-1.5 h-10"
                value={form.checkIn}
                onChange={(ev) => setForm((f) => ({ ...f, checkIn: ev.target.value }))}
              />
            </div>
            <div className="lg:col-span-3">
              <label className={labelClass}>Check out</label>
              <PickerInput
                type="time"
                className="mt-1.5 h-10"
                value={form.checkOut}
                onChange={(ev) => setForm((f) => ({ ...f, checkOut: ev.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
            <button type="submit" disabled={saving || !employees.length} className={hrPrimaryBtn}>
              {saving ? 'Saving…' : formExistingId ? 'Update attendance' : 'Save attendance'}
            </button>
          </div>
        </div>
      </form>

      <div className={hrCardClass}>
        <HrFilterBar meta={filterMetaLine(listFilter, loading, rows.length)}>
          <div className="grid gap-3 lg:grid-cols-12">
            <div className="lg:col-span-2">
              <label className={labelClass}>From</label>
              <PickerInput
                type="date"
                className="mt-1.5 h-10"
                value={listFilter.from}
                onChange={(ev) => setListFilter((f) => ({ ...f, from: ev.target.value }))}
              />
            </div>
            <div className="lg:col-span-2">
              <label className={labelClass}>To</label>
              <PickerInput
                type="date"
                className="mt-1.5 h-10"
                value={listFilter.to}
                onChange={(ev) => setListFilter((f) => ({ ...f, to: ev.target.value }))}
              />
            </div>
            <div className="lg:col-span-3">
              <label className={labelClass}>Search by name</label>
              <div className="mt-1.5">
                <HrSearchField
                  value={nameDraft}
                  onChange={(ev) => setNameDraft(ev.target.value)}
                  placeholder="Employee name…"
                />
              </div>
            </div>
            <div className="lg:col-span-3">
              <label className={labelClass}>Employee</label>
              <select
                className={`mt-1.5 ${inputClass} h-10`}
                value={listFilter.employeeId}
                onChange={(ev) => setListFilter((f) => ({ ...f, employeeId: ev.target.value }))}
              >
                <option value="">All employees</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.displayName}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-end gap-2 lg:col-span-2">
              <HrFilterChip
                active={isTodayFilter}
                onClick={() => {
                  const t = localTodayIso();
                  setListFilter((f) => ({ ...f, from: t, to: t }));
                }}
              >
                Today
              </HrFilterChip>
              <HrFilterChip
                active={false}
                onClick={() => {
                  const end = new Date();
                  const start = new Date();
                  start.setDate(start.getDate() - 6);
                  setListFilter((f) => ({
                    ...f,
                    from: start.toLocaleDateString('en-CA'),
                    to: end.toLocaleDateString('en-CA'),
                  }));
                }}
              >
                7 days
              </HrFilterChip>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <HrFilterChip
              active={isAllDatesFilter}
              onClick={() => setListFilter((f) => ({ ...f, from: '', to: '' }))}
            >
              All dates
            </HrFilterChip>
            <button
              type="button"
              onClick={() => {
                setNameDraft('');
                setListFilter((f) => ({ ...f, name: '', employeeId: '' }));
              }}
              className={hrSecondaryBtn}
            >
              Clear filters
            </button>
            <button type="button" onClick={() => void downloadStatement()} disabled={downloading} className={hrSecondaryBtn}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              {downloading ? 'Preparing…' : 'Download statement'}
            </button>
          </div>
        </HrFilterBar>

        <div className="relative overflow-x-auto">
          {loading ? (
            <div className="absolute inset-0 z-[1] flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
              <span className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-2xs font-semibold text-zinc-600 shadow-sm">
                Loading…
              </span>
            </div>
          ) : null}
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-[2] border-b border-zinc-200/80 bg-zinc-50/95 text-2xs uppercase tracking-wider text-zinc-500 backdrop-blur-sm">
              <tr>
                <th className="px-4 py-3 font-semibold sm:px-5">Date</th>
                <th className="px-4 py-3 font-semibold sm:px-5">Employee</th>
                <th className="px-4 py-3 font-semibold sm:px-5">Status</th>
                <th className="px-4 py-3 font-semibold sm:px-5">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    Times
                  </span>
                </th>
                <th className="px-4 py-3 font-semibold sm:px-5">Hours</th>
                <th className="px-4 py-3 text-right font-semibold sm:px-5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {paginatedRows.map((row) => {
                const editable = isEditableAttendanceDate(row.date);
                const draft = rowDrafts[row.id];
                const name = employeeName(row.employeeId);
                return (
                  <tr key={row.id} className="group transition hover:bg-zinc-50/80">
                    <td className="px-4 py-3.5 sm:px-5">
                      <p className="font-mono text-xs font-medium text-zinc-800">{row.date}</p>
                      {editable ? (
                        <span className="mt-1 inline-flex rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">
                          Today
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 sm:px-5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-2xs font-bold text-zinc-600 ring-1 ring-zinc-200/80"
                          aria-hidden
                        >
                          {employeeInitials(name)}
                        </span>
                        <span className="font-medium text-zinc-900">{name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 sm:px-5">
                      <AttendanceStatusBadge status={draft?.status ?? row.status} />
                    </td>
                    <td className="px-4 py-3.5 sm:px-5">
                      {editable && draft ? (
                        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                          <div className="w-[7.25rem] shrink-0">
                            <PickerInput
                              type="time"
                              className="h-9"
                              value={draft.checkIn}
                              onChange={(ev) =>
                                setRowDrafts((d) => ({
                                  ...d,
                                  [row.id]: { ...d[row.id], checkIn: ev.target.value },
                                }))
                              }
                              aria-label="Check in"
                            />
                          </div>
                          <span className="hidden text-zinc-300 sm:inline">→</span>
                          <div className="w-[7.25rem] shrink-0">
                            <PickerInput
                              type="time"
                              className="h-9"
                              value={draft.checkOut}
                              onChange={(ev) =>
                                setRowDrafts((d) => ({
                                  ...d,
                                  [row.id]: { ...d[row.id], checkOut: ev.target.value },
                                }))
                              }
                              aria-label="Check out"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={rowSaving[row.id]}
                            onClick={() => saveRowTimes(row)}
                            className={hrSecondaryBtn}
                          >
                            {rowSaving[row.id] ? 'Saving…' : 'Save times'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-2xs font-medium text-zinc-600">{formatTimesDisplay(row.checkIn, row.checkOut)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-zinc-700 sm:px-5">
                      {hoursFromAttendanceRow(row)}
                    </td>
                    <td className="px-4 py-3.5 text-right sm:px-5">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5 opacity-90 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => loadIntoForm(row)}
                          className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-indigo-200/90 bg-indigo-50 px-2.5 text-2xs font-semibold text-indigo-900 shadow-sm transition hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
                          title="Edit in form above"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row.id)}
                          className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-rose-200/90 bg-rose-50 px-2.5 text-2xs font-semibold text-rose-800 shadow-sm transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center sm:px-5">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
                        <UserRound className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                      </span>
                      <p className="text-sm font-semibold text-zinc-800">No attendance records</p>
                      <p className="text-2xs text-zinc-500">Adjust filters or log attendance using the form above.</p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <AttendancePaginationBar page={listPage} total={rows.length} onPageChange={setListPage} />
      </div>
    </div>
  );
}
