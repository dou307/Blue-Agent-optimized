from __future__ import annotations

from copy import deepcopy

from app.agent.graph import travel_agent_graph
from app.models.schemas import (
    AcceptReplanRequest,
    ExecuteOrderRequest,
    GuardianStatus,
    Itinerary,
    ItineraryItem,
    OrderStep,
    PaymentAuthorizationRequest,
    PlanComparison,
    PlanOption,
    PrepareOrderRequest,
    ReplanProposal,
    ReplanRequest,
    SyncItem,
    SystemSyncRequest,
    SystemSyncResult,
    TravelIncident,
    TravelOrder,
    TravelRequestBundle,
    TripReview,
)
from app.services.price_engine import describe_price_sources, price_engine
from app.services.store import store


def _save(kind: str, record_id: str, user_id: str, payload) -> None:
    store.save_record(kind, record_id, user_id, payload.model_dump_json())


class PlanComparisonService:
    def compare(self, request: TravelRequestBundle) -> PlanComparison:
        base_message = self._compose_prompt(request)
        response = travel_agent_graph.invoke(request.user_id, base_message)
        base = response.itinerary
        if base is None:
            raise ValueError("failed to generate itinerary")

        base = self._apply_structured_intent(base, request)
        store.save_itinerary(base)

        base_quote = price_engine.quote_itinerary(base)
        options = [
            self._option(base, "最快抵达方案", "fastest", base_quote, 1.08, 86, "low"),
            self._option(base, "均衡舒适方案", "balanced", base_quote, 1.0, 92, "low"),
            self._option(base, "低预算弹性方案", "comfortable", base_quote, 0.88, 78, "medium"),
        ]
        comparison = PlanComparison(
            user_id=request.user_id,
            request=request,
            options=options,
            recommended_option_id=options[1].id,
        )
        _save("comparison", comparison.id, request.user_id, comparison)
        return comparison

    def get(self, comparison_id: str) -> PlanComparison | None:
        payload = store.get_record("comparison", comparison_id)
        return PlanComparison.model_validate(payload) if payload else None

    def _compose_prompt(self, request: TravelRequestBundle) -> str:
        structured = request.structured
        extras = "，".join([*structured.vehicles, *structured.tags, *structured.preferences])
        links = f"。参考链接：{'，'.join(request.links)}" if request.links else ""
        return (
            f"{request.text}。从{structured.origin}出发，目的地{structured.destination}，"
            f"日期{structured.start_date or '待定'}到{structured.end_date or '待定'}，"
            f"偏好/标签：{extras or '效率优先'}{links}"
        )

    def _apply_structured_intent(self, itinerary: Itinerary, request: TravelRequestBundle) -> Itinerary:
        structured = request.structured
        intent = itinerary.intent.model_copy(
            update={
                "origin": structured.origin or itinerary.intent.origin,
                "destination": structured.destination or itinerary.intent.destination,
                "start_date": structured.start_date or itinerary.intent.start_date,
                "end_date": structured.end_date or itinerary.intent.end_date,
                "preferences": structured.preferences or itinerary.intent.preferences,
                "raw_text": request.text or itinerary.intent.raw_text,
            }
        )
        if intent.start_date and intent.end_date and not intent.duration_days:
            try:
                from datetime import datetime

                start = datetime.fromisoformat(intent.start_date)
                end = datetime.fromisoformat(intent.end_date)
                intent.duration_days = max(1, (end - start).days + 1)
            except ValueError:
                pass
        itinerary.intent = intent
        return itinerary

    def _option(
        self,
        base: Itinerary,
        title: str,
        strategy: str,
        base_quote,
        price_multiplier: float,
        comfort: int,
        risk: str,
    ) -> PlanOption:
        itinerary = deepcopy(base)
        itinerary.id = base.id
        itinerary.title = title
        adjusted = base_quote.model_copy(
            update={
                "transport": int(base_quote.transport * price_multiplier),
                "food": int(base_quote.food * price_multiplier),
                "hotel": int(base_quote.hotel * price_multiplier),
                "other": int(base_quote.other * price_multiplier),
            }
        )
        adjusted = adjusted.model_copy(
            update={"total": adjusted.transport + adjusted.food + adjusted.hotel + adjusted.other}
        )
        quote = price_engine.to_travel_quote(itinerary, adjusted, strategy)
        quote = quote.model_copy(update={"comfort_score": comfort, "risk_level": risk})
        source_note = describe_price_sources(adjusted.data_sources)
        risks = ["高峰时段交通拥堵"] if risk == "medium" else ["需提前完成景点预约"]
        return PlanOption(
            title=title,
            strategy=strategy,  # type: ignore[arg-type]
            quote=quote,
            highlights=["高德真实路线/POI", "多平台口碑对比", "可同步日历与地图"],
            risks=risks,
            recommendation=(
                f"{title}：交通 ¥{adjusted.transport}、餐饮 ¥{adjusted.food}、住宿 ¥{adjusted.hotel}，"
                f"总价 ¥{adjusted.total}（{source_note}）。"
            ),
            itinerary=itinerary,
        )


