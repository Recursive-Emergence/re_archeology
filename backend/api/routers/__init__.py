# Router modules for the RE-Archaeology API

from . import (
    auth,
    users,
    hypotheses,
    sites,
    websocket,
    discussion_threads,
    ai_chat,
    background_tasks,
    spatial_analysis,
    earth_engine_service,
    discovery
)

__all__ = [
    "auth",
    "users", 
    "hypotheses",
    "sites",
    "websocket",
    "discussion_threads",
    "ai_chat",
    "background_tasks",
    "spatial_analysis",
    "earth_engine_service",
    "discovery"
]
