"""
Enhanced error handling and validation utilities for MVP2.
Provides comprehensive error management, input validation, and API response handling.
"""

import logging
import traceback
from typing import Dict, Any, Optional, List, Union
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, ValidationError
from fastapi import HTTPException, status
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

class ErrorCode(Enum):
    """Standardized error codes for the application."""
    
    # Authentication errors (1000-1099)
    INVALID_TOKEN = "AUTH_1001"
    TOKEN_EXPIRED = "AUTH_1002"
    INSUFFICIENT_PERMISSIONS = "AUTH_1003"
    GOOGLE_AUTH_FAILED = "AUTH_1004"
    USER_NOT_FOUND = "AUTH_1005"
    
    # Thread errors (1100-1199)
    THREAD_NOT_FOUND = "THREAD_1101"
    THREAD_ACCESS_DENIED = "THREAD_1102"
    INVALID_THREAD_CATEGORY = "THREAD_1103"
    COMMENT_NOT_FOUND = "THREAD_1104"
    COMMENT_ACCESS_DENIED = "THREAD_1105"
    
    # AI Chat errors (1200-1299)
    OPENAI_API_ERROR = "AI_1201"
    INVALID_CHAT_MESSAGE = "AI_1202"
    EMBEDDING_GENERATION_FAILED = "AI_1203"
    SEARCH_INDEX_ERROR = "AI_1204"
    
    # Background Task errors (1300-1399)
    TASK_NOT_FOUND = "TASK_1301"
    TASK_EXECUTION_FAILED = "TASK_1302"
    TASK_ALREADY_RUNNING = "TASK_1303"
    INVALID_TASK_TYPE = "TASK_1304"
    
    # Earth Engine errors (1400-1499)
    EE_AUTHENTICATION_FAILED = "EE_1401"
    EE_INVALID_REGION = "EE_1402"
    EE_DATA_PROCESSING_ERROR = "EE_1403"
    EE_QUOTA_EXCEEDED = "EE_1404"
    
    # Database errors (1500-1599)
    NEO4J_CONNECTION_ERROR = "DB_1501"
    NEO4J_QUERY_ERROR = "DB_1502"
    DATA_INTEGRITY_ERROR = "DB_1503"
    CONSTRAINT_VIOLATION = "DB_1504"
    
    # WebSocket errors (1600-1699)
    WEBSOCKET_CONNECTION_FAILED = "WS_1601"
    WEBSOCKET_AUTHENTICATION_FAILED = "WS_1602"
    WEBSOCKET_MESSAGE_INVALID = "WS_1603"
    
    # General errors (9000-9999)
    VALIDATION_ERROR = "GEN_9001"
    INTERNAL_SERVER_ERROR = "GEN_9002"
    EXTERNAL_API_ERROR = "GEN_9003"
    RATE_LIMIT_EXCEEDED = "GEN_9004"
    RESOURCE_NOT_FOUND = "GEN_9005"

class ErrorResponse(BaseModel):
    """Standardized error response model."""
    
    success: bool = False
    error_code: str
    message: str
    details: Optional[Dict[str, Any]] = None
    timestamp: str
    request_id: Optional[str] = None
    
    @classmethod
    def create(
        cls,
        error_code: ErrorCode,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None
    ) -> "ErrorResponse":
        """Create a standardized error response."""
        return cls(
            error_code=error_code.value,
            message=message,
            details=details,
            timestamp=datetime.utcnow().isoformat(),
            request_id=request_id
        )

