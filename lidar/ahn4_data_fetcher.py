#!/usr/bin/env python3
"""
AHN4 Data Fetcher for Dutch Windmill Validation
Fetches real AHN4 (Actueel Hoogtebestand Nederland) elevation data from Google Earth Engine
"""

import ee
import numpy as np
import logging
from typing import Tuple, Optional, Dict, Any
from pathlib import Path
import json
import time

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AHN4DataFetcher:
    """Fetch AHN4 elevation data from Google Earth Engine"""
    
    def __init__(self):
        """Initialize Earth Engine connection"""
        self.ee_initialized = False
        self.initialize_earth_engine()
    
    def initialize_earth_engine(self):
        """Initialize Google Earth Engine"""
        try:
            # Try to initialize Earth Engine
            ee.Initialize()
            self.ee_initialized = True
            logger.info("✅ Earth Engine initialized successfully")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Earth Engine: {e}")
            logger.info("Please run: earthengine authenticate")
            self.ee_initialized = False
    
    def get_ahn4_data(self, lat: float, lon: float, size_m: int = 128, resolution_m: float = 0.5) -> Optional[np.ndarray]:
        """
        Fetch real AHN4 LiDAR data from Google Earth Engine
        
        Args:
            lat: Latitude (WGS84)
            lon: Longitude (WGS84)
            size_m: Size of the area in meters (default 128m for windmill detection)
            resolution_m: Resolution in meters (default 0.5m)
            
        Returns:
            numpy.ndarray: Elevation data in meters, or None if failed
        """
        if not self.ee_initialized:
            logger.error("Earth Engine not initialized")
            return None
        
        try:
            logger.info(f"Fetching AHN4 data for {lat:.4f}, {lon:.4f} ({size_m}m x {size_m}m)")
            
            # Create geometry - using the working implementation from histogram_check.py
            buffer_radius_m = size_m / 2
            center = ee.Geometry.Point([lon, lat])
            polygon = center.buffer(buffer_radius_m).bounds()
            
            # Get AHN4 DSM data - this is the correct dataset
            ahn4_dsm = ee.ImageCollection("AHN/AHN4").select('dsm').median()
            ahn4_dsm = ahn4_dsm.reproject(crs='EPSG:28992', scale=resolution_m)
            
            # Sample the rectangle
            rect = ahn4_dsm.sampleRectangle(region=polygon, defaultValue=-9999, properties=[])
            elev_block = rect.get('dsm').getInfo()
            
            # Convert to numpy array
            elevation_array = np.array(elev_block, dtype=np.float32)
            elevation_array = np.where(elevation_array == -9999, np.nan, elevation_array)
            
            if np.isnan(elevation_array).all():
                logger.error(f"No valid AHN4 data for location {lat:.4f}, {lon:.4f}")
                return None
            
            # Fill NaN values with mean
            if np.isnan(elevation_array).any():
                mean_val = np.nanmean(elevation_array)
                elevation_array = np.where(np.isnan(elevation_array), mean_val, elevation_array)
            
            logger.info(f"✅ Successfully fetched AHN4 data: shape {elevation_array.shape}, range {np.min(elevation_array):.2f}-{np.max(elevation_array):.2f}m")
            return elevation_array
            
        except Exception as e:
            logger.error(f"Error fetching AHN4 data: {e}")
            return None
        """
        Fetch AHN4 elevation data for a specific location
        
        Args:
            lat: Latitude (WGS84)
            lon: Longitude (WGS84)
            size_m: Size of the area in meters (default 2048m = 2.048km)
            resolution_m: Resolution in meters (default 0.5m)
            
        Returns:
            numpy.ndarray: Elevation data in meters, or None if failed
        """
        if not self.ee_initialized:
            logger.error("Earth Engine not initialized")
            return None
        
        try:
            # Create a point geometry
            point = ee.Geometry.Point([lon, lat])
            
            # Create a buffer around the point (size_m/2 radius)
            area = point.buffer(size_m / 2)
            
            # Try to access AHN4 data
            # Note: AHN4 might not be directly available in GEE public catalog
            # We'll try multiple elevation datasets available for Netherlands
            
            elevation_data = None
            
            # Option 1: Try USGS/SRTMGL1_003 (most reliable)
            try:
                srtm = ee.Image("USGS/SRTMGL1_003")
                elevation_data = srtm.select('elevation').clip(area)
                logger.info("Using SRTM elevation data (30m resolution)")
            except Exception as e:
                logger.warning(f"SRTM failed: {e}")
                pass
            
            # Option 2: Try Copernicus DEM (if SRTM fails)
            if elevation_data is None:
                try:
                    # Use ImageCollection for Copernicus DEM
                    copernicus = ee.ImageCollection("COPERNICUS/DEM/GLO30").mosaic()
                    elevation_data = copernicus.select('DEM').clip(area)
                    logger.info("Using Copernicus DEM GLO30 (30m resolution)")
                except Exception as e:
                    logger.warning(f"Copernicus DEM failed: {e}")
                    pass
            
            # Option 3: Try ALOS DEM as final fallback
            if elevation_data is None:
                try:
                    alos = ee.Image("JAXA/ALOS/AW3D30/V3_2")
                    elevation_data = alos.select('DSM').clip(area)
                    logger.info("Using ALOS World 3D DEM (30m resolution)")
                except Exception as e:
                    logger.warning(f"ALOS DEM failed: {e}")
                    pass
            
            if elevation_data is None:
                logger.error("No elevation data available for this location")
                return None
            
            # Calculate the number of pixels needed
            pixels = int(size_m / resolution_m)
            
            # Get the data
            logger.info(f"Fetching elevation data for {lat:.4f}, {lon:.4f} ({size_m}m x {size_m}m)")
            
            # Download the data
            data = elevation_data.getDownloadURL({
                'region': area,
                'scale': resolution_m,
                'crs': 'EPSG:4326',
                'format': 'GEO_TIFF'
            })
            
            # For now, we'll use a simpler approach with sample data
            # In a full implementation, you'd download and process the GeoTIFF
            
            # Sample the elevation data at regular intervals
            sample_data = elevation_data.sample(**{
                'region': area,
                'scale': resolution_m,
                'numPixels': pixels * pixels,
                'geometries': True
            }).getInfo()
            
            if not sample_data or 'features' not in sample_data:
                logger.error("No sample data returned")
                return None
            
            # Convert sampled data to numpy array
            features = sample_data['features']
            
            if len(features) == 0:
                logger.error("No elevation features found")
                return None
            
            # Create a grid and interpolate
            elevation_values = []
            coordinates = []
            
            for feature in features:
                props = feature['properties']
                geom = feature['geometry']['coordinates']
                
                # Get elevation value (property name varies by dataset)
                elevation = None
                for prop_name in ['DEM', 'elevation', 'DSM']:
                    if prop_name in props and props[prop_name] is not None:
                        elevation = props[prop_name]
                        break
                
                if elevation is not None:
                    elevation_values.append(elevation)
                    coordinates.append(geom)
            
            if len(elevation_values) == 0:
                logger.error("No valid elevation values found")
                return None
            
            logger.info(f"Successfully fetched {len(elevation_values)} elevation points")
            logger.info(f"Elevation range: {min(elevation_values):.1f}m to {max(elevation_values):.1f}m")
            
            # For simplicity, create a synthetic array based on the real elevation data
            # In a full implementation, you'd properly interpolate the sampled data
            mean_elevation = np.mean(elevation_values)
            elevation_range = max(elevation_values) - min(elevation_values)
            
            # Create a realistic elevation array
            elevation_array = np.full((pixels, pixels), mean_elevation, dtype=np.float32)
            
            # Add some realistic variation based on actual data
            noise = np.random.normal(0, elevation_range * 0.1, (pixels, pixels))
            elevation_array += noise
            
            return elevation_array
            
        except Exception as e:
            logger.error(f"Error fetching AHN4 data: {e}")
            return None
    
    def get_dutch_windmill_locations(self) -> list:
        """
        Get known Dutch windmill locations for validation
        These are real historical windmill sites in the Netherlands with precise coordinates
        """
        return [
            # Zaanse Schans windmills - precise coordinates from historical records
            {
                'name': 'De_Kat',
                'lat': 52.47505310183309,
                'lon': 4.8177388422949585,
                'expected_structures': 1,
                'site_type': 'positive',
                'description': 'Historic windmill De Kat at Zaanse Schans'
            },
            {
                'name': 'De_Zoeker', 
                'lat': 52.47590104112108,
                'lon': 4.817647238879872,
                'expected_structures': 1,
                'site_type': 'positive',
                'description': 'Historic windmill De Zoeker at Zaanse Schans'
            },
            {
                'name': 'Het_Jonge_Schaap',
                'lat': 52.47621811347626,
                'lon': 4.816644787814995,
                'expected_structures': 1,
                'site_type': 'positive',
                'description': 'Historic windmill Het Jonge Schaap at Zaanse Schans'
            },
            {
                'name': 'De_Bonte_Hen',
                'lat': 52.47793734015221,
                'lon': 4.813402499137949,
                'expected_structures': 1,
                'site_type': 'positive',
                'description': 'Historic windmill De Bonte Hen at Zaanse Schans'
            },
            {
                'name': 'De_Gekroonde_Poelenburg',
                'lat': 52.474166977199445,
                'lon': 4.817628676751737,
                'expected_structures': 1,
                'site_type': 'positive',
                'description': 'Historic windmill De Gekroonde Poelenburg at Zaanse Schans'
            },
            {
                'name': 'De_Huisman',
                'lat': 52.47323132365517,
                'lon': 4.816668420518732,
                'expected_structures': 1,
                'site_type': 'positive',
                'description': 'Historic windmill De Huisman at Zaanse Schans'
            },
            # Negative sites (no windmills) - keeping some from original for comparison
            {
                'name': 'Some_Trees_Area',
                'lat': 52.628085,
                'lon': 4.762604,
                'expected_structures': 0,
                'site_type': 'negative',
                'description': 'Tree area without windmill structures'
            },
            {
                'name': 'Dutch_Farmland',
                'lat': 52.2593,
                'lon': 5.2714,
                'expected_structures': 0,
                'site_type': 'negative',
                'description': 'Rural farmland without windmills'
            }
        ]

def test_ahn4_fetcher():
    """Test the AHN4 data fetcher"""
    fetcher = AHN4DataFetcher()
    
    if not fetcher.ee_initialized:
        print("Earth Engine not available - run 'earthengine authenticate' first")
        return
    
    # Test with Zaanse Schans location
    test_lat, test_lon = 52.4746, 4.8163
    print(f"Testing AHN4 data fetch at Zaanse Schans: {test_lat}, {test_lon}")
    
    elevation_data = fetcher.get_ahn4_data(test_lat, test_lon, size_m=512, resolution_m=0.5)
    
    if elevation_data is not None:
        print(f"✅ Successfully fetched elevation data: {elevation_data.shape}")
        print(f"Elevation range: {elevation_data.min():.1f}m to {elevation_data.max():.1f}m")
        print(f"Mean elevation: {elevation_data.mean():.1f}m")
    else:
        print("❌ Failed to fetch elevation data")

if __name__ == "__main__":
    test_ahn4_fetcher()
