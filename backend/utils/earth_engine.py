"""
Shared Earth Engine initialization module for RE-Archaeology Framework.
Ensures consistent EE initialization across local and Cloud Run environments.
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Global Earth Engine state
_ee_initialized = False
_ee_available = False

def initialize_earth_engine() -> bool:
    """
    Initialize Google Earth Engine with proper authentication.
    Works for both local development and Cloud Run deployment.
    
    Returns:
        bool: True if initialization successful, False otherwise
    """
    global _ee_initialized, _ee_available
    
    if _ee_initialized:
        return _ee_available
        
    try:
        import ee
        from backend.utils.config import get_settings
        
        settings = get_settings()
        logger.info("Starting Earth Engine authentication...")
        logger.info(f"Service account key path: {settings.GOOGLE_EE_SERVICE_ACCOUNT_KEY}")
        logger.info(f"Project ID: {settings.GOOGLE_EE_PROJECT_ID}")
        logger.info(f"GOOGLE_APPLICATION_CREDENTIALS: {os.getenv('GOOGLE_APPLICATION_CREDENTIALS')}")
        
        # Strategy 1: Service Account Authentication (preferred for production)
        if settings.GOOGLE_EE_SERVICE_ACCOUNT_KEY and settings.GOOGLE_EE_PROJECT_ID:
            service_account_path = settings.GOOGLE_EE_SERVICE_ACCOUNT_KEY
            if os.path.exists(service_account_path):
                try:
                    logger.info(f"Attempting service account authentication with: {service_account_path}")
                    credentials = ee.ServiceAccountCredentials(
                        email=None,  # Will be read from JSON file
                        key_file=service_account_path
                    )
                    ee.Initialize(credentials, project=settings.GOOGLE_EE_PROJECT_ID)
                    _ee_available = True
                    logger.info("✅ Earth Engine initialized with service account credentials")
                    return _ee_available
                except Exception as sa_error:
                    logger.warning(f"Service account auth failed: {sa_error}")
                    # Continue to fallback strategies
            else:
                logger.warning(f"Service account key not found at: {service_account_path}")
        else:
            logger.info("Service account credentials not configured in settings")
        
        # Strategy 2: Application Default Credentials (fallback)
        if not _ee_available and os.getenv('GOOGLE_APPLICATION_CREDENTIALS'):
            adc_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
            if os.path.exists(adc_path):
                try:
                    logger.info(f"Attempting application default credentials with: {adc_path}")
                    # For ADC, we might need to specify the project
                    if settings.GOOGLE_EE_PROJECT_ID:
                        ee.Initialize(project=settings.GOOGLE_EE_PROJECT_ID)
                    else:
                        ee.Initialize()
                    _ee_available = True
                    logger.info("✅ Earth Engine initialized with application default credentials")
                    return _ee_available
                except Exception as adc_error:
                    logger.warning(f"Application default credentials failed: {adc_error}")
            else:
                logger.warning(f"GOOGLE_APPLICATION_CREDENTIALS file not found: {adc_path}")
        
        # Strategy 3: User authentication (local development fallback)
        if not _ee_available:
            try:
                logger.info("Attempting user authentication (earthengine authenticate)")
                ee.Initialize()
                _ee_available = True
                logger.info("✅ Earth Engine initialized with user authentication")
                return _ee_available
            except Exception as user_error:
                logger.warning(f"User authentication failed: {user_error}")
        
        if not _ee_available:
            logger.error("❌ All Earth Engine authentication strategies failed")
            logger.error("Please ensure one of the following:")
            logger.error("1. Set GOOGLE_EE_SERVICE_ACCOUNT_KEY and GOOGLE_EE_PROJECT_ID in .env")
            logger.error("2. Set GOOGLE_APPLICATION_CREDENTIALS environment variable")
            logger.error("3. Run 'earthengine authenticate' in terminal")
            
    except ImportError:
        logger.error("❌ Earth Engine library not available - run 'pip install earthengine-api'")
    except Exception as e:
        logger.error(f"❌ Earth Engine initialization failed: {e}")
    
    _ee_initialized = True
    return _ee_available

def is_earth_engine_available() -> bool:
    """Check if Earth Engine is available and initialized."""
    return _ee_available

def get_earth_engine_status() -> dict:
    """Get detailed Earth Engine status information."""
    return {
        "initialized": _ee_initialized,
        "available": _ee_available,
        "has_credentials": bool(os.getenv('GOOGLE_APPLICATION_CREDENTIALS') or 
                               (os.getenv('GOOGLE_EE_SERVICE_ACCOUNT_KEY') and 
                                os.path.exists(os.getenv('GOOGLE_EE_SERVICE_ACCOUNT_KEY', ''))))
    }
