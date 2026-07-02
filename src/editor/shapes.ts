// Geometry helpers for shapes with rounded corners.

/** SVG path for a triangle (apex top-center) with rounded corners of radius r. */
export function roundedTrianglePath(w: number, h: number, r: number): string {
  const pts = [
    { x: w / 2, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  if (r <= 0.5) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y} L ${pts[2].x} ${pts[2].y} Z`;
  }
  const segs: string[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const rr = Math.min(r, inLen / 2 - 0.5, outLen / 2 - 0.5);
    const inX = cur.x - ((cur.x - prev.x) / inLen) * rr;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * rr;
    const outX = cur.x + ((next.x - cur.x) / outLen) * rr;
    const outY = cur.y + ((next.y - cur.y) / outLen) * rr;
    if (i === 0) segs.push(`M ${inX.toFixed(2)} ${inY.toFixed(2)}`);
    else segs.push(`L ${inX.toFixed(2)} ${inY.toFixed(2)}`);
    segs.push(`Q ${cur.x.toFixed(2)} ${cur.y.toFixed(2)} ${outX.toFixed(2)} ${outY.toFixed(2)}`);
  }
  segs.push('Z');
  return segs.join(' ');
}
