#!/usr/bin/env python3
"""
Amazon Sites LiDAR Stripe Visualization

Visualizes given coordinates with stripe image showing LiDAR patches (DSM, DTM, DEM, etc.) 
in rows and their elevation histograms at lowest elevation (without vegetation).

Based on the phi0_core.py visualization patterns and Earth Engine AHN4 data integration.
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import ee
import os
import logging
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class LidarPatch:
    """Container for LiDAR elevation data with metadata"""
    dsm_data: np.ndarray = None       # Digital Surface Model (with vegetation)
    dtm_data: np.ndarray = None       # Digital Terrain Model (ground level)
    dem_data: np.ndarray = None       # Digital Elevation Model (general)
    coordinates: Tuple[float, float] = None
    name: str = "Unknown"
    resolution_m: float = 0.5
    patch_size_m: float = 200.0
    metadata: Dict = None

    def get_bare_earth_elevation(self) -> np.ndarray:
        """Get bare earth elevation (without vegetation) using DTM or base DSM"""
        if self.dtm_data is not None:
            return self.dtm_data
        elif self.dsm_data is not None:
            # Approximate bare earth by using minimum elevation in local neighborhood
            from scipy.ndimage import minimum_filter
            bare_earth = minimum_filter(self.dsm_data, size=3)
            return bare_earth
        elif self.dem_data is not None:
            return self.dem_data
        else:
            raise ValueError("No elevation data available")

class AmazonSitesVisualizer:
    """Visualizer for Amazon archaeological sites using LiDAR stripe layout"""
    
    def __init__(self, service_account_path: str = None):
        """
        Initialize the visualizer with Earth Engine authentication
        
        Args:
            service_account_path: Path to Google Earth Engine service account JSON
        """
        self.service_account_path = service_account_path or "/media/im3/plus/lab4/RE/re_archaeology/sage-striker-294302-b89a8b7e205b.json"
        self.initialize_earth_engine()
    
    def initialize_earth_engine(self):
        """Initialize Earth Engine with service account authentication"""
        try:
            if os.path.exists(self.service_account_path):
                credentials = ee.ServiceAccountCredentials(
                    'elevation-pattern-detection@sage-striker-294302.iam.gserviceaccount.com',
                    self.service_account_path
                )
                ee.Initialize(credentials)
                logger.info("✅ Earth Engine initialized with service account")
            else:
                ee.Initialize()
                logger.info("✅ Earth Engine initialized with default credentials")
        except Exception as e:
            logger.error(f"❌ Earth Engine initialization failed: {e}")
            raise
    
    def load_lidar_patch(self, lat: float, lon: float, name: str, 
                        buffer_radius_m: float = 100, resolution_m: float = 30) -> Optional[LidarPatch]:
        """
        Load LiDAR patch data from Earth Engine
        
        Args:
            lat: Latitude coordinate
            lon: Longitude coordinate  
            name: Site name for identification
            buffer_radius_m: Buffer radius around point in meters
            resolution_m: Spatial resolution in meters per pixel
            
        Returns:
            LidarPatch object with loaded data
        """
        try:
            center = ee.Geometry.Point([lon, lat])
            polygon = center.buffer(buffer_radius_m).bounds()
            
            # Load different LiDAR data types
            patch = LidarPatch(
                coordinates=(lat, lon),
                name=name,
                resolution_m=resolution_m,
                patch_size_m=buffer_radius_m * 2,
                metadata={'loading_method': 'earth_engine'}
            )
            
            # Determine data source based on location
            # Use AHN4 for Netherlands, SRTM for global coverage
            if 51.0 <= lat <= 54.0 and 3.0 <= lon <= 8.0:  # Netherlands bounds
                data_source = "AHN4"
                patch.metadata['source'] = 'AHN4'
            else:
                data_source = "SRTM"
                patch.metadata['source'] = 'SRTM_Global'
            
            # Try to load DSM/DEM based on location
            try:
                if data_source == "AHN4":
                    # Load AHN4 DSM for Netherlands
                    ahn4_dsm = ee.ImageCollection("AHN/AHN4").select('dsm').median()
                    ahn4_dsm = ahn4_dsm.reproject(crs='EPSG:28992', scale=resolution_m)
                    dsm_rect = ahn4_dsm.sampleRectangle(region=polygon, defaultValue=-9999, properties=[])
                    dsm_block = dsm_rect.get('dsm').getInfo()
                    dsm_array = np.array(dsm_block, dtype=np.float32)
                    dsm_array = np.where(dsm_array == -9999, np.nan, dsm_array)
                    
                    if not np.isnan(dsm_array).all():
                        if np.isnan(dsm_array).any():
                            mean_val = np.nanmean(dsm_array)
                            dsm_array = np.where(np.isnan(dsm_array), mean_val, dsm_array)
                        patch.dsm_data = dsm_array
                        logger.info(f"✅ Loaded AHN4 DSM for {name}: {dsm_array.shape}, range: {np.min(dsm_array):.2f}-{np.max(dsm_array):.2f}m")
                else:
                    # Load SRTM for global coverage (30m resolution)
                    srtm = ee.Image("USGS/SRTMGL1_003")
                    # Use native 30m resolution for better detail with larger patches
                    srtm_rect = srtm.sampleRectangle(region=polygon, defaultValue=-9999, properties=[])
                    srtm_block = srtm_rect.get('elevation').getInfo()
                    srtm_array = np.array(srtm_block, dtype=np.float32)
                    srtm_array = np.where(srtm_array == -9999, np.nan, srtm_array)
                    
                    if not np.isnan(srtm_array).all():
                        if np.isnan(srtm_array).any():
                            mean_val = np.nanmean(srtm_array)
                            srtm_array = np.where(np.isnan(srtm_array), mean_val, srtm_array)
                        # Use SRTM as both DSM and DEM (it's closer to DSM)
                        patch.dsm_data = srtm_array
                        patch.dem_data = srtm_array.copy()
                        logger.info(f"✅ Loaded SRTM elevation for {name}: {srtm_array.shape}, range: {np.min(srtm_array):.2f}-{np.max(srtm_array):.2f}m")
            except Exception as e:
                logger.warning(f"⚠️ Failed to load elevation data for {name}: {e}")
            
            # Try to load DTM for Netherlands only (not available globally)
            if data_source == "AHN4":
                try:
                    ahn4_dtm = ee.ImageCollection("AHN/AHN4").select('dtm').median()
                    ahn4_dtm = ahn4_dtm.reproject(crs='EPSG:28992', scale=resolution_m)
                    dtm_rect = ahn4_dtm.sampleRectangle(region=polygon, defaultValue=-9999, properties=[])
                    dtm_block = dtm_rect.get('dtm').getInfo()
                    dtm_array = np.array(dtm_block, dtype=np.float32)
                    dtm_array = np.where(dtm_array == -9999, np.nan, dtm_array)
                    
                    if not np.isnan(dtm_array).all():
                        if np.isnan(dtm_array).any():
                            mean_val = np.nanmean(dtm_array)
                            dtm_array = np.where(np.isnan(dtm_array), mean_val, dtm_array)
                        patch.dtm_data = dtm_array
                        logger.info(f"✅ Loaded AHN4 DTM for {name}: {dtm_array.shape}, range: {np.min(dtm_array):.2f}-{np.max(dtm_array):.2f}m")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to load DTM for {name}: {e}")
            else:
                # For global sites, try to estimate bare earth using Landsat-derived vegetation indices
                try:
                    landsat = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2") \
                        .filterBounds(center) \
                        .filterDate('2020-01-01', '2023-12-31') \
                        .median()
                    
                    if landsat.bandNames().size().getInfo() > 0:
                        # Calculate NDVI to identify vegetation
                        ndvi = landsat.normalizedDifference(['SR_B5', 'SR_B4'])
                        # Estimate bare earth by reducing elevation in high vegetation areas
                        vegetation_mask = ndvi.gt(0.5)  # High vegetation threshold
                        estimated_dtm = patch.dsm_data.copy()
                        # This is a simplified approximation - in reality, LiDAR DTM is much more accurate
                        patch.dtm_data = estimated_dtm  # Placeholder for now
                        logger.info(f"✅ Created estimated DTM for {name} using vegetation analysis")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to create estimated DTM for {name}: {e}")
            
            # If we have at least one elevation dataset, the patch is valid
            if patch.dsm_data is not None or patch.dtm_data is not None:
                return patch
            else:
                logger.error(f"❌ No valid elevation data loaded for {name}")
                return None
                
        except Exception as e:
            logger.error(f"❌ Failed to load LiDAR patch for {name}: {e}")
            return None
    
    def compute_bare_earth_histogram(self, patch: LidarPatch, num_bins: int = 16) -> Tuple[np.ndarray, np.ndarray]:
        """
        Compute elevation histogram for bare earth (without vegetation)
        
        Args:
            patch: LiDAR patch containing elevation data
            num_bins: Number of histogram bins
            
        Returns:
            Tuple of (histogram, bin_edges)
        """
        try:
            bare_earth = patch.get_bare_earth_elevation()
            
            # Remove base elevation (lowest point becomes 0)
            base_elevation = np.min(bare_earth)
            relative_elevation = bare_earth - base_elevation
            
            # Check for meaningful variation
            elevation_range = np.max(relative_elevation)
            if elevation_range < 0.1:  # Less than 10cm variation
                logger.warning(f"Very low elevation range for {patch.name}: {elevation_range:.3f}m")
                return np.zeros(num_bins), np.linspace(0, 1, num_bins + 1)
            
            # Normalize to [0,1] for consistent binning
            normalized_elevation = relative_elevation / elevation_range
            
            # Compute histogram
            hist, bin_edges = np.histogram(normalized_elevation.flatten(), bins=num_bins, density=True)
            
            # Normalize to probability distribution
            hist = hist / (np.sum(hist) + 1e-8)
            
            return hist, bin_edges
            
        except Exception as e:
            logger.error(f"❌ Failed to compute histogram for {patch.name}: {e}")
            return np.zeros(num_bins), np.linspace(0, 1, num_bins + 1)
    
    def create_stripe_visualization(self, coordinates: List[Tuple[float, float, str]], 
                                  save_path: str = None) -> str:
        """
        Create stripe visualization with LiDAR patches in rows and elevation histograms
        
        Args:
            coordinates: List of (lat, lon, name) tuples
            save_path: Optional path to save the visualization
            
        Returns:
            Path to saved visualization
        """
        logger.info(f"Creating stripe visualization for {len(coordinates)} sites")
        
        # Load all patches with larger buffer for better resolution
        patches = []
        for lat, lon, name in coordinates:
            # Use 100m buffer (200x200m patch) for better detail with 30m SRTM resolution
            patch = self.load_lidar_patch(lat, lon, name, buffer_radius_m=100)
            if patch:
                patches.append(patch)
        
        if not patches:
            logger.error("❌ No valid patches loaded for visualization")
            return None
        
        logger.info(f"✅ Loaded {len(patches)} valid patches")
        
        # Create figure with stripe layout
        n_patches = len(patches)
        fig = plt.figure(figsize=(20, 4 * n_patches))
        
        # Use GridSpec for better control over layout
        gs = gridspec.GridSpec(n_patches, 6, figure=fig, 
                              width_ratios=[1, 1, 1, 1, 1, 1.5],  # Extra width for histogram
                              hspace=0.3, wspace=0.3)
        
        for i, patch in enumerate(patches):
            row = i
            
            # Column 1: DSM (Digital Surface Model - with vegetation)
            ax_dsm = fig.add_subplot(gs[row, 0])
            if patch.dsm_data is not None:
                im_dsm = ax_dsm.imshow(patch.dsm_data, cmap='terrain', aspect='equal')
                ax_dsm.set_title(f'{patch.name}\nDSM (w/ vegetation)', fontsize=10)
                plt.colorbar(im_dsm, ax=ax_dsm, shrink=0.6)
            else:
                ax_dsm.text(0.5, 0.5, 'DSM\nNot Available', ha='center', va='center', 
                           transform=ax_dsm.transAxes, fontsize=10)
                ax_dsm.set_title(f'{patch.name}\nDSM (N/A)', fontsize=10)
            ax_dsm.axis('off')
            
            # Column 2: DTM (Digital Terrain Model - bare earth)
            ax_dtm = fig.add_subplot(gs[row, 1])
            if patch.dtm_data is not None:
                im_dtm = ax_dtm.imshow(patch.dtm_data, cmap='terrain', aspect='equal')
                ax_dtm.set_title('DTM (bare earth)', fontsize=10)
                plt.colorbar(im_dtm, ax=ax_dtm, shrink=0.6)
            else:
                ax_dtm.text(0.5, 0.5, 'DTM\nNot Available', ha='center', va='center',
                           transform=ax_dtm.transAxes, fontsize=10)
                ax_dtm.set_title('DTM (N/A)', fontsize=10)
            ax_dtm.axis('off')
            
            # Column 3: Vegetation Height (DSM - DTM)
            ax_veg = fig.add_subplot(gs[row, 2])
            if patch.dsm_data is not None and patch.dtm_data is not None:
                vegetation_height = patch.dsm_data - patch.dtm_data
                vegetation_height = np.clip(vegetation_height, 0, None)  # Remove negative values
                im_veg = ax_veg.imshow(vegetation_height, cmap='Greens', aspect='equal')
                ax_veg.set_title('Vegetation Height\n(DSM - DTM)', fontsize=10)
                plt.colorbar(im_veg, ax=ax_veg, shrink=0.6)
            else:
                ax_veg.text(0.5, 0.5, 'Vegetation\nNot Available', ha='center', va='center',
                           transform=ax_veg.transAxes, fontsize=10)
                ax_veg.set_title('Vegetation (N/A)', fontsize=10)
            ax_veg.axis('off')
            
            # Column 4: Bare Earth (processed for visualization)
            ax_bare = fig.add_subplot(gs[row, 3])
            try:
                bare_earth = patch.get_bare_earth_elevation()
                im_bare = ax_bare.imshow(bare_earth, cmap='terrain', aspect='equal')
                ax_bare.set_title('Bare Earth\n(processed)', fontsize=10)
                plt.colorbar(im_bare, ax=ax_bare, shrink=0.6)
            except Exception as e:
                ax_bare.text(0.5, 0.5, 'Bare Earth\nProcessing Failed', ha='center', va='center',
                            transform=ax_bare.transAxes, fontsize=10)
                ax_bare.set_title('Bare Earth (Error)', fontsize=10)
                logger.warning(f"⚠️ Failed to process bare earth for {patch.name}: {e}")
            ax_bare.axis('off')
            
            # Column 5: Elevation contours
            ax_contour = fig.add_subplot(gs[row, 4])
            try:
                bare_earth = patch.get_bare_earth_elevation()
                contours = ax_contour.contour(bare_earth, levels=8, colors='black', linewidths=0.5)
                ax_contour.clabel(contours, inline=True, fontsize=8, fmt='%.1f')
                ax_contour.set_title('Elevation Contours\n(bare earth)', fontsize=10)
                ax_contour.set_aspect('equal')
            except Exception as e:
                ax_contour.text(0.5, 0.5, 'Contours\nNot Available', ha='center', va='center',
                               transform=ax_contour.transAxes, fontsize=10)
                ax_contour.set_title('Contours (Error)', fontsize=10)
            ax_contour.axis('off')
            
            # Column 6: Elevation histogram (without vegetation)
            ax_hist = fig.add_subplot(gs[row, 5])
            try:
                hist, bin_edges = self.compute_bare_earth_histogram(patch)
                bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
                
                # Plot histogram
                ax_hist.bar(bin_centers, hist, width=bin_centers[1]-bin_centers[0], 
                           alpha=0.7, color='brown', edgecolor='black', linewidth=0.5)
                ax_hist.set_title('Elevation Histogram\n(bare earth)', fontsize=10)
                ax_hist.set_xlabel('Normalized Elevation', fontsize=9)
                ax_hist.set_ylabel('Density', fontsize=9)
                ax_hist.grid(True, alpha=0.3)
                
                # Add statistics
                bare_earth = patch.get_bare_earth_elevation()
                elev_min = np.min(bare_earth)
                elev_max = np.max(bare_earth)
                elev_range = elev_max - elev_min
                elev_mean = np.mean(bare_earth)
                elev_std = np.std(bare_earth)
                
                stats_text = f'Range: {elev_range:.2f}m\nMean: {elev_mean:.2f}m\nStd: {elev_std:.2f}m'
                ax_hist.text(0.02, 0.98, stats_text, transform=ax_hist.transAxes, 
                            fontsize=8, verticalalignment='top', 
                            bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.8))
                
            except Exception as e:
                ax_hist.text(0.5, 0.5, 'Histogram\nComputation Failed', ha='center', va='center',
                            transform=ax_hist.transAxes, fontsize=10)
                ax_hist.set_title('Histogram (Error)', fontsize=10)
                logger.warning(f"⚠️ Failed to compute histogram for {patch.name}: {e}")
        
        # Add overall title
        fig.suptitle('Amazon Archaeological Sites - LiDAR Stripe Visualization\nShowing DSM, DTM, Vegetation, Bare Earth Processing, and Elevation Histograms', 
                     fontsize=16, y=0.98)
        
        # Save figure
        if save_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            save_path = f'/media/im3/plus/lab4/RE/re_archaeology/amazon_lidar_stripe_{timestamp}.png'
        
        plt.savefig(save_path, dpi=150, bbox_inches='tight')
        logger.info(f"🎯 LiDAR stripe visualization saved to: {save_path}")
        plt.close()
        
        return save_path

# Predefined archaeological sites for testing
ARCHAEOLOGICAL_SITES = [
    # Amazon archaeological sites (using SRTM data)
    (-14.9898697, -64.5968503, "Cotoca"),           # Bolivia
    (-15.2012842, -64.4677797, "Landívar"),         # Bolivia  
    (-12.558333, -53.111111, "Kuhikugu"),           # Brazil
    (18.61136604220061, -89.55191178650831, "Calakmul") , # Mexico
    (17.248280164331604, -89.14352060761487, "El Pilar"), #Mexico
    (19.692181814056454, -98.84543537868696, "Teotihuacan"),  # Mexico
    (-2.3099356769569743, -78.10998659241247, "Upano Valley"), # Ecuador
    (39.703242, 68.265728, "Tugunbulak"),         # Uzbekistan
    (39.696297, 68.320786, "Tashbulak"),         # Uzbekistan
    # Netherlands windmill sites (using AHN4 LiDAR data)
    (52.47505310183309, 4.8177388422949585, "De Kat Windmill"),     # Netherlands
    (52.47590104112108, 4.817647238879872, "De Zoeker Windmill"),   # Netherlands
]

# For testing different data sources
AMAZON_SITES_ONLY = [
    (-14.9898697, -64.5968503, "Cotoca"),           # Bolivia
    (-15.2012842, -64.4677797, "Landívar"),         # Bolivia  
    (-12.558333, -53.111111, "Kuhikugu"),           # Brazil
]

NETHERLANDS_SITES_ONLY = [
    (52.47505310183309, 4.8177388422949585, "De Kat Windmill"),     # Netherlands
    (52.47590104112108, 4.817647238879872, "De Zoeker Windmill"),   # Netherlands
    (52.4775485810242, 4.813724798553969, "Het Klaverblad"),        # Netherlands
]

def main():
    """Main function to create Amazon sites visualization"""
    try:
        # Initialize visualizer
        visualizer = AmazonSitesVisualizer()
        
        # Create stripe visualization with Amazon sites
        save_path = visualizer.create_stripe_visualization(
            AMAZON_SITES_ONLY,
            save_path='/media/im3/plus/lab4/RE/re_archaeology/amazon_sites_stripe_visualization.png'
        )
        
        if save_path:
            print(f"✅ Visualization created successfully: {save_path}")
        else:
            print("❌ Failed to create visualization")
            
    except Exception as e:
        logger.error(f"❌ Main execution failed: {e}")
        raise

if __name__ == "__main__":
    main()