import { ItemWeatherInfo, ItineraryItem } from "../types";
import { formatItemDateLabel, formatItemSchedule } from "./dateUtils";
import { formatDurationLabel, formatTimeRange } from "./durationUtils";
import { resolveMapPoint } from "./geoCoords";
import { isEditableNode, resolveNodeType } from "./nodeUtils";

export type MapMarkerPayload = {
  id: string;
  index: number;
  lng: number;
  lat: number;
  icon: string;
  title: string;
  startTime: string;
  endTime: string;
  timeRange: string;
  dateLabel: string;
  scheduleLabel: string;
  duration: string;
  location: string;
  nodeType: "hard_anchor" | "semi_anchor" | "soft_task";
  riskLevel: "low" | "medium" | "high";
  riskText: string;
  editable: boolean;
  draggable: boolean;
};

const MAP_BOOT = `
  if (!window.ReactNativeWebView) {
    window.ReactNativeWebView = {
      postMessage: function(message) {
        window.parent && window.parent.postMessage({ source: 'map-topology', payload: message }, '*');
      }
    };
  }
  window.mapApi = {
    zoomIn: function() { if (window.__map) window.__map.zoomIn(); },
    zoomOut: function() { if (window.__map) window.__map.zoomOut(); },
    fitView: function() {
      if (window.__map && window.__markerInstances && window.__markerInstances.length) {
        window.__map.setFitView(window.__markerInstances, false, [50, 50, 50, 50]);
      }
    },
  };
  window.__fitMapOnce = function(map, markerInstances) {
    if (window.__didInitialFit || !markerInstances.length) return;
    map.setFitView(markerInstances, false, [50, 50, 50, 50]);
    window.__didInitialFit = true;
  };
`;

const MAP_VIEW_HELPERS = `
  function distanceFromCenter(item, center) {
    const lngDiff = item.lng - center.lng;
    const latDiff = item.lat - center.lat;
    return Math.sqrt(lngDiff * lngDiff + latDiff * latDiff);
  }
  function displayMarkersForCity(markers, center) {
    const localMarkers = markers.filter(function(item) {
      return distanceFromCenter(item, center) < 1.8;
    });
    const visibleMarkers = localMarkers.length ? localMarkers : markers;
    return visibleMarkers.map(function(item, index) {
      return Object.assign({}, item, { index: index + 1 });
    });
  }
`;

