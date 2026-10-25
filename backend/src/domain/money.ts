// Money is integer cents inside the backend and a decimal string ("3.60") in API responses.

export function decimalToCents(value: string | number): number {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents)) {
    throw new Error(`Invalid money value: ${String(value)}`);
  }
  return cents;
}

export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`Cents must be an integer: ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}
