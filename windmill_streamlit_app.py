import streamlit as st
import folium
from streamlit_folium import st_folium
import numpy as np
import os
import time

# Import the new windmill detection module
try:
    from windmill_detection_module import WindmillDetectionModule, scan_for_windmills, DEFAULT_TRAINING_WINDMILLS
    WINDMILL_MODULE_AVAILABLE = True
except ImportError as e:
    WINDMILL_MODULE_AVAILABLE = False
    st.warning(f"Windmill detection module not available: {e}")

st.set_page_config(page_title="Windmill Detector", layout="wide", page_icon="🏛️")

# Import Earth Engine directly
try:
    import ee
    EE_AVAILABLE = True
    service_account = 'earth-engine-service@sage-striker-294302.iam.gserviceaccount.com'
    key_path = '/media/im3/plus/lab4/RE/re_archaeology/sage-striker-294302-b89a8b7e205b.json'
    credentials = ee.ServiceAccountCredentials(service_account, key_path)
    ee.Initialize(credentials, project='sage-striker-294302')
except Exception as e:
    EE_AVAILABLE = False
    st.warning(f"Earth Engine not available: {e}")

st.markdown("""
<style>
.stApp { padding: 0 !important; }
.block-container { padding: 0 !important; max-width: 100vw !important; }
.element-container iframe { width: 100vw !important; min-height: 95vh !important; }
</style>
""", unsafe_allow_html=True)

st.title("🏛️ Interactive Windmill Detector (AHN4 LiDAR + ψ⁰→φ⁰ Kernel)")

# Simple windmill detection function using AHN4
def detect_windmill_features(lat, lon, radius_m=500):
    """Extract elevation features from AHN4 and apply windmill detection logic"""
    if not EE_AVAILABLE:
        return None
    
    try:
        # Create point and buffer
        point = ee.Geometry.Point([lon, lat])
        buffer = point.buffer(radius_m)
        
        # Get AHN4 data
        ahn4 = ee.ImageCollection("AHN/AHN4").filterBounds(buffer)
        if ahn4.size().getInfo() == 0:
            return {'status': 'no_data', 'phi0': 0.0, 'psi0': 0.0}
        
        # Get DSM (Digital Surface Model)
        dsm = ahn4.mosaic().select('dsm').clip(buffer)
        
        # Calculate basic elevation statistics
        stats = dsm.reduceRegion(
            reducer=ee.Reducer.minMax().combine(ee.Reducer.mean()).combine(ee.Reducer.stdDev()),
            geometry=buffer,
            scale=0.5,  # AHN4 native resolution
            maxPixels=1e9
        )
        
        elevation_data = stats.getInfo()
        
        if not elevation_data or 'dsm_mean' not in elevation_data:
            return {'status': 'no_data', 'phi0': 0.0, 'psi0': 0.0}
        
        # Simple windmill detection heuristics
        height_range = elevation_data.get('dsm_max', 0) - elevation_data.get('dsm_min', 0)
        std_dev = elevation_data.get('dsm_stdDev', 0)
        mean_height = elevation_data.get('dsm_mean', 0)
        
        # ψ⁰ score: height variation (windmills create height contrasts)
        psi0_score = min(height_range / 50.0, 1.0) if height_range else 0.0
        
        # φ⁰ score: elevation standard deviation (windmill structures)
        phi0_score = min(std_dev / 10.0, 1.0) if std_dev else 0.0
        
        # Combined score
        combined_score = (psi0_score + phi0_score) / 2
        
        if combined_score > 0.6:
            status = 'windmill'
        elif combined_score > 0.3:
            status = 'candidate'
        else:
            status = 'none'
        
        return {
            'status': status,
            'phi0': phi0_score,
            'psi0': psi0_score,
            'height_range': height_range,
            'std_dev': std_dev,
            'mean_height': mean_height
        }
        
    except Exception as e:
        st.error(f"Detection error: {e}")
        return {'status': 'error', 'phi0': 0.0, 'psi0': 0.0}

# Session state for detections and map state
if 'detections' not in st.session_state:
    st.session_state.detections = []
