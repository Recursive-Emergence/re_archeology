"""
Background Task Management Router for RE-Archaeology Framework
Provides endpoints for managing and monitoring background tasks
Optimized with connection pooling and performance monitoring
"""

import logging
import time
from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from typing import List, Optional, Dict, Any
import json
import asyncio
import uuid
from datetime import datetime, timedelta
from enum import Enum

from ...models.ontology_models import (
    BackgroundTask, TaskStatus, EntityType, User
)
from ...models.neo4j_crud import Neo4jCRUD
from ...utils.config import get_settings
from ...utils.error_handling import handle_api_error, log_performance
from .auth import get_current_user
from backend.api.routers.ai_chat import stop_task_sessions

# Configure logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/background-tasks", tags=["background-tasks"])

# Enhanced WebSocket connection manager with performance monitoring
class OptimizedConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.connection_stats = {
            'total_connections': 0,
            'active_connections': 0,
            'messages_sent': 0,
            'failed_sends': 0
        }
        self.heartbeat_interval = 30  # seconds
        self.cleanup_task = None
    
    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.connection_stats['total_connections'] += 1
        self.connection_stats['active_connections'] = len(self.active_connections)
        
        # Start cleanup task if it's the first connection
        if len(self.active_connections) == 1 and not self.cleanup_task:
            self.cleanup_task = asyncio.create_task(self.periodic_cleanup())
        
        logger.info(f"WebSocket connected for user {user_id}. Active connections: {len(self.active_connections)}")
    
    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            self.connection_stats['active_connections'] = len(self.active_connections)
            logger.info(f"WebSocket disconnected for user {user_id}. Active connections: {len(self.active_connections)}")
            
            # Stop cleanup task if no connections
            if len(self.active_connections) == 0 and self.cleanup_task:
                self.cleanup_task.cancel()
                self.cleanup_task = None
    
    async def send_personal_message(self, message: dict, user_id: str):
        if user_id in self.active_connections:
            try:
                start_time = time.time()
                await self.active_connections[user_id].send_text(json.dumps(message))
                self.connection_stats['messages_sent'] += 1
                
                # Log slow sends
                send_time = time.time() - start_time
                if send_time > 0.1:  # 100ms threshold
                    logger.warning(f"Slow WebSocket send to {user_id}: {send_time:.3f}s")
                    
            except Exception as e:
                logger.error(f"Failed to send message to {user_id}: {e}")
                self.connection_stats['failed_sends'] += 1
                self.disconnect(user_id)
    
    async def broadcast(self, message: dict, exclude_user: Optional[str] = None):
        if not self.active_connections:
            return
            
        start_time = time.time()
        tasks = []
        
        for user_id, connection in list(self.active_connections.items()):
            if exclude_user and user_id == exclude_user:
                continue
                
            try:
                task = asyncio.create_task(connection.send_text(json.dumps(message)))
                tasks.append((user_id, task))
            except Exception as e:
                logger.error(f"Failed to create send task for {user_id}: {e}")
                self.disconnect(user_id)
        
        # Wait for all sends to complete
        for user_id, task in tasks:
            try:
                await task
                self.connection_stats['messages_sent'] += 1
            except Exception as e:
                logger.error(f"Failed to broadcast to {user_id}: {e}")
                self.connection_stats['failed_sends'] += 1
                self.disconnect(user_id)
        
        broadcast_time = time.time() - start_time
        if broadcast_time > 0.5:  # 500ms threshold
            logger.warning(f"Slow broadcast to {len(tasks)} users: {broadcast_time:.3f}s")
    
    async def periodic_cleanup(self):
        """Periodic cleanup of stale connections"""
        while self.active_connections:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                
                # Send heartbeat to all connections
                heartbeat_msg = {
                    'type': 'heartbeat',
                    'timestamp': datetime.utcnow().isoformat()
                }
                
                stale_connections = []
                for user_id, connection in list(self.active_connections.items()):
                    try:
                        await connection.send_text(json.dumps(heartbeat_msg))
                    except:
                        stale_connections.append(user_id)
                
                # Remove stale connections
                for user_id in stale_connections:
                    self.disconnect(user_id)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in periodic cleanup: {e}")
    
    def get_stats(self) -> dict:
        return {
            **self.connection_stats,
            'active_connections': len(self.active_connections)
        }

# Global connection manager instance
manager = OptimizedConnectionManager()

# Task registry for background tasks
class TaskRegistry:
    def __init__(self):
        self.tasks: Dict[str, asyncio.Task] = {}
        self.task_data: Dict[str, BackgroundTask] = {}
    
    def add_task(self, task_id: str, task: asyncio.Task, task_data: BackgroundTask):
        self.tasks[task_id] = task
        self.task_data[task_id] = task_data
    
    def remove_task(self, task_id: str):
        if task_id in self.tasks:
            del self.tasks[task_id]
        if task_id in self.task_data:
            del self.task_data[task_id]
    
    def get_task(self, task_id: str) -> Optional[asyncio.Task]:
        return self.tasks.get(task_id)
    
    def get_task_data(self, task_id: str) -> Optional[BackgroundTask]:
        return self.task_data.get(task_id)
    
    def list_active_tasks(self) -> List[str]:
        return list(self.tasks.keys())

