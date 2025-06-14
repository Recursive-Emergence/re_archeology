# G₂ Kernel Architecture Documentation

## 🎯 **Overview**

The G₂ (second-generation geometric) detection kernel represents a fundamental architectural evolution in archaeological structure detection. It implements a modular, feature-driven system that maintains theoretical alignment with the φ⁰ (phi-zero) emergence theorem while providing complete independence and abstraction from legacy implementations.

**Core Architectural Principles:**
- 🧬 **Theorem Alignment**: Maintains φ⁰ theoretical foundations through abstracted feature modules
- 🏗️ **Independence**: Complete separation from legacy φ⁰ implementation dependencies
- 🧩 **Modularity**: Feature-driven architecture with composable detection modules
- 🌊 **Streaming Design**: Progressive aggregation with early decision capabilities
- 🔧 **Extensibility**: Registry-based module system for easy enhancement

---

## 🧬 **Theoretical Foundation: φ⁰ to G₂ Evolution**

### **φ⁰ Emergence Theorem - The Foundation**

The φ⁰ theorem establishes the mathematical foundation for detecting emergent circular structures through geometric pattern recognition. It defines the principle that archaeological structures manifest as localized geometric anomalies that break environmental uniformity through specific mathematical signatures.

**Core φ⁰ Principles:**
- **Circular Emergence**: Structures emerge as radially symmetric patterns
- **Geometric Coherence**: Internal structure resolution through mathematical analysis
- **Environmental Contrast**: Structures differentiate from background terrain patterns
- **Scale Independence**: Pattern recognition across multiple resolution levels

### **G₂ Abstraction Layer - The Evolution**

The G₂ system extracts and abstracts the core φ⁰ principles into a modular, feature-driven architecture. Rather than relying on a monolithic φ⁰ implementation, G₂ decomposes the theorem into independent, composable feature modules that collectively implement the theoretical framework.

**Abstraction Benefits:**
- **Theorem Preservation**: Core φ⁰ mathematics maintained through feature modules
- **Implementation Independence**: Separation of theory from specific implementation
- **Enhanced Modularity**: Individual aspects of φ⁰ become discrete, testable components
- **Progressive Enhancement**: Ability to refine and extend theoretical components independently

### **Architectural Transition: Legacy to Modern**

```
φ⁰ Monolithic Implementation          G₂ Modular Abstraction
─────────────────────────            ─────────────────────────
├─ phi0_core.py (legacy)             ├─ Feature Module Registry
│  ├─ Histogram similarity    ────▶  │  ├─ ElevationHistogramModule
│  ├─ Geometric validation           │  ├─ VolumeAnalysisModule  
│  ├─ Pattern recognition            │  ├─ CompactnessModule
│  └─ Monolithic scoring      ────▶  │  └─ [Additional modules...]
└─ Tightly coupled design            └─ StreamingDetectionAggregator
                                        (Progressive theorem application)
```

**Legacy Theoretical Influence:**
The original φ⁰ core provided crucial insights, particularly the elevation histogram similarity algorithm, which forms the primary feature module in the G₂ system. This module carries the highest weight (1.5) as it directly implements the core φ⁰ pattern recognition principle. However, the G₂ architecture abstracts this into a modular component while preserving the underlying mathematical theory.

---

## 🧩 **Modular Feature Hierarchy - Theorem Decomposition**

The G₂ system decomposes φ⁰ theorem principles into ordered, weighted feature modules that collectively implement the mathematical framework:

### **1. Elevation Histogram Similarity** → **Core Attractor (ψ⁰)**
- **Theoretical Role**: Primary φ⁰ pattern recognition - localized "bump" detection
- **Weight**: 1.5 (highest priority - extracted from φ⁰ core)
- **Mathematical Foundation**: Implements the core circular emergence detection principle
- **Independence**: Fully abstracted from legacy φ⁰ implementation

### **2. Volume Analysis** → **Structural Magnitude**
- **Theoretical Role**: Quantifies the three-dimensional significance of detected patterns
- **Weight**: 1.3
- **Purpose**: Validates that histogram patterns correspond to meaningful structural volume

### **3. Dropoff Sharpness** → **Boundary Definition**
- **Theoretical Role**: Measures edge clarity and structural boundary definition
- **Weight**: 1.2
- **Purpose**: Differentiates engineered structures from natural terrain features

