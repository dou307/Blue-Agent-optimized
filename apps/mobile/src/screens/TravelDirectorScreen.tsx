import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Dimensions, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";

import { AgentStatus } from "../components/AgentStatus";
import { IntentAnalysisPanel } from "../components/IntentAnalysisPanel";
import { IntentInputPanel, UploadedFile } from "../components/IntentInputPanel";
import { MapTopologyBoard } from "../components/MapTopologyBoard";
import { ItineraryTimeline } from "../components/ItineraryTimeline";
import { draftFromItem, NodeEditDraft, NodeEditModal } from "../components/NodeEditModal";
import { OptionPickerModal } from "../components/OptionPickerModal";
import {
  acceptReplan,
  analyzeIntent,
  authorizePayment,
  buildTravelRequest,
  comparePlans,
  confirmPOI,
  deleteNode,
  executeOrder,
  getGuardianStatus,
  getItineraryWeather,
  getTripReview,
  optimizeItineraryByWeather,
  prepareOrder,
  requestReplan,
  searchAccommodationAreas,
  searchRecommendations,
  smartUpdateNode,
  simulateIncident,
  syncSystem,
  uploadTravelDocument,
} from "../services/api";
import { syncItineraryToDeviceCalendar } from "../services/deviceCalendar";
import { formatItemDateLabel, formatItemSchedule } from "../utils/dateUtils";
import {
  GuardianStatus,
  IntentAnalysis,
  Itinerary,
  ItineraryItem,
  ItemWeatherInfo,
  ItineraryWeatherResponse,
  PlanComparison,
  PlanOption,
  AccommodationAreaCandidate,
  POICandidate,
  ReplanProposal,
  SystemSyncResult,
  TravelOrder,
  TripReview,
} from "../types";
import { buildEffectiveMessage, defaultStructured, parseTravelFromText, StructuredFields } from "../utils/parseTravelInput";
import { defaultTravelPreferences, serializeTravelPreferences, TravelPreferences } from "../utils/travelPreferences";
import { riskTextForItem } from "../utils/riskUtils";

const samplePrompt = "";
const screenWidth = Dimensions.get("window").width;

type Stage = "input" | "analyze" | "compare" | "order" | "guardian" | "widget" | "review";

const stageMeta: Array<{ id: Stage; title: string; subtitle: string }> = [
  { id: "input", title: "D1 意图爆发", subtitle: "多模态输入" },
  { id: "analyze", title: "D1 解析确认", subtitle: "五要素理解" },
  { id: "compare", title: "D2 视觉转译", subtitle: "拓扑方案" },
  { id: "order", title: "D3 跨端执行", subtitle: "参数化跳转" },
  { id: "guardian", title: "D4 动态微调", subtitle: "异常重规划" },
  { id: "widget", title: "D4 桌面组件", subtitle: "下一站卡片" },
  { id: "review", title: "D5 回顾沉淀", subtitle: "记忆同步" },
];

function topologyStats(itinerary: Itinerary) {
  return itinerary.items.reduce(
    (stats, item) => {
      const type =
        item.node_type ??
        (item.category === "transport" || item.category === "meeting" || item.category === "hotel"
          ? "hard_anchor"
          : item.category === "food" || item.category === "sight"
            ? "semi_anchor"
            : "soft_task");
      if (type === "hard_anchor") stats.hard += 1;
      if (type === "semi_anchor") stats.semi += 1;
      if (type === "soft_task") stats.soft += 1;
      stats.risks += item.risk_flags.length;
      return stats;
    },
    { hard: 0, semi: 0, soft: 0, risks: 0 },
  );
}

function confirmDanger(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === "web" && typeof window !== "undefined" && typeof window.confirm === "function") {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: "取消", style: "cancel" },
    { text: "删除", style: "destructive", onPress: onConfirm },
  ]);
}

function timeToMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sortItineraryItems(items: ItineraryItem[]) {
  return [...items].sort((left, right) => {
    if (left.day !== right.day) return left.day - right.day;
    return timeToMinutes(left.start_time) - timeToMinutes(right.start_time);
  });
}

function itemStartDateTime(startDate: string | null | undefined, item: ItineraryItem) {
  if (!startDate) return null;
  const [year, month, date] = startDate.split("-").map((value) => Number.parseInt(value, 10));
  const [hour, minute] = item.start_time.split(":").map((value) => Number.parseInt(value, 10));
  if ([year, month, date, hour, minute].some((value) => Number.isNaN(value))) return null;
  const result = new Date(year, month - 1, date + Math.max(0, item.day - 1), hour, minute, 0, 0);
  return Number.isNaN(result.getTime()) ? null : result;
}

function resolveNextWidgetItem(items: ItineraryItem[], startDate?: string | null) {
  const sorted = sortItineraryItems(items).filter((item) => item.category !== "alert");
  if (!sorted.length) return null;
  if (!startDate) return sorted[0];
  const now = new Date();
  return sorted.find((item) => {
    const startsAt = itemStartDateTime(startDate, item);
    return startsAt ? startsAt >= now : false;
  }) ?? sorted[0];
}

function encodeAmapParam(value: string) {
  return encodeURIComponent(value.trim());
}

function cleanRoutePlaceName(value: string) {
  return value
    .replace(/[（(].*?[）)]/g, "")
    .replace(/^\s*(乘坐|搭乘|换乘|步行至|步行到|到达|前往)\s*/, "")
    .trim();
}

function routeEndpointFromText(value: string, fallback: string) {
  const parts = value
    .split(/\s*(?:→|->|—|--|到|至)\s*/)
    .map(cleanRoutePlaceName)
    .filter(Boolean)
    .filter((part) => !/(地铁|公交|号线|线路|步行|打车|出租|高铁|动车|航班|机场大巴)/.test(part));
  return parts[parts.length - 1] || cleanRoutePlaceName(fallback);
}

function navigationNameForItem(item: ItineraryItem) {
  if (item.category === "transport") {
    return routeEndpointFromText(item.location || item.title, item.title || item.location);
  }
  return cleanRoutePlaceName(item.location || item.title);
}

function inferAmapRouteType(item: ItineraryItem) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (text.includes("步行") || text.includes("walk")) return 2;
  if (text.includes("地铁") || text.includes("公交") || text.includes("metro") || text.includes("bus")) return 1;
  return 0;
}

function buildAmapNavigateUrl(item: ItineraryItem, previous?: ItineraryItem | null) {
  const appName = "BlueMap";
  const destinationName = navigationNameForItem(item);
  if (!previous) {
    const name = encodeAmapParam(destinationName);
    if (item.geo_lat != null && item.geo_lng != null) {
      return `amapuri://viewMap?sourceApplication=${appName}&poiname=${name}&lat=${item.geo_lat}&lon=${item.geo_lng}&dev=0`;
    }
    return `amapuri://poi?sourceApplication=${appName}&keywords=${name}&dev=0`;
  }

  const params = new URLSearchParams({
    sourceApplication: appName,
    sname: navigationNameForItem(previous),
    dname: destinationName,
    dev: "0",
    t: String(inferAmapRouteType(item)),
  });
  if (previous.category !== "transport" && previous.geo_lat != null && previous.geo_lng != null) {
    params.set("slat", String(previous.geo_lat));
    params.set("slon", String(previous.geo_lng));
  }
  if (item.category !== "transport" && item.geo_lat != null && item.geo_lng != null) {
    params.set("dlat", String(item.geo_lat));
    params.set("dlon", String(item.geo_lng));
  }
  return `amapuri://route/plan/?${params.toString()}`;
}

