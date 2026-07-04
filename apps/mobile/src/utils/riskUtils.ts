import { ItemWeatherInfo, ItineraryItem } from "../types";

const RISK_KEYWORDS = [
  "冲突",
  "延误",
  "拥堵",
  "闭馆",
  "取消",
  "不可控",
  "风险",
  "预警",
  "暴雨",
  "降雨",
  "高温",
  "雷",
  "大风",
];

const NON_RISK_FLAGS = [
  "用户编辑节点",
  "用户调整时间",
  "用户已确认商户",
  "智能联动调整",
  "真实天气优化",
  "已根据用户指令调整时间",
  "因前序节点调整而顺延",
];

export function actionableRiskFlags(flags: string[]) {
  return flags.filter((flag) => {
    if (NON_RISK_FLAGS.some((text) => flag.includes(text))) return false;
    return RISK_KEYWORDS.some((text) => flag.includes(text));
  });
}

export function riskTextForItem(item: ItineraryItem, weather?: ItemWeatherInfo) {
  const risks = [
    ...actionableRiskFlags(item.risk_flags),
    ...(weather && weather.risk_level === "high" ? [weather.advice || weather.label] : []),
  ].filter(Boolean);
  if (item.category === "alert" && !risks.length) risks.push(item.description || "行程存在风险提醒");
  return risks.join("；");
}

export function riskLevelForItem(item: ItineraryItem, weather?: ItemWeatherInfo): "low" | "medium" | "high" {
  if (item.category === "alert" || weather?.risk_level === "high") return "high";
  return riskTextForItem(item, weather) ? "medium" : "low";
}
