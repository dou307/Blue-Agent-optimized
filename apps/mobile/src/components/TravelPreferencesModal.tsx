import { useEffect, useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  ACCOMMODATION_OPTIONS,
  COMPANION_OPTIONS,
  defaultTravelPreferences,
  NOTES_MAX_LENGTH,
  PACE_OPTIONS,
  SCHEDULE_OPTIONS,
  STYLE_OPTIONS,
  TravelPreferences,
} from "../utils/travelPreferences";

type Props = {
  visible: boolean;
  value: TravelPreferences;
  onClose: () => void;
  onComplete: (value: TravelPreferences) => void;
};

export function TravelPreferencesModal({ visible, value, onClose, onComplete }: Props) {
  const [draft, setDraft] = useState<TravelPreferences>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  function selectSingle<K extends "companions" | "pace" | "accommodation">(key: K, id: string) {
    setDraft((current) => ({ ...current, [key]: id }));
  }

  function toggleMulti(key: "styles" | "schedules", id: string) {
    setDraft((current) => {
      const list = current[key];
      return {
        ...current,
        [key]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id],
      };
    });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={onClose}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text style={styles.title}>选择你的出行偏好</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <PreferenceSection title="同行伙伴">
            <ChipRow
              options={COMPANION_OPTIONS}
              selected={[draft.companions]}
              onPress={(id) => selectSingle("companions", id)}
            />
          </PreferenceSection>

          <PreferenceSection title="风格偏好">
            <ChipRow
              options={STYLE_OPTIONS}
              selected={draft.styles}
              onPress={(id) => toggleMulti("styles", id)}
            />
          </PreferenceSection>

          <PreferenceSection title="行程节奏">
            <ChipRow
              options={PACE_OPTIONS}
              selected={[draft.pace]}
              onPress={(id) => selectSingle("pace", id)}
            />
          </PreferenceSection>

          <PreferenceSection title="住宿偏好">
            <ChipRow
              options={ACCOMMODATION_OPTIONS}
              selected={[draft.accommodation]}
              onPress={(id) => selectSingle("accommodation", id)}
            />
          </PreferenceSection>

          <PreferenceSection title="时间安排">
            <ChipRow
              options={SCHEDULE_OPTIONS}
              selected={draft.schedules}
              onPress={(id) => toggleMulti("schedules", id)}
            />
          </PreferenceSection>

          <PreferenceSection title="其他">
            <View style={styles.notesBox}>
              <TextInput
                style={styles.notesInput}
                value={draft.notes}
                onChangeText={(text) =>
                  setDraft((current) => ({
                    ...current,
                    notes: text.slice(0, NOTES_MAX_LENGTH),
                  }))
                }
                placeholder="在这里输入更多偏好信息"
                placeholderTextColor="#B8C5D8"
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.notesCount}>
                {draft.notes.length}/{NOTES_MAX_LENGTH}
              </Text>
            </View>
          </PreferenceSection>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={styles.completeBtn}
            onPress={() => {
              onComplete(draft);
              onClose();
            }}
          >
            <Text style={styles.completeText}>完成</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function TravelPreferencesInline({
  value,
  onChange,
}: {
  value: TravelPreferences;
  onChange: (value: TravelPreferences) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  function selectSingle<K extends "companions" | "pace" | "accommodation">(key: K, id: string) {
    onChange({ ...value, [key]: id });
  }

  function toggleMulti(key: "styles" | "schedules", id: string) {
    const list = value[key];
    onChange({
      ...value,
      [key]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id],
    });
  }

  function selectedLabels(options: { id: string; label: string }[], selected: string[]) {
    const labels = selected.map((id) => options.find((item) => item.id === id)?.label).filter(Boolean);
    return labels.length ? labels.join(" / ") : "未选择";
  }

  function toggleSection(key: string) {
    setExpandedKey((current) => (current === key ? null : key));
  }

  return (
    <View style={inlineStyles.card}>
      <View style={inlineStyles.titleBox}>
        <Text style={inlineStyles.title}>出行偏好</Text>
      </View>
      <CollapsiblePreferenceSection
        title="同行伙伴"
        summary={selectedLabels(COMPANION_OPTIONS, [value.companions])}
        expanded={expandedKey === "companions"}
        onToggle={() => toggleSection("companions")}
      >
        <ChipRow
          options={COMPANION_OPTIONS}
          selected={[value.companions]}
          onPress={(id) => selectSingle("companions", id)}
        />
      </CollapsiblePreferenceSection>

      <CollapsiblePreferenceSection
        title="风格偏好"
        summary={selectedLabels(STYLE_OPTIONS, value.styles)}
        expanded={expandedKey === "styles"}
        onToggle={() => toggleSection("styles")}
      >
        <ChipRow
          options={STYLE_OPTIONS}
          selected={value.styles}
          onPress={(id) => toggleMulti("styles", id)}
        />
      </CollapsiblePreferenceSection>

      <CollapsiblePreferenceSection
        title="行程节奏"
        summary={selectedLabels(PACE_OPTIONS, [value.pace])}
        expanded={expandedKey === "pace"}
        onToggle={() => toggleSection("pace")}
      >
        <ChipRow
          options={PACE_OPTIONS}
          selected={[value.pace]}
          onPress={(id) => selectSingle("pace", id)}
        />
      </CollapsiblePreferenceSection>

      <CollapsiblePreferenceSection
        title="住宿偏好"
        summary={selectedLabels(ACCOMMODATION_OPTIONS, [value.accommodation])}
        expanded={expandedKey === "accommodation"}
        onToggle={() => toggleSection("accommodation")}
      >
        <ChipRow
          options={ACCOMMODATION_OPTIONS}
          selected={[value.accommodation]}
          onPress={(id) => selectSingle("accommodation", id)}
        />
      </CollapsiblePreferenceSection>

      <CollapsiblePreferenceSection
        title="时间安排"
        summary={selectedLabels(SCHEDULE_OPTIONS, value.schedules)}
        expanded={expandedKey === "schedules"}
        onToggle={() => toggleSection("schedules")}
      >
        <ChipRow
          options={SCHEDULE_OPTIONS}
          selected={value.schedules}
          onPress={(id) => toggleMulti("schedules", id)}
        />
      </CollapsiblePreferenceSection>

      <CollapsiblePreferenceSection
        title="其他"
        summary={value.notes.trim() || "未填写"}
        expanded={expandedKey === "notes"}
        onToggle={() => toggleSection("notes")}
      >
        <View style={styles.notesBox}>
          <TextInput
            style={styles.notesInput}
            value={value.notes}
            onChangeText={(text) =>
              onChange({
                ...value,
                notes: text.slice(0, NOTES_MAX_LENGTH),
              })
            }
            placeholder="在这里输入更多偏好信息"
            placeholderTextColor="#B8C5D8"
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.notesCount}>
            {value.notes.length}/{NOTES_MAX_LENGTH}
          </Text>
        </View>
      </CollapsiblePreferenceSection>
    </View>
  );
}

