from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

AMAP_TYPES = {
    "food": "050000",
    "hotel": "100000",
    "sight": "110000",
}


class AmapService:
    BASE = "https://restapi.amap.com/v3"

    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def configured(self) -> bool:
        return bool(self.settings.amap_api_key)

    def traffic_summary(self, origin: str | None, destination: str | None) -> dict[str, Any]:
        if not self.configured:
            return {
                "available": False,
                "detail": "未配置高德 API Key，暂不能获取实时路况。",
                "status": "warn",
            }
        if not origin or not destination:
            return {
                "available": False,
                "detail": "出发地或目的地缺失，暂不能调用高德路况。",
                "status": "warn",
            }

        try:
            origin_geo = self.geocode(origin)
            destination_geo = self.geocode(destination)
            if not origin_geo or not destination_geo:
                return {
                    "available": False,
                    "detail": "高德未解析到出发地或目的地坐标，路况暂不可用。",
                    "status": "warn",
                }
            route = self._driving_route_live(origin_geo["location"], destination_geo["location"])
        except Exception as error:
            logger.warning("Amap traffic summary error: %s", error)
            return {
                "available": False,
                "detail": "高德路况接口暂不可用，路况信息未更新。",
                "status": "warn",
            }

        if not route:
            return {
                "available": False,
                "detail": "高德未返回可用路线，路况暂不可用。",
                "status": "warn",
            }

        distance_km = round(int(route.get("distance") or 0) / 1000, 1)
        duration_minutes = max(1, int(route.get("duration") or 0) // 60)
        congestion, has_risk = self._traffic_status(route)
        status = "warn" if has_risk else "ok"
        detail = f"高德实时路线：{origin} 到 {destination} 约 {distance_km} 公里，预计 {duration_minutes} 分钟；{congestion}。"
        return {"available": True, "detail": detail, "status": status}

    def geocode(self, address: str) -> dict[str, str] | None:
        if not self.configured or not address:
            return None
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                f"{self.BASE}/geocode/geo",
                params={"key": self.settings.amap_api_key, "address": address},
            )
            response.raise_for_status()
            payload = response.json()
        if payload.get("status") != "1":
            logger.warning("Amap geocode failed: %s", payload.get("info"))
            return None
        geocodes = payload.get("geocodes") or []
        if not geocodes:
            return None
        first = geocodes[0]
        location = str(first.get("location") or "")
        if "," not in location:
            return None
        return {
            "location": location,
            "formatted_address": str(first.get("formatted_address") or address),
        }

    def search_poi(self, city: str, keywords: str, category: str = "food", limit: int = 8) -> list[dict[str, Any]]:
        if not self.configured:
            return self._fallback_poi(city, keywords, category)

        poi_type = AMAP_TYPES.get(category, "050000")
        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(
                    f"{self.BASE}/place/text",
                    params={
                        "key": self.settings.amap_api_key,
                        "keywords": keywords,
                        "city": city,
                        "citylimit": "true",
                        "types": poi_type,
                        "offset": limit,
                        "page": 1,
                        "extensions": "all",
                    },
                )
                response.raise_for_status()
                payload = response.json()
                if payload.get("status") != "1":
                    logger.warning("Amap POI search failed: %s", payload.get("info"))
                    return self._fallback_poi(city, keywords, category)
                return payload.get("pois") or []
        except Exception as error:
            logger.warning("Amap POI search error: %s", error)
            return self._fallback_poi(city, keywords, category)

    def route_estimate(
        self,
        origin_lng: float,
        origin_lat: float,
        dest_lng: float,
        dest_lat: float,
        strategy: int = 0,
    ) -> dict[str, Any]:
        if not self.configured:
            return self._fallback_route(origin_lng, origin_lat, dest_lng, dest_lat)

        try:
            with httpx.Client(timeout=15.0) as client:
                response = client.get(
                    f"{self.BASE}/direction/driving",
                    params={
                        "key": self.settings.amap_api_key,
                        "origin": f"{origin_lng},{origin_lat}",
                        "destination": f"{dest_lng},{dest_lat}",
                        "strategy": strategy,
                        "extensions": "all",
                    },
                )
                response.raise_for_status()
                payload = response.json()
                if payload.get("status") != "1":
                    return self._fallback_route(origin_lng, origin_lat, dest_lng, dest_lat)
                route = (payload.get("route") or {}).get("paths") or []
                if not route:
                    return self._fallback_route(origin_lng, origin_lat, dest_lng, dest_lat)
                best = route[0]
                distance_m = int(best.get("distance") or 0)
                duration_s = int(best.get("duration") or 0)
                tolls = float(best.get("tolls") or 0)
                taxi_cost = float(best.get("taxi_cost") or 0)
                return {
                    "distance_km": round(distance_m / 1000, 1),
                    "duration_minutes": max(1, duration_s // 60),
                    "tolls_yuan": int(tolls),
                    "taxi_cost_yuan": int(taxi_cost) if taxi_cost else self._estimate_taxi(distance_m),
                    "source": "amap",
                }
        except Exception as error:
            logger.warning("Amap route error: %s", error)
            return self._fallback_route(origin_lng, origin_lat, dest_lng, dest_lat)

    @staticmethod
    def _estimate_taxi(distance_m: int) -> int:
        km = distance_m / 1000
        return max(15, int(13 + km * 2.5))

    @staticmethod
    def _fallback_route(origin_lng: float, origin_lat: float, dest_lng: float, dest_lat: float) -> dict[str, Any]:
        dx = abs(origin_lng - dest_lng)
        dy = abs(origin_lat - dest_lat)
        distance_km = round((dx * 85 + dy * 111), 1)
        duration_minutes = max(10, int(distance_km * 3))
        return {
            "distance_km": distance_km,
            "duration_minutes": duration_minutes,
            "tolls_yuan": 0,
            "taxi_cost_yuan": max(15, int(13 + distance_km * 2.5)),
            "source": "estimate",
        }

    def _driving_route_live(self, origin_location: str, destination_location: str) -> dict[str, Any] | None:
        with httpx.Client(timeout=15.0) as client:
            response = client.get(
                f"{self.BASE}/direction/driving",
                params={
                    "key": self.settings.amap_api_key,
                    "origin": origin_location,
                    "destination": destination_location,
                    "strategy": 0,
                    "extensions": "all",
                },
            )
            response.raise_for_status()
            payload = response.json()
        if payload.get("status") != "1":
            logger.warning("Amap live route failed: %s", payload.get("info"))
            return None
        paths = (payload.get("route") or {}).get("paths") or []
        return paths[0] if paths else None

    @staticmethod
    def _traffic_status(route: dict[str, Any]) -> tuple[str, bool]:
        status_distance: dict[str, int] = {}
        for step in route.get("steps") or []:
            for tmc in step.get("tmcs") or []:
                status = str(tmc.get("status") or "未知")
                try:
                    distance = int(tmc.get("distance") or 0)
                except (TypeError, ValueError):
                    distance = 0
                status_distance[status] = status_distance.get(status, 0) + distance

        status_distance = {status: distance for status, distance in status_distance.items() if distance > 0}
        if not status_distance:
            return "高德未返回分段拥堵状态", False

        total = sum(status_distance.values()) or 1
        ranked = sorted(status_distance.items(), key=lambda item: item[1], reverse=True)
        labels = []
        for status, distance in ranked[:3]:
            percent = distance / total * 100
            percent_label = "<1%" if 0 < percent < 1 else f"{round(percent)}%"
            labels.append(f"{status}{percent_label}")
        has_risk = any(status in {"缓行", "拥堵", "严重拥堵"} for status, distance in status_distance.items() if distance > 0)
        return "路况占比 " + "、".join(labels), has_risk

    @staticmethod
    def _fallback_poi(city: str, keywords: str, category: str) -> list[dict[str, Any]]:
        if category == "hotel":
            return [
                {
                    "id": "mock-hotel-1",
                    "name": f"{city}市中心精选酒店",
                    "address": f"{city}核心区",
                    "location": "116.397,39.918",
                    "biz_ext": {"rating": "4.6", "cost": "480"},
                    "type": "酒店",
                },
                {
                    "id": "mock-hotel-2",
                    "name": f"{city}景观商务酒店",
                    "address": f"{city}景区附近",
                    "location": "116.420,39.930",
                    "biz_ext": {"rating": "4.4", "cost": "360"},
                    "type": "酒店",
                },
            ]
        return [
            {
                "id": "mock-food-1",
                "name": f"{city}{keywords}人气店",
                "address": f"{city}美食街",
                "location": "116.397,39.918",
                "biz_ext": {"rating": "4.7", "cost": "120"},
                "type": "餐饮",
            },
            {
                "id": "mock-food-2",
                "name": f"{city}老字号{keywords}",
                "address": f"{city}老城区",
                "location": "116.410,39.925",
                "biz_ext": {"rating": "4.5", "cost": "95"},
                "type": "餐饮",
            },
        ]


amap_service = AmapService()
