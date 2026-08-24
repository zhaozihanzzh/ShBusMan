import { invoke, Channel } from "@tauri-apps/api/core";

let pathInputEl: HTMLInputElement | null;

pathInputEl = document.querySelector("#path-input");
window.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#load-all-form")?.addEventListener("submit", (e) => {
    if (pathInputEl) {
      e.preventDefault();
      load_all();
    } else {
      console.log("Can't find element");
    }
  })
});

async function load_all() {
  if (!pathInputEl) return;
  await invoke("load_bus_routes", {
    path: pathInputEl.value,
    onEvent,
  });
}

type Coordinate = {
  lat: number;
  lon: number;
};

type BusRouteEvent =
  | {
      event: "add";
      data: {
        name: string;
        path: Coordinate[];
      };
    }
  | {
      event: "addFinished";
      data: {};
    };

let map: any;
const script = document.createElement("script");
script.type = "text/javascript";
script.src = `https://api.map.baidu.com/getscript?v=3.0&ak=${API_KEY}`;
document.body.appendChild(script);

// ── Route label manager ──────────────────────────────────────────
//
// Design: bus-route text labels with overlap avoidance
// -------------------------------------------------------
// Problem:  Each route needs a visible name label. When two or more routes
// share the same stretch of road, their labels will stack on top of each
// other and become illegible.
//
// Approach (pixel-space greedy placement):
//   1. Visibility filter   — skip routes entirely outside the viewport.
//   2. Candidate sampling  — for each visible route, pick up to 7 evenly-
//      spaced geographic points that are within the viewport. These become
//      candidate label anchor positions (converted to pixel coords via
//      BMap.Map.pointToOverlayPixel).
//   3. AABB collision test  — estimate each label's pixel bounding box
//      from the text length × char-width and the current font size. Track
//      an "occupied" list of already-placed rectangles.
//   4. Greedy assignment   — iterate plans in insertion order. For each
//      plan, try every candidate × every vertical offset (0, ±24, ±48 px).
//      Score = (overlapCount, abs(offsetY), distance-to-midPx).
//      Pick the combination with the fewest overlaps; ties broken by
//      smaller offset, then by proximity to the route's midpoint.
//   5. Fallback            — if every candidate overlaps at least one
//      existing label, the algorithm still picks the one with the least
//      overlap, so labels on parallel routes naturally spread out.
//
// Why not label collision from Baidu Maps API?
//   BMap.Label does not expose a pixel bounding-box after rendering, so
//   we estimate it ourselves. The estimate is conservative (slightly wider)
//   to avoid crowding.
// -------------------------------------------------------
//
// Adds text labels on polylines. Labels adapt to zoom level and
// only show when at least part of the route is in the current viewport.
class RouteLabelManager {
  private entries: Array<{ name: string; polyline: any; label: any; bdPoints: any[] }> = [];
  private map: any;
  private minZoomForLabel = 13;

  constructor(map: any) {
    this.map = map;
    map.addEventListener("dragend", () => this.updateAll());
    map.addEventListener("zoomend", () => this.updateAll());
    map.addEventListener("moveend", () => this.updateAll());
  }

  /** Add a named route -- draws polyline and its text label. */
  addRoute(name: string, points: Array<any>) {
    const polyline = new BMap.Polyline(points, {
      strokeColor: "blue",
      strokeWeight: 2,
      strokeOpacity: 0.5,
    });
    this.map.addOverlay(polyline);

    const midIdx = Math.floor(points.length / 2);
    const midPoint = points[midIdx];

    const label = new BMap.Label(name, {
      position: midPoint,
      offset: new BMap.Size(0, 0),
    });
    label.setStyle({
      color: "#d84c29",
      fontSize: "13px",
      fontWeight: "bold",
      backgroundColor: "rgba(255,255,255,0.85)",
      border: "1px solid #d84c29",
      borderRadius: "3px",
      padding: "2px 6px",
      whiteSpace: "nowrap",
      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
    });
    label.hide();
    this.map.addOverlay(label);

    this.entries.push({ name, polyline, label, bdPoints: points });
  }

