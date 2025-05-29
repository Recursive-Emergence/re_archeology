"""
Performance monitoring utilities for the RE-Archaeology Framework.
Provides comprehensive monitoring, metrics collection, and optimization tools.
"""

import time
import psutil
import logging
import functools
from typing import Dict, Any, Optional, Callable
from datetime import datetime, timedelta
from collections import defaultdict, deque
import asyncio
import threading

logger = logging.getLogger(__name__)

class PerformanceMonitor:
    """
    Comprehensive performance monitoring system for the RE-Archaeology Framework.
    Tracks API response times, resource usage, and system health metrics.
    """
    
    def __init__(self, max_history: int = 1000):
        self.max_history = max_history
        self.metrics = defaultdict(lambda: deque(maxlen=max_history))
        self.start_time = time.time()
        self.request_count = 0
        self.error_count = 0
        self._lock = threading.Lock()
        
        # System resource tracking
        self.system_metrics = {
            'cpu_percent': deque(maxlen=max_history),
            'memory_percent': deque(maxlen=max_history),
            'disk_usage': deque(maxlen=max_history),
            'network_io': deque(maxlen=max_history)
        }
        
    def record_request(self, endpoint: str, duration: float, status_code: int = 200):
        """Record API request metrics."""
        with self._lock:
            self.request_count += 1
            if status_code >= 400:
                self.error_count += 1
            
            timestamp = time.time()
            self.metrics[f'{endpoint}_duration'].append((timestamp, duration))
            self.metrics[f'{endpoint}_status'].append((timestamp, status_code))
            
            # Track slow requests
            if duration > 2.0:  # 2 second threshold
                logger.warning(f"Slow request to {endpoint}: {duration:.3f}s")
    
    def record_system_metrics(self):
        """Record current system resource usage."""
        try:
            timestamp = time.time()
            
            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=None)
            self.system_metrics['cpu_percent'].append((timestamp, cpu_percent))
            
            # Memory usage
            memory = psutil.virtual_memory()
            self.system_metrics['memory_percent'].append((timestamp, memory.percent))
            
            # Disk usage
            disk = psutil.disk_usage('/')
            disk_percent = (disk.used / disk.total) * 100
            self.system_metrics['disk_usage'].append((timestamp, disk_percent))
            
            # Network I/O
            net_io = psutil.net_io_counters()
            if net_io:
                total_bytes = net_io.bytes_sent + net_io.bytes_recv
                self.system_metrics['network_io'].append((timestamp, total_bytes))
            
        except Exception as e:
            logger.error(f"Error recording system metrics: {e}")
    
    def get_endpoint_stats(self, endpoint: str, minutes: int = 60) -> Dict[str, Any]:
        """Get statistics for a specific endpoint over the last N minutes."""
        cutoff_time = time.time() - (minutes * 60)
        
        duration_key = f'{endpoint}_duration'
        status_key = f'{endpoint}_status'
        
        # Filter recent data
        recent_durations = [
            duration for timestamp, duration in self.metrics[duration_key]
            if timestamp > cutoff_time
        ]
        
        recent_statuses = [
            status for timestamp, status in self.metrics[status_key]
            if timestamp > cutoff_time
        ]
        
        if not recent_durations:
            return {'endpoint': endpoint, 'no_data': True}
        
        # Calculate statistics
        avg_duration = sum(recent_durations) / len(recent_durations)
        max_duration = max(recent_durations)
        min_duration = min(recent_durations)
        
        # Calculate percentiles
        sorted_durations = sorted(recent_durations)
        p95_index = int(0.95 * len(sorted_durations))
        p99_index = int(0.99 * len(sorted_durations))
        
        p95_duration = sorted_durations[p95_index] if p95_index < len(sorted_durations) else max_duration
        p99_duration = sorted_durations[p99_index] if p99_index < len(sorted_durations) else max_duration
        
        # Error rate
        error_statuses = [s for s in recent_statuses if s >= 400]
        error_rate = len(error_statuses) / len(recent_statuses) if recent_statuses else 0
        
        return {
            'endpoint': endpoint,
            'request_count': len(recent_durations),
            'avg_duration': round(avg_duration, 3),
            'min_duration': round(min_duration, 3),
            'max_duration': round(max_duration, 3),
            'p95_duration': round(p95_duration, 3),
            'p99_duration': round(p99_duration, 3),
            'error_rate': round(error_rate * 100, 2),
            'time_window_minutes': minutes
        }
    
    def get_system_health(self) -> Dict[str, Any]:
        """Get current system health status."""
        try:
            uptime = time.time() - self.start_time
            
            # Current resource usage
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')
            
            # Calculate error rate
            error_rate = (self.error_count / self.request_count * 100) if self.request_count > 0 else 0
            
            # Health status based on thresholds
            health_status = "healthy"
            if cpu_percent > 80 or memory.percent > 80 or error_rate > 5:
                health_status = "warning"
            if cpu_percent > 95 or memory.percent > 95 or error_rate > 10:
                health_status = "critical"
            
            return {
                'status': health_status,
                'uptime_seconds': round(uptime, 2),
                'uptime_human': str(timedelta(seconds=int(uptime))),
                'total_requests': self.request_count,
                'total_errors': self.error_count,
                'error_rate_percent': round(error_rate, 2),
                'cpu_percent': round(cpu_percent, 2),
                'memory_percent': round(memory.percent, 2),
                'memory_available_gb': round(memory.available / (1024**3), 2),
                'disk_percent': round((disk.used / disk.total) * 100, 2),
                'disk_free_gb': round(disk.free / (1024**3), 2)
            }
            
        except Exception as e:
            logger.error(f"Error getting system health: {e}")
            return {
                'status': 'error',
                'error': str(e)
            }
    
    def get_all_stats(self) -> Dict[str, Any]:
        """Get comprehensive performance statistics."""
        return {
            'system_health': self.get_system_health(),
            'performance_summary': {
                'total_requests': self.request_count,
                'total_errors': self.error_count,
                'uptime_seconds': time.time() - self.start_time
            }
        }

