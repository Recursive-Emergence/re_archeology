"""
Planarity Feature Module

Validates local planarity and surface regularity using least squares
plane fitting and residual analysis.
"""

import numpy as np
from typing import Dict, Any

from ..base_module import BaseFeatureModule, FeatureResult


class PlanarityModule(BaseFeatureModule):
    """
    Analyzes surface planarity within the structure region.
    
    Structures typically have more regular surfaces than natural terrain,
    which can be detected through plane fitting and residual analysis.
    """
    
    def __init__(self, weight: float = 0.9):
        super().__init__("Planarity", weight)
        self.min_points = 10  # Minimum points required for plane fitting
        self.planarity_factor = 1.0  # Factor for planarity calculation
    
    def compute(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Compute planarity score using least squares fitting
        
        Args:
            elevation_patch: 2D elevation data array
            **kwargs: Additional parameters
            
        Returns:
            FeatureResult with planarity confidence
        """
        try:
            h, w = elevation_patch.shape
            center_y, center_x = h // 2, w // 2
            radius = self.structure_radius_px
            
            # Extract local patch around center
            y_start = max(0, center_y - radius)
            y_end = min(h, center_y + radius + 1)
            x_start = max(0, center_x - radius)
            x_end = min(w, center_x + radius + 1)
            
            local_patch = elevation_patch[y_start:y_end, x_start:x_end]
            yy, xx = np.mgrid[:local_patch.shape[0], :local_patch.shape[1]]
            
            # Create circular mask
            local_center_y = local_patch.shape[0] // 2
            local_center_x = local_patch.shape[1] // 2
            mask = (yy - local_center_y)**2 + (xx - local_center_x)**2 <= radius**2
            
            if np.sum(mask) < self.min_points:
                return FeatureResult(
                    score=0.0,
                    valid=False,
                    reason=f"Insufficient points for plane fitting: {np.sum(mask)} < {self.min_points}"
                )
            
            # Fit plane using least squares
            points = np.column_stack([xx[mask], yy[mask], np.ones(np.sum(mask))])
            z_values = local_patch[mask]
            
            try:
                coeffs, residuals, rank, s = np.linalg.lstsq(points, z_values, rcond=None)
                
                # Calculate fitted plane
                z_fit = coeffs[0] * xx + coeffs[1] * yy + coeffs[2]
                fit_residuals = np.abs(local_patch - z_fit)[mask]
                
                # Planarity metrics
                rmse = np.sqrt(np.mean(fit_residuals**2))
                residual_std = np.std(fit_residuals)
                max_residual = np.max(fit_residuals)
                
                # Planarity score (lower residuals = higher planarity)
                planarity_score = self.planarity_factor / (self.planarity_factor + residual_std)
                
                # Additional surface regularity metrics
                surface_variation = np.std(z_values)
                slope_magnitude = np.sqrt(coeffs[0]**2 + coeffs[1]**2)
                
                # Check for systematic patterns in residuals
                residual_range = np.max(fit_residuals) - np.min(fit_residuals)
                relative_rmse = rmse / (surface_variation + 1e-6)
                
                # Penalty for highly sloped surfaces (might be natural slopes)
                if slope_magnitude > 0.5:  # Steep slope
                    planarity_score *= 0.8
                
                return FeatureResult(
                    score=planarity_score,
                    polarity="neutral",
                    metadata={
                        "planarity": float(planarity_score),
                        "rmse": float(rmse),
                        "residual_std": float(residual_std),
                        "max_residual": float(max_residual),
                        "residual_range": float(residual_range),
                        "relative_rmse": float(relative_rmse),
                        "surface_variation": float(surface_variation),
                        "slope_magnitude": float(slope_magnitude),
                        "plane_coeffs": [float(c) for c in coeffs],
                        "mask_pixels": int(np.sum(mask)),
                        "patch_size": local_patch.shape,
                        "radius_used": int(radius)
                    },
                    reason=f"Planarity: score={planarity_score:.3f}, rmse={rmse:.3f}"
                )
                
            except np.linalg.LinAlgError:
                return FeatureResult(
                    score=0.0,
                    valid=False,
                    reason="Singular matrix in plane fitting (degenerate surface)"
                )
            
        except Exception as e:
            return FeatureResult(
                score=0.0,
                valid=False,
                reason=f"Planarity computation failed: {str(e)}"
            )
    
    def configure(self, 
                 min_points: int = None,
                 planarity_factor: float = None):
        """Configure module parameters"""
        if min_points is not None:
            self.min_points = min_points
        if planarity_factor is not None:
            self.planarity_factor = planarity_factor
