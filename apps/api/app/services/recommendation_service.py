from __future__ import annotations

import json
from typing import Any

from app.agent.node_meta import apply_node_metadata
from app.integrations.deeplinks import attach_platform_scores, build_deeplinks
from app.models.schemas import (
    ConfirmPOIRequest,
    Itinerary,
    ItineraryItem,
    POICandidate,
    RecommendPOIRequest,
    RecommendPOIResponse,
)
from app.services.amap_service import amap_service
from app.services.llm import llm_service
from app.services.store import store

KNOWN_CITY_NAMES = [
    "北京",
    "上海",
    "广州",
    "深圳",
    "成都",
    "杭州",
    "西安",
    "南京",
    "重庆",
    "苏州",
    "天津",
]


class RecommendationService:
    def recommend(self, request: RecommendPOIRequest) -> RecommendPOIResponse:
        pois = amap_service.search_poi(request.city, request.keyword, request.category, limit=8)
        candidates: list[POICandidate] = []

        for poi in pois:
            if request.category == "hotel" and not self._is_poi_in_destination(poi, request.city):
                continue
            candidate = self._poi_to_candidate(poi, request)
            if request.near_lat is not None and request.near_lng is not None and candidate.geo_lat and candidate.geo_lng:
                route = amap_service.route_estimate(
                    request.near_lng,
                    request.near_lat,
                    candidate.geo_lng,
                    candidate.geo_lat,
                )
                candidate = candidate.model_copy(
                    update={
                        "distance_km": route.get("distance_km"),
                        "duration_minutes": route.get("duration_minutes"),
                    }
                )
            candidate = attach_platform_scores(candidate, request.keyword)
            candidates.append(candidate)

        ranked = self._rank_with_llm(request, candidates)
        top_pick = ranked[0].name if ranked else "暂无推荐"
        summary = f"在{request.city}找到 {len(ranked)} 家「{request.keyword}」相关{self._category_label(request.category)}候选。"
        llm_recommendation = self._build_recommendation_text(request, ranked, top_pick)
        return RecommendPOIResponse(
            candidates=ranked,
            summary=summary,
            llm_recommendation=llm_recommendation,
        )

    def confirm_selection(self, request: ConfirmPOIRequest) -> Itinerary:
        itinerary = store.get_itinerary(request.itinerary_id)
        if itinerary is None:
            raise ValueError("Itinerary not found")

        candidate = request.candidate
        item = apply_node_metadata(
            ItineraryItem(
                day=request.day,
                start_time=request.start_time,
                end_time=request.end_time,
                title=candidate.name,
                location=candidate.location,
                category=candidate.category if candidate.category != "sight" else "sight",
                description=candidate.reason or f"已选择 {candidate.name}，来源 {candidate.primary_source}",
                geo_lat=candidate.geo_lat,
                geo_lng=candidate.geo_lng,
                estimated_cost=candidate.price_estimate,
                booking_source=candidate.primary_source,
                booking_deeplink=(candidate.deeplinks.get("meituan") or candidate.deeplinks.get("ctrip") or ""),
                risk_flags=["用户已确认商户"],
            )
        )

        items = list(itinerary.items)
        if request.replace_item_id:
            index = next((i for i, node in enumerate(items) if node.id == request.replace_item_id), None)
            if index is None:
                raise ValueError("Node to replace not found")
            item.id = items[index].id
            items[index] = item
        elif request.insert_after_item_id:
            index = next((i for i, node in enumerate(items) if node.id == request.insert_after_item_id), -1)
            items.insert(index + 1, item)
        else:
            items.append(item)

        updated = itinerary.model_copy(
            update={
                "items": items,
                "version": itinerary.version + 1,
                "explanation": f"{itinerary.explanation}\n\n已确认节点：{candidate.name}（{candidate.price_label}）",
            }
        )
        return store.save_itinerary(updated)

    def _poi_to_candidate(self, poi: dict[str, Any], request: RecommendPOIRequest) -> POICandidate:
        location = poi.get("location") or ""
        lng = lat = None
        if isinstance(location, str) and "," in location:
            parts = location.split(",")
            lng, lat = float(parts[0]), float(parts[1])

        biz = poi.get("biz_ext") or {}
        rating_raw = biz.get("rating") or poi.get("rating")
        rating = None
        if rating_raw not in (None, "", []):
            try:
                rating = float(rating_raw[0] if isinstance(rating_raw, list) else rating_raw)
            except (TypeError, ValueError):
                rating = None
        cost_raw = biz.get("cost") or poi.get("cost")
        price_estimate = None
        price_label = "价格待确认"
        if cost_raw not in (None, "", []):
            try:
                price_estimate = int(float(str(cost_raw).split("元")[0]))
                if request.category == "hotel":
                    price_label = f"约 ¥{price_estimate}/晚"
                else:
                    price_label = f"约 ¥{price_estimate}/人"
            except ValueError:
                pass
        elif request.category == "hotel":
            price_estimate = 380
            price_label = "约 ¥380/晚（估算）"
        else:
            price_estimate = 100
            price_label = "约 ¥100/人（估算）"

        name = poi.get("name") or request.keyword
        address = poi.get("address") or poi.get("cityname") or request.city
        deeplinks = build_deeplinks(
            name,
            request.city,
            request.category,
            checkin=None,
            checkout=None,
            lat=lat,
            lng=lng,
        )

        return POICandidate(
            id=str(poi.get("id") or name),
            name=name,
            category=request.category,
            address=address,
            location=address,
            geo_lat=lat,
            geo_lng=lng,
            rating=rating,
            price_estimate=price_estimate,
            price_label=price_label,
            primary_source="amap",
            deeplinks=deeplinks,
            tags=[request.keyword, request.category],
        )

    @staticmethod
    def _is_poi_in_destination(poi: dict[str, Any], city: str) -> bool:
        destination = city.strip().replace("市", "")
        cityname = str(poi.get("cityname") or "").replace("市", "")
        adname = str(poi.get("adname") or "")
        address = str(poi.get("address") or "")
        name = str(poi.get("name") or "")
        text = f"{cityname} {adname} {address} {name}"

        if cityname:
            return destination in cityname
        if destination in text:
            return True

        other_city_hit = any(other != destination and other in text for other in KNOWN_CITY_NAMES)
        return not other_city_hit

    def _rank_with_llm(self, request: RecommendPOIRequest, candidates: list[POICandidate]) -> list[POICandidate]:
        if not candidates:
            return []
        if not llm_service.configured:
            return sorted(candidates, key=lambda item: item.rating or 0, reverse=True)

        payload = [
            {
                "id": item.id,
                "name": item.name,
                "rating": item.rating,
                "price_estimate": item.price_estimate,
                "distance_km": item.distance_km,
                "platform_scores": item.platform_scores,
                "tags": item.tags,
            }
            for item in candidates
        ]
        prompt = f"""
你是旅行美食/住宿推荐顾问。用户想在{request.city}找「{request.keyword}」。
候选如下：
{json.dumps(payload, ensure_ascii=False)}

请返回 JSON：
{{
  "ranked_ids": ["按推荐优先级排序的 id"],
  "reasons": {{"id": "推荐理由，需提及口味/性价比/与行程距离，可引用大众点评/美团/小红书口碑"}},
  "top_pick_id": "最推荐 id"
}}
只返回 JSON。
"""
        try:
            client = llm_service._client()
            response = client.chat.completions.create(
                model=llm_service.settings.llm_model,
                temperature=0.3,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "你是旅行 POI 推荐助手，只返回 JSON。"},
                    {"role": "user", "content": prompt},
                ],
            )
            content = response.choices[0].message.content or "{}"
            data = json.loads(content)
            ranked_ids = data.get("ranked_ids") or []
            reasons = data.get("reasons") or {}
            by_id = {item.id: item for item in candidates}
            ranked: list[POICandidate] = []
            for item_id in ranked_ids:
                if item_id in by_id:
                    ranked.append(by_id[item_id].model_copy(update={"reason": reasons.get(item_id, "")}))
            for item in candidates:
                if item.id not in ranked_ids:
                    ranked.append(item)
            return ranked
        except Exception:
            return sorted(candidates, key=lambda item: item.rating or 0, reverse=True)

    def _build_recommendation_text(
        self,
        request: RecommendPOIRequest,
        candidates: list[POICandidate],
        top_pick: str,
    ) -> str:
        if not candidates:
            return f"暂未找到合适的{self._category_label(request.category)}，请调整关键词或区域。"
        best = candidates[0]
        scores = best.platform_scores
        score_text = " / ".join(f"{k}{v}" for k, v in scores.items()) if scores else ""
        reason = best.reason or f"综合评分较高，适合插入第{request.day}天行程。"
        return f"首推「{best.name}」：{reason}（平台参考分：{score_text}）"

    @staticmethod
    def _category_label(category: str) -> str:
        return {"food": "餐厅", "hotel": "酒店", "sight": "景点"}.get(category, "地点")


recommendation_service = RecommendationService()
