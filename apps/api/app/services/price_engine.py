from __future__ import annotations

from app.models.schemas import Itinerary, ItineraryPriceQuote, PriceBreakdownItem, TravelQuote
from app.services.amap_service import amap_service


def describe_price_sources(data_sources: list[str]) -> str:
    labels = {
        "amap": "路线参考高德地图",
        "estimate": "费用含估算",
    }
    if not data_sources:
        return "费用含估算"
    mapped = [labels.get(source, source) for source in data_sources]
    if "费用含估算" not in mapped:
        mapped.append("餐饮/住宿含估算")
    return " · ".join(dict.fromkeys(mapped))


class PriceEngine:
    DEFAULT_FOOD = 100
    DEFAULT_HOTEL = 380
    DEFAULT_TRANSPORT = 80

    def quote_itinerary(self, itinerary: Itinerary) -> ItineraryPriceQuote:
        transport = 0
        food = 0
        hotel = 0
        other = 0
        breakdown: list[PriceBreakdownItem] = []
        total_minutes = 0
        sources: set[str] = set()

        items = itinerary.items
        for index, item in enumerate(items):
            if item.estimated_cost:
                amount = item.estimated_cost
            elif item.category == "food":
                amount = self.DEFAULT_FOOD
            elif item.category == "hotel":
                amount = self.DEFAULT_HOTEL
            elif item.category == "transport":
                amount = self.DEFAULT_TRANSPORT
            else:
                amount = 0

            if item.category == "food":
                food += amount
            elif item.category == "hotel":
                hotel += amount
            elif item.category == "transport":
                transport += amount
            elif amount:
                other += amount

            if amount:
                breakdown.append(
                    PriceBreakdownItem(
                        label=item.title,
                        amount=amount,
                        source=item.booking_source or "estimate",
                        detail=item.location or item.description,
                    )
                )

            if index > 0:
                prev = items[index - 1]
                if prev.geo_lat and prev.geo_lng and item.geo_lat and item.geo_lng:
                    route = amap_service.route_estimate(prev.geo_lng, prev.geo_lat, item.geo_lng, item.geo_lat)
                    leg_cost = route.get("taxi_cost_yuan", 0) + route.get("tolls_yuan", 0)
                    transport += leg_cost
                    total_minutes += route.get("duration_minutes", 0)
                    source = route.get("source", "estimate")
                    sources.add(source)
                    breakdown.append(
                        PriceBreakdownItem(
                            label=f"{prev.title} → {item.title}",
                            amount=leg_cost,
                            source=source,
                            detail=f"{route.get('distance_km', 0)}km / {route.get('duration_minutes', 0)}分钟",
                        )
                    )

        total = transport + food + hotel + other
        hours = total_minutes // 60
        mins = total_minutes % 60
        duration_text = f"{hours}h{mins}m" if total_minutes else f"{max(1, len(items))}个节点"
        if not sources:
            sources.add("estimate")

        return ItineraryPriceQuote(
            transport=transport,
            food=food,
            hotel=hotel,
            other=other,
            total=total,
            breakdown=breakdown,
            duration_text=duration_text,
            data_sources=sorted(sources),
        )

    def to_travel_quote(self, itinerary: Itinerary, price: ItineraryPriceQuote, strategy: str) -> TravelQuote:
        hotel_item = next((item for item in itinerary.items if item.category == "hotel"), None)
        transport_item = next((item for item in itinerary.items if item.category == "transport"), None)
        return TravelQuote(
            flight=transport_item.title if transport_item else "交通费用按高德路线估算",
            hotel=hotel_item.title if hotel_item else f"{itinerary.intent.destination}酒店待选定",
            local_transport=f"市内交通 ¥{price.transport}（{describe_price_sources(price.data_sources)}）",
            total_price=price.total,
            duration_text=price.duration_text,
            comfort_score=90 if strategy == "balanced" else 82 if strategy == "fastest" else 76,
            risk_level="low" if price.total < 3000 else "medium",
        )


price_engine = PriceEngine()
