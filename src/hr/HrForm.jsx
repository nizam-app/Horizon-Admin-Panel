import { labelClass, fieldClass, selectClass } from '../hrPanelUtils.js';
import { PickerInput } from '../PickerInput.jsx';

export function HrField({ label, children, className = '' }) {
  return (
    <div className={className}>
      <span className={labelClass}>{label}</span>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function HrTextInput({ className = '', ...props }) {
  return <input className={`${fieldClass} ${className}`} {...props} />;
}

export function HrSelect({ className = '', children, ...props }) {
  return (
    <select className={`${selectClass} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function HrDateInput({ className = '', ...props }) {
  return <PickerInput type="date" className={`${className}`} {...props} />;
}

const MONTHS = [
  { v: 1, label: 'January' },
  { v: 2, label: 'February' },
  { v: 3, label: 'March' },
  { v: 4, label: 'April' },
  { v: 5, label: 'May' },
  { v: 6, label: 'June' },
  { v: 7, label: 'July' },
  { v: 8, label: 'August' },
  { v: 9, label: 'September' },
  { v: 10, label: 'October' },
  { v: 11, label: 'November' },
  { v: 12, label: 'December' },
];

export function HrMonthSelect({ value, onChange, className = '' }) {
  return (
    <HrSelect className={className} value={value} onChange={onChange}>
      {MONTHS.map((m) => (
        <option key={m.v} value={m.v}>{m.label}</option>
      ))}
    </HrSelect>
  );
}

export function HrMoneyInput({ currency = 'NZD', className = '', inputClassName = '', ...props }) {
  return (
    <div className={`flex h-10 overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/15 ${className}`}>
      <span className="flex shrink-0 items-center border-r border-zinc-200/90 bg-zinc-50 px-3 text-2xs font-bold uppercase tracking-wide text-zinc-500">
        {currency}
      </span>
      <input
        type="number"
        min={0}
        step="0.01"
        className={`min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 ${inputClassName}`}
        {...props}
      />
    </div>
  );
}
