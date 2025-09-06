use std::{fs, io::Read};
use tauri::ipc::Channel;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// unused now
struct Block {
    west_bound: f32,
    east_bound: f32,
    north_bound: f32,
    south_bound: f32,
    level: i32,
    // 左上，右上，左下，右下
    children: Vec<Block>,
}

// unused now
static ROOT_BLOCK: Block = Block { west_bound: 120.0, east_bound: 122.5, north_bound: 32.0, south_bound: 30.0, level: 0, children: Vec::new()};

// 计算某个bound内要显示的线段，根据缩放等级计算出Douglas-Peucker简化后的曲线
// 先分成block，计算每个block内有什么线段要显示。block树状的，有指针指向线路。
// 然后计算哪些block落在bound里，把bound里面的线段拿出来根据缩放等级简化后添加到前端上
// use R* tree
// unused now
struct Line {
    source_lat: f32,
    source_lon: f32,
    dest_lat: f32,
    dest_lon: f32
}
// unused now
#[tauri::command]
fn on_bound_change(zoom: i32, left: i32, right: i32, north: f32, south: f32) -> String {
    return "".to_string();
}
#[tauri::command]
fn load_bus_routes(path: &str, on_event: Channel<BusRouteEvent>) -> String {
    match load_bus_routes_impl(path, on_event) {
        Ok(str) => { return str; }
        Err(err) => {
            println!("{}", err.to_string());
            return err.to_string();
        }
    }
}

// These structs are used for JSON (de)serialization.
#[derive(serde::Deserialize)]
struct QRLngLat {
    Q: f32,
    R: f32,
    lng: f32,
    lat: f32
}
#[derive(serde::Deserialize)]
struct BusStops {
    id: String,
    location: QRLngLat,
    name: String,
    sequence: i32,
}
#[derive(serde::Deserialize)]
struct RouteSingle {
    num: i32,
    name: String, 
    distance: String, // 带引号
    path: Vec<QRLngLat>,
    via_stops: Vec<BusStops>,
}

#[derive(Clone, serde::Serialize)]
struct Coordinate {
    lat: f32,
    lon: f32
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "event", content = "data")]
enum BusRouteEvent<'a> {
  Add {
    name: &'a str,
    path: Vec<Coordinate>,
  },
  AddFinished {
    
  },
}

fn load_bus_routes_impl(path: &str, on_event: Channel<BusRouteEvent>) -> Result<String, std::io::Error> {
    let entries = fs::read_dir(path)?;
    for entry in entries {
        let entry_path = entry?.path();
        // The following lines accept only file names started with number
        // if entry_path.file_name().unwrap()
        //     .to_str().unwrap_or("A").chars().next().unwrap()
        //     .is_numeric() {
        let mut file = std::fs::File::open(entry_path.as_path())?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        let route_json: Vec<RouteSingle> = serde_json::from_str(&content)?;
    
        for route in route_json {
            let mut coordinate_json: Vec<Coordinate> = Vec::new();
            for line in route.path {
                coordinate_json.push(Coordinate{lat: line.lat, lon: line.lng});
            }
            on_event.send(BusRouteEvent::Add {
                name: &route.name,
                path: coordinate_json,
            }).unwrap();
        }
    }
    on_event.send(BusRouteEvent::AddFinished {  }).unwrap();
    
    Ok("".to_string())
    
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, load_bus_routes, on_bound_change])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
