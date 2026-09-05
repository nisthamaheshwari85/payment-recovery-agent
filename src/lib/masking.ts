/**
 * India Digital Personal Data Protection (DPDP) Act Compliance Helpers.
 * Provides display-layer PII redaction for phone numbers and email addresses
 * without mutating or degrading the underlying operational records in the database.
 */

/**
 * Masks a phone number for display (e.g. "+91 98765 43210" -> "+91 987****210" or "+91998****668")
 */
export function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length >= 10) {
    const last3 = digits.slice(-3);
    const first3 = digits.slice(-10, -7);
    const country = digits.length > 10 ? `+${digits.slice(0, -10)} ` : '+91 ';
    return `${country}${first3}****${last3}`;
  }

  return trimmed.replace(/.(?=.{4})/g, '*');
}

/**
 * Masks an email address for display (e.g. "ananya.roy@example.com" -> "an***@example.com")
 */
export function maskEmail(email?: string | null): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const maskedLocal = local.length > 2 ? `${local.slice(0, 2)}***` : `${local.slice(0, 1)}*`;
  return `${maskedLocal}@${domain}`;
}
