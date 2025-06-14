"""
Dropoff Sharpness Feature Module

Validates elevation dropoff sharpness around structure edges using
Difference of Gaussians (DoG) edge detection and ring analysis.
"""

import numpy as np
from scipy.ndimage import gaussian_filter
from typing import Dict, Any

from ..base_module import BaseFeatureModule, FeatureResult


class DropoffSharpnessModule(BaseFeatureModule):
    """
    Analyzes edge sharpness around structures using ring-based edge detection.
    
    Sharp dropoffs indicate well-defined artificial structures, while gradual
    transitions suggest natural terrain features.
    """
    
    def __init__(self, weight: float = 1.2):
        super().__init__("DropoffSharpness", weight)
        self.sigma_inner_factor = 0.8  # Inner Gaussian sigma factor
        self.sigma_outer_factor = 1.2  # Outer Gaussian sigma factor
        self.ring_inner_factor = 0.8   # Inner ring boundary factor
        self.ring_outer_factor = 1.2   # Outer ring boundary factor
    
    def compute(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Compute dropoff sharpness score using ring edge detection
        
        Args:
            elevation_patch: 2D elevation data array
            **kwargs: Additional parameters
            
        Returns:
            FeatureResult with edge sharpness confidence
        """
        try:
            radius = self.structure_radius_px
            sigma1 = radius * self.sigma_inner_factor * self.resolution_m
            sigma2 = radius * self.sigma_outer_factor * self.resolution_m
            
            # Difference of Gaussians for edge detection
            dog = gaussian_filter(elevation_patch, sigma1) - gaussian_filter(elevation_patch, sigma2)
            edge_strength = np.abs(dog)
            
            # Normalize edge strength
            edge_95th = np.percentile(edge_strength, 95)
            if edge_95th > 0:
                edge_strength = edge_strength / (edge_95th + 1e-6)
            
            # Calculate mean edge strength in ring around structure
            h, w = elevation_patch.shape
            center_y, center_x = h // 2, w // 2
            
            # Create ring mask
            y, x = np.ogrid[:h, :w]
            distances = np.sqrt((y - center_y)**2 + (x - center_x)**2)
            ring_mask = ((distances >= radius * self.ring_inner_factor) & 
                        (distances <= radius * self.ring_outer_factor))
            
            if np.any(ring_mask):
                ring_sharpness = np.mean(edge_strength[ring_mask])
                ring_pixels = np.sum(ring_mask)
            else:
                ring_sharpness = np.mean(edge_strength)
                ring_pixels = edge_strength.size
            
            # Calculate additional edge metrics
            max_edge_strength = np.max(edge_strength)
            edge_concentration = np.sum(edge_strength > 0.5) / edge_strength.size
            
            sharpness_score = np.clip(ring_sharpness, 0, 1)
            
            return FeatureResult(
                score=sharpness_score,
                polarity="neutral",
                metadata={
                    "edge_sharpness": float(sharpness_score),
                    "mean_ring_edge_strength": float(ring_sharpness),
                    "max_edge_strength": float(max_edge_strength),
                    "edge_concentration": float(edge_concentration),
                    "ring_pixels": int(ring_pixels),
                    "sigma1": float(sigma1),
                    "sigma2": float(sigma2),
                    "radius_used": int(radius)
                },
                reason=f"Dropoff sharpness: ring_strength={sharpness_score:.3f}"
            )
            
        except Exception as e:
            return FeatureResult(
                score=0.0,
                valid=False,
                reason=f"Dropoff sharpness computation failed: {str(e)}"
            )
    
    def configure(self, 
                 sigma_inner_factor: float = None,
                 sigma_outer_factor: float = None,
                 ring_inner_factor: float = None,
                 ring_outer_factor: float = None):
        """Configure module parameters"""
        if sigma_inner_factor is not None:
            self.sigma_inner_factor = sigma_inner_factor
        if sigma_outer_factor is not None:
            self.sigma_outer_factor = sigma_outer_factor
        if ring_inner_factor is not None:
            self.ring_inner_factor = ring_inner_factor
        if ring_outer_factor is not None:
            self.ring_outer_factor = ring_outer_factor
