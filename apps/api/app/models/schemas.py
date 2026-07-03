from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class TravelIntent(BaseModel):
    origin: str | None = None
    destination: str
    start_date: str | None = None
    end_date: str | None = None
    duration_days: int | None = None
    travelers: int = 1
    budget: str | None = None
    accommodation_area: str | None = None
    preferences: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    must_visit: list[str] = Field(default_factory=list)
    raw_text: str


class TransportLeg(BaseModel):
    origin: str
    destination: str
    mode: Literal["walk", "bike", "taxi", "metro", "train", "flight", "unknown"] = "unknown"
    minutes: int
    distance_km: float | None = None
    note: str | None = None


class ItineraryItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    day: int
    start_time: str
    end_time: str
    title: str
    location: str
    category: Literal["transport", "meeting", "food", "sight", "hotel", "free", "alert"]
    node_type: Literal["hard_anchor", "semi_anchor", "soft_task"] = "soft_task"
    editable: bool = True
    geo_lat: float | None = None
    geo_lng: float | None = None
    description: str
    route_from_previous: TransportLeg | None = None
    risk_flags: list[str] = Field(default_factory=list)
    estimated_cost: int | None = None
    booking_source: str | None = None
    booking_deeplink: str | None = None


class Itinerary(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    version: int = 1
    title: str
    intent: TravelIntent
    items: list[ItineraryItem]
    summary: str
    explanation: str
    warnings: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GeneratedItineraryItem(BaseModel):
    day: int
    start_time: str
    end_time: str
    title: str
    location: str
    category: Literal["transport", "meeting", "food", "sight", "hotel", "free", "alert"]
    description: str
    geo_lat: float | None = None
    geo_lng: float | None = None


class GeneratedItineraryPlan(BaseModel):
    title: str
    summary: str
    explanation: str
    warnings: list[str] = Field(default_factory=list)
    items: list[GeneratedItineraryItem] = Field(default_factory=list)


class ChatRequest(BaseModel):
    user_id: str = "demo-user"
    message: str
    itinerary_id: str | None = None


class ChatResponse(BaseModel):
    reply: str
    intent: TravelIntent | None = None
    itinerary: Itinerary | None = None
    tool_results: dict[str, Any] = Field(default_factory=dict)


class IntentParseRequest(BaseModel):
    message: str


class IntentParseResponse(BaseModel):
    intent: TravelIntent
    structured: dict[str, str]


class VoiceTranscribeResponse(BaseModel):
    text: str


class VoiceTranscribeJsonRequest(BaseModel):
    audio_base64: str
    filename: str = "recording.m4a"


class FiveElements(BaseModel):
    actions: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    time: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    preferences: list[str] = Field(default_factory=list)


class ContextInsight(BaseModel):
    key: str
    title: str
    detail: str
    status: Literal["ok", "warn", "error"] = "ok"


class IntentAnalyzeResponse(BaseModel):
    intent: TravelIntent
    structured: dict[str, str]
    five_elements: FiveElements
    context: list[ContextInsight]
    summary: str
    progress: list[dict[str, str]]


class RefinementRequest(BaseModel):
    user_id: str = "demo-user"
    itinerary_id: str
    instruction: str


class RescheduleNodeRequest(BaseModel):
    user_id: str = "demo-user"
    itinerary_id: str
    item_id: str
    start_time: str
    day: int | None = None


class UpdateNodeRequest(BaseModel):
    user_id: str = "demo-user"
    itinerary_id: str
    item_id: str
    title: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    geo_lat: float | None = None
    geo_lng: float | None = None
    day: int | None = None


class SmartUpdateNodeRequest(UpdateNodeRequest):
    instruction: str | None = None


class SmartUpdatedItem(BaseModel):
    id: str
    day: int
    start_time: str
    end_time: str
    title: str
    location: str
    category: Literal["transport", "meeting", "food", "sight", "hotel", "free", "alert"]
    description: str
    geo_lat: float | None = None
    geo_lng: float | None = None


class SmartUpdatePlan(BaseModel):
    items: list[SmartUpdatedItem]
    change_summary: str
    affected_item_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class SmartUpdateNodeResponse(BaseModel):
    itinerary: Itinerary
    change_summary: str
    affected_item_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class DeleteNodeRequest(BaseModel):
    user_id: str = "demo-user"
    itinerary_id: str
    item_id: str
    instruction: str | None = None


class ReorderNodesRequest(BaseModel):
    user_id: str = "demo-user"
    itinerary_id: str
    item_ids: list[str]
    instruction: str | None = None


class POICandidate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    category: Literal["food", "hotel", "sight"]
    address: str
    location: str
    geo_lat: float | None = None
    geo_lng: float | None = None
    rating: float | None = None
    price_estimate: int | None = None
    price_label: str = ""
    primary_source: str = "amap"
    platform_scores: dict[str, float] = Field(default_factory=dict)
    deeplinks: dict[str, str] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    reason: str = ""
    distance_km: float | None = None
    duration_minutes: int | None = None


class RecommendPOIRequest(BaseModel):
    user_id: str = "demo-user"
    city: str
    keyword: str
    category: Literal["food", "hotel", "sight"] = "food"
    day: int = 1
    start_time: str = "12:00"
    end_time: str = "13:30"
    near_location: str | None = None
    near_lat: float | None = None
    near_lng: float | None = None
    budget: str | None = None
    itinerary_id: str | None = None


class RecommendPOIResponse(BaseModel):
    candidates: list[POICandidate]
    summary: str
    llm_recommendation: str


class AccommodationAreaCandidate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    area: str
    search_keyword: str
    reason: str
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    best_for: str = ""
    geo_lat: float | None = None
    geo_lng: float | None = None
    distance_minutes_to_key_anchor: int | None = None
    estimated_price_range: str = ""
    score: int = 80


class RecommendAccommodationAreaRequest(BaseModel):
    user_id: str = "demo-user"
    city: str
    itinerary_id: str | None = None
    preference: str | None = None
    budget: str | None = None


class RecommendAccommodationAreaResponse(BaseModel):
    candidates: list[AccommodationAreaCandidate]
    summary: str
    llm_recommendation: str


class ConfirmPOIRequest(BaseModel):
    user_id: str = "demo-user"
    itinerary_id: str
    candidate: POICandidate
    day: int
    start_time: str
    end_time: str
    replace_item_id: str | None = None
    insert_after_item_id: str | None = None


class PriceBreakdownItem(BaseModel):
    label: str
    amount: int
    source: str
    detail: str = ""


class ItineraryPriceQuote(BaseModel):
    transport: int
    food: int
    hotel: int
    other: int
    total: int
    breakdown: list[PriceBreakdownItem] = Field(default_factory=list)
    duration_text: str = ""
    data_sources: list[str] = Field(default_factory=list)


class UploadKind(str, Enum):
    pdf = "pdf"
    image = "image"
    audio = "audio"
    text = "text"


class UploadResponse(BaseModel):
    document_id: str
    kind: UploadKind
    extracted_text: str
    chunks: int


class MultimodalInputBundle(BaseModel):
    text: str | None = None
    document_ids: list[str] = Field(default_factory=list)
    image_urls: list[str] = Field(default_factory=list)
    audio_urls: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class StructuredTravelInput(BaseModel):
    origin: str = ""
    destination: str = ""
    start_date: str | None = None
    end_date: str | None = None
    vehicles: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    preferences: list[str] = Field(default_factory=list)


class TravelRequestBundle(BaseModel):
    user_id: str = "demo-user"
    text: str
    document_ids: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    structured: StructuredTravelInput = Field(default_factory=StructuredTravelInput)


class TravelQuote(BaseModel):
    flight: str
    hotel: str
    local_transport: str
    total_price: int
    duration_text: str
    comfort_score: int
    risk_level: Literal["low", "medium", "high"]


class PlanOption(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    strategy: Literal["fastest", "balanced", "comfortable"]
    quote: TravelQuote
    highlights: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    recommendation: str
    itinerary: Itinerary


class PlanComparison(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    request: TravelRequestBundle
    options: list[PlanOption]
    recommended_option_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PrepareOrderRequest(BaseModel):
    user_id: str = "demo-user"
    comparison_id: str
    option_id: str


class OrderStep(BaseModel):
    name: str
    status: Literal["pending", "running", "done", "failed"] = "pending"
    detail: str


class TravelOrder(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    comparison_id: str
    option: PlanOption
    status: Literal["prepared", "authorized", "executing", "completed", "failed"] = "prepared"
    payment_authorized: bool = False
    steps: list[OrderStep] = Field(default_factory=list)
    confirmations: dict[str, str] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PaymentAuthorizationRequest(BaseModel):
    user_id: str = "demo-user"
    order_id: str
    method: Literal["alipay", "wechat_pay", "card", "mock"] = "mock"


class ExecuteOrderRequest(BaseModel):
    user_id: str = "demo-user"
    order_id: str


class SystemSyncRequest(BaseModel):
    user_id: str = "demo-user"
    itinerary_id: str
    order_id: str | None = None


class SyncItem(BaseModel):
    target: Literal["calendar", "alarm", "widget", "memo", "map"]
    status: Literal["ready", "synced", "failed"] = "synced"
    title: str
    detail: str
    deeplink: str | None = None


class SystemSyncResult(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str
    itinerary_id: str
    items: list[SyncItem]
    topology_nodes: list[dict[str, Any]]
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TravelIncident(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    itinerary_id: str
    kind: Literal["flight_delay", "weather", "traffic", "meeting_conflict", "hotel_risk"]
    severity: Literal["low", "medium", "high"]
    title: str
    detail: str
    affected_item_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GuardianStatus(BaseModel):
    itinerary_id: str
    status: Literal["watching", "incident_detected", "stable"]
    incidents: list[TravelIncident]
    next_check: str


class ReplanRequest(BaseModel):
    user_id: str = "demo-user"
    itinerary_id: str
    incident_id: str | None = None


class ReplanProposal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    itinerary_id: str
    incident: TravelIncident
    summary: str
    changes: list[str]
    updated_itinerary: Itinerary


class AcceptReplanRequest(BaseModel):
    user_id: str = "demo-user"
    proposal_id: str


class TripReview(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    itinerary_id: str
    summary: str
    budget_total: int
    completed_items: int
    preference_memory: list[str]
    next_trip_suggestions: list[str]
    created_at: datetime = Field(default_factory=datetime.utcnow)
