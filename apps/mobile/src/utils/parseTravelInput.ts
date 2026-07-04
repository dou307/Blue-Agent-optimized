import type { TravelPreferences } from "./travelPreferences";
import { serializeTravelPreferences } from "./travelPreferences";

export type StructuredFields = {
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  preferences: string;
};

export type ParsedTravelHints = {
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  preferences?: string;
  tags: string[];
  vehicles: string[];
};

const CITIES = ["北京", "上海", "广州", "深圳", "成都", "杭州", "西安", "南京", "重庆", "苏州", "云南", "故宫"];
const WEEKDAY_MAP: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
const CN_NUMBER_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDaysIso(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function parseChineseNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  if (CN_NUMBER_MAP[value] != null) return CN_NUMBER_MAP[value];
  if (value.startsWith("十")) return 10 + (CN_NUMBER_MAP[value[1]] ?? 0);
  if (value.endsWith("十")) return (CN_NUMBER_MAP[value[0]] ?? 1) * 10;
  const match = value.match(/^([一二两三四五六七八九])十([一二三四五六七八九])$/);
  if (match) return (CN_NUMBER_MAP[match[1]] ?? 0) * 10 + (CN_NUMBER_MAP[match[2]] ?? 0);
  return undefined;
}

function makeMonthDayDate(month: number, day: number, reference: Date) {
  let year = reference.getFullYear();
  const candidate = new Date(year, month - 1, day);
  if (candidate < reference) year += 1;
  return new Date(year, month - 1, day);
}

export function resolveRelativeStartDate(text: string, reference = new Date()) {
  const range = resolveDateRange(text, reference);
  if (range.startDate) return range.startDate;
  const date = resolveDateExpression(text, reference);
  return date ? toIsoDate(date) : undefined;
}

function resolveDateExpression(text: string, reference = new Date(), anchor?: Date) {
  const ref = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const base = anchor ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()) : ref;

  if (/大后天/.test(text)) {
    ref.setDate(ref.getDate() + 3);
    return ref;
  }
  if (/后天/.test(text)) {
    ref.setDate(ref.getDate() + 2);
    return ref;
  }
  if (/明天/.test(text)) {
    ref.setDate(ref.getDate() + 1);
    return ref;
  }
  if (/今天|今日/.test(text)) {
    return ref;
  }

  if (/下下周末/.test(text)) {
    return resolveWeekday(ref, "六", "afterNext");
  }
  if (/下周末/.test(text)) {
    return resolveWeekday(ref, "六", "next");
  }
  if (/(?:这|本)周末/.test(text)) {
    return resolveWeekday(ref, "六", "this");
  }
  if (/周末/.test(text)) {
    return resolveWeekday(ref, "六", "upcoming");
  }

  const afterNextWeekMatch = text.match(/下下周([一二三四五六日天])/);
  if (afterNextWeekMatch) {
    return resolveWeekday(ref, afterNextWeekMatch[1], "afterNext");
  }

  const nextWeekMatch = text.match(/(?:下周|下个周|下星期|下礼拜)([一二三四五六日天])/);
  if (nextWeekMatch) {
    return resolveWeekday(ref, nextWeekMatch[1], "next");
  }

  const thisWeekMatch = text.match(/(?:这|本)周([一二三四五六日天])|(?:这|本)(?:星期|礼拜)([一二三四五六日天])/);
  if (thisWeekMatch) {
    return resolveWeekday(ref, thisWeekMatch[1] || thisWeekMatch[2], "this");
  }

  const weekdayMatch = text.match(/(?:周|星期|礼拜)([一二三四五六日天])/);
  if (weekdayMatch) {
    const date = resolveWeekday(base, weekdayMatch[1], "upcoming");
    if (anchor && date < anchor) date.setDate(date.getDate() + 7);
    return date;
  }

  const isoMatch = text.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  const mdMatch = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (mdMatch) {
    return makeMonthDayDate(Number(mdMatch[1]), Number(mdMatch[2]), ref);
  }

  const slashMonthDayMatch = text.match(/(?:^|[^\d])(\d{1,2})[./-](\d{1,2})(?:$|[^\d])/);
  if (slashMonthDayMatch) {
    return makeMonthDayDate(Number(slashMonthDayMatch[1]), Number(slashMonthDayMatch[2]), ref);
  }

  return undefined;
}

