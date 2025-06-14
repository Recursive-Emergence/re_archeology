"""
Volume Feature Module

Validates structure volume and prominence by analyzing elevation
distribution and mass concentration.
"""

import numpy as np
from typing import Dict, Any

from ..base_module import BaseFeatureModule, FeatureResult


class VolumeModule(BaseFeatureModule):
    """
    Analyzes structure volume and height prominence.
    
    Calculates volume above baseline and height prominence to identify
    elevated structures with significant mass concentration.
    """
    
    def __init__(self, weight: float = 1.3):
        super().__init__("Volume", weight)
        self.volume_normalization = 50.0  # Normalization factor for volume
        self.prominence_normalization = 5.0  # Normalization factor for prominence
        self.border_width_factor = 0.25  # Border width as fraction of radius
    
    def compute(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Compute volume-based prominence score
        
        Args:
            elevation_patch: 2D elevation data array
            **kwargs: Additional parameters
            
        Returns:
            FeatureResult with volume-based confidence
        """
        try:
            h, w = elevation_patch.shape
            center_y, center_x = h // 2, w // 2
            radius = self.structure_radius_px
            
            # Create circular mask for structure
            y, x = np.ogrid[:h, :w]
            structure_mask = ((y - center_y)**2 + (x - center_x)**2) <= radius**2
            
            # Calculate base elevation from edge areas
            border_width = max(2, int(radius * self.border_width_factor))
            edge_mask = np.zeros_like(elevation_patch, dtype=bool)
            edge_mask[:border_width, :] = True
            edge_mask[-border_width:, :] = True
            edge_mask[:, :border_width] = True
            edge_mask[:, -border_width:] = True
            
            if np.any(edge_mask):
                base_elevation = np.median(elevation_patch[edge_mask])
            else:
                base_elevation = np.median(elevation_patch)
            
            # Calculate volume and prominence metrics
            if np.any(structure_mask):
                structure_heights = elevation_patch[structure_mask]
                
                # Volume above base
                volume_above_base = np.sum(np.maximum(0, structure_heights - base_elevation)) * (self.resolution_m ** 2)
                
                # Height prominence
                structure_max = np.max(structure_heights)
                structure_mean = np.mean(structure_heights)
                height_prominence = structure_max - base_elevation
                
                # Surrounding area analysis
                surround_inner_radius = radius + 2
                surround_outer_radius = min(h, w) // 2 - 2
                surround_mask = (((y - center_y)**2 + (x - center_x)**2 <= surround_outer_radius**2) &
                               ((y - center_y)**2 + (x - center_x)**2 > surround_inner_radius**2))
                
                if np.any(surround_mask):
                    surround_heights = elevation_patch[surround_mask]
                    surround_mean = np.mean(surround_heights)
                    surround_std = np.std(surround_heights)
                    relative_prominence = height_prominence / (surround_std + 0.1)
                else:
                    surround_mean = base_elevation
                    relative_prominence = height_prominence
                
                # Calculate concentration metrics
                structure_area = np.sum(structure_mask) * (self.resolution_m ** 2)
                height_density = volume_above_base / (structure_area + 1e-6)
                
                # Normalize scores
                volume_score = min(1.0, volume_above_base / self.volume_normalization)
                prominence_score = min(1.0, height_prominence / self.prominence_normalization)
                
                # Combined score with weighting
                combined_score = (0.6 * volume_score + 0.4 * prominence_score)
                
                # Bonus for concentrated elevation (vs. spread out)
                if height_density > 1.0:
                    combined_score *= 1.1
                
            else:
                combined_score = 0.0
                volume_above_base = 0.0
                height_prominence = 0.0
                structure_max = base_elevation
                structure_mean = base_elevation
                relative_prominence = 0.0
                height_density = 0.0
                structure_area = 0.0
            
            return FeatureResult(
                score=combined_score,
                polarity="neutral",  # Dynamic polarity interpretation by aggregator
                metadata={
                    "normalized_volume": combined_score,  # For dynamic interpretation
                    "volume_above_base": float(volume_above_base),
                    "height_prominence": float(height_prominence),
                    "relative_prominence": float(relative_prominence),
                    "structure_max_height": float(structure_max),
                    "structure_mean_height": float(structure_mean),
                    "base_elevation": float(base_elevation),
                    "structure_area": float(structure_area),
                    "height_density": float(height_density),
                    "structure_pixels": int(np.sum(structure_mask)),
                    "volume_score": float(volume_score if 'volume_score' in locals() else 0),
                    "prominence_score": float(prominence_score if 'prominence_score' in locals() else 0)
                },
                reason=f"Volume analysis: vol={volume_above_base:.1f}, prom={height_prominence:.2f}m"
            )
            
        except Exception as e:
            return FeatureResult(
                score=0.0,
                valid=False,
                reason=f"Volume computation failed: {str(e)}"
            )
    
    def configure(self, 
                 volume_normalization: float = None,
                 prominence_normalization: float = None,
                 border_width_factor: float = None):
        """Configure module parameters"""
        if volume_normalization is not None:
            self.volume_normalization = volume_normalization
        if prominence_normalization is not None:
            self.prominence_normalization = prominence_normalization
        if border_width_factor is not None:
            self.border_width_factor = border_width_factor
