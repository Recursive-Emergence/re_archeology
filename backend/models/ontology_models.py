"""
Pydantic models for the RE-Archaeology ontology.
Based on the node definitions in architecture.md
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Union
from datetime import datetime
from enum import Enum
import uuid

# Enums
class UserRole(str, Enum):
    READER = "reader"
    CONTRIBUTOR = "contributor"
    RESEARCHER = "researcher"

class AgentType(str, Enum):
    COORDINATOR = "coordinator"
    VALIDATOR = "validator"
    DISCOVERY = "discovery"

class HypothesisStatus(str, Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    DISMISSED = "dismissed"

class SiteStatus(str, Enum):
    CONFIRMED = "confirmed"
    CANDIDATE = "candidate"

class PatternStatus(str, Enum):
    CANDIDATE = "candidate"
    VERIFIED = "verified"

class MotifType(str, Enum):
    SOIL = "soil"
    ELEVATION = "elevation"
    RIVER_PROXIMITY = "river proximity"
    VEGETATION = "vegetation"
    CULTURAL = "cultural"

class ResearchType(str, Enum):
    PEER_REVIEWED = "peer-reviewed"
    GRAY_LITERATURE = "gray literature"

# Base model with common fields
class BaseNode(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=datetime.utcnow)

# Node Models
class Agent(BaseNode):
    name: str
    type: AgentType
    linked_llm_model: Optional[str] = None
    memory_trace_ids: List[str] = Field(default_factory=list)
    llm_prompts: Optional[str] = None

class User(BaseNode):
    name: str
    email: str
    registered_at: datetime = Field(default_factory=datetime.utcnow)
    role: UserRole = UserRole.READER

class Thread(BaseNode):
    title: str
    starter_user_id: str
    tags: List[str] = Field(default_factory=list)

class Hypothesis(BaseNode):
    statement: str
    confidence_score: float = Field(ge=0.0, le=1.0)
    proposed_by_user: str
    linked_pattern_id: Optional[str] = None
    emerged_from_thread: str
    status: HypothesisStatus = HypothesisStatus.PENDING

class Site(BaseNode):
    name: str
    # Store as latitude, longitude pair
    latitude: float
    longitude: float
    status: SiteStatus = SiteStatus.CANDIDATE
    linked_geo_tile_id: Optional[str] = None
    created_from_hypothesis: Optional[str] = None

class GeoTile(BaseNode):
    tile_id: str  # e.g., S2 or quadkey
    elevation_model_id: Optional[str] = None
    entropy_signature: Optional[float] = None
    last_updated: datetime = Field(default_factory=datetime.utcnow)

class Artifact(BaseNode):
    name: str
    type: str
    description: str
    found_at_site_id: str
    confidence_level: float = Field(ge=0.0, le=1.0)
    source: Optional[str] = None

class Motif(BaseNode):
    name: str
    type: MotifType
    geo_pattern_data: Optional[dict] = None  # JSON blob
    score: Optional[float] = None  # RE-derived coherence

class Pattern(BaseNode):
    score: float  # R · ΔH
    motif_ids: List[str] = Field(default_factory=list)
    geo_tile_ids: List[str] = Field(default_factory=list)
    status: PatternStatus = PatternStatus.CANDIDATE
    triggered_by_agent: Optional[str] = None

class Research(BaseNode):
    title: str
    summary: str
    source_url: Optional[str] = None
    type: ResearchType = ResearchType.GRAY_LITERATURE
    embedding: Optional[List[float]] = None  # Vector embedding

class Narrative(BaseNode):
    title: str
    language: str
    translated_summary: str
    source_reference: Optional[str] = None
    influenced_tile_ids: List[str] = Field(default_factory=list)
    linked_to_motifs: List[str] = Field(default_factory=list)
    thread_origin_id: Optional[str] = None
    embedding: Optional[List[float]] = None  # Vector embedding

# Request/Response Models
class CreateUserRequest(BaseModel):
    name: str
    email: str
    role: UserRole = UserRole.READER

class CreateThreadRequest(BaseModel):
    title: str
    starter_user_id: str
    tags: List[str] = Field(default_factory=list)

class CreateHypothesisRequest(BaseModel):
    statement: str
    confidence_score: float = Field(ge=0.0, le=1.0)
    proposed_by_user: str
    emerged_from_thread: str
    linked_pattern_id: Optional[str] = None

class CreateSiteRequest(BaseModel):
    name: str
    latitude: float
    longitude: float
    status: SiteStatus = SiteStatus.CANDIDATE
    created_from_hypothesis: Optional[str] = None