### **4. Compactness** → **Shape Coherence**
- **Theoretical Role**: Validates geometric consistency and radial symmetry
- **Weight**: 1.1
- **Purpose**: Ensures detected patterns exhibit the circular coherence predicted by φ⁰

### **5. Entropy Analysis** → **Pattern Complexity**
- **Theoretical Role**: Measures structural organization versus environmental randomness
- **Weight**: 1.0
- **Purpose**: Validates that patterns represent organized, non-random formations

### **6. Planarity** → **Surface Characterization**
- **Theoretical Role**: Analyzes surface flatness characteristic of constructed platforms
- **Weight**: 0.9
- **Purpose**: Distinguishes constructed surfaces from natural topographical variations

---

## 🔄 **Bidirectional Evidence Resolution - G₂ Evolution**

### **The Overengineering Problem: Fixed**

**Previous Architecture Issue**: Features were inherently classified as "positive" or "negative" modules, creating rigid dualism that limited adaptability and theoretical flexibility.

**G₂ Solution**: **Unified Neutral Features with Dynamic Polarity Resolution**

All feature modules now provide neutral evidence scores. The high-level G₂ aggregator determines:
- **Polarity**: Whether evidence supports or contradicts structure detection
- **Weight**: Dynamic importance based on context and confidence
- **Reconciliation**: How conflicting evidence should be resolved

---

### **Unified Feature Architecture**

```python
class UnifiedFeatureModule(BaseFeatureModule):
    """Neutral feature modules that provide evidence without inherent polarity"""
    
    def compute(self, data: np.ndarray) -> FeatureResult:
        # Features compute neutral evidence scores [0,1]
        evidence_strength = calculate_evidence()
        
        return FeatureResult(
            score=evidence_strength,
            polarity="neutral",  # No inherent bias
            metadata={"raw_metrics": {...}}
        )
```

### **Dynamic Polarity Resolution**

The G₂ aggregator dynamically interprets feature evidence based on:

| Feature Module | Context | Polarity Assignment | Weight |
|----------------|---------|-------------------|---------|
| `EntropyAnalysis` | High entropy | **Negative** (chaos contradicts structure) | 1.0 |
| `EntropyAnalysis` | Low entropy | **Positive** (order supports structure) | 0.8 |
| `VolumeAnalysis` | Significant volume | **Positive** (meaningful structure) | 1.3 |
| `VolumeAnalysis` | Excessive volume | **Negative** (likely natural feature) | 1.2 |
| `DropoffSharpness` | Sharp edges | **Positive** (constructed boundaries) | 1.2 |
| `DropoffSharpness` | Gradual edges | **Negative** (natural erosion) | 1.0 |

### **Bidirectional Aggregation Formula**

```python
def resolve_evidence(feature_results: List[FeatureResult]) -> BiDirectionalScore:
    """Dynamic evidence resolution with context-aware polarity assignment"""
    
    positive_evidence = 0.0
    negative_evidence = 0.0
    total_weight = 0.0
    
    for feature in feature_results:
        # Dynamic polarity assignment based on evidence context
        polarity, weight = determine_polarity_and_weight(feature)
        
        if polarity == "positive":
            positive_evidence += feature.score * weight
        elif polarity == "negative":
            negative_evidence += feature.score * weight
            
        total_weight += weight
    
    # Bidirectional resolution: evidence conflict becomes informative
    final_score = 0.5 + ((positive_evidence - negative_evidence) / total_weight) * 0.5
    confidence = calculate_confidence_from_agreement(positive_evidence, negative_evidence)
    
    return BiDirectionalScore(final_score, confidence, positive_evidence, negative_evidence)
```

---

### **Benefits of Unified Architecture**

1. **🧬 Theoretical Flexibility**: Features adapt to context rather than rigid classification
2. **🔄 Dynamic Adaptation**: Same feature can support or contradict based on magnitude/context  
3. **🎯 Reduced Overengineering**: Eliminates artificial positive/negative module separation
4. **📊 Better Reconciliation**: High-level aggregator makes informed polarity decisions
5. **🚀 Extensibility**: New features don't need polarity pre-classification

---

### **Evidence Reconciliation Example**

