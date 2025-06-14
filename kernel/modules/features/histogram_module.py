"""
Elevation Histogram Similarity Module

Implements elevation histogram matching as a standalone feature module.
This is the core pattern-matching component that was originally embedded in φ⁰.
"""

import numpy as np
from typing import Dict, Any, Optional
from ..base_module import BaseFeatureModule, FeatureResult


class ElevationHistogramModule(BaseFeatureModule):
    """
    Validates elevation histogram similarity patterns for structure detection.
    
    This module extracts the elevation histogram matching logic from φ⁰ core
    and makes it available as an independent feature validator. It computes
    the similarity between a local elevation patch and a reference pattern.
    """
    
    def __init__(self, weight: float = 1.5):  # Higher weight as it's fundamental
        super().__init__("ElevationHistogram", weight)
        self.reference_kernel: Optional[np.ndarray] = None
        self.min_variation = 0.3  # Minimum elevation variation threshold
    
    def set_reference_kernel(self, kernel: np.ndarray):
        """Set the reference elevation kernel for comparison"""
        self.reference_kernel = kernel
    
    def compute(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Compute elevation histogram similarity score
        
        Args:
            elevation_patch: Local elevation data patch
            **kwargs: Optional parameters including reference_kernel
            
        Returns:
            FeatureResult with histogram similarity score
        """
        try:
            # Get reference kernel from kwargs or use stored kernel
            reference_kernel = kwargs.get('reference_kernel', self.reference_kernel)
            
            if reference_kernel is None:
                # If no reference kernel, create a synthetic windmill-like pattern
                reference_kernel = self._create_synthetic_windmill_pattern(elevation_patch.shape)
            
            # Compute histogram similarity
            similarity_score = self._compute_histogram_similarity(elevation_patch, reference_kernel)
            
            # Additional pattern metrics
            pattern_strength = self._compute_pattern_strength(elevation_patch)
            elevation_coherence = self._compute_elevation_coherence(elevation_patch)
            
            # Combine metrics with weighted average
            final_score = (
                0.6 * similarity_score +
                0.25 * pattern_strength +
                0.15 * elevation_coherence
            )
            
            return FeatureResult(
                score=max(0.0, min(1.0, final_score)),
                polarity="neutral",  # Dynamic polarity interpretation by aggregator
                metadata={
                    "phi0_signature": final_score,  # For dynamic interpretation
                    "histogram_similarity": similarity_score,
                    "pattern_strength": pattern_strength,
                    "elevation_coherence": elevation_coherence,
                    "has_reference_kernel": reference_kernel is not None,
                    "elevation_range": np.max(elevation_patch) - np.min(elevation_patch),
                    "patch_shape": elevation_patch.shape
                },
                valid=True,
                reason=f"Histogram similarity: {similarity_score:.3f}, Pattern strength: {pattern_strength:.3f}"
            )
            
        except Exception as e:
            return FeatureResult(
                score=0.0,
                valid=False,
                reason=f"Histogram computation failed: {str(e)}"
            )
    
    def _compute_histogram_similarity(self, local_elevation: np.ndarray, 
                                    kernel_elevation: np.ndarray) -> float:
        """
        Compute elevation histogram matching score with vegetation discrimination
        
        Based on the original φ⁰ implementation but adapted for modular use.
        """
        # Check elevation range requirements
        local_range = np.max(local_elevation) - np.min(local_elevation)
        kernel_range = np.max(kernel_elevation) - np.min(kernel_elevation)
        
        if local_range < self.min_variation or kernel_range < self.min_variation:
            return 0.0
        
        # Normalize to relative patterns
        local_relative = local_elevation - np.min(local_elevation)
        kernel_relative = kernel_elevation - np.min(kernel_elevation)
        
        local_max_rel = np.max(local_relative)
        kernel_max_rel = np.max(kernel_relative)
        
        if local_max_rel < 0.3 or kernel_max_rel < 0.3:
            return 0.0
        
        # Create and compare histograms
        local_normalized = local_relative / local_max_rel
        kernel_normalized = kernel_relative / kernel_max_rel
        
        num_bins = 20
        bin_edges = np.linspace(0, 1, num_bins + 1)
        
        local_hist, _ = np.histogram(local_normalized.flatten(), bins=bin_edges, density=True)
        kernel_hist, _ = np.histogram(kernel_normalized.flatten(), bins=bin_edges, density=True)
        
        # Normalize to probability distributions
        local_hist = local_hist / (np.sum(local_hist) + 1e-8)
        kernel_hist = kernel_hist / (np.sum(kernel_hist) + 1e-8)
        
        # Cosine similarity
        local_norm = np.linalg.norm(local_hist)
        kernel_norm = np.linalg.norm(kernel_hist)
        
        if local_norm < 1e-8 or kernel_norm < 1e-8:
            return 0.0
        
        similarity = np.dot(local_hist, kernel_hist) / (local_norm * kernel_norm)
        return max(0.0, min(1.0, similarity))
    
    def _compute_pattern_strength(self, elevation_patch: np.ndarray) -> float:
        """Compute the strength of elevation patterns"""
        # Calculate gradient magnitude
        grad_y, grad_x = np.gradient(elevation_patch)
        grad_magnitude = np.sqrt(grad_x**2 + grad_y**2)
        
        # Pattern strength based on gradient concentration
        grad_mean = np.mean(grad_magnitude)
        grad_std = np.std(grad_magnitude)
        
        # Strong patterns have high gradient variation
        pattern_strength = min(1.0, grad_std / (grad_mean + 1e-8))
        
        return pattern_strength
    
    def _compute_elevation_coherence(self, elevation_patch: np.ndarray) -> float:
        """Compute elevation coherence (how well-formed the elevation pattern is)"""
        center = np.array(elevation_patch.shape) // 2
        y, x = np.ogrid[:elevation_patch.shape[0], :elevation_patch.shape[1]]
        distances = np.sqrt((y - center[0])**2 + (x - center[1])**2)
        
        # Check if elevation decreases with distance from center
        max_distance = np.max(distances)
        distance_normalized = distances / max_distance
        
        # Compute correlation between elevation and inverse distance
        center_elevation = elevation_patch[center[0], center[1]]
        elevation_diff = elevation_patch - center_elevation
        
        # Coherence based on how elevation relates to distance from center
        coherence = 1.0 - np.corrcoef(distance_normalized.flatten(), 
                                     np.abs(elevation_diff).flatten())[0, 1]
        
        return max(0.0, min(1.0, coherence)) if not np.isnan(coherence) else 0.0
    
    def _create_synthetic_windmill_pattern(self, shape: tuple) -> np.ndarray:
        """
        Create a synthetic windmill-like elevation pattern when no reference kernel is available
        """
        h, w = shape
        center_y, center_x = h // 2, w // 2
        y, x = np.ogrid[:h, :w]
        
        # Distance from center
        distances = np.sqrt((y - center_y)**2 + (x - center_x)**2)
        max_distance = np.sqrt(center_y**2 + center_x**2)
        
        # Create windmill-like pattern: elevated center with gradual falloff
        base_radius = min(h, w) // 4
        elevation = np.zeros_like(distances, dtype=float)
        
        # Central mound
        center_mask = distances <= base_radius
        elevation[center_mask] = 2.0 * np.exp(-0.1 * distances[center_mask])
        
        # Tower area (higher elevation in center)
        tower_mask = distances <= base_radius // 2
        elevation[tower_mask] += 1.0 * np.exp(-0.2 * distances[tower_mask])
        
        # Add some noise for realism
        elevation += np.random.normal(0, 0.05, elevation.shape)
        
        return elevation

    def set_parameters(self, resolution_m: float, structure_radius_px: int):
        """Set module parameters based on detection context"""
        super().set_parameters(resolution_m, structure_radius_px)
        
        # Adjust minimum variation based on structure size
        # Larger structures can have more variation
        self.min_variation = max(0.2, min(0.5, structure_radius_px * 0.01))
