const _cache: Record<string, string> = {};

/** Renders an emoji to a canvas and returns a PNG data URL with full color. */
export function emojiToDataURL(emoji: string, size = 64): string {
  if (typeof document === 'undefined') return '';
  const key = emoji + size;
  if (_cache[key]) return _cache[key];
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.font = `${Math.round(size * 0.72)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2);
  const url = canvas.toDataURL('image/png');
  _cache[key] = url;
  return url;
}