```text
G₂ Score: 0.72 (confidence: 0.89)

🔍 EVIDENCE ANALYSIS:
✔ ElevationHistogram: 0.91 → Positive (strong φ⁰ signature) [Weight: 1.5]
✔ VolumeAnalysis: 0.85 → Positive (meaningful structure) [Weight: 1.3]  
✘ EntropyAnalysis: 0.73 → Negative (moderate chaos detected) [Weight: 1.0]
✔ DropoffSharpness: 0.82 → Positive (clear boundaries) [Weight: 1.2]
⚖ CompactnessAnalysis: 0.68 → Neutral (inconclusive) [Weight: 0.8]

RECONCILIATION:
→ Strong geometric evidence (histogram + dropoff) outweighs moderate entropy penalty
→ Volume confirms meaningful 3D structure  
→ Final determination: Likely archaeological structure with natural variation
```

This eliminates the overengineered dualism while maintaining sophisticated evidence resolution!

---

## 🏗️ **Independent G₂ Architecture**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    INDEPENDENT G₂ DETECTION SYSTEM                         │
│                        (Zero φ⁰ Implementation Dependencies)               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌───────────────────────────────────────────────┐   │
│  │   G₂ Base       │    │              Feature Module Registry         │   │
│  │   Controller    │    │             (6 Independent Modules)          │   │
│  │                 │    │                                               │   │
│  │  • Base: 0.5    │    │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│  │  • Feature-     │────┼─▶│ Histogram   │ │   Volume    │ │  Dropoff    │ │
│  │    Driven       │    │  │ Similarity  │ │  Analysis   │ │  Sharpness  │ │
│  │  • Independent  │    │  │ (W: 1.5)    │ │ (W: 1.3)    │ │ (W: 1.2)    │ │
│  │                 │    │  │ φ⁰-derived  │ │             │ │             │ │
│  └─────────────────┘    │  └─────────────┘ └─────────────┘ └─────────────┘ │
│                         │                                                   │
│                         │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│                         │  │ Compactness │ │  Entropy    │ │ Planarity   │ │
│                         │  │  Analysis   │ │  Analysis   │ │  Analysis   │ │
│                         │  │ (W: 1.1)    │ │ (W: 1.0)    │ │ (W: 0.9)    │ │
│                         │  │             │ │             │ │             │ │
│                         │  └─────────────┘ └─────────────┘ └─────────────┘ │
│                         └───────────────────────────────────────────────┘   │
│                                          │                                  │
│                         ┌────────────────▼────────────────┐                 │
│                         │     ThreadPoolExecutor          │                 │
│                         │   (Parallel Feature Execution)   │                 │
│                         │                                 │                 │
│                         │  Module 1 ────┐                │                 │
│                         │  Module 2 ────┼─▶ Results      │                 │
│                         │  Module 3 ────┘   Queue        │                 │
│                         │  Module 4 ────┐   (as_completed)│                 │
│                         │  Module 5 ────┘                │                 │
│                         │  Module 6 ────┘                │                 │
│                         └─────────────────────────────────┘                 │
│                                          │                                  │
│                         ┌────────────────▼────────────────┐                 │
│                         │    StreamingDetectionAggregator │                 │
│                         │         (Independent)           │                 │
│                         │                                 │                 │
│                         │  • Progressive Score Calculation│                 │
│                         │  • Real-time Confidence Updates │                 │
│                         │  • Early Decision Detection     │                 │
│                         │  • Weighted Module Integration  │                 │
│                         │                                 │                 │
│                         │  Progressive Aggregation:       │                 │
│                         │  ├─ Base Score: 0.5 (neutral)  │                 │
│                         │  ├─ Histogram: +weighted score │                 │
│                         │  ├─ Volume: +weighted score    │                 │
│                         │  ├─ [Additional modules...]    │                 │
│                         │  └─ Final: Weighted sum/count  │                 │
│                         └─────────────────────────────────┘                 │
│                                          │                                  │
│                         ┌────────────────▼────────────────┐                 │
│                         │     G2DetectionResult           │                 │
│                         │        (Independent)            │                 │
│                         │                                 │                 │
│                         │  • Final Score: [0.0 - 1.0]    │                 │
│                         │  • Confidence: [0.0 - 1.0]     │                 │
│                         │  • Detected: Boolean           │                 │
│                         │  • Base Score: 0.5 (G₂-driven) │                 │
│                         │  • Streaming History           │                 │
│                         │  • Early Decision Points       │                 │
│                         │  • Feature Module Results      │                 │
│                         └─────────────────────────────────┘                 │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                          REAL-TIME CALLBACK SYSTEM                         │
│                                                                             │
│  Progress Callback: module_name, result, streaming_aggregation             │
│  ├─ Real-time UI Updates                                                    │
│  ├─ Early Decision Notifications                                            │
│  ├─ Confidence Trend Analysis                                               │
│  └─ Module Priority Suggestions                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🌊 **Streaming Aggregation - Progressive Theorem Application**

