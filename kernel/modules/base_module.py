"""
Base Feature Module Interface for G₂ Detection System

All feature modules inherit from this base class and implement the compute method
to provide independent, parallelizable feature validation.
"""

import numpy as np
from abc import ABC, abstractmethod
from typing import Dict, Any, Tuple
from dataclasses import dataclass


@dataclass
class FeatureResult:
    """Result from a feature module computation with polarity support"""
    score: float  # Confidence score in [0, 1] range
    polarity: str = "positive"  # "positive" or "negative" for bidirectional evidence
    metadata: Dict[str, Any] = None
    reason: str = ""
    valid: bool = True


class BaseFeatureModule(ABC):
    """Base class for all feature modules"""
    
    def __init__(self, name: str = None, weight: float = 1.0):
        self.name = name or self.__class__.__name__
        self.weight = weight
        self.resolution_m = 0.5
        self.structure_radius_px = 16
    
    @abstractmethod
    def compute(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Compute feature score for the given elevation patch
        
        Args:
            elevation_patch: 2D numpy array of elevation data
            **kwargs: Additional parameters specific to the feature
            
        Returns:
            FeatureResult with score, metadata, and validation info
        """
        pass
    
    def extract_features(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Alias for compute method to maintain compatibility
        """
        return self.compute(elevation_patch, **kwargs)
    
    def set_parameters(self, resolution_m: float, structure_radius_px: int):
        """Set common parameters for the feature module"""
        self.resolution_m = resolution_m
        self.structure_radius_px = structure_radius_px
