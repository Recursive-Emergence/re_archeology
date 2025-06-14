"""
Elevation Entropy Feature Module

Validates elevation entropy patterns for structure detection by analyzing
elevation variance, gradient variation, and surface roughness.
"""

import numpy as np
from scipy.ndimage import laplace
from typing import Dict, Any

from ..base_module import BaseFeatureModule, FeatureResult


class ElevationEntropyModule(BaseFeatureModule):
    """
    Analyzes elevation entropy to distinguish structures from vegetation.
    
    Lower entropy (more regular patterns) indicates artificial structures,
    while higher entropy suggests natural vegetation or terrain irregularities.
    """
    
    def __init__(self, weight: float = 1.0):
        super().__init__("ElevationEntropy", weight)
        self.entropy_threshold = 10.0  # Normalization threshold
    
    def compute(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Compute elevation entropy score
        
        Args:
            elevation_patch: 2D elevation data array
            **kwargs: Additional parameters
            
        Returns:
            FeatureResult with entropy-based structure confidence
        """
        try:
            # Calculate local elevation variance
            local_var = np.var(elevation_patch)
            
            # Calculate gradient variation
            grad_x = np.gradient(elevation_patch, axis=1)
            grad_y = np.gradient(elevation_patch, axis=0)
            grad_magnitude = np.sqrt(grad_x**2 + grad_y**2)
            grad_var = np.var(grad_magnitude)
            
            # Surface roughness using Laplacian
            laplacian = laplace(elevation_patch)
            surface_roughness = np.std(laplacian)
            
            # Combine metrics (normalized empirically)
            raw_entropy = (local_var + grad_var + surface_roughness) / 3.0
            normalized_entropy = min(1.0, raw_entropy / self.entropy_threshold)
            
            # Invert score (lower entropy = higher structure confidence)
            structure_score = 1.0 - normalized_entropy
            
            # Additional validation - check for extreme values
            if np.any(np.isnan(elevation_patch)) or np.any(np.isinf(elevation_patch)):
                return FeatureResult(
                    score=0.0,
                    valid=False,
                    reason="Invalid elevation data (NaN/Inf values)"
                )
            
            return FeatureResult(
                score=structure_score,
                polarity="neutral",
                metadata={
                    "combined_entropy": float(structure_score),
                    "local_variance": float(local_var),
                    "gradient_variance": float(grad_var),
                    "surface_roughness": float(surface_roughness),
                    "raw_entropy": float(raw_entropy),
                    "normalized_entropy": float(normalized_entropy)
                },
                reason=f"Entropy analysis: structure_score={structure_score:.3f}"
            )
            
        except Exception as e:
            return FeatureResult(
                score=0.0,
                valid=False,
                reason=f"Entropy computation failed: {str(e)}"
            )
    
    def configure(self, entropy_threshold: float = None):
        """Configure module parameters"""
        if entropy_threshold is not None:
            self.entropy_threshold = entropy_threshold
