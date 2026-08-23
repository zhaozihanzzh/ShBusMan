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
// Adds text labels on polylines. Labels adapt to zoom level and
// only show when at least part of the route is in the current viewport.
class RouteLabelManager {
  private entries: Array<{ polyline: any; label: any; bdPoints: any[] }> = [];
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

    // Place label at the approximate midpoint
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
    // Labels are hidden by default; updateAll() will show them when appropriate
    label.hide();
    this.map.addOverlay(label);

    this.entries.push({ polyline, label, bdPoints: points });
  }

  /** Re-evaluate visibility and font size for every managed label. */
  updateAll() {
    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();

    for (const entry of this.entries) {
      // Hide when zoomed out too far
      if (zoom < this.minZoomForLabel) {
        entry.label.hide();
        continue;
      }

      // Check if the polyline has ANY point inside the current viewport.
      // If the whole route is off-screen, hide the label.
      let visible = false;
      const pts = entry.bdPoints;
      // Quick bounds-level check first: do the route bounds overlap the viewport?
      const routeBounds = entry.polyline.getBounds();
      if (routeBounds && bounds.intersects(routeBounds)) {
      // At least one point should be visible -- try to snap the label to
        // a visible position for better UX when the midpoint is off-screen.
        // We scan points in chunks to keep it cheap.
        const step = Math.max(1, Math.floor(pts.length / 20));
        for (let i = 0; i < pts.length; i += step) {
          if (bounds.containsPoint(pts[i])) {
            entry.label.setPosition(pts[i]);
            visible = true;
            break;
          }
        }
        if (!visible) {
          // No chunked point was in bounds, but bounds intersected -- fallback to midpoint
          const midIdx = Math.floor(pts.length / 2);
          entry.label.setPosition(pts[midIdx]);
          visible = bounds.containsPoint(pts[midIdx]);
        }
      }

      if (!visible) {
        entry.label.hide();
        continue;
      }

      entry.label.show();

      // Scale font size with zoom
      const baseSize = 13;
      const size = Math.round(baseSize + (zoom - this.minZoomForLabel) * 0.8);
      const clampedSize = Math.min(Math.max(size, 10), 22);
      entry.label.setStyle({ fontSize: clampedSize + "px" });
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
