const moneyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount) {
  return moneyFormatter.format(Number(amount) || 0);
}

export function formatMoneyPerHour(amount) {
  return `${formatMoney(amount)}/hr`;
}