  /**
   * Re-evaluate all labels: pick collision-free positions from
   * multiple candidates along each route, with vertical offset fallback.
   */
  updateAll() {
    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();

    if (zoom < this.minZoomForLabel) {
      for (const entry of this.entries) entry.label.hide();
      return;
    }

    const baseSize = 13;
    const size = Math.round(baseSize + (zoom - this.minZoomForLabel) * 0.8);
    const clampedSize = Math.min(Math.max(size, 10), 22);
    const charWidth = clampedSize * 0.6;
    const labelHeight = clampedSize + 10;

    type PixelPt = { x: number; y: number; point: any };
    type RoutePlan = {
      entry: any;
      candidates: PixelPt[];
      midPx: { x: number; y: number };
    };

    const plans: RoutePlan[] = [];
    const occupied: Array<{ l: number; r: number; t: number; b: number }> = [];

    for (const entry of this.entries) {
      const pts = entry.bdPoints;
      const routeBounds = entry.polyline.getBounds();
      if (!routeBounds || !bounds.intersects(routeBounds)) {
        entry.label.hide();
        continue;
      }

      const visible: Array<{ point: any; idx: number }> = [];
      const coarse = Math.max(1, Math.floor(pts.length / 40));
      for (let i = 0; i < pts.length; i += coarse) {
        if (bounds.containsPoint(pts[i])) {
          visible.push({ point: pts[i], idx: i });
        }
      }
      if (visible.length === 0) {
        const midIdx = Math.floor(pts.length / 2);
        if (bounds.containsPoint(pts[midIdx])) {
          visible.push({ point: pts[midIdx], idx: midIdx });
        } else {
          entry.label.hide();
          continue;
        }
      }

      const candidates: PixelPt[] = [];
      const maxCand = 7;
      const cStep = Math.max(1, Math.floor(visible.length / (maxCand + 1)));
      for (let i = 0; i < visible.length && candidates.length < maxCand; i += cStep) {
        const px = this.map.pointToOverlayPixel(visible[i].point);
        candidates.push({ x: Math.round(px.x), y: Math.round(px.y), point: visible[i].point });
      }

      const mid = visible[Math.floor(visible.length / 2)];
      const midPx = this.map.pointToOverlayPixel(mid.point);

      plans.push({
        entry,
        candidates,
        midPx: { x: Math.round(midPx.x), y: Math.round(midPx.y) },
      });
    }

    // Greedy label placement: try each candidate with vertical offsets
    for (const plan of plans) {
      const entry = plan.entry;
      const labelWidth = entry.name.length * charWidth + 24;

      let bestCand: PixelPt | null = null;
      let bestOffsetY = 0;
      let bestOverlap = Infinity;
      let bestDist = Infinity;

      const offsets = [0, -24, 24, -48, 48];

      for (const cand of plan.candidates) {
        for (const offY of offsets) {
          const l = cand.x - 6;
          const r = cand.x + labelWidth;
          const t = cand.y + offY - labelHeight / 2;
          const b = cand.y + offY + labelHeight / 2;

          let overlapCount = 0;
          for (const occ of occupied) {
            if (l < occ.r && r > occ.l && t < occ.b && b > occ.t) {
              overlapCount++;
            }
          }

          const dist = Math.abs(cand.x - plan.midPx.x) + Math.abs(cand.y + offY - plan.midPx.y);
          const isBetter =
            overlapCount < bestOverlap ||
            (overlapCount === bestOverlap && Math.abs(offY) < Math.abs(bestOffsetY)) ||
            (overlapCount === bestOverlap && offY === bestOffsetY && dist < bestDist);

          if (isBetter) {
            bestOverlap = overlapCount;
            bestCand = cand;
            bestOffsetY = offY;
            bestDist = dist;
          }
        }
      }

      if (bestCand) {
        entry.label.setPosition(bestCand.point);
        entry.label.setOffset(new BMap.Size(0, bestOffsetY));
        entry.label.setStyle({ fontSize: clampedSize + "px" });
        entry.label.show();

        const l = bestCand.x - 6;
        const r = bestCand.x + labelWidth;
        const t = bestCand.y + bestOffsetY - labelHeight / 2;
        const b = bestCand.y + bestOffsetY + labelHeight / 2;
        occupied.push({ l, r, t, b });
      }
    }
  }

  /** Remove all managed overlays. */
  clearAll() {
    for (const entry of this.entries) {
      this.map.removeOverlay(entry.polyline);
      this.map.removeOverlay(entry.label);
    }
    this.entries = [];
  }
}

// ── BMap initialisation & event handling ────────────────────────
let lineManager: RouteLabelManager | null = null;

// Buffer for routes that arrive before BMap is ready
const pendingRoutes: Array<{ name: string; bdPoints: any[] }> = [];

script.onload = function () {
  console.log("BMap loaded");
  map = new BMap.Map("allmap", { minZoom: 10, maxZoom: 21 });
  const point = new BMap.Point(121.47519, 31.228833);
  map.centerAndZoom(point, 15);
  map.enableScrollWheelZoom(true);
  map.addControl(new BMap.ScaleControl());

  lineManager = new RouteLabelManager(map);

  // Flush any routes that were queued before map initialisation
  for (const r of pendingRoutes) {
    lineManager.addRoute(r.name, r.bdPoints);
  }
  pendingRoutes.splice(0);
  lineManager.updateAll();
};

const onEvent = new Channel<BusRouteEvent>();
onEvent.onmessage = (message) => {
  if (message.event === "add") {
    const data = message.data;
    const bdPoints: Array<any> = [];
    for (const coord of data.path) {
      const bd09 = (coordtransform as any).gcj02tobd09(coord.lon, coord.lat);
      bdPoints.push(new BMap.Point(bd09[0], bd09[1]));
    }
    if (lineManager) {
      lineManager.addRoute(data.name, bdPoints);
      lineManager.updateAll();
    } else {
      // Queue until BMap script finishes loading
      pendingRoutes.push({ name: data.name, bdPoints });
    }
  }
};
