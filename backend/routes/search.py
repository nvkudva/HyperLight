"""Live text search route."""
from typing import Any, Dict

import fastapi

import spotlight
from routes.schemas import SpotlightRequest

router = fastapi.APIRouter()

@router.post("/api/spotlight")
def api_spotlight(req: SpotlightRequest) -> Dict[str, Any]:
    return spotlight.query(req.query)
