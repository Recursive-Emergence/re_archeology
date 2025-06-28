from fastapi import APIRouter, Depends, HTTPException
from backend.api.routers.auth import get_current_user_optional
from backend.utils.earth_engine import get_earth_engine_status, is_earth_engine_available
from backend.api.routers.discovery_utils import (
    get_available_structure_types,
    get_profile_name_for_structure_type,
    safe_asdict,
)
from backend.api.routers.discovery_models import (
    CustomProfileRequest,
)
from backend.api.routers.discovery_sessions import (
    force_clear_all_detectors,
    _session_detectors,
)
import logging
from datetime import datetime
import os
import copy

router = APIRouter()
logger = logging.getLogger(__name__)

# Import APP_ROOT from main module if needed, else define here
APP_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

@router.get("/discovery/profiles")
async def get_available_profiles(current_user=Depends(get_current_user_optional)):
    try:
        from kernel.detector_profile import DetectorProfileManager
        app_root = APP_ROOT
        profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
        available_types, default_type = get_available_structure_types(APP_ROOT, logger)
        profiles_info = []
        for structure_type in available_types:
            try:
                profile_name = get_profile_name_for_structure_type(structure_type, APP_ROOT, logger)
                profile = profile_manager.load_profile(profile_name)
                profile_info = {
                    "structure_type": structure_type,
                    "profile_name": profile.name,
                    "filename": profile_name,
                    "description": profile.description,
                    "version": profile.version,
                    "structure_category": profile.structure_type.value if hasattr(profile, 'structure_type') else structure_type,
                    "geometry": {
                        "patch_size_m": profile.geometry.patch_size_m,
                        "resolution_m": profile.geometry.resolution_m,
                        "structure_radius_m": profile.geometry.structure_radius_m,
                        "min_structure_size_m": profile.geometry.min_structure_size_m,
                        "max_structure_size_m": profile.geometry.max_structure_size_m,
                        "patch_shape": profile.geometry.patch_shape.value if hasattr(profile.geometry.patch_shape, 'value') else str(profile.geometry.patch_shape)
                    },
                    "thresholds": {
                        "detection_threshold": profile.thresholds.detection_threshold,
                        "confidence_threshold": profile.thresholds.confidence_threshold,
                        "early_decision_threshold": getattr(profile.thresholds, 'early_decision_threshold', None),
                        "uncertainty_tolerance": getattr(profile.thresholds, 'uncertainty_tolerance', None)
                    },
                    "features": {},
                    "performance": {
                        "aggregation_method": getattr(profile, 'aggregation_method', 'streaming'),
                        "parallel_execution": getattr(profile, 'parallel_execution', True),
                        "max_workers": getattr(profile, 'max_workers', 6)
                    }
                }
                if hasattr(profile, 'features') and profile.features:
                    for feature_name, feature_config in profile.features.items():
                        if hasattr(feature_config, 'enabled') and hasattr(feature_config, 'weight'):
                            profile_info["features"][feature_name] = {
                                "enabled": feature_config.enabled,
                                "weight": feature_config.weight,
                                "polarity_preference": getattr(feature_config, 'polarity_preference', None),
                                "configurable": True
                            }
                profiles_info.append(profile_info)
            except Exception as e:
                profiles_info.append({
                    "structure_type": structure_type,
                    "profile_name": f"{structure_type.title()} Detection",
                    "filename": get_profile_name_for_structure_type(structure_type),
                    "description": f"Detection profile for {structure_type} structures",
                    "error": str(e)
                })
        return {
            "status": "success",
            "profiles": profiles_info,
            "default_type": default_type,
            "total_count": len(profiles_info),
            "configurable_options": {
                "geometry": ["patch_size_m", "resolution_m", "structure_radius_m"],
                "thresholds": ["detection_threshold", "confidence_threshold"],
                "features": "all_weights_and_enabled_status"
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "profiles": [],
            "default_type": "windmill"
        }

@router.get("/discovery/structure_types")
async def get_available_structure_types_endpoint(current_user=Depends(get_current_user_optional)):
    try:
        available_types, default_type = get_available_structure_types(APP_ROOT, logger)
        return {
            "status": "success",
            "available_types": available_types,
            "default_type": default_type,
            "total_count": len(available_types)
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "available_types": ["windmill"],
            "default_type": "windmill"
        }

@router.post("/discovery/configure_profile")
async def configure_custom_profile(request: CustomProfileRequest, current_user=Depends(get_current_user_optional)):
    try:
        from kernel.detector_profile import DetectorProfileManager
        from kernel import G2StructureDetector
        app_root = APP_ROOT
        profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
        profile_name = get_profile_name_for_structure_type(request.structure_type)
        base_profile = profile_manager.load_profile(profile_name)
        custom_profile = copy.deepcopy(base_profile)
        modifications = []
        if request.geometry:
            if request.geometry.patch_size_m is not None:
                custom_profile.geometry.patch_size_m = tuple(request.geometry.patch_size_m)
                modifications.append(f"patch_size_m: {request.geometry.patch_size_m}")
            if request.geometry.resolution_m is not None:
                custom_profile.geometry.resolution_m = request.geometry.resolution_m
                modifications.append(f"resolution_m: {request.geometry.resolution_m}")
            if request.geometry.structure_radius_m is not None:
                custom_profile.geometry.structure_radius_m = request.geometry.structure_radius_m
                modifications.append(f"structure_radius_m: {request.geometry.structure_radius_m}")
            if request.geometry.min_structure_size_m is not None:
                custom_profile.geometry.min_structure_size_m = request.geometry.min_structure_size_m
                modifications.append(f"min_structure_size_m: {request.geometry.min_structure_size_m}")
            if request.geometry.max_structure_size_m is not None:
                custom_profile.geometry.max_structure_size_m = request.geometry.max_structure_size_m
                modifications.append(f"max_structure_size_m: {request.geometry.max_structure_size_m}")
        if request.thresholds:
            if request.thresholds.detection_threshold is not None:
                custom_profile.thresholds.detection_threshold = request.thresholds.detection_threshold
                modifications.append(f"detection_threshold: {request.thresholds.detection_threshold}")
            if request.thresholds.confidence_threshold is not None:
                custom_profile.thresholds.confidence_threshold = request.thresholds.confidence_threshold
                modifications.append(f"confidence_threshold: {request.thresholds.confidence_threshold}")
            if request.thresholds.early_decision_threshold is not None and hasattr(custom_profile.thresholds, 'early_decision_threshold'):
                custom_profile.thresholds.early_decision_threshold = request.thresholds.early_decision_threshold
                modifications.append(f"early_decision_threshold: {request.thresholds.early_decision_threshold}")
            if request.thresholds.uncertainty_tolerance is not None and hasattr(custom_profile.thresholds, 'uncertainty_tolerance'):
                custom_profile.thresholds.uncertainty_tolerance = request.thresholds.uncertainty_tolerance
                modifications.append(f"uncertainty_tolerance: {request.thresholds.uncertainty_tolerance}")
        if request.features and hasattr(custom_profile, 'features'):
            for feature_name, feature_config in request.features.items():
                if feature_name in custom_profile.features:
                    if feature_config.enabled is not None:
                        custom_profile.features[feature_name].enabled = feature_config.enabled
                        modifications.append(f"{feature_name}.enabled: {feature_config.enabled}")
                    if feature_config.weight is not None:
                        custom_profile.features[feature_name].weight = feature_config.weight
                        modifications.append(f"{feature_name}.weight: {feature_config.weight}")
                    if feature_config.polarity_preference is not None and hasattr(custom_profile.features[feature_name], 'polarity_preference'):
                        custom_profile.features[feature_name].polarity_preference = feature_config.polarity_preference
                        modifications.append(f"{feature_name}.polarity_preference: {feature_config.polarity_preference}")
        if request.performance:
            if request.performance.aggregation_method is not None and hasattr(custom_profile, 'aggregation_method'):
                custom_profile.aggregation_method = request.performance.aggregation_method
                modifications.append(f"aggregation_method: {request.performance.aggregation_method}")
            if request.performance.parallel_execution is not None and hasattr(custom_profile, 'parallel_execution'):
                custom_profile.parallel_execution = request.performance.parallel_execution
                modifications.append(f"parallel_execution: {request.performance.parallel_execution}")
            if request.performance.max_workers is not None and hasattr(custom_profile, 'max_workers'):
                custom_profile.max_workers = request.performance.max_workers
                modifications.append(f"max_workers: {request.performance.max_workers}")
        try:
            test_detector = G2StructureDetector(profile=custom_profile)
            profile_valid = True
            validation_message = "Profile configuration is valid"
        except Exception as e:
            profile_valid = False
            validation_message = f"Profile validation failed: {str(e)}"
        session_cache_key = None
        if profile_valid and request.session_id:
            session_cache_key = f"custom_{request.session_id}_{request.structure_type}"
        saved_profile_name = None
        if request.save_as_custom and request.custom_profile_name and profile_valid:
            try:
                custom_filename = f"custom_{request.custom_profile_name.replace(' ', '_').lower()}.json"
                saved_profile_name = custom_filename
                modifications.append(f"Saved as: {custom_filename}")
            except Exception as e:
                pass
        return {
            "status": "success",
            "profile_valid": profile_valid,
            "validation_message": validation_message,
            "base_profile": profile_name,
            "structure_type": request.structure_type,
            "modifications": modifications,
            "session_cache_key": session_cache_key,
            "saved_profile_name": saved_profile_name,
            "custom_profile_summary": {
                "patch_size_m": custom_profile.geometry.patch_size_m,
                "detection_threshold": custom_profile.thresholds.detection_threshold,
                "confidence_threshold": custom_profile.thresholds.confidence_threshold,
                "feature_count": len(custom_profile.features) if hasattr(custom_profile, 'features') else 0,
                "enabled_features": [name for name, feature in custom_profile.features.items() if feature.enabled] if hasattr(custom_profile, 'features') else []
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "profile_valid": False
        }

@router.get("/discovery/kernels")
async def get_cached_kernels(structure_type: str = None):
    try:
        if structure_type is None:
            available_types, default_type = get_available_structure_types()
            structure_type = default_type
        from kernel import G2StructureDetector
        from kernel.detector_profile import DetectorProfileManager
        app_root = APP_ROOT
        profile_manager = DetectorProfileManager(profiles_dir=f"{app_root}/profiles")
        profile_name = get_profile_name_for_structure_type(structure_type)
        profile = profile_manager.load_profile(profile_name)
        detector = G2StructureDetector(profile=profile)
        kernels_info = []
        profile = detector.profile
        if profile:
            kernels_info.append({
                'structure_type': profile.structure_type.value,
                'profile_name': profile.name,
                'version': profile.version,
                'description': profile.description,
                'resolution_m': profile.geometry.resolution_m,
                'structure_radius_m': profile.geometry.structure_radius_m,
                'patch_size_m': profile.geometry.patch_size_m,
                'detection_threshold': profile.thresholds.detection_threshold,
                'confidence_threshold': profile.thresholds.confidence_threshold,
                'enabled_features': list(profile.get_enabled_features().keys()),
                'created': datetime.now().isoformat(),
                'source': 'g2_kernel'
            })
        return {
            'status': 'success',
            'kernels': kernels_info,
            'total_count': len(kernels_info),
            'message': f'Found {len(kernels_info)} G2 profile(s)'
        }
    except Exception as e:
        return {
            'status': 'success',
            'kernels': [],
            'total_count': 0,
            'message': f'Kernel loading failed: {str(e)}'
        }

@router.post("/discovery/kernels/clear")
async def clear_kernel_cache(structure_type: str = None, confirm: bool = False):
    try:
        force_clear_all_detectors()
        return {
            'status': 'success',
            'removed_count': len(_session_detectors),
            'message': 'Detector cache cleared - profile fixes will be applied'
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
