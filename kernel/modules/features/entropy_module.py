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
    
    @classmethod
    def get_default_parameters(cls) -> Dict[str, Any]:
        """Return default parameters for entropy analysis"""
        return {
            "entropy_method": "shannon",
            "window_size": 3,
            "adaptive_window": True,
            "normalize_entropy": True,
            "local_variance_weight": 0.3,
            "entropy_threshold": 10.0,
            "gradient_analysis": True,
            "laplacian_analysis": True
        }
    
    def __init__(self, weight: float = 1.0):
        super().__init__("ElevationEntropy", weight)
        
        # Initialize with default parameters
        defaults = self.get_default_parameters()
        for param, value in defaults.items():
            setattr(self, param, value)
    
    @property
    def parameter_documentation(self) -> Dict[str, str]:
        """Documentation for all entropy analysis parameters"""
        return {
            "entropy_method": "Method for entropy calculation: 'shannon' for Shannon entropy, 'sample' for sample entropy",
            "window_size": "Size of sliding window for local entropy calculation (odd numbers recommended)",
            "adaptive_window": "Whether to adapt window size based on local structure characteristics",
            "normalize_entropy": "Whether to normalize entropy values to 0-1 range for consistent interpretation",
            "local_variance_weight": "Weight given to local variance in combined entropy-variance analysis (0.0-1.0)",
            "entropy_threshold": "Threshold above which entropy is considered high (structure-dependent)",
            "gradient_analysis": "Whether to include gradient-based entropy analysis for edge detection",
            "laplacian_analysis": "Whether to include Laplacian-based analysis for surface roughness detection"
        }
    
    @property
    def result_documentation(self) -> Dict[str, str]:
        """Documentation for entropy analysis result metadata"""
        return {
            "entropy_score": "Overall entropy-based structure score (lower = more regular/artificial)",
            "shannon_entropy": "Shannon entropy of elevation values (higher = more random/complex)",
            "local_variance": "Average local variance within analysis windows",
            "gradient_entropy": "Entropy of elevation gradients (if gradient_analysis=True)",
            "laplacian_variance": "Variance of Laplacian values (surface roughness measure)",
            "entropy_map": "Spatial map of local entropy values across the patch",
            "regularity_score": "Inverse entropy score (higher = more regular/structured)",
            "complexity_level": "Categorization of surface complexity (low/medium/high)",
            "surface_roughness": "Measure of surface roughness based on Laplacian analysis",
            "gradient_consistency": "How consistent elevation gradients are across the patch",
            "adaptive_window_size": "Window size used if adaptive windowing was enabled",
            "normalization_factor": "Factor used for entropy normalization (if normalize_entropy=True)"
        }
    
    @property
    def interpretation_guide(self) -> Dict[str, str]:
        """Guide for interpreting entropy analysis results"""
        return {
            "Low Entropy (<0.3)": "Very regular elevation pattern - likely artificial structure or smooth natural feature",
            "Medium Entropy (0.3-0.7)": "Moderate complexity - could be partially preserved structure or varied terrain",
            "High Entropy (>0.7)": "Complex, irregular pattern - likely vegetation, rubble, or heavily eroded feature",
            "Low Surface Roughness": "Smooth surface typical of constructed platforms or natural mounds",
            "High Surface Roughness": "Irregular surface typical of vegetation canopy or damaged structures",
            "Consistent Gradients": "Uniform slope patterns typical of artificial construction",
            "Inconsistent Gradients": "Variable slopes typical of natural terrain or erosion patterns",
            "High Regularity Score": "Artificial or well-preserved structure with ordered elevation patterns",
            "Low Regularity Score": "Natural or heavily degraded feature with chaotic elevation patterns"
        }
    
    @property
    def feature_description(self) -> str:
        """Overall description of what the entropy feature analyzes"""
        return """
        Elevation Entropy Analysis:
        
        The entropy module quantifies the regularity and complexity of elevation patterns to distinguish
        between artificial structures and natural terrain features. It calculates various entropy measures
        and surface roughness metrics to identify ordered vs chaotic elevation distributions.
        
        Key Capabilities:
        - Shannon entropy calculation for elevation value distributions
        - Local variance analysis with sliding window approach
        - Gradient entropy for edge pattern analysis
        - Laplacian analysis for surface roughness quantification
        - Adaptive windowing based on local structure characteristics
        
        Best For:
        - Distinguishing artificial structures from vegetation
        - Detecting well-preserved vs heavily eroded features
        - Identifying regular geometric patterns in elevation data
        - Filtering out areas with high vegetation or surface complexity
        """
    
    def compute(self, elevation_patch: np.ndarray, **kwargs) -> FeatureResult:
        """
        Compute elevation entropy score using surface roughness and Shannon entropy multiplier.
        """
        try:
            # Surface roughness using Laplacian
            laplacian = laplace(elevation_patch)
            surface_roughness = np.std(laplacian)

            # Shannon entropy of elevation values
            def shannon_entropy(region, bins=32):
                hist, _ = np.histogram(region.flatten(), bins=bins, density=True)
                hist = hist[hist > 0]
                return -np.sum(hist * np.log2(hist))
            se = shannon_entropy(elevation_patch)

            # Combine: surface roughness * (1 + alpha * shannon_entropy)
            alpha = 0.15  # Tunable multiplier weight
            raw_score = surface_roughness * (1 + alpha * se)

            # Normalize (empirically, e.g., divide by 20.0 to map to ~[0,1] for typical data)
            normalized_score = min(1.0, raw_score / 20.0)

            # Lower score = more regular (windmill), higher = more complex (trees)
            structure_score = normalized_score

            if np.any(np.isnan(elevation_patch)) or np.any(np.isinf(elevation_patch)):
                return FeatureResult(
                    score=0.0,
                    valid=False,
                    reason="Invalid elevation data (NaN/Inf values)"
                )

            return FeatureResult(
                score=structure_score,
                polarity="negative",
                metadata={
                    "surface_roughness": float(surface_roughness),
                    "shannon_entropy": float(se),
                    "raw_score": float(raw_score),
                    "normalized_score": float(normalized_score)
                },
                reason=f"Entropy analysis: structure_score={structure_score:.3f}, polarity=negative"
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
