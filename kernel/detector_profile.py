"""
Detector Profile System for G₂ Kernel Configuration

This module provides configurable detector profiles that can be optimized
for different archaeological structures, terrain types, and detection scenarios.
Profiles define feature selection, weights, thresholds, and geometric parameters.
"""

import json
import numpy as np
from typing import Dict, List, Any, Optional, Tuple, Union
from dataclasses import dataclass, field, asdict
from pathlib import Path
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class PatchShape(Enum):
    """Supported patch shapes for detection"""
    SQUARE = "square"
    RECTANGLE = "rectangle"
    CIRCLE = "circle"
    IRREGULAR = "irregular"  # For custom mask-based shapes


class StructureType(Enum):
    """Archaeological structure types with different characteristics"""
    WINDMILL = "windmill"
    SETTLEMENT = "settlement"
    EARTHWORK = "earthwork"
    PLATFORM = "platform"
    GEOGLYPH = "geoglyph"
    ROAD = "road"
    CANAL = "canal"
    GENERIC = "generic"


@dataclass
class GeometricParameters:
    """Geometric constraints and expectations for detection"""
    resolution_m: float = 0.5  # Resolution in meters per pixel
    structure_radius_m: float = 8.0  # Expected structure radius in meters
    min_structure_size_m: float = 3.0  # Minimum detectable structure size
    max_structure_size_m: float = 50.0  # Maximum expected structure size
    patch_shape: PatchShape = PatchShape.SQUARE
    patch_size_m: Tuple[float, float] = (20.0, 20.0)  # (width, height) in meters
    aspect_ratio_tolerance: float = 0.3  # Tolerance for non-square patches
    
    def get_patch_size_px(self) -> Tuple[int, int]:
        """Convert patch size from meters to pixels"""
        width_px = int(self.patch_size_m[0] / self.resolution_m)
        height_px = int(self.patch_size_m[1] / self.resolution_m)
        return (width_px, height_px)
    
    def get_structure_radius_px(self) -> int:
        """Convert structure radius from meters to pixels"""
        return int(self.structure_radius_m / self.resolution_m)


@dataclass
class FeatureConfiguration:
    """Configuration for a specific feature module"""
    enabled: bool = True
    weight: float = 1.0
    parameters: Dict[str, Any] = field(default_factory=dict)
    polarity_preference: Optional[str] = None  # "positive", "negative", or None for dynamic
    confidence_threshold: float = 0.0  # Minimum confidence to include this feature
    
    def __post_init__(self):
        """Validate configuration parameters"""
        if self.weight < 0:
            raise ValueError("Feature weight must be non-negative")
        if not 0 <= self.confidence_threshold <= 1:
            raise ValueError("Confidence threshold must be between 0 and 1")


@dataclass
class DetectionThresholds:
    """Thresholds for detection decision-making"""
    detection_threshold: float = 0.5  # Final score threshold for positive detection
    confidence_threshold: float = 0.6  # Minimum confidence for reliable detection
    early_decision_threshold: float = 0.85  # Threshold for early termination
    min_modules_for_decision: int = 2  # Minimum modules before early decision
    max_modules_for_efficiency: int = 6  # Maximum modules to run for efficiency
    uncertainty_tolerance: float = 0.2  # Tolerance for conflicting evidence


