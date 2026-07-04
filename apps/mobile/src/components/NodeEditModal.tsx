import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ItineraryItem } from "../types";
import { TIME_SLOTS } from "../utils/nodeUtils";

export type NodeEditDraft = {
  id: string;
  title: string;
  start_time: string;
  location: string;
};

type Props = {
  visible: boolean;
  draft: NodeEditDraft | null;
  dateLabel?: string;
  saving?: boolean;
  onChange: (draft: NodeEditDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onNavigate?: () => void;
};

export function NodeEditModal({
  visible,
  draft,
  dateLabel,
  saving,
  onChange,
  onClose,
  onSave,
  onDelete,
  onNavigate,
}: Props) {
  if (!draft) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>编辑节点</Text>
            {onNavigate ? (
              <Pressable style={styles.navigateBtn} onPress={onNavigate}>
                <Text style={styles.navigateText}>导航到这里去</Text>
              </Pressable>
            ) : null}
          </View>
          {dateLabel ? <Text style={styles.dateBadge}>{dateLabel}</Text> : null}
          <Text style={styles.label}>标题</Text>
          <TextInput
            style={styles.input}
            value={draft.title}
            onChangeText={(value) => onChange({ ...draft, title: value })}
          />
          <Text style={styles.label}>开始时间</Text>
          <TextInput
            style={styles.input}
            value={draft.start_time}
            onChangeText={(value) => onChange({ ...draft, start_time: value })}
            placeholder="例如 09:30"
          />
          <View style={styles.slotRow}>
            {TIME_SLOTS.map((slot) => (
              <Pressable
                key={slot}
                style={[styles.slotChip, draft.start_time === slot ? styles.slotChipActive : null]}
                onPress={() => onChange({ ...draft, start_time: slot })}
              >
                <Text style={[styles.slotText, draft.start_time === slot ? styles.slotTextActive : null]}>{slot}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>地点</Text>
          <TextInput
            style={styles.input}
            value={draft.location}
            onChangeText={(value) => onChange({ ...draft, location: value })}
          />
          <Text style={styles.hint}>保存后 Agent 将联动调整相关节点的时间与安排。</Text>
          <View style={styles.actions}>
            {onDelete ? (
              <Pressable style={styles.delete} onPress={onDelete} disabled={saving}>
                <Text style={styles.deleteText}>删除</Text>
              </Pressable>
            ) : null}
            <View style={styles.actionRight}>
              <Pressable style={styles.cancel} onPress={onClose}>
                <Text style={styles.cancelText}>取消</Text>
              </Pressable>
              <Pressable style={[styles.save, saving ? styles.saveDisabled : null]} disabled={saving} onPress={onSave}>
                <Text style={styles.saveText}>{saving ? "保存中…" : "保存"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function draftFromItem(item: ItineraryItem): NodeEditDraft {
  return {
    id: item.id,
    title: item.title,
    start_time: item.start_time,
    location: item.location,
  };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(35,59,99,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#FFFFFF",
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 },
  title: { flex: 1, color: "#233B63", fontSize: 16, fontWeight: "900" },
  navigateBtn: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF4FF",
  },
  navigateText: { color: "#287CFF", fontSize: 11, fontWeight: "900" },
  dateBadge: {
    alignSelf: "flex-start",
    marginBottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#EEF6FF",
    color: "#287CFF",
    fontSize: 10,
    fontWeight: "900",
  },
  label: { color: "#7085A2", fontSize: 10, fontWeight: "900", marginTop: 8, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#D7E8FF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#30496F",
    fontSize: 13,
    fontWeight: "700",
    backgroundColor: "#FAFDFF",
  },
  slotRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  slotChip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#EEF6FF",
  },
  slotChipActive: { backgroundColor: "#287CFF" },
  slotText: { color: "#527099", fontSize: 9, fontWeight: "900" },
  slotTextActive: { color: "#FFFFFF" },
  hint: { marginTop: 10, color: "#8BA0BD", fontSize: 10, lineHeight: 15 },
  actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16 },
  actionRight: { flexDirection: "row", gap: 10 },
  delete: {
    minWidth: 56,
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1F0",
  },
  deleteText: { color: "#E55353", fontSize: 13, fontWeight: "900" },
  cancel: {
    minWidth: 72,
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF6FF",
  },
  cancelText: { color: "#527099", fontSize: 13, fontWeight: "900" },
  save: {
    minWidth: 88,
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1B63FF",
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
});
