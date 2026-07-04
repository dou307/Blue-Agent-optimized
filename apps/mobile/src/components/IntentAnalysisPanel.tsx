import { Pressable, StyleSheet, Text, View } from "react-native";

import { IntentAnalysis } from "../types";

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

export function IntentAnalysisPanel({ analysis, travelPreferenceText, loading, onConfirm, onBack }: Props) {
  function valueForElement(key: (typeof elementMeta)[number]["key"]) {
    const values = analysis.five_elements[key];
    if (key !== "preferences") return values;
    return Array.from(new Set([...values, ...(travelPreferenceText ? [travelPreferenceText] : [])]));
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
      {analysis.context.map((item) => (
        <View key={item.key} style={styles.contextRow}>
          <Text style={styles.contextTitle}>{item.title}</Text>
          <Text style={[styles.contextDetail, item.status === "warn" && styles.contextWarn]}>{item.detail}</Text>
        </View>
      ))}

      <View style={styles.actions}>
        <Pressable style={styles.secondaryBtn} onPress={onBack}>
          <Text style={styles.secondaryText}>返回修改</Text>
        </Pressable>
        <Pressable style={styles.primaryBtn} onPress={onConfirm} disabled={loading}>
          <Text style={styles.primaryText}>{loading ? "正在生成方案..." : "进入方案比对  ›"}</Text>
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
  contextTitle: { color: "#233B63", fontSize: 12, fontWeight: "900" },
  contextDetail: { color: "#7085A2", fontSize: 11, lineHeight: 16 },
  contextWarn: { color: "#F97316" },
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
