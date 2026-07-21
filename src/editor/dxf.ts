// Minimal, clean DXF (R12-style ENTITIES-only) export. Shapes and drawn paths
// become LINEs, CIRCLEs and POLYLINEs; text becomes TEXT entities. Everything
// is flattened through each object's full transform, and Y is flipped because
// DXF is y-up. Images have no DXF representation and are skipped.

import * as fabric from 'fabric';
import { isTextObject } from './Editor';

const fmt = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

type Pt = [number, number];

interface DXFBuild {
  lines: string[];
  docH: number;
  skippedImages: number;
  entityCount: number;
}

function push(b: DXFBuild, ...pairs: (string | number)[]): void {
  for (const p of pairs) b.lines.push(String(p));
}

const X = (b: DXFBuild, x: number) => fmt(x);
const Y = (b: DXFBuild, y: number) => fmt(b.docH - y);

function emitLine(b: DXFBuild, p1: Pt, p2: Pt): void {
  b.entityCount++;
  push(b, 0, 'LINE', 8, 0, 10, X(b, p1[0]), 20, Y(b, p1[1]), 11, X(b, p2[0]), 21, Y(b, p2[1]));
}

function emitCircle(b: DXFBuild, c: Pt, r: number): void {
  b.entityCount++;
  push(b, 0, 'CIRCLE', 8, 0, 10, X(b, c[0]), 20, Y(b, c[1]), 40, fmt(r));
}

function emitPolyline(b: DXFBuild, pts: Pt[], closed: boolean): void {
  if (pts.length < 2) return;
  b.entityCount++;
  push(b, 0, 'POLYLINE', 8, 0, 66, 1, 70, closed ? 1 : 0);
  for (const p of pts) push(b, 0, 'VERTEX', 8, 0, 10, X(b, p[0]), 20, Y(b, p[1]));
  push(b, 0, 'SEQEND');
}

function emitText(b: DXFBuild, p: Pt, height: number, rotation: number, text: string): void {
  b.entityCount++;
  push(b, 0, 'TEXT', 8, 0, 10, X(b, p[0]), 20, Y(b, p[1]), 40, fmt(height), 1, text, 50, fmt(rotation));
}

// ---------------------------------------------------------------- geometry

/** Transform a point in an object's own plane (origin at object center) to scene coords. */
function toScene(m: number[], x: number, y: number): Pt {
  const p = fabric.util.transformPoint(new fabric.Point(x, y), m as fabric.TMat2D);
  return [p.x, p.y];
}

/** Drop consecutive duplicate points (they show up after flattening curves). */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 0.005 || Math.abs(last[1] - p[1]) > 0.005) out.push(p);
  }
  return out;
}

/**
 * Flatten normalized absolute path commands (M/L/C/Q/Z, from
 * fabric.util.makePathSimpler) into one polyline per subpath.
 */
function flattenPath(cmds: (string | number)[][]): { pts: Pt[]; closed: boolean }[] {
  const subs: { pts: Pt[]; closed: boolean }[] = [];
  let cur: Pt[] = [];
  let start: Pt = [0, 0];
  let pos: Pt = [0, 0];
  const finish = (closed: boolean) => {
    if (cur.length > 1) subs.push({ pts: dedupe(cur), closed });
    cur = [];
  };
  for (const c of cmds) {
    const op = c[0] as string;
    if (op === 'M') {
      finish(false);
      pos = [c[1] as number, c[2] as number];
      start = pos;
      cur.push(pos);
    } else if (op === 'L') {
      pos = [c[1] as number, c[2] as number];
      cur.push(pos);
    } else if (op === 'C') {
      const [x1, y1, x2, y2, x, y] = c.slice(1) as number[];
      const [x0, y0] = pos;
      const steps = 16;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([
          u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
          u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
        ]);
      }
      pos = [x, y];
    } else if (op === 'Q') {
      const [x1, y1, x, y] = c.slice(1) as number[];
      const [x0, y0] = pos;
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        cur.push([u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y]);
      }
      pos = [x, y];
    } else if (op === 'Z' || op === 'z') {
      pos = start;
      finish(true);
      cur = [];
    }
  }
  finish(false);
  return subs;
}

/** True when the matrix is a uniform scale + rotation (circles stay circles). */
function isUniform(m: number[]): boolean {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  const skew = Math.abs(m[0] * m[2] + m[1] * m[3]);
  return Math.abs(sx - sy) < 0.001 * Math.max(sx, sy) && skew < 0.001 * sx * sy;
}