class ExecutionCenter:
    def prepare(self, request: PrepareOrderRequest) -> TravelOrder:
        comparison = plan_comparison_service.get(request.comparison_id)
        if comparison is None:
            raise ValueError("comparison not found")
        option = next((item for item in comparison.options if item.id == request.option_id), None)
        if option is None:
            raise ValueError("option not found")

        order = TravelOrder(
            user_id=request.user_id,
            comparison_id=request.comparison_id,
            option=option,
            steps=[
                OrderStep(name="信息解析", detail="提取乘机人、日期、城市与偏好"),
                OrderStep(name="平台匹配", detail="匹配航班、酒店、地图与日历平台"),
                OrderStep(name="参数填表", detail="模拟填充 OTA、酒店和交通表单"),
                OrderStep(name="等待授权", detail="等待用户一次性支付授权"),
                OrderStep(name="结果回调", detail="回写订单号、酒店确认号和行程数据"),
            ],
        )
        _save("order", order.id, request.user_id, order)
        return order

    def authorize_payment(self, request: PaymentAuthorizationRequest) -> TravelOrder:
        order = self.get_order(request.order_id)
        if order is None:
            raise ValueError("order not found")
        order.payment_authorized = True
        order.status = "authorized"
        order.steps[3].status = "done"
        order.steps[3].detail = f"已通过 {request.method} 完成模拟授权。"
        _save("order", order.id, request.user_id, order)
        return order

    def execute(self, request: ExecuteOrderRequest) -> TravelOrder:
        order = self.get_order(request.order_id)
        if order is None:
            raise ValueError("order not found")
        if not order.payment_authorized:
            raise ValueError("payment not authorized")

        order.status = "completed"
        for step in order.steps:
            step.status = "done"
        order.confirmations = {
            "flight": "FLT-CA1832-2026",
            "hotel": "HTL-XIDAN-8821",
            "transport": "MAP-ROUTE-READY",
            "payment": "PAY-MOCK-SUCCESS",
        }
        saved = store.save_itinerary(order.option.itinerary)
        order.option.itinerary = saved
        _save("order", order.id, request.user_id, order)
        return order

    def get_order(self, order_id: str) -> TravelOrder | None:
        payload = store.get_record("order", order_id)
        return TravelOrder.model_validate(payload) if payload else None


class SystemSyncService:
    def sync(self, request: SystemSyncRequest) -> SystemSyncResult:
        itinerary = store.get_itinerary(request.itinerary_id)
        if itinerary is None and request.order_id:
            order = execution_center.get_order(request.order_id)
            itinerary = order.option.itinerary if order else None
        if itinerary is None:
            raise ValueError("itinerary not found")

        first = itinerary.items[0] if itinerary.items else None
        items = [
            SyncItem(target="calendar", title="日历", detail=f"已同步 {len(itinerary.items)} 个行程事件"),
            SyncItem(target="alarm", title="提醒", detail="已生成出发、值机、景点预约提醒"),
            SyncItem(target="widget", title="桌面 Widget", detail="已生成下一站和风险提示卡片"),
            SyncItem(target="memo", title="备忘录", detail=itinerary.summary),
            SyncItem(
                target="map",
                title="地图",
                detail=f"已生成 {itinerary.intent.destination} 路线拓扑",
                deeplink=f"amapuri://route/plan/?dname={first.location if first else itinerary.intent.destination}",
            ),
        ]
        topology_nodes = [
            {
                "id": item.id,
                "day": item.day,
                "time": item.start_time,
                "title": item.title,
                "location": item.location,
                "category": item.category,
            }
            for item in itinerary.items
        ]
        result = SystemSyncResult(
            user_id=request.user_id,
            itinerary_id=itinerary.id,
            items=items,
            topology_nodes=topology_nodes,
        )
        _save("sync", result.id, request.user_id, result)
        return result

    def topology(self, itinerary_id: str) -> dict:
        itinerary = store.get_itinerary(itinerary_id)
        if itinerary is None:
            raise ValueError("itinerary not found")
        return {
            "itinerary_id": itinerary.id,
            "nodes": [
                {"id": item.id, "day": item.day, "time": item.start_time, "title": item.title, "location": item.location}
                for item in itinerary.items
            ],
            "edges": [
                {"from": itinerary.items[index].id, "to": itinerary.items[index + 1].id}
                for index in range(max(len(itinerary.items) - 1, 0))
            ],
        }


