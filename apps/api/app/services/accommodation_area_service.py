from __future__ import annotations

import json
from typing import Iterable

from app.models.schemas import (
    AccommodationAreaCandidate,
    Itinerary,
    ItineraryItem,
    RecommendAccommodationAreaRequest,
    RecommendAccommodationAreaResponse,
)
from app.services.amap_service import amap_service
from app.services.llm import llm_service
from app.services.store import store


ANCHOR_WEIGHTS = {
    "meeting": 1.0,
    "transport": 0.9,
    "sight": 0.75,
    "food": 0.55,
    "hotel": 0.2,
    "free": 0.35,
    "alert": 0.1,
}

NEGATIVE_PHRASES = ["不推荐", "不建议", "过远", "太远", "缺点", "风险", "不可控", "不适合"]


class AccommodationAreaService:
    def recommend(self, request: RecommendAccommodationAreaRequest) -> RecommendAccommodationAreaResponse:
        itinerary = store.get_itinerary(request.itinerary_id) if request.itinerary_id else None
        city = request.city.strip() or (itinerary.intent.destination if itinerary else "")
        if not city:
            city = "目的地"

        candidates = self._build_candidates(city, itinerary, request)
        candidates = self._dedupe(candidates)[:3]
        candidates = self._polish_with_llm(city, itinerary, request, candidates)

        summary = self._summary(city, itinerary, candidates)
        top = candidates[0].name if candidates else f"{city}核心区"
        llm_recommendation = (
            f"首推「{top}」。建议先选择片区，再进入具体酒店列表，避免只按单店评分导致位置不顺路。"
            if candidates
            else f"暂未形成明确片区，建议先补充{city}的会场、车站或必去地点。"
        )
        return RecommendAccommodationAreaResponse(
            candidates=candidates,
            summary=summary,
            llm_recommendation=llm_recommendation,
        )

    def _build_candidates(
        self,
        city: str,
        itinerary: Itinerary | None,
        request: RecommendAccommodationAreaRequest,
    ) -> list[AccommodationAreaCandidate]:
        anchors = self._anchors(itinerary)
        if not anchors:
            return self._fallback_city_candidates(city, request)

        key_anchor = anchors[0]
        candidates = [
            self._candidate_near_anchor(city, key_anchor, request),
            self._candidate_transport_balanced(city, anchors, request),
            self._candidate_budget_buffer(city, anchors, request),
        ]
        return candidates

    def _anchors(self, itinerary: Itinerary | None) -> list[ItineraryItem]:
        if itinerary is None:
            return []
        anchors = [
            item
            for item in itinerary.items
            if item.category != "hotel" and item.category != "alert" and (item.location or item.title)
        ]
        return sorted(
            anchors,
            key=lambda item: (
                -ANCHOR_WEIGHTS.get(item.category, 0.3),
                item.day,
                item.start_time,
            ),
        )

    def _candidate_near_anchor(
        self,
        city: str,
        anchor: ItineraryItem,
        request: RecommendAccommodationAreaRequest,
    ) -> AccommodationAreaCandidate:
        minutes = self._minutes(anchor, anchor)
        area = self._area_name(anchor)
        price = self._price_range(request, "near")
        return AccommodationAreaCandidate(
            name=f"{area}近场片区",
            area=area,
            search_keyword=f"{area} 酒店",
            reason=f"最贴近关键节点「{anchor.title}」，适合优先保障准时到达和少步行体验。",
            pros=["离核心行程最近", "雨天或早高峰更稳", "适合会议/比赛/赶时间场景"],
            cons=["建议提前锁定可免费取消房源", "适合优先筛选交通便利型酒店"],
            best_for="准时优先、少折腾、行程中有硬锚点",
            geo_lat=anchor.geo_lat,
            geo_lng=anchor.geo_lng,
            distance_minutes_to_key_anchor=minutes,
            estimated_price_range=price,
            score=94,
        )

    def _candidate_transport_balanced(
        self,
        city: str,
        anchors: list[ItineraryItem],
        request: RecommendAccommodationAreaRequest,
    ) -> AccommodationAreaCandidate:
        transport = next((item for item in anchors if item.category == "transport"), None)
        key = transport or anchors[0]
        area = self._area_name(key)
        minutes = self._minutes(key, anchors[0])
        score = 88 if transport else 84
        return AccommodationAreaCandidate(
            name=f"{area}交通平衡片区",
            area=area,
            search_keyword=f"{area} 地铁 酒店",
            reason="兼顾抵达/离开与市内移动，适合多节点行程。",
            pros=["交通连接更稳", "适合早到晚走", "酒店选择通常更多"],
            cons=["建议搭配地铁/打车双路线备选", "适合预留更从容的出发时间"],
            best_for="多天行程、跨区移动、需要兼顾车站机场",
            geo_lat=key.geo_lat,
            geo_lng=key.geo_lng,
            distance_minutes_to_key_anchor=minutes,
            estimated_price_range=self._price_range(request, "balanced"),
            score=score,
        )

    def _candidate_budget_buffer(
        self,
        city: str,
        anchors: list[ItineraryItem],
        request: RecommendAccommodationAreaRequest,
    ) -> AccommodationAreaCandidate:
        soft_anchor = next((item for item in anchors if item.category in {"food", "sight", "free"}), anchors[-1])
        area = self._area_name(soft_anchor)
        minutes = self._minutes(soft_anchor, anchors[0])
        return AccommodationAreaCandidate(
            name=f"{area}性价比缓冲片区",
            area=area,
            search_keyword=f"{area} 性价比 酒店",
            reason="在保持顺路可达的基础上，通常能获得更丰富的房型选择。",
            pros=["预算更友好", "可选房型更多", "适合宽松节奏"],
            cons=["建议选择近地铁或主干路的酒店", "适合把出发提醒设置得更充裕"],
            best_for="预算敏感、行程节奏较宽松、希望房型选择更多",
            geo_lat=soft_anchor.geo_lat,
            geo_lng=soft_anchor.geo_lng,
            distance_minutes_to_key_anchor=minutes,
            estimated_price_range=self._price_range(request, "budget"),
            score=80,
        )

    def _fallback_city_candidates(
        self,
        city: str,
        request: RecommendAccommodationAreaRequest,
    ) -> list[AccommodationAreaCandidate]:
        base_price = self._price_range(request, "balanced")
        return [
            AccommodationAreaCandidate(
                name=f"{city}核心商圈片区",
                area=f"{city}市中心",
                search_keyword=f"{city} 市中心 酒店",
                reason="缺少明确行程锚点时，核心商圈通常交通和餐饮最稳。",
                pros=["交通便利", "餐饮选择多", "适合首次到访"],
                cons=["建议优先筛选评分稳定、交通便利的酒店"],
                best_for="信息不完整时的稳妥默认选择",
                estimated_price_range=base_price,
                score=86,
            ),
            AccommodationAreaCandidate(
                name=f"{city}车站/机场接驳片区",
                area=f"{city}车站附近",
                search_keyword=f"{city} 车站 酒店",
                reason="适合早到、晚走或携带较多行李的行程。",
                pros=["抵离方便", "减少跨城通勤压力"],
                cons=["建议结合首日抵达和末日返程时间选择"],
                best_for="交通优先",
                estimated_price_range=self._price_range(request, "budget"),
                score=78,
            ),
        ]

    def _minutes(self, origin: ItineraryItem, dest: ItineraryItem) -> int | None:
        if origin.geo_lat and origin.geo_lng and dest.geo_lat and dest.geo_lng:
            route = amap_service.route_estimate(origin.geo_lng, origin.geo_lat, dest.geo_lng, dest.geo_lat)
            return int(route.get("duration_minutes") or 0)
        return None

    @staticmethod
    def _area_name(item: ItineraryItem) -> str:
        location = item.location or item.title
        for suffix in ["附近", "周边", "酒店", "入口", "T3", "T2", "T1"]:
            location = location.replace(suffix, "")
        return location[:12]

    @staticmethod
    def _price_range(request: RecommendAccommodationAreaRequest, tier: str) -> str:
        preference = " ".join(filter(None, [request.preference or "", request.budget or ""]))
        if "豪华" in preference:
            return "约 ¥800-1500/晚"
        if "高档" in preference:
            return "约 ¥500-900/晚"
        if "低预算" in preference or "便宜" in preference or tier == "budget":
            return "约 ¥250-450/晚"
        if tier == "near":
            return "约 ¥450-800/晚"
        return "约 ¥350-650/晚"

    @staticmethod
    def _dedupe(candidates: Iterable[AccommodationAreaCandidate]) -> list[AccommodationAreaCandidate]:
        seen: set[str] = set()
        result: list[AccommodationAreaCandidate] = []
        for candidate in candidates:
            key = candidate.area
            if key in seen:
                continue
            seen.add(key)
            result.append(candidate)
        return sorted(result, key=lambda item: item.score, reverse=True)

    def _polish_with_llm(
        self,
        city: str,
        itinerary: Itinerary | None,
        request: RecommendAccommodationAreaRequest,
        candidates: list[AccommodationAreaCandidate],
    ) -> list[AccommodationAreaCandidate]:
        if not candidates or not llm_service.configured:
            return candidates

        payload = [candidate.model_dump() for candidate in candidates]
        anchor_payload = []
        if itinerary:
            anchor_payload = [
                {
                    "title": item.title,
                    "location": item.location,
                    "category": item.category,
                    "day": item.day,
                    "start_time": item.start_time,
                }
                for item in self._anchors(itinerary)[:8]
            ]
        prompt = f"""
你是旅行住宿片区规划助手。请基于行程锚点优化住宿片区候选的推荐理由。

城市：{city}
用户偏好：{request.preference or "未指定"}
预算：{request.budget or "未指定"}
行程锚点：{json.dumps(anchor_payload, ensure_ascii=False)}
候选片区：{json.dumps(payload, ensure_ascii=False)}

请返回 JSON：
{{
  "items": [
    {{
      "id": "候选 id",
      "reason": "一句明确推荐理由",
      "pros": ["最多3条优势"],
      "cons": ["最多2条正向适配建议，避免不推荐、缺点、过远、风险等负向表达"],
      "best_for": "适合人群/场景",
      "score": 0-100
    }}
  ],
  "summary": "一句整体建议"
}}
只返回 JSON。
"""
        try:
            client = llm_service._client()
            response = client.chat.completions.create(
                model=llm_service.settings.llm_model,
                temperature=0.25,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "你是住宿片区推荐助手，只返回 JSON。"},
                    {"role": "user", "content": prompt},
                ],
            )
            data = json.loads(response.choices[0].message.content or "{}")
            updates = {item.get("id"): item for item in data.get("items", [])}
            polished: list[AccommodationAreaCandidate] = []
            for candidate in candidates:
                update = updates.get(candidate.id)
                if not update:
                    polished.append(candidate)
                    continue
                tips = self._positive_tips(update.get("cons") or candidate.cons)
                polished.append(
                    candidate.model_copy(
                        update={
                            "reason": self._positive_text(update.get("reason") or candidate.reason),
                            "pros": update.get("pros") or candidate.pros,
                            "cons": tips,
                            "best_for": update.get("best_for") or candidate.best_for,
                            "score": int(update.get("score") or candidate.score),
                        }
                    )
                )
            return sorted(polished, key=lambda item: item.score, reverse=True)
        except Exception:
            return candidates

    @staticmethod
    def _positive_text(text: str) -> str:
        if any(phrase in text for phrase in NEGATIVE_PHRASES):
            return "该片区更适合作为有明确出行节奏时的备选住宿范围。"
        return text

    @staticmethod
    def _positive_tips(items: list[str]) -> list[str]:
        cleaned = [item for item in items if not any(phrase in item for phrase in NEGATIVE_PHRASES)]
        return cleaned[:2] or ["建议结合出发时间和交通方式筛选酒店"]

    @staticmethod
    def _summary(city: str, itinerary: Itinerary | None, candidates: list[AccommodationAreaCandidate]) -> str:
        if not candidates:
            return f"暂未形成{city}住宿片区建议。"
        anchor_count = len([item for item in itinerary.items if item.category != "hotel"]) if itinerary else 0
        if anchor_count:
            return f"已根据 {anchor_count} 个行程锚点，为{city}筛选 {len(candidates)} 个住宿片区。"
        return f"已根据当前目的地信息，为{city}筛选 {len(candidates)} 个住宿片区。"


accommodation_area_service = AccommodationAreaService()