if 'lidar_center' not in st.session_state:
    st.session_state.lidar_center = [52.4751, 4.8156]
if 'map_zoom' not in st.session_state:
    st.session_state.map_zoom = 14
if 'last_map_update' not in st.session_state:
    st.session_state.last_map_update = None

# Controls in sidebar
with st.sidebar:
    st.header("Controls")
    
    # Data source information
    st.info("🌍 **Data Sources:**\n"
           "• AHN4 LiDAR (Netherlands, 0.5m)\n"
           "• Global SRTM Elevation (30m)\n"
           "• Satellite Imagery (Esri)\n"
           "• ψ⁰→φ⁰ Kernel Analysis")
    
    # Current location display
    lat, lon = st.session_state.lidar_center
    st.write(f"**Current Location:**")
    st.write(f"Lat: {lat:.4f}")
    st.write(f"Lon: {lon:.4f}")
    
    # AHN4/Elevation overlay toggle (persistent)
    if 'show_elevation' not in st.session_state:
        st.session_state.show_elevation = False
    st.session_state.show_elevation = st.checkbox("Show AHN4/Elevation Data", value=st.session_state.show_elevation, key="elevation_checkbox")
    
    # Detection mode selection
    st.subheader("Detection Mode")
    detection_mode = st.radio(
        "Choose detection method:",
        ["Point Detection", "Region Scan"],
        help="Point: Detect at current map center. Region Scan: Scan entire visible area."
    )
    
    # Initialize button variables
    detect_clicked = False
    scan_clicked = False
    use_real_data = False
    
    if detection_mode == "Point Detection":
        # Original point detection
        detect_clicked = st.button("🔍 Detect Windmills at Point", type="primary", use_container_width=True, key="detect_button")
    else:
        # New region scanning
        st.info("🔍 **Region Scan** uses the ψ⁰→φ⁰→G₂ kernel algorithm to systematically scan the visible map area for windmill structures.")
        
        # Scan region button
        scan_clicked = st.button("🗺️ Scan Region for Windmills", type="primary", use_container_width=True, key="scan_button")
        
        # Training windmill selection
        if WINDMILL_MODULE_AVAILABLE:
            use_default_training = st.checkbox("Use default Dutch windmill training data", value=True)
            use_real_data = st.checkbox("Use real AHN4 data (slower)", value=False, 
                                      help="Download actual AHN4 data vs using mock data for demonstration")
            if not use_default_training:
                st.warning("Custom training windmills not yet implemented. Using defaults.")
        else:
            scan_clicked = False
            use_real_data = False
            st.error("Windmill detection module not available")
    
    # Detection info
    st.write(f"**Detections:** {len(st.session_state.detections)}")
    
    # Clear detections
    if st.button("Clear Detections", use_container_width=True, key="clear_button"):
        st.session_state.detections = []
        # Only rerun when actually clearing detections
        if len(st.session_state.detections) > 0:
            st.rerun()

# Create map with cached configuration to prevent flickering
# Only the content/layers need to change, not the base map configuration
center = st.session_state.lidar_center
zoom = st.session_state.map_zoom

# Create the Folium map object - this doesn't cause flickering by itself
# The flickering happens when we re-render the whole component
m = folium.Map(location=center, zoom_start=zoom, tiles=None, prefer_canvas=True)

# Set map options to improve performance
m.options.update({
    'zoomControl': True,
    'scrollWheelZoom': True,
    'dragging': True,
    'fadeAnimation': False,  # Disable animations for better performance
    'zoomAnimation': False,  # Disable zoom animation
    'trackResize': False     # Don't track window resize events
})

# Add base tile layers with proper control
street_layer = folium.TileLayer('OpenStreetMap', name='Street Map', control=True)
street_layer.add_to(m)

satellite_layer = folium.TileLayer(
    tiles='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr='Esri', name='Satellite View', control=True
)
satellite_layer.add_to(m)

