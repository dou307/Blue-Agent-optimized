export type TravelIntent = {
  origin?: string | null;
  destination: string;
  start_date?: string | null;
  end_date?: string | null;
  duration_days?: number | null;
  travelers: number;
  budget?: string | null;
  accommodation_area?: string | null;
  preferences: string[];
  constraints: string[];
  must_visit: string[];
  raw_text: string;
};

export type ItineraryItem = {
  id: string;
  day: number;
  start_time: string;
  end_time: string;
  title: string;
  location: string;
  category: "transport" | "meeting" | "food" | "sight" | "hotel" | "free" | "alert";
  node_type?: "hard_anchor" | "semi_anchor" | "soft_task";
  editable?: boolean;
  geo_lat?: number | null;
  geo_lng?: number | null;
  description: string;
  risk_flags: string[];
  estimated_cost?: number | null;
  booking_source?: string | null;
  booking_deeplink?: string | null;
};

export type Itinerary = {
  id: string;
  user_id: string;
  version: number;
  title: string;
  intent: TravelIntent;
  items: ItineraryItem[];
  summary: string;
  explanation: string;
  warnings: string[];
  created_at: string;
};

export type ChatResponse = {
  reply: string;
  intent?: TravelIntent | null;
  itinerary?: Itinerary | null;
  tool_results: Record<string, unknown>;
};

export type FiveElements = {
  actions: string[];
  locations: string[];
  time: string[];
  constraints: string[];
  preferences: string[];
};

export type ContextInsight = {
  key: string;
  title: string;
  detail: string;
  status: "ok" | "warn" | "error";
};

export type IntentAnalysis = {
  intent: TravelIntent;
  structured: {
    origin: string;
    destination: string;
    startDate: string;
    endDate: string;
    preferences: string;
  };
  five_elements: FiveElements;
  context: ContextInsight[];
  summary: string;
  progress: Array<{ step: string; status: string }>;
};

export type TravelRequestBundle = {
  user_id: string;
  text: string;
  document_ids: string[];
  links: string[];
  structured: {
    origin: string;
    destination: string;
    start_date?: string | null;
    end_date?: string | null;
    vehicles: string[];
    tags: string[];
    preferences: string[];
  };
};

export type TravelQuote = {
  flight: string;
  hotel: string;
  local_transport: string;
  total_price: number;
  duration_text: string;
  comfort_score: number;
  risk_level: "low" | "medium" | "high";
};

export type PlanOption = {
  id: string;
  title: string;
  strategy: "fastest" | "balanced" | "comfortable";
  quote: TravelQuote;
  highlights: string[];
  risks: string[];
  recommendation: string;
  itinerary: Itinerary;
};

export type PlanComparison = {
  id: string;
  user_id: string;
  request: TravelRequestBundle;
  options: PlanOption[];
  recommended_option_id: string;
  created_at: string;
};

export type OrderStep = {
  name: string;
  status: "pending" | "running" | "done" | "failed";
  detail: string;
};

export type TravelOrder = {
  id: string;
  user_id: string;
  comparison_id: string;
  option: PlanOption;
  status: "prepared" | "authorized" | "executing" | "completed" | "failed";
  payment_authorized: boolean;
  steps: OrderStep[];
  confirmations: Record<string, string>;
};

export type SyncItem = {
  target: "calendar" | "alarm" | "widget" | "memo" | "map";
  status: "ready" | "synced" | "failed";
  title: string;
  detail: string;
  deeplink?: string | null;
};

export type SystemSyncResult = {
  id: string;
  user_id: string;
  itinerary_id: string;
  items: SyncItem[];
  topology_nodes: Record<string, unknown>[];
};

export type TravelIncident = {
  id: string;
  itinerary_id: string;
  kind: "flight_delay" | "weather" | "traffic" | "meeting_conflict" | "hotel_risk";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
};

export type GuardianStatus = {
  itinerary_id: string;
  status: "watching" | "incident_detected" | "stable";
  incidents: TravelIncident[];
  next_check: string;
};

export type ReplanProposal = {
  id: string;
  itinerary_id: string;
  incident: TravelIncident;
  summary: string;
  changes: string[];
  updated_itinerary: Itinerary;
};

export type TripReview = {
  id: string;
  itinerary_id: string;
  summary: string;
  budget_total: number;
  completed_items: number;
  preference_memory: string[];
  next_trip_suggestions: string[];
};

export type POICandidate = {
  id: string;
  name: string;
  category: "food" | "hotel" | "sight";
  address: string;
  location: string;
  geo_lat?: number | null;
  geo_lng?: number | null;
  rating?: number | null;
  price_estimate?: number | null;
  price_label: string;
  primary_source: string;
  platform_scores: Record<string, number>;
  deeplinks: Record<string, string>;
  tags: string[];
  reason: string;
  distance_km?: number | null;
  duration_minutes?: number | null;
};

export type RecommendPOIResponse = {
  candidates: POICandidate[];
  summary: string;
  llm_recommendation: string;
};

export type AccommodationAreaCandidate = {
  id: string;
  name: string;
  area: string;
  search_keyword: string;
  reason: string;
  pros: string[];
  cons: string[];
  best_for: string;
  geo_lat?: number | null;
  geo_lng?: number | null;
  distance_minutes_to_key_anchor?: number | null;
  estimated_price_range: string;
  score: number;
};

export type RecommendAccommodationAreaResponse = {
  candidates: AccommodationAreaCandidate[];
  summary: string;
  llm_recommendation: string;
};

export type PriceBreakdownItem = {
  label: string;
  amount: number;
  source: string;
  detail: string;
};

export type ItineraryPriceQuote = {
  transport: number;
  food: number;
  hotel: number;
  other: number;
  total: number;
  breakdown: PriceBreakdownItem[];
  duration_text: string;
  data_sources: string[];
};
