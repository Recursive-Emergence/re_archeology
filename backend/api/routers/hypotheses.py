"""
API router for hypothesis management.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import List
from backend.models.ontology_models import Hypothesis, CreateHypothesisRequest
from backend.models.neo4j_crud import HypothesisCRUD
from backend.core.neo4j_database import get_neo4j_session

router = APIRouter(prefix="/hypotheses", tags=["hypotheses"])

@router.post("/", response_model=Hypothesis)
async def create_hypothesis(hypothesis_data: CreateHypothesisRequest, session=Depends(get_neo4j_session)):
    """Create a new hypothesis."""
    return HypothesisCRUD.create_hypothesis(hypothesis_data)

@router.get("/{hypothesis_id}", response_model=Hypothesis)
async def get_hypothesis(hypothesis_id: str, session=Depends(get_neo4j_session)):
    """Get a hypothesis by ID."""
    result = HypothesisCRUD.get_node_by_id("Hypothesis", hypothesis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Hypothesis not found")
    return Hypothesis(**result)

@router.get("/", response_model=List[Hypothesis])
async def get_all_hypotheses(limit: int = 100, session=Depends(get_neo4j_session)):
    """Get all hypotheses."""
    results = HypothesisCRUD.get_all_nodes("Hypothesis", limit)
    return [Hypothesis(**result) for result in results]