# Function to add an Earth Engine image layer to the Folium map (from Amazonian_sites.ipynb)
def add_ee_layer(folium_map, ee_image, vis_params, name):
    """Adds an Earth Engine Image layer to a Folium map."""
    try:
        map_id_dict = ee_image.getMapId(vis_params)
        folium.raster_layers.TileLayer(
            tiles=map_id_dict['tile_fetcher'].url_format,
            attr='Map Data &copy; <a href="https://earthengine.google.com/">Google Earth Engine</a>',
            name=name,
            overlay=True,
            control=True
        ).add_to(folium_map)
        st.sidebar.success(f"✅ Added '{name}' layer to the map")
        return True
    except ee.EEException as e:
        st.sidebar.error(f"❌ Could not add '{name}' layer. Error: {e}")
        return False

# Add AHN4/elevation overlay if enabled - with caching
elevation_layer = None
if st.session_state.show_elevation and EE_AVAILABLE:
    try:
        # Use current map center for elevation overlay
        lat, lon = st.session_state.lidar_center
        buffer_m = 1000  # 1km radius for visualization
        
        # Cache key for elevation data - identify unique requests
        elevation_cache_key = f"{lat:.5f}_{lon:.5f}_{buffer_m}"
        
        # Initialize cache in session state if needed
        if 'elevation_cache' not in st.session_state:
            st.session_state.elevation_cache = {}
        
        # Create a point and buffer for the location
        point_geom = ee.Geometry.Point([lon, lat])
        buffered = point_geom.buffer(buffer_m)
        
        # Check if we're in Netherlands (rough bounds for AHN4 coverage)
        in_netherlands = (50.5 <= lat <= 53.7) and (3.2 <= lon <= 7.3)
        
        # Terrain color palette from Amazonian_sites.ipynb (matches RE-archaeology framework)
        terrain_palette = ['006633', 'E5FFCC', '662A00', 'D8D8D8', 'F5F5F5']
        
        if in_netherlands:
            try:
                # Try AHN4 (Netherlands high-resolution LiDAR)
                ahn4_collection = ee.ImageCollection("AHN/AHN4").filterBounds(buffered)
                ahn4_count = ahn4_collection.size().getInfo()
                st.sidebar.write(f"AHN4 images found: {ahn4_count}")
                
                if ahn4_count > 0:
                    # Check if we have this data cached already to avoid expensive Earth Engine calls
                    if elevation_cache_key in st.session_state.elevation_cache and 'ahn4' in st.session_state.elevation_cache[elevation_cache_key]:
                        # Use cached data
                        cached_data = st.session_state.elevation_cache[elevation_cache_key]['ahn4']
                        ahn4_image = cached_data['image']
                        min_elev = cached_data['min_elev'] 
                        max_elev = cached_data['max_elev']
                        st.sidebar.info("📊 Using cached AHN4 elevation data")
                    else:
                        # Use AHN4 DSM (Digital Surface Model) - mosaic and clip like in notebook
                        ahn4_image = ahn4_collection.mosaic().clip(buffered)
                        
                        # Get elevation statistics to set proper visualization range
                        elevation_stats = ahn4_image.select('dsm').reduceRegion(
                            reducer=ee.Reducer.minMax(),
                            geometry=buffered,
                            scale=0.5,
                            maxPixels=1e9
                        ).getInfo()
                        
                        min_elev = elevation_stats.get('dsm_min', 0)
                        max_elev = elevation_stats.get('dsm_max', 50)
                        
                        # Cache the results
                        if elevation_cache_key not in st.session_state.elevation_cache:
                            st.session_state.elevation_cache[elevation_cache_key] = {}
                        st.session_state.elevation_cache[elevation_cache_key]['ahn4'] = {
                            'image': ahn4_image,
                            'min_elev': min_elev,
                            'max_elev': max_elev
                        }
                    
                    st.sidebar.write(f"Elevation range: {min_elev:.1f}m - {max_elev:.1f}m")
                    
                    # AHN4 visualization parameters (from notebook)
                    ahn4_vis_params = {
                        'bands': ['dsm'],
                        'min': max(0, min_elev),  # Ensure minimum is not negative
                        'max': min(50, max_elev),  # Cap at reasonable max for Netherlands
                        'palette': terrain_palette
                    }
                    
                    # Add the layer using the notebook's method
                    if add_ee_layer(m, ahn4_image, ahn4_vis_params, 'AHN4 DSM'):
                        st.sidebar.success("🛰️ Using AHN4 high-resolution LiDAR data")
                        data_source = 'AHN4 LiDAR DSM'
                    else:
                        raise Exception("Failed to add AHN4 layer")
                else:
                    raise Exception("No AHN4 data in this area")
                    
            except Exception as e:
                st.sidebar.warning(f"AHN4 failed: {e}, trying AHN3...")
                # Try AHN3 as fallback (like in notebook)
                try:
                    ahn3_collection = ee.ImageCollection("AHN/AHN3").filterBounds(buffered)
                    ahn3_count = ahn3_collection.size().getInfo()
                    
                    if ahn3_count > 0:
                        ahn3_image = ahn3_collection.mosaic().clip(buffered)
                        
                        # AHN3 visualization parameters (from notebook)
                        ahn3_vis_params = {
                            'bands': ['dsm'],
                            'min': 0,
                            'max': 50,
                            'palette': terrain_palette
                        }
                        
                        if add_ee_layer(m, ahn3_image, ahn3_vis_params, 'AHN3 DSM'):
                            st.sidebar.success("🛰️ Using AHN3 LiDAR data")
                            data_source = 'AHN3 LiDAR DSM'
                        else:
                            raise Exception("Failed to add AHN3 layer")
                    else:
                        raise Exception("No AHN3 data in this area")
                        
                except Exception as e2:
                    st.sidebar.warning(f"AHN3 also failed: {e2}, using SRTM")
                    # Final fallback to SRTM
                    elevation = ee.Image('USGS/SRTMGL1_003').clip(buffered)
                    
                    # Get SRTM elevation statistics
                    srtm_stats = elevation.reduceRegion(
                        reducer=ee.Reducer.minMax(),
                        geometry=buffered,
                        scale=30,
                        maxPixels=1e9
                    ).getInfo()
                    
                    min_elev = srtm_stats.get('elevation_min', 0)
                    max_elev = srtm_stats.get('elevation_max', 200)
                    
                    st.sidebar.write(f"SRTM elevation range: {min_elev:.1f}m - {max_elev:.1f}m")
                    
                    # SRTM visualization with terrain palette
                    srtm_vis_params = {
                        'bands': ['elevation'],
                        'min': min_elev,
                        'max': max_elev,
                        'palette': terrain_palette
                    }
                    
                    if add_ee_layer(m, elevation, srtm_vis_params, 'SRTM Elevation'):
                        st.sidebar.info("🌍 Using global SRTM elevation data")
                        data_source = 'SRTM Global Elevation'
        else:
            # Outside Netherlands, use SRTM with terrain palette
            elevation = ee.Image('USGS/SRTMGL1_003').clip(buffered)
            
            # Get SRTM elevation statistics for better visualization
            srtm_stats = elevation.reduceRegion(
                reducer=ee.Reducer.minMax(),
                geometry=buffered,
                scale=30,
                maxPixels=1e9
            ).getInfo()
            
            min_elev = srtm_stats.get('elevation_min', 0)
            max_elev = srtm_stats.get('elevation_max', 200)
            
            st.sidebar.write(f"SRTM elevation range: {min_elev:.1f}m - {max_elev:.1f}m")
            
            # SRTM visualization with terrain palette
            srtm_vis_params = {
                'bands': ['elevation'],
                'min': min_elev,
                'max': max_elev,
                'palette': terrain_palette
            }
            
            if add_ee_layer(m, elevation, srtm_vis_params, 'SRTM Elevation'):
                st.sidebar.info("🌍 Using global SRTM elevation data (outside Netherlands)")
                data_source = 'SRTM Global Elevation'
        
        # Add buffer visualization (analysis area indicator)
        folium.GeoJson(
            buffered.getInfo(), 
            name='Analysis Area (1km)',
            style_function=lambda x: {'fillColor': 'blue', 'color': 'blue', 'weight': 2, 'fillOpacity': 0.1}
        ).add_to(m)
        
    except Exception as e:
        st.sidebar.error(f"Could not load elevation data: {e}")