The G₂ system implements progressive theorem application through streaming aggregation, allowing real-time confidence assessment and early decision making:

### **Streaming Algorithm**
```python
# Theoretical foundation: progressive evidence accumulation
base_score = 0.5  # Neutral starting point (feature-driven)

for module_result in completed_modules:
    weighted_score = module_result.score * module_result.weight
    total_weighted_sum += weighted_score
    total_weight += module_result.weight
    
    # Progressive confidence calculation
    current_score = base_score + (total_weighted_sum / total_weight - 0.5) * 0.5
    confidence = calculate_confidence(completed_modules, remaining_modules)
    
    # Early decision potential
    if confidence > early_termination_threshold:
        # Optional: terminate remaining modules for efficiency
        break
```

### **Confidence Calculation**
The confidence metric represents the statistical reliability of the current score based on the number and weights of completed modules:

```python
def calculate_confidence(completed_modules, remaining_modules):
    completed_weight = sum(m.weight for m in completed_modules)
    total_weight = completed_weight + sum(m.weight for m in remaining_modules)
    return completed_weight / total_weight
```

---

## 🚀 **Architecture Benefits and Future Development**

### **Achieved Independence**
- ✅ **Zero Legacy Dependencies**: Complete removal of φ⁰ core implementation dependencies
- ✅ **Theorem Preservation**: Core mathematical principles maintained through abstraction
- ✅ **Enhanced Modularity**: Individual feature modules are independently testable and extensible
- ✅ **Streaming Capability**: Real-time progressive decision making with early termination potential

### **Extensibility Framework**
The G₂ architecture provides a foundation for continuous enhancement:

**Feature Module Extension**:
```python
class NewFeatureModule(FeatureModule):
    def __init__(self, weight: float = 1.0):
        super().__init__(weight)
    
    def compute(self, patch: ElevationPatch) -> FeatureResult:
        # Implement new φ⁰-aligned detection logic
        return FeatureResult(score=computed_score, metadata={...})
```

**Weight Optimization**:
- Dynamic weight adjustment based on terrain type
- Machine learning-based weight optimization
- Context-aware feature importance adaptation

**Advanced Aggregation**:
- Multi-scale recursive refinement
- Uncertainty quantification
- Probabilistic decision frameworks

### **Future Theoretical Development**
The G₂ architecture enables advanced theoretical exploration while maintaining φ⁰ alignment:

1. **Enhanced Geometric Analysis**: Additional φ⁰-derived feature modules
2. **Scale-Adaptive Detection**: Multi-resolution φ⁰ theorem application
3. **Probabilistic Frameworks**: Uncertainty quantification in structure detection
4. **Contextual Enhancement**: Terrain-aware feature weighting and selection

---

## 📋 **Implementation Status**

### **✅ Completed Architecture**
- **Core G₂ System**: Fully independent, modular detection framework
- **Feature Modules**: 6 active modules with optimized weights
- **Streaming Aggregation**: Progressive decision making with early termination detection
- **Legacy Transition**: Complete removal of φ⁰ implementation dependencies
- **Theorem Alignment**: Preservation of φ⁰ mathematical principles through abstraction

### **🎯 Future Enhancement Opportunities**
- **Smart Early Termination**: Actual module cancellation based on confidence thresholds
- **Dynamic Weight Optimization**: Adaptive weighting based on context and performance
- **Advanced Feature Modules**: Additional φ⁰-derived detection components
- **Production Deployment**: API integration and real-time visualization systems

The G₂ kernel represents a successful evolution from monolithic φ⁰ implementation to a modular, extensible, and theoretically grounded detection system that maintains the mathematical rigor of the original theorem while providing modern architectural benefits.
