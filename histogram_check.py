#!/usr/bin/env python3
"""
Simple debug script to understand elevation histogram matching failures.
This directly loads data and compares windmill vs negative patch histograms.
Updated to use the new clean phi0_core with apex-centered detection.
"""

import numpy as np
import matplotlib.pyplot as plt
import logging
import os
import json
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'kernel')))
from kernel.detector_profile import DetectorProfileManager
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'lidar_factory')))
from lidar_factory.factory import LidarMapFactory

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
 
def load_profile_histogram(profile_path):
    """Load the trained histogram fingerprint from the windmill profile using DetectorProfileManager."""
    manager = DetectorProfileManager(profiles_dir=os.path.dirname(profile_path))
    profile = manager.load_profile(os.path.basename(profile_path))
    # The feature name may be 'ElevationHistogram' or 'histogram' depending on config
    feature = profile.features.get('ElevationHistogram') or profile.features.get('histogram')
    if not feature:
        raise ValueError("ElevationHistogram feature not found in profile")
    fingerprint = feature.parameters.get('trained_histogram_fingerprint')
    if fingerprint is None:
        raise ValueError("trained_histogram_fingerprint not found in profile parameters")
    return fingerprint

def debug_elevation_histograms():
    print("=== DEBUGGING ELEVATION HISTOGRAM MATCHING (Profile Fingerprint, Profile-Driven Region) ===")
    # De Kat reference for profile update
    de_kat_lat = 52.47505310183309
    de_kat_lon = 4.8177388422949585
    profile_path = "/media/im3/plus/lab4/RE/re_archaeology/profiles/dutch_windmill.json"
    # Update profile fingerprint at the start
    update_profile_with_dekat_fingerprint(profile_path, de_kat_lat, de_kat_lon)
    # Load updated profile
    manager = DetectorProfileManager(profiles_dir=os.path.dirname(profile_path))
    profile = manager.load_profile(os.path.basename(profile_path))
    detection_radius_m = getattr(profile.geometry, 'detection_radius_m', 15.0)
    detection_center = getattr(profile.geometry, 'detection_center', 'apex')
    patch_size_m = profile.geometry.patch_size_m[0]
    resolution_m = profile.geometry.resolution_m
    region_size_px = int(detection_radius_m * 2 / resolution_m)
    # Use updated fingerprint
    profile_hist = profile.features.get('ElevationHistogram') or profile.features.get('histogram')
    fingerprint = profile_hist.parameters.get('trained_histogram_fingerprint')
    profile_hist = np.array(fingerprint, dtype=np.float32)
    profile_hist = profile_hist / (np.sum(profile_hist) + 1e-8)
    print(f"Loaded profile histogram: {profile_hist}")
    # Test locations as before
    test_locations = [
        {"name": "De Kat", "lat": de_kat_lat, "lon": de_kat_lon},
        {"name": "De Zoeker", "lat": 52.47590104112108, "lon": 4.817647238879872},
        {"name": "Het Jonge Schaap", "lat": 52.47621811347626, "lon": 4.816644787814995},
        {"name": "De Bonte Hen", "lat": 52.47793734015221, "lon": 4.813402499137949},
        {"name": "De Huisman", "lat": 52.47323132365517, "lon": 4.816668420518732},
        {"name": "Kinderdijk Windmill Complex", "lat": 51.8820, "lon": 4.6300},
        {"name": "De Gooyer Windmill Amsterdam", "lat": 52.3667, "lon": 4.9270},
        {"name": "Molen de Adriaan Haarlem", "lat": 52.3823, "lon": 4.6308},
        {"name": "Historic Windmill Leiden", "lat": 52.1589, "lon": 4.4937},
        {"name": "Urban Area Amsterdam 1", "lat": 52.483814, "lon": 4.804392},
        {"name": "Urban Area Amsterdam 2", "lat": 52.483185, "lon": 4.810733},
        {"name": "Urban Area Amsterdam 3", "lat": 52.483814, "lon": 4.803359},
        {"name": "Urban Area Amsterdam 4", "lat": 52.483903, "lon": 4.806456},
        {"name": "Some Trees Area", "lat": 52.628085, "lon": 4.762604},
    ]
    for loc in test_locations:
        print(f"\n=== Checking site: {loc['name']} ===")
        patch_result = LidarMapFactory.get_patch(
            lat=loc["lat"],
            lon=loc["lon"],
            size_m=patch_size_m,
            preferred_resolution_m=resolution_m,
            preferred_data_type="DSM"
        )
        if patch_result is None or patch_result.data is None:
            print(f"❌ Failed to load patch for {loc['name']}")
            continue
        elevation = patch_result.data
        h, w = elevation.shape
        # --- Apex/center detection (profile-driven) ---
        if detection_center == 'apex':
            apex_idx = np.unravel_index(np.nanargmax(elevation), elevation.shape)
            center_y, center_x = apex_idx
        else:
            center_y, center_x = h // 2, w // 2
        half_region = region_size_px // 2
        start_y = center_y - half_region
        start_x = center_x - half_region
        end_y = start_y + region_size_px
        end_x = start_x + region_size_px
        # Strict: reject if region would be clipped
        if start_y < 0 or start_x < 0 or end_y > h or end_x > w:
            print(f"❌ Region for {loc['name']} would be clipped by patch boundary. Skipping.")
            continue
        center_elevation = elevation[start_y:end_y, start_x:end_x]
        print(f"Extracted region shape: {center_elevation.shape}")
        # Save region for comparison
        # np.save(f"/media/im3/plus/lab4/RE/re_archaeology/region_debug_{loc['name'].replace(' ', '_')}.npy", center_elevation)
        # --- Manual histogram calculation (profile-driven) ---
        local_range = np.max(center_elevation) - np.min(center_elevation)
        if local_range < 0.5:
            print("Insufficient variation in patch")
            continue
        local_relative = center_elevation - np.min(center_elevation)
        local_max_rel = np.max(local_relative)
        if local_max_rel < 0.1:
            print("Insufficient relative variation in patch")
            continue
        local_normalized = local_relative / local_max_rel
        num_bins = len(profile_hist)
        bin_edges = np.linspace(0, 1, num_bins + 1)
        local_hist, _ = np.histogram(local_normalized.flatten(), bins=bin_edges, density=True)
        local_hist = local_hist / (np.sum(local_hist) + 1e-8)
        local_norm = np.linalg.norm(local_hist)
        profile_norm = np.linalg.norm(profile_hist)
        if local_norm > 1e-8 and profile_norm > 1e-8:
            score = np.dot(local_hist, profile_hist) / (local_norm * profile_norm)
            score = max(0.0, min(1.0, score))
        else:
            score = 0.0
        print(f"[Manual] Profile histogram similarity score for {loc['name']}: {score:.4f}")
        # --- Kernel module calculation ---
        from kernel.modules.features.histogram_module import ElevationHistogramModule
        hist_params = profile.features.get('ElevationHistogram').parameters
        kernel_module = ElevationHistogramModule()
        kernel_module.configure(**hist_params)
        kernel_module.trained_histogram_fingerprint = np.array(fingerprint, dtype=np.float32)
        kernel_result = kernel_module.compute(center_elevation)
        print(f"[Kernel] ElevationHistogramModule score: {kernel_result.score:.4f}")
        print(f"[Kernel] Metadata: {json.dumps(kernel_result.metadata, indent=2, default=str)}")
        # Plot the histograms for each site
        bins = np.arange(num_bins)
        width = 0.4
        plt.figure(figsize=(8, 4))
        plt.bar(bins - width/2, local_hist, width, label=f"{loc['name']} (manual)", alpha=0.7)
        plt.bar(bins + width/2, profile_hist, width, label='Profile', alpha=0.7)
        plt.title(f"Elevation Histogram Comparison\n{loc['name']}\nManual Score: {score:.4f} | Kernel Score: {kernel_result.score:.4f}")
        plt.xlabel('Normalized Elevation Bin')
        plt.ylabel('Density')
        plt.legend()
        plt.tight_layout()
        plot_path = f"/media/im3/plus/lab4/RE/re_archaeology/simple_histogram_debug_{loc['name'].replace(' ', '_')}.png"
        plt.savefig(plot_path, dpi=150, bbox_inches='tight')
        plt.close()
        print(f"Histogram comparison plot saved to {plot_path}")

