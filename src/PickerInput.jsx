import { pickerInputClass } from './hrPanelUtils.js';

function openNativePicker(ev) {
  const el = ev.currentTarget;
  if (typeof el.showPicker === 'function') {
    try {
      el.showPicker();
    } catch {
      /* ignore */
    }
  }
}

export function PickerInput({ type = 'date', className = '', onClick, ...props }) {
  return (
    <input
      type={type}
      className={`${pickerInputClass} ${className}`.trim()}
      onClick={(ev) => {
        openNativePicker(ev);
        onClick?.(ev);
      }}
      {...props}
    />
  );
}
