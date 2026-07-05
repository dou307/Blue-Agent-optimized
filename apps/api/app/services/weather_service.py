from __future__ import annotations

import logging
from datetime import datetime, timedelta
from time import time
from typing import Any

import httpx

from app.core.config import get_settings
from app.models.schemas import ItemWeatherInfo, Itinerary, ItineraryWeatherResponse

logger = logging.getLogger(__name__)

OUTDOOR_CATEGORIES = {"sight", "transport"}
INDEX_TYPES = "1,3,5,6,8,15,16"


def _parse_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(float(str(value)))
    except (TypeError, ValueError):
        return None


def _parse_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(str(value))
    except (TypeError, ValueError):
        return None


def _parse_fx_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _safe_date(start_date: str | None, day: int) -> str | None:
    if not start_date:
        return None
    try:
        base = datetime.fromisoformat(f"{start_date}T00:00:00")
        return (base + timedelta(days=max(0, day - 1))).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _safe_datetime(start_date: str | None, day: int, start_time: str) -> datetime | None:
    date = _safe_date(start_date, day)
    if not date:
        return None
    try:
        return datetime.fromisoformat(f"{date}T{start_time}:00")
    except ValueError:
        return None


def _wind_level(value: str | None) -> int | None:
    if not value:
        return None
    digits = [int(char) for char in value if char.isdigit()]
    return max(digits) if digits else None


