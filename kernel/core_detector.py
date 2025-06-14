"""
G₂ Structure Detector - Core Detection Orchestrator

This module provides the main detection orchestrator that coordinates φ⁰ detection
with parallel feature module execution and recursive aggregation.
"""

import numpy as np
import logging
from typing import List, Dict, Any, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import sys
import os

import numpy as np
import logging
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor, as_completed

from .aggregator import RecursiveDetectionAggregator, AggregationResult, StreamingDetectionAggregator, StreamingAggregationResult
from .modules import feature_registry, FeatureResult

# Configure logging
logger = logging.getLogger(__name__)


@dataclass
class ElevationPatch:
    """Container for elevation data and metadata - independent from phi0_core"""
    elevation_data: np.ndarray
    lat: float = None
    lon: float = None
    source: str = "unknown"
    resolution_m: float = 0.5
    coordinates: Tuple[float, float] = None
    patch_size_m: float = None
    metadata: Dict = None


@dataclass
class G2DetectionResult:
    """Enhanced detection result with G₂-level reasoning - independent system"""
    detected: bool
    confidence: float
    final_score: float
    base_score: float  # G₂ base score (replaces phi0_score)
    aggregation_result: AggregationResult
    feature_results: Dict[str, FeatureResult]
    refinement_attempts: int = 0
    refinement_history: List[AggregationResult] = None
    reason: str = ""
    metadata: Dict[str, Any] = None


