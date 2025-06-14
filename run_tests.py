#!/usr/bin/env python3
"""
Run all kernel tests

This script runs all test files in the kernel/tests directory.
"""

import os
import sys
import subprocess
from pathlib import Path

def run_all_tests():
    """Run all test files in kernel/tests directory"""
    tests_dir = Path(__file__).parent / "kernel" / "tests"
    
    if not tests_dir.exists():
        print(f"❌ Tests directory not found: {tests_dir}")
        return False
    
    # Find all test files
    test_files = list(tests_dir.glob("test_*.py"))
    
    if not test_files:
        print("❌ No test files found")
        return False
    
    print(f"🧪 Running {len(test_files)} test files...")
    print("=" * 60)
    
    results = []
    for test_file in sorted(test_files):
        print(f"\n🔬 Running {test_file.name}")
        print("-" * 40)
        
        try:
            # Run the test
            env = os.environ.copy()
            env["PYTHONPATH"] = str(Path(__file__).parent)
            
            result = subprocess.run(
                [sys.executable, str(test_file)],
                cwd=str(Path(__file__).parent),
                env=env,
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if result.returncode == 0:
                print(f"✅ {test_file.name} PASSED")
                results.append(True)
            else:
                print(f"❌ {test_file.name} FAILED")
                print("STDOUT:", result.stdout[-500:] if result.stdout else "None")
                print("STDERR:", result.stderr[-500:] if result.stderr else "None")
                results.append(False)
                
        except subprocess.TimeoutExpired:
            print(f"⏰ {test_file.name} TIMEOUT")
            results.append(False)
        except Exception as e:
            print(f"💥 {test_file.name} ERROR: {e}")
            results.append(False)
    
    # Summary
    passed = sum(results)
    total = len(results)
    
    print("\n" + "=" * 60)
    print(f"🎯 Test Summary: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed!")
        return True
    else:
        print(f"❌ {total - passed} tests failed")
        return False

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
