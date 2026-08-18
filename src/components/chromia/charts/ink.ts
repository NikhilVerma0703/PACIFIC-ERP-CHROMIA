/**
 * Ink that stays readable on a given fill.
 *
 * Most of the outcome colours are deep enough to carry white text, but the grey
 * used for "still in process" is not — white on it is barely legible. Measuring
 * the fill's luminance picks the right ink instead of hoping one colour works
 * everywhere.
 */
export function readableInk(hex: string): string {
  const value = hex.replace('#', '');
  const channel = (start: number) => Number.parseInt(value.slice(start, start + 2), 16) / 255;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance =
    0.2126 * linear(channel(0)) + 0.7152 * linear(channel(2)) + 0.0722 * linear(channel(4));

  return luminance > 0.3 ? '#0f172a' : '#ffffff';
}