# Global performance monitor instance
performance_monitor = PerformanceMonitor()

def monitor_performance(endpoint_name: Optional[str] = None):
    """
    Decorator to monitor API endpoint performance.
    
    Usage:
        @monitor_performance("auth_login")
        async def login_endpoint():
            ...
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def async_wrapper(*args, **kwargs):
            start_time = time.time()
            status_code = 200
            endpoint = endpoint_name or f"{func.__module__}.{func.__name__}"
            
            try:
                result = await func(*args, **kwargs)
                return result
            except Exception as e:
                status_code = getattr(e, 'status_code', 500)
                raise
            finally:
                duration = time.time() - start_time
                performance_monitor.record_request(endpoint, duration, status_code)
        
        @functools.wraps(func)
        def sync_wrapper(*args, **kwargs):
            start_time = time.time()
            status_code = 200
            endpoint = endpoint_name or f"{func.__module__}.{func.__name__}"
            
            try:
                result = func(*args, **kwargs)
                return result
            except Exception as e:
                status_code = getattr(e, 'status_code', 500)
                raise
            finally:
                duration = time.time() - start_time
                performance_monitor.record_request(endpoint, duration, status_code)
        
        # Return appropriate wrapper based on function type
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper
    
    return decorator

def log_performance(message: str, start_time: float):
    """Log performance information for a specific operation."""
    duration = time.time() - start_time
    if duration > 1.0:  # Log operations taking more than 1 second
        logger.info(f"Performance: {message} took {duration:.3f}s")
    elif duration > 5.0:  # Warn for very slow operations
        logger.warning(f"Slow operation: {message} took {duration:.3f}s")

# Background task to periodically record system metrics
async def start_system_monitoring():
    """Start background system metrics collection."""
    while True:
        try:
            performance_monitor.record_system_metrics()
            await asyncio.sleep(30)  # Record every 30 seconds
        except Exception as e:
            logger.error(f"Error in system monitoring: {e}")
            await asyncio.sleep(60)  # Wait longer on error
