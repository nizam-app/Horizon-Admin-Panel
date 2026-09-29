import { ApiAuthError } from './api.js';

export function useHrLoadError(err, onAuthError) {
  if (err instanceof ApiAuthError) {
    onAuthError?.();
    return 'Session expired. Please sign in again.';
  }
  return err?.message || 'Request failed';
}

export const inputClass =
  'block w-full min-w-0 rounded-xl border border-zinc-200/90 bg-white px-3 text-sm text-zinc-900 shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15';

/** Text, number, email — fixed 40px height to match selects and date fields. */
export const fieldClass = `${inputClass} h-10 py-2`;

const selectChevron =
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' viewBox='0 0 24 24'%3E%3Cpath stroke='%2371717a' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]";

export const selectClass = `${fieldClass} cursor-pointer appearance-none bg-[length:1rem_1rem] bg-[position:right_0.75rem_center] bg-no-repeat pr-10 ${selectChevron}`;

/** Date/time inputs: whole field opens the native picker (not only the icon). */
export const pickerInputClass = `${fieldClass} relative cursor-pointer appearance-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0`;

export const labelClass = 'mb-0 block text-2xs font-semibold uppercase tracking-wider text-zinc-500';