# Add detections
for det in st.session_state.detections:
    folium.CircleMarker(
        location=[det['lat'], det['lon']],
        radius=10,
        color='red', fillColor='red', fillOpacity=0.7, weight=2,
        popup=f"φ⁰: {det['phi0']:.3f}<br>ψ⁰: {det['psi0']:.3f}"
    ).add_to(m)

# Add layer control at the end to avoid conflicts - always available for base layer switching
folium.LayerControl(position='topright').add_to(m)

# Display the map with advanced stabilization to prevent flickering
# Use a combination of stable keying and component isolation

# Initialize base map key only once
if 'base_map_key' not in st.session_state:
    st.session_state.base_map_key = "windmill_map_base"

# Calculate functional state (things that actually change the map content)
# Only includes elevation toggle and detection count - NOT zoom or center
functional_state = f"elev_{int(st.session_state.show_elevation)}_det_{len(st.session_state.detections)}"

# Only update the map key when the functional state changes
if 'last_functional_state' not in st.session_state or st.session_state.last_functional_state != functional_state:
    st.session_state.last_functional_state = functional_state
    # Use a simple stable key - increment a counter to force refresh only when needed
    if 'map_key_counter' not in st.session_state:
        st.session_state.map_key_counter = 0
    st.session_state.map_key_counter += 1
    st.session_state.current_map_key = f"{st.session_state.base_map_key}_{st.session_state.map_key_counter}"
    
    # Track when the map was last functionally updated
    st.session_state.last_map_update_time = time.time()

