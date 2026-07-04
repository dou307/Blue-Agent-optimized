import * as Calendar from "expo-calendar";
import { Platform } from "react-native";

import { Itinerary, ItineraryItem } from "../types";

const CALENDAR_TITLE = "蓝V出行";
const EVENT_TAG_PREFIX = "Blue-Agent-Itinerary";

export type CalendarSyncOutcome = {
  status: "synced" | "unsupported" | "permission-denied" | "skipped" | "failed";
  syncedCount: number;
  detail: string;
  eventIds: string[];
};

function parseDateTime(startDate: string, day: number, time: string) {
  const [year, month, date] = startDate.split("-").map((value) => Number.parseInt(value, 10));
  const [hour, minute] = time.split(":").map((value) => Number.parseInt(value, 10));
  if ([year, month, date, hour, minute].some((value) => Number.isNaN(value))) return null;
  const result = new Date(year, month - 1, date + Math.max(0, day - 1), hour, minute, 0, 0);
  return Number.isNaN(result.getTime()) ? null : result;
}

function eventDates(item: ItineraryItem, startDate: string) {
  const start = parseDateTime(startDate, item.day, item.start_time);
  const end = parseDateTime(startDate, item.day, item.end_time);
  if (!start || !end) return null;
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}

function syncTag(itineraryId: string) {
  return `${EVENT_TAG_PREFIX}:${itineraryId}`;
}

function notesForItem(itinerary: Itinerary, item: ItineraryItem) {
  const lines = [
    syncTag(itinerary.id),
    item.description,
    item.risk_flags.length ? `提醒：${item.risk_flags.join("、")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

async function ensureWritableCalendar() {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing = calendars.find((item) => item.title === CALENDAR_TITLE && item.allowsModifications);
  if (existing) return existing.id;

  const writable = calendars.find((item) => item.isPrimary && item.allowsModifications) ??
    calendars.find((item) => item.allowsModifications);

  if (Platform.OS === "ios") {
    const defaultCalendar = writable ?? (await Calendar.getDefaultCalendarAsync());
    return Calendar.createCalendarAsync({
      title: CALENDAR_TITLE,
      color: "#287CFF",
      entityType: Calendar.EntityTypes.EVENT,
      sourceId: defaultCalendar.sourceId,
      source: defaultCalendar.source,
      name: CALENDAR_TITLE,
      ownerAccount: defaultCalendar.ownerAccount,
    });
  }

  return Calendar.createCalendarAsync({
    title: CALENDAR_TITLE,
    color: "#287CFF",
    entityType: Calendar.EntityTypes.EVENT,
    name: CALENDAR_TITLE,
    ownerAccount: CALENDAR_TITLE,
    source: {
      name: CALENDAR_TITLE,
      type: Calendar.SourceType.LOCAL,
      isLocalAccount: true,
    },
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
}

async function deleteExistingSyncedEvents(calendarId: string, itinerary: Itinerary, startDate: string) {
  const datedItems = itinerary.items
    .map((item) => eventDates(item, startDate))
    .filter((value): value is { start: Date; end: Date } => Boolean(value));
  if (!datedItems.length) return;

  const start = new Date(Math.min(...datedItems.map((item) => item.start.getTime())));
  const end = new Date(Math.max(...datedItems.map((item) => item.end.getTime())));
  start.setDate(start.getDate() - 1);
  end.setDate(end.getDate() + 1);

  const events = await Calendar.getEventsAsync([calendarId], start, end);
  const tag = syncTag(itinerary.id);
  await Promise.all(
    events
      .filter((event) => event.notes?.includes(tag))
      .map((event) => Calendar.deleteEventAsync(event.id).catch(() => undefined)),
  );
}

export async function syncItineraryToDeviceCalendar(itinerary: Itinerary): Promise<CalendarSyncOutcome> {
  if (Platform.OS === "web") {
    return {
      status: "unsupported",
      syncedCount: 0,
      detail: "网页端不支持写入手机系统日历，请在真机 App 中同步。",
      eventIds: [],
    };
  }

  const startDate = itinerary.intent.start_date;
  if (!startDate) {
    return {
      status: "skipped",
      syncedCount: 0,
      detail: "行程缺少开始日期，暂不能写入系统日历。",
      eventIds: [],
    };
  }

  const permission = await Calendar.requestCalendarPermissionsAsync();
  if (permission.status !== "granted") {
    return {
      status: "permission-denied",
      syncedCount: 0,
      detail: "未获得系统日历权限，未写入事件。",
      eventIds: [],
    };
  }

  try {
    const calendarId = await ensureWritableCalendar();
    await deleteExistingSyncedEvents(calendarId, itinerary, startDate);

    const eventIds: string[] = [];
    const syncableItems = itinerary.items.filter((item) => item.category !== "alert");
    for (const item of syncableItems) {
      const dates = eventDates(item, startDate);
      if (!dates) continue;
      const eventId = await Calendar.createEventAsync(calendarId, {
        title: item.title,
        location: item.location,
        notes: notesForItem(itinerary, item),
        startDate: dates.start,
        endDate: dates.end,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        alarms: [{ relativeOffset: -30, method: Calendar.AlarmMethod.ALERT }],
      });
      eventIds.push(eventId);
    }

    return {
      status: "synced",
      syncedCount: eventIds.length,
      detail: `已写入手机系统日历 ${eventIds.length} 个行程事件`,
      eventIds,
    };
  } catch (error) {
    return {
      status: "failed",
      syncedCount: 0,
      detail: error instanceof Error ? error.message : "系统日历写入失败",
      eventIds: [],
    };
  }
}