task_registry = TaskRegistry()

# Background task execution functions
async def execute_earth_engine_analysis(task_id: str, user_id: str, params: Dict[str, Any]):
    """Execute Earth Engine analysis in background"""
    try:
        # Update task status to running
        await update_task_status(task_id, TaskStatus.RUNNING, {"progress": 0})
        
        # Simulate Earth Engine analysis steps
        steps = [
            ("Initializing Earth Engine", 10),
            ("Loading satellite imagery", 25),
            ("Processing environmental data", 50),
            ("Calculating archaeological potential", 75),
            ("Generating results", 90),
            ("Finalizing analysis", 100)
        ]
        
        for step_name, progress in steps:
            await asyncio.sleep(2)  # Simulate processing time
            await update_task_status(
                task_id, 
                TaskStatus.RUNNING, 
                {
                    "progress": progress,
                    "current_step": step_name,
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
            
            # Send progress update via WebSocket
            await manager.send_personal_message({
                "type": "task_progress",
                "task_id": task_id,
                "progress": progress,
                "current_step": step_name
            }, user_id)
        
        # Complete the task
        result = {
            "analysis_id": str(uuid.uuid4()),
            "potential_sites": 15,
            "coverage_area": "25.3 km²",
            "confidence_score": 0.87,
            "generated_at": datetime.utcnow().isoformat()
        }
        
        await update_task_status(task_id, TaskStatus.COMPLETED, {"result": result})
        
        # Send completion notification
        await manager.send_personal_message({
            "type": "task_completed",
            "task_id": task_id,
            "result": result
        }, user_id)
        
    except Exception as e:
        await update_task_status(task_id, TaskStatus.FAILED, {"error": str(e)})
        await manager.send_personal_message({
            "type": "task_failed",
            "task_id": task_id,
            "error": str(e)
        }, user_id)

async def execute_data_processing(task_id: str, user_id: str, params: Dict[str, Any]):
    """Execute data processing task in background"""
    try:
        await update_task_status(task_id, TaskStatus.RUNNING, {"progress": 0})
        
        # Simulate data processing
        for i in range(0, 101, 10):
            await asyncio.sleep(1)
            await update_task_status(
                task_id, 
                TaskStatus.RUNNING, 
                {
                    "progress": i,
                    "processed_records": i * 10,
                    "timestamp": datetime.utcnow().isoformat()
                }
            )
            
            await manager.send_personal_message({
                "type": "task_progress",
                "task_id": task_id,
                "progress": i,
                "processed_records": i * 10
            }, user_id)
        
        result = {
            "processed_records": 1000,
            "created_entities": 50,
            "updated_entities": 25,
            "completed_at": datetime.utcnow().isoformat()
        }
        
        await update_task_status(task_id, TaskStatus.COMPLETED, {"result": result})
        
        await manager.send_personal_message({
            "type": "task_completed",
            "task_id": task_id,
            "result": result
        }, user_id)
        
    except Exception as e:
        await update_task_status(task_id, TaskStatus.FAILED, {"error": str(e)})
        await manager.send_personal_message({
            "type": "task_failed",
            "task_id": task_id,
            "error": str(e)
        }, user_id)

async def update_task_status(task_id: str, status: TaskStatus, metadata: Dict[str, Any]):
    """Update task status in Neo4j database"""
    try:
        with Neo4jCRUD() as db:
            query = """
            MATCH (t:BackgroundTask {task_id: $task_id})
            SET t.status = $status,
                t.metadata = $metadata,
                t.updated_at = datetime()
            RETURN t
            """
            result = db.run_query(query, {
                "task_id": task_id,
                "status": status.value,
                "metadata": json.dumps(metadata)
            })
            
            # Update in-memory task data
            if task_id in task_registry.task_data:
                task_data = task_registry.task_data[task_id]
                task_data.status = status
                task_data.metadata = metadata
                task_data.updated_at = datetime.utcnow()
                
    except Exception as e:
        print(f"Error updating task status: {e}")

# API Endpoints

@router.post("/start", response_model=Dict[str, str])
async def start_background_task(
    task_type: str,
    entity_type: EntityType,
    entity_id: Optional[str] = None,
    parameters: Optional[Dict[str, Any]] = None,
    current_user: User = Depends(get_current_user)
):
    """Start a new background task"""
    task_id = str(uuid.uuid4())
    
    # Create task record in database
    task_data = BackgroundTask(
        task_id=task_id,
        user_id=current_user.user_id,
        task_type=task_type,
        entity_type=entity_type,
        entity_id=entity_id,
        status=TaskStatus.PENDING,
        parameters=parameters or {},
        metadata={},
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    
    try:
        with Neo4jCRUD() as db:
            query = """
            CREATE (t:BackgroundTask {
                task_id: $task_id,
                user_id: $user_id,
                task_type: $task_type,
                entity_type: $entity_type,
                entity_id: $entity_id,
                status: $status,
                parameters: $parameters,
                metadata: $metadata,
                created_at: datetime(),
                updated_at: datetime()
            })
            RETURN t
            """
            db.run_query(query, {
                "task_id": task_id,
                "user_id": current_user.user_id,
                "task_type": task_type,
                "entity_type": entity_type.value,
                "entity_id": entity_id,
                "status": TaskStatus.PENDING.value,
                "parameters": json.dumps(parameters or {}),
                "metadata": json.dumps({})
            })
        
        # Start the appropriate background task
        if task_type == "earth_engine_analysis":
            task = asyncio.create_task(
                execute_earth_engine_analysis(task_id, current_user.user_id, parameters or {})
            )
        elif task_type == "data_processing":
            task = asyncio.create_task(
                execute_data_processing(task_id, current_user.user_id, parameters or {})
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown task type: {task_type}"
            )
        
        # Register the task
        task_registry.add_task(task_id, task, task_data)
        
        return {"task_id": task_id, "status": "started"}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start task: {str(e)}"
        )

@router.get("/", response_model=List[BackgroundTask])
async def list_background_tasks(
    status_filter: Optional[TaskStatus] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    """List background tasks for the current user"""
    try:
        with Neo4jCRUD() as db:
            query = """
            MATCH (t:BackgroundTask {user_id: $user_id})
            WHERE ($status_filter IS NULL OR t.status = $status_filter)
            RETURN t
            ORDER BY t.created_at DESC
            LIMIT $limit
            """
            results = db.run_query(query, {
                "user_id": current_user.user_id,
                "status_filter": status_filter.value if status_filter else None,
                "limit": limit
            })
            
            tasks = []
            for record in results:
                task_data = record["t"]
                task = BackgroundTask(
                    task_id=task_data["task_id"],
                    user_id=task_data["user_id"],
                    task_type=task_data["task_type"],
                    entity_type=EntityType(task_data["entity_type"]),
                    entity_id=task_data.get("entity_id"),
                    status=TaskStatus(task_data["status"]),
                    parameters=json.loads(task_data.get("parameters", "{}")),
                    metadata=json.loads(task_data.get("metadata", "{}")),
                    created_at=task_data["created_at"],
                    updated_at=task_data["updated_at"]
                )
                tasks.append(task)
            
            return tasks
            
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list tasks: {str(e)}"
        )

@router.get("/{task_id}", response_model=BackgroundTask)
async def get_background_task(
    task_id: str,
    current_user: User = Depends(get_current_user)
):
    """Get details of a specific background task"""
    try:
        with Neo4jCRUD() as db:
            query = """
            MATCH (t:BackgroundTask {task_id: $task_id, user_id: $user_id})
            RETURN t
            """
            results = db.run_query(query, {
                "task_id": task_id,
                "user_id": current_user.user_id
            })
            
            if not results:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Task not found"
                )
            
            task_data = results[0]["t"]
            task = BackgroundTask(
                task_id=task_data["task_id"],
                user_id=task_data["user_id"],
                task_type=task_data["task_type"],
                entity_type=EntityType(task_data["entity_type"]),
                entity_id=task_data.get("entity_id"),
                status=TaskStatus(task_data["status"]),
                parameters=json.loads(task_data.get("parameters", "{}")),
                metadata=json.loads(task_data.get("metadata", "{}")),
                created_at=task_data["created_at"],
                updated_at=task_data["updated_at"]
            )
            
            return task
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get task: {str(e)}"
        )

