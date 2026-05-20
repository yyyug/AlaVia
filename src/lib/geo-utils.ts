export function buildQueryVariants(query: string): string[] {
  const variants: string[] = [query];
  const v1 = query.replace(/\u9A5B/g, "\u99C5").replace(/\u7AD9/g, "\u99C5");
  if (v1 !== query) variants.push(v1);
  const v2 = query.replace(/\u99C5/g, "\u9A5B");
  if (v2 !== query && !variants.includes(v2)) variants.push(v2);
  return variants;
}

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

export function round5(v: number): number {
  return Math.round(v * 100_000) / 100_000;
}

export function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

export function normalizeHeading(v: number): number {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
}

export function headingLabel(heading: number): string {
  const dirs = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"];
  const idx = Math.round(normalizeHeading(heading) / 45) % 8;
  return dirs[idx];
}

export function normalizeRoadName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "").trim()
    .replace(/\u9A5B/g, "\u99C5")
    .replace(/\u7AD9/g, "\u99C5");
}

export function signedBearingDelta(fromBearing: number, toBearing: number): number {
  let delta = ((toBearing - fromBearing + 540) % 360) - 180;
  if (delta <= -180) {
    delta += 360;
  }
  return delta;
}

export function bearingDegrees(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const lambda1 = (a.lon * Math.PI) / 180;
  const lambda2 = (b.lon * Math.PI) / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

export function sampleLineByMeters(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  intervalMeters: number,
): Array<{ lat: number; lon: number }> {
  const total = haversineMeters(start, end);
  if (total <= 0) {
    return [start];
  }

  const count = Math.max(1, Math.ceil(total / intervalMeters));
  const points: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    points.push({
      lat: start.lat + (end.lat - start.lat) * t,
      lon: start.lon + (end.lon - start.lon) * t,
    });
  }
  return points;
}

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