class ValidationHelper:
    """Utility class for input validation."""
    
    @staticmethod
    def validate_uuid(value: str, field_name: str = "ID") -> str:
        """Validate UUID format."""
        import uuid
        try:
            uuid.UUID(value)
            return value
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid {field_name} format. Must be a valid UUID."
            )
    
    @staticmethod
    def validate_string_length(
        value: str,
        min_length: int = 1,
        max_length: int = 1000,
        field_name: str = "field"
    ) -> str:
        """Validate string length constraints."""
        if not value or len(value.strip()) < min_length:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{field_name} must be at least {min_length} characters long."
            )
        
        if len(value) > max_length:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{field_name} must not exceed {max_length} characters."
            )
        
        return value.strip()
    
    @staticmethod
    def validate_email(email: str) -> str:
        """Validate email format."""
        import re
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid email format."
            )
        return email.lower()
    
    @staticmethod
    def validate_thread_category(category: str) -> str:
        """Validate thread category."""
        valid_categories = ["Maps", "Researches", "Sites", "RE Theory", "General Discussion", "Data & Tools"]
        if category not in valid_categories:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid thread category. Must be one of: {', '.join(valid_categories)}"
            )
        return category
    
    @staticmethod
    def validate_task_type(task_type: str) -> str:
        """Validate background task type."""
        valid_types = ["data_processing", "ai_analysis", "documentation", "reconstruction", "data_sync", "indexing"]
        if task_type not in valid_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid task type. Must be one of: {', '.join(valid_types)}"
            )
        return task_type

class ExceptionHandler:
    """Centralized exception handling."""
    
    @staticmethod
    def handle_neo4j_error(error: Exception, context: str = "") -> HTTPException:
        """Handle Neo4j database errors."""
        logger.error(f"Neo4j error in {context}: {str(error)}")
        
        if "authentication" in str(error).lower():
            return HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database authentication failed. Please try again later."
            )
        elif "connection" in str(error).lower():
            return HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database connection error. Please try again later."
            )
        else:
            return HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database operation failed. Please try again later."
            )
    
    @staticmethod
    def handle_openai_error(error: Exception, context: str = "") -> HTTPException:
        """Handle OpenAI API errors."""
        logger.error(f"OpenAI error in {context}: {str(error)}")
        
        error_str = str(error).lower()
        if "rate limit" in error_str:
            return HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="AI service rate limit exceeded. Please try again later."
            )
        elif "api key" in error_str or "authentication" in error_str:
            return HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service authentication error. Please try again later."
            )
        elif "quota" in error_str:
            return HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service quota exceeded. Please try again later."
            )
        else:
            return HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service temporarily unavailable. Please try again later."
            )
    
    @staticmethod
    def handle_earth_engine_error(error: Exception, context: str = "") -> HTTPException:
        """Handle Google Earth Engine errors."""
        logger.error(f"Earth Engine error in {context}: {str(error)}")
        
        error_str = str(error).lower()
        if "authentication" in error_str:
            return HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Earth Engine authentication failed. Please try again later."
            )
        elif "quota" in error_str:
            return HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Earth Engine quota exceeded. Please try again later."
            )
        elif "invalid region" in error_str:
            return HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid geographical region specified."
            )
        else:
            return HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Earth Engine service temporarily unavailable. Please try again later."
            )
    
    @staticmethod
    def handle_validation_error(error: ValidationError) -> HTTPException:
        """Handle Pydantic validation errors."""
        logger.error(f"Validation error: {error}")
        
        error_details = []
        for err in error.errors():
            field = " -> ".join(str(loc) for loc in err["loc"])
            message = err["msg"]
            error_details.append(f"{field}: {message}")
        
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Validation failed: {'; '.join(error_details)}"
        )
    
    @staticmethod
    def handle_generic_error(error: Exception, context: str = "") -> HTTPException:
        """Handle generic errors with logging."""
        logger.error(f"Unexpected error in {context}: {str(error)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        return HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again later."
        )

def create_error_response(
    error_code: ErrorCode,
    message: str,
    status_code: int = 500,
    details: Optional[Dict[str, Any]] = None
) -> JSONResponse:
    """Create a standardized error JSON response."""
    
    error_response = ErrorResponse.create(
        error_code=error_code,
        message=message,
        details=details
    )
    
    return JSONResponse(
        status_code=status_code,
        content=error_response.dict()
    )

