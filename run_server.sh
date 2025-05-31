#!/bin/bash

# Clean startup script for RE-Archaeology Framework
# This script ensures a clean environment without system library conflicts

# Navigate to project directory
cd "$(dirname "$0")"

# Clear any conflicting environment variables
unset PYTHONPATH
unset VIRTUAL_ENV

# Activate the virtual environment
source venv/bin/activate

# Verify we're using the correct Python
echo "Using Python: $(which python)"
echo "Python version: $(python --version)"

# Set clean PYTHONPATH for our project only
export PYTHONPATH="/media/im2/plus/lab4/RE/re_archaeology"

# Start the server
echo "Starting RE-Archaeology Framework server..."
python -c "
import sys
print('Python executable:', sys.executable)
print('Python path entries:')
for path in sys.path:
    print(f'  {path}')
"

# Start uvicorn with the FastAPI app
source venv/bin/activate
cd /media/im2/plus/lab4/RE/re_archaeology && python3 -m uvicorn backend.api.main:app --reload --host 0.0.0.0 --port 8080