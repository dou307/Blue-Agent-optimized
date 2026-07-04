import { useMemo, useRef } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";

import { Itinerary, ItineraryItem } from "../types";
import { UpdateNodePayload } from "../services/api";
import { resolveCityCenter } from "../utils/geoCoords";
import { formatItemSchedule } from "../utils/dateUtils";
import { buildAmapHtml, buildLeafletHtml, buildMapMarkers } from "../utils/mapHtml";
import { nodeVisual } from "../utils/nodeUtils";

type Props = {
  itinerary: Itinerary;
  city: string;
  startDate?: string | null;
  onUpdateNode: (itemId: string, payload: UpdateNodePayload) => Promise<void>;
  onEditItem: (item: ItineraryItem) => void;
  onMapInteractionChange?: (active: boolean) => void;
};

const MAP_HEIGHT = 420;

export function MapTopologyBoard({
  itinerary,
  city,
  startDate,
  onUpdateNode,
  onEditItem,
  onMapInteractionChange,
}: Props) {
  const webRef = useRef<WebView>(null);
  const amapKey = process.env.EXPO_PUBLIC_AMAP_WEB_KEY?.trim() ?? "";
  const items = itinerary.items;
  const mapCity = city || itinerary.intent.destination || "北京";

  const html = useMemo(() => {
    const markers = buildMapMarkers(items, mapCity, startDate ?? itinerary.intent.start_date);
    const centerPoint = resolveCityCenter(mapCity);
    const center = { lng: centerPoint.lng, lat: centerPoint.lat };
    if (amapKey) {
      return buildAmapHtml(amapKey, markers, center);
    }
    return buildLeafletHtml(markers, center);
  }, [amapKey, items, mapCity, startDate, itinerary.intent.start_date]);

  const webMapUrl = useMemo(() => {
    const markers = buildMapMarkers(items, mapCity, startDate ?? itinerary.intent.start_date);
    const first = markers[0] ?? { lng: resolveCityCenter(mapCity).lng, lat: resolveCityCenter(mapCity).lat, title: mapCity };
    return `https://uri.amap.com/marker?position=${first.lng},${first.lat}&name=${encodeURIComponent(first.title)}`;
  }, [items, mapCity, startDate, itinerary.intent.start_date]);

  function injectMapCommand(script: string) {
    webRef.current?.injectJavaScript(`${script}; true;`);
  }

  async function handleMessage(event: WebViewMessageEvent) {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as {
        type: string;
        id: string;
        lng?: number;
        lat?: number;
      };

      const item = items.find((entry) => entry.id === payload.id);
      if (!item) return;

      if (payload.type === "markerClick") {
        onEditItem(item);
        return;
      }

      if (payload.type === "markerDrag" && payload.lng != null && payload.lat != null) {
        try {
          await onUpdateNode(payload.id, {
            geo_lng: payload.lng,
            geo_lat: payload.lat,
          });
        } catch (error) {
          Alert.alert("位置更新失败", error instanceof Error ? error.message : "请稍后重试");
        }
      }
    } catch {
      // ignore malformed messages from WebView
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.legendRow}>
        {(Object.keys(nodeVisual) as Array<keyof typeof nodeVisual>).map((kind) => (
          <View key={kind} style={styles.legendItem}>
            <View style={[styles.legendDot, { borderColor: nodeVisual[kind].border, backgroundColor: nodeVisual[kind].fill }]} />
            <Text style={styles.legendText}>{nodeVisual[kind].label}</Text>
          </View>
        ))}
      </View>

      <View
        style={styles.mapShell}
        onTouchStart={() => onMapInteractionChange?.(true)}
        onTouchEnd={() => onMapInteractionChange?.(false)}
        onTouchCancel={() => onMapInteractionChange?.(false)}
      >
        {Platform.OS === "web" ? (
          <iframe
            key={`map-web-${itinerary.id}`}
            title="行程地图"
            srcDoc={html}
            src={webMapUrl}
            style={webIframeStyle}
          />
        ) : (
          <WebView
            ref={webRef}
            key={`map-${itinerary.id}`}
            originWhitelist={["*"]}
            source={{ html }}
            style={styles.map}
            scrollEnabled={false}
            nestedScrollEnabled
            overScrollMode="never"
            bounces={false}
            javaScriptEnabled
            domStorageEnabled
            androidLayerType="hardware"
            allowsInlineMediaPlayback
            onMessage={handleMessage}
            setSupportMultipleWindows={false}
          />
        )}

        <View style={styles.mapBadge}>
          <Text style={styles.mapBadgeText}>{amapKey ? "高德地图" : "OpenStreetMap"}</Text>
        </View>

        {Platform.OS === "web" ? null : (
          <View style={styles.zoomBar}>
            <Pressable style={styles.zoomBtn} onPress={() => injectMapCommand("window.mapApi.zoomIn()")}>
              <Text style={styles.zoomText}>＋</Text>
            </Pressable>
            <Pressable style={styles.zoomBtn} onPress={() => injectMapCommand("window.mapApi.zoomOut()")}>
              <Text style={styles.zoomText}>－</Text>
            </Pressable>
            <Pressable style={styles.zoomBtn} onPress={() => injectMapCommand("window.mapApi.fitView()")}>
              <Text style={styles.fitText}>全览</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {items.map((item, index) => (
          <Pressable key={item.id} style={styles.nodeChip} onPress={() => onEditItem(item)}>
            <Text style={styles.nodeChipIndex}>#{index + 1}</Text>
            <Text style={styles.nodeChipTime}>
              {formatItemSchedule(startDate ?? itinerary.intent.start_date, item.day, item.start_time, item.end_time)}
            </Text>
            <Text style={styles.nodeChipTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.tip}>
        双指缩放地图，拖动卡通地标改位置，点击地标或节点条编辑标题/时间/地点。
      </Text>
    </View>
  );
}

const webIframeStyle = {
  width: "100%",
  height: "100%",
  border: "0",
  display: "block",
} as const;

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  legendText: { color: "#7085A2", fontSize: 10, fontWeight: "900" },
  mapShell: {
    height: MAP_HEIGHT,
    borderRadius: 23,
    overflow: "hidden",
    backgroundColor: "#E8F4FF",
    borderWidth: 1,
    borderColor: "#D7E8FF",
  },
  map: { flex: 1, backgroundColor: "transparent" },
  mapBadge: {
    position: "absolute",
    left: 10,
    top: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  mapBadgeText: { color: "#527099", fontSize: 9, fontWeight: "900" },
  zoomBar: {
    position: "absolute",
    right: 10,
    top: 10,
    gap: 6,
  },
  zoomBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "#D7E8FF",
  },
  zoomText: { color: "#287CFF", fontSize: 18, fontWeight: "900", marginTop: -2 },
  fitText: { color: "#287CFF", fontSize: 10, fontWeight: "900" },
  chipRow: { gap: 8, paddingVertical: 2 },
  nodeChip: {
    width: 112,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "#EEF6FF",
    borderWidth: 1,
    borderColor: "#D7E8FF",
  },
  nodeChipIndex: { color: "#287CFF", fontSize: 9, fontWeight: "900" },
  nodeChipTime: { marginTop: 2, color: "#7F93B1", fontSize: 9, fontWeight: "900" },
  nodeChipTitle: { marginTop: 4, color: "#30496F", fontSize: 11, fontWeight: "900" },
  tip: { color: "#8BA0BD", fontSize: 10, lineHeight: 15 },
});
