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
  // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  await invoke("load_bus_routes", {
    path: pathInputEl.value,
    onEvent,
  });
}
type Coordinate = {
  lat: number,
  lon: number,
}
type BusRouteEvent =
| {
    event: 'add';
    data: {
      name: string,
      path: Coordinate[],
    }
  }
| {
    event: 'addFinished';
    data: {
      
    };
  }

let map: null;
const script = document.createElement('script');
script.type = "text/javascript";
script.src = `https://api.map.baidu.com/getscript?v=3.0&ak=${API_KEY}`;
document.body.appendChild(script);
script.onload = function() {
  console.log("Before loading BMap");
  map = new BMap.Map("allmap", { minZoom: 10, maxZoom: 21 });
  var point = new BMap.Point(121.47519, 31.228833);
  map.centerAndZoom(point, 15);
  map.enableScrollWheelZoom(true);
  var scaleCtrl = new BMap.ScaleControl();
  map.addControl(scaleCtrl);
};

var linePoints = new Array();
linePoints.splice(0);
const onEvent = new Channel<BusRouteEvent>();
onEvent.onmessage = (message) => {
  switch (message.event) {
    case 'add':
      for (var coord of message.data.path) {
        var bd09_coord = coordtransform.gcj02tobd09(coord.lon, coord.lat);
        linePoints.push(new BMap.Point(bd09_coord[0], bd09_coord[1]));
      }
      showTrack();
      linePoints.splice(0);
      break;
    case 'addFinished':
      break;
  }
};

function showTrack() {
  map.addOverlay(new BMap.Polyline(linePoints, {
    strokeColor: 'blue',
    strokeWeight: 2,
    strokeOpacity: 0.5
	}));
}