def validate_request_data(data: Dict[str, Any], required_fields: List[str]) -> Dict[str, Any]:
    """Validate that required fields are present in request data."""
    missing_fields = []
    
    for field in required_fields:
        if field not in data or data[field] is None or data[field] == "":
            missing_fields.append(field)
    
    if missing_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required fields: {', '.join(missing_fields)}"
        )
    
    return data

class RetryHelper:
    """Utility for implementing retry logic."""
    
    @staticmethod
    def with_exponential_backoff(
        func,
        max_attempts: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 30.0,
        exceptions: tuple = (Exception,)
    ):
        """Execute function with exponential backoff retry."""
        import time
        import random
        
        for attempt in range(max_attempts):
            try:
                return func()
            except exceptions as e:
                if attempt == max_attempts - 1:
                    raise e
                
                delay = min(base_delay * (2 ** attempt) + random.uniform(0, 1), max_delay)
                logger.warning(f"Attempt {attempt + 1} failed, retrying in {delay:.2f}s: {str(e)}")
                time.sleep(delay)

def log_api_request(endpoint: str, method: str, user_id: Optional[str] = None, params: Optional[Dict] = None):
    """Log API request for debugging and monitoring."""
    logger.info(f"API Request: {method} {endpoint} | User: {user_id or 'Anonymous'} | Params: {params or {}}")

def log_api_response(endpoint: str, status_code: int, duration_ms: float, user_id: Optional[str] = None):
    """Log API response for debugging and monitoring."""
    logger.info(f"API Response: {endpoint} | Status: {status_code} | Duration: {duration_ms:.2f}ms | User: {user_id or 'Anonymous'}")

class SecurityValidator:
    """Security validation utilities."""
    
    @staticmethod
    def sanitize_html(content: str) -> str:
        """Basic HTML sanitization to prevent XSS."""
        import html
        return html.escape(content)
    
    @staticmethod
    def validate_file_upload(filename: str, max_size_mb: int = 10) -> bool:
        """Validate file upload security."""
        allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.pdf', '.txt', '.csv', '.json'}
        
        # Check file extension
        import os
        _, ext = os.path.splitext(filename.lower())
        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File type not allowed. Allowed types: {', '.join(allowed_extensions)}"
            )
        
        return True
    
    @staticmethod
    def validate_sql_injection(query: str) -> str:
        """Basic SQL injection prevention."""
        dangerous_patterns = ['drop', 'delete', 'truncate', 'update', 'insert', '--', ';']
        query_lower = query.lower()
        
        for pattern in dangerous_patterns:
            if pattern in query_lower:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid query detected."
                )
        
        return query

# Convenience functions for easier imports
def handle_neo4j_error(error: Exception, context: str = "") -> HTTPException:
    """Convenience function for handling Neo4j errors."""
    return ExceptionHandler.handle_neo4j_error(error, context)

def handle_openai_error(error: Exception, context: str = "") -> HTTPException:
    """Convenience function for handling OpenAI errors."""
    return ExceptionHandler.handle_openai_error(error, context)

def handle_earth_engine_error(error: Exception, context: str = "") -> HTTPException:
    """Convenience function for handling Earth Engine errors."""
    return ExceptionHandler.handle_earth_engine_error(error, context)

def handle_validation_error(error: ValidationError) -> HTTPException:
    """Convenience function for handling validation errors."""
    return ExceptionHandler.handle_validation_error(error)

def handle_generic_error(error: Exception, context: str = "") -> HTTPException:
    """Convenience function for handling generic errors."""
    return ExceptionHandler.handle_generic_error(error, context)

def handle_api_error(error: Exception, context: str = "") -> HTTPException:
    """Convenience function for handling API errors."""
    return ExceptionHandler.handle_generic_error(error, context)

def log_performance(operation: str, duration_ms: float, context: Optional[Dict[str, Any]] = None):
    """Log performance metrics for operations."""
    logger.info(f"Performance: {operation} completed in {duration_ms:.2f}ms | Context: {context or {}}")