function CollapsiblePreferenceSection({
  title,
  summary,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View style={inlineStyles.section}>
      <Pressable style={inlineStyles.sectionHead} onPress={onToggle}>
        <View style={inlineStyles.sectionText}>
          <Text style={inlineStyles.sectionTitle}>{title}</Text>
          <Text style={inlineStyles.sectionSummary} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <Text style={inlineStyles.chevron}>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>
      {expanded ? <View style={inlineStyles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function PreferenceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChipRow({
  options,
  selected,
  onPress,
}: {
  options: { id: string; label: string; icon?: string }[];
  selected: string[];
  onPress: (id: string) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const active = selected.includes(option.id);
        return (
          <Pressable
            key={option.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onPress(option.id)}
          >
            {option.icon ? <Text style={styles.chipIcon}>{option.icon}</Text> : null}
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TravelPreferencesEntry({
  value,
  onPress,
}: {
  value: TravelPreferences;
  onPress: () => void;
}) {
  const summary = [
    COMPANION_OPTIONS.find((item) => item.id === value.companions)?.label,
    PACE_OPTIONS.find((item) => item.id === value.pace)?.label,
    ...value.styles.slice(0, 2).map((id) => STYLE_OPTIONS.find((item) => item.id === id)?.label),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable style={entryStyles.card} onPress={onPress}>
      <View style={entryStyles.head}>
        <Text style={entryStyles.label}>出行偏好</Text>
        <Text style={entryStyles.action}>编辑 ›</Text>
      </View>
      <Text style={entryStyles.summary} numberOfLines={2}>
        {summary || "点击设置同行、风格、节奏与住宿偏好"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F4F8FF" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E8EEF8",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F7FF",
  },
  backText: { color: "#4C84FF", fontSize: 28, marginTop: -4 },
  title: { flex: 1, textAlign: "center", color: "#1E3358", fontSize: 17, fontWeight: "900" },
  headerSpacer: { width: 36 },
  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 24, gap: 18 },
  section: { gap: 10 },
  sectionTitle: { color: "#30496F", fontSize: 15, fontWeight: "900" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E3F2",
  },
  chipActive: {
    backgroundColor: "#EEF4FF",
    borderColor: "#4C84FF",
  },
  chipIcon: { fontSize: 14 },
  chipText: { color: "#5B7396", fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: "#287CFF", fontWeight: "900" },
  notesBox: {
    minHeight: 120,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E3F2",
    padding: 12,
  },
  notesInput: {
    minHeight: 88,
    color: "#30496F",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  notesCount: {
    marginTop: 6,
    textAlign: "right",
    color: "#A8B8CE",
    fontSize: 11,
    fontWeight: "700",
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E8EEF8",
  },
  completeBtn: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#287CFF",
  },
  completeText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
});

const inlineStyles = StyleSheet.create({
  card: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.92)",
    gap: 8,
  },
  titleBox: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "#E8F7F3",
    borderWidth: 1,
    borderColor: "#BFE7DC",
  },
  title: { color: "#0F766E", fontSize: 16, fontWeight: "900", textAlign: "center" },
  section: {
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4ECF8",
    overflow: "hidden",
  },
  sectionHead: {
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionText: { flex: 1, minWidth: 0 },
  sectionTitle: { color: "#30496F", fontSize: 12, fontWeight: "900" },
  sectionSummary: { marginTop: 2, color: "#7085A2", fontSize: 11, fontWeight: "700" },
  chevron: { width: 20, textAlign: "center", color: "#287CFF", fontSize: 16, fontWeight: "900" },
  sectionBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
});

const entryStyles = StyleSheet.create({
  card: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E6FF",
    gap: 6,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: "#30496F", fontSize: 13, fontWeight: "900" },
  action: { color: "#287CFF", fontSize: 12, fontWeight: "800" },
  summary: { color: "#7085A2", fontSize: 11, lineHeight: 16, fontWeight: "700" },
});
