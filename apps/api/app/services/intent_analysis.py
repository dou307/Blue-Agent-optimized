from __future__ import annotations

from app.agent.intent import intent_extractor
from app.models.schemas import ContextInsight, FiveElements, IntentAnalyzeResponse, TravelIntent
from app.services.amap_service import amap_service
from app.services.weather_service import weather_service


class IntentAnalysisService:
    def analyze(self, message: str, user_id: str = "demo-user") -> IntentAnalyzeResponse:
        intent = intent_extractor.extract(message.strip())

        actions: list[str] = []
        if any(keyword in message for keyword in ["出差", "商务", "会议"]):
            actions.append("出差")
        if intent.accommodation_area or "住" in message:
            actions.append("住宿")
        if any(keyword in message for keyword in ["吃", "餐", "美食", "烤鸭"]):
            actions.append("餐饮")
        if intent.must_visit or any(keyword in message for keyword in ["故宫", "景点", "游玩", "参观"]):
            actions.append("游览")
        if not actions:
            actions = ["出行规划"]

        locations = list(
            dict.fromkeys(
                filter(
                    None,
                    [intent.origin, intent.destination, intent.accommodation_area, *intent.must_visit],
                )
            )
        )
        times = list(
            filter(
                None,
                [
                    intent.start_date,
                    intent.end_date,
                    f"{intent.duration_days}天" if intent.duration_days else None,
                ],
            )
        )

        five_elements = FiveElements(
            actions=actions,
            locations=locations,
            time=times,
            constraints=intent.constraints or ["暂无硬约束"],
            preferences=intent.preferences or ["效率优先"],
        )

        weather_context = weather_service.city_weather_summary(intent.destination, intent.start_date)
        traffic_context = amap_service.traffic_summary(intent.origin, intent.destination)

        context = [
            self._calendar_context(intent),
            ContextInsight(
                key="weather",
                title="天气",
                detail=str(weather_context["detail"]),
                status=weather_context["status"],
            ),
            ContextInsight(
                key="traffic",
                title="路况",
                detail=str(traffic_context["detail"]),
                status=traffic_context["status"],
            ),
        ]

        structured = {
            "origin": intent.origin or "",
            "destination": intent.destination,
            "startDate": intent.start_date or "",
            "endDate": intent.end_date or "",
            "preferences": " / ".join(intent.preferences),
        }

        summary = (
            f"信息已完整理解，我将为你生成高效、舒适、内容丰富的"
            f"{intent.destination}行程方案。"
        )

        return IntentAnalyzeResponse(
            intent=intent,
            structured=structured,
            five_elements=five_elements,
            context=context,
            summary=summary,
            progress=[
                {"step": "语义理解", "status": "done"},
                {"step": "实体抽取", "status": "done"},
                {"step": "上下文关联", "status": "done"},
                {"step": "方案生成", "status": "pending"},
            ],
        )

    @staticmethod
    def _calendar_context(intent: TravelIntent) -> ContextInsight:
        date_label = (
            f"{intent.start_date} 至 {intent.end_date}"
            if intent.start_date and intent.end_date
            else intent.start_date or intent.end_date or "待定"
        )
        return ContextInsight(
            key="calendar",
            title="日历",
            detail=f"出行日期：{date_label}。手机系统日历需在执行阶段授权写入，云端分析阶段不读取本机日历，暂不判定冲突。",
            status="warn",
        )


intent_analysis_service = IntentAnalysisService()