# Prevent excessive rerenders by using a container
with st.container():
    # Use the st_folium component with advanced stabilization options
    map_data = st_folium(
        m, 
        width=1400, 
        height=800,
        returned_objects=["last_clicked", "center", "zoom"],
        key=st.session_state.current_map_key,
        # Use feature flags to improve stability
        feature_group_to_add=None,  # Don't auto-add features
        use_container_width=True    # Better responsiveness
    )

# Only update session state if map data has actually changed significantly
# Use more conservative thresholds to prevent excessive updates
if map_data and "center" in map_data and map_data["center"]:
    center_data = map_data["center"]
    if isinstance(center_data, dict) and "lat" in center_data and "lng" in center_data:
        new_center = [center_data["lat"], center_data["lng"]]
        # Increase threshold to reduce sensitivity (0.05 degrees ≈ 5km)
        lat_diff = abs(new_center[0] - st.session_state.lidar_center[0])
        lon_diff = abs(new_center[1] - st.session_state.lidar_center[1])
        if lat_diff > 0.05 or lon_diff > 0.05:
            st.session_state.lidar_center = new_center

if map_data and "zoom" in map_data and map_data["zoom"]:
    # Only update for significant zoom changes (3 levels instead of 2)
    zoom_diff = abs(map_data["zoom"] - st.session_state.map_zoom)
    if zoom_diff >= 3:
        st.session_state.map_zoom = map_data["zoom"]

# Windmill detection handler - optimized to prevent unnecessary reruns
if detect_clicked and EE_AVAILABLE:
    with st.spinner("Detecting windmills using AHN4/elevation analysis..."):
        try:
            lat, lon = st.session_state.lidar_center
            
            # Use our local detection function
            detection = detect_windmill_features(lat, lon, 500)
            
            if not detection:
                st.sidebar.error("Detection failed - no data available")
            elif detection['status'] in ["windmill", "candidate"]:
                detection_point = {
                    'lat': lat,
                    'lon': lon,
                    'phi0': detection['phi0'],
                    'psi0': detection['psi0'],
                    'status': detection['status']
                }
                # Check if this detection already exists to avoid duplicates
                is_duplicate = any(
                    abs(d['lat'] - lat) < 0.001 and abs(d['lon'] - lon) < 0.001 
                    for d in st.session_state.detections
                )
                
                if not is_duplicate:
                    st.session_state.detections.append(detection_point)
                    st.sidebar.success(f"Windmill detected! φ⁰: {detection['phi0']:.2f}, ψ⁰: {detection['psi0']:.2f}")
                    
                    # Show additional details
                    if 'height_range' in detection:
                        st.sidebar.info(f"Height range: {detection['height_range']:.1f}m\n"
                                      f"Std dev: {detection['std_dev']:.1f}m\n"
                                      f"Mean height: {detection['mean_height']:.1f}m")
                    
                    # Only rerun if we actually added a new detection
                    st.rerun()
                else:
                    st.sidebar.info("Windmill already detected at this location")
            else:
                st.sidebar.info("No windmills detected at current location")
            
        except Exception as e:
            st.sidebar.error(f"Detection failed: {str(e)}")
