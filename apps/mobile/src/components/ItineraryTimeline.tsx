import { Fragment } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { ItemWeatherInfo, ItineraryItem } from "../types";
import { formatItemDateLabel, formatItemSchedule } from "../utils/dateUtils";
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

function timeToMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

type DayWeatherSummary = {
  day: number;
  title: string;
  detail: string;
  advice: string;
  hasRisk: boolean;
};

function buildDayWeatherSummary(
  day: number,
  startDate: string | null | undefined,
  weatherItems: ItemWeatherInfo[],
): DayWeatherSummary | null {
  if (!weatherItems.length) return null;
  const primary = weatherItems.find((item) => item.risk_level !== "low") ?? weatherItems[0];
  const riskTags = Array.from(new Set(weatherItems.flatMap((item) => item.risk_tags))).slice(0, 3);
  const labels = Array.from(new Set(weatherItems.map((item) => item.label).filter(Boolean))).slice(0, 2);
  const advice = primary.advice || "天气适宜，按原计划推进。";
  return {
    day,
    title: `${formatItemDateLabel(startDate, day)} 天气提醒`,
    detail: labels.length ? labels.join(" / ") : "天气数据已同步",
    advice: riskTags.length ? `${riskTags.join("、")} · ${advice}` : advice,
    hasRisk: weatherItems.some((item) => item.risk_level !== "low"),
  };
}

function riskTextForItem(item: ItineraryItem, weather?: ItemWeatherInfo) {
  const risks = [
    ...item.risk_flags,
    ...(weather && weather.risk_level !== "low" ? [weather.advice || weather.label] : []),
  ].filter(Boolean);
  if (item.category === "alert" && !risks.length) risks.push(item.description || "行程存在风险提醒");
  return risks.join("；");
}

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
  onNavigate?: (item: ItineraryItem) => void;
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
  onNavigate,
  onRecommendPOI,
}: Props) {
  const displayItems = [...items].sort((left, right) => {
    if (left.day !== right.day) return left.day - right.day;
    return timeToMinutes(left.start_time) - timeToMinutes(right.start_time);
  });
  const weatherByDay = new Map<number, ItemWeatherInfo[]>();
  for (const item of displayItems) {
    const weather = itemWeather?.[item.id];
    if (!weather) continue;
    weatherByDay.set(item.day, [...(weatherByDay.get(item.day) ?? []), weather]);
  }
  const daySummaries = new Map<number, DayWeatherSummary>();
  for (const [day, weatherItems] of weatherByDay) {
    const summary = buildDayWeatherSummary(day, startDate, weatherItems);
    if (summary) daySummaries.set(day, summary);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>行程节点</Text>
      <Text style={styles.hint}>点击编辑详情，餐饮/住宿节点可「选店」对比后定节点。</Text>
      {displayItems.map((item, index) => {
        const visual = nodeVisual[resolveNodeType(item)] ?? nodeVisual.soft_task;
        const weather = itemWeather?.[item.id];
        const riskText = riskTextForItem(item, weather);
        const hasRisk = Boolean(riskText);
        const schedule = formatItemSchedule(startDate, item.day, item.start_time, item.end_time);
        const duration = formatDurationLabel(item.start_time, item.end_time);
        const deleting = deletingItemId === item.id;
        const daySummary =
          index === 0 || displayItems[index - 1]?.day !== item.day ? daySummaries.get(item.day) : null;
        return (
          <Fragment key={item.id}>
            {daySummary ? (
              <View style={[styles.dayWeatherCard, daySummary.hasRisk ? styles.dayWeatherCardWarn : null]}>
                <Text style={[styles.dayWeatherTitle, daySummary.hasRisk ? styles.dayWeatherTitleWarn : null]}>
                  {daySummary.title}
                </Text>
                <Text style={[styles.dayWeatherDetail, daySummary.hasRisk ? styles.dayWeatherDetailWarn : null]} numberOfLines={2}>
                  {daySummary.detail}
                </Text>
                <Text style={[styles.dayWeatherAdvice, daySummary.hasRisk ? styles.dayWeatherAdviceWarn : null]} numberOfLines={2}>
                  {daySummary.advice}
                </Text>
              </View>
            ) : null}
            <View style={[styles.row, { borderColor: visual.border }, hasRisk ? styles.rowRisk : null]}>
              <View style={[styles.dateCol, { backgroundColor: hasRisk ? "#EF4444" : visual.border }]}>
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
                {hasRisk ? (
                  <View style={styles.riskBar}>
                    <Text style={styles.riskLabel}>风险</Text>
                    <Text style={styles.riskText} numberOfLines={2}>{riskText}</Text>
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
                {onNavigate ? (
                  <Pressable
                    style={[styles.actionBtn, styles.navigateBtn, busy || deleting ? styles.actionDisabled : null]}
                    disabled={busy || deleting}
                    onPress={() => onNavigate(item)}
                  >
                    <Text style={styles.navigateText}>↗</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[
                    styles.actionBtn,
                    index === displayItems.length - 1 || busy || deleting ? styles.actionDisabled : null,
                  ]}
                  disabled={index === displayItems.length - 1 || busy || deleting}
                  onPress={() => onMoveDown(item.id)}
                >
                  <Text style={styles.actionText}>↓</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.deleteBtn, busy || deleting ? styles.actionDisabled : null]}
                  disabled={busy || deleting || displayItems.length <= 1}
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
          </Fragment>
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
  rowRisk: {
    backgroundColor: "#FFF7F7",
    borderColor: "#EF4444",
    borderWidth: 2,
    shadowColor: "#EF4444",
    shadowOpacity: 0.12,
    shadowRadius: 8,
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
  riskBar: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#FEE2E2",
    borderLeftWidth: 4,
    borderLeftColor: "#EF4444",
  },
  riskLabel: { color: "#DC2626", fontSize: 10, fontWeight: "900" },
  riskText: { flex: 1, color: "#B91C1C", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  dayWeatherCard: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#F2FFF9",
    borderWidth: 1,
    borderColor: "#C9F2DD",
  },
  dayWeatherCardWarn: { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" },
  dayWeatherTitle: { color: "#1A9D5C", fontSize: 11, fontWeight: "900" },
  dayWeatherTitleWarn: { color: "#F97316" },
  dayWeatherDetail: { marginTop: 3, color: "#2A7751", fontSize: 11, lineHeight: 15, fontWeight: "900" },
  dayWeatherDetailWarn: { color: "#EA580C" },
  dayWeatherAdvice: { marginTop: 2, color: "#4D8B6B", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  dayWeatherAdviceWarn: { color: "#F97316" },
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
  navigateBtn: { backgroundColor: "#EAF4FF" },
  navigateText: { color: "#287CFF", fontSize: 15, fontWeight: "900" },
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
