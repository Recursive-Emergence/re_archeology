# G₂ Kernel Tests

This directory contains test scripts for the G₂ kernel system.

## Test Files

### Core Tests
- **`test_minimal.py`** - Clean, minimal test suite demonstrating core functionality
- **`test_optimized.py`** - Tests for the G₂ aggregation and feature modules
- **`test_visualization.py`** - Visualization tests for detection results

### Profile System Tests  
- **`test_profile_basic.py`** - Basic DetectorProfile functionality
- **`test_profile_advanced.py`** - Advanced profile features (persistence, optimization)
- **`test_detector_profile.py`** - Comprehensive profile system tests
- **`test_profile_integration.py`** - Integration between DetectorProfile and G2StructureDetector

## Usage

Run the minimal test suite:
```bash
python test_minimal.py
```

Run all tests:
```bash
python test_*.py
```

## Key Features Tested

✅ **Profile Creation** - Basic and advanced profile configurations  
✅ **Feature Modules** - Individual feature computation and aggregation  
✅ **Profile Integration** - DetectorProfile + G2StructureDetector integration
✅ **Persistence** - Save/load profile functionality  
✅ **Optimization** - Structure-type specific optimizations  
✅ **Geometry** - Resolution, patch size, and shape configurations  
✅ **Performance** - Speed vs accuracy trade-off testing