function ellipsePoints(rx: number, ry: number, cx = 0, cy = 0): Pt[] {
  const pts: Pt[] = [];
  const steps = 64;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

// ---------------------------------------------------------------- objects

function addObject(b: DXFBuild, obj: fabric.FabricObject): void {
  if (obj.visible === false) return;

  if (obj instanceof fabric.Group && !(obj instanceof fabric.ActiveSelection)) {
    obj.getObjects().forEach((o) => addObject(b, o));
    return;
  }
  if (obj instanceof fabric.FabricImage) {
    b.skippedImages++;
    return;
  }

  const m = obj.calcTransformMatrix();

  if (isTextObject(obj)) {
    const o = obj as fabric.IText;
    const fontSize = o.fontSize ?? 16;
    const lineHeight = (o.lineHeight ?? 1.16) * fontSize;
    const scale = Math.hypot(m[0], m[1]);
    const rotation = -Math.atan2(m[1], m[0]) * (180 / Math.PI);
    const w = o.width ?? 0, h = o.height ?? 0;
    const textLines = (o.text ?? '').split('\n');
    textLines.forEach((line, i) => {
      if (!line.trim()) return;
      // baseline of line i in the object's own plane
      const baseY = -h / 2 + i * lineHeight + fontSize * 0.9;
      const p = toScene(m, -w / 2, baseY);
      emitText(b, p, fontSize * 0.72 * scale, rotation, line);
    });
    return;
  }

  if (obj instanceof fabric.Line) {
    const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = obj;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    emitLine(b, toScene(m, x1 - cx, y1 - cy), toScene(m, x2 - cx, y2 - cy));
    return;
  }

  if (obj instanceof fabric.Circle && isUniform(m)) {
    const r = (obj.radius ?? 0) * Math.hypot(m[0], m[1]);
    emitCircle(b, toScene(m, 0, 0), r);
    return;
  }

  if (obj instanceof fabric.Circle || obj instanceof fabric.Ellipse) {
    const rx = obj instanceof fabric.Ellipse ? obj.rx ?? 0 : (obj as fabric.Circle).radius ?? 0;
    const ry = obj instanceof fabric.Ellipse ? obj.ry ?? 0 : (obj as fabric.Circle).radius ?? 0;
    emitPolyline(b, ellipsePoints(rx, ry).map(([x, y]) => toScene(m, x, y)), true);
    return;
  }

  if (obj instanceof fabric.Rect) {
    const w = obj.width ?? 0, h = obj.height ?? 0;
    const r = Math.min(obj.rx ?? 0, w / 2, h / 2);
    if (r > 0.01) {
      // rounded rect: straight edges + quarter-arc corners
      const pts: Pt[] = [];
      const corner = (cx: number, cy: number, a0: number) => {
        for (let i = 0; i <= 8; i++) {
          const a = a0 + (i / 8) * (Math.PI / 2);
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
      };
      corner(w / 2 - r, -h / 2 + r, -Math.PI / 2);   // top-right
      corner(w / 2 - r, h / 2 - r, 0);               // bottom-right
      corner(-w / 2 + r, h / 2 - r, Math.PI / 2);    // bottom-left
      corner(-w / 2 + r, -h / 2 + r, Math.PI);       // top-left
      emitPolyline(b, dedupe(pts).map(([x, y]) => toScene(m, x, y)), true);
    } else {
      const pts: Pt[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      emitPolyline(b, pts.map(([x, y]) => toScene(m, x, y)), true);
    }
    return;
  }

  if (obj instanceof fabric.Triangle) {
    const w = obj.width ?? 0, h = obj.height ?? 0;
    const pts: Pt[] = [[0, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    emitPolyline(b, pts.map(([x, y]) => toScene(m, x, y)), true);
    return;
  }

  if (obj instanceof fabric.Polygon || obj instanceof fabric.Polyline) {
    const off = obj.pathOffset;
    const pts = (obj.points ?? []).map((p) => toScene(m, p.x - off.x, p.y - off.y));
    emitPolyline(b, pts, obj instanceof fabric.Polygon);
    return;
  }

  if (obj instanceof fabric.Path) {
    const off = obj.pathOffset;
    const simple = fabric.util.makePathSimpler(obj.path as fabric.TComplexPathData);
    for (const sub of flattenPath(simple as unknown as (string | number)[][])) {
      emitPolyline(b, sub.pts.map(([x, y]) => toScene(m, x - off.x, y - off.y)), sub.closed);
    }
    return;
  }
  // anything unknown: fall through silently — keep the file clean
}

// ---------------------------------------------------------------- entry

export interface DXFResult {
  dxf: string;
  skippedImages: number;
  entityCount: number;
}

export function objectsToDXF(objects: fabric.FabricObject[], docH: number): DXFResult {
  const b: DXFBuild = { lines: [], docH, skippedImages: 0, entityCount: 0 };
  objects.forEach((o) => addObject(b, o));
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', ...b.lines, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
  return { dxf, skippedImages: b.skippedImages, entityCount: b.entityCount };
}