export function buildAmapHtml(apiKey: string, markers: MapMarkerPayload[], center: { lng: number; lat: number }) {
  const markerJson = JSON.stringify(markers);
  const centerJson = JSON.stringify(center);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; background: #e8f4ff; touch-action: none; }
    .cartoon-marker { display: flex; flex-direction: column; align-items: center; width: 96px; cursor: grab; }
    .marker-bubble {
      width: 46px; height: 46px; border-radius: 18px;
      display: flex; align-items: center; justify-content: center;
      font-size: 24px; box-shadow: 0 8px 18px rgba(40,124,255,0.28);
      border: 3px solid #fff; position: relative;
    }
    .hard_anchor .marker-bubble { background: linear-gradient(135deg, #287cff, #1b63ff); transform: rotate(-4deg); }
    .semi_anchor .marker-bubble { background: linear-gradient(135deg, #17bfd1, #0ea5b7); }
    .soft_task .marker-bubble { background: linear-gradient(135deg, #89b8ff, #5b95ff); animation: float 2.4s ease-in-out infinite; }
    .risk_medium .marker-bubble, .risk_high .marker-bubble {
      background: linear-gradient(135deg, #ff6b6b, #ef4444);
      box-shadow: 0 8px 20px rgba(239,68,68,0.34);
    }
    .risk_medium .marker-stem, .risk_high .marker-stem { background: #ef4444; }
    .marker-stem { width: 4px; height: 12px; background: #287cff; border-radius: 999px; margin-top: -2px; }
    .marker-index {
      position: absolute; top: -8px; left: -8px; min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: 9px; background: #fff; color: #1b63ff; font-size: 10px; font-weight: 900;
      display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    }
    .marker-title {
      margin-top: 4px; padding: 4px 6px; border-radius: 10px; background: rgba(255,255,255,0.94);
      color: #30496f; font-size: 10px; font-weight: 800; text-align: center; line-height: 1.2;
      box-shadow: 0 4px 10px rgba(70,131,201,0.18); max-width: 96px;
    }
    .marker-time { color: #7f93b1; font-size: 9px; font-weight: 800; margin-top: 2px; text-align: center; }
    .badge {
      position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; border-radius: 8px;
      background: #fff; color: #287cff; font-size: 9px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    }
    .risk-badge {
      position: absolute; bottom: -7px; right: -7px; height: 16px; padding: 0 5px; border-radius: 8px;
      background: #fff1f2; color: #e11d48; font-size: 9px; font-weight: 900;
      display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(225,29,72,0.18);
    }
    @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  </style>
  <script src="https://webapi.amap.com/maps?v=2.0&key=${apiKey}"></script>
</head>
<body>
  <div id="map"></div>
  <script>
    ${MAP_BOOT}
    ${MAP_VIEW_HELPERS}
    const markers = ${markerJson};
    const center = ${centerJson};
    const displayMarkers = displayMarkersForCity(markers, center);
    const map = new AMap.Map('map', {
      zoom: 12,
      center: [center.lng, center.lat],
      viewMode: '2D',
      mapStyle: 'amap://styles/normal',
      pinchEnable: true,
      zoomEnable: true,
      dragEnable: true,
      doubleClickZoom: true,
      scrollWheel: true,
      touchZoom: true,
      touchZoomCenter: 1,
      jogEnable: true,
      resizeEnable: true,
    });
    window.__map = map;

    AMap.plugin(['AMap.Scale'], function() {
      map.addControl(new AMap.Scale());
    });

    const markerInstances = [];
    const path = [];

    displayMarkers.forEach(function(item) {
      path.push([item.lng, item.lat]);
      const typeBadge = item.nodeType === 'hard_anchor' ? '<div class="badge">硬</div>' :
        item.nodeType === 'semi_anchor' ? '<div class="badge">半</div>' : '';
      const timeLabel = item.scheduleLabel + (item.duration ? ' · ' + item.duration : '');
      const riskClass = item.riskLevel === 'low' ? '' : ' risk_' + item.riskLevel;
      const riskBadge = item.riskLevel === 'low' ? '' : '<div class="risk-badge">险</div>';
      const html = '<div class="cartoon-marker ' + item.nodeType + riskClass + '">' +
        '<div class="marker-bubble">' + item.icon + '<div class="marker-index">' + item.index + '</div>' + typeBadge + riskBadge + '</div>' +
        '<div class="marker-stem"></div>' +
        '<div class="marker-title">' + item.title + '</div>' +
        '<div class="marker-time">' + timeLabel + '</div>' +
        '</div>';

      const marker = new AMap.Marker({
        position: [item.lng, item.lat],
        content: html,
        offset: new AMap.Pixel(-48, -84),
        zIndex: item.nodeType === 'hard_anchor' ? 120 : 100,
        draggable: item.draggable,
        cursor: item.draggable ? 'move' : 'pointer',
      });

      marker.on('click', function(e) {
        if (e && e.originEvent) e.originEvent.stopPropagation();
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'markerClick',
          id: item.id,
        }));
      });

      if (item.draggable) {
        marker.on('dragend', function() {
          const pos = marker.getPosition();
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'markerDrag',
            id: item.id,
            lng: pos.getLng(),
            lat: pos.getLat(),
          }));
        });
      }

      marker.setMap(map);
      markerInstances.push(marker);
    });
    window.__markerInstances = markerInstances;

    if (path.length > 1) {
      new AMap.Polyline({
        path: path,
        strokeColor: '#89B8FF',
        strokeWeight: 5,
        strokeOpacity: 0.85,
        lineJoin: 'round',
        lineCap: 'round',
        showDir: true,
      }).setMap(map);
      for (let i = 0; i < displayMarkers.length - 1; i += 1) {
        if (displayMarkers[i].riskLevel !== 'low' || displayMarkers[i + 1].riskLevel !== 'low') {
          new AMap.Polyline({
            path: [[displayMarkers[i].lng, displayMarkers[i].lat], [displayMarkers[i + 1].lng, displayMarkers[i + 1].lat]],
            strokeColor: '#EF4444',
            strokeWeight: 7,
            strokeOpacity: 0.92,
            lineJoin: 'round',
            lineCap: 'round',
            showDir: true,
          }).setMap(map);
        }
      }
    }

    window.__fitMapOnce(map, markerInstances);
  </script>
</body>
</html>`;
}

export function buildLeafletHtml(markers: MapMarkerPayload[], center: { lng: number; lat: number }) {
  const markerJson = JSON.stringify(markers);
  const centerJson = JSON.stringify(center);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; touch-action: none; }
    .cartoon-pin { text-align: center; width: 96px; }
    .cartoon-pin .bubble {
      width: 44px; height: 44px; border-radius: 16px; display: flex; align-items: center; justify-content: center;
      font-size: 22px; border: 3px solid #fff; box-shadow: 0 8px 16px rgba(40,124,255,0.25); margin: 0 auto; position: relative;
    }
    .cartoon-pin.risk .bubble { background: #ef4444 !important; box-shadow: 0 8px 18px rgba(239,68,68,0.32); }
    .cartoon-pin .risk-badge {
      position: absolute; bottom: -7px; right: -7px; height: 16px; padding: 0 5px; border-radius: 8px;
      background: #fff1f2; color: #e11d48; font-size: 9px; font-weight: 900;
      display: flex; align-items: center; justify-content: center;
    }
    .cartoon-pin .index {
      position: absolute; top: -8px; left: -8px; min-width: 18px; height: 18px; border-radius: 9px;
      background: #fff; color: #1b63ff; font-size: 10px; font-weight: 900; display: flex; align-items: center; justify-content: center;
    }
    .cartoon-pin .title {
      margin-top: 4px; background: rgba(255,255,255,0.95); padding: 3px 6px; border-radius: 8px;
      font-size: 10px; font-weight: 800; color: #30496f;
    }
    .cartoon-pin .time { margin-top: 2px; font-size: 9px; font-weight: 800; color: #7f93b1; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    ${MAP_BOOT}
    ${MAP_VIEW_HELPERS}
    const markers = ${markerJson};
    const center = ${centerJson};
    const displayMarkers = displayMarkersForCity(markers, center);
    const map = L.map('map', { zoomControl: false, touchZoom: true, scrollWheelZoom: true, doubleClickZoom: true }).setView([center.lat, center.lng], 12);
    window.__map = map;
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}', {
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 18,
      attribution: '© 高德地图'
    }).addTo(map);

    const latlngs = [];
    displayMarkers.forEach(function(item) {
      latlngs.push([item.lat, item.lng]);
      const timeLabel = item.scheduleLabel + (item.duration ? ' · ' + item.duration : '');
      const riskClass = item.riskLevel === 'low' ? '' : ' risk';
      const riskBadge = item.riskLevel === 'low' ? '' : '<div class="risk-badge">险</div>';
      const icon = L.divIcon({
        className: '',
        html: '<div class="cartoon-pin' + riskClass + '"><div class="bubble">' + item.icon + '<div class="index">' + item.index + '</div>' + riskBadge + '</div><div class="title">' + item.title + '</div><div class="time">' + timeLabel + '</div></div>',
        iconSize: [96, 96],
        iconAnchor: [48, 84],
      });
      const marker = L.marker([item.lat, item.lng], { icon, draggable: item.draggable }).addTo(map);
      marker.on('click', function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'markerClick', id: item.id }));
      });
      if (item.draggable) {
        marker.on('dragend', function(e) {
          const pos = e.target.getLatLng();
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'markerDrag', id: item.id, lng: pos.lng, lat: pos.lat,
          }));
        });
      }
    });

    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: '#89B8FF', weight: 5, opacity: 0.85 }).addTo(map);
      for (let i = 0; i < displayMarkers.length - 1; i += 1) {
        if (displayMarkers[i].riskLevel !== 'low' || displayMarkers[i + 1].riskLevel !== 'low') {
          L.polyline(
            [[displayMarkers[i].lat, displayMarkers[i].lng], [displayMarkers[i + 1].lat, displayMarkers[i + 1].lng]],
            { color: '#EF4444', weight: 7, opacity: 0.92 }
          ).addTo(map);
        }
      }
    }
    window.mapApi.fitView = function() {
      if (latlngs.length > 0) map.fitBounds(latlngs, { padding: [40, 40] });
    };
    window.mapApi.zoomIn = function() { map.zoomIn(); };
    window.mapApi.zoomOut = function() { map.zoomOut(); };
    if (latlngs.length > 0 && !window.__didInitialFit) {
      map.fitBounds(latlngs, { padding: [40, 40] });
      window.__didInitialFit = true;
    }
    setTimeout(function() {
      map.invalidateSize();
      if (latlngs.length > 0) map.fitBounds(latlngs, { padding: [40, 40] });
    }, 250);
  </script>
</body>
</html>`;
}

export function buildMapMarkers(
  items: ItineraryItem[],
  city: string,
  startDate?: string | null,
  itemWeather?: Record<string, ItemWeatherInfo>,
): MapMarkerPayload[] {
  return items.map((item, index) => {
    const point = resolveMapPoint(item, index, city);
    const nodeType = resolveNodeType(item);
    const weather = itemWeather?.[item.id];
    const riskLevel =
      item.category === "alert" || weather?.risk_level === "high"
        ? "high"
        : item.risk_flags.length || weather?.risk_level === "medium"
          ? "medium"
          : "low";
    const riskText = [
      ...item.risk_flags,
      ...(weather && weather.risk_level !== "low" ? [weather.advice || weather.label] : []),
    ]
      .filter(Boolean)
      .join("；");
    return {
      id: item.id,
      index: index + 1,
      lng: point.lng,
      lat: point.lat,
      icon: point.icon,
      title: item.title,
      startTime: item.start_time,
      endTime: item.end_time,
      timeRange: formatTimeRange(item.start_time, item.end_time),
      dateLabel: formatItemDateLabel(startDate, item.day),
      scheduleLabel: formatItemSchedule(startDate, item.day, item.start_time, item.end_time),
      duration: formatDurationLabel(item.start_time, item.end_time),
      location: item.location,
      nodeType,
      riskLevel,
      riskText,
      editable: isEditableNode(item),
      draggable: isEditableNode(item),
    };
  });
}
