import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { ItemWeatherInfo, ItineraryItem } from "../types";
import { formatItemSchedule } from "../utils/dateUtils";
import { formatDurationLabel } from "../utils/durationUtils";
import { nodeVisual, resolveNodeType } from "../utils/nodeUtils";

const categoryLabel: Record<ItineraryItem["category"], string> = {
  transport: "交通",
  meeting: "会议",
  food: "餐饮",
  sight: "景点",
  hotel: "住宿",
  free: "弹性",
  alert: "提醒",
};

type Props = {
  items: ItineraryItem[];
  startDate?: string | null;
  busy?: boolean;
  deletingItemId?: string | null;
  itemWeather?: Record<string, ItemWeatherInfo>;
  onEdit: (item: ItineraryItem) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onRecommendPOI?: (item: ItineraryItem) => void;
};

export function ItineraryTimeline({
  items,
  startDate,
  busy,
  deletingItemId,
  itemWeather,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDelete,
  onRecommendPOI,
}: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>行程节点</Text>
      <Text style={styles.hint}>点击编辑详情，餐饮/住宿节点可「选店」对比后定节点。</Text>
      {items.map((item, index) => {
        const visual = nodeVisual[resolveNodeType(item)] ?? nodeVisual.soft_task;
        const schedule = formatItemSchedule(startDate, item.day, item.start_time, item.end_time);
        const duration = formatDurationLabel(item.start_time, item.end_time);
        const deleting = deletingItemId === item.id;
        const weather = itemWeather?.[item.id];
        return (
          <View key={item.id} style={[styles.row, { borderColor: visual.border }]}>
            <View style={[styles.dateCol, { backgroundColor: visual.border }]}>
              <Text style={styles.dateIndex}>#{index + 1}</Text>
              <Text style={styles.dateText}>{schedule.split(" ")[0]}</Text>
              <Text style={styles.timeText}>{item.start_time}</Text>
            </View>
            <Pressable style={styles.main} disabled={deleting} onPress={() => onEdit(item)}>
              <View style={styles.header}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.badge}>{categoryLabel[item.category]}</Text>
              </View>
              <Text style={styles.meta}>
                {visual.icon} {visual.label} · {schedule}
                {duration ? ` · ${duration}` : ""}
              </Text>
              <Text style={styles.location}>{item.location}</Text>
              <Text style={styles.description} numberOfLines={2}>
                {item.description}
              </Text>
              {weather ? (
                <View style={[styles.weatherPill, weather.risk_level !== "low" ? styles.weatherPillWarn : null]}>
                  <Text style={[styles.weatherText, weather.risk_level !== "low" ? styles.weatherTextWarn : null]} numberOfLines={2}>
                    天气：{weather.label}
                    {weather.risk_tags.length ? ` · ${weather.risk_tags.join("、")}` : ""}
                    {weather.advice ? ` · ${weather.advice}` : ""}
                  </Text>
                </View>
              ) : null}
              {item.estimated_cost ? (
                <Text style={styles.cost}>预估 ¥{item.estimated_cost}</Text>
              ) : null}
            </Pressable>
            <View style={styles.actions}>
              {(item.category === "food" || item.category === "hotel") && onRecommendPOI ? (
                <Pressable
                  style={[styles.actionBtn, styles.pickBtn, busy ? styles.actionDisabled : null]}
                  disabled={busy || deleting}
                  onPress={() => onRecommendPOI(item)}
                >
                  <Text style={styles.pickText}>选</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.actionBtn, index === 0 || busy || deleting ? styles.actionDisabled : null]}
                disabled={index === 0 || busy || deleting}
                onPress={() => onMoveUp(item.id)}
              >
                <Text style={styles.actionText}>↑</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, index === items.length - 1 || busy || deleting ? styles.actionDisabled : null]}
                disabled={index === items.length - 1 || busy || deleting}
                onPress={() => onMoveDown(item.id)}
              >
                <Text style={styles.actionText}>↓</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.deleteBtn, busy || deleting ? styles.actionDisabled : null]}
                disabled={busy || deleting || items.length <= 1}
                onPress={() => onDelete(item.id)}
              >
                <Text style={[styles.actionText, styles.deleteText]}>删</Text>
              </Pressable>
            </View>
            {deleting ? (
              <View pointerEvents="none" style={[styles.deletingOverlay, webDeletingOverlay]}>
                <Text style={styles.deletingText}>删除中</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { color: "#30496F", fontSize: 13, fontWeight: "900" },
  hint: { color: "#8BA0BD", fontSize: 10, lineHeight: 15, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    padding: 8,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    overflow: "hidden",
    position: "relative",
  },
  dateCol: {
    width: 52,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 2,
  },
  dateIndex: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  dateText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  timeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  main: { flex: 1, paddingVertical: 2 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  itemTitle: { flex: 1, color: "#2A4266", fontSize: 12, fontWeight: "900" },
  badge: {
    color: "#287CFF",
    backgroundColor: "#EEF6FF",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 9,
    fontWeight: "900",
    overflow: "hidden",
  },
  meta: { marginTop: 4, color: "#527099", fontSize: 10, fontWeight: "800" },
  location: { marginTop: 3, color: "#287CFF", fontSize: 10, fontWeight: "800" },
  description: { marginTop: 3, color: "#7085A2", fontSize: 10, lineHeight: 15, fontWeight: "700" },
  weatherPill: {
    marginTop: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 9,
    backgroundColor: "#F2FFF9",
  },
  weatherPillWarn: { backgroundColor: "#FFF7ED" },
  weatherText: { color: "#1A9D5C", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  weatherTextWarn: { color: "#F97316" },
  cost: { marginTop: 4, color: "#1B63FF", fontSize: 10, fontWeight: "900" },
  actions: { gap: 4, justifyContent: "center" },
  actionBtn: {
    width: 30,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF6FF",
  },
  actionDisabled: { opacity: 0.35 },
  actionText: { color: "#287CFF", fontSize: 12, fontWeight: "900" },
  deleteBtn: { backgroundColor: "#FFF1F0" },
  deleteText: { color: "#E55353" },
  pickBtn: { backgroundColor: "#E8FFF3" },
  pickText: { color: "#1A9D5C", fontSize: 11, fontWeight: "900" },
  deletingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 248, 252, 0.82)",
  },
  deletingText: {
    color: "#7A8798",
    fontSize: 24,
    fontWeight: "900",
  },
});

const webDeletingOverlay =
  Platform.OS === "web"
    ? ({
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      } as any)
    : null;