def generate_apex_histogram_fingerprint(lat, lon, radius_m=10.0, bin_count=16, profile_path=None, output_json=True):
    """
    Generate an apex-centered histogram fingerprint for a given location.
    Args:
        lat (float): Latitude of the site.
        lon (float): Longitude of the site.
        radius_m (float): Radius in meters for the region (default 10.0).
        bin_count (int): Number of histogram bins (default 16).
        profile_path (str): Optional path to a profile for patch size/resolution.
        output_json (bool): If True, print JSON for copy-paste.
    Returns:
        np.ndarray: The normalized histogram fingerprint.
    """
    # Load profile for patch size and resolution if provided
    if profile_path:
        manager = DetectorProfileManager(profiles_dir=os.path.dirname(profile_path))
        profile = manager.load_profile(os.path.basename(profile_path))
        patch_size_m = profile.geometry.patch_size_m[0]
        resolution_m = profile.geometry.resolution_m
    else:
        patch_size_m = 40.0
        resolution_m = 0.5
    region_size_px = int(radius_m * 2 / resolution_m)
    # Fetch patch
    patch_result = LidarMapFactory.get_patch(
        lat=lat,
        lon=lon,
        size_m=patch_size_m,
        preferred_resolution_m=resolution_m,
        preferred_data_type="DSM"
    )
    if patch_result is None or patch_result.data is None:
        print(f"❌ Failed to load patch for ({lat}, {lon})")
        return None
    elevation = patch_result.data
    h, w = elevation.shape
    # Find apex
    apex_idx = np.unravel_index(np.nanargmax(elevation), elevation.shape)
    center_y, center_x = apex_idx
    half_region = region_size_px // 2
    start_y = max(center_y - half_region, 0)
    start_x = max(center_x - half_region, 0)
    end_y = min(start_y + region_size_px, h)
    end_x = min(start_x + region_size_px, w)
    region = elevation[start_y:end_y, start_x:end_x]
    # Compute histogram
    local_range = np.max(region) - np.min(region)
    if local_range < 0.5:
        print("Insufficient variation in patch")
        return None
    local_relative = region - np.min(region)
    local_max_rel = np.max(local_relative)
    if local_max_rel < 0.1:
        print("Insufficient relative variation in patch")
        return None
    local_normalized = local_relative / local_max_rel
    bin_edges = np.linspace(0, 1, bin_count + 1)
    local_hist, _ = np.histogram(local_normalized.flatten(), bins=bin_edges, density=True)
    local_hist = local_hist / (np.sum(local_hist) + 1e-8)
    if output_json:
        print("Apex-centered histogram fingerprint:")
        print(json.dumps(local_hist.tolist(), indent=2))
    return local_hist

