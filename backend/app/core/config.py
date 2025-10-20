from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    env: str = Field(default="dev")
    secret_key: str = Field(default="dev")

    database_url: str = Field(default="postgresql://app:app@postgres:5432/meeting")
    redis_url: str = Field(default="redis://redis:6379/0")

    s3_endpoint_url: str = Field(default="http://minio:9000")
    # Public base URL used in presigned URLs for browser clients
    s3_public_base_url: str = Field(default="http://localhost:9000")
    s3_access_key_id: str = Field(default="minioadmin")
    s3_secret_access_key: str = Field(default="minioadmin")
    s3_bucket: str = Field(default="media")

    single_user_token: str = Field(default="devtoken")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


settings = Settings()
