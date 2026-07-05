import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { IntentAnalysis } from "../types";
import { readCalendarContext } from "../services/deviceCalendar";

type Props = {
  analysis: IntentAnalysis;
  travelPreferenceText?: string;
  loading: boolean;
  onConfirm: () => void;
  onBack: () => void;
};

const elementMeta = [
  { key: "actions" as const, label: "行动", icon: "🎯" },
  { key: "locations" as const, label: "地点", icon: "📍" },
  { key: "time" as const, label: "时间", icon: "📅" },
  { key: "constraints" as const, label: "约束", icon: "🔒" },
  { key: "preferences" as const, label: "偏好", icon: "⭐" },
];

type CalendarAuthState = "idle" | "authorizing" | "authorized";

function splitPreferenceItems(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const items = value
      .split(/[/、,;；]/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const item of items) {
      const key = item.replace(/\s+/g, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export function IntentAnalysisPanel({ analysis, travelPreferenceText, loading, onConfirm, onBack }: Props) {
  const [calendarAuthState, setCalendarAuthState] = useState<CalendarAuthState>("idle");
  const [calendarDetail, setCalendarDetail] = useState("手机系统日历未授权");

  useEffect(() => {
    setCalendarAuthState("idle");
    setCalendarDetail("手机系统日历未授权");
  }, [analysis.structured.startDate, analysis.structured.endDate]);

  function valueForElement(key: (typeof elementMeta)[number]["key"]) {
    const values = analysis.five_elements[key];
    if (key !== "preferences") return values;
    return splitPreferenceItems([...values, ...(travelPreferenceText ? [travelPreferenceText] : [])]);
  }

  async function handleAuthorizeCalendar() {
    if (calendarAuthState === "authorizing") return;
    setCalendarAuthState("authorizing");
    try {
      const result = await readCalendarContext(analysis.structured.startDate, analysis.structured.endDate);
      if (result.status === "authorized") {
        setCalendarDetail(result.detail);
        setCalendarAuthState("authorized");
        return;
      }
      setCalendarDetail(result.detail || "手机系统日历未授权");
      setCalendarAuthState("idle");
      if (result.status === "permission-denied") {
        Alert.alert("日历未授权", "请在系统权限设置中允许 Expo Go 访问日历。");
      }
    } catch (error) {
      setCalendarAuthState("idle");
      Alert.alert("授权失败", error instanceof Error ? error.message : "手机系统日历读取失败");
    }
  }

  function travelDateLabel() {
    const { startDate, endDate } = analysis.structured;
    if (startDate && endDate) return `${startDate} 至 ${endDate}`;
    return startDate || endDate || "待定";
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>解析确认 · 意图爆发期</Text>
      <Text style={styles.summary}>{analysis.summary}</Text>

      <View style={styles.progressRow}>
        {analysis.progress.map((item) => (
          <View key={item.step} style={styles.progressPill}>
            <Text style={[styles.progressText, item.status === "done" && styles.progressDone]}>
              {item.status === "done" ? "✓ " : "○ "}
              {item.step}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.sectionTitleBox}>
        <Text style={styles.sectionLabel}>五要素识别</Text>
      </View>
      <View style={styles.grid}>
        {elementMeta.map((item) => (
          <View key={item.key} style={styles.card}>
            <View style={styles.cardKey}>
              <Text style={styles.cardIcon}>{item.icon}</Text>
              <Text style={styles.cardLabel}>{item.label}</Text>
            </View>
            <Text style={styles.cardValue} numberOfLines={2}>
              {valueForElement(item.key).join(" / ") || "待补充"}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.sectionTitleBox}>
        <Text style={styles.sectionLabel}>系统上下文</Text>
      </View>
      {analysis.context.map((item) =>
        item.key === "calendar" ? (
          <View key={item.key} style={styles.contextRow}>
            <View style={styles.contextHeader}>
              <Text style={styles.contextTitle}>{item.title}</Text>
              {calendarAuthState !== "authorized" ? (
                <Pressable
                  style={[styles.calendarAuthBtn, calendarAuthState === "authorizing" && styles.calendarAuthBtnBusy]}
                  onPress={handleAuthorizeCalendar}
                  disabled={calendarAuthState === "authorizing"}
                >
                  <Text style={styles.calendarAuthText}>
                    {calendarAuthState === "authorizing" ? "授权中" : "点击授权"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.contextDetail}>
              出行日期：{travelDateLabel()}
              {"\n"}
              <Text style={styles.contextWarn}>{calendarDetail}</Text>
            </Text>
          </View>
        ) : (
          <View key={item.key} style={styles.contextRow}>
            <Text style={styles.contextTitle}>{item.title}</Text>
            <Text style={[styles.contextDetail, item.status === "warn" && styles.contextWarn]}>{item.detail}</Text>
          </View>
        ),
      )}

      <View style={styles.actions}>
        <Pressable style={styles.secondaryBtn} onPress={onBack}>
          <Text style={styles.secondaryText}>返回修改</Text>
        </Pressable>
        <Pressable style={styles.primaryBtn} onPress={onConfirm} disabled={loading}>
          <Text style={styles.primaryText}>{loading ? "正在生成方案..." : "方案生成和比对  ›"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { color: "#233B63", fontSize: 15, fontWeight: "900" },
  summary: { color: "#3A4E70", fontSize: 13, lineHeight: 20, fontWeight: "700" },
  progressRow: { display: "none" },
  progressPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F7FBFF",
  },
  progressText: { color: "#8BA0BD", fontSize: 10, fontWeight: "900" },
  progressDone: { color: "#287CFF" },
  sectionTitleBox: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "#E8F7F3",
    borderWidth: 1,
    borderColor: "#BFE7DC",
  },
  sectionLabel: { color: "#0F766E", fontSize: 16, fontWeight: "900", textAlign: "center" },
  grid: { gap: 8 },
  card: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardKey: { width: 78, flexDirection: "row", alignItems: "center", gap: 7 },
  cardIcon: { fontSize: 15 },
  cardLabel: { color: "#287CFF", fontSize: 12, fontWeight: "900" },
  cardValue: { flex: 1, color: "#7085A2", fontSize: 12, lineHeight: 17, textAlign: "right", fontWeight: "700" },
  contextRow: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    gap: 4,
  },
  contextHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  contextTitle: { color: "#233B63", fontSize: 12, fontWeight: "900" },
  contextDetail: { color: "#7085A2", fontSize: 11, lineHeight: 16 },
  contextWarn: { color: "#F59E5B" },
  calendarAuthBtn: {
    minWidth: 72,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F97316",
  },
  calendarAuthBtnBusy: { opacity: 0.75 },
  calendarAuthText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  secondaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E7F3FF",
  },
  secondaryText: { color: "#287CFF", fontWeight: "900", fontSize: 13 },
  primaryBtn: {
    flex: 1.4,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1B63FF",
  },
  primaryText: { color: "#FFFFFF", fontWeight: "900", fontSize: 13 },
});
