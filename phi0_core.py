#!/usr/bin/env python3
"""
Phi-Zero (φ⁰) Circular Structure Detection Core - Clean Implementation

A streamlined, well-organized implementation of the v8 circular structure detection algorithm.
Combines elevation histogram matching with geometric pattern analysis for robust
detection of circular elevated structures in elevation data.

Key Features:
- 8-dimensional octonionic feature extraction
- Raw elevation histogram matching
- Geometric pattern validation
- Performance analytics and visualization
- Structure-agnostic design (windmills, towers, mounds, etc.)

Author: Structure Detection Team
Version: v8-clean
"""

import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from scipy.ndimage import (
    uniform_filter, gaussian_filter, maximum_filter,
    distance_transform_edt, sobel
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
# MAIN DETECTOR CLASS
# =============================================================================

class PhiZeroStructureDetector:
    """
    Clean implementation of the Phi-Zero circular structure detection algorithm.
    
    This detector uses an 8-dimensional octonionic feature space combined with
    elevation histogram matching and geometric pattern validation to detect
    circular elevated structures in elevation data.
    
    Supports various structure types:
    - Windmill foundations
    - Ancient mounds and settlements  
    - Communication towers
    - Water towers
    - Archaeological circular features
    """
    
    def __init__(self, resolution_m: float = 0.5, kernel_size: int = 21, structure_type: str = "windmill"):
        """
        Initialize the Phi-Zero structure detector.
        
        Args:
            resolution_m: Spatial resolution in meters per pixel
            kernel_size: Size of the detection kernel (should be odd)
            structure_type: Type of structure to detect ("windmill", "tower", "mound", "settlement", "generic")
        """
        self.resolution_m = resolution_m
        self.kernel_size = kernel_size if kernel_size % 2 == 1 else kernel_size + 1
        self.structure_type = structure_type
        self.n_features = 8
        
        # Structure-specific parameters
        if structure_type == "windmill":
            self.detection_threshold = 0.50
            self.structure_radius_m = 8.0  # Typical windmill foundation radius
            self.structure_scales = [10, 15, 25]
        elif structure_type == "tower":
            self.detection_threshold = 0.45
            self.structure_radius_m = 5.0  # Communication/water towers
            self.structure_scales = [5, 8, 12]
        elif structure_type == "mound":
            self.detection_threshold = 0.30
            self.structure_radius_m = 15.0  # Archaeological mounds
            self.structure_scales = [15, 25, 40]
        elif structure_type == "settlement":
            self.detection_threshold = 0.25
            self.structure_radius_m = 20.0  # Settlement circles
            self.structure_scales = [20, 30, 50]
        else:  # generic
            self.detection_threshold = 0.35
            self.structure_radius_m = 10.0
            self.structure_scales = [5, 10, 20]
        
        self.structure_radius_px = int(self.structure_radius_m / resolution_m)
        
        # Internal state
        self.psi0_kernel = None
        self.elevation_kernel = None
        
        logger.info(f"PhiZero detector initialized for {structure_type} structures at {resolution_m}m resolution")
    
    
    # =========================================================================
    # CORE FEATURE EXTRACTION
    # =========================================================================
    
    def extract_octonionic_features(self, elevation_data: np.ndarray) -> np.ndarray:
        """
        Extract 8-dimensional octonionic features from elevation data with enhanced size discrimination.
        
        Features:
        0. Radial Height Prominence (enhanced with volume discrimination)
        1. Circular Symmetry
        2. Radial Gradient Consistency
        3. Ring Edge Sharpness
        4. Hough Response
        5. Local Planarity
        6. Isolation Score (enhanced with height prominence)
        7. Geometric Coherence
        
        Args:
            elevation_data: 2D elevation array
            
        Returns:
            3D array of shape (h, w, 8) containing features
        """
        elevation = np.nan_to_num(elevation_data.astype(np.float64), nan=0.0)
        h, w = elevation.shape
        features = np.zeros((h, w, 8))
        
        # Compute gradients once
        grad_x = np.gradient(elevation, axis=1) / self.resolution_m
        grad_y = np.gradient(elevation, axis=0) / self.resolution_m
        grad_magnitude = np.sqrt(grad_x**2 + grad_y**2)
        
        # Extract base features
        base_radial_prominence = self._compute_radial_prominence(elevation)
        base_isolation = self._compute_isolation_score(elevation)
        
        # Enhanced size discrimination metrics
        volume_metric = self._compute_structure_volume_metric(elevation)
        height_prominence = self._compute_height_prominence_metric(elevation)
        
        # Combine features with size discrimination
        features[..., 0] = base_radial_prominence * (0.7 + 0.3 * volume_metric)  # Volume-weighted prominence
        features[..., 1] = self._compute_circular_symmetry(elevation)
        features[..., 2] = self._compute_radial_gradient_consistency(grad_x, grad_y)
        features[..., 3] = self._compute_ring_edges(elevation)
        features[..., 4] = self._compute_hough_response(grad_magnitude)
        features[..., 5] = self._compute_local_planarity(elevation)
        features[..., 6] = base_isolation * (0.6 + 0.4 * height_prominence)  # Height-weighted isolation
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
        """Compute f1: Circular Symmetry around each point"""
        h, w = elevation.shape
        radius = self.structure_radius_px
        symmetry = np.zeros((h, w))
        angles = np.linspace(0, 2*np.pi, 8, endpoint=False)
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
                
                if len(values) >= 6:
                    values = np.array(values)
                    std_dev = np.std(values)
                    mean_val = np.mean(values)
                    relative_std = std_dev / (abs(mean_val) + 1e-6)
                    symmetry[y, x] = 1.0 / (1.0 + 2.0 * relative_std)
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
                y_min, y_max = cy-radius, cy+radius+1
                x_min, x_max = cx-radius, cx+radius+1
                local_gx = grad_x[y_min:y_max, x_min:x_max]
                local_gy = grad_y[y_min:y_max, x_min:x_max]
                
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
    # KERNEL LEARNING AND PATTERN MATCHING
    # =========================================================================
    
    def _find_optimal_kernel_center(self, elevation: np.ndarray) -> Tuple[int, int]:
        """
        Find the optimal center location for kernel extraction.
        
        This method locates the elevation apex (maximum point) within the patch,
        which typically corresponds to the center of circular elevated structures.
        
        Args:
            elevation: 2D elevation array
            
        Returns:
            Tuple of (center_y, center_x) coordinates of the optimal center
        """
        # Find the location of maximum elevation (apex)
        max_pos = np.unravel_index(np.argmax(elevation), elevation.shape)
        center_y, center_x = max_pos[0], max_pos[1]
        
        # Validate that the apex is not at the edge (which could be noise)
        h, w = elevation.shape
        min_margin = max(3, self.kernel_size // 4)  # Minimum distance from edge
        
        # If apex is too close to edge, find a more central high point
        if (center_y < min_margin or center_y >= h - min_margin or 
            center_x < min_margin or center_x >= w - min_margin):
            
            # Create a mask excluding edge regions
            mask = np.zeros_like(elevation, dtype=bool)
            mask[min_margin:h-min_margin, min_margin:w-min_margin] = True
            
            # Find the highest point within the safe region
            masked_elevation = elevation.copy()
            masked_elevation[~mask] = np.min(elevation) - 1  # Set edges to very low value
            
            max_pos = np.unravel_index(np.argmax(masked_elevation), masked_elevation.shape)
            center_y, center_x = max_pos[0], max_pos[1]
        
        return center_y, center_x
    
    def learn_pattern_kernel(self, training_patches: List[ElevationPatch], 
                           use_apex_center: bool = True) -> np.ndarray:
        """
        Learn the Phi-Zero kernel from training patches.
        
        This method builds both elevation and feature kernels for pattern matching.
        The elevation kernel preserves raw elevation patterns for histogram matching,
        while the feature kernel provides geometric validation.
        
        Args:
            training_patches: List of training elevation patches
            use_apex_center: If True, center kernel on elevation peak; if False, use geometric center
            
        Returns:
            Normalized feature kernel
        """
        logger.info(f"Learning φ⁰ kernel from {len(training_patches)} training patches")
        logger.info(f"Kernel extraction mode: {'apex-centered' if use_apex_center else 'geometric-centered'}")
        
        if not training_patches:
            logger.warning("No training patches provided, using default kernel")
            return self._create_default_kernel()
        
        all_elevations = []
        all_features = []
        
        for i, patch in enumerate(training_patches):
            if hasattr(patch, 'elevation_data') and patch.elevation_data is not None:
                elevation = patch.elevation_data
                features = self.extract_octonionic_features(elevation)
                
                h, w = elevation.shape
                if h >= self.kernel_size and w >= self.kernel_size:
                    
                    # Determine kernel center location
                    if use_apex_center:
                        center_y, center_x = self._find_optimal_kernel_center(elevation)
                        logger.debug(f"Patch {i}: apex at ({center_y}, {center_x}), geometric center at ({h//2}, {w//2})")
                    else:
                        center_y, center_x = h // 2, w // 2
                    
                    # Check if kernel fits within patch bounds
                    half_kernel = self.kernel_size // 2
                    if (center_y >= half_kernel and center_y < h - half_kernel and
                        center_x >= half_kernel and center_x < w - half_kernel):
                        
                        # Extract kernel-sized patches centered on chosen point
                        start_y = center_y - half_kernel
                        start_x = center_x - half_kernel
                        
                        elevation_kernel = elevation[start_y:start_y+self.kernel_size, start_x:start_x+self.kernel_size]
                        feature_kernel = features[start_y:start_y+self.kernel_size, start_x:start_x+self.kernel_size, :]
                        
                        # Only use patches with meaningful variation
                        if np.std(elevation_kernel) > 0.01:
                            all_elevations.append(elevation_kernel)
                            all_features.append(feature_kernel)
                        else:
                            logger.warning(f"Patch {i}: Low variance in kernel, skipping")
                    else:
                        logger.warning(f"Patch {i}: Apex too close to edge for kernel size {self.kernel_size}, using geometric center")
                        # Fallback to geometric center
                        start_y = (h - self.kernel_size) // 2
                        start_x = (w - self.kernel_size) // 2
                        
                        elevation_kernel = elevation[start_y:start_y+self.kernel_size, start_x:start_x+self.kernel_size]
                        feature_kernel = features[start_y:start_y+self.kernel_size, start_x:start_x+self.kernel_size, :]
                        
                        if np.std(elevation_kernel) > 0.01:
                            all_elevations.append(elevation_kernel)
                            all_features.append(feature_kernel)
        
        if not all_features:
            logger.warning("No valid training features, using default kernel")
            return self._create_default_kernel()
        
        # Build kernels
        elevation_kernel = np.mean(all_elevations, axis=0)  # Raw elevation
        feature_kernel = np.mean(all_features, axis=0)      # Features
        
        # Store raw elevation kernel for histogram matching (NO G2 symmetrization)
        self.elevation_kernel = elevation_kernel
        
        # Normalize feature kernel
        feature_kernel_normalized = self._normalize_kernel(feature_kernel)
        self.psi0_kernel = feature_kernel_normalized
        
        logger.info(f"✅ φ⁰ kernel constructed with shape {feature_kernel_normalized.shape}")
        logger.info(f"📊 Elevation kernel range: {np.min(self.elevation_kernel):.2f} to {np.max(self.elevation_kernel):.2f}m")
        
        return feature_kernel_normalized
    
    def _create_default_kernel(self) -> np.ndarray:
        """Create a default radial kernel when no training data is available"""
        kernel = np.zeros((self.kernel_size, self.kernel_size, self.n_features))
        center = self.kernel_size // 2
        
        for i in range(self.kernel_size):
            for j in range(self.kernel_size):
                distance = np.sqrt((i - center)**2 + (j - center)**2)
                if distance < self.kernel_size // 2:
                    value = np.exp(-distance / 3.0)
                    kernel[i, j, :] = value
        
        return self._normalize_kernel(kernel)
    
    def _apply_g2_symmetrization(self, pattern: np.ndarray) -> np.ndarray:
        """Apply G2 symmetrization (4-fold rotational symmetry)"""
        symmetrized = pattern.copy()
        for angle in [90, 180, 270]:
            rotated = np.rot90(pattern, k=angle//90, axes=(0, 1))
            symmetrized += rotated
        return symmetrized / 4.0
    
    def _normalize_kernel(self, kernel: np.ndarray) -> np.ndarray:
        """Normalize kernel channels to zero mean, unit variance"""
        normalized = kernel.copy()
        for f in range(self.n_features):
            channel = kernel[..., f]
            mean = np.mean(channel)
            std = np.std(channel)
            if std > 1e-10:
                normalized[..., f] = (channel - mean) / std
            else:
                normalized[..., f] = channel - mean
        return normalized
    
    
    # =========================================================================
    # PATTERN DETECTION AND MATCHING
    # =========================================================================
    
    def detect_patterns(self, feature_data: np.ndarray, elevation_data: np.ndarray = None, 
                       enable_center_bias: bool = True) -> np.ndarray:
        """
        Apply Phi-Zero pattern detection to feature data.
        
        Args:
            feature_data: 3D array of octonionic features
            elevation_data: Optional raw elevation data for histogram matching
            enable_center_bias: Whether to apply center bias weighting
            
        Returns:
            2D coherence map with detection scores
        """
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
        """
        Calculate coherence score combining elevation histogram matching and geometric validation.
        
        Strategy:
        1. Primary: Elevation histogram matching (80% weight)
        2. Secondary: Geometric feature correlation (20% weight)
        """
        try:
            elevation_score = 0.0
            geometric_score = 0.0
            
            # === ELEVATION HISTOGRAM MATCHING ===
            if elevation_patch is not None and self.elevation_kernel is not None:
                elevation_score = self._compute_elevation_histogram_score(elevation_patch, self.elevation_kernel)
            
            # === GEOMETRIC FEATURE VALIDATION ===
            if local_patch is not None and self.psi0_kernel is not None:
                geometric_score = self._compute_geometric_correlation_score(local_patch, self.psi0_kernel)
            
            # === WEIGHTED COMBINATION ===
            if elevation_score > 0 and geometric_score > 0:
                # Both available - heavily weight elevation
                combined_score = 0.80 * elevation_score + 0.20 * geometric_score
            elif elevation_score > 0:
                # Elevation only - use with small penalty
                combined_score = elevation_score * 0.85
            elif geometric_score > 0:
                # Geometric only - heavily penalize
                combined_score = geometric_score * 0.10
            else:
                combined_score = 0.0
            
            return max(0.0, min(1.0, combined_score))
            
        except Exception as e:
            logger.warning(f"Coherence calculation error: {e}")
            return 0.0
    
    def _compute_elevation_histogram_score(self, local_elevation: np.ndarray, kernel_elevation: np.ndarray) -> float:
        """Compute elevation histogram matching score"""
        # Check for meaningful variation
        local_range = np.max(local_elevation) - np.min(local_elevation)
        kernel_range = np.max(kernel_elevation) - np.min(kernel_elevation)
        
        if local_range < 0.5 or kernel_range < 0.5:  # Need at least 50cm variation
            return 0.0
        
        # Normalize to relative patterns (remove base elevation)
        local_relative = local_elevation - np.min(local_elevation)
        kernel_relative = kernel_elevation - np.min(kernel_elevation)
        
        local_max_rel = np.max(local_relative)
        kernel_max_rel = np.max(kernel_relative)
        
        if local_max_rel < 0.1 or kernel_max_rel < 0.1:
            return 0.0
        
        # Scale to [0,1] for comparison
        local_normalized = local_relative / local_max_rel
        kernel_normalized = kernel_relative / kernel_max_rel
        
        # Create histograms
        num_bins = 16
        bin_edges = np.linspace(0, 1, num_bins + 1)
        
        local_hist, _ = np.histogram(local_normalized.flatten(), bins=bin_edges, density=True)
        kernel_hist, _ = np.histogram(kernel_normalized.flatten(), bins=bin_edges, density=True)
        
        # Normalize to probability distributions
        local_hist = local_hist / (np.sum(local_hist) + 1e-8)
        kernel_hist = kernel_hist / (np.sum(kernel_hist) + 1e-8)
        
        # Cosine similarity
        local_norm = np.linalg.norm(local_hist)
        kernel_norm = np.linalg.norm(kernel_hist)
        
        if local_norm > 1e-8 and kernel_norm > 1e-8:
            similarity = np.dot(local_hist, kernel_hist) / (local_norm * kernel_norm)
            return max(0.0, min(1.0, similarity))
        
        return 0.0
    
    def _compute_geometric_correlation_score(self, local_patch: np.ndarray, kernel: np.ndarray) -> float:
        """Compute geometric feature correlation score"""
        if local_patch.shape != kernel.shape or local_patch.ndim != 3:
            return 0.0
        
        # Use subset of geometric features (skip channel 0 which might be elevation-based)
        if local_patch.shape[2] > 2:
            local_features = local_patch[:, :, 1:3].flatten()
            kernel_features = kernel[:, :, 1:3].flatten()
            
            if len(local_features) > 0 and len(kernel_features) > 0:
                correlation_matrix = np.corrcoef(local_features, kernel_features)
                if correlation_matrix.shape == (2, 2):
                    correlation = correlation_matrix[0, 1]
                    return max(0.0, correlation)  # Convert [-1,1] to [0,1]
        
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
    # GEOMETRIC VALIDATION AND ENHANCED DETECTION
    # =========================================================================
    
    def detect_with_geometric_validation(self, feature_data: np.ndarray, 
                                       elevation_data: np.ndarray = None) -> DetectionResult:
        """
        Enhanced detection with geometric pattern validation.
        
        Returns comprehensive detection result with geometric analysis.
        """
        # Get standard φ⁰ response
        phi0_response = self.detect_patterns(feature_data, elevation_data, enable_center_bias=True)
        
        max_score = np.max(phi0_response)
        center_y, center_x = phi0_response.shape[0]//2, phi0_response.shape[1]//2
        center_score = phi0_response[center_y, center_x]
        
        # Analyze geometric patterns
        geometric_score, pattern_metrics = self._analyze_geometric_patterns(phi0_response)
        
        # Determine detection result
        geometric_threshold = 0.40
        
        if max_score < 0.3:
            detected = False
            confidence = 0.0
            reason = 'very_low_phi0'
        elif geometric_score < geometric_threshold:
            detected = False
            confidence = max(0.0, min(0.4, geometric_score))
            reason = 'poor_geometric_pattern'
        else:
            detected = True
            confidence = min(1.0, (max_score + geometric_score) / 2.0)
            reason = 'geometric_structure_pattern'
        
        return DetectionResult(
            detected=detected,
            confidence=confidence,
            reason=reason,
            max_score=max_score,
            center_score=center_score,
            geometric_score=geometric_score,
            details={
                'phi0_response': phi0_response,
                'pattern_metrics': pattern_metrics,
                'threshold_used': geometric_threshold
            }
        )
    
    def _analyze_geometric_patterns(self, phi0_response: np.ndarray) -> Tuple[float, Dict]:
        """Analyze geometric characteristics that distinguish circular structure patterns"""
        h, w = phi0_response.shape
        center_y, center_x = h//2, w//2
        
        # Create response mask for analysis
        threshold = np.max(phi0_response) * 0.3
        response_mask = phi0_response >= threshold
        
        if np.sum(response_mask) < 10:
            return 0.0, {'reason': 'insufficient_area'}
        
        # Compute geometric metrics
        radial_score = self._compute_radial_symmetry_metric(phi0_response, center_y, center_x)
        dominance_score = self._compute_central_dominance_metric(phi0_response, center_y, center_x)
        compactness_score = self._compute_compactness_metric(response_mask, center_y, center_x)
        smoothness_score = self._compute_gradient_smoothness_metric(phi0_response, response_mask)
        aspect_score = self._compute_aspect_ratio_metric(response_mask)
        
        # Weighted combination
        weights = {'radial': 0.25, 'dominance': 0.25, 'compactness': 0.20, 'smoothness': 0.20, 'aspect': 0.10}
        
        geometric_score = (
            weights['radial'] * radial_score +
            weights['dominance'] * dominance_score +
            weights['compactness'] * compactness_score +
            weights['smoothness'] * smoothness_score +
            weights['aspect'] * aspect_score
        )
        
        pattern_metrics = {
            'radial_symmetry': radial_score,
            'central_dominance': dominance_score,
            'compactness': compactness_score,
            'gradient_smoothness': smoothness_score,
            'aspect_ratio': aspect_score,
            'combined_geometric_score': geometric_score
        }
        
        return geometric_score, pattern_metrics
    
    def _compute_radial_symmetry_metric(self, response: np.ndarray, center_y: int, center_x: int) -> float:
        """Measure radial symmetry around center"""
        h, w = response.shape
        max_radius = min(h, w) // 3
        symmetry_scores = []
        
        for radius in range(2, max_radius, 2):
            angles = np.linspace(0, 2*np.pi, 16, endpoint=False)
            values = []
            
            for angle in angles:
                y = int(center_y + radius * np.sin(angle))
                x = int(center_x + radius * np.cos(angle))
                if 0 <= y < h and 0 <= x < w:
                    values.append(response[y, x])
            
            if len(values) >= 12:
                values = np.array(values)
                mean_val = np.mean(values)
                if mean_val > 0:
                    cv = np.std(values) / mean_val
                    symmetry_score = max(0, 1.0 - cv)
                    symmetry_scores.append(symmetry_score)
        
        return np.mean(symmetry_scores) if symmetry_scores else 0.0
    
    def _compute_central_dominance_metric(self, response: np.ndarray, center_y: int, center_x: int) -> float:
        """Measure central dominance of the pattern"""
        max_pos = np.unravel_index(np.argmax(response), response.shape)
        center_distance = np.sqrt((max_pos[0] - center_y)**2 + (max_pos[1] - center_x)**2)
        max_allowed_distance = min(response.shape) * 0.3
        return max(0, 1.0 - center_distance / max_allowed_distance)
    
    def _compute_compactness_metric(self, mask: np.ndarray, center_y: int, center_x: int) -> float:
        """Measure pattern compactness"""
        if np.sum(mask) == 0:
            return 0.0
        
        y_coords, x_coords = np.where(mask)
        centroid_y, centroid_x = np.mean(y_coords), np.mean(x_coords)
        
        # Distance from patch center to centroid
        centroid_distance = np.sqrt((centroid_y - center_y)**2 + (centroid_x - center_x)**2)
        max_distance = min(mask.shape) * 0.25
        centroid_score = max(0, 1.0 - centroid_distance / max_distance)
        
        # Compactness around centroid
        distances_to_centroid = np.sqrt((y_coords - centroid_y)**2 + (x_coords - centroid_x)**2)
        mean_distance = np.mean(distances_to_centroid)
        relative_distance = mean_distance / (min(mask.shape) / 4.0)
        distance_score = max(0, 1.0 - relative_distance)
        
        return (centroid_score + distance_score) / 2.0
    
    def _compute_gradient_smoothness_metric(self, response: np.ndarray, mask: np.ndarray) -> float:
        """Measure gradient smoothness in high-response areas"""
        if np.sum(mask) < 20:
            return 0.0
        
        grad_y, grad_x = np.gradient(response)
        gradient_magnitude = np.sqrt(grad_y**2 + grad_x**2)
        masked_gradients = gradient_magnitude[mask]
        
        if len(masked_gradients) > 0:
            grad_mean = np.mean(masked_gradients)
            grad_std = np.std(masked_gradients)
            if grad_mean > 0:
                cv = grad_std / grad_mean
                return max(0, 1.0 - cv)
        
        return 0.0
    
    def _compute_aspect_ratio_metric(self, mask: np.ndarray) -> float:
        """Measure how circular the pattern is"""
        if np.sum(mask) == 0:
            return 0.0
        
        y_coords, x_coords = np.where(mask)
        if len(y_coords) < 5:
            return 0.0
        
        y_range = np.max(y_coords) - np.min(y_coords) + 1
        x_range = np.max(x_coords) - np.min(x_coords) + 1
        
        if min(y_range, x_range) > 0:
            aspect_ratio = max(y_range, x_range) / min(y_range, x_range)
            return max(0, 1.0 - (aspect_ratio - 1.0) / 2.0)
        
        return 0.0
    
    def _compute_structure_volume_metric(self, elevation: np.ndarray, base_elevation: float = None) -> float:
        """
        Compute structure volume/mass discrimination metric.
        
        This helps distinguish between substantial structures (windmills, towers) 
        and small elevation variations (rocks, debris, measurement noise).
        
        Args:
            elevation: 2D elevation array
            base_elevation: Optional base elevation level
            
        Returns:
            Volume metric normalized by expected structure size
        """
        h, w = elevation.shape
        center_y, center_x = h // 2, w // 2
        radius = self.structure_radius_px
        
        # Create circular mask for structure region
        y, x = np.ogrid[:h, :w]
        mask = ((y - center_y)**2 + (x - center_x)**2) <= radius**2
        
        if not np.any(mask):
            return 0.0
        
        # Calculate base elevation if not provided
        if base_elevation is None:
            # Use edge areas as base reference
            edge_mask = np.zeros_like(elevation, dtype=bool)
            border_width = max(2, radius // 4)
            edge_mask[:border_width, :] = True
            edge_mask[-border_width:, :] = True
            edge_mask[:, :border_width] = True
            edge_mask[:, -border_width:] = True
            
            if np.any(edge_mask):
                base_elevation = np.median(elevation[edge_mask])
            else:
                base_elevation = np.median(elevation)
        
        # Calculate volume above base
        structure_elevation = elevation[mask]
        volume_above_base = np.sum(np.maximum(0, structure_elevation - base_elevation)) * (self.resolution_m ** 2)
        
        # Expected volume thresholds by structure type
        if self.structure_type == "windmill":
            min_volume_m3 = 50.0   # Minimum volume for windmill foundation
            typical_volume_m3 = 200.0
        elif self.structure_type == "tower":
            min_volume_m3 = 20.0   # Smaller tower foundations
            typical_volume_m3 = 100.0
        elif self.structure_type == "mound":
            min_volume_m3 = 100.0  # Archaeological mounds
            typical_volume_m3 = 500.0
        else:  # generic
            min_volume_m3 = 25.0
            typical_volume_m3 = 150.0
        
        # Volume adequacy score
        if volume_above_base < min_volume_m3:
            return 0.0  # Too small to be target structure
        elif volume_above_base > typical_volume_m3 * 3:
            return 0.5  # Suspiciously large, moderate score
        else:
            # Sigmoid scaling between minimum and typical
            volume_ratio = volume_above_base / typical_volume_m3
            return min(1.0, volume_ratio)
    
    def _compute_height_prominence_metric(self, elevation: np.ndarray) -> float:
        """
        Compute height prominence metric to filter tiny elevation variations.
        
        Returns:
            Height prominence score (0-1)
        """
        h, w = elevation.shape
        center_y, center_x = h // 2, w // 2
        radius = self.structure_radius_px
        
        # Structure region
        y, x = np.ogrid[:h, :w]
        structure_mask = ((y - center_y)**2 + (x - center_x)**2) <= radius**2
        
        # Surrounding region (ring around structure)
        surround_inner = radius + 2
        surround_outer = min(h, w) // 2 - 2
        surround_mask = (((y - center_y)**2 + (x - center_x)**2) > surround_inner**2) & \
                       (((y - center_y)**2 + (x - center_x)**2) <= surround_outer**2)
        
        if not (np.any(structure_mask) and np.any(surround_mask)):
            return 0.0
        
        # Height statistics
        structure_heights = elevation[structure_mask]
        surround_heights = elevation[surround_mask]
        
        structure_max = np.max(structure_heights)
        structure_mean = np.mean(structure_heights)
        surround_mean = np.mean(surround_heights)
        surround_std = np.std(surround_heights)
        
        # Absolute prominence above surroundings
        absolute_prominence = structure_max - surround_mean
        
        # Relative prominence (accounting for local terrain variation)
        relative_prominence = absolute_prominence / (surround_std + 0.1)
        
        # Minimum height thresholds by structure type
        if self.structure_type == "windmill":
            min_height_m = 0.8   # Windmill foundations should be at least 80cm prominent
            typical_height_m = 2.0
        elif self.structure_type == "tower":
            min_height_m = 1.0   # Tower foundations
            typical_height_m = 3.0
        elif self.structure_type == "mound":
            min_height_m = 0.5   # Archaeological mounds can be subtle
            typical_height_m = 2.0
        else:  # generic
            min_height_m = 0.6
            typical_height_m = 1.5
        
        # Height adequacy score
        if absolute_prominence < min_height_m:
            return 0.0  # Too low to be target structure
        
        # Combine absolute and relative prominence
        height_score = min(1.0, absolute_prominence / typical_height_m)
        relative_score = min(1.0, relative_prominence / 3.0)  # 3 standard deviations is very prominent
        
        return (height_score + relative_score) / 2.0
    
    
    # =========================================================================
    # PERFORMANCE ANALYSIS AND UTILITIES
    # =========================================================================
    
    def analyze_performance(self, positive_scores: List[float], negative_scores: List[float]) -> Dict:
        """Analyze detection performance metrics"""
        pos_mean, neg_mean = np.mean(positive_scores), np.mean(negative_scores)
        pos_std, neg_std = np.std(positive_scores), np.std(negative_scores)
        
        # Signal-to-noise ratio
        snr = abs(pos_mean - neg_mean) / (pos_std + neg_std + 1e-10)
        
        # Effect size (Cohen's d)
        pooled_std = np.sqrt(((len(positive_scores) - 1) * pos_std**2 + 
                             (len(negative_scores) - 1) * neg_std**2) / 
                            (len(positive_scores) + len(negative_scores) - 2))
        cohens_d = (pos_mean - neg_mean) / pooled_std if pooled_std > 0 else 0
        
        # Find optimal threshold
        all_scores = np.concatenate([positive_scores, negative_scores])
        thresholds = np.linspace(np.min(all_scores), np.max(all_scores), 100)
        
        best_accuracy = 0
        best_threshold = self.detection_threshold
        
        for threshold in thresholds:
            tp = np.sum(np.array(positive_scores) >= threshold)
            tn = np.sum(np.array(negative_scores) < threshold)
            accuracy = (tp + tn) / (len(positive_scores) + len(negative_scores))
            
            if accuracy > best_accuracy:
                best_accuracy = accuracy
                best_threshold = threshold
        
        return {
            'positive_mean': pos_mean,
            'negative_mean': neg_mean,
            'signal_to_noise_ratio': snr,
            'cohens_d': cohens_d,
            'optimal_threshold': best_threshold,
            'optimal_accuracy': best_accuracy,
            'current_threshold': self.detection_threshold,
            'separation_strength': 'Strong' if snr > 2.0 else 'Moderate' if snr > 1.0 else 'Weak'
        }
    
    def visualize_detection_results(self, phi0_responses: List[np.ndarray], 
                                  patch_names: List[str] = None, save_path: str = None) -> str:
        """Visualize detection results with enhanced plots"""
        try:
            import matplotlib.pyplot as plt
            from datetime import datetime
            
            n_responses = len(phi0_responses)
            if n_responses == 0:
                logger.warning("No detection responses to visualize")
                return None
            
            # Create figure
            fig = plt.figure(figsize=(20, 12))
            cols = min(4, n_responses)
            rows = (n_responses + cols - 1) // cols
            
            for i, response in enumerate(phi0_responses):
                ax = plt.subplot(rows, cols, i + 1)
                
                # Display coherence map
                im = ax.imshow(response, cmap='hot', aspect='equal', vmin=0, vmax=np.max(response))
                
                # Add metrics to title
                title = patch_names[i] if patch_names and i < len(patch_names) else f'Response {i+1}'
                max_score = np.max(response)
                center_y, center_x = response.shape[0]//2, response.shape[1]//2
                center_score = response[center_y, center_x]
                
                is_detected = max_score > self.detection_threshold
                status = "🎯 DETECTED" if is_detected else "❌ Below threshold"
                
                ax.set_title(f'{title}\nMax: {max_score:.3f}, Center: {center_score:.3f}\n{status}', fontsize=10)
                
                # Add colorbar
                plt.colorbar(im, ax=ax, label='φ⁰ Coherence Score')
                
                # Mark important points
                ax.plot(center_x, center_y, 'b+', markersize=8, markeredgewidth=2, label='Center')
                max_pos = np.unravel_index(np.argmax(response), response.shape)
                ax.plot(max_pos[1], max_pos[0], 'r*', markersize=10, label='Peak')
                
                # Add structure radius circle
                circle = plt.Circle((center_x, center_y), self.structure_radius_px, 
                                  fill=False, color='cyan', linewidth=2, linestyle='--',
                                  label=f'Structure ({self.structure_radius_m}m)')
                ax.add_patch(circle)
                ax.legend()
            
            plt.tight_layout()
            
            # Save figure
            if save_path is None:
                save_path = f'/tmp/phi0_detection_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.png'
            
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
            logger.info(f"🎯 Detection results visualization saved to: {save_path}")
            plt.close()
            
            return save_path
            
        except Exception as e:
            logger.error(f"❌ Visualization failed: {e}")
            return None


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

def create_structure_detector(structure_type: str = "windmill", resolution_m: float = 0.5, 
                            kernel_size: int = 21) -> PhiZeroStructureDetector:
    """Create a structure detector with specified parameters"""
    return PhiZeroStructureDetector(resolution_m=resolution_m, kernel_size=kernel_size, 
                                  structure_type=structure_type)

def create_windmill_detector(resolution_m: float = 0.5, kernel_size: int = 21) -> PhiZeroStructureDetector:
    """Create a windmill detector with standard parameters (legacy function)"""
    return PhiZeroStructureDetector(resolution_m=resolution_m, kernel_size=kernel_size, 
                                  structure_type="windmill")

def create_tower_detector(resolution_m: float = 0.5, kernel_size: int = 21) -> PhiZeroStructureDetector:
    """Create a tower detector with standard parameters"""
    return PhiZeroStructureDetector(resolution_m=resolution_m, kernel_size=kernel_size, 
                                  structure_type="tower")

def create_mound_detector(resolution_m: float = 0.5, kernel_size: int = 21) -> PhiZeroStructureDetector:
    """Create an archaeological mound detector with standard parameters"""
    return PhiZeroStructureDetector(resolution_m=resolution_m, kernel_size=kernel_size, 
                                  structure_type="mound")

def create_settlement_detector(resolution_m: float = 0.5, kernel_size: int = 21) -> PhiZeroStructureDetector:
    """Create a settlement detector with standard parameters"""
    return PhiZeroStructureDetector(resolution_m=resolution_m, kernel_size=kernel_size, 
                                  structure_type="settlement")


def quick_detect(elevation_data: np.ndarray, training_patches: List[ElevationPatch] = None,
                resolution_m: float = 0.5, structure_type: str = "windmill") -> DetectionResult:
    """
    Quick detection function for simple use cases.
    
    Args:
        elevation_data: 2D elevation array to analyze
        training_patches: Optional training data (uses default if None)
        resolution_m: Spatial resolution
        structure_type: Type of structure to detect
        
    Returns:
        Detection result
    """
    detector = create_structure_detector(structure_type=structure_type, resolution_m=resolution_m)
    
    # Use default kernel if no training data provided
    if training_patches:
        detector.learn_pattern_kernel(training_patches)
    else:
        detector.psi0_kernel = detector._create_default_kernel()
    
    # Extract features and detect
    features = detector.extract_octonionic_features(elevation_data)
    result = detector.detect_with_geometric_validation(features, elevation_data)
    
    return result


if __name__ == "__main__":
    logger.info("Phi-Zero Circular Structure Detection Core - Clean Implementation")
    logger.info("Supported structure types: windmill, tower, mound, settlement, generic")
    logger.info("Use create_structure_detector() to get started")