class GuardianService:
    def status(self, itinerary_id: str) -> GuardianStatus:
        incidents = self._incidents(itinerary_id)
        return GuardianStatus(
            itinerary_id=itinerary_id,
            status="incident_detected" if incidents else "watching",
            incidents=incidents,
            next_check="15 分钟后",
        )

    def simulate_incident(self, itinerary_id: str, kind: str = "flight_delay") -> TravelIncident:
        incident = TravelIncident(
            itinerary_id=itinerary_id,
            kind=kind,  # type: ignore[arg-type]
            severity="medium",
            title="航班延误 35 分钟" if kind == "flight_delay" else "天气变化提醒",
            detail="Agent 检测到关键节点受影响，建议重排午餐与景点顺序。",
        )
        _save("incident", incident.id, "demo-user", incident)
        return incident

    def replan(self, request: ReplanRequest) -> ReplanProposal:
        itinerary = store.get_itinerary(request.itinerary_id)
        if itinerary is None:
            raise ValueError("itinerary not found")
        incident = None
        if request.incident_id:
            payload = store.get_record("incident", request.incident_id)
            incident = TravelIncident.model_validate(payload) if payload else None
        incident = incident or self.simulate_incident(request.itinerary_id)
        updated = deepcopy(itinerary)
        updated.version = itinerary.version + 1
        updated.warnings.append(incident.detail)
        updated.items.append(
            ItineraryItem(
                day=1,
                start_time="16:10",
                end_time="16:40",
                title="动态缓冲与交通重排",
                location=itinerary.intent.destination,
                category="alert",
                description="根据异常事件自动插入缓冲时间，并重新排序受影响节点。",
                risk_flags=["Agent 动态守护生成"],
            )
        )
        proposal = ReplanProposal(
            itinerary_id=itinerary.id,
            incident=incident,
            summary="检测到行程风险，建议增加缓冲并调整后续节点。",
            changes=["插入 30 分钟交通缓冲", "后移晚餐/景点节点", "同步更新日历与提醒"],
            updated_itinerary=updated,
        )
        _save("proposal", proposal.id, request.user_id, proposal)
        return proposal

    def accept(self, request: AcceptReplanRequest) -> Itinerary:
        payload = store.get_record("proposal", request.proposal_id)
        if payload is None:
            raise ValueError("proposal not found")
        proposal = ReplanProposal.model_validate(payload)
        return store.save_itinerary(proposal.updated_itinerary)

    def _incidents(self, itinerary_id: str) -> list[TravelIncident]:
        records = store.latest_records("incident", "demo-user", limit=20)
        return [
            TravelIncident.model_validate(item)
            for item in records
            if item.get("itinerary_id") == itinerary_id
        ]


class TripReviewService:
    def review(self, itinerary_id: str) -> TripReview:
        itinerary = store.get_itinerary(itinerary_id)
        if itinerary is None:
            raise ValueError("itinerary not found")
        quote = price_engine.quote_itinerary(itinerary)
        review = TripReview(
            itinerary_id=itinerary.id,
            summary=f"{itinerary.title} 已完成回顾：整体节奏稳定，关键节点已沉淀为个人偏好。",
            budget_total=quote.total,
            completed_items=len(itinerary.items),
            preference_memory=[
                f"偏好住宿区域：{itinerary.intent.accommodation_area or '市中心'}",
                f"偏好体验：{', '.join(itinerary.intent.preferences[:3]) or '舒适高效'}",
                "遇到延误时倾向保留缓冲而非压缩休息时间",
            ],
            next_trip_suggestions=["提前预约热门景点", "保留 20% 弹性时间", "优先选择可免费取消酒店"],
        )
        _save("review", review.id, "demo-user", review)
        return review


plan_comparison_service = PlanComparisonService()
execution_center = ExecutionCenter()
system_sync_service = SystemSyncService()
guardian_service = GuardianService()
trip_review_service = TripReviewService()
