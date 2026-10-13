"""Shared request schemas for the API routes."""
from typing import Any, Optional

import pydantic


class ChatRequest(pydantic.BaseModel):
    message: str = pydantic.Field(max_length=4000)


class IndexRequest(pydantic.BaseModel):
    path: str
    source: str = "local"
    name: Optional[str] = None


class RemoveSourceRequest(pydantic.BaseModel):
    path: str


class SpotlightRequest(pydantic.BaseModel):
    query: str = pydantic.Field(max_length=500)
    limit: int = pydantic.Field(default=20, ge=1, le=100)


class LaunchRequest(pydantic.BaseModel):
    path: str


class GoogleTokenRequest(pydantic.BaseModel):
    access_token: str
    refresh_token: Optional[str] = ""


class SettingsUpdateRequest(pydantic.BaseModel):
    always_on_scanning: Optional[bool] = None
    custom_instructions: Optional[str] = None
    hotkey_enabled: Optional[bool] = None
    hotkey: Optional[Any] = None
    hotkey_voice: Optional[bool] = None


class SourceWatchRequest(pydantic.BaseModel):
    path: str
    enabled: bool


class BrowseFolderRequest(pydantic.BaseModel):
    prompt: Optional[str] = "Select a folder to index in Hyperlight"
