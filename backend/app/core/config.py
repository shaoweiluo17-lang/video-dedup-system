from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    APP_NAME: str = 'video-dedup-system'
    APP_ENV: str = 'dev'
    APP_PORT: int = 18080

    MYSQL_HOST: str = '127.0.0.1'
    MYSQL_PORT: int = 3306
    MYSQL_DB: str = 'video_dedup'
    MYSQL_USER: str = 'root'
    MYSQL_PASSWORD: str = 'root'

    REDIS_HOST: str = '127.0.0.1'
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ''

    API_KEY: str = 'change-me'

    SEARCH_CACHE_TTL_SECONDS: int = 300
    CHECK_CACHE_TTL_SECONDS: int = 600
    STATS_CACHE_TTL_SECONDS: int = 3600

    SCREENSHOT_DIR: str = './data/screenshots'
    SCREENSHOT_QUALITY: int = 2
    SCREENSHOT_BATCH_SIZE: int = 20
    SCREENSHOT_INTERVAL_MINUTES: int = 5
    FFMPEG_BIN: str = 'ffmpeg'

    IDM_EXE: str = 'C:\\Program Files (x86)\\Internet Download Manager\\IDMan.exe'
    DOWNLOAD_ROOT: str = 'D:/Downloads/Movies'
    DOWNLOAD_SUFFIX: str = ''


settings = Settings()
