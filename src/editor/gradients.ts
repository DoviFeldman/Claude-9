// Gradient support: a small editable spec that converts to/from fabric.Gradient.
// Every stop carries its own opacity, which is what makes fades to transparent
// possible (e.g. orange → soft clear).

import * as fabric from 'fabric';
import { clamp, hexToRgb, rgbToHex } from './colors';

export interface GradientStop {
  color: string;   // #rrggbb
  opacity: number; // 0..1 (0 = fully transparent)
  offset: number;  // 0..1 position along the gradient
}

export interface GradientSpec {
  kind: 'linear' | 'radial';
  angle: number; // degrees, CSS convention (0 = up, 90 = right); linear only
  stops: GradientStop[];
}

export const DEFAULT_GRADIENT: GradientSpec = {
  kind: 'linear',
  angle: 90,
  stops: [
    { color: '#8b3dff', opacity: 1, offset: 0 },
    { color: '#4f7cff', opacity: 1, offset: 1 },
  ],
};

export const GRADIENT_PRESETS: GradientSpec[] = [
  { kind: 'linear', angle: 135, stops: [{ color: '#8b3dff', opacity: 1, offset: 0 }, { color: '#4f7cff', opacity: 1, offset: 1 }] },
  { kind: 'linear', angle: 135, stops: [{ color: '#ff512f', opacity: 1, offset: 0 }, { color: '#f09819', opacity: 1, offset: 1 }] },
  { kind: 'linear', angle: 135, stops: [{ color: '#ff6a88', opacity: 1, offset: 0 }, { color: '#ff99ac', opacity: 1, offset: 1 }] },
  { kind: 'linear', angle: 135, stops: [{ color: '#cc2b5e', opacity: 1, offset: 0 }, { color: '#753a88', opacity: 1, offset: 1 }] },
  { kind: 'linear', angle: 135, stops: [{ color: '#2193b0', opacity: 1, offset: 0 }, { color: '#6dd5ed', opacity: 1, offset: 1 }] },
  { kind: 'linear', angle: 135, stops: [{ color: '#11998e', opacity: 1, offset: 0 }, { color: '#38ef7d', opacity: 1, offset: 1 }] },
  { kind: 'linear', angle: 135, stops: [{ color: '#f83600', opacity: 1, offset: 0 }, { color: '#f9d423', opacity: 1, offset: 1 }] },
  { kind: 'linear', angle: 135, stops: [{ color: '#43cea2', opacity: 1, offset: 0 }, { color: '#185a9d', opacity: 1, offset: 1 }] },
  { kind: 'radial', angle: 0, stops: [{ color: '#fddb92', opacity: 1, offset: 0 }, { color: '#d1fdff', opacity: 1, offset: 1 }] },
  // transparency gradients — solid into soft clear
  { kind: 'linear', angle: 180, stops: [{ color: '#ff914d', opacity: 1, offset: 0 }, { color: '#ff914d', opacity: 0, offset: 1 }] },
  { kind: 'linear', angle: 180, stops: [{ color: '#000000', opacity: 0.85, offset: 0 }, { color: '#000000', opacity: 0, offset: 1 }] },
  { kind: 'linear', angle: 0, stops: [{ color: '#ffffff', opacity: 1, offset: 0 }, { color: '#ffffff', opacity: 0, offset: 1 }] },
];

const stopRgba = (s: GradientStop): string => {
  const c = hexToRgb(s.color) ?? { r: 0, g: 0, b: 0 };
  return `rgba(${c.r},${c.g},${c.b},${Math.round(clamp(s.opacity, 0, 1) * 1000) / 1000})`;
};

const sortedStops = (spec: GradientSpec): GradientStop[] =>
  [...spec.stops].sort((a, b) => a.offset - b.offset);

function linearCoords(angle: number, w: number, h: number) {
  const rad = (((angle % 360) + 360) % 360) * (Math.PI / 180);
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  return {
    x1: (0.5 - dx) * w, y1: (0.5 - dy) * h,
    x2: (0.5 + dx) * w, y2: (0.5 + dy) * h,
  };
}

/**
 * Build a fabric gradient from a spec.
 * Object fills use percentage units (fabric scales them by the object's size);
 * page backgrounds and stroke gradients need pixel units with real dimensions,
 * because fabric does not scale percentage coords for those.
 */
export type FabricGradient = fabric.Gradient<'linear'> | fabric.Gradient<'radial'>;

export function specToGradient(
  spec: GradientSpec,
  opts: { units?: 'percentage' | 'pixels'; w?: number; h?: number } = {},
): FabricGradient {
  const units = opts.units ?? 'percentage';
  const w = opts.w ?? 1, h = opts.h ?? 1;
  const colorStops = sortedStops(spec).map((s) => ({ offset: clamp(s.offset, 0, 1), color: stopRgba(s) }));
  if (spec.kind === 'radial') {
    const r2 = units === 'pixels' ? Math.hypot(w, h) / 2 : 0.71;
    return new fabric.Gradient<'radial'>({
      type: 'radial',
      gradientUnits: units,
      coords: { x1: 0.5 * w, y1: 0.5 * h, r1: 0, x2: 0.5 * w, y2: 0.5 * h, r2 },
      colorStops,
    });
  }
  return new fabric.Gradient<'linear'>({
    type: 'linear',
    gradientUnits: units,
    coords: linearCoords(spec.angle, w, h),
    colorStops,
  });
}

function parseCssColor(color: string): { hex: string; opacity: number } {
  const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/);
  if (m) return { hex: rgbToHex(+m[1], +m[2], +m[3]), opacity: m[4] === undefined ? 1 : clamp(+m[4], 0, 1) };
  const rgb = hexToRgb(color);
  return { hex: rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : '#000000', opacity: 1 };
}

export function isGradient(fill: unknown): fill is FabricGradient {
  return !!fill && typeof fill === 'object' && Array.isArray((fill as { colorStops?: unknown }).colorStops);
}

/** Recover an editable spec from a fabric gradient (angle derived from coords). */
export function gradientToSpec(fill: unknown): GradientSpec | null {
  if (!isGradient(fill)) return null;
  const g = fill;
  const stops: GradientStop[] = (g.colorStops ?? [])
    .map((s) => {
      const { hex, opacity } = parseCssColor(s.color);
      return {
        color: hex,
        opacity: s.opacity !== undefined ? clamp(s.opacity, 0, 1) : opacity,
        offset: clamp(s.offset ?? 0, 0, 1),
      };
    })
    .sort((a, b) => a.offset - b.offset);
  if (stops.length < 2) return null;
  if (g.type === 'radial') return { kind: 'radial', angle: 0, stops };
  const coords = g.coords as { x1?: number; y1?: number; x2?: number; y2?: number };
  const dx = (coords?.x2 ?? 1) - (coords?.x1 ?? 0);
  const dy = (coords?.y2 ?? 0) - (coords?.y1 ?? 0);
  const angle = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
  return { kind: 'linear', angle, stops };
}

/** CSS equivalent of a spec — used for previews, chips and swatches. */
export function specToCss(spec: GradientSpec): string {
  const stops = sortedStops(spec)
    .map((s) => `${stopRgba(s)} ${Math.round(s.offset * 100)}%`)
    .join(', ');
  return spec.kind === 'radial'
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${spec.angle}deg, ${stops})`;
}

/** CSS preview of any fill value (hex string or fabric gradient). */
export function fillToCss(fill: unknown): string {
  if (typeof fill === 'string' && fill) return fill;
  if (isGradient(fill)) {
    const spec = gradientToSpec(fill);
    if (spec) return specToCss(spec);
  }
  return '#ffffff';
}