@dataclass
class DetectorProfile:
    """
    Complete detector profile defining all parameters for G₂ detection
    
    This profile can be saved, loaded, and optimized for specific use cases.
    It encapsulates geometry, features, thresholds, and decision logic.
    """
    name: str
    description: str = ""
    structure_type: StructureType = StructureType.GENERIC
    version: str = "1.0"
    created_by: str = "G₂ System"
    
    # Core configuration components
    geometry: GeometricParameters = field(default_factory=GeometricParameters)
    thresholds: DetectionThresholds = field(default_factory=DetectionThresholds)
    
    # Feature module configurations
    features: Dict[str, FeatureConfiguration] = field(default_factory=lambda: {
        "histogram": FeatureConfiguration(enabled=True, weight=1.5, 
                                        parameters={"similarity_method": "correlation"}),
        "volume": FeatureConfiguration(enabled=True, weight=1.3,
                                     parameters={"volume_method": "trapezoid"}),
        "dropoff": FeatureConfiguration(enabled=True, weight=1.2,
                                      parameters={"edge_method": "gradient"}),
        "compactness": FeatureConfiguration(enabled=True, weight=1.1,
                                          parameters={"shape_method": "circularity"}),
        "entropy": FeatureConfiguration(enabled=True, weight=1.0,
                                      parameters={"entropy_method": "shannon"}),
        "planarity": FeatureConfiguration(enabled=True, weight=0.9,
                                        parameters={"plane_method": "least_squares"})
    })
    
    # Advanced configuration
    aggregation_method: str = "streaming"  # "streaming" or "batch"
    parallel_execution: bool = True
    max_workers: int = 5
    enable_refinement: bool = True
    max_refinement_attempts: int = 2
    
    # Metadata for optimization and tracking
    optimization_history: List[Dict[str, Any]] = field(default_factory=list)
    performance_metrics: Dict[str, float] = field(default_factory=dict)
    last_used: Optional[str] = None
    use_count: int = 0
    
    def get_enabled_features(self) -> Dict[str, FeatureConfiguration]:
        """Get only the enabled feature configurations"""
        return {name: config for name, config in self.features.items() if config.enabled}
    
    def get_feature_weights(self) -> Dict[str, float]:
        """Get weights for enabled features"""
        return {name: config.weight for name, config in self.features.items() if config.enabled}
    
    def get_total_feature_weight(self) -> float:
        """Calculate total weight of enabled features"""
        return sum(config.weight for config in self.features.values() if config.enabled)
    
    def normalize_weights(self) -> None:
        """Normalize feature weights to sum to total enabled modules"""
        enabled_features = self.get_enabled_features()
        if not enabled_features:
            return
        
        total_weight = sum(config.weight for config in enabled_features.values())
        target_sum = len(enabled_features)
        
        for config in enabled_features.values():
            config.weight = (config.weight / total_weight) * target_sum
    
    def validate(self) -> List[str]:
        """Validate profile configuration and return list of issues"""
        issues = []
        
        # Validate geometry
        if self.geometry.resolution_m <= 0:
            issues.append("Resolution must be positive")
        
        if self.geometry.structure_radius_m <= 0:
            issues.append("Structure radius must be positive")
        
        if self.geometry.min_structure_size_m >= self.geometry.max_structure_size_m:
            issues.append("Minimum structure size must be less than maximum")
        
        # Validate patch size
        if any(size <= 0 for size in self.geometry.patch_size_m):
            issues.append("Patch dimensions must be positive")
        
        # Validate thresholds
        for threshold_name, threshold_value in asdict(self.thresholds).items():
            if isinstance(threshold_value, float) and not 0 <= threshold_value <= 1:
                if "threshold" in threshold_name:
                    issues.append(f"{threshold_name} must be between 0 and 1")
        
        # Validate features
        enabled_count = len(self.get_enabled_features())
        if enabled_count == 0:
            issues.append("At least one feature must be enabled")
        
        # Check for reasonable weights
        for name, config in self.features.items():
            if config.enabled and config.weight <= 0:
                issues.append(f"Feature '{name}' has non-positive weight")
        
        return issues
    
    def optimize_for_structure_type(self) -> None:
        """Optimize profile parameters for the specified structure type"""
        optimizations = {
            StructureType.WINDMILL: {
                "geometry.structure_radius_m": 8.0,
                "features.histogram.weight": 1.5,
                "features.compactness.weight": 1.3,
                "features.dropoff.weight": 1.2,
                "thresholds.detection_threshold": 0.55
            },
            StructureType.SETTLEMENT: {
                "geometry.structure_radius_m": 15.0,
                "features.volume.weight": 1.4,
                "features.entropy.weight": 1.2,
                "features.planarity.weight": 1.1,
                "thresholds.detection_threshold": 0.45
            },
            StructureType.EARTHWORK: {
                "geometry.structure_radius_m": 12.0,
                "features.volume.weight": 1.5,
                "features.dropoff.weight": 1.3,
                "features.planarity.weight": 0.7,
                "thresholds.detection_threshold": 0.5
            },
            StructureType.GEOGLYPH: {
                "geometry.structure_radius_m": 25.0,
                "features.compactness.weight": 1.4,
                "features.entropy.weight": 0.8,
                "features.planarity.weight": 1.2,
                "thresholds.detection_threshold": 0.4
            }
        }
        
        if self.structure_type in optimizations:
            opts = optimizations[self.structure_type]
            for path, value in opts.items():
                self._set_nested_attribute(path, value)
            
            logger.info(f"Optimized profile for {self.structure_type.value}")
    
    def _set_nested_attribute(self, path: str, value: Any) -> None:
        """Set a nested attribute using dot notation (e.g., 'geometry.resolution_m')"""
        parts = path.split('.')
        obj = self
        
        for part in parts[:-1]:
            if isinstance(obj, dict):
                obj = obj[part]
            else:
                obj = getattr(obj, part)
        
        final_attr = parts[-1]
        if isinstance(obj, dict):
            obj[final_attr] = value
        else:
            setattr(obj, final_attr, value)


