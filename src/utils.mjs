export function nearlyEqual(actual, expected, tolerance = 2) {
  return Math.abs(actual - expected) <= tolerance;
}

export function firstNumberPx(cssValue) {
  if (!cssValue) return null;
  const parsed = Number.parseFloat(cssValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseRgba(cssColor) {
  if (!cssColor) return null;
  const m = cssColor
    .replaceAll(' ', '')
    .match(/^rgba?\((\d+),(\d+),(\d+)(?:,([0-9.]+))?\)$/i);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

export function colorClose(actualCss, expectedCss, tolerance = 8, alphaTolerance = 0.08) {
  const a = parseRgba(actualCss);
  const e = parseRgba(expectedCss);
  if (!a || !e) return false;
  return (
    nearlyEqual(a.r, e.r, tolerance) &&
    nearlyEqual(a.g, e.g, tolerance) &&
    nearlyEqual(a.b, e.b, tolerance) &&
    nearlyEqual(a.a, e.a, alphaTolerance)
  );
}