export function nextFridayIso() {
  const date = new Date();
  const offset = (5 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + offset);
  return toIsoDate(date);
}

function resolveWeekday(reference: Date, token: string, mode: "this" | "next" | "afterNext" | "upcoming") {
  const weekday = WEEKDAY_MAP[token] ?? 5;
  if (mode === "next" || mode === "afterNext") {
    const daysToNextMonday = ((1 - reference.getDay() + 7) % 7) || 7;
    const date = new Date(reference);
    date.setDate(date.getDate() + daysToNextMonday + (mode === "afterNext" ? 7 : 0));
    const offsetFromMonday = weekday === 0 ? 6 : weekday - 1;
    date.setDate(date.getDate() + offsetFromMonday);
    return date;
  }

  const date = new Date(reference);
  let delta = (weekday - date.getDay() + 7) % 7;
  if (mode === "upcoming" && delta === 0) delta = 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function resolveDurationDays(text: string) {
  const durationMatch = text.match(/(\d+|[一二两三四五六七八九十]{1,3})\s*[天日]/);
  if (durationMatch) return parseChineseNumber(durationMatch[1]);
  const nightsMatch = text.match(/(\d+|[一二两三四五六七八九十]{1,3})\s*晚/);
  const nights = nightsMatch ? parseChineseNumber(nightsMatch[1]) : undefined;
  return nights ? nights + 1 : undefined;
}

function resolveDateRange(text: string, reference = new Date()) {
  const dateExpr = "(?:\\d{4}[年/-]\\d{1,2}[月/-]\\d{1,2}|\\d{1,2}月\\d{1,2}日|\\d{1,2}[./-]\\d{1,2}|下下周末|下周末|这周末|本周末|周末|下下周[一二三四五六日天]|(?:下周|下个周|下星期|下礼拜)[一二三四五六日天]|(?:这|本)周[一二三四五六日天]|(?:这|本)(?:星期|礼拜)[一二三四五六日天]|(?:周|星期|礼拜)[一二三四五六日天]|大后天|后天|明天|今天|今日)";
  const rangeMatch = text.match(new RegExp(`(${dateExpr})\\s*(?:到|至|~|－|-|—)\\s*(${dateExpr})`));
  if (rangeMatch) {
    const start = resolveDateExpression(rangeMatch[1], reference);
    const end = start ? resolveDateExpression(rangeMatch[2], reference, start) : undefined;
    return {
      startDate: start ? toIsoDate(start) : undefined,
      endDate: end ? toIsoDate(end) : undefined,
    };
  }

  if (/下下周末/.test(text)) {
    const start = resolveWeekday(reference, "六", "afterNext");
    return { startDate: toIsoDate(start), endDate: toIsoDate(addDateDays(start, 1)) };
  }
  if (/下周末/.test(text)) {
    const start = resolveWeekday(reference, "六", "next");
    return { startDate: toIsoDate(start), endDate: toIsoDate(addDateDays(start, 1)) };
  }
  if (/(?:这|本)周末/.test(text)) {
    const start = resolveWeekday(reference, "六", "this");
    return { startDate: toIsoDate(start), endDate: toIsoDate(addDateDays(start, 1)) };
  }
  if (/周末/.test(text)) {
    const start = resolveWeekday(reference, "六", "upcoming");
    return { startDate: toIsoDate(start), endDate: toIsoDate(addDateDays(start, 1)) };
  }

  return {};
}

function addDateDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatDisplayDate(iso: string) {
  if (!iso) return "选择日期";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const week = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 周${week}`;
}

export function parseTravelFromText(text: string): ParsedTravelHints {
  const tags: string[] = [];
  const vehicles: string[] = [];

  if (/出差|商务/.test(text)) tags.push("出差");
  if (/旅游|游玩/.test(text)) tags.push("旅游");
  if (/周末/.test(text)) tags.push("周末游");
  if (/飞机|航班|坐飞机/.test(text)) vehicles.push("飞机");
  if (/高铁|火车/.test(text)) vehicles.push("高铁");
  if (/打车|出租/.test(text)) vehicles.push("打车");
  if (/少走路|轻松|不要太累/.test(text)) tags.push("少走路");

  const prefs: string[] = [];
  if (/烤鸭|美食|吃/.test(text)) prefs.push("美食");
  if (/故宫|景点|博物馆|游玩/.test(text)) prefs.push("景点");
  if (/文化|胡同/.test(text)) prefs.push("文化体验");

  let origin: string | undefined;
  let destination: string | undefined;

  const fromMatch = text.match(/从(.{1,6}?)(?:出发|去|到)/);
  if (fromMatch) origin = fromMatch[1].replace(/市/g, "");

  for (const city of CITIES) {
    if (text.includes(`去${city}`) || text.includes(`到${city}`) || text.includes(`${city}出差`)) {
      destination = city;
      break;
    }
  }
  if (!destination) {
    destination = CITIES.find((city) => text.includes(city) && city !== origin);
  }

  const dateRange = resolveDateRange(text);
  const startDate = dateRange.startDate ?? resolveRelativeStartDate(text);
  const durationDays = resolveDurationDays(text);
  const endDate = dateRange.endDate ?? (startDate && durationDays ? addDaysIso(startDate, durationDays - 1) : undefined);

  return {
    origin,
    destination,
    startDate,
    endDate,
    preferences: prefs.length ? prefs.join(" / ") : undefined,
    tags,
    vehicles,
  };
}

export function defaultStructured(): StructuredFields {
  const startDate = nextFridayIso();
  return {
    origin: "",
    destination: "",
    startDate,
    endDate: addDaysIso(startDate, 2),
    preferences: "",
  };
}

export function resolvePickerDate(iso: string, fallbackIso?: string) {
  const candidate = iso || fallbackIso || nextFridayIso();
  const date = new Date(`${candidate}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return new Date(`${nextFridayIso()}T12:00:00`);
  }
  return date;
}

