#!/usr/bin/env python3
"""
Lidar analysis for Landívar site (Bolivia):
Generates a plot with a heatmap and two elevation cross-sections (N-S and E-W) through the apex.
"""
import numpy as np
import matplotlib.pyplot as plt
import os
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'kernel')))
from kernel.detector_profile import DetectorProfileManager
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'lidar_factory')))
from lidar_factory.factory import LidarMapFactory

# List of sites to analyze
sites = [
    # Move Cotoca 200m north and 200m east
    (
        -14.9898697 + 500 / 111320.0, 
        -64.5955503 + 300 / (111320.0 * np.cos(np.radians(-14.9898697))),
        "Cotoca (shifted)"
    ),
    (-15.2012842, -64.4677797, "Landívar"),    # Bolivia
]

# Landívar coordinates
landivar_lat = -15.2012842
landivar_lon = -64.4677797
site_name = "Landívar"

# Use a grid of smaller patches to cover a large area
full_size_m = 1600.0  # 1km in each direction (total 2km x 2km)
patch_size_m = 200.0  # Each patch is 200m
resolution_m = 1.6   # Use a safe resolution for SRTMGL1_003
num_patches = int(full_size_m // patch_size_m)

half_grid = num_patches // 2

for site_lat, site_lon, site_name in sites:
    lat_per_m = 1 / 111320.0  # Approximate degrees latitude per meter
    lon_per_m = 1 / (111320.0 * np.cos(np.radians(site_lat)))
    half_grid = num_patches // 2
    lat_centers = [site_lat + (half_grid - i) * patch_size_m * lat_per_m for i in range(num_patches)]
    lon_centers = [site_lon + (j - half_grid) * patch_size_m * lon_per_m for j in range(num_patches)]

    # Collect patches and their shapes
    patches = [[None for _ in range(num_patches)] for _ in range(num_patches)]
    heights = np.zeros((num_patches, num_patches), dtype=int)
    widths = np.zeros((num_patches, num_patches), dtype=int)

    for i, lat in enumerate(lat_centers):
        for j, lon in enumerate(lon_centers):
            tile = LidarMapFactory.get_patch(
                lat=lat,
                lon=lon,
                size_m=patch_size_m,
                preferred_resolution_m=resolution_m,
                preferred_data_type="DSM"
            )
            if tile is None or tile.data is None:
                print(f"Warning: Missing patch at ({lat:.5f}, {lon:.5f}) for {site_name}")
                continue
            patch = tile.data
            patches[i][j] = patch
            heights[i, j] = patch.shape[0]
            widths[i, j] = patch.shape[1]

    # Find max height for each row and max width for each column
    row_heights = [max(heights[i, :]) for i in range(num_patches)]
    col_widths = [max(widths[:, j]) for j in range(num_patches)]

    # Pad patches to uniform size in their row/column
    for i in range(num_patches):
        for j in range(num_patches):
            patch = patches[i][j]
            if patch is None:
                patches[i][j] = np.full((row_heights[i], col_widths[j]), np.nan)
            else:
                h, w = patch.shape
                pad_h = row_heights[i] - h
                pad_w = col_widths[j] - w
                patches[i][j] = np.pad(patch, ((0, pad_h), (0, pad_w)), mode='constant', constant_values=np.nan)

    # Concatenate patches to form the elevation grid
    elevation_grid = np.block(patches)

    # Normalize the grid to a common baseline (subtract global min, ignore NaNs)
    global_min = np.nanmin(elevation_grid)
    elevation_grid = elevation_grid - global_min

    # Use the stitched elevation_grid for analysis
    elevation = elevation_grid
    h, w = elevation.shape

    # Find apex (max elevation, ignoring NaNs)
    if np.all(np.isnan(elevation)):
        print(f"❌ Failed to load any data for {site_name}")
        continue
    apex_idx = np.unravel_index(np.nanargmax(elevation), elevation.shape)
    center_y, center_x = apex_idx

    # Extract N-S and E-W cross-sections
    ns_section = elevation[:, center_x]
    ew_section = elevation[center_y, :]

    # Plot
    fig, axes = plt.subplots(3, 1, figsize=(10, 14), gridspec_kw={'height_ratios': [3, 1, 1]})

    # 1. Heatmap with cross-section lines
    ax = axes[0]
    im = ax.imshow(elevation, cmap='terrain', origin='upper',
                   extent=[-w//2*resolution_m, w//2*resolution_m, h//2*resolution_m, -h//2*resolution_m])
    ax.axhline((center_y - h//2)*resolution_m, color='red', linestyle='--', label='E-W cross-section')
    ax.axvline((center_x - w//2)*resolution_m, color='blue', linestyle='--', label='N-S cross-section')
    ax.plot((center_x - w//2)*resolution_m, (center_y - h//2)*resolution_m, 'ko', label='Apex')
    ax.set_title(f"{site_name} Elevation Heatmap with Cross-Sections")
    ax.set_xlabel("Easting (m) from center\n(West ⟵ 0 ⟶ East)")
    ax.set_ylabel("Northing (m) from center\n(North ⟶ 0 ⟶ South)")
    # Optionally, add text annotations for corners
    ax.text(-w//2*resolution_m, h//2*resolution_m, 'NW', va='top', ha='left', fontsize=10, color='black', alpha=0.7)
    ax.text(w//2*resolution_m, h//2*resolution_m, 'NE', va='top', ha='right', fontsize=10, color='black', alpha=0.7)
    ax.text(-w//2*resolution_m, -h//2*resolution_m, 'SW', va='bottom', ha='left', fontsize=10, color='black', alpha=0.7)
    ax.text(w//2*resolution_m, -h//2*resolution_m, 'SE', va='bottom', ha='right', fontsize=10, color='black', alpha=0.7)
    fig.colorbar(im, ax=ax, label='Elevation (m)')
    ax.legend()

    # Set axis ticks in meters (every 100m or 200m)
    xticks = np.arange(-w//2*resolution_m, w//2*resolution_m+1, 200)
    yticks = np.arange(h//2*resolution_m, -h//2*resolution_m-1, -200)
    ax.set_xticks(xticks)
    ax.set_yticks(yticks)
    ax.set_xticklabels([f"{int(x)}" for x in xticks])
    ax.set_yticklabels([f"{int(y)}" for y in yticks])

    # Add a 200m scale bar at the bottom right
    scalebar_length = 200  # meters
    scalebar_x = w//2*resolution_m - 220  # 20m from right edge
    scalebar_y = -h//2*resolution_m + 30  # 30m from bottom
    ax.plot([scalebar_x, scalebar_x + scalebar_length], [scalebar_y, scalebar_y], 'k-', lw=3)
    ax.text(scalebar_x + scalebar_length/2, scalebar_y + 15, '200 m', ha='center', va='bottom', fontsize=10, color='black')

    # 2. N-S cross-section
    axes[1].plot(np.arange(h) * resolution_m - (h//2)*resolution_m, ns_section, label='N-S cross-section', color='blue')
    axes[1].set_ylabel("Elevation (m)")
    axes[1].set_title("N-S Elevation Cross-Section through Apex")
    axes[1].legend()

    # 3. E-W cross-section
    axes[2].plot(np.arange(w) * resolution_m - (w//2)*resolution_m, ew_section, label='E-W cross-section', color='red')
    axes[2].set_xlabel("Distance (m) from apex")
    axes[2].set_ylabel("Elevation (m)")
    axes[2].set_title("E-W Elevation Cross-Section through Apex")
    axes[2].legend()

    plt.tight_layout()
    output_path = f"/media/im3/plus/lab4/RE/re_archaeology/{site_name.lower()}_lidar.jpg"
    plt.savefig(output_path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Saved heatmap and cross-section plot to {output_path}")