export function TravelDirectorScreen() {
  const [stage, setStage] = useState<Stage>("input");
  const [message, setMessage] = useState(samplePrompt);
  const [structured, setStructured] = useState<StructuredFields>(defaultStructured());
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [travelPreferences, setTravelPreferences] = useState<TravelPreferences>(defaultTravelPreferences);
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageScrollEnabled, setPageScrollEnabled] = useState(true);
  const [nodeEditDraft, setNodeEditDraft] = useState<NodeEditDraft | null>(null);
  const [nodeSaving, setNodeSaving] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const pageScrollRef = useRef<ScrollView>(null);
  const mapTouchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<PlanComparison | null>(null);
  const [selectedOption, setSelectedOption] = useState<PlanOption | null>(null);
  const [order, setOrder] = useState<TravelOrder | null>(null);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [syncResult, setSyncResult] = useState<SystemSyncResult | null>(null);
  const [guardian, setGuardian] = useState<GuardianStatus | null>(null);
  const [proposal, setProposal] = useState<ReplanProposal | null>(null);
  const [review, setReview] = useState<TripReview | null>(null);
  const [analysis, setAnalysis] = useState<IntentAnalysis | null>(null);
  const [weather, setWeather] = useState<ItineraryWeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [amapErrorVisible, setAmapErrorVisible] = useState(false);
  const [poiPickerVisible, setPoiPickerVisible] = useState(false);
  const [poiLoading, setPoiLoading] = useState(false);
  const [poiCandidates, setPoiCandidates] = useState<POICandidate[]>([]);
  const [poiSummary, setPoiSummary] = useState("");
  const [poiRecommendation, setPoiRecommendation] = useState("");
  const [poiPickerTitle, setPoiPickerTitle] = useState("多平台候选");
  const [hotelAreaLoading, setHotelAreaLoading] = useState(false);
  const [hotelAreaSummary, setHotelAreaSummary] = useState("");
  const [hotelAreaRecommendation, setHotelAreaRecommendation] = useState("");
  const [hotelAreaCandidates, setHotelAreaCandidates] = useState<AccommodationAreaCandidate[]>([]);
  const [poiContext, setPoiContext] = useState<{
    category: "food" | "hotel";
    keyword: string;
    day: number;
    start_time: string;
    end_time: string;
    replace_item_id?: string;
    insert_after_item_id?: string;
    near_lat?: number;
    near_lng?: number;
  } | null>(null);

  useEffect(() => {
    if (!itinerary?.id) {
      setWeather(null);
      return;
    }
    let cancelled = false;
    setWeatherLoading(true);
    getItineraryWeather(itinerary.id)
      .then((response) => {
        if (!cancelled) setWeather(response);
      })
      .catch(() => {
        if (!cancelled) {
          setWeather({
            available: false,
            source: "qweather",
            summary: "天气暂不可用，已按原行程展示。",
            item_weather: [],
            warnings: ["天气接口请求失败"],
          });
        }
      })
      .finally(() => {
        if (!cancelled) setWeatherLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itinerary?.id, itinerary?.version, itinerary?.items.length]);

  const itemWeatherMap = useMemo(() => {
    if (!weather?.available) return {};
    return Object.fromEntries(weather.item_weather.map((item) => [item.item_id, item]));
  }, [weather]);
  const selectedTopologyQuote = selectedOption?.quote ?? order?.option.quote ?? null;
  const analysisPreferenceText = useMemo(
    () =>
      Array.from(
        new Set([structured.preferences.trim(), serializeTravelPreferences(travelPreferences).trim()].filter(Boolean)),
      ).join(" / "),
    [structured.preferences, travelPreferences],
  );

  useEffect(() => {
    const hints = parseTravelFromText(message);
    if (hints.tags.length) {
      setSelectedTags((current) => Array.from(new Set([...current, ...hints.tags])));
    }
  }, [message]);

  function extractFoodKeyword(text: string) {
    const patterns = ["菌子火锅", "火锅", "烧烤", "米线", "小吃", "美食", "餐厅"];
    for (const pattern of patterns) {
      if (text.includes(pattern)) return pattern;
    }
    return "特色美食";
  }

  function keywordLabel(keyword: string) {
    return keyword || "当地精选";
  }

  async function openPOIPicker(context: {
    category: "food" | "hotel";
    keyword: string;
    day: number;
    start_time: string;
    end_time: string;
    replace_item_id?: string;
    insert_after_item_id?: string;
    near_lat?: number;
    near_lng?: number;
  }) {
    if (!itinerary) return;
    const city = itinerary.intent.destination || structured.destination;
    if (!city) {
      Alert.alert("缺少目的地", "请先填写或解析目的地城市。");
      return;
    }
    setPoiContext(context);
    setPoiPickerTitle(
      context.category === "hotel"
        ? `推荐酒店 · ${keywordLabel(context.keyword)}`
        : `推荐餐厅 · ${keywordLabel(context.keyword)}`,
    );
    setPoiPickerVisible(true);
    setPoiLoading(true);
    setPoiCandidates([]);
    setPoiSummary("");
    setPoiRecommendation("");
    try {
      const response = await searchRecommendations({
        city,
        keyword: context.keyword,
        category: context.category,
        day: context.day,
        start_time: context.start_time,
        end_time: context.end_time,
        near_lat: context.near_lat,
        near_lng: context.near_lng,
        itinerary_id: itinerary.id,
      });
      setPoiCandidates(response.candidates);
      setPoiSummary(response.summary);
      setPoiRecommendation(response.llm_recommendation);
    } catch (error) {
      setPoiPickerVisible(false);
      Alert.alert("推荐失败", error instanceof Error ? error.message : "请确认后端已启动");
    } finally {
      setPoiLoading(false);
    }
  }

  function handleRecommendFromItem(item: ItineraryItem) {
    const category = item.category === "hotel" ? "hotel" : "food";
    const keyword =
      category === "hotel"
        ? itinerary?.intent.accommodation_area || `${itinerary?.intent.destination || structured.destination}酒店`
        : extractFoodKeyword(item.title) !== "特色美食"
          ? extractFoodKeyword(item.title)
          : extractFoodKeyword(message);
    openPOIPicker({
      category,
      keyword,
      day: item.day,
      start_time: item.start_time,
      end_time: item.end_time,
      replace_item_id: item.id,
      near_lat: item.geo_lat ?? undefined,
      near_lng: item.geo_lng ?? undefined,
    });
  }

  async function handleConfirmPOI(candidate: POICandidate) {
    if (!itinerary || !poiContext) return;
    setPoiLoading(true);
    try {
      const response = await confirmPOI(itinerary.id, candidate, {
        day: poiContext.day,
        start_time: poiContext.start_time,
        end_time: poiContext.end_time,
        replace_item_id: poiContext.replace_item_id,
        insert_after_item_id: poiContext.insert_after_item_id,
      });
      if (response.itinerary) await applyItineraryUpdate(response.itinerary);
      setPoiPickerVisible(false);
      setPoiContext(null);
      Alert.alert("节点已确定", `已选定「${candidate.name}」，总价更新为 ¥${response.price_quote.total}。`);
    } catch (error) {
      Alert.alert("确认失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setPoiLoading(false);
    }
  }

  async function handleRecommendHotelAreas() {
    if (!itinerary) return;
    const city = itinerary.intent.destination || structured.destination;
    if (!city) {
      Alert.alert("缺少目的地", "请先填写或解析目的地城市。");
      return;
    }
    setHotelAreaLoading(true);
    try {
      const response = await searchAccommodationAreas({
        city,
        itinerary_id: itinerary.id,
        preference: itinerary.intent.preferences.join(" / "),
        budget: itinerary.intent.budget ?? undefined,
      });
      setHotelAreaCandidates(response.candidates);
      setHotelAreaSummary(response.summary);
      setHotelAreaRecommendation(response.llm_recommendation);
    } catch (error) {
      Alert.alert("片区推荐失败", error instanceof Error ? error.message : "请确认后端已启动");
    } finally {
      setHotelAreaLoading(false);
    }
  }

  function handleSearchHotelsInArea(area: AccommodationAreaCandidate) {
    if (!itinerary) return;
    const lastItem = itinerary.items[itinerary.items.length - 1];
    openPOIPicker({
      category: "hotel",
      keyword: area.search_keyword || `${area.area} 酒店`,
      day: lastItem?.day ?? 1,
      start_time: "20:00",
      end_time: "08:00",
      insert_after_item_id: lastItem?.id,
      near_lat: area.geo_lat ?? undefined,
      near_lng: area.geo_lng ?? undefined,
    });
  }

  function handleQuickRecommend(category: "food" | "hotel") {
    if (!itinerary) return;
    const lastItem = itinerary.items[itinerary.items.length - 1];
    const keyword =
      category === "food"
        ? extractFoodKeyword(message)
        : itinerary.intent.accommodation_area || `${itinerary.intent.destination || structured.destination}酒店`;
    openPOIPicker({
      category,
      keyword,
      day: lastItem?.day ?? 1,
      start_time: category === "food" ? "12:00" : "20:00",
      end_time: category === "food" ? "13:30" : "08:00",
      insert_after_item_id: lastItem?.id,
      near_lat: lastItem?.geo_lat ?? undefined,
      near_lng: lastItem?.geo_lng ?? undefined,
    });
  }

  const subtitle = loading
    ? "Agent 正在执行当前阶段"
    : order?.status === "completed"
      ? "订票、酒店、地图和日历已进入同步阶段"
      : comparison
        ? `${comparison.options.length} 个候选方案已生成`
        : "多模态输入 · 方案比对 · 跨端执行 · 动态守护";


  async function handleUpload() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "text/plain", "image/*", "audio/*"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "text/plain";
    const kind = mimeType.includes("pdf")
      ? "pdf"
      : mimeType.includes("image")
        ? "image"
        : mimeType.includes("audio")
          ? "audio"
          : "text";

    setLoading(true);
    try {
      const response = await uploadTravelDocument(asset.uri, asset.name, mimeType, kind);
      setDocumentIds((current) => [...current, response.document_id]);
      setUploads((current) => [...current, { id: response.document_id, name: asset.name }]);
      Alert.alert("上传成功", `已上传 ${asset.name}，抽取 ${response.chunks} 个片段`);
    } catch (error) {
      Alert.alert("上传失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze() {
    const effectiveMessage = buildEffectiveMessage(message, structured, selectedTags, travelPreferences);
    if (!effectiveMessage) {
      Alert.alert("请先输入需求", "可通过文字、语音，或填写出发地/目的地后解析。");
      return;
    }
    if (!message.trim()) setMessage(effectiveMessage);
    setLoading(true);
    try {
      const response = await analyzeIntent(effectiveMessage);
      setAnalysis(response);
      setStructured((current) => ({
        ...current,
        origin: response.structured.origin || current.origin,
        destination: response.structured.destination || current.destination,
        startDate: response.structured.startDate || current.startDate,
        endDate: response.structured.endDate || current.endDate,
        preferences: response.structured.preferences || current.preferences,
      }));
      setStage("analyze");
    } catch (error) {
      Alert.alert("解析失败", error instanceof Error ? error.message : "请确认后端已启动");
    } finally {
      setLoading(false);
    }
  }

  async function handleCompare() {
    const effectiveMessage = buildEffectiveMessage(message, structured, selectedTags, travelPreferences);
    if (!effectiveMessage) {
      Alert.alert("请先输入需求", "可通过文字、语音，或填写出发地/目的地后解析。");
      return;
    }
    if (!message.trim()) setMessage(effectiveMessage);
    setLoading(true);
    try {
      const response = await comparePlans(
        buildTravelRequest(effectiveMessage, structured, documentIds, selectedTags, [], travelPreferences),
      );
      setComparison(response.comparison);
      const recommended =
        response.comparison.options.find((item) => item.id === response.comparison.recommended_option_id) ??
        response.comparison.options[0];
      setSelectedOption(recommended);
      setItinerary(recommended.itinerary);
      setStage("compare");
    } catch (error) {
      Alert.alert("方案生成失败", error instanceof Error ? error.message : "请确认后端已启动");
    } finally {
      setLoading(false);
    }
  }

  async function handlePrepare(option: PlanOption) {
    if (!comparison) return;
    setLoading(true);
    try {
      setSelectedOption(option);
      const response = await prepareOrder(comparison.id, option.id);
      setSelectedOption(response.order.option);
      setOrder(response.order);
      setItinerary(response.order.option.itinerary);
      setStage("order");
    } catch (error) {
      Alert.alert("订单准备失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    if (!order) return;
    setLoading(true);
    try {
      const authorized = await authorizePayment(order.id);
      const executed = await executeOrder(authorized.order.id);
      setOrder(executed.order);
      const executedItinerary = executed.order.option.itinerary;
      setSelectedOption(executed.order.option);
      setItinerary(executedItinerary);
      const synced = await syncSystem(executedItinerary.id, executed.order.id);
      const calendarSync = await syncItineraryToDeviceCalendar(executedItinerary);
      setSyncResult({
        ...synced.sync,
        items: synced.sync.items.map((item) =>
          item.target === "calendar"
            ? {
                ...item,
                title: "系统日历",
                detail: calendarSync.detail,
              }
            : item,
        ),
      });
      setStage("guardian");
    } catch (error) {
      Alert.alert("执行失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleGuardian() {
    if (!itinerary) return;
    setLoading(true);
    try {
      const incident = await simulateIncident(itinerary.id);
      const nextProposal = await requestReplan(itinerary.id, incident.incident.id);
      const status = await getGuardianStatus(itinerary.id);
      setGuardian(status.guardian);
      setProposal(nextProposal.proposal);
    } catch (error) {
      Alert.alert("守护检测失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleAcceptReplan() {
    if (!proposal) return;
    setLoading(true);
    try {
      const response = await acceptReplan(proposal.id);
      if (response.itinerary) setItinerary(response.itinerary);
      setProposal(null);
    } catch (error) {
      Alert.alert("重规划失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleReview() {
    if (!itinerary) return;
    setLoading(true);
    try {
      const response = await getTripReview(itinerary.id);
      setReview(response.review);
      setStage("review");
    } catch (error) {
      Alert.alert("回顾生成失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function applyItineraryUpdate(itinerary: Itinerary) {
    setItinerary(itinerary);
    if (selectedOption) {
      setSelectedOption({ ...selectedOption, itinerary });
    }
    if (comparison) {
      setComparison({
        ...comparison,
        options: comparison.options.map((option) =>
          option.itinerary.id === itinerary.id ? { ...option, itinerary } : option,
        ),
      });
    }
  }

  async function handleSmartUpdateNode(
    itemId: string,
    payload: Parameters<typeof smartUpdateNode>[2],
    instruction?: string,
    options?: { silent?: boolean },
  ) {
    if (!itinerary) return null;
    const response = await smartUpdateNode(itinerary.id, itemId, payload, instruction);
    if (response.itinerary) {
      await applyItineraryUpdate(response.itinerary);
    }
    if (!options?.silent) {
      const affected = response.affected_item_ids?.length ?? 0;
      const warningText = response.warnings?.length
        ? `\n\n⚠ ${response.warnings.join("；")}`
        : "";
      Alert.alert(
        "智能联动完成",
        `${response.change_summary || "行程已更新。"}\n\n共联动 ${affected} 个节点。${warningText}`,
      );
    }
    return response;
  }

  function handleEditNode(item: ItineraryItem) {
    setNodeEditDraft(draftFromItem(item));
  }

  async function handleNavigateToItem(item: ItineraryItem) {
    if (!itinerary) return;
    const ordered = sortItineraryItems(itinerary.items);
    const index = ordered.findIndex((entry) => entry.id === item.id);
    const previous = index > 0 ? ordered[index - 1] : null;
    const url = buildAmapNavigateUrl(item, previous);
    try {
      await Linking.openURL(url);
    } catch {
      setAmapErrorVisible(true);
    }
  }

  async function handleSaveNodeEdit() {
    if (!nodeEditDraft) return;
    setNodeSaving(true);
    try {
      const response = await handleSmartUpdateNode(
        nodeEditDraft.id,
        {
          title: nodeEditDraft.title.trim(),
          start_time: nodeEditDraft.start_time.trim(),
          location: nodeEditDraft.location.trim(),
        },
        "请联动检查同日后续节点时间、交通缓冲与地点描述是否需要同步调整。",
        { silent: true },
      );
      setNodeEditDraft(null);
      const affected = response?.affected_item_ids?.length ?? 0;
      Alert.alert(
        "智能联动完成",
        `${response?.change_summary || "修改已同步到行程与地图。"}\n\n共联动 ${affected} 个节点。`,
      );
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setNodeSaving(false);
    }
  }

  async function handleDeleteNodeEdit() {
    if (!nodeEditDraft || !itinerary) return;
    const title = nodeEditDraft.title.trim();
    confirmDanger("确认删除", `确定删除「${title}」？Agent 将联动调整剩余行程。`, async () => {
      setNodeSaving(true);
      try {
        const response = await deleteNode(itinerary.id, nodeEditDraft.id);
        if (response.itinerary) await applyItineraryUpdate(response.itinerary);
        setNodeEditDraft(null);
        Alert.alert("已删除", response.change_summary || "节点已删除。");
      } catch (error) {
        Alert.alert("删除失败", error instanceof Error ? error.message : "请稍后重试");
      } finally {
        setNodeSaving(false);
      }
    });
  }

  async function handleWeatherOptimize() {
    if (!itinerary) return;
    setWeatherLoading(true);
    try {
      const response = await optimizeItineraryByWeather(itinerary.id);
      setWeather(response.weather);
      if (!response.weather.available) {
        Alert.alert("天气暂不可用", response.weather.summary);
        return;
      }
      if (response.itinerary) await applyItineraryUpdate(response.itinerary);
      const affected = response.affected_item_ids?.length ?? 0;
      Alert.alert(
        "天气优化完成",
        `${response.change_summary || "已根据真实天气完成轻量优化。"}${affected ? `\n\n共联动 ${affected} 个节点。` : ""}`,
      );
    } catch (error) {
      Alert.alert("天气优化失败", error instanceof Error ? error.message : "天气暂不可用，已按原行程展示。");
    } finally {
      setWeatherLoading(false);
    }
  }

  function handleMapInteraction(active: boolean) {
    if (mapTouchTimer.current) {
      clearTimeout(mapTouchTimer.current);
      mapTouchTimer.current = null;
    }
    if (active) {
      setPageScrollEnabled(false);
      return;
    }
    mapTouchTimer.current = setTimeout(() => setPageScrollEnabled(true), 350);
  }

  return (
    <ScrollView
      ref={pageScrollRef}
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      scrollEnabled={pageScrollEnabled}
      nestedScrollEnabled
    >
      <View style={styles.phoneFrame}>
        <View style={styles.homeCard}>
          <View style={styles.bgOrbLeft} />
          <View style={styles.bgOrbRight} />

          <View style={styles.pageHead}>
            <View style={styles.backBtn}>
              <Text style={styles.backText}>‹</Text>
            </View>
            <View style={styles.titleBlock}>
              <View style={styles.titleRow}>
                <Text style={styles.heading}>Blue-Map 编排者</Text>
                <Text style={styles.titleBadge}>AIGC Agent</Text>
              </View>
              <Text style={styles.subheading} numberOfLines={2}>
                意图爆发 · 视觉转译 · 动态微调 · 跨端执行
              </Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stageTabs}>
            {stageMeta.map((item, index) => (
              <Pressable key={item.id} style={[styles.stageTab, stage === item.id ? styles.stageTabActive : null]} onPress={() => setStage(item.id)}>
                <Text style={[styles.stageIndex, stage === item.id ? styles.stageIndexActive : null]}>{index + 1}</Text>
                <Text style={[styles.stageTitle, stage === item.id ? styles.stageTitleActive : null]}>{item.title}</Text>
                <Text style={styles.stageSub}>{item.subtitle}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {stage === "input" ? <AgentStatus loading={loading} subtitle={subtitle} /> : null}

          {stage === "input" ? (
            <View style={styles.section}>
              <IntentInputPanel
                message={message}
                onMessageChange={setMessage}
                structured={structured}
                setStructured={setStructured}
                travelPreferences={travelPreferences}
                onTravelPreferencesChange={setTravelPreferences}
                uploads={uploads}
                onUploadPress={handleUpload}
                onAnalyze={handleAnalyze}
                loading={loading}
              />
            </View>
          ) : null}

          {stage === "analyze" && analysis ? (
            <View style={styles.section}>
              <IntentAnalysisPanel
                analysis={analysis}
                travelPreferenceText={analysisPreferenceText}
                loading={loading}
                onConfirm={handleCompare}
                onBack={() => setStage("input")}
              />
            </View>
          ) : null}

          {stage === "compare" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>视觉转译 · 候选拓扑</Text>
              {comparison?.options.map((option) => (
                <Pressable key={option.id} style={[styles.optionCard, selectedOption?.id === option.id ? styles.optionCardActive : null]} onPress={() => handlePrepare(option)}>
                  <View style={styles.optionHeader}>
                    <Text style={styles.optionTitle}>{option.title}</Text>
                    <Text style={styles.price}>¥{option.quote.total_price}</Text>
                  </View>
                  <Text style={styles.summary}>{option.recommendation}</Text>
                  <View style={styles.metrics}>
                    <Text style={styles.metric}>耗时 {option.quote.duration_text}</Text>
                    <Text style={styles.metric}>舒适 {option.quote.comfort_score}</Text>
                    <Text style={styles.metric}>风险 {option.quote.risk_level}</Text>
                  </View>
                  <Text style={styles.warning}>{option.risks.join(" · ")}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {stage === "order" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>跨端执行 · 参数化动作</Text>
              {order ? (
                <>
                  <View style={styles.summaryCard}>
                    <Text style={styles.panelTitle}>{order.option.title}</Text>
                    <Text style={styles.summary}>{order.option.quote.flight}</Text>
                    <Text style={styles.summary}>{order.option.quote.hotel}</Text>
                    <Text style={styles.price}>总价 ¥{order.option.quote.total_price}</Text>
                  </View>
                  {order.steps.map((step) => (
                    <View key={step.name} style={styles.stepCard}>
                      <Text style={styles.stepStatus}>{step.status === "done" ? "✓" : "○"}</Text>
                      <View style={styles.flex}>
                        <Text style={styles.stepTitle}>{step.name}</Text>
                        <Text style={styles.summary}>{step.detail}</Text>
                      </View>
                    </View>
                  ))}
                  <Pressable style={styles.cta} onPress={handleExecute} disabled={loading}>
                    <Text style={styles.ctaText}>{loading ? "Agent 正在并行执行..." : "授权支付并同步执行  ›"}</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          ) : null}

          {stage === "guardian" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>动态微调 · 守护重排</Text>
              {syncResult ? (
                <View style={styles.entityGrid}>
                  {syncResult.items.map((item) => (
                    <View key={item.target} style={styles.entityPill}>
                      <Text style={styles.entityLabel}>{item.title}</Text>
                      <Text style={styles.entityValue}>{item.detail}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {itinerary ? (
                <Pressable style={styles.secondaryCta} onPress={() => setStage("widget")}>
                  <Text style={styles.secondaryCtaText}>查看桌面组件预览</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.secondaryCta} onPress={handleGuardian} disabled={loading}>
                <Text style={styles.secondaryCtaText}>模拟航班延误并生成重规划</Text>
              </Pressable>
              {guardian?.incidents.map((incident) => (
                <Text key={incident.id} style={styles.warning}>{incident.title}：{incident.detail}</Text>
              ))}
              {proposal ? (
                <View style={styles.summaryCard}>
                  <Text style={styles.panelTitle}>{proposal.summary}</Text>
                  {proposal.changes.map((change) => (
                    <Text key={change} style={styles.summary}>• {change}</Text>
                  ))}
                  <Pressable style={styles.cta} onPress={handleAcceptReplan}>
                    <Text style={styles.ctaText}>确认更新行程</Text>
                  </Pressable>
                </View>
              ) : null}
              <Pressable style={styles.cta} onPress={handleReview} disabled={loading}>
                <Text style={styles.ctaText}>生成行程回顾  ›</Text>
              </Pressable>
            </View>
          ) : null}

          {stage === "widget" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>桌面 Widget · 下一站卡片</Text>
              {itinerary ? (
                <WidgetPreview
                  itinerary={itinerary}
                  itemWeather={itemWeatherMap}
                  syncResult={syncResult}
                  startDate={itinerary.intent.start_date ?? structured.startDate}
                />
              ) : (
                <Text style={styles.summary}>生成行程后可预览桌面组件。</Text>
              )}
              <Pressable style={styles.secondaryCta} onPress={() => setStage("guardian")}>
                <Text style={styles.secondaryCtaText}>返回同步状态</Text>
              </Pressable>
            </View>
          ) : null}

          {stage === "review" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>回顾与沉淀</Text>
              {review ? (
                <View style={styles.summaryCard}>
                  <Text style={styles.panelTitle}>行程回顾</Text>
                  <Text style={styles.summary}>{review.summary}</Text>
                  <Text style={styles.price}>预算合计 ¥{review.budget_total}</Text>
                  <Text style={styles.panelTitle}>偏好记忆</Text>
                  {review.preference_memory.map((item) => <Text key={item} style={styles.summary}>• {item}</Text>)}
                  <Text style={styles.panelTitle}>下次建议</Text>
                  {review.next_trip_suggestions.map((item) => <Text key={item} style={styles.summary}>• {item}</Text>)}
                </View>
              ) : null}
            </View>
          ) : null}

          {itinerary && stage !== "input" && stage !== "analyze" && stage !== "compare" ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>时空拓扑看板</Text>
              <TopologySummary itinerary={itinerary} />
              {selectedTopologyQuote ? (
                <View style={styles.priceCard}>
                  <Text style={styles.priceCardTitle}>已选方案报价</Text>
                  <Text style={styles.priceTotal}>¥{selectedTopologyQuote.total_price}</Text>
                  <View style={styles.priceMetrics}>
                    <Text style={styles.priceMetric}>耗时 {selectedTopologyQuote.duration_text}</Text>
                    <Text style={styles.priceMetric}>舒适 {selectedTopologyQuote.comfort_score}</Text>
                    <Text style={styles.priceMetric}>风险 {selectedTopologyQuote.risk_level}</Text>
                  </View>
                  <Text style={styles.priceSource}>{selectedTopologyQuote.flight}</Text>
                  <Text style={styles.priceSource}>{selectedTopologyQuote.hotel}</Text>
                  <Text style={styles.priceSource}>{selectedTopologyQuote.local_transport}</Text>
                </View>
              ) : null}
              <View style={styles.quickPickRow}>
                <Pressable style={styles.quickPickBtn} disabled={loading || poiLoading} onPress={() => handleQuickRecommend("food")}>
                  <Text style={styles.quickPickText}>推荐美食</Text>
                </Pressable>
                <Pressable style={styles.quickPickBtn} disabled={loading || poiLoading || hotelAreaLoading} onPress={() => handleQuickRecommend("hotel")}>
                  <Text style={styles.quickPickText}>{hotelAreaLoading ? "分析住宿片区..." : "推荐酒店"}</Text>
                </Pressable>
                <Pressable style={styles.quickPickBtn} disabled={loading || weatherLoading} onPress={handleWeatherOptimize}>
                  <Text style={styles.quickPickText}>{weatherLoading ? "同步天气..." : "天气优化"}</Text>
                </Pressable>
              </View>
              {hotelAreaCandidates.length ? (
                <View style={styles.hotelAreaPanel}>
                  <Text style={styles.hotelAreaTitle}>住宿片区建议</Text>
                  <Text style={styles.hotelAreaSummary}>{hotelAreaSummary}</Text>
                  <Text style={styles.hotelAreaRecommendation}>{hotelAreaRecommendation}</Text>
                  {hotelAreaCandidates.map((area) => (
                    <View key={area.id} style={styles.hotelAreaCard}>
                      <View style={styles.hotelAreaHeader}>
                        <View style={styles.flex}>
                          <Text style={styles.hotelAreaName}>{area.name}</Text>
                          <Text style={styles.hotelAreaReason}>{area.reason}</Text>
                        </View>
                        <View style={styles.hotelAreaScore}>
                          <Text style={styles.hotelAreaScoreValue}>{area.score}</Text>
                          <Text style={styles.hotelAreaScoreLabel}>匹配</Text>
                        </View>
                      </View>
                      <View style={styles.hotelAreaMetrics}>
                        <Text style={styles.hotelAreaMetric}>{area.estimated_price_range || "价格待估"}</Text>
                        {area.distance_minutes_to_key_anchor != null ? (
                          <Text style={styles.hotelAreaMetric}>到关键点约 {area.distance_minutes_to_key_anchor} 分钟</Text>
                        ) : null}
                        <Text style={styles.hotelAreaMetric}>{area.best_for}</Text>
                      </View>
                      <Text style={styles.hotelAreaPros}>优势：{area.pros.join("、")}</Text>
                      {area.cons.length ? <Text style={styles.hotelAreaTips}>适配建议：{area.cons.join("、")}</Text> : null}
                      <Pressable style={styles.areaHotelBtn} disabled={poiLoading} onPress={() => handleSearchHotelsInArea(area)}>
                        <Text style={styles.areaHotelBtnText}>按此片区找酒店</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              <MapTopologyBoard
                itinerary={itinerary}
                city={structured.destination}
                startDate={itinerary.intent.start_date ?? structured.startDate}
                itemWeather={itemWeatherMap}
                onUpdateNode={async (itemId, payload) => {
                  const item = itinerary.items.find((entry) => entry.id === itemId);
                  const instruction = item
                    ? `用户拖动了「${item.title}」的地图位置，请检查地点描述与后续交通时间是否需要联动调整。`
                    : undefined;
                  await handleSmartUpdateNode(itemId, payload, instruction, { silent: true });
                }}
                onEditItem={handleEditNode}
                onMapInteractionChange={handleMapInteraction}
              />
              <ItineraryTimeline
                items={itinerary.items}
                startDate={itinerary.intent.start_date ?? structured.startDate}
                busy={nodeSaving || poiLoading}
                deletingItemId={deletingItemId}
                itemWeather={itemWeatherMap}
                onEdit={handleEditNode}
                onNavigate={handleNavigateToItem}
                onRecommendPOI={handleRecommendFromItem}
                onDelete={(itemId) => {
                  const item = itinerary.items.find((entry) => entry.id === itemId);
                  if (!item) return;
                  confirmDanger("确认删除", `确定删除「${item.title}」？`, async () => {
                    setDeletingItemId(itemId);
                    setNodeSaving(true);
                    try {
                      const response = await deleteNode(itinerary.id, itemId);
                      if (response.itinerary) await applyItineraryUpdate(response.itinerary);
                      Alert.alert("已删除", response.change_summary || "节点已删除。");
                    } catch (error) {
                      Alert.alert("删除失败", error instanceof Error ? error.message : "请稍后重试");
                    } finally {
                      setDeletingItemId(null);
                      setNodeSaving(false);
                    }
                  });
                }}
              />
              <NodeEditModal
                visible={nodeEditDraft != null}
                draft={nodeEditDraft}
                dateLabel={
                  nodeEditDraft
                    ? formatItemDateLabel(
                        itinerary.intent.start_date ?? structured.startDate,
                        itinerary.items.find((item) => item.id === nodeEditDraft.id)?.day ?? 1,
                      )
                    : undefined
                }
                saving={nodeSaving}
                onChange={setNodeEditDraft}
                onClose={() => setNodeEditDraft(null)}
                onSave={handleSaveNodeEdit}
                onDelete={handleDeleteNodeEdit}
                onNavigate={
                  nodeEditDraft
                    ? () => {
                        const item = itinerary.items.find((entry) => entry.id === nodeEditDraft.id);
                        if (item) handleNavigateToItem(item);
                      }
                    : undefined
                }
              />
              <Modal visible={amapErrorVisible} transparent animationType="fade" onRequestClose={() => setAmapErrorVisible(false)}>
                <View style={styles.errorBackdrop}>
                  <View style={styles.errorCard}>
                    <Pressable style={styles.errorClose} onPress={() => setAmapErrorVisible(false)}>
                      <Text style={styles.errorCloseText}>×</Text>
                    </Pressable>
                    <Text style={styles.errorTitle}>未安装高德地图</Text>
                  </View>
                </View>
              </Modal>
              <OptionPickerModal
                visible={poiPickerVisible}
                title={poiPickerTitle}
                summary={poiSummary}
                recommendation={poiRecommendation}
                candidates={poiCandidates}
                loading={poiLoading}
                loadingText={
                  poiContext?.category === "food"
                    ? "正在搜索美食中"
                    : poiContext?.category === "hotel"
                      ? "正在搜索酒店中"
                      : undefined
                }
                onClose={() => {
                  setPoiPickerVisible(false);
                  setPoiContext(null);
                }}
                onConfirm={handleConfirmPOI}
              />
            </View>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

function TopologySummary({ itinerary }: { itinerary: Itinerary }) {
  const stats = topologyStats(itinerary);
  const chips = [
    { label: "硬锚点", value: `${stats.hard}`, tone: "blue" },
    { label: "半硬锚点", value: `${stats.semi}`, tone: "cyan" },
    { label: "软任务", value: `${stats.soft}`, tone: "soft" },
    { label: "风险", value: `${stats.risks}`, tone: stats.risks ? "warn" : "soft" },
  ];
  return (
    <View style={styles.topologySummary}>
      <Text style={styles.topologyTitle} numberOfLines={2}>{itinerary.title}</Text>
      <Text style={styles.topologyCopy} numberOfLines={3}>{itinerary.summary || itinerary.explanation}</Text>
      <View style={styles.topologyChips}>
        {chips.map((chip) => (
          <View key={chip.label} style={[styles.topologyChip, chip.tone === "warn" && styles.topologyChipWarn]}>
            <Text style={styles.topologyChipValue}>{chip.value}</Text>
            <Text style={styles.topologyChipLabel}>{chip.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function WidgetPreview({
  itinerary,
  itemWeather,
  syncResult,
  startDate,
}: {
  itinerary: Itinerary;
  itemWeather?: Record<string, ItemWeatherInfo>;
  syncResult: SystemSyncResult | null;
  startDate?: string | null;
}) {
  const nextItem = resolveNextWidgetItem(itinerary.items, startDate);
  const weather = nextItem ? itemWeather?.[nextItem.id] : undefined;
  const riskText = nextItem ? riskTextForItem(nextItem, weather) : "";
  const calendarSync = syncResult?.items.find((item) => item.target === "calendar");
  const mapSync = syncResult?.items.find((item) => item.target === "map");
  const widgetSync = syncResult?.items.find((item) => item.target === "widget");
  const laterItems = nextItem
    ? sortItineraryItems(itinerary.items)
        .filter((item) => item.category !== "alert")
        .filter((item) => item.id !== nextItem.id)
        .slice(0, 2)
    : [];

  if (!nextItem) {
    return <Text style={styles.summary}>暂无可展示的下一站节点。</Text>;
  }

  return (
    <View style={styles.widgetWrap}>
      <View style={styles.widgetShellLarge}>
        <View style={styles.widgetTopRow}>
          <Text style={styles.widgetAppName}>蓝V出行</Text>
          <Text style={styles.widgetStatus}>{syncResult ? "已同步" : "预览"}</Text>
        </View>
        <Text style={styles.widgetNextLabel}>下一站</Text>
        <Text style={styles.widgetTitle} numberOfLines={2}>{nextItem.title}</Text>
        <Text style={styles.widgetTime}>
          {formatItemSchedule(startDate, nextItem.day, nextItem.start_time, nextItem.end_time)}
        </Text>
        <Text style={styles.widgetLocation} numberOfLines={2}>{nextItem.location}</Text>
        {weather ? (
          <View style={[styles.widgetNotice, weather.risk_level !== "low" ? styles.widgetNoticeWarn : null]}>
            <Text style={[styles.widgetNoticeText, weather.risk_level !== "low" ? styles.widgetNoticeTextWarn : null]} numberOfLines={2}>
              {weather.label} · {weather.advice}
            </Text>
          </View>
        ) : null}
        {riskText ? (
          <View style={[styles.widgetNotice, styles.widgetNoticeDanger]}>
            <Text style={[styles.widgetNoticeText, styles.widgetNoticeTextDanger]} numberOfLines={2}>
              {riskText}
            </Text>
          </View>
        ) : null}
        <View style={styles.widgetSyncRow}>
          <Text style={styles.widgetSyncChip}>{calendarSync ? "日历 OK" : "日历待同步"}</Text>
          <Text style={styles.widgetSyncChip}>{mapSync ? "地图 OK" : "地图待同步"}</Text>
        </View>
      </View>

      <View style={styles.widgetShellSmall}>
        <View style={styles.widgetSmallIcon}>
          <Text style={styles.widgetSmallIconText}>↗</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.widgetSmallLabel}>下一站</Text>
          <Text style={styles.widgetSmallTitle} numberOfLines={1}>{nextItem.title}</Text>
          <Text style={styles.widgetSmallMeta} numberOfLines={1}>{nextItem.start_time} · {nextItem.location}</Text>
        </View>
      </View>

      <View style={styles.widgetPanel}>
        <Text style={styles.panelTitle}>组件数据源</Text>
        <Text style={styles.summary}>{widgetSync?.detail ?? "当前为应用内桌面组件预览，执行同步后会展示系统同步状态。"}</Text>
        {laterItems.map((item) => (
          <Text key={item.id} style={styles.widgetQueueItem}>
            {item.start_time} · {item.title}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#D9F2FF" },
  pageContent: { alignItems: "center", paddingBottom: 32 },
  phoneFrame: { width: Math.min(screenWidth, 390), padding: 7, backgroundColor: "#8E67FF" },
  homeCard: { minHeight: "100%", padding: 18, paddingTop: 34, borderRadius: 34, overflow: "hidden", backgroundColor: "#E8F7FF" },
  bgOrbLeft: { position: "absolute", left: 24, top: -36, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(173,216,255,0.75)" },
  bgOrbRight: { position: "absolute", right: -60, top: 40, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(255,255,255,0.64)" },
  pageHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 31, height: 31, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.86)" },
  backText: { marginTop: -4, color: "#4C84FF", fontSize: 28 },
  titleBlock: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { color: "#233B63", fontSize: 16, fontWeight: "900" },
  titleBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: "hidden", color: "#4383FF", backgroundColor: "rgba(211,230,255,0.9)", fontSize: 10, fontWeight: "800" },
  subheading: { marginTop: 7, color: "#7F93B1", fontSize: 11, fontWeight: "700" },
  stageTabs: { gap: 8, paddingVertical: 14 },
  stageTab: { width: 112, padding: 10, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.62)" },
  stageTabActive: { backgroundColor: "#FFFFFF" },
  stageIndex: { width: 22, height: 22, borderRadius: 11, overflow: "hidden", textAlign: "center", textAlignVertical: "center", color: "#93A3BA", backgroundColor: "#EEF6FF", fontWeight: "900" },
  stageIndexActive: { color: "#FFFFFF", backgroundColor: "#287CFF" },
  stageTitle: { marginTop: 7, color: "#527099", fontSize: 11, fontWeight: "900" },
  stageTitleActive: { color: "#287CFF" },
  stageSub: { marginTop: 3, color: "#8BA0BD", fontSize: 9, fontWeight: "800" },
  section: { marginTop: 12, padding: 12, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.9)" },
  sectionTitle: { color: "#233B63", fontSize: 14, fontWeight: "900", marginBottom: 10 },
  cta: { minHeight: 48, marginTop: 14, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#1B63FF" },
  ctaText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  secondaryCta: { minHeight: 42, marginTop: 12, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#E7F3FF" },
  secondaryCtaText: { color: "#287CFF", fontWeight: "900" },
  errorBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(35,59,99,0.35)",
  },
  errorCard: {
    width: "100%",
    maxWidth: 280,
    minHeight: 116,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  errorClose: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF6FF",
  },
  errorCloseText: { color: "#527099", fontSize: 20, lineHeight: 22, fontWeight: "900" },
  errorTitle: { color: "#233B63", fontSize: 16, fontWeight: "900" },
  optionCard: { marginTop: 10, padding: 12, borderRadius: 16, backgroundColor: "#F7FBFF", borderWidth: 1, borderColor: "transparent" },
  optionCardActive: { borderColor: "#287CFF", backgroundColor: "#FFFFFF" },
  optionHeader: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  optionTitle: { flex: 1, color: "#233B63", fontSize: 14, fontWeight: "900" },
  price: { color: "#1B63FF", fontSize: 16, fontWeight: "900" },
  summaryCard: { marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: "#F7FBFF" },
  panelTitle: { color: "#233B63", fontSize: 14, fontWeight: "900", marginTop: 6 },
  summary: { color: "#7085A2", fontSize: 11, lineHeight: 17, fontWeight: "800", marginTop: 5 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  metric: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, overflow: "hidden", color: "#527099", backgroundColor: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  warning: { color: "#F97316", backgroundColor: "#FFF7ED", borderRadius: 12, padding: 10, marginTop: 8, fontSize: 11, lineHeight: 16 },
  stepCard: { flexDirection: "row", gap: 10, marginTop: 8, padding: 10, borderRadius: 13, backgroundColor: "#FFFFFF" },
  stepStatus: { width: 24, color: "#12C8AD", fontSize: 16, fontWeight: "900" },
  flex: { flex: 1 },
  stepTitle: { color: "#2A4266", fontSize: 12, fontWeight: "900" },
  entityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  entityPill: { width: "48%", padding: 9, borderRadius: 12, backgroundColor: "#FFFFFF" },
  entityLabel: { color: "#287CFF", fontSize: 10, fontWeight: "900" },
  entityValue: { marginTop: 4, color: "#7085A2", fontSize: 11, lineHeight: 15 },
  widgetWrap: { gap: 10 },
  widgetShellLarge: {
    minHeight: 190,
    padding: 16,
    borderRadius: 24,
    backgroundColor: "#17233B",
    borderWidth: 1,
    borderColor: "#2D416A",
  },
  widgetTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  widgetAppName: { color: "#D7E8FF", fontSize: 12, fontWeight: "900" },
  widgetStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    color: "#A7F3D0",
    backgroundColor: "rgba(16,185,129,0.16)",
    fontSize: 10,
    fontWeight: "900",
  },
  widgetNextLabel: { marginTop: 18, color: "#7DD3FC", fontSize: 11, fontWeight: "900" },
  widgetTitle: { marginTop: 4, color: "#FFFFFF", fontSize: 22, lineHeight: 28, fontWeight: "900" },
  widgetTime: { marginTop: 8, color: "#C7D7EE", fontSize: 12, fontWeight: "900" },
  widgetLocation: { marginTop: 5, color: "#8FA7C8", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  widgetNotice: {
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(125,211,252,0.12)",
  },
  widgetNoticeWarn: { backgroundColor: "rgba(251,146,60,0.16)" },
  widgetNoticeDanger: { backgroundColor: "rgba(248,113,113,0.18)" },
  widgetNoticeText: { color: "#BAE6FD", fontSize: 10, lineHeight: 14, fontWeight: "800" },
  widgetNoticeTextWarn: { color: "#FDBA74" },
  widgetNoticeTextDanger: { color: "#FCA5A5" },
  widgetSyncRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  widgetSyncChip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
    color: "#D7E8FF",
    backgroundColor: "rgba(255,255,255,0.1)",
    fontSize: 10,
    fontWeight: "900",
  },
  widgetShellSmall: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E6FF",
  },
  widgetSmallIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1B63FF",
  },
  widgetSmallIconText: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  widgetSmallLabel: { color: "#7F93B1", fontSize: 10, fontWeight: "900" },
  widgetSmallTitle: { marginTop: 2, color: "#233B63", fontSize: 14, fontWeight: "900" },
  widgetSmallMeta: { marginTop: 2, color: "#527099", fontSize: 11, fontWeight: "800" },
  widgetPanel: { padding: 12, borderRadius: 14, backgroundColor: "#F7FBFF", borderWidth: 1, borderColor: "#D8E6FF" },
  widgetQueueItem: { marginTop: 6, color: "#527099", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  topologySummary: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: "#F7FBFF", marginBottom: 10 },
  topologyTitle: { color: "#233B63", fontSize: 13, fontWeight: "900" },
  topologyCopy: { color: "#7085A2", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  topologyChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  topologyChip: {
    minWidth: 62,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },
  topologyChipWarn: { backgroundColor: "#FFF7ED" },
  topologyChipValue: { color: "#287CFF", fontSize: 15, fontWeight: "900" },
  topologyChipLabel: { marginTop: 2, color: "#7F93B1", fontSize: 9, fontWeight: "900" },
  priceCard: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8E6FF",
    gap: 6,
  },
  priceCardTitle: { color: "#30496F", fontSize: 12, fontWeight: "900" },
  priceTotal: { color: "#1B63FF", fontSize: 24, fontWeight: "900" },
  priceMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  priceMetric: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#EEF6FF",
    color: "#527099",
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
  },
  priceSource: { color: "#8BA0BD", fontSize: 10, lineHeight: 15 },
  quickPickRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  quickPickBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8FFF3",
    borderWidth: 1,
    borderColor: "#B8EBD0",
  },
  quickPickText: { color: "#1A9D5C", fontSize: 12, fontWeight: "900" },
  hotelAreaPanel: {
    gap: 10,
    marginBottom: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F8FCFF",
    borderWidth: 1,
    borderColor: "#D8E6FF",
  },
  hotelAreaTitle: { color: "#233B63", fontSize: 13, fontWeight: "900" },
  hotelAreaSummary: { color: "#7085A2", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  hotelAreaRecommendation: { color: "#287CFF", fontSize: 11, lineHeight: 16, fontWeight: "900" },
  hotelAreaCard: {
    gap: 8,
    padding: 11,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5EEF9",
  },
  hotelAreaHeader: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  hotelAreaName: { color: "#233B63", fontSize: 13, fontWeight: "900" },
  hotelAreaReason: { marginTop: 4, color: "#7085A2", fontSize: 11, lineHeight: 16, fontWeight: "800" },
  hotelAreaScore: {
    minWidth: 46,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#EEF6FF",
  },
  hotelAreaScoreValue: { color: "#1B63FF", fontSize: 16, fontWeight: "900" },
  hotelAreaScoreLabel: { marginTop: 1, color: "#7F93B1", fontSize: 9, fontWeight: "900" },
  hotelAreaMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  hotelAreaMetric: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
    color: "#527099",
    backgroundColor: "#EEF6FF",
    fontSize: 10,
    fontWeight: "900",
  },
  hotelAreaPros: { color: "#1A9D5C", fontSize: 10, lineHeight: 15, fontWeight: "800" },
  hotelAreaTips: { color: "#287CFF", fontSize: 10, lineHeight: 15, fontWeight: "800" },
  areaHotelBtn: {
    minHeight: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1B63FF",
  },
  areaHotelBtnText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
});
