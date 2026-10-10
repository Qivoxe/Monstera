from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./monstera.db"
    frontend_origins: str = "http://localhost:3000,http://localhost:5173"
    log_level: str = "INFO"
    open_meteo_base_url: str = "https://air-quality-api.open-meteo.com/v1/air-quality"
    cookie_secure: bool = False
    session_days: int = 14

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
