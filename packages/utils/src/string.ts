export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
}

export function truncate(text: string, length = 30, suffix = '...'): string {
  if (text.length <= length) return text;
  return text.substring(0, length - suffix.length) + suffix;
}

export function maskSecret(secret: string, visibleLength = 4): string {
  if (!secret) return '';
  if (secret.length <= visibleLength * 2) {
    return '•'.repeat(8);
  }
  const prefix = secret.substring(0, visibleLength);
  const suffix = secret.substring(secret.length - visibleLength);
  return `${prefix}${'•'.repeat(8)}${suffix}`;
}
