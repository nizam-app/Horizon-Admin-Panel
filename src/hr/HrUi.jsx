import { CalendarDays, Filter, Search } from 'lucide-react';

export const hrCardClass =
  'overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-card ring-1 ring-zinc-950/[0.03]';

export const hrCardHeaderClass =
  'flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100/90 bg-gradient-to-r from-zinc-50/90 to-white px-4 py-3.5 sm:px-5';

export const hrPrimaryBtn =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 text-sm font-semibold text-white shadow-md shadow-indigo-900/15 transition hover:from-indigo-500 hover:to-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80 disabled:pointer-events-none disabled:opacity-55';

export const hrSecondaryBtn =
  'inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200/90 bg-white px-3 text-2xs font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50';

export function HrPageHeader({ title, description, icon: Icon = CalendarDays }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-card ring-1 ring-zinc-950/[0.03] sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_100%_0%,rgba(99,102,241,0.08),transparent_55%)]"
        aria-hidden
      />
      <div className="relative flex gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-glow">
          <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-600">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function HrSectionTitle({ title, subtitle }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-2xs text-zinc-500">{subtitle}</p> : null}
    </div>
  );
}

export function HrFilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-lg px-3 text-2xs font-semibold transition ${
        active
          ? 'border border-indigo-200 bg-indigo-50 text-indigo-900 shadow-sm ring-1 ring-indigo-100'
          : 'border border-zinc-200/90 bg-white text-zinc-600 shadow-sm hover:border-zinc-300 hover:bg-zinc-50'
      }`}
    >
      {children}
    </button>
  );
}

export function HrFilterBar({ children, meta }) {
  return (
    <div className="border-b border-zinc-100/90 bg-zinc-50/40 px-4 py-4 sm:px-5">
      <div className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-zinc-500">
        <Filter className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        Filters
      </div>
      <div className="flex flex-col gap-4">{children}</div>
      {meta ? <p className="mt-3 text-2xs text-zinc-500">{meta}</p> : null}
    </div>
  );
}

export function HrSearchField({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
        strokeWidth={2}
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-zinc-200/90 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15"
      />
    </div>
  );
}

export function employeeInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
