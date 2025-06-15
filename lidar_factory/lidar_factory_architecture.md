# LidarFactory: Global Architecture for Adaptive LIDAR Data Streaming and Roaming

## 1. Architecture Overview

**Goal:**
Create a plug-and-play LIDAR data streaming framework that supports multiple datasets (e.g., AHN4, SRTM, OpenTopo, NASADEM, etc.), with easy extensibility for new sources and methods.

---

### A. Core Components

1.  **Dataset Metadata Registry**
    *   Central registry of available LIDAR datasets, their bounds, resolution, and access method.
    *   Each dataset described by a `DatasetMetadata` object.

2.  **Connector Plugins**
    *   Each access method (GEE, OpenTopo, S3, etc.) is implemented as a subclass of `LidarConnector`.
    *   Each connector implements a `fetch_patch` method for data retrieval.

3.  **Factory Logic**
    *   `LidarMapFactory` selects the best dataset for a given location and resolution, and delegates to the appropriate connector.

4.  **Roaming Stream Buffer**
    *   `LidarStreamBuffer` manages a cache of recently accessed patches and supports prefetching for smooth roaming.

---

### B. Extensibility

*   **Adding a new dataset:**
    1.  Add a new `DatasetMetadata` entry to the registry.
    2.  Implement a new `LidarConnector` subclass if a new access method is needed.
    3.  Register the connector in `CONNECTOR_MAP`.

*   **Adding new methods:**
    *   You can add new methods to connectors (e.g., for DTM, DSM, intensity, etc.) or add new processing logic in the factory or buffer.

---

### C. Example Directory Structure

```
lidar/
    __init__.py
    registry.py         # DatasetMetadata, METADATA_REGISTRY
    connectors.py       # LidarConnector, GEEConnector, OpenTopoConnector, etc.
    factory.py          # LidarMapFactory
    stream_buffer.py    # LidarStreamBuffer
    ahn4_data_fetcher.py # Existing AHN4 fetcher, to be integrated/refactored
    ...
```

---

### D. Example Usage

```python
from lidar.stream_buffer import LidarStreamBuffer

stream = LidarStreamBuffer()
stream.start_streaming()

lat, lon = 52.4750, 4.8177 # Example coordinates
patch = stream.get(lat, lon) # Fetches the best available data

if patch and 'dsm' in patch:
    print(f"DSM patch shape: {patch['dsm'].shape}")
else:
    print("Could not retrieve patch or DSM data.")

stream.stop_streaming()
```

---

## 2. Next Steps

*   **Step 1:** Review and refine this architecture document.
*   **Step 2:** Create the directory structure and initial Python files (`registry.py`, `connectors.py`, `factory.py`, `stream_buffer.py`).
*   **Step 3:** Implement the `DatasetMetadata` class and populate `METADATA_REGISTRY` in `registry.py`.
*   **Step 4:** Implement the base `LidarConnector` and initial connector plugins (e.g., `GEEConnector`, `OpenTopoConnector`) in `connectors.py`.
    *   Integrate/refactor the existing `AHN4DataFetcher` logic into the `GEEConnector` or a dedicated `AHN4Connector`.
*   **Step 5:** Implement `LidarMapFactory` in `factory.py`.
*   **Step 6:** Implement `LidarStreamBuffer` in `stream_buffer.py`.
*   **Step 7:** Add unit tests for each component.
*   **Step 8:** Create example usage scripts to demonstrate functionality.
