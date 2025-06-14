"""
Compactness Feature Module

Validates structure compactness and circular geometry by analyzing
radial symmetry and shape regularity.
"""

import numpy as np
from typing import Dict, Any

from ..base_module import BaseFeatureModule, FeatureResult


class CompactnessModule(BaseFeatureModule):
    """
    Analyzes geometric compactness using radial distance symmetry.
    
    Compact, circular structures show high radial symmetry, while
    irregular or linear features show lower symmetry scores.
    """
    
    def __init__(self, weight: float = 1.1):
        super().__init__("Compactness", weight)
        self.n_angles = 16  # Number of radial samples
        self.min_samples = 8  # Minimum samples for valid analysis
        self.symmetry_factor = 2.0  # Factor for symmetry calculation
    
    def compute(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Compute compactness score based on circular symmetry
        
        Args:
            elevation_patch: 2D elevation data array
            **kwargs: Additional parameters
            
        Returns:
            FeatureResult with compactness confidence
        """
        try:
            h, w = elevation_patch.shape
            center_y, center_x = h // 2, w // 2
            radius = self.structure_radius_px
            
            # Compute radial distance symmetry
            angles = np.linspace(0, 2*np.pi, self.n_angles, endpoint=False)
            values = []
            valid_samples = 0
            
            for angle in angles:
                dy = int(radius * np.sin(angle))
                dx = int(radius * np.cos(angle))
                y_pos = center_y + dy
                x_pos = center_x + dx
                
                if 0 <= y_pos < h and 0 <= x_pos < w:
                    values.append(elevation_patch[y_pos, x_pos])
                    valid_samples += 1
            
            if valid_samples < self.min_samples:
                return FeatureResult(
                    score=0.0,
                    valid=False,
                    reason=f"Insufficient valid samples: {valid_samples} < {self.min_samples}"
                )
            
            values = np.array(values)
            
            # Calculate symmetry metrics
            std_dev = np.std(values)
            mean_val = np.mean(values)
            relative_std = std_dev / (abs(mean_val) + 1e-6)
            
            # Symmetry score (lower relative std = higher symmetry)
            symmetry_score = 1.0 / (1.0 + self.symmetry_factor * relative_std)
            
            # Additional compactness metrics
            value_range = np.max(values) - np.min(values)
            coefficient_of_variation = std_dev / (abs(mean_val) + 1e-6)
            
            # Check for outliers (potential vegetation)
            q75, q25 = np.percentile(values, [75, 25])
            iqr = q75 - q25
            outlier_threshold = 1.5 * iqr
            outliers = np.sum((values < (q25 - outlier_threshold)) | 
                            (values > (q75 + outlier_threshold)))
            outlier_ratio = outliers / len(values)
            
            # Penalize if too many outliers (suggests vegetation)
            if outlier_ratio > 0.25:
                symmetry_score *= (1.0 - outlier_ratio)
            
            return FeatureResult(
                score=symmetry_score,
                polarity="neutral",
                metadata={
                    "compactness": float(symmetry_score),
                    "relative_std": float(relative_std),
                    "coefficient_of_variation": float(coefficient_of_variation),
                    "value_range": float(value_range),
                    "mean_elevation": float(mean_val),
                    "std_elevation": float(std_dev),
                    "valid_samples": int(valid_samples),
                    "outlier_ratio": float(outlier_ratio),
                    "radius_used": int(radius)
                },
                reason=f"Compactness: symmetry={symmetry_score:.3f}, cv={coefficient_of_variation:.3f}"
            )
            
        except Exception as e:
            return FeatureResult(
                score=0.0,
                valid=False,
                reason=f"Compactness computation failed: {str(e)}"
            )
    
    def configure(self, 
                 n_angles: int = None,
                 min_samples: int = None,
                 symmetry_factor: float = None):
        """Configure module parameters"""
        if n_angles is not None:
            self.n_angles = n_angles
        if min_samples is not None:
            self.min_samples = min_samples
        if symmetry_factor is not None:
            self.symmetry_factor = symmetry_factor
