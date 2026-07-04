from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[4]
ENV_FILES = (PROJECT_ROOT / ".env",)


class Settings(BaseSettings):
    app_name: str = "Personal Travel Director Agent"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    dashscope_api_key: str | None = None
    dashscope_model: str = "qwen-plus"
    dashscope_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    database_url: str = "sqlite:///./travel_agent.db"
    api_base_url: str = "http://localhost:8000"
    amap_api_key: str | None = None
    weather_api_key: str | None = None
    qweather_api_key: str | None = None
    qweather_api_host: str = "https://devapi.qweather.com"
    speech_provider: str = "auto"  # baidu | dashscope | auto
    baidu_asr_app_id: str | None = None
    baidu_asr_api_key: str | None = None
    baidu_asr_secret_key: str | None = None

    model_config = SettingsConfigDict(
        env_file=[str(path) for path in ENV_FILES if path.exists()] or ".env",
        extra="ignore",
    )

    @property
    def llm_api_key(self) -> str | None:
        return self.dashscope_api_key or self.openai_api_key

    @property
    def llm_model(self) -> str:
        if self.dashscope_api_key:
            return self.dashscope_model
        return self.openai_model

    @property
    def llm_base_url(self) -> str | None:
        if self.dashscope_api_key:
            return self.dashscope_base_url
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