@router.delete("/{task_id}")
async def cancel_background_task(
    task_id: str,
    current_user: User = Depends(get_current_user)
):
    """Cancel a running background task and cascade stop all sub-sessions"""
    try:
        # Check if task exists and belongs to user
        with Neo4jCRUD() as db:
            query = """
            MATCH (t:BackgroundTask {task_id: $task_id, user_id: $user_id})
            RETURN t
            """
            results = db.run_query(query, {
                "task_id": task_id,
                "user_id": current_user.user_id
            })
            
            if not results:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Task not found"
                )
        
        # Cancel the task if it's running
        task = task_registry.get_task(task_id)
        if task and not task.done():
            task.cancel()
        
        # Cascade stop all sub-sessions
        await stop_task_sessions(task_id)
        
        # Update status in database
        await update_task_status(task_id, TaskStatus.CANCELLED, {"cancelled_at": datetime.utcnow().isoformat()})
        
        # Remove from registry
        task_registry.remove_task(task_id)
        
        # Send cancellation notification
        await manager.send_personal_message({
            "type": "task_cancelled",
            "task_id": task_id
        }, current_user.user_id)
        
        return {"message": "Task cancelled successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel task: {str(e)}"
        )

# WebSocket endpoint for real-time updates
@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint for real-time task updates"""
    await manager.connect(websocket, user_id)
    try:
        while True:
            # Keep the connection alive and handle incoming messages
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            
    except WebSocketDisconnect:
        manager.disconnect(user_id)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(user_id)
