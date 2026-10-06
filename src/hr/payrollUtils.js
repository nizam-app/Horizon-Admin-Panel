/** @param {string} isoDate YYYY-MM-DD */
export function mondayWeekStart(isoDate) {
  const s = String(isoDate || '').slice(0, 10);
  const d = new Date(`${s}T12:00:00.000Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function weekRangeFromDate(isoDate) {
  const from = mondayWeekStart(isoDate);
  const end = new Date(`${from}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return { from, to: end.toISOString().slice(0, 10) };
}

/** Seven-day window ending on the selected date (inclusive); nothing after that date. */
export function payPeriodRangeEnding(isoDate) {
  const to = String(isoDate || '').slice(0, 10);
  const end = new Date(`${to}T12:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { from: start.toISOString().slice(0, 10), to };
}

export function formatPayPeriodEndingLabel(isoDate) {
  const { from, to } = payPeriodRangeEnding(isoDate);
  const end = new Date(`${to}T12:00:00.000Z`);
  const endLabel = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `Last 7 days ending ${endLabel} (${from} → ${to})`;
}

export function formatWeekLabel(weekStartIso) {
  const d = new Date(`${weekStartIso}T12:00:00.000Z`);
  return `Week of ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function parseTimeMinutes(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hoursFromAttendanceRow(row) {
  const inM = parseTimeMinutes(row?.checkIn);
  const outM = parseTimeMinutes(row?.checkOut);
  if (inM === null || outM === null || outM <= inM) return 0;
  return Math.round(((outM - inM) / 60) * 100) / 100;
}

/** User-facing message when both times are set but hours would be zero. */
export function attendanceTimeRangeError(row) {
  const inRaw = String(row?.checkIn ?? '').trim();
  const outRaw = String(row?.checkOut ?? '').trim();
  if (!inRaw || !outRaw) return null;
  const inM = parseTimeMinutes(inRaw);
  const outM = parseTimeMinutes(outRaw);
  if (inM === null || outM === null) {
    return 'Use 24-hour times (e.g. 14:45 and 16:55 for 2:45 PM–4:55 PM).';
  }
  if (outM <= inM) {
    return 'Check-out must be later than check-in on the same day. For 4:55 PM use 16:55, not 04:55.';
  }
  return null;
}
