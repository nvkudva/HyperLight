"""Shared request schemas for the API routes."""
from typing import List, Literal, Optional, Union

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


class LaunchRequest(pydantic.BaseModel):
    path: str


class HotkeyCombo(pydantic.BaseModel):
    key_code: int = pydantic.Field(ge=0, le=127)
    modifiers: List[Literal["ctrl", "alt", "shift", "cmd"]]
    label: str = pydantic.Field(max_length=40)


class SettingsUpdateRequest(pydantic.BaseModel):
    always_on_scanning: Optional[bool] = None
    custom_instructions: Optional[str] = None
    hotkey_enabled: Optional[bool] = None
    hotkey: Optional[Union[Literal["double_ctrl", "double_option"], HotkeyCombo]] = None
    hotkey_voice: Optional[bool] = None
    voice_transcription: Optional[bool] = None


class SourceWatchRequest(pydantic.BaseModel):
    path: str
    enabled: bool


class BrowseFolderRequest(pydantic.BaseModel):
    prompt: Optional[str] = "Select a folder to index in Hyperlight"
