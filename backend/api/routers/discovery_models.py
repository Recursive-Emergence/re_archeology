from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

@dataclass
class ScanPatch:
    session_id: str
    patch_id: str
    lat: float
    lon: float
    timestamp: str
    is_positive: bool
    confidence: float
    patch_size_m: int
    detection_result: Optional[Dict] = None
    elevation_data: Optional[List] = None
    elevation_stats: Optional[Dict] = None

class ProfileGeometryConfig(BaseModel):
    patch_size_m: Optional[List[float]] = None
    resolution_m: Optional[float] = None
    structure_radius_m: Optional[float] = None
    min_structure_size_m: Optional[float] = None
    max_structure_size_m: Optional[float] = None

class ProfileThresholdsConfig(BaseModel):
    detection_threshold: Optional[float] = None
    confidence_threshold: Optional[float] = None
    early_decision_threshold: Optional[float] = None
    uncertainty_tolerance: Optional[float] = None

class ProfileFeatureConfig(BaseModel):
    enabled: Optional[bool] = None
    weight: Optional[float] = None
    polarity_preference: Optional[str] = None

class ProfilePerformanceConfig(BaseModel):
    aggregation_method: Optional[str] = None
    parallel_execution: Optional[bool] = None
    max_workers: Optional[int] = None

class CustomProfileRequest(BaseModel):
    structure_type: str
    session_id: Optional[str] = None
    geometry: Optional[ProfileGeometryConfig] = None
    thresholds: Optional[ProfileThresholdsConfig] = None
    features: Optional[Dict[str, ProfileFeatureConfig]] = None
    performance: Optional[ProfilePerformanceConfig] = None
    save_as_custom: Optional[bool] = False
    custom_profile_name: Optional[str] = None

@dataclass
class DiscoverySession:
    session_id: str
    region_name: str
    start_time: str
    status: str
    total_patches: int
    processed_patches: int
    positive_detections: int
    bounds: Dict[str, float]
    config: Dict[str, Any]
    end_time: Optional[str] = None
    error_message: Optional[str] = None

class SessionIdRequest(BaseModel):
    session_id: str