def debug_with_dekat_apex_fingerprint():
    print("=== DEBUGGING: All sites vs De Kat apex-centered fingerprint ===")
    # De Kat coordinates
    de_kat_lat = 52.47505310183309
    de_kat_lon = 4.8177388422949585
    profile_path = "/media/im3/plus/lab4/RE/re_archaeology/profiles/dutch_windmill.json"
    # Generate De Kat apex-centered fingerprint (10m radius, 16 bins)
    de_kat_hist = generate_apex_histogram_fingerprint(
        de_kat_lat, de_kat_lon, radius_m=10.0, bin_count=16, profile_path=profile_path, output_json=False
    )
    if de_kat_hist is None:
        print("Failed to generate De Kat fingerprint.")
        return
    # Get patch size and resolution from profile
    manager = DetectorProfileManager(profiles_dir=os.path.dirname(profile_path))
    profile = manager.load_profile(os.path.basename(profile_path))
    patch_size_m = profile.geometry.patch_size_m[0]
    resolution_m = profile.geometry.resolution_m
    region_size_px = int(10.0 * 2 / resolution_m)
    # Test all sites
    test_locations = [
        {"name": "De Kat", "lat": de_kat_lat, "lon": de_kat_lon},
        {"name": "De Zoeker", "lat": 52.47590104112108, "lon": 4.817647238879872},
        {"name": "Het Jonge Schaap", "lat": 52.47621811347626, "lon": 4.816644787814995},
        {"name": "De Bonte Hen", "lat": 52.47793734015221, "lon": 4.813402499137949},
        {"name": "De Huisman", "lat": 52.47323132365517, "lon": 4.816668420518732},
        {"name": "Kinderdijk Windmill Complex", "lat": 51.8820, "lon": 4.6300},
        {"name": "De Gooyer Windmill Amsterdam", "lat": 52.3667, "lon": 4.9270},
        {"name": "Molen de Adriaan Haarlem", "lat": 52.3823, "lon": 4.6308},
        {"name": "Historic Windmill Leiden", "lat": 52.1589, "lon": 4.4937},
        {"name": "Urban Area Amsterdam 1", "lat": 52.483814, "lon": 4.804392},
        {"name": "Urban Area Amsterdam 2", "lat": 52.483185, "lon": 4.810733},
        {"name": "Urban Area Amsterdam 3", "lat": 52.483814, "lon": 4.803359},
        {"name": "Urban Area Amsterdam 4", "lat": 52.483903, "lon": 4.806456},
        {"name": "Some Trees Area", "lat": 52.628085, "lon": 4.762604},
    ]
    for loc in test_locations:
        print(f"\n=== Checking site: {loc['name']} ===")
        patch_result = LidarMapFactory.get_patch(
            lat=loc["lat"],
            lon=loc["lon"],
            size_m=patch_size_m,
            preferred_resolution_m=resolution_m,
            preferred_data_type="DSM"
        )
        if patch_result is None or patch_result.data is None:
            print(f"❌ Failed to load patch for {loc['name']}")
            continue
        elevation = patch_result.data
        h, w = elevation.shape
        # Find apex
        apex_idx = np.unravel_index(np.nanargmax(elevation), elevation.shape)
        center_y, center_x = apex_idx
        half_region = region_size_px // 2
        start_y = max(center_y - half_region, 0)
        start_x = max(center_x - half_region, 0)
        end_y = min(start_y + region_size_px, h)
        end_x = min(start_x + region_size_px, w)
        region = elevation[start_y:end_y, start_x:end_x]
        # Compute histogram
        local_range = np.max(region) - np.min(region)
        if local_range < 0.5:
            print("Insufficient variation in patch")
            continue
        local_relative = region - np.min(region)
        local_max_rel = np.max(local_relative)
        if local_max_rel < 0.1:
            print("Insufficient relative variation in patch")
            continue
        local_normalized = local_relative / local_max_rel
        bin_edges = np.linspace(0, 1, 16 + 1)
        local_hist, _ = np.histogram(local_normalized.flatten(), bins=bin_edges, density=True)
        local_hist = local_hist / (np.sum(local_hist) + 1e-8)
        # Cosine similarity
        local_norm = np.linalg.norm(local_hist)
        de_kat_norm = np.linalg.norm(de_kat_hist)
        if local_norm > 1e-8 and de_kat_norm > 1e-8:
            score = np.dot(local_hist, de_kat_hist) / (local_norm * de_kat_norm)
            score = max(0.0, min(1.0, score))
        else:
            score = 0.0
        print(f"[Apex] De Kat fingerprint similarity score for {loc['name']}: {score:.4f}")
        # Optionally plot
        bins = np.arange(16)
        width = 0.4
        plt.figure(figsize=(8, 4))
        plt.bar(bins - width/2, local_hist, width, label=f"{loc['name']} (apex)", alpha=0.7)
        plt.bar(bins + width/2, de_kat_hist, width, label='De Kat Apex', alpha=0.7)
        plt.title(f"Elevation Histogram Comparison\n{loc['name']} vs De Kat Apex\nScore: {score:.4f}")
        plt.xlabel('Normalized Elevation Bin')
        plt.ylabel('Density')
        plt.legend()
        plt.tight_layout()
        plot_path = f"/media/im3/plus/lab4/RE/re_archaeology/simple_histogram_debug_{loc['name'].replace(' ', '_')}_vs_DeKatApex.png"
        plt.savefig(plot_path, dpi=150, bbox_inches='tight')
        plt.close()
        print(f"Histogram comparison plot saved to {plot_path}")

