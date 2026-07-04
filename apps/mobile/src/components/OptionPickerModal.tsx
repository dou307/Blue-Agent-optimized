import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { POICandidate } from "../types";

const platformLabel: Record<string, string> = {
  amap: "高德",
  dianping: "大众点评",
  meituan: "美团",
  xiaohongshu: "小红书",
  ctrip: "携程",
};

type Props = {
  visible: boolean;
  title: string;
  summary?: string;
  recommendation?: string;
  candidates: POICandidate[];
  loading?: boolean;
  loadingText?: string;
  onClose: () => void;
  onConfirm: (candidate: POICandidate) => void;
};

export function OptionPickerModal({
  visible,
  title,
  summary,
  recommendation,
  candidates,
  loading,
  loadingText,
  onClose,
  onConfirm,
}: Props) {
  const showLoadingState = Boolean(loading && loadingText && !candidates.length);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {showLoadingState ? (
            <View style={styles.loadingState}>
              <Text style={styles.loadingText}>{loadingText}</Text>
            </View>
          ) : (
            <>
              {summary ? <Text style={styles.summary}>{summary}</Text> : null}
              {recommendation ? <Text style={styles.recommendation}>{recommendation}</Text> : null}
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {candidates.map((candidate, index) => (
                  <View key={candidate.id} style={styles.item}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.rank}>#{index + 1}</Text>
                      <View style={styles.itemMain}>
                        <Text style={styles.itemTitle}>{candidate.name}</Text>
                        <Text style={styles.itemMeta}>
                          {candidate.price_label}
                          {candidate.rating ? ` · 评分 ${candidate.rating}` : ""}
                          {candidate.distance_km != null ? ` · ${candidate.distance_km}km` : ""}
                        </Text>
                        <Text style={styles.itemAddress}>{candidate.address}</Text>
                        {candidate.reason ? <Text style={styles.reason}>{candidate.reason}</Text> : null}
                      </View>
                    </View>
                    {Object.keys(candidate.platform_scores).length ? (
                      <View style={styles.scoreRow}>
                        {Object.entries(candidate.platform_scores).map(([key, score]) => (
                          <Text key={key} style={styles.scoreChip}>
                            {platformLabel[key] ?? key} {score}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.linkRow}>
                      {Object.entries(candidate.deeplinks).map(([key, url]) => (
                        <Pressable
                          key={key}
                          style={styles.linkBtn}
                          onPress={() => {
                            if (url) Linking.openURL(url).catch(() => undefined);
                          }}
                        >
                          <Text style={styles.linkText}>{platformLabel[key] ?? key}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Pressable
                      style={[styles.confirmBtn, loading ? styles.confirmDisabled : null]}
                      disabled={loading}
                      onPress={() => onConfirm(candidate)}
                    >
                      <Text style={styles.confirmText}>{loading ? "确认中…" : "选这家并定节点"}</Text>
                    </Pressable>
                  </View>
                ))}
                {!candidates.length && !loading ? (
                  <Text style={styles.empty}>暂无候选，请调整关键词后重试。</Text>
                ) : null}
              </ScrollView>
            </>
          )}
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(16, 32, 64, 0.45)",
    justifyContent: "flex-end",
  },
  card: {
    maxHeight: "88%",
    backgroundColor: "#F7FAFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    gap: 8,
  },
  title: { color: "#183B72", fontSize: 18, fontWeight: "900" },
  summary: { color: "#5B7396", fontSize: 12, lineHeight: 18 },
  recommendation: { color: "#1B63FF", fontSize: 12, lineHeight: 18, fontWeight: "700" },
  loadingState: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: { color: "#5B7396", fontSize: 18, lineHeight: 26, fontWeight: "900" },
  list: { maxHeight: 480 },
  listContent: { gap: 10, paddingBottom: 8 },
  item: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#D8E6FF",
    gap: 8,
  },
  itemHeader: { flexDirection: "row", gap: 8 },
  rank: { color: "#1B63FF", fontSize: 14, fontWeight: "900", width: 28 },
  itemMain: { flex: 1, gap: 2 },
  itemTitle: { color: "#183B72", fontSize: 15, fontWeight: "900" },
  itemMeta: { color: "#5B7396", fontSize: 11 },
  itemAddress: { color: "#8BA0BD", fontSize: 11 },
  reason: { color: "#30496F", fontSize: 11, lineHeight: 16, marginTop: 4 },
  scoreRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  scoreChip: {
    backgroundColor: "#EEF4FF",
    color: "#1B63FF",
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  linkRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  linkBtn: {
    borderWidth: 1,
    borderColor: "#C9DBFF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  linkText: { color: "#1B63FF", fontSize: 10, fontWeight: "700" },
  confirmBtn: {
    backgroundColor: "#1B63FF",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  confirmDisabled: { opacity: 0.6 },
  confirmText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  empty: { color: "#8BA0BD", textAlign: "center", paddingVertical: 24 },
  closeBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  closeText: { color: "#5B7396", fontSize: 13, fontWeight: "700" },
});