class QWeatherService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    @property
    def api_key(self) -> str | None:
        return self.settings.qweather_api_key or self.settings.weather_api_key

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def city_weather_summary(self, city: str | None, target_date: str | None = None) -> dict[str, Any]:
        if not self.configured:
            return {
                "available": False,
                "detail": "未配置和风天气 API Key，暂不能获取实时天气。",
                "status": "warn",
            }
        if not city:
            return {
                "available": False,
                "detail": "目的地缺失，暂不能查询天气。",
                "status": "warn",
            }

        try:
            location_id = self._lookup_city_id(city)
            daily = self._get("/v7/weather/7d", {"location": location_id}, ttl_seconds=10800).get("daily", [])
        except Exception as error:
            logger.warning("QWeather city summary failed: %s", error)
            return {
                "available": False,
                "detail": "和风天气接口暂不可用，天气信息未更新。",
                "status": "warn",
            }

        day = self._select_daily_weather(daily, target_date)
        if not day:
            return {
                "available": False,
                "detail": "和风天气未返回可用预报，天气信息未更新。",
                "status": "warn",
            }

        text = str(day.get("textDay") or day.get("textNight") or "天气待更新")
        temp_min = str(day.get("tempMin") or "")
        temp_max = str(day.get("tempMax") or "")
        pop = str(day.get("pop") or "0")
        wind_dir = str(day.get("windDirDay") or "")
        wind_scale = str(day.get("windScaleDay") or "")
        fx_date = str(day.get("fxDate") or target_date or "近日")
        risk_tags, risk_level, advice = self._risk(
            text=text,
            temp=_parse_int(temp_max),
            pop=_parse_int(pop),
            precip=_parse_float(day.get("precip")),
            wind_scale=wind_scale,
            category="sight",
        )

        temp_label = f"{temp_min}~{temp_max}°C" if temp_min and temp_max else "温度待更新"
        wind_label = f"{wind_dir}{wind_scale}级" if wind_dir or wind_scale else "风力待更新"
        detail = f"{fx_date} {city}：{text}，{temp_label}，降水概率 {pop}%，{wind_label}。"
        if risk_tags:
            detail += f" {'、'.join(risk_tags)}，{advice}"
        else:
            detail += " 天气风险较低。"
        return {"available": True, "detail": detail, "status": "warn" if risk_level != "low" else "ok"}

    def itinerary_weather(self, itinerary: Itinerary) -> ItineraryWeatherResponse:
        if not self.configured:
            return ItineraryWeatherResponse(
                available=False,
                summary="天气暂不可用：未配置 QWEATHER_API_KEY。",
                warnings=["未配置和风天气 API Key"],
            )

        location = self._representative_location(itinerary)
        if not location:
            return ItineraryWeatherResponse(
                available=False,
                summary="天气暂不可用：当前行程节点缺少可用坐标。",
                warnings=["缺少节点坐标"],
            )

        try:
            hourly = self._get("/v7/weather/72h", {"location": location}, ttl_seconds=1800).get("hourly", [])
            daily = self._get("/v7/weather/7d", {"location": location}, ttl_seconds=10800).get("daily", [])
            indices = self._get(
                "/v7/indices/3d",
                {"location": location, "type": INDEX_TYPES},
                ttl_seconds=10800,
            ).get("daily", [])
        except Exception as error:
            logger.warning("QWeather request failed: %s", error)
            return ItineraryWeatherResponse(
                available=False,
                summary="天气暂不可用，已按原行程展示。",
                warnings=["和风天气接口请求失败"],
            )

        item_weather = [
            self._weather_for_item(itinerary, item, hourly, daily, indices)
            for item in itinerary.items
            if item.category in OUTDOOR_CATEGORIES
        ]
        risk_count = sum(1 for item in item_weather if item.risk_level != "low")
        summary = (
            f"已接入和风天气，识别 {len(item_weather)} 个户外/交通节点，{risk_count} 个节点需要天气关注。"
            if item_weather
            else "已接入和风天气，当前行程暂无需要重点标注的户外/交通节点。"
        )
        return ItineraryWeatherResponse(available=True, summary=summary, item_weather=item_weather)

    def weather_context_for_llm(self, weather: ItineraryWeatherResponse) -> list[dict[str, Any]]:
        return [
            {
                "item_id": item.item_id,
                "date": item.date,
                "time": item.time,
                "weather": item.label,
                "risk_level": item.risk_level,
                "risk_tags": item.risk_tags,
                "advice": item.advice,
                "indices": item.indices,
            }
            for item in weather.item_weather
        ]

    def _get(self, path: str, params: dict[str, str], ttl_seconds: int) -> dict[str, Any]:
        host = self.settings.qweather_api_host.rstrip("/")
        cache_key = f"{host}{path}?{tuple(sorted(params.items()))}"
        cached = self._cache.get(cache_key)
        if cached and time() - cached[0] < ttl_seconds:
            return cached[1]

        headers = {"X-QW-Api-Key": self.api_key or ""}
        query = dict(params)
        query["key"] = self.api_key or ""
        with httpx.Client(timeout=12.0) as client:
            response = client.get(f"{host}{path}", params=query, headers=headers)
            response.raise_for_status()
            payload = response.json()

        if payload.get("code") != "200":
            raise RuntimeError(f"QWeather code={payload.get('code')}")
        self._cache[cache_key] = (time(), payload)
        return payload

    @staticmethod
    def _representative_location(itinerary: Itinerary) -> str | None:
        for item in itinerary.items:
            if item.geo_lng is not None and item.geo_lat is not None:
                return f"{item.geo_lng:.6f},{item.geo_lat:.6f}"
        return None

    def _lookup_city_id(self, city: str) -> str:
        payload = self._get("/geo/v2/city/lookup", {"location": city}, ttl_seconds=86400)
        locations = payload.get("location") or []
        if not locations:
            raise RuntimeError("QWeather city lookup returned empty location")
        return str(locations[0].get("id") or "")

    @staticmethod
    def _select_daily_weather(daily: list[dict[str, Any]], target_date: str | None) -> dict[str, Any] | None:
        if not daily:
            return None
        if target_date:
            matched = next((entry for entry in daily if entry.get("fxDate") == target_date), None)
            if matched:
                return matched
        return daily[0]

    def _weather_for_item(
        self,
        itinerary: Itinerary,
        item: Any,
        hourly: list[dict[str, Any]],
        daily: list[dict[str, Any]],
        indices: list[dict[str, Any]],
    ) -> ItemWeatherInfo:
        target_dt = _safe_datetime(itinerary.intent.start_date, item.day, item.start_time)
        target_date = _safe_date(itinerary.intent.start_date, item.day)
        hour = self._nearest_hour(hourly, target_dt)
        day = next((entry for entry in daily if entry.get("fxDate") == target_date), None) or (daily[0] if daily else {})
        day_indices = [
            f"{entry.get('name')}：{entry.get('category')}"
            for entry in indices
            if entry.get("date") == target_date and entry.get("name") and entry.get("category")
        ][:4]

        text = str(hour.get("text") or day.get("textDay") or "")
        temp = _parse_int(hour.get("temp") or day.get("tempMax"))
        pop = _parse_int(hour.get("pop"))
        precip = _parse_float(hour.get("precip"))
        wind_scale = str(hour.get("windScale") or day.get("windScaleDay") or "")
        wind_dir = str(hour.get("windDir") or day.get("windDirDay") or "")
        risk_tags, risk_level, advice = self._risk(text, temp, pop, precip, wind_scale, item.category)
        label_parts = [text or "天气待更新"]
        if temp is not None:
            label_parts.append(f"{temp}°C")
        if pop is not None:
            label_parts.append(f"降水{pop}%")
        if wind_scale:
            label_parts.append(f"{wind_dir}{wind_scale}级")

        return ItemWeatherInfo(
            item_id=item.id,
            date=target_date,
            time=item.start_time,
            text=text,
            temp=temp,
            feels_like=_parse_int(hour.get("feelsLike")),
            pop=pop,
            precip=precip,
            wind_dir=wind_dir or None,
            wind_scale=wind_scale or None,
            daily_text=str(day.get("textDay") or "") or None,
            indices=day_indices,
            risk_level=risk_level,
            risk_tags=risk_tags,
            advice=advice,
            label=" · ".join(label_parts),
        )

    @staticmethod
    def _nearest_hour(hourly: list[dict[str, Any]], target_dt: datetime | None) -> dict[str, Any]:
        if not hourly:
            return {}
        if target_dt is None:
            return hourly[0]
        candidates: list[tuple[float, dict[str, Any]]] = []
        for entry in hourly:
            fx_time = _parse_fx_time(entry.get("fxTime"))
            if fx_time is not None:
                candidates.append((abs((fx_time - target_dt).total_seconds()), entry))
        return min(candidates, key=lambda item: item[0])[1] if candidates else hourly[0]

    @staticmethod
    def _risk(
        text: str,
        temp: int | None,
        pop: int | None,
        precip: float | None,
        wind_scale: str | None,
        category: str,
    ) -> tuple[list[str], str, str]:
        tags: list[str] = []
        if any(token in text for token in ["雨", "雪", "雷", "冰雹"]) or (pop is not None and pop >= 50) or (
            precip is not None and precip >= 1
        ):
            tags.append("降水关注")
        if temp is not None and temp >= 33:
            tags.append("高温关注")
        if temp is not None and temp <= 5:
            tags.append("低温关注")
        if (_wind_level(wind_scale) or 0) >= 5:
            tags.append("风力关注")

        level = "high" if len(tags) >= 2 else "medium" if tags else "low"
        if not tags:
            return tags, level, "天气适宜，按原计划推进。"
        if category == "transport":
            return tags, level, "建议预留更充足的步行与接驳时间。"
        return tags, level, "建议优先安排室内备选或调整到更舒适时段。"


weather_service = QWeatherService()
