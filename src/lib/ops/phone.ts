export function phoneKey(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const local = digits.startsWith("61") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  return local.slice(-9);
}
