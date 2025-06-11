#!/usr/bin/env python3
"""
Phi-Zero (φ⁰) Circular Structure Detection Core - Streamlined Implementation

A clean, condensed implementation of the v8 circular structure detection algorithm
with reduced code redundancy and improved maintainability.

Key Features:
- 8-dimensional octonionic feature extraction
- Elevation histogram matching with vegetation discrimination
- Geometric pattern validation
- Adaptive thresholds based on training statistics
- Structure-agnostic design (windmills, towers, mounds, etc.)

Author: Structure Detection Team
Version: v8-streamlined
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
import pickle
import os
import hashlib
from datetime import datetime
from scipy.ndimage import (
    uniform_filter, gaussian_filter, maximum_filter,
    distance_transform_edt, laplace
)
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class ElevationPatch:
    """Container for elevation data and metadata"""
    elevation_data: np.ndarray
    lat: float = None
    lon: float = None
    source: str = "unknown"
    resolution_m: float = 0.5
    coordinates: Tuple[float, float] = None
    patch_size_m: float = None
    metadata: Dict = None


@dataclass
class DetectionCandidate:
    """Container for detection results"""
    center_y: int
    center_x: int
    psi0_score: float
    coherence: float = 0.0
    confidence: float = 0.0
    location: Tuple[int, int] = None
    size_metrics: Dict = None
    
    def __post_init__(self):
        if self.location is None:
            self.location = (self.center_y, self.center_x)


@dataclass
class DetectionResult:
    """Enhanced detection result with geometric validation"""
    detected: bool
    confidence: float
    reason: str
    max_score: float
    center_score: float
    geometric_score: float
    details: Dict


# =============================================================================
# CONFIGURATION CONSTANTS
# =============================================================================

STRUCTURE_CONFIGS = {
    "windmill": {
        "detection_threshold": 0.50,
        "structure_radius_m": 8.0,
        "min_variation": 1.5,
        "expected_height": 3.0,
        "thresholds": {
            "height_prominence": 1.0,
            "volume": 20.0,
            "elevation_range": 0.5,
            "geometric": 0.25,
            "phi0": 0.30
        }
    },
    "tower": {
        "detection_threshold": 0.45,
        "structure_radius_m": 5.0,
        "min_variation": 1.2,
        "expected_height": 4.0,
        "thresholds": {
            "height_prominence": 1.5,
            "volume": 20.0,
            "elevation_range": 0.8,
            "geometric": 0.45,
            "phi0": 0.32
        }
    },
    "mound": {
        "detection_threshold": 0.30,
        "structure_radius_m": 15.0,
        "min_variation": 0.8,
        "expected_height": 1.5,
        "thresholds": {
            "height_prominence": 1.0,
            "volume": 25.0,
            "elevation_range": 0.6,
            "geometric": 0.42,
            "phi0": 0.30
        }
    }
}


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def compute_stats(values: List[float]) -> Dict:
    """Compute statistical summary of values"""
    if not values:
        return {'mean': None, 'std': None, 'median': None, 'min': None, 'max': None}
    values_array = np.array(values)
    return {
        'mean': float(np.mean(values_array)),
        'std': float(np.std(values_array)),
        'median': float(np.median(values_array)),
        'min': float(np.min(values_array)),
        'max': float(np.max(values_array))
    }


def create_circular_mask(h: int, w: int, center_y: int, center_x: int, radius: int) -> np.ndarray:
    """Create circular mask for region analysis"""
    y, x = np.ogrid[:h, :w]
    return ((y - center_y)**2 + (x - center_x)**2) <= radius**2


def normalize_array(arr: np.ndarray) -> np.ndarray:
    """Normalize array to [0,1] range"""
    min_val, max_val = np.min(arr), np.max(arr)
    if max_val > min_val:
        return (arr - min_val) / (max_val - min_val)
    return arr - min_val


# =============================================================================
# MAIN DETECTOR CLASS
# =============================================================================

class PhiZeroStructureDetector:
    """
    Streamlined implementation of the Phi-Zero circular structure detection algorithm.
    """
    
    def __init__(self, resolution_m: float = 0.5, kernel_size: int = 21, structure_type: str = "windmill"):
        """Initialize the Phi-Zero structure detector."""
        self.resolution_m = resolution_m
        self.kernel_size = kernel_size if kernel_size % 2 == 1 else kernel_size + 1
        self.structure_type = structure_type
        self.n_features = 8
        
        # Get structure configuration
        config = STRUCTURE_CONFIGS.get(structure_type, STRUCTURE_CONFIGS["windmill"])
        self.detection_threshold = config["detection_threshold"]
        self.structure_radius_m = config["structure_radius_m"]
        self.min_variation = config["min_variation"]
        self.expected_height = config["expected_height"]
        self.default_thresholds = config["thresholds"]
        
        # Initialize threshold attributes for easy access
        self.geometric_threshold = self.default_thresholds["geometric"]
        self.phi0_threshold = self.default_thresholds["phi0"]
        
        self.structure_radius_px = int(self.structure_radius_m / resolution_m)
        
        # Internal state
        self.psi0_kernel = None
        self.elevation_kernel = None
        self.training_stats = {
            'height_prominence': {'mean': None, 'std': None, 'median': None, 'min': None, 'max': None},
            'volume_above_base': {'mean': None, 'std': None, 'median': None, 'min': None, 'max': None},
            'elevation_range': {'mean': None, 'std': None, 'median': None, 'min': None, 'max': None},
            'structure_max_height': {'mean': None, 'std': None, 'median': None, 'min': None, 'max': None},
            'relative_prominence': {'mean': None, 'std': None, 'median': None, 'min': None, 'max': None},
            'sample_count': 0
        }
        
        # Kernel persistence settings
        self.kernel_cache_dir = os.path.join(os.path.dirname(__file__), "cached_kernels")
        if not os.path.exists(self.kernel_cache_dir):
            os.makedirs(self.kernel_cache_dir)
        
        # Kernel status tracking
        self._kernel_was_cached = False
        
        logger.info(f"PhiZero detector initialized for {structure_type} structures at {resolution_m}m resolution")
    
    
    # =========================================================================
    # FEATURE EXTRACTION
    # =========================================================================
    
    def extract_octonionic_features(self, elevation_data: np.ndarray) -> np.ndarray:
        """Extract 8-dimensional octonionic features from elevation data."""
        elevation = np.nan_to_num(elevation_data.astype(np.float64), nan=0.0)
        h, w = elevation.shape
        features = np.zeros((h, w, 8))
        
        # Compute gradients once
        grad_x = np.gradient(elevation, axis=1) / self.resolution_m
        grad_y = np.gradient(elevation, axis=0) / self.resolution_m
        grad_magnitude = np.sqrt(grad_x**2 + grad_y**2)
        
        # Extract features
        features[..., 0] = self._compute_radial_prominence(elevation)
        features[..., 1] = self._compute_circular_symmetry(elevation)
        features[..., 2] = self._compute_radial_gradient_consistency(grad_x, grad_y)
        features[..., 3] = self._compute_ring_edges(elevation)
        features[..., 4] = self._compute_hough_response(grad_magnitude)
        features[..., 5] = self._compute_local_planarity(elevation)
        features[..., 6] = self._compute_isolation_score(elevation)
        features[..., 7] = self._compute_geometric_coherence(elevation, grad_magnitude)
        
        return features
    
    def _compute_radial_prominence(self, elevation: np.ndarray) -> np.ndarray:
        """Compute f0: Radial Height Prominence"""
        radius = self.structure_radius_px
        local_max_filter = maximum_filter(elevation, size=2*radius+1)
        local_mean = uniform_filter(elevation, size=2*radius+1)
        prominence = elevation - local_mean
        relative_prominence = prominence / (local_max_filter - local_mean + 1e-6)
        return np.clip(relative_prominence, 0, 1)
    
    def _compute_circular_symmetry(self, elevation: np.ndarray) -> np.ndarray:
        """Compute f1: Circular Symmetry with selective vegetation discrimination"""
        h, w = elevation.shape
        radius = self.structure_radius_px
        symmetry = np.zeros((h, w))
        angles = np.linspace(0, 2*np.pi, 16, endpoint=False)
        pad_size = radius + 1
        padded = np.pad(elevation, pad_size, mode='reflect')
        
        for y in range(h):
            for x in range(w):
                y_pad, x_pad = y + pad_size, x + pad_size
                values = []
                
                for angle in angles:
                    dy = int(radius * np.sin(angle))
                    dx = int(radius * np.cos(angle))
                    if (0 <= y_pad + dy < padded.shape[0] and 0 <= x_pad + dx < padded.shape[1]):
                        values.append(padded[y_pad + dy, x_pad + dx])
                
                if len(values) >= 8:
                    values = np.array(values)
                    std_dev = np.std(values)
                    mean_val = np.mean(values)
                    relative_std = std_dev / (abs(mean_val) + 1e-6)
                    
                    # Base symmetry score
                    base_symmetry = 1.0 / (1.0 + 2.0 * relative_std)
                    
                    # Selective vegetation discrimination - only for very obvious cases
                    elevation_diffs = np.abs(np.diff(values))
                    max_elevation_diff = np.max(elevation_diffs)
                    mean_elevation_diff = np.mean(elevation_diffs)
                    
                    # Apply vegetation penalties only for extreme cases
                    if max_elevation_diff > 3.0 or mean_elevation_diff > 1.2:  # Increased thresholds
                        base_symmetry *= 0.5  # Reduced penalty (was 0.3)
                    
                    # Surface roughness check - more lenient
                    if len(values) >= 6:
                        roughness = np.mean(np.abs(np.diff(values, n=2)))
                        if roughness > 1.5:  # Increased threshold (was 1.0)
                            base_symmetry *= 0.4  # Reduced penalty (was 0.2)
                    
                    symmetry[y, x] = base_symmetry
                else:
                    symmetry[y, x] = 0.0
        
        return symmetry
    
    def _compute_radial_gradient_consistency(self, grad_x: np.ndarray, grad_y: np.ndarray) -> np.ndarray:
        """Compute f2: Radial Gradient Consistency"""
        h, w = grad_x.shape
        radius = self.structure_radius_px
        consistency = np.zeros((h, w))
        
        for cy in range(radius, h-radius):
            for cx in range(radius, w-radius):
                local_gx = grad_x[cy-radius:cy+radius+1, cx-radius:cx+radius+1]
                local_gy = grad_y[cy-radius:cy+radius+1, cx-radius:cx+radius+1]
                
                local_y, local_x = np.ogrid[:2*radius+1, :2*radius+1]
                dy = local_y - radius
                dx = local_x - radius
                dist = np.sqrt(dy**2 + dx**2) + 1e-6
                
                expected_gx = dx / dist
                expected_gy = dy / dist
                dot_product = local_gx * expected_gx + local_gy * expected_gy
                weight = np.exp(-dist / radius) * np.sqrt(local_gx**2 + local_gy**2)
                mask = dist <= radius
                
                if np.sum(mask) > 0:
                    consistency[cy, cx] = np.sum(dot_product[mask] * weight[mask]) / (np.sum(weight[mask]) + 1e-6)
        
        return np.clip(consistency, -1, 1)
    
    def _compute_ring_edges(self, elevation: np.ndarray) -> np.ndarray:
        """Compute f3: Ring Edge Sharpness using DoG"""
        radius = self.structure_radius_px
        sigma1 = radius * 0.8 * self.resolution_m
        sigma2 = radius * 1.2 * self.resolution_m
        dog = gaussian_filter(elevation, sigma1) - gaussian_filter(elevation, sigma2)
        edge_strength = np.abs(dog)
        
        if np.percentile(edge_strength, 95) > 0:
            edge_strength = edge_strength / (np.percentile(edge_strength, 95) + 1e-6)
        
        return np.clip(edge_strength, 0, 1)
    
    def _compute_hough_response(self, gradient_magnitude: np.ndarray) -> np.ndarray:
        """Compute f4: Hough Circle Transform Response"""
        h, w = gradient_magnitude.shape
        hough_response = np.zeros((h, w))
        target_radius = self.structure_radius_px
        
        try:
            from skimage.transform import hough_circle
            edges = gradient_magnitude > np.percentile(gradient_magnitude, 75)
            edges = edges.astype(np.uint8) * 255
            radii = np.arange(max(5, target_radius-2), target_radius+3, 1)
            hough_res = hough_circle(edges, radii)
            
            for radius_idx, radius in enumerate(radii):
                accumulator = hough_res[radius_idx]
                weight = np.exp(-0.5 * ((radius - target_radius) / 2)**2)
                hough_response += accumulator * weight
            
            if np.max(hough_response) > 0:
                hough_response = hough_response / np.max(hough_response)
                
        except Exception as e:
            logger.debug(f"Hough transform failed: {e}, using zero response")
        
        return hough_response
    
    def _compute_local_planarity(self, elevation: np.ndarray) -> np.ndarray:
        """Compute f5: Local Planarity via least squares fitting"""
        h, w = elevation.shape
        radius = self.structure_radius_px
        planarity = np.zeros((h, w))
        
        for y in range(radius, h-radius):
            for x in range(radius, w-radius):
                local_patch = elevation[y-radius:y+radius+1, x-radius:x+radius+1]
                yy, xx = np.mgrid[:local_patch.shape[0], :local_patch.shape[1]]
                center_y, center_x = radius, radius
                mask = (yy - center_y)**2 + (xx - center_x)**2 <= radius**2
                
                if np.sum(mask) > 3:
                    points = np.column_stack([xx[mask], yy[mask], np.ones(np.sum(mask))])
                    z_values = local_patch[mask]
                    try:
                        coeffs, _, _, _ = np.linalg.lstsq(points, z_values, rcond=None)
                        z_fit = coeffs[0] * xx + coeffs[1] * yy + coeffs[2]
                        residuals = np.abs(local_patch - z_fit)[mask]
                        planarity[y, x] = 1.0 / (1.0 + np.std(residuals))
                    except:
                        planarity[y, x] = 0.0
        
        return planarity
    
    def _compute_isolation_score(self, elevation: np.ndarray) -> np.ndarray:
        """Compute f6: Isolation Score"""
        radius = self.structure_radius_px
        local_max = maximum_filter(elevation, size=2*radius+1)
        extended_max = maximum_filter(elevation, size=4*radius+1)
        isolation = (local_max == extended_max).astype(float)
        prominence = local_max - uniform_filter(elevation, size=2*radius+1)
        prominence_std = np.std(prominence) + 1e-6
        isolation = isolation * (1 - np.exp(-prominence / prominence_std))
        return isolation
    
    def _compute_geometric_coherence(self, elevation: np.ndarray, gradient_magnitude: np.ndarray) -> np.ndarray:
        """Compute f7: Geometric Coherence"""
        radius = self.structure_radius_px
        edges = gradient_magnitude > np.percentile(gradient_magnitude, 80)
        dist_from_edge = distance_transform_edt(~edges)
        
        h, w = elevation.shape
        coherence = np.zeros_like(elevation)
        pad = radius
        
        if h > 2*pad and w > 2*pad:
            center_y, center_x = h//2, w//2
            y_start, y_end = max(pad, center_y-10), min(h-pad, center_y+11)
            x_start, x_end = max(pad, center_x-10), min(w-pad, center_x+11)
            
            for y in range(y_start, y_end):
                for x in range(x_start, x_end):
                    local_dist = dist_from_edge[y-pad:y+pad+1, x-pad:x+pad+1]
                    center_dist = local_dist[pad, pad]
                    mean_edge_dist = (np.mean(local_dist[0, :]) + np.mean(local_dist[-1, :]) + 
                                    np.mean(local_dist[:, 0]) + np.mean(local_dist[:, -1])) / 4
                    if mean_edge_dist > 0:
                        coherence[y, x] = center_dist / (mean_edge_dist + 1)
        
        coherence = gaussian_filter(coherence, sigma=2)
        if np.max(coherence) > 0:
            coherence = coherence / np.max(coherence)
        
        return coherence
    
    
    # =========================================================================
    # VEGETATION DISCRIMINATION UTILITIES
    # =========================================================================
    
    def _compute_elevation_irregularity(self, elevation: np.ndarray) -> float:
        """Compute elevation irregularity score to distinguish vegetation from structures."""
        # Local variance and gradient variation
        local_var = np.var(elevation)
        grad_x = np.gradient(elevation, axis=1)
        grad_y = np.gradient(elevation, axis=0)
        grad_magnitude = np.sqrt(grad_x**2 + grad_y**2)
        grad_var = np.var(grad_magnitude)
        
        # Surface roughness using Laplacian
        laplacian = laplace(elevation)
        surface_roughness = np.std(laplacian)
        
        # Combine metrics (normalize empirically)
        irregularity = (local_var + grad_var + surface_roughness) / 3.0
        return min(1.0, irregularity / 10.0)  # Normalize to [0,1]
    
    def _validate_structure_elevation_profile(self, elevation_relative: np.ndarray) -> bool:
        """Validate that elevation profile matches expected structure characteristics - lenient for structures."""
        h, w = elevation_relative.shape
        center_y, center_x = h // 2, w // 2
        radius = min(h, w) // 4
        
        # Check for single dominant peak in central area
        center_region = elevation_relative[
            max(0, center_y-radius):min(h, center_y+radius+1),
            max(0, center_x-radius):min(w, center_x+radius+1)
        ]
        
        # Structure validation checks - more lenient thresholds
        center_elevation = elevation_relative[center_y, center_x]
        center_percentile = np.percentile(elevation_relative, 85)  # Lowered from 90
        
        if center_elevation < center_percentile * 0.5:  # Lowered from 0.7
            return False
        
        # More lenient roughness check for structures
        if radius > 2:
            center_roughness = np.std(center_region)
            if center_roughness > 0.5:  # Increased from 0.3 - allow more roughness
                return False
        
        # Check for generally decreasing trend from center - more lenient
        distances = []
        elevations = []
        
        for y in range(h):
            for x in range(w):
                dist = np.sqrt((y - center_y)**2 + (x - center_x)**2)
                if dist > 0:
                    distances.append(dist)
                    elevations.append(elevation_relative[y, x])
        
        if len(distances) > 10:
            # Bin by distance and check trend - more forgiving
            max_dist = max(distances)
            n_bins = min(5, int(max_dist))
            
            if n_bins >= 3:
                bin_edges = np.linspace(0, max_dist, n_bins + 1)
                bin_means = []
                
                for i in range(n_bins):
                    mask = (np.array(distances) >= bin_edges[i]) & (np.array(distances) < bin_edges[i+1])
                    if np.any(mask):
                        bin_means.append(np.mean(np.array(elevations)[mask]))
                
                # Check for generally decreasing trend (structures) - much more lenient
                if len(bin_means) >= 3:
                    decreasing_pairs = sum(1 for i in range(len(bin_means)-1) if bin_means[i] >= bin_means[i+1])
                    if decreasing_pairs < len(bin_means) * 0.3:  # Only 30% need to be decreasing (was 50%)
                        return False
        
        return True
    
    
    # =========================================================================
    # TRAINING AND ADAPTIVE THRESHOLDS
    # =========================================================================
    
    def _analyze_patch_statistics(self, elevation: np.ndarray) -> Dict:
        """Analyze statistical properties of a training patch."""
        h, w = elevation.shape
        center_y, center_x = h // 2, w // 2
        radius = self.structure_radius_px
        
        # Create masks for structure and surrounding regions
        structure_mask = create_circular_mask(h, w, center_y, center_x, radius)
        surround_inner = radius + 2
        surround_outer = min(h, w) // 2 - 2
        surround_mask = (create_circular_mask(h, w, center_y, center_x, surround_outer) & 
                        ~create_circular_mask(h, w, center_y, center_x, surround_inner))
        
        if not (np.any(structure_mask) and np.any(surround_mask)):
            return None
        
        # Height statistics
        structure_heights = elevation[structure_mask]
        surround_heights = elevation[surround_mask]
        
        structure_max = np.max(structure_heights)
        structure_mean = np.mean(structure_heights)
        surround_mean = np.mean(surround_heights)
        surround_std = np.std(surround_heights)
        
        # Calculate base elevation using edge areas
        border_width = max(2, radius // 4)
        edge_mask = np.zeros_like(elevation, dtype=bool)
        edge_mask[:border_width, :] = True
        edge_mask[-border_width:, :] = True
        edge_mask[:, :border_width] = True
        edge_mask[:, -border_width:] = True
        
        base_elevation = np.median(elevation[edge_mask]) if np.any(edge_mask) else np.median(elevation)
        
        # Calculate volume above base
        volume_above_base = np.sum(np.maximum(0, structure_heights - base_elevation)) * (self.resolution_m ** 2)
        
        # Measurements
        height_prominence = structure_max - surround_mean
        relative_prominence = height_prominence / (surround_std + 0.1)
        elevation_range = np.max(elevation) - np.min(elevation)
        
        return {
            'height_prominence': height_prominence,
            'volume_above_base': volume_above_base,
            'elevation_range': elevation_range,
            'structure_max_height': structure_max,
            'relative_prominence': relative_prominence,
            'base_elevation': base_elevation,
            'structure_mean': structure_mean,
            'surround_mean': surround_mean,
            'surround_std': surround_std
        }
    
    def _store_training_statistics(self, height_prominences, volumes, elevation_ranges, max_heights, relative_prominences):
        """Store collected training statistics for adaptive threshold setting."""
        self.training_stats = {
            'height_prominence': compute_stats(height_prominences),
            'volume_above_base': compute_stats(volumes),
            'elevation_range': compute_stats(elevation_ranges),
            'structure_max_height': compute_stats(max_heights),
            'relative_prominence': compute_stats(relative_prominences),
            'sample_count': len(height_prominences)
        }
        logger.info(f"📊 Training statistics collected from {len(height_prominences)} valid patches")
    
    def get_adaptive_thresholds(self) -> Dict:
        """Get adaptive thresholds based on training statistics."""
        if self.training_stats['sample_count'] == 0:
            # Return structure-specific defaults
            return {
                'min_height_prominence': self.default_thresholds['height_prominence'],
                'min_volume': self.default_thresholds['volume'],
                'min_elevation_range': self.default_thresholds['elevation_range'],
                'geometric_threshold': self.default_thresholds['geometric'],
                'min_phi0_threshold': self.default_thresholds['phi0'],
                'training_derived': False
            }
        
        # Use training-derived thresholds
        height_stats = self.training_stats['height_prominence']
        volume_stats = self.training_stats['volume_above_base']
        range_stats = self.training_stats['elevation_range']
        
        # Calculate adaptive thresholds using percentile approach
        min_height = max(0.5, height_stats['min'] + 0.25 * (height_stats['max'] - height_stats['min']))
        min_volume = max(10.0, volume_stats['min'] + 0.25 * (volume_stats['max'] - volume_stats['min']))
        min_range = max(0.3, range_stats['min'] + 0.25 * (range_stats['max'] - range_stats['min']))
        
        # Calculate consistency factor
        height_cv = height_stats['std'] / height_stats['mean'] if height_stats['mean'] > 0 else 1.0
        volume_cv = volume_stats['std'] / volume_stats['mean'] if volume_stats['mean'] > 0 else 1.0
        consistency_factor = 1.0 - min(0.3, (height_cv + volume_cv) / 2.0)
        
        # Adaptive geometric and phi0 thresholds
        adaptive_geometric = 0.40 - (0.05 * (1.0 - consistency_factor))
        adaptive_phi0 = self.default_thresholds['phi0'] + (0.02 * consistency_factor)
        
        return {
            'min_height_prominence': min_height,
            'min_volume': min_volume,
            'min_elevation_range': min_range,
            'geometric_threshold': adaptive_geometric,
            'min_phi0_threshold': adaptive_phi0,
            'training_derived': True,
            'training_quality': {
                'height_cv': height_cv,
                'volume_cv': volume_cv,
                'consistency_factor': consistency_factor,
                'sample_count': self.training_stats['sample_count']
            }
        }
    
    
    # =========================================================================
    # KERNEL LEARNING
    # =========================================================================
    
    def learn_pattern_kernel(self, training_patches: List[ElevationPatch], 
                           use_apex_center: bool = True, force_retrain: bool = False) -> np.ndarray:
        """Learn the Phi-Zero kernel from training patches."""
        logger.info(f"Learning φ⁰ kernel from {len(training_patches)} training patches")
        
        if not training_patches:
            logger.warning("No training patches provided, using default kernel")
            return self._create_default_kernel()
        
        # Try to load cached kernel first (unless forced to retrain)
        if not force_retrain:
            cached_kernel = self.load_kernel(training_patches, force_retrain=False)
            if cached_kernel is not None:
                return cached_kernel
        
        # Clear cached flag when training new kernel
        self._kernel_was_cached = False
        
        all_elevations = []
        all_features = []
        
        # Collect training statistics
        training_stats_lists = {
            'height_prominences': [],
            'volumes': [],
            'elevation_ranges': [],
            'max_heights': [],
            'relative_prominences': []
        }
        
        for i, patch in enumerate(training_patches):
            if hasattr(patch, 'elevation_data') and patch.elevation_data is not None:
                elevation = patch.elevation_data
                features = self.extract_octonionic_features(elevation)
                
                # Collect statistics
                patch_stats = self._analyze_patch_statistics(elevation)
                if patch_stats:
                    training_stats_lists['height_prominences'].append(patch_stats['height_prominence'])
                    training_stats_lists['volumes'].append(patch_stats['volume_above_base'])
                    training_stats_lists['elevation_ranges'].append(patch_stats['elevation_range'])
                    training_stats_lists['max_heights'].append(patch_stats['structure_max_height'])
                    training_stats_lists['relative_prominences'].append(patch_stats['relative_prominence'])
                
                h, w = elevation.shape
                if h >= self.kernel_size and w >= self.kernel_size:
                    # Find kernel center
                    if use_apex_center:
                        center_y, center_x = self._find_optimal_kernel_center(elevation)
                    else:
                        center_y, center_x = h // 2, w // 2
                    
                    # Extract kernel
                    half_kernel = self.kernel_size // 2
                    if (center_y >= half_kernel and center_y < h - half_kernel and
                        center_x >= half_kernel and center_x < w - half_kernel):
                        
                        start_y = center_y - half_kernel
                        start_x = center_x - half_kernel
                        
                        elevation_kernel = elevation[start_y:start_y+self.kernel_size, start_x:start_x+self.kernel_size]
                        feature_kernel = features[start_y:start_y+self.kernel_size, start_x:start_x+self.kernel_size, :]
                        
                        if np.std(elevation_kernel) > 0.01:
                            all_elevations.append(elevation_kernel)
                            all_features.append(feature_kernel)
        
        # Store training statistics
        if training_stats_lists['height_prominences']:
            self._store_training_statistics(
                training_stats_lists['height_prominences'],
                training_stats_lists['volumes'],
                training_stats_lists['elevation_ranges'],
                training_stats_lists['max_heights'],
                training_stats_lists['relative_prominences']
            )
        
        if not all_features:
            logger.warning("No valid training features, using default kernel")
            return self._create_default_kernel()
        
        # Build kernels
        self.elevation_kernel = np.mean(all_elevations, axis=0)
        feature_kernel = np.mean(all_features, axis=0)
        feature_kernel_normalized = self._normalize_kernel(feature_kernel)
        self.psi0_kernel = feature_kernel_normalized
        
        logger.info(f"✅ φ⁰ kernel constructed with shape {feature_kernel_normalized.shape}")
        
        # Save the newly trained kernel for future use
        try:
            self.save_kernel(feature_kernel_normalized, training_patches)
        except Exception as e:
            logger.warning(f"Failed to save kernel: {e}")
        
        return feature_kernel_normalized

    def _find_optimal_kernel_center(self, elevation: np.ndarray) -> Tuple[int, int]:
        """Find the optimal center point for kernel extraction based on elevation peak."""
        try:
            h, w = elevation.shape
            
            # Find the maximum elevation point as a starting point
            max_idx = np.unravel_index(np.argmax(elevation), elevation.shape)
            max_y, max_x = max_idx
            
            # Ensure the center is within valid bounds for kernel extraction
            half_kernel = self.kernel_size // 2
            
            # Constrain to valid region
            center_y = np.clip(max_y, half_kernel, h - half_kernel - 1)
            center_x = np.clip(max_x, half_kernel, w - half_kernel - 1)
            
            # Optionally refine the center by looking for local maxima in a small window
            search_radius = min(3, half_kernel // 2)
            y_start = max(half_kernel, center_y - search_radius)
            y_end = min(h - half_kernel, center_y + search_radius + 1)
            x_start = max(half_kernel, center_x - search_radius)
            x_end = min(w - half_kernel, center_x + search_radius + 1)
            
            # Find local maximum in search window
            search_region = elevation[y_start:y_end, x_start:x_end]
            if search_region.size > 0:
                local_max_idx = np.unravel_index(np.argmax(search_region), search_region.shape)
                refined_y = y_start + local_max_idx[0]
                refined_x = x_start + local_max_idx[1]
                
                # Use refined center if it's valid
                if (half_kernel <= refined_y < h - half_kernel and 
                    half_kernel <= refined_x < w - half_kernel):
                    center_y, center_x = refined_y, refined_x
            
            return center_y, center_x
            
        except Exception as e:
            logger.warning(f"Failed to find optimal kernel center: {e}, using image center")
            # Fallback to image center
            h, w = elevation.shape
            half_kernel = self.kernel_size // 2
            center_y = max(half_kernel, min(h - half_kernel - 1, h // 2))
            center_x = max(half_kernel, min(w - half_kernel - 1, w // 2))
            return center_y, center_x

    def _create_default_kernel(self) -> np.ndarray:
        """Create a default kernel when no training data is available."""
        logger.warning("Creating default φ⁰ kernel")
        
        # Create a simple radial pattern as default
        kernel = np.zeros((self.kernel_size, self.kernel_size, self.n_features))
        center = self.kernel_size // 2
        
        for i in range(self.kernel_size):
            for j in range(self.kernel_size):
                distance = np.sqrt((i - center)**2 + (j - center)**2)
                normalized_distance = distance / (self.kernel_size / 2)
                
                # Create a simple radial pattern for each feature
                for f in range(self.n_features):
                    if f == 0:  # Radial prominence
                        kernel[i, j, f] = max(0, 1.0 - normalized_distance)
                    elif f == 1:  # Circular symmetry
                        kernel[i, j, f] = np.exp(-normalized_distance**2)
                    else:  # Other features
                        kernel[i, j, f] = max(0, 0.5 - normalized_distance * 0.3)
        
        return self._normalize_kernel(kernel)

    def _normalize_kernel(self, kernel: np.ndarray) -> np.ndarray:
        """Normalize kernel for consistent pattern matching."""
        normalized = np.zeros_like(kernel)
        
        for f in range(kernel.shape[2]):
            feature_slice = kernel[:, :, f]
            if np.std(feature_slice) > 1e-6:
                # Z-score normalization
                normalized[:, :, f] = (feature_slice - np.mean(feature_slice)) / np.std(feature_slice)
            else:
                normalized[:, :, f] = feature_slice
        
        return normalized

    # =========================================================================
    # KERNEL PERSISTENCE
    # =========================================================================
    
    def _generate_kernel_hash(self, training_patches: List[ElevationPatch]) -> str:
        """Generate a unique hash for kernel based on training patches"""
        try:
            # Create hash based on structure type, training data coordinates, and patch shapes
            hash_content = f"{self.structure_type}_{self.resolution_m}_{self.kernel_size}"
            
            for patch in training_patches:
                if hasattr(patch, 'lat') and hasattr(patch, 'lon'):
                    # Round coordinates to ensure consistency
                    lat_rounded = round(patch.lat, 6)
                    lon_rounded = round(patch.lon, 6)
                    hash_content += f"_{lat_rounded}_{lon_rounded}"
                
                if hasattr(patch, 'elevation_data') and patch.elevation_data is not None:
                    # Add shape info to hash
                    hash_content += f"_{patch.elevation_data.shape[0]}_{patch.elevation_data.shape[1]}"
            
            return hashlib.md5(hash_content.encode()).hexdigest()[:16]
        except Exception as e:
            logger.warning(f"Could not generate kernel hash: {e}")
            return f"default_{self.structure_type}"

    def save_kernel(self, kernel_data: np.ndarray, training_patches: List[ElevationPatch]) -> str:
        """Save trained kernel to disk for future reuse"""
        try:
            kernel_hash = self._generate_kernel_hash(training_patches)
            kernel_filename = f"kernel_{self.structure_type}_{kernel_hash}.pkl"
            kernel_path = os.path.join(self.kernel_cache_dir, kernel_filename)
            
            kernel_info = {
                'psi0_kernel': kernel_data,
                'elevation_kernel': self.elevation_kernel,
                'training_stats': self.training_stats,
                'structure_type': self.structure_type,
                'resolution_m': self.resolution_m,
                'kernel_size': self.kernel_size,
                'created_timestamp': datetime.now().isoformat(),
                'training_patch_count': len(training_patches),
                'kernel_hash': kernel_hash,
                'default_thresholds': self.default_thresholds
            }
            
            with open(kernel_path, 'wb') as f:
                pickle.dump(kernel_info, f)
            
            logger.info(f"💾 Kernel saved to: {kernel_path}")
            logger.info(f"   Structure: {self.structure_type}, Hash: {kernel_hash}")
            logger.info(f"   Training patches: {len(training_patches)}")
            
            return kernel_path
            
        except Exception as e:
            logger.error(f"Failed to save kernel: {e}")
            return None

    def load_kernel(self, training_patches: List[ElevationPatch] = None, force_retrain: bool = False) -> Optional[np.ndarray]:
        """Load existing kernel from disk if available"""
        if force_retrain:
            logger.info("🔄 Force retrain requested - skipping kernel cache")
            return None
            
        try:
            if training_patches:
                kernel_hash = self._generate_kernel_hash(training_patches)
                kernel_filename = f"kernel_{self.structure_type}_{kernel_hash}.pkl"
            else:
                # Look for any kernel for this structure type
                pattern = f"kernel_{self.structure_type}_*.pkl"
                kernel_files = [f for f in os.listdir(self.kernel_cache_dir) if f.startswith(f"kernel_{self.structure_type}_")]
                if not kernel_files:
                    return None
                # Use the most recent one
                kernel_files.sort(key=lambda x: os.path.getmtime(os.path.join(self.kernel_cache_dir, x)), reverse=True)
                kernel_filename = kernel_files[0]
            
            kernel_path = os.path.join(self.kernel_cache_dir, kernel_filename)
            
            if not os.path.exists(kernel_path):
                return None
            
            with open(kernel_path, 'rb') as f:
                kernel_info = pickle.load(f)
            
            # Validate kernel compatibility
            if (kernel_info.get('structure_type') != self.structure_type or
                kernel_info.get('resolution_m') != self.resolution_m or
                kernel_info.get('kernel_size') != self.kernel_size):
                logger.warning(f"Kernel parameters mismatch - ignoring cached kernel")
                return None
            
            # Load kernel data
            self.psi0_kernel = kernel_info['psi0_kernel']
            self.elevation_kernel = kernel_info.get('elevation_kernel')
            self.training_stats = kernel_info.get('training_stats', self.training_stats)
            
            # Track that kernel was loaded from cache
            self._kernel_was_cached = True
            
            created_time = kernel_info.get('created_timestamp', 'unknown')
            patch_count = kernel_info.get('training_patch_count', 'unknown')
            kernel_hash = kernel_info.get('kernel_hash', 'unknown')
            
            logger.info(f"📂 Loaded cached kernel: {kernel_filename}")
            logger.info(f"   Created: {created_time}")
            logger.info(f"   Training patches: {patch_count}")
            logger.info(f"   Hash: {kernel_hash}")
            logger.info(f"   Shape: {self.psi0_kernel.shape}")
            
            return self.psi0_kernel
            
        except Exception as e:
            logger.warning(f"Failed to load cached kernel: {e}")
            return None

    def get_cached_kernel_info(self) -> List[Dict]:
        """Get information about available cached kernels"""
        try:
            kernel_files = [f for f in os.listdir(self.kernel_cache_dir) if f.startswith(f"kernel_{self.structure_type}_")]
            kernels_info = []
            
            for filename in kernel_files:
                try:
                    kernel_path = os.path.join(self.kernel_cache_dir, filename)
                    with open(kernel_path, 'rb') as f:
                        kernel_info = pickle.load(f)
                    
                    info = {
                        'filename': filename,
                        'path': kernel_path,
                        'created': kernel_info.get('created_timestamp', 'unknown'),
                        'structure_type': kernel_info.get('structure_type', 'unknown'),
                        'training_patches': kernel_info.get('training_patch_count', 'unknown'),
                        'hash': kernel_info.get('kernel_hash', 'unknown'),
                        'file_size': os.path.getsize(kernel_path),
                        'modified': datetime.fromtimestamp(os.path.getmtime(kernel_path)).isoformat()
                    }
                    kernels_info.append(info)
                except Exception as e:
                    logger.warning(f"Could not read kernel file {filename}: {e}")
            
            return sorted(kernels_info, key=lambda x: x['modified'], reverse=True)
            
        except Exception as e:
            logger.error(f"Failed to get cached kernel info: {e}")
            return []
    
    # =========================================================================
    # PATTERN DETECTION
    # =========================================================================
    
    def detect_patterns(self, feature_data: np.ndarray, elevation_data: np.ndarray = None, 
                       enable_center_bias: bool = True) -> np.ndarray:
        """Apply Phi-Zero pattern detection to feature data."""
        if self.psi0_kernel is None:
            raise ValueError("No φ⁰ kernel available. Train kernel first using learn_pattern_kernel()")
        
        h, w = feature_data.shape[:2]
        coherence_map = np.zeros((h, w))
        half_kernel = self.kernel_size // 2
        
        # Apply pattern matching at each location
        for y in range(half_kernel, h - half_kernel):
            for x in range(half_kernel, w - half_kernel):
                local_patch = feature_data[y-half_kernel:y+half_kernel+1, x-half_kernel:x+half_kernel+1, :]
                
                if local_patch.shape != (self.kernel_size, self.kernel_size, self.n_features):
                    continue
                
                # Extract corresponding elevation patch if available
                elevation_patch = None
                if elevation_data is not None:
                    elevation_patch = elevation_data[y-half_kernel:y+half_kernel+1, x-half_kernel:x+half_kernel+1]
                
                # Calculate coherence score
                coherence = self._calculate_coherence_score(local_patch, elevation_patch)
                coherence_map[y, x] = coherence
        
        # Apply center bias if requested
        if enable_center_bias:
            coherence_map = self._apply_center_bias(coherence_map)
        
        return coherence_map

    def _calculate_coherence_score(self, local_patch: np.ndarray, elevation_patch: np.ndarray = None) -> float:
        """Calculate coherence score combining elevation histogram matching and geometric validation."""
        try:
            elevation_score = 0.0
            geometric_score = 0.0
            
            # Elevation histogram matching
            if elevation_patch is not None and self.elevation_kernel is not None:
                elevation_score = self._compute_elevation_histogram_score(elevation_patch, self.elevation_kernel)
            
            # Geometric feature validation
            if local_patch is not None and self.psi0_kernel is not None:
                geometric_score = self._compute_geometric_correlation_score(local_patch, self.psi0_kernel)
            
            # Weighted combination
            if elevation_score > 0 and geometric_score > 0:
                combined_score = 0.80 * elevation_score + 0.20 * geometric_score
            elif elevation_score > 0:
                combined_score = elevation_score * 0.85
            elif geometric_score > 0:
                combined_score = geometric_score * 0.10
            else:
                combined_score = 0.0
            
            return max(0.0, min(1.0, combined_score))
            
        except Exception as e:
            logger.warning(f"Coherence calculation error: {e}")
            return 0.0

    def _compute_elevation_histogram_score(self, local_elevation: np.ndarray, kernel_elevation: np.ndarray) -> float:
        """Compute elevation histogram matching score with selective vegetation discrimination"""
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
        
        # Create and compare histograms first
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
        
        base_similarity = np.dot(local_hist, kernel_hist) / (local_norm * kernel_norm)
        base_similarity = max(0.0, min(1.0, base_similarity))
        
        # Apply vegetation discrimination only as a penalty, not a hard cutoff
        if base_similarity > 0.1:  # Only check vegetation for patterns that already match somewhat
            local_irregularity = self._compute_elevation_irregularity(local_elevation)
            
            # Much more lenient vegetation detection - only penalize obvious vegetation
            if local_irregularity > 0.8:  # Very high irregularity threshold
                vegetation_penalty = min(0.7, local_irregularity)  # Max 70% penalty
                base_similarity *= (1.0 - vegetation_penalty)
            
            # Additional check for very obvious non-structural patterns
            if not self._validate_structure_elevation_profile(local_relative):
                # Only apply penalty if irregularity is also high
                if local_irregularity > 0.6:
                    base_similarity *= 0.5  # 50% penalty instead of complete rejection
        
        return base_similarity

    def _compute_geometric_correlation_score(self, local_patch: np.ndarray, kernel: np.ndarray) -> float:
        """Compute geometric feature correlation score"""
        if local_patch.shape != kernel.shape or local_patch.ndim != 3:
            return 0.0
        
        # Use subset of geometric features
        if local_patch.shape[2] > 2:
            local_features = local_patch[:, :, 1:3].flatten()
            kernel_features = kernel[:, :, 1:3].flatten()
            
            if len(local_features) > 0 and len(kernel_features) > 0:
                correlation_matrix = np.corrcoef(local_features, kernel_features)
                if correlation_matrix.shape == (2, 2) and not np.isnan(correlation_matrix[0, 1]):
                    return max(0.0, correlation_matrix[0, 1])
        
        return 0.0

    def _apply_center_bias(self, coherence_map: np.ndarray) -> np.ndarray:
        """Apply Gaussian center bias to coherence map"""
        h, w = coherence_map.shape
        center_y, center_x = h // 2, w // 2
        y, x = np.ogrid[:h, :w]
        distance_squared = ((y - center_y) / h)**2 + ((x - center_x) / w)**2
        center_weights = np.exp(-distance_squared / (2 * 0.3**2))
        return 0.5 * coherence_map + 0.5 * (coherence_map * center_weights)

    # =========================================================================
    # MAIN DETECTION INTERFACE
    # =========================================================================

    def detect_with_geometric_validation(self, feature_data: np.ndarray, 
                                       elevation_data: np.ndarray = None,
                                       enable_center_bias: bool = True) -> 'DetectionResult':
        """Detect patterns with comprehensive geometric validation and adaptive thresholds."""
        try:
            # Apply φ⁰ pattern detection
            coherence_map = self.detect_patterns(feature_data, elevation_data, enable_center_bias)
            
            # Extract key metrics
            max_score = float(np.max(coherence_map))
            h, w = coherence_map.shape
            center_y, center_x = h // 2, w // 2
            center_score = float(coherence_map[center_y, center_x])
            
            # Get adaptive thresholds
            adaptive_thresholds = self.get_adaptive_thresholds()
            phi0_threshold = adaptive_thresholds['min_phi0_threshold']
            geometric_threshold = adaptive_thresholds['geometric_threshold']
            
            # Geometric validation
            geometric_score = self._compute_geometric_validation_score(feature_data, elevation_data)
            
            # Size discrimination if elevation data available
            size_passed = True
            size_metrics = {}
            if elevation_data is not None:
                size_metrics = self._analyze_patch_statistics(elevation_data)
                if size_metrics:
                    size_passed = (
                        size_metrics['height_prominence'] >= adaptive_thresholds['min_height_prominence'] and
                        size_metrics['volume_above_base'] >= adaptive_thresholds['min_volume'] and
                        size_metrics['elevation_range'] >= adaptive_thresholds['min_elevation_range']
                    )
            
            # Combined detection decision
            phi0_passed = max_score >= phi0_threshold
            geometric_passed = geometric_score >= geometric_threshold
            
            # Detection logic
            strong_phi0 = max_score >= (phi0_threshold * 1.5)
            good_phi0 = max_score >= phi0_threshold
            
            if strong_phi0:
                detected = True
                reason = f"Strong φ⁰={max_score:.3f} (≥{phi0_threshold*1.5:.3f})"
            elif good_phi0:
                if elevation_data is not None:
                    detected = geometric_passed and size_passed
                    reason = f"φ⁰={max_score:.3f} + geo={geometric_score:.3f} + size"
                else:
                    detected = geometric_passed
                    reason = f"φ⁰={max_score:.3f} + geo={geometric_score:.3f}"
            else:
                detected = False
                reason = f"φ⁰={max_score:.3f} < {phi0_threshold:.3f}"
            
            # Calculate confidence
            confidence = self._calculate_combined_confidence(
                max_score, center_score, geometric_score, size_metrics, adaptive_thresholds
            )
            
            # Build detailed results
            details = {
                'coherence_map': coherence_map,
                'max_phi0_score': max_score,
                'center_phi0_score': center_score,
                'geometric_score': geometric_score,
                'adaptive_thresholds': adaptive_thresholds,
                'size_metrics': size_metrics,
                'size_passed': size_passed,
                'phi0_passed': phi0_passed,
                'geometric_passed': geometric_passed,
                'training_derived': adaptive_thresholds.get('training_derived', False)
            }
            
            return DetectionResult(
                detected=detected,
                confidence=confidence,
                reason=reason,
                max_score=max_score,
                center_score=center_score,
                geometric_score=geometric_score,
                details=details
            )
            
        except Exception as e:
            logger.error(f"Detection failed: {e}")
            return DetectionResult(
                detected=False,
                confidence=0.0,
                reason=f"Error: {str(e)}",
                max_score=0.0,
                center_score=0.0,
                geometric_score=0.0,
                details={}
            )

    def _compute_geometric_validation_score(self, feature_data: np.ndarray, 
                                          elevation_data: np.ndarray = None) -> float:
        """Enhanced geometric validation that analyzes structural patterns."""
        try:
            h, w = feature_data.shape[:2]
            center_y, center_x = h // 2, w // 2
            radius = self.structure_radius_px
            
            validation_scores = []
            
            # Circular symmetry analysis
            if feature_data.shape[2] > 1:
                symmetry_score = self._analyze_circular_symmetry_pattern(
                    feature_data[:, :, 1], center_y, center_x, radius
                )
                validation_scores.append(symmetry_score)
            
            # Radial gradient coherence
            if feature_data.shape[2] > 2:
                radial_score = self._analyze_radial_gradient_pattern(
                    feature_data[:, :, 2], center_y, center_x, radius
                )
                validation_scores.append(radial_score)
            
            # Elevation-based structural validation
            if elevation_data is not None:
                elevation_score = self._analyze_elevation_structure(
                    elevation_data, center_y, center_x, radius
                )
                validation_scores.append(elevation_score)
            
            # Peak centrality and isolation
            if feature_data.shape[2] > 6:
                isolation_score = self._analyze_peak_isolation(
                    feature_data[:, :, 6], center_y, center_x, radius
                )
                validation_scores.append(isolation_score)
            
            # Multi-scale feature coherence
            coherence_score = self._analyze_feature_coherence(
                feature_data, center_y, center_x, radius
            )
            validation_scores.append(coherence_score)
            
            # Weighted combination
            if validation_scores:
                return np.mean(validation_scores)
            else:
                return 0.0
                
        except Exception as e:
            logger.warning(f"Geometric validation failed: {e}")
            return 0.0

    def _analyze_circular_symmetry_pattern(self, symmetry_feature: np.ndarray, 
                                         center_y: int, center_x: int, radius: int) -> float:
        """Analyze how well the symmetry feature forms a circular pattern"""
        h, w = symmetry_feature.shape
        if center_y < radius or center_y >= h-radius or center_x < radius or center_x >= w-radius:
            return 0.0
        
        # Sample symmetry values in concentric rings
        ring_scores = []
        for r in range(max(2, radius//3), radius+1, max(1, radius//4)):
            ring_values = []
            angles = np.linspace(0, 2*np.pi, max(8, int(2*np.pi*r/2)), endpoint=False)
            
            for angle in angles:
                y = int(center_y + r * np.sin(angle))
                x = int(center_x + r * np.cos(angle))
                if 0 <= y < h and 0 <= x < w:
                    ring_values.append(symmetry_feature[y, x])
            
            if len(ring_values) >= 4:
                ring_consistency = 1.0 / (1.0 + np.std(ring_values))
                ring_scores.append(ring_consistency)
        
        return np.mean(ring_scores) if ring_scores else 0.0

    def _analyze_radial_gradient_pattern(self, gradient_feature: np.ndarray, 
                                       center_y: int, center_x: int, radius: int) -> float:
        """Analyze how well gradients point radially outward from center"""
        h, w = gradient_feature.shape
        
        # Sample gradient consistency around the structure
        gradient_samples = []
        for r in range(max(2, radius//2), radius+1):
            angles = np.linspace(0, 2*np.pi, max(8, int(2*np.pi*r/3)), endpoint=False)
            
            for angle in angles:
                y = int(center_y + r * np.sin(angle))
                x = int(center_x + r * np.cos(angle))
                if 0 <= y < h and 0 <= x < w:
                    gradient_samples.append(gradient_feature[y, x])
        
        return np.mean(gradient_samples) if gradient_samples else 0.0

    def _analyze_elevation_structure(self, elevation: np.ndarray, 
                                   center_y: int, center_x: int, radius: int) -> float:
        """Analyze elevation profile for circular structure characteristics"""
        h, w = elevation.shape
        center_elevation = elevation[center_y, center_x]
        
        # Sample elevations in concentric rings
        ring_means = []
        for r in range(1, radius+1, max(1, radius//5)):
            ring_elevations = []
            angles = np.linspace(0, 2*np.pi, max(8, int(2*np.pi*r/3)), endpoint=False)
            
            for angle in angles:
                y = int(center_y + r * np.sin(angle))
                x = int(center_x + r * np.cos(angle))
                if 0 <= y < h and 0 <= x < w:
                    ring_elevations.append(elevation[y, x])
            
            if ring_elevations:
                ring_means.append(np.mean(ring_elevations))
        
        # Check for decreasing trend (structure characteristic)
        if len(ring_means) >= 2:
            decreasing_count = sum(1 for i in range(len(ring_means)-1) 
                                 if ring_means[i] >= ring_means[i+1])
            return decreasing_count / (len(ring_means) - 1)
        
        return 0.5  # Neutral score if insufficient data

    def _analyze_peak_isolation(self, isolation_feature: np.ndarray, 
                              center_y: int, center_x: int, radius: int) -> float:
        """Analyze how isolated the central peak is"""
        h, w = isolation_feature.shape
        
        # Check central isolation score
        center_isolation = isolation_feature[center_y, center_x]
        
        # Check surrounding isolation to ensure peak is unique
        surround_isolation = []
        for r in range(radius, min(radius*2, min(h, w)//2)):
            angles = np.linspace(0, 2*np.pi, max(8, int(2*np.pi*r/4)), endpoint=False)
            
            for angle in angles:
                y = int(center_y + r * np.sin(angle))
                x = int(center_x + r * np.cos(angle))
                if 0 <= y < h and 0 <= x < w:
                    surround_isolation.append(isolation_feature[y, x])
        
        if surround_isolation:
            surround_mean = np.mean(surround_isolation)
            # Good isolation = high center value, low surround values
            return center_isolation / (surround_mean + 0.1)
        
        return center_isolation

    def _analyze_feature_coherence(self, feature_data: np.ndarray, 
                                 center_y: int, center_x: int, radius: int) -> float:
        """Analyze multi-scale feature coherence"""
        try:
            h, w, n_features = feature_data.shape
            coherence_scores = []
            
            # Check feature consistency in central region
            y_start = max(0, center_y - radius//2)
            y_end = min(h, center_y + radius//2 + 1)
            x_start = max(0, center_x - radius//2)
            x_end = min(w, center_x + radius//2 + 1)
            
            central_region = feature_data[y_start:y_end, x_start:x_end, :]
            
            for f in range(n_features):
                feature_slice = central_region[:, :, f]
                if feature_slice.size > 4:
                    # Measure spatial consistency
                    feature_std = np.std(feature_slice)
                    feature_mean = np.mean(feature_slice)
                    if feature_mean > 0:
                        consistency = 1.0 / (1.0 + feature_std / feature_mean)
                        coherence_scores.append(consistency)
            
            return np.mean(coherence_scores) if coherence_scores else 0.0
            
        except Exception as e:
            logger.warning(f"Feature coherence analysis failed: {e}")
            return 0.0

    def _calculate_combined_confidence(self, max_score: float, center_score: float, 
                                     geometric_score: float, size_metrics: Dict, 
                                     adaptive_thresholds: Dict) -> float:
        """Calculate combined confidence score"""
        try:
            confidence_factors = []
            
            # φ⁰ score contribution
            phi0_threshold = adaptive_thresholds['min_phi0_threshold']
            phi0_confidence = min(1.0, max_score / (phi0_threshold * 1.2))
            confidence_factors.append(phi0_confidence * 0.4)
            
            # Center vs max consistency
            center_consistency = center_score / (max_score + 1e-6)
            confidence_factors.append(center_consistency * 0.2)
            
            # Geometric validation contribution
            geometric_confidence = min(1.0, geometric_score / 0.5)
            confidence_factors.append(geometric_confidence * 0.3)
            
            # Size validation contribution (if available)
            if size_metrics:
                size_confidence = 0.0
                if size_metrics.get('height_prominence', 0) >= adaptive_thresholds['min_height_prominence']:
                    size_confidence += 0.33
                if size_metrics.get('volume_above_base', 0) >= adaptive_thresholds['min_volume']:
                    size_confidence += 0.33
                if size_metrics.get('elevation_range', 0) >= adaptive_thresholds['min_elevation_range']:
                    size_confidence += 0.34
                confidence_factors.append(size_confidence * 0.1)
            
            return min(1.0, sum(confidence_factors))
            
        except Exception as e:
            logger.warning(f"Confidence calculation failed: {e}")
            return max_score  # Fallback to φ⁰ score
    
    def update_adaptive_thresholds_from_validation(self, positive_results, negative_results):
        """
        Update detection thresholds based on validation performance.
        
        Args:
            positive_results: List of detection results from known positive patches
            negative_results: List of detection results from known negative patches
            
        Returns:
            Dict containing updated threshold values
        """
        logger.info("Analyzing validation results to optimize thresholds...")
        
        # Extract scores from results
        positive_phi0_scores = [r.get('phi0_response', 0) for r in positive_results if r]
        positive_geo_scores = [r.get('geometric_score', 0) for r in positive_results if r]
        negative_phi0_scores = [r.get('phi0_response', 0) for r in negative_results if r]
        negative_geo_scores = [r.get('geometric_score', 0) for r in negative_results if r]
        
        if not positive_phi0_scores or not negative_phi0_scores:
            logger.warning("Insufficient validation data for threshold optimization")
            return {
                'min_phi0_threshold': self.min_phi0_threshold,
                'geometric_threshold': self.geometric_threshold
            }
        
        # Find optimal φ⁰ threshold (maximize separation between positive and negative)
        pos_phi0_min = min(positive_phi0_scores)
        neg_phi0_max = max(negative_phi0_scores)
        
        # Set threshold between highest negative and lowest positive, with safety margin
        if pos_phi0_min > neg_phi0_max:
            optimal_phi0_threshold = (pos_phi0_min + neg_phi0_max) / 2
        else:
            # Overlap case - use percentile approach
            optimal_phi0_threshold = np.percentile(positive_phi0_scores, 25)
        
        # Ensure threshold is reasonable
        optimal_phi0_threshold = max(0.1, min(0.8, optimal_phi0_threshold))
        
        # Find optimal geometric threshold
        pos_geo_mean = np.mean(positive_geo_scores)
        neg_geo_mean = np.mean(negative_geo_scores)
        
        # If positive scores are higher, keep current threshold
        # If negative scores are higher, increase threshold
        if pos_geo_mean > neg_geo_mean:
            optimal_geo_threshold = self.geometric_threshold
        else:
            optimal_geo_threshold = min(1.5, self.geometric_threshold * 1.2)
        
        # Update thresholds
        self.min_phi0_threshold = optimal_phi0_threshold
        self.geometric_threshold = optimal_geo_threshold
        
        logger.info(f"Threshold optimization complete:")
        logger.info(f"  φ⁰ threshold: {self.min_phi0_threshold:.3f}")
        logger.info(f"  Geometric threshold: {self.geometric_threshold:.3f}")
        
        return {
            'min_phi0_threshold': self.min_phi0_threshold,
            'geometric_threshold': self.geometric_threshold
        }
    
    def visualize_detection_results(self, phi0_responses, patch_names=None, save_path=None):
        """
        Visualize detection coherence maps and results
        
        Args:
            phi0_responses: List of detection response maps
            patch_names: Optional list of patch names for titles
            save_path: Optional path to save visualization
        """
        try:
            import matplotlib.pyplot as plt
            from matplotlib import gridspec
            
            n_responses = len(phi0_responses)
            if n_responses == 0:
                logger.warning("No detection responses to visualize")
                return
                
            # Create figure for coherence maps
            fig = plt.figure(figsize=(20, 12))
            
            cols = min(4, n_responses)
            rows = (n_responses + cols - 1) // cols
            
            for i, response in enumerate(phi0_responses):
                ax = plt.subplot(rows, cols, i + 1)
                
                # Display coherence map
                im = ax.imshow(response, cmap='hot', aspect='equal', vmin=0, vmax=np.max(response))
                
                # Add title
                title = patch_names[i] if patch_names and i < len(patch_names) else f'Response {i+1}'
                max_score = np.max(response)
                center_y, center_x = response.shape[0]//2, response.shape[1]//2
                center_score = response[center_y, center_x]
                
                # Determine detection status
                is_detected = max_score > self.min_phi0_threshold
                status = "🎯 DETECTED" if is_detected else "❌ Below threshold"
                
                ax.set_title(f'{title}\nMax: {max_score:.3f}, Center: {center_score:.3f}\n{status}', fontsize=10)
                
                # Add colorbar
                plt.colorbar(im, ax=ax, label='φ⁰ Score')
                
                # Mark center and max points
                ax.plot(center_x, center_y, 'b+', markersize=8, markeredgewidth=2, label='Center')
                max_pos = np.unravel_index(np.argmax(response), response.shape)
                ax.plot(max_pos[1], max_pos[0], 'r*', markersize=10, label='Max')
                ax.legend()
            
            plt.tight_layout()
            
            # Save the figure
            if save_path is None:
                save_path = f'/tmp/detection_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.png'
            
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
            logger.info(f"🎯 Detection results visualization saved to: {save_path}")
            plt.close()
            
        except Exception as e:
            logger.error(f"❌ Detection visualization failed: {e}")