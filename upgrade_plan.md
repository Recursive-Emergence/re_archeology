# Upgrade Plan for Task Management and Bella Integration

## Overview
This document outlines the steps to upgrade the current implementation to support advanced task management with session-based execution, profile-driven scanning, user authorization, and Bella's enhanced conversational task management capabilities.

---

## 1. Backend Task Management

### **Task Model**
- Define a `Task` model with the following attributes:
  - `id`: UUID
  - `type`: string (e.g., "scan_and_detect")
  - `status`: enum ("pending", "running", "paused", "completed", "aborted", "stopped")
  - `start_coordinates`: geo (lat/lon)
  - `range`: object (e.g., `{width_km: 50, height_km: 30}`)
  - `profiles`: list of profile names/IDs to use for scanning
  - `progress`: object (e.g., `{scan: 45, detection: 20, overall: 32}`)
  - `findings`: list of objects (e.g., `{coordinates, structure_type, score, profile_used}`)
  - `decay_value`: float (calculated based on findings quality and time)
  - `sessions`: object containing active session IDs
  - `created_at`: timestamp
  - `updated_at`: timestamp
  - `completed_at`: timestamp (nullable)

### **Session Management**
- Define `ScanSession` and `DetectionSession` models:
  - **ScanSession**: Handles LiDAR data acquisition using specified profiles
    - `id`: UUID
    - `task_id`: Foreign key to parent task
    - `profile_id`: Profile used for scanning
    - `status`: enum ("active", "paused", "stopped", "completed")
    - `scan_progress`: float (0-100)
    - `current_coordinates`: geo position
    - `lidar_data_stream`: real-time data for UI visualization
  - **DetectionSession**: Processes scan data for archaeological findings
    - `id`: UUID
    - `task_id`: Foreign key to parent task
    - `profile_ids`: List of profiles used for detection algorithms
    - `status`: enum ("active", "paused", "stopped", "completed")
    - `detection_progress`: float (0-100)
    - `findings_buffer`: temporary storage for detected structures

### **Task Execution**
- Implement asynchronous task execution with session management:
- Example:
  ```python
  async def execute_task(task_id, start_coordinates, task_range, profiles):
      task = tasks[task_id]
      task["status"] = "running"
      
      # Initialize sessions
      scan_session = create_scan_session(task_id, profiles)
      detection_session = create_detection_session(task_id, profiles)
      task["sessions"] = {
          "scan": scan_session["id"],
          "detection": detection_session["id"]
      }
      
      # Execute sessions concurrently
      await asyncio.gather(
          execute_scan_session(scan_session, start_coordinates, task_range),
          execute_detection_session(detection_session, scan_session["id"])
      )
      
      task["status"] = "completed"
      task["completed_at"] = datetime.utcnow()
  ```

### **Profile-Based Scanning**
- Integrate with existing profile system for LiDAR data acquisition:
  ```python
  async def execute_scan_session(session, coordinates, range_config):
      profile = load_profile(session["profile_id"])
      
      for scan_point in generate_scan_pattern(coordinates, range_config):
          if session["status"] != "active":
              break  # Handle pause/stop
              
          lidar_data = await acquire_lidar_data(scan_point, profile)
          
          # Stream data to frontend via WebSocket
          await broadcast_lidar_data(session["task_id"], {
              "coordinates": scan_point,
              "heatmap_data": lidar_data,
              "progress": session["scan_progress"]
          })
          
          session["scan_progress"] += increment
          session["current_coordinates"] = scan_point
  ```

### **Task Decay Logic**
- Implement enhanced decay calculation based on findings quality and time:
  ```python
  def calculate_task_decay(task):
      # Base decay from time
      days_elapsed = (datetime.utcnow() - task["created_at"]).days
      time_decay = 0.9 ** (days_elapsed / 7)  # 7-day half-life
      
      # Quality multiplier based on findings
      if not task["findings"]:
          quality_multiplier = 0.1  # Low value for tasks with no findings
      else:
          avg_score = sum(f["score"] for f in task["findings"]) / len(task["findings"])
          quality_multiplier = min(1.0, avg_score / 0.8)  # Scale to 0-1
      
      task["decay_value"] = time_decay * quality_multiplier
      return task["decay_value"]
  ```
- Only send tasks with decay_value >= 0.1 to frontend for display.

---

## 2. User Authorization and Bella Integration

### **User Authorization**
- Store authorized users in `users/admins.json` with their Gmail accounts.
- Use Google OAuth for authentication and verify against the stored list.
- Only Admin users can execute Bella's command handling for task management.

### **Bella Conversational Task Management**
- Bella interprets natural language conversations to extract task management commands
- **Task Action Verbs Analysis**:
  - **Initialize/Start**: "start", "begin", "initiate", "launch", "create"
  - **Pause**: "pause", "suspend", "hold", "temporarily stop"
  - **Resume**: "resume", "continue", "restart", "unpause"
  - **Abort**: "abort", "cancel", "terminate", "kill"
  - **Stop**: "stop", "end", "halt", "finish"
  - **Modify**: "change", "update", "adjust", "modify"
  - **Status**: "status", "progress", "check", "how is", "what's happening"

### **Bella Command Processing**
- Bella uses NLP to parse user conversations and extract task information:
  ```python
  async def process_conversation(user_message, conversation_history):
      # Extract intent and parameters from conversation
      intent = extract_task_intent(user_message, conversation_history)
      
      if intent["action"] in ["start", "initiate"]:
          task_params = {
              "start_coordinates": intent.get("coordinates"),
              "range": intent.get("range"),
              "profiles": intent.get("profiles", ["default_windmill"])
          }
          return await create_and_start_task(task_params)
          
      elif intent["action"] in ["pause", "suspend"]:
          return await pause_task_and_sessions(intent.get("task_id"))
          
      elif intent["action"] in ["abort", "cancel"]:
          return await abort_task_and_sessions(intent.get("task_id"))
          
      elif intent["action"] in ["stop", "halt"]:
          return await stop_task_and_sessions(intent.get("task_id"))
          
      elif intent["action"] in ["resume", "continue"]:
          return await resume_task_and_sessions(intent.get("task_id"))
  ```

- Example conversation patterns:
  - "Let's scan the area around Amsterdam with the new windmill profile"
  - "Pause the current scan, I need to check something"
  - "Abort that task, the coordinates were wrong"
  - "How's the detection going? Any findings yet?"

### **Session Control Integration**
- When tasks are paused/aborted/stopped, their underlying sessions are automatically controlled:
  ```python
  async def pause_task_and_sessions(task_id):
      task = get_task(task_id)
      task["status"] = "paused"
      
      # Pause all active sessions
      for session_type, session_id in task["sessions"].items():
          session = get_session(session_id)
          session["status"] = "paused"
          
      await broadcast_task_update(task_id, "paused")
  ```

---

## 3. Frontend Enhancements

### **Unified Task Display Logic**
- Implement a single, consistent logic for displaying tasks:
  ```javascript
  function displayTasks(tasks) {
      // Filter tasks by decay value (backend only sends decay_value >= 0.1)
      const visibleTasks = tasks.filter(task => task.decay_value >= 0.1);
      
      visibleTasks.forEach(task => {
          if (task.status === "running") {
              // Show active scanning animation and real-time heatmap
              displayActiveTask(task);
          } else {
              // Show historical task with decay-based dimming
              displayHistoricalTask(task, task.decay_value);
          }
      });
  }
  ```

