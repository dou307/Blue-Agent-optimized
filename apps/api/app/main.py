from __future__ import annotations

import base64

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.agent.graph import travel_agent_graph
from app.agent.refiner import itinerary_refiner
from app.core.config import get_settings
from app.models.schemas import (
    AcceptReplanRequest,
    ChatRequest,
    ChatResponse,
    ExecuteOrderRequest,
    IntentParseRequest,
    IntentParseResponse,
    IntentAnalyzeResponse,
    MultimodalInputBundle,
    PaymentAuthorizationRequest,
    PrepareOrderRequest,
    RefinementRequest,
    RescheduleNodeRequest,
    DeleteNodeRequest,
    ReorderNodesRequest,
    SmartUpdateNodeRequest,
    SmartUpdateNodeResponse,
    UpdateNodeRequest,
    ReplanRequest,
    SystemSyncRequest,
    TravelRequestBundle,
    UploadKind,
    UploadResponse,
    VoiceTranscribeResponse,
    VoiceTranscribeJsonRequest,
    RecommendPOIRequest,
    RecommendPOIResponse,
    ConfirmPOIRequest,
    ItineraryPriceQuote,
    RecommendAccommodationAreaRequest,
    RecommendAccommodationAreaResponse,
    ItineraryWeatherRequest,
    ItineraryWeatherResponse,
    WeatherOptimizeRequest,
    WeatherOptimizeResponse,
)
from app.agent.intent import intent_extractor
from app.services.intent_analysis import intent_analysis_service
from app.services.multimodal import multimodal_service
from app.services.poster_features import (
    execution_center,
    guardian_service,
    plan_comparison_service,
    system_sync_service,
    trip_review_service,
)
from app.services.price_engine import price_engine
from app.services.rag import rag_service
from app.services.accommodation_area_service import accommodation_area_service
from app.services.recommendation_service import recommendation_service
from app.services.speech import speech_service
from app.services.store import store
from app.services.weather_service import weather_service
from app.tools.travel_tools import travel_tools

settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    return travel_agent_graph.invoke(request.user_id, request.message)


@app.post("/multimodal/chat", response_model=ChatResponse)
def multimodal_chat(user_id: str, bundle: MultimodalInputBundle) -> ChatResponse:
    normalized = multimodal_service.normalize(user_id, bundle)
    if not normalized:
        raise HTTPException(status_code=400, detail="empty multimodal input")
    return travel_agent_graph.invoke(user_id, normalized)


@app.post("/intent/parse", response_model=IntentParseResponse)
def parse_intent(request: IntentParseRequest) -> IntentParseResponse:
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    intent = intent_extractor.extract(request.message.strip())
    structured = {
        "origin": intent.origin or "",
        "destination": intent.destination,
        "startDate": intent.start_date or "",
        "endDate": intent.end_date or "",
        "preferences": " / ".join(intent.preferences),
    }
    return IntentParseResponse(intent=intent, structured=structured)


@app.post("/intent/analyze", response_model=IntentAnalyzeResponse)
def analyze_intent(request: IntentParseRequest) -> IntentAnalyzeResponse:
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="message is required")
    return intent_analysis_service.analyze(request.message.strip())


@app.post("/voice/transcribe", response_model=VoiceTranscribeResponse)
async def transcribe_voice(file: UploadFile = File(...)) -> VoiceTranscribeResponse:
    if not speech_service.configured:
        raise HTTPException(
            status_code=503,
            detail="语音识别未配置。请设置 BAIDU_ASR_API_KEY/SECRET_KEY 或 DASHSCOPE_API_KEY",
        )
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="empty audio file")
    try:
        text = await speech_service.transcribe(file_bytes, file.filename or "recording.m4a")
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return VoiceTranscribeResponse(text=text)