export function todayDate() {
  return new Date();
}

export function mergeStructured(
  current: StructuredFields,
  hints: ParsedTravelHints,
  touched: Record<keyof StructuredFields, boolean>,
): StructuredFields {
  return {
    origin: touched.origin ? current.origin : hints.origin ?? current.origin,
    destination: touched.destination ? current.destination : hints.destination ?? current.destination,
    startDate: touched.startDate ? current.startDate : hints.startDate ?? current.startDate,
    endDate: touched.endDate ? current.endDate : hints.endDate ?? current.endDate,
    preferences: touched.preferences ? current.preferences : hints.preferences ?? current.preferences,
  };
}

export function mergeStructuredFromApi(current: StructuredFields, api: Partial<StructuredFields>, touched: Record<keyof StructuredFields, boolean>) {
  return {
    origin: touched.origin ? current.origin : api.origin || current.origin,
    destination: touched.destination ? current.destination : api.destination || current.destination,
    startDate: touched.startDate ? current.startDate : api.startDate || current.startDate,
    endDate: touched.endDate ? current.endDate : api.endDate || current.endDate,
    preferences: touched.preferences ? current.preferences : api.preferences || current.preferences,
  };
}

export function hasTravelInput(message: string, structured: StructuredFields) {
  return message.trim().length > 0 || Boolean(structured.origin.trim() && structured.destination.trim());
}

export function buildEffectiveMessage(
  message: string,
  structured: StructuredFields,
  tags: string[] = [],
  travelPreferences?: TravelPreferences,
) {
  if (message.trim()) return message.trim();
  if (!structured.origin.trim() || !structured.destination.trim()) return "";
  const tagText = tags.length ? `，标签：${tags.join("、")}` : "";
  const prefText = structured.preferences.trim()
    ? `，偏好：${structured.preferences}`
    : travelPreferences
      ? `，偏好：${serializeTravelPreferences(travelPreferences)}`
      : "";
  return `从${structured.origin}去${structured.destination}，${formatDisplayDate(structured.startDate)}到${formatDisplayDate(structured.endDate)}出行${tagText}${prefText}`;
}