### **Real-time Task Visualization**
- For running tasks, display:
  - **Scan Animation**: Real-time progress indicator showing current scan position
  - **LiDAR Heatmap**: Live elevation/intensity data streamed from backend
  - **Detection Overlays**: Findings as they are discovered
  ```javascript
  function displayActiveTask(task) {
      // Update scan animation based on current coordinates
      updateScanAnimation(task.sessions.scan.current_coordinates);
      
      // Render real-time lidar heatmap
      renderLidarHeatmap(task.lidar_data_stream);
      
      // Show progress indicators
      updateProgressBars({
          scan: task.progress.scan,
          detection: task.progress.detection,
          overall: task.progress.overall
      });
  }
  ```

### **Historical Task Overlay**
- Display completed tasks on map with decay-based visual effects:
  ```javascript
  function displayHistoricalTask(task, decayValue) {
      const opacity = Math.max(0.1, decayValue); // Minimum 10% opacity
      const brightness = 0.3 + (decayValue * 0.7); // Scale brightness
      
      // Render task area with dimmed appearance
      renderTaskArea(task.start_coordinates, task.range, {
          opacity: opacity,
          brightness: brightness,
          findings: task.findings
      });
  }
  ```

### **Repurposed Control Panel - Task List**
- Transform the existing control panel into an interactive task list:
  ```javascript
  function renderTaskList(tasks) {
      const taskListContainer = document.getElementById('control-panel');
      taskListContainer.innerHTML = '';
      
      tasks.forEach(task => {
          const taskItem = createTaskListItem(task);
          taskItem.addEventListener('click', () => navigateToTask(task));
          taskListContainer.appendChild(taskItem);
      });
  }
  
  function createTaskListItem(task) {
      const item = document.createElement('div');
      item.className = `task-item task-${task.status}`;
      
      // Color coding based on decay value and status
      const colorIntensity = Math.max(0.3, task.decay_value);
      const statusColor = getTaskStatusColor(task.status);
      
      item.style.borderLeft = `4px solid ${statusColor}`;
      item.style.backgroundColor = `rgba(${statusColor}, ${colorIntensity * 0.1})`;
      
      item.innerHTML = `
          <div class="task-header">
              <span class="task-id">${task.id.slice(0, 8)}</span>
              <span class="task-status ${task.status}">${task.status}</span>
          </div>
          <div class="task-details">
              <div class="task-location">${formatCoordinates(task.start_coordinates)}</div>
              <div class="task-range">${task.range.width_km}×${task.range.height_km} km</div>
              <div class="task-findings">${task.findings.length} findings</div>
          </div>
          <div class="task-progress">
              ${task.status === 'running' ? renderProgressBar(task.progress) : ''}
          </div>
      `;
      
      return item;
  }
  ```

### **Task Navigation and Zoom**
- Implement smart navigation to task regions with optimal zoom levels:
  ```javascript
  function navigateToTask(task) {
      const { start_coordinates, range } = task;
      
      // Calculate bounding box for the task area
      const bounds = calculateTaskBounds(start_coordinates, range);
      
      // Determine optimal zoom level based on range size
      const optimalZoom = calculateOptimalZoom(range);
      
      // Animate map to task location
      map.flyToBounds(bounds, {
          padding: [50, 50], // Add padding around the area
          duration: 1.5,
          zoom: optimalZoom
      });
      
      // Highlight the selected task
      highlightTaskOnMap(task);
      
      // Update task list to show selection
      updateTaskListSelection(task.id);
  }
  
  function calculateOptimalZoom(range) {
      // Dynamic zoom calculation based on range size
      const maxDimension = Math.max(range.width_km, range.height_km);
      
      if (maxDimension <= 5) return 14;        // City level
      else if (maxDimension <= 15) return 12;  // District level
      else if (maxDimension <= 50) return 10;  // Regional level
      else return 8;                           // Country level
  }
  
  function getTaskStatusColor(status) {
      const colors = {
          'running': '#4CAF50',     // Green
          'completed': '#2196F3',   // Blue
          'paused': '#FF9800',      // Orange
          'aborted': '#F44336',     // Red
          'stopped': '#9E9E9E',     // Gray
          'pending': '#FFEB3B'      // Yellow
      };
      return colors[status] || '#9E9E9E';
  }
  ```