def test_dekat_fingerprint_self_similarity():
    """
    Generate De Kat apex-centered fingerprint and immediately compare it to itself.
    Should yield a similarity score very close to 1.0 if logic is consistent.
    """
    print("=== TEST: De Kat fingerprint self-similarity (apex-centered) ===")
    de_kat_lat = 52.47505310183309
    de_kat_lon = 4.8177388422949585
    profile_path = "/media/im3/plus/lab4/RE/re_archaeology/profiles/dutch_windmill.json"
    # Generate fingerprint
    hist = generate_apex_histogram_fingerprint(
        de_kat_lat, de_kat_lon, radius_m=10.0, bin_count=16, profile_path=profile_path, output_json=False
    )
    if hist is None:
        print("Failed to generate De Kat fingerprint.")
        return
    # Compare to itself
    norm = np.linalg.norm(hist)
    if norm > 1e-8:
        score = np.dot(hist, hist) / (norm * norm)
    else:
        score = 0.0
    print(f"Self-similarity score (should be 1.0): {score:.6f}")
    # Optionally plot
    bins = np.arange(16)
    plt.figure(figsize=(8, 4))
    plt.bar(bins, hist, width=0.7, label='De Kat Apex Histogram', alpha=0.7)
    plt.title(f"De Kat Apex Histogram (Self-comparison)\nScore: {score:.6f}")
    plt.xlabel('Normalized Elevation Bin')
    plt.ylabel('Density')
    plt.legend()
    plt.tight_layout()
    plot_path = "/media/im3/plus/lab4/RE/re_archaeology/dekat_apex_histogram_self.png"
    plt.savefig(plot_path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Self-comparison plot saved to {plot_path}")

def test_dekat_fingerprint_other_sites():
    """
    Generate De Kat apex-centered fingerprint and compare it to all other sites (apex-centered, same logic).
    Prints similarity scores and saves plots for each site.
    """
    print("=== TEST: De Kat fingerprint similarity to all sites (apex-centered) ===")
    de_kat_lat = 52.47505310183309
    de_kat_lon = 4.8177388422949585
    profile_path = "/media/im3/plus/lab4/RE/re_archaeology/profiles/dutch_windmill.json"
    # Generate De Kat fingerprint
    de_kat_hist = generate_apex_histogram_fingerprint(
        de_kat_lat, de_kat_lon, radius_m=10.0, bin_count=16, profile_path=profile_path, output_json=False
    )
    if de_kat_hist is None:
        print("Failed to generate De Kat fingerprint.")
        return
    # Test locations (same as debug_with_dekat_apex_fingerprint)
    test_locations = [
        {"name": "De Kat", "lat": de_kat_lat, "lon": de_kat_lon},
        {"name": "De Zoeker", "lat": 52.47590104112108, "lon": 4.817647238879872},
        {"name": "Het Jonge Schaap", "lat": 52.47621811347626, "lon": 4.816644787814995},
        {"name": "De Bonte Hen", "lat": 52.47793734015221, "lon": 4.813402499137949},
        {"name": "De Huisman", "lat": 52.47323132365517, "lon": 4.816668420518732},
        {"name": "Kinderdijk Windmill Complex", "lat": 51.8820, "lon": 4.6300},
        {"name": "De Gooyer Windmill Amsterdam", "lat": 52.3667, "lon": 4.9270},
        {"name": "Molen de Adriaan Haarlem", "lat": 52.3823, "lon": 4.6308},
        {"name": "Historic Windmill Leiden", "lat": 52.1589, "lon": 4.4937},
        {"name": "Urban Area Amsterdam 1", "lat": 52.483814, "lon": 4.804392},
        {"name": "Urban Area Amsterdam 2", "lat": 52.483185, "lon": 4.810733},
        {"name": "Urban Area Amsterdam 3", "lat": 52.483814, "lon": 4.803359},
        {"name": "Urban Area Amsterdam 4", "lat": 52.483903, "lon": 4.806456},
        {"name": "Some Trees Area", "lat": 52.628085, "lon": 4.762604},
    ]
    profile_path = "/media/im3/plus/lab4/RE/re_archaeology/profiles/dutch_windmill.json"
    manager = DetectorProfileManager(profiles_dir=os.path.dirname(profile_path))
    profile = manager.load_profile(os.path.basename(profile_path))
    patch_size_m = profile.geometry.patch_size_m[0]
    resolution_m = profile.geometry.resolution_m
    region_size_px = int(10.0 * 2 / resolution_m)
    for loc in test_locations:
        print(f"\n=== Checking site: {loc['name']} ===")
        patch_result = LidarMapFactory.get_patch(
            lat=loc["lat"],
            lon=loc["lon"],
            size_m=patch_size_m,
            preferred_resolution_m=resolution_m,
            preferred_data_type="DSM"
        )
        if patch_result is None or patch_result.data is None:
            print(f"❌ Failed to load patch for {loc['name']}")
            continue
        elevation = patch_result.data
        h, w = elevation.shape
        # Find apex
        apex_idx = np.unravel_index(np.nanargmax(elevation), elevation.shape)
        center_y, center_x = apex_idx
        half_region = region_size_px // 2
        start_y = max(center_y - half_region, 0)
        start_x = max(center_x - half_region, 0)
        end_y = min(start_y + region_size_px, h)
        end_x = min(start_x + region_size_px, w)
        region = elevation[start_y:end_y, start_x:end_x]
        # Compute histogram
        local_range = np.max(region) - np.min(region)
        if local_range < 0.5:
            print("Insufficient variation in patch")
            continue
        local_relative = region - np.min(region)
        local_max_rel = np.max(local_relative)
        if local_max_rel < 0.1:
            print("Insufficient relative variation in patch")
            continue
        local_normalized = local_relative / local_max_rel
        bin_edges = np.linspace(0, 1, 16 + 1)
        local_hist, _ = np.histogram(local_normalized.flatten(), bins=bin_edges, density=True)
        local_hist = local_hist / (np.sum(local_hist) + 1e-8)
        # Cosine similarity
        local_norm = np.linalg.norm(local_hist)
        de_kat_norm = np.linalg.norm(de_kat_hist)
        if local_norm > 1e-8 and de_kat_norm > 1e-8:
            score = np.dot(local_hist, de_kat_hist) / (local_norm * de_kat_norm)
            score = max(0.0, min(1.0, score))
        else:
            score = 0.0
        print(f"[Apex] De Kat fingerprint similarity score for {loc['name']}: {score:.4f}")
        # Optionally plot
        bins = np.arange(16)
        width = 0.4
        plt.figure(figsize=(8, 4))
        plt.bar(bins - width/2, local_hist, width, label=f"{loc['name']} (apex)", alpha=0.7)
        plt.bar(bins + width/2, de_kat_hist, width, label='De Kat Apex', alpha=0.7)
        plt.title(f"Elevation Histogram Comparison\n{loc['name']} vs De Kat Apex\nScore: {score:.4f}")
        plt.xlabel('Normalized Elevation Bin')
        plt.ylabel('Density')
        plt.legend()
        plt.tight_layout()
        plot_path = f"/media/im3/plus/lab4/RE/re_archaeology/simple_histogram_debug_{loc['name'].replace(' ', '_')}_vs_DeKatApex.png"
        plt.savefig(plot_path, dpi=150, bbox_inches='tight')
        plt.close()
        print(f"Histogram comparison plot saved to {plot_path}")

def update_profile_with_dekat_fingerprint(profile_path, de_kat_lat, de_kat_lon):
    """
    Generate De Kat apex-centered 15m fingerprint and update the profile in memory and on disk.
    Adds a fingerprint_last_updated ISO timestamp for traceability.
    """
    import datetime
    manager = DetectorProfileManager(profiles_dir=os.path.dirname(profile_path))
    profile = manager.load_profile(os.path.basename(profile_path))
    detection_radius_m = getattr(profile.geometry, 'detection_radius_m', 15.0)
    # Use attribute access for FeatureConfiguration objects
    if 'ElevationHistogram' in profile.features:
        bin_count = getattr(profile.features['ElevationHistogram'].parameters, 'bin_count', 16)
    elif 'histogram' in profile.features:
        bin_count = getattr(profile.features['histogram'].parameters, 'bin_count', 16)
    else:
        bin_count = 16
    fingerprint = generate_apex_histogram_fingerprint(
        de_kat_lat, de_kat_lon, radius_m=detection_radius_m, bin_count=bin_count, profile_path=profile_path, output_json=False
    )
    timestamp = datetime.datetime.now().isoformat()
    if fingerprint is not None:
        # Update in memory
        if 'ElevationHistogram' in profile.features:
            profile.features['ElevationHistogram'].parameters['trained_histogram_fingerprint'] = fingerprint.tolist()
            profile.features['ElevationHistogram'].parameters['fingerprint_last_updated'] = timestamp
        elif 'histogram' in profile.features:
            profile.features['histogram'].parameters['trained_histogram_fingerprint'] = fingerprint.tolist()
            profile.features['histogram'].parameters['fingerprint_last_updated'] = timestamp
        # Save to disk
        with open(profile_path, 'r') as f:
            profile_json = json.load(f)
        if 'features' in profile_json and 'ElevationHistogram' in profile_json['features']:
            profile_json['features']['ElevationHistogram']['parameters']['trained_histogram_fingerprint'] = fingerprint.tolist()
            profile_json['features']['ElevationHistogram']['parameters']['fingerprint_last_updated'] = timestamp
        elif 'features' in profile_json and 'histogram' in profile_json['features']:
            profile_json['features']['histogram']['parameters']['trained_histogram_fingerprint'] = fingerprint.tolist()
            profile_json['features']['histogram']['parameters']['fingerprint_last_updated'] = timestamp
        with open(profile_path, 'w') as f:
            json.dump(profile_json, f, indent=2)
        print(f"Profile fingerprint updated with De Kat apex-centered 15m reference. Timestamp: {timestamp}")
    else:
        print("Failed to generate De Kat fingerprint for profile update.")

# Example usage:
# generate_apex_histogram_fingerprint(52.47505310183309, 4.8177388422949585, radius_m=10.0, bin_count=16, profile_path="/media/im3/plus/lab4/RE/re_archaeology/profiles/dutch_windmill.json")

if __name__ == "__main__":
    debug_elevation_histograms()
    # test_dekat_fingerprint_self_similarity()
    # test_dekat_fingerprint_other_sites()
    # test_dekat_fingerprint_other_sites_with_region_viz()
    # test_dekat_fingerprint_other_sites_with_region_viz_extended()
    # test_dekat_fingerprint_other_sites_with_combined_viz()