@app.post("/voice/transcribe-base64", response_model=VoiceTranscribeResponse)
async def transcribe_voice_base64(request: VoiceTranscribeJsonRequest) -> VoiceTranscribeResponse:
    if not speech_service.configured:
        raise HTTPException(
            status_code=503,
            detail="语音识别未配置。请设置 BAIDU_ASR_API_KEY/SECRET_KEY 或 DASHSCOPE_API_KEY",
        )
    try:
        file_bytes = base64.b64decode(request.audio_base64)
    except Exception as error:
        raise HTTPException(status_code=400, detail="invalid audio_base64") from error
    if not file_bytes:
        raise HTTPException(status_code=400, detail="empty audio file")
    try:
        text = await speech_service.transcribe(file_bytes, request.filename)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return VoiceTranscribeResponse(text=text)


@app.post("/uploads", response_model=UploadResponse)
async def upload_document(
    user_id: str = Form("demo-user"),
    kind: UploadKind = Form(...),
    file: UploadFile = File(...),
) -> UploadResponse:
    return await rag_service.ingest_upload(user_id, file, kind)


@app.post("/itineraries/refine")
def refine_itinerary(request: RefinementRequest) -> dict[str, object]:
    try:
        itinerary = itinerary_refiner.refine(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "reply": f"已根据“{request.instruction}”生成第 {itinerary.version} 版方案。",
        "itinerary": itinerary,
    }


@app.post("/itineraries/reschedule")
def reschedule_node(request: RescheduleNodeRequest) -> dict[str, object]:
    try:
        itinerary = itinerary_refiner.reschedule_node(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"itinerary": itinerary}


@app.post("/itineraries/update-node")
def update_node(request: UpdateNodeRequest) -> dict[str, object]:
    try:
        itinerary = itinerary_refiner.update_node(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"itinerary": itinerary}