### **Task Rectangle Visualization**
- Display task areas as colored rectangles with value-based styling:
  ```javascript
  function renderTaskRectangle(task) {
      const rectangle = L.rectangle(
          calculateTaskBounds(task.start_coordinates, task.range),
          {
              color: getTaskStatusColor(task.status),
              weight: task.status === 'running' ? 3 : 1,
              opacity: Math.max(0.3, task.decay_value),
              fillColor: getTaskStatusColor(task.status),
              fillOpacity: task.decay_value * 0.2,
              className: `task-rectangle task-${task.status}`
          }
      );
      
      // Add pulsing animation for running tasks
      if (task.status === 'running') {
          rectangle.setStyle({ className: 'task-rectangle running pulse' });
      }
      
      // Add click handler for navigation
      rectangle.on('click', () => navigateToTask(task));
      
      // Add tooltip with task information
      rectangle.bindTooltip(`
          <div class="task-tooltip">
              <strong>Task ${task.id.slice(0, 8)}</strong><br>
              Status: ${task.status}<br>
              Findings: ${task.findings.length}<br>
              Range: ${task.range.width_km}×${task.range.height_km} km
          </div>
      `);
      
      return rectangle;
  }
  ```

### **Simplified UI Controls**
- Remove "Start Scan" button for non-admin users
- Admin users interact through Bella's chat interface for task management
- Control panel now serves as interactive task list with navigation
- Display real-time task status and progress through consistent visual indicators

---

## 4. Bella's Enhanced Status Loop

### **Conversational Progress Updates**
- Bella provides natural, contextual updates based on task progress and findings:
  ```python
  async def bella_status_loop():
      while True:
          for task in get_active_tasks():
              if should_provide_update(task):
                  update_message = generate_contextual_update(task)
                  await send_bella_message(update_message)
          
          await asyncio.sleep(30)  # Check every 30 seconds
  
  def generate_contextual_update(task):
      if task["progress"]["scan"] > 0 and task["progress"]["detection"] == 0:
          return f"Scanning is {task['progress']['scan']:.0f}% complete. Using {len(task['profiles'])} profiles for comprehensive coverage."
      
      elif len(task["findings"]) > 0:
          latest_finding = task["findings"][-1]
          return f"Interesting! I found a {latest_finding['structure_type']} at coordinates {latest_finding['coordinates']} with confidence {latest_finding['score']:.1%}."
      
      elif task["status"] == "completed":
          total_findings = len(task["findings"])
          return f"Scan complete! Discovered {total_findings} potential archaeological structures. The data quality is excellent for further analysis."
  ```

### **Epistemic Updates and Insights**
- Bella analyzes patterns in findings and provides archaeological insights:
  - "The structures we're finding show a linear pattern - possibly an ancient road system"
  - "This detection pattern is consistent with Bronze Age settlements"
  - "The LiDAR intensity suggests buried stone foundations - very promising!"

---

## Next Steps

1. **Backend Implementation**:
   - Implement Task and Session models with profile integration
   - Build conversational NLP parsing for Bella's task management
   - Create session control mechanisms (pause/resume/abort/stop)
   - Integrate with existing profile system for LiDAR data acquisition

2. **Frontend Updates**:
   - Implement unified task display logic with decay-based filtering
   - Build real-time scan animation and heatmap visualization
   - Remove manual scan controls, rely on Bella's conversational interface

3. **Bella Enhancement**:
   - Develop natural language processing for task-oriented conversations
   - Implement contextual status updates and archaeological insights
   - Create session monitoring and control integration

4. **Testing & Integration**:
   - Test full conversation → task → session → visualization workflow
   - Validate profile-based scanning with real LiDAR data
   - Ensure session state consistency across pause/resume cycles
