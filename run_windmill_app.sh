#!/bin/bash

# Netherlands Windmill Detection Streamlit App Launcher
# Based on RE's ψ⁰→φ⁰ kernel methodology

echo "🏛️ Starting Netherlands Windmill Detection App..."
echo "Based on RE's windmill detection rationales with AHN4 Lidar integration"

# Check if virtual environment exists
if [ ! -d "venv_windmill" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv_windmill
fi

# Activate virtual environment
source venv_windmill/bin/activate

# Install requirements
echo "Installing requirements..."
pip install -r requirements_windmill.txt

# Run the Streamlit app
echo "🚀 Launching windmill detection app on http://localhost:8501"
echo ""
echo "Features:"
echo "- Interactive Netherlands map with AHN4 Lidar overlay"
echo "- Click-to-analyze 100m×100m areas for windmill signatures"
echo "- Real-time ψ⁰→φ⁰ kernel detection"
echo "- 8-dimensional AHN4 feature analysis"
echo "- Trained on 3 Zaanse Schans windmills"
echo "- Validation against 4 unseen windmill locations"
echo ""

streamlit run windmill_streamlit_app.py --client.showErrorDetails=false --server.maxUploadSize=10 --browser.gatherUsageStats=false