class G2StructureDetector:
    """
    G₂-level structure detector with recursive geometric reasoning.
    
    Combines φ⁰ core detection with parallel feature module execution
    and recursive refinement capabilities.
    """
    
    def __init__(self, 
                 resolution_m: float = 0.5,
                 structure_radius_m: float = 8.0,
                 structure_type: str = "windmill",
                 max_workers: int = 5,
                 enable_refinement: bool = True,
                 max_refinement_attempts: int = 2):
        """
        Initialize G₂ detector - completely independent of phi0_core
        
        Args:
            resolution_m: Resolution in meters per pixel
            structure_radius_m: Expected structure radius in meters
            structure_type: Type of structure to detect
            max_workers: Maximum number of parallel workers for feature modules
            enable_refinement: Whether to enable recursive refinement
            max_refinement_attempts: Maximum number of refinement attempts
        """
        # Core G₂ parameters - no phi0_core dependency
        self.resolution_m = resolution_m
        self.structure_radius_m = structure_radius_m
        self.structure_type = structure_type
        self.detection_threshold = 0.5  # Independent threshold
        
        # G₂ specific parameters
        self.max_workers = max_workers
        self.enable_refinement = enable_refinement
        self.max_refinement_attempts = max_refinement_attempts
        
        # Initialize feature modules using registry
        module_weights = {
            "histogram": 1.5,           # Highest weight - core histogram matching
            "volume": 1.3,              # Second highest - volumetric analysis
            "dropoff": 1.2,             # Third - edge sharpness
            "compactness": 1.1,         # Fourth - shape analysis
            "entropy": 1.0,             # Fifth - surface texture
            "planarity": 0.9            # Lowest - surface planarity
        }
        
        self.feature_modules = feature_registry.get_all_modules(module_weights)
        
        # Set parameters for all modules
        structure_radius_px = int(self.structure_radius_m / resolution_m)
        for module in self.feature_modules.values():
            module.set_parameters(resolution_m, structure_radius_px)
        
        # Initialize aggregator - use streaming version for full functionality
        self.aggregator = StreamingDetectionAggregator(
            phi0_weight=0.6, 
            feature_weight=0.4,
            early_decision_threshold=0.85,
            min_modules_for_decision=2
        )
        
        logger.info(f"G₂ detector initialized with {len(self.feature_modules)} feature modules")
    
    def run_feature_modules_streaming(self, elevation_patch: np.ndarray, 
                                     callback=None) -> Dict[str, FeatureResult]:
        """
        Run feature modules with streaming aggregation - results processed as they complete
        
        Args:
            elevation_patch: 2D elevation data array
            callback: Optional callback function called for each completed module
                     Signature: callback(module_name, result, streaming_aggregation)
            
        Returns:
            Dictionary mapping module names to their results
        """
        results = {}
        completed_modules = []
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all feature computations
            future_to_module = {
                executor.submit(module.compute, elevation_patch): name
                for name, module in self.feature_modules.items()
            }
            
            logger.info(f"🚀 Started {len(future_to_module)} feature modules in parallel")
            
            # Process results as they complete
            for future in as_completed(future_to_module):
                module_name = future_to_module[future]
                try:
                    result = future.result(timeout=30)  # 30 second timeout per module
                    results[module_name] = result
                    completed_modules.append(module_name)
                    
                    # Add evidence to aggregator immediately
                    if module_name in self.feature_modules:
                        weight = self.feature_modules[module_name].weight
                        self.aggregator.add_evidence(module_name, result, weight)
                    
                    # Perform streaming aggregation
                    streaming_result = self.aggregator.streaming_aggregate(
                        available_modules=completed_modules,
                        total_modules=len(self.feature_modules)
                    )
                    
                    logger.info(f"✅ Module {module_name} completed: score={result.score:.3f}")
                    logger.info(f"📊 Streaming: {streaming_result.completion_percentage:.1%} complete, "
                               f"confidence={streaming_result.streaming_confidence:.3f}")
                    
                    # Call callback if provided
                    if callback:
                        callback(module_name, result, streaming_result)
                    
                    # Check for early decision
                    if streaming_result.early_decision_possible:
                        logger.info(f"🎯 Early decision possible! "
                                   f"Score: {streaming_result.final_score:.3f}, "
                                   f"Confidence: {streaming_result.streaming_confidence:.3f}")
                        
                        # Could optionally cancel remaining futures here for even faster execution
                        # for remaining_future in future_to_module:
                        #     if not remaining_future.done():
                        #         remaining_future.cancel()
                    
                except Exception as e:
                    logger.warning(f"❌ Module {module_name} failed: {e}")
                    results[module_name] = FeatureResult(
                        score=0.0,
                        valid=False,
                        reason=f"Computation failed: {str(e)}"
                    )
        
        logger.info(f"🏁 All feature modules completed: {len(results)} results")
        return results
    
    def detect_structure(self, elevation_patch: ElevationPatch) -> G2DetectionResult:
        """
        Perform G₂-level structure detection with recursive reasoning
        
        Args:
            elevation_patch: ElevationPatch object with elevation data
            
        Returns:
            G2DetectionResult with comprehensive detection analysis
        """
        logger.info("Starting G₂ structure detection")
        
        # Reset aggregator for new detection
        self.aggregator.reset()
        
        # In the new G₂ system, we start with neutral base score
        # Feature modules (especially histogram) drive the detection
        base_score = 0.5
        logger.info(f"G₂ base score: {base_score:.3f} (feature-driven detection)")
        
        # Step 2: Run feature modules in parallel
        feature_results = self.run_feature_modules_parallel(elevation_patch.elevation_data)
        
        # Step 3: Aggregate evidence
        self.aggregator.set_phi0_score(base_score)
        
        for name, result in feature_results.items():
            if name in self.feature_modules:
                weight = self.feature_modules[name].weight
                self.aggregator.add_evidence(name, result, weight)
        
        aggregation_result = self.aggregator.aggregate()
        logger.info(f"Initial aggregation: score={aggregation_result.final_score:.3f}, confidence={aggregation_result.confidence:.3f}")
        
        # Step 4: Recursive refinement if enabled and needed
        refinement_attempts = 0
        refinement_history = [aggregation_result]
        
        if self.enable_refinement and self.aggregator.should_refine(aggregation_result):
            logger.info("Ambiguous result detected, attempting recursive refinement")
            
            for attempt in range(self.max_refinement_attempts):
                refinement_attempts += 1
                
                # Get refinement strategy
                strategy = self.aggregator.suggest_refinement_strategy(aggregation_result)
                logger.info(f"Refinement attempt {attempt + 1}: {strategy['reasons']}")
                
                # Apply refinement strategy (simplified for skeleton)
                # In a full implementation, this would modify detection parameters
                # and re-run detection with adjusted settings
                
                # For now, we'll simulate refinement by slightly adjusting the aggregation
                # This is a placeholder for actual refinement logic
                refined_result = self._simulate_refinement(aggregation_result, strategy)
                
                if refined_result:
                    refinement_history.append(refined_result)
                    
                    # Check if refinement improved confidence
                    if refined_result.confidence > aggregation_result.confidence + 0.1:
                        aggregation_result = refined_result
                        logger.info(f"Refinement improved confidence to {refined_result.confidence:.3f}")
                        break
                    elif not self.aggregator.should_refine(refined_result):
                        aggregation_result = refined_result
                        logger.info("Refinement resolved ambiguity")
                        break
        
        # Step 5: Make final detection decision
        detection_threshold = self.detection_threshold
        detected = aggregation_result.final_score >= detection_threshold
        
        # Generate comprehensive result
        result = G2DetectionResult(
            detected=detected,
            confidence=aggregation_result.confidence,
            final_score=aggregation_result.final_score,
            base_score=base_score,
            aggregation_result=aggregation_result,
            feature_results=feature_results,
            refinement_attempts=refinement_attempts,
            refinement_history=refinement_history,
            reason=f"G₂ detection: {aggregation_result.reason}",
            metadata={
                "base_score": base_score,
                "detection_threshold": detection_threshold,
                "structure_type": self.structure_type,
                "feature_module_count": len(self.feature_modules)
            }
        )
        
        logger.info(f"G₂ detection completed: detected={detected}, confidence={aggregation_result.confidence:.3f}")
        return result
    
    def _simulate_refinement(self, base_result: AggregationResult, strategy: Dict[str, Any]) -> Optional[AggregationResult]:
        """
        Simulate refinement process (placeholder for actual implementation)
        
        In a full implementation, this would:
        - Adjust detection parameters based on strategy
        - Re-run detection with new parameters
        - Return new aggregation result
        
        For the skeleton, we simulate slight improvements
        """
        # Simulate small improvement in confidence
        simulated_score = base_result.final_score + np.random.normal(0, 0.05)
        simulated_confidence = base_result.confidence + np.random.normal(0.02, 0.03)
        
        # Clamp values
        simulated_score = max(0.0, min(1.0, simulated_score))
        simulated_confidence = max(0.0, min(1.0, simulated_confidence))
        
        return AggregationResult(
            final_score=simulated_score,
            confidence=simulated_confidence,
            phi0_contribution=base_result.phi0_contribution,
            feature_contribution=base_result.feature_contribution,
            evidence_count=base_result.evidence_count,
            reason=f"Refined: {base_result.reason}",
            metadata={**base_result.metadata, "refinement_applied": strategy}
        )
    
    def get_module_info(self) -> Dict[str, Dict[str, Any]]:
        """Get information about loaded feature modules"""
        return {
            name: {
                "class": module.__class__.__name__,
                "weight": module.weight,
                "resolution_m": module.resolution_m,
                "structure_radius_px": module.structure_radius_px
            }
            for name, module in self.feature_modules.items()
        }
    
    def configure_module_weights(self, weights: Dict[str, float]):
        """Configure weights for feature modules"""
        for name, weight in weights.items():
            if name in self.feature_modules:
                self.feature_modules[name].weight = weight
                logger.info(f"Updated weight for {name}: {weight}")
    
    def configure_aggregator(self, phi0_weight: float = None, feature_weight: float = None):
        """Configure aggregator weights"""
        if phi0_weight is not None:
            self.aggregator.phi0_weight = phi0_weight
        if feature_weight is not None:
            self.aggregator.feature_weight = feature_weight
        
        # Ensure weights sum to 1.0
        total = self.aggregator.phi0_weight + self.aggregator.feature_weight
        if total > 0:
            self.aggregator.phi0_weight /= total
            self.aggregator.feature_weight /= total
        
        logger.info(f"Aggregator weights: φ⁰={self.aggregator.phi0_weight:.2f}, features={self.aggregator.feature_weight:.2f}")
    
    def register_feature_module(self, name: str, module_class, weight: float = 1.0):
        """
        Dynamically register a new feature module
        
        Args:
            name: Unique name for the module
            module_class: Class inheriting from BaseFeatureModule
            weight: Weight for this module
        """
        feature_registry.register(name, module_class, weight)
        # Refresh the feature modules
        self.feature_modules[name] = feature_registry.get_module(name, weight)
        
        # Set parameters for the new module
        structure_radius_px = int(self.phi0_detector.structure_radius_m / self.phi0_detector.resolution_m)
        self.feature_modules[name].set_parameters(self.phi0_detector.resolution_m, structure_radius_px)
        
        logger.info(f"Registered and loaded feature module: {name}")
    
    def unregister_feature_module(self, name: str):
        """
        Unregister a feature module
        
        Args:
            name: Name of the module to unregister
        """
        feature_registry.unregister(name)
        if name in self.feature_modules:
            del self.feature_modules[name]
        logger.info(f"Unregistered feature module: {name}")
    
    def list_available_modules(self) -> List[str]:
        """List all available feature modules"""
        return feature_registry.list_modules()
    
    
    def detect_structure_streaming(self, elevation_patch: ElevationPatch, 
                                  progress_callback=None) -> G2DetectionResult:
        """
        Perform G₂-level structure detection with real-time streaming aggregation
        
        Args:
            elevation_patch: ElevationPatch object with elevation data
            progress_callback: Optional callback for streaming progress updates
                             Signature: callback(module_name, result, streaming_aggregation)
            
        Returns:
            G2DetectionResult with comprehensive detection analysis
        """
        logger.info("🌊 Starting G₂ streaming structure detection")
        
        # Reset aggregator for new detection
        self.aggregator.reset()
        
        # Set expected modules count for streaming aggregator
        self.aggregator.set_expected_modules(len(self.feature_modules))
        
        # NOTE: In the new G₂ system, we don't need a separate φ⁰ score
        # The histogram module provides the core pattern matching functionality
        # Set base score to neutral (0.5) - let feature modules drive the decision
        base_score = 0.5
        logger.info(f"G₂ base score: {base_score:.3f} (feature-driven detection)")
        self.aggregator.set_phi0_score(base_score)
        
        # Step 2: Run feature modules with streaming aggregation
        streaming_results = []
        
        def streaming_callback(module_name, result, streaming_agg):
            """Internal callback to collect streaming results"""
            streaming_results.append({
                'module': module_name,
                'result': result,
                'aggregation': streaming_agg,
                'timestamp': len(streaming_results)
            })
            
            # Call user callback if provided
            if progress_callback:
                progress_callback(module_name, result, streaming_agg)
        
        feature_results = self.run_feature_modules_streaming(
            elevation_patch.elevation_data, 
            callback=streaming_callback
        )
        
        # Step 3: Final aggregation
        final_aggregation = self.aggregator.aggregate()
        logger.info(f"Final aggregation: score={final_aggregation.final_score:.3f}, "
                   f"confidence={final_aggregation.confidence:.3f}")
        
        # Step 4: Make detection decision
        detection_threshold = self.detection_threshold
        detected = final_aggregation.final_score >= detection_threshold
        
        # Generate comprehensive result
        result = G2DetectionResult(
            detected=detected,
            confidence=final_aggregation.confidence,
            final_score=final_aggregation.final_score,
            base_score=base_score,  # G₂ base score instead of phi0_score
            aggregation_result=final_aggregation,
            feature_results=feature_results,
            refinement_attempts=0,  # No refinement in streaming mode
            refinement_history=[final_aggregation],
            reason=f"G₂ streaming detection: {final_aggregation.reason}",
            metadata={
                "base_score": base_score,
                "detection_threshold": detection_threshold,
                "structure_type": self.structure_type,
                "feature_module_count": len(self.feature_modules),
                "streaming_results": streaming_results,
                "early_decision_points": [sr for sr in streaming_results 
                                        if sr['aggregation'].early_decision_possible]
            }
        )
        
        logger.info(f"🌊 G₂ streaming detection completed: detected={detected}, "
                   f"confidence={final_aggregation.confidence:.3f}")
        return result
    
    def run_feature_modules_parallel(self, elevation_patch: np.ndarray) -> Dict[str, FeatureResult]:
        """
        Run all feature modules in parallel (traditional batch mode)
        
        Args:
            elevation_patch: 2D elevation data array
            
        Returns:
            Dictionary mapping module names to their results
        """
        results = {}
        
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all feature computations
            future_to_module = {
                executor.submit(module.compute, elevation_patch): name
                for name, module in self.feature_modules.items()
            }
            
            # Collect results as they complete
            for future in as_completed(future_to_module):
                module_name = future_to_module[future]
                try:
                    result = future.result(timeout=30)  # 30 second timeout per module
                    results[module_name] = result
                    logger.debug(f"Module {module_name} completed: score={result.score:.3f}")
                except Exception as e:
                    logger.warning(f"Module {module_name} failed: {e}")
                    results[module_name] = FeatureResult(
                        score=0.0,
                        valid=False,
                        reason=f"Computation failed: {str(e)}"
                    )
        
        return results