class DetectorProfileManager:
    """Manager for saving, loading, and organizing detector profiles"""
    
    def __init__(self, profiles_dir: str = "profiles", templates_dir: str = "templates"):
        self.profiles_dir = Path(profiles_dir)
        self.templates_dir = Path(templates_dir)
        self.profiles_dir.mkdir(exist_ok=True)
        self.templates_dir.mkdir(exist_ok=True)
        self._profiles_cache: Dict[str, DetectorProfile] = {}
    
    def save_profile(self, profile: DetectorProfile, filename: Optional[str] = None) -> str:
        """Save a detector profile to disk"""
        if filename is None:
            filename = f"{profile.name.lower().replace(' ', '_')}.json"
        
        filepath = self.profiles_dir / filename
        
        # Convert profile to dict for JSON serialization
        profile_dict = asdict(profile)
        
        # Convert enums to strings
        profile_dict['structure_type'] = profile.structure_type.value
        profile_dict['geometry']['patch_shape'] = profile.geometry.patch_shape.value
        
        with open(filepath, 'w') as f:
            json.dump(profile_dict, f, indent=2, default=str)
        
        logger.info(f"Saved profile '{profile.name}' to {filepath}")
        return str(filepath)
    
    def load_profile(self, filename: str) -> DetectorProfile:
        """Load a detector profile from disk"""
        filepath = self.profiles_dir / filename
        
        if not filepath.exists():
            raise FileNotFoundError(f"Profile file not found: {filepath}")
        
        with open(filepath, 'r') as f:
            profile_dict = json.load(f)
        
        # Convert string enums back to enum objects
        profile_dict['structure_type'] = StructureType(profile_dict['structure_type'])
        profile_dict['geometry']['patch_shape'] = PatchShape(profile_dict['geometry']['patch_shape'])
        
        # Reconstruct nested objects
        geometry = GeometricParameters(**profile_dict['geometry'])
        thresholds = DetectionThresholds(**profile_dict['thresholds'])
        
        # Reconstruct feature configurations
        features = {}
        for name, config_dict in profile_dict['features'].items():
            features[name] = FeatureConfiguration(**config_dict)
        
        profile_dict['geometry'] = geometry
        profile_dict['thresholds'] = thresholds
        profile_dict['features'] = features
        
        profile = DetectorProfile(**profile_dict)
        
        logger.info(f"Loaded profile '{profile.name}' from {filepath}")
        return profile
    
    def list_profiles(self) -> List[str]:
        """List all available profile files"""
        return [f.name for f in self.profiles_dir.glob("*.json")]
    
    def create_preset_profiles(self) -> None:
        """Create a set of preset profiles for common use cases"""
        presets = [
            DetectorProfile(
                name="Amazon Windmill",
                description="Optimized for detecting windmill structures in Amazonian terrain",
                structure_type=StructureType.WINDMILL,
                geometry=GeometricParameters(
                    resolution_m=0.5,
                    structure_radius_m=8.0,
                    patch_size_m=(20.0, 20.0)
                )
            ),
            DetectorProfile(
                name="High Resolution Settlement",
                description="High-resolution detection for small settlements",
                structure_type=StructureType.SETTLEMENT,
                geometry=GeometricParameters(
                    resolution_m=0.25,
                    structure_radius_m=15.0,
                    patch_size_m=(40.0, 40.0)
                )
            ),
            DetectorProfile(
                name="Large Scale Earthwork",
                description="Detection of large earthwork structures",
                structure_type=StructureType.EARTHWORK,
                geometry=GeometricParameters(
                    resolution_m=1.0,
                    structure_radius_m=25.0,
                    patch_size_m=(60.0, 60.0)
                )
            ),
            DetectorProfile(
                name="Fast Survey Mode",
                description="Quick detection with minimal features for large area surveys",
                structure_type=StructureType.GENERIC,
                features={
                    "histogram": FeatureConfiguration(enabled=True, weight=2.0),
                    "volume": FeatureConfiguration(enabled=True, weight=1.5),
                    "dropoff": FeatureConfiguration(enabled=False),
                    "compactness": FeatureConfiguration(enabled=False),
                    "entropy": FeatureConfiguration(enabled=False),
                    "planarity": FeatureConfiguration(enabled=False)
                },
                thresholds=DetectionThresholds(
                    early_decision_threshold=0.75,
                    min_modules_for_decision=1
                )
            )
        ]
        
        for profile in presets:
            profile.optimize_for_structure_type()
            # Save templates to templates directory
            self.save_template(profile)
            # Also save to profiles for immediate use
            self.save_profile(profile)
        
        logger.info(f"Created {len(presets)} template profiles")
    
    def save_template(self, profile: DetectorProfile, filename: Optional[str] = None) -> str:
        """Save a detector profile as a template"""
        if filename is None:
            filename = f"{profile.name.lower().replace(' ', '_')}.json"
        
        filepath = self.templates_dir / filename
        
        # Convert profile to dict for JSON serialization
        profile_dict = asdict(profile)
        
        # Convert enums to strings
        profile_dict['structure_type'] = profile.structure_type.value
        profile_dict['geometry']['patch_shape'] = profile.geometry.patch_shape.value
        
        with open(filepath, 'w') as f:
            json.dump(profile_dict, f, indent=2, default=str)
        
        logger.info(f"Saved template '{profile.name}' to {filepath}")
        return str(filepath)
    
    def load_template(self, filename: str) -> DetectorProfile:
        """Load a detector profile template"""
        filepath = self.templates_dir / filename
        
        if not filepath.exists():
            raise FileNotFoundError(f"Template file not found: {filepath}")
        
        return self._load_profile_from_path(filepath)
    
    def list_templates(self) -> List[str]:
        """List all available template files"""
        return [f.name for f in self.templates_dir.glob("*.json")]
    
    def copy_template_to_profile(self, template_name: str, new_profile_name: str = None) -> DetectorProfile:
        """Copy a template to the profiles directory for customization"""
        # Load the template
        template = self.load_template(template_name)
        
        # Optionally rename
        if new_profile_name:
            template.name = new_profile_name
        
        # Save to profiles directory
        self.save_profile(template)
        
        logger.info(f"Copied template '{template_name}' to profiles as '{template.name}'")
        return template
    
    def _load_profile_from_path(self, filepath: Path) -> DetectorProfile:
        """Helper method to load profile from any path"""
        with open(filepath, 'r') as f:
            profile_dict = json.load(f)
        
        # Convert string enums back to enum objects
        profile_dict['structure_type'] = StructureType(profile_dict['structure_type'])
        profile_dict['geometry']['patch_shape'] = PatchShape(profile_dict['geometry']['patch_shape'])
        
        # Reconstruct nested objects
        geometry = GeometricParameters(**profile_dict['geometry'])
        thresholds = DetectionThresholds(**profile_dict['thresholds'])
        
        # Reconstruct feature configurations
        features = {}
        for name, config_dict in profile_dict['features'].items():
            features[name] = FeatureConfiguration(**config_dict)
        
        profile_dict['geometry'] = geometry
        profile_dict['thresholds'] = thresholds
        profile_dict['features'] = features
        
        profile = DetectorProfile(**profile_dict)
        
        logger.info(f"Loaded profile '{profile.name}' from {filepath}")
        return profile