@app.post("/itineraries/smart-update-node", response_model=SmartUpdateNodeResponse)
def smart_update_node(request: SmartUpdateNodeRequest) -> SmartUpdateNodeResponse:
    try:
        return itinerary_refiner.smart_update_node(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/itineraries/delete-node", response_model=SmartUpdateNodeResponse)
def delete_node(request: DeleteNodeRequest) -> SmartUpdateNodeResponse:
    try:
        return itinerary_refiner.delete_node(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/itineraries/reorder-nodes", response_model=SmartUpdateNodeResponse)
def reorder_nodes(request: ReorderNodesRequest) -> SmartUpdateNodeResponse:
    try:
        return itinerary_refiner.reorder_nodes(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/recommendations/search", response_model=RecommendPOIResponse)
def search_recommendations(request: RecommendPOIRequest) -> RecommendPOIResponse:
    if not request.city.strip() or not request.keyword.strip():
        raise HTTPException(status_code=400, detail="city and keyword are required")
    return recommendation_service.recommend(request)


@app.post("/recommendations/accommodation-areas", response_model=RecommendAccommodationAreaResponse)
def search_accommodation_areas(request: RecommendAccommodationAreaRequest) -> RecommendAccommodationAreaResponse:
    if not request.city.strip():
        raise HTTPException(status_code=400, detail="city is required")
    return accommodation_area_service.recommend(request)


@app.post("/nodes/confirm-poi")
def confirm_poi(request: ConfirmPOIRequest) -> dict[str, object]:
    try:
        itinerary = recommendation_service.confirm_selection(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    quote = price_engine.quote_itinerary(itinerary)
    return {"itinerary": itinerary, "price_quote": quote}


@app.get("/itineraries/{itinerary_id}/price-quote", response_model=ItineraryPriceQuote)
def get_price_quote(itinerary_id: str) -> ItineraryPriceQuote:
    itinerary = store.get_itinerary(itinerary_id)
    if itinerary is None:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    return price_engine.quote_itinerary(itinerary)


@app.post("/weather/itinerary", response_model=ItineraryWeatherResponse)
def get_itinerary_weather(request: ItineraryWeatherRequest) -> ItineraryWeatherResponse:
    itinerary = store.get_itinerary(request.itinerary_id)
    if itinerary is None:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    return weather_service.itinerary_weather(itinerary)


@app.post("/weather/optimize", response_model=WeatherOptimizeResponse)
def optimize_itinerary_by_weather(request: WeatherOptimizeRequest) -> WeatherOptimizeResponse:
    itinerary = store.get_itinerary(request.itinerary_id)
    if itinerary is None:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    weather = weather_service.itinerary_weather(itinerary)
    try:
        return itinerary_refiner.weather_optimize(
            request,
            weather,
            weather_service.weather_context_for_llm(weather),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/itineraries/{itinerary_id}")
def get_itinerary(itinerary_id: str) -> dict[str, object]:
    itinerary = store.get_itinerary(itinerary_id)
    if itinerary is None:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    return {"itinerary": itinerary}


@app.post("/integrations/calendar")
def create_calendar_event(title: str, start_time: str, end_time: str, location: str) -> dict[str, str]:
    return travel_tools.create_calendar_event(title, start_time, end_time, location)


@app.post("/integrations/map")
def open_map(origin: str, destination: str) -> dict[str, str]:
    return travel_tools.open_map_link(origin, destination)


@app.get("/tools/weather")
def weather(city: str, date_range: str | None = None) -> dict[str, object]:
    return travel_tools.get_weather(city, date_range)


@app.post("/plans/compare")
def compare_plans(request: TravelRequestBundle) -> dict[str, object]:
    return {"comparison": plan_comparison_service.compare(request)}


@app.get("/plans/compare/{comparison_id}")
def get_comparison(comparison_id: str) -> dict[str, object]:
    comparison = plan_comparison_service.get(comparison_id)
    if comparison is None:
        raise HTTPException(status_code=404, detail="Comparison not found")
    return {"comparison": comparison}


@app.post("/orders/prepare")
def prepare_order(request: PrepareOrderRequest) -> dict[str, object]:
    try:
        order = execution_center.prepare(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"order": order}


@app.post("/orders/authorize-payment")
def authorize_payment(request: PaymentAuthorizationRequest) -> dict[str, object]:
    try:
        order = execution_center.authorize_payment(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"order": order}


@app.post("/orders/execute")
def execute_order(request: ExecuteOrderRequest) -> dict[str, object]:
    try:
        order = execution_center.execute(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"order": order}


@app.get("/orders/{order_id}")
def get_order(order_id: str) -> dict[str, object]:
    order = execution_center.get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return {"order": order}


@app.post("/sync/system")
def sync_system(request: SystemSyncRequest) -> dict[str, object]:
    try:
        result = system_sync_service.sync(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"sync": result}


@app.get("/timeline/topology/{itinerary_id}")
def get_topology(itinerary_id: str) -> dict[str, object]:
    try:
        return system_sync_service.topology(itinerary_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/guardian/status/{itinerary_id}")
def guardian_status(itinerary_id: str) -> dict[str, object]:
    return {"guardian": guardian_service.status(itinerary_id)}


@app.post("/guardian/incidents/simulate")
def simulate_incident(itinerary_id: str, kind: str = "flight_delay") -> dict[str, object]:
    return {"incident": guardian_service.simulate_incident(itinerary_id, kind)}


@app.post("/guardian/replan")
def guardian_replan(request: ReplanRequest) -> dict[str, object]:
    try:
        proposal = guardian_service.replan(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"proposal": proposal}


@app.post("/guardian/accept-replan")
def accept_replan(request: AcceptReplanRequest) -> dict[str, object]:
    try:
        itinerary = guardian_service.accept(request)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"itinerary": itinerary}


@app.get("/trips/{itinerary_id}/review")
def trip_review(itinerary_id: str) -> dict[str, object]:
    try:
        review = trip_review_service.review(itinerary_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"review": review}