elif detect_clicked and not EE_AVAILABLE:
    st.sidebar.warning("Earth Engine not available for detection")

# Region scanning handler - new functionality
if 'scan_clicked' in locals() and scan_clicked and WINDMILL_MODULE_AVAILABLE and EE_AVAILABLE:
    with st.spinner("Scanning region for windmills using ψ⁰→φ⁰→G₂ kernel algorithm..."):
        try:
            # Get current map bounds from session state
            center_lat, center_lon = st.session_state.lidar_center
            zoom = st.session_state.map_zoom
            
            # Calculate approximate bounds based on zoom level
            # These are rough approximations - actual bounds would come from map interaction
            lat_delta = 0.01 * (15 - zoom)  # Smaller area for higher zoom
            lon_delta = 0.01 * (15 - zoom)
            
            lat_min = center_lat - lat_delta
            lat_max = center_lat + lat_delta
            lon_min = center_lon - lon_delta
            lon_max = center_lon + lon_delta
            
            st.sidebar.info(f"Scanning region: {lat_min:.4f}°N to {lat_max:.4f}°N, {lon_min:.4f}°E to {lon_max:.4f}°E")
            
            # Use the windmill detection module
            result = scan_for_windmills(
                lat_min=lat_min,
                lon_min=lon_min,
                lat_max=lat_max,
                lon_max=lon_max,
                training_windmills=DEFAULT_TRAINING_WINDMILLS,
                resolution=0.5,
                use_real_data=use_real_data
            )
            
            # Process results
            if result.no_windmills_found:
                st.sidebar.info("🔍 **No windmills detected in this region**\n\n"
                               f"Scanned {result.total_area_scanned:.2f} km² at {result.resolution}m resolution\n"
                               f"Processing time: {result.processing_time:.2f} seconds")
            else:
                st.sidebar.success(f"🎯 **Found {len(result.candidates)} windmill candidates!**\n\n"
                                 f"Scanned {result.total_area_scanned:.2f} km² at {result.resolution}m resolution\n"
                                 f"Processing time: {result.processing_time:.2f} seconds")
                
                # Add candidates to detections
                new_detections = 0
                for candidate in result.candidates:
                    # Check for duplicates
                    is_duplicate = any(
                        abs(d['lat'] - candidate.lat) < 0.001 and abs(d['lon'] - candidate.lon) < 0.001 
                        for d in st.session_state.detections
                    )
                    
                    if not is_duplicate:
                        detection_point = {
                            'lat': candidate.lat,
                            'lon': candidate.lon,
                            'phi0': candidate.phi0_score,
                            'psi0': candidate.psi0_score,
                            'status': 'candidate' if candidate.confidence < 0.8 else 'windmill',
                            'confidence': candidate.confidence,
                            'coherence': candidate.coherence,
                            'scan_result': True  # Mark as scan result
                        }
                        st.session_state.detections.append(detection_point)
                        new_detections += 1
                
                if new_detections > 0:
                    st.sidebar.info(f"Added {new_detections} new detections to map")
                    st.rerun()
                else:
                    st.sidebar.info("All candidates were already detected")
                    
        except Exception as e:
            st.sidebar.error(f"Region scan failed: {str(e)}")
            import traceback
            st.sidebar.error(f"Details: {traceback.format_exc()}")

elif 'scan_clicked' in locals() and scan_clicked and not WINDMILL_MODULE_AVAILABLE:
    st.sidebar.error("Windmill detection module not available for region scanning")
elif 'scan_clicked' in locals() and scan_clicked and not EE_AVAILABLE:
    st.sidebar.warning("Earth Engine not available for region scanning")
