import os
import sys

# Принудительная регистрация путей в системном окружении контейнера
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Импортируем роутеры локально. Если Python считает корень рабочей директорией, 
# он подтянет их через блоки try/except в любом окружении окружения хостинга.
try:
    from backend.routers import analyze, report, chat, geocode
except ModuleNotFoundError:
    from routers import analyze, report, chat, geocode

app = FastAPI(
    title="Atlas Urban Analytics API",
    description="Высокопроизводительный бэкенд пространственного анализа среды",
    version="2.5"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение роутеров
app.include_router(analyze.router, prefix="/api/analyze", tags=["Spatial Analytics"])
app.include_router(report.router, prefix="/api/report", tags=["Commercial Intelligence"])
app.include_router(chat.router, prefix="/api/chat", tags=["AI Copilot"])
app.include_router(geocode.router, prefix="/api/geocode", tags=["Geocoding Pipeline"])

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "engine": "FastAPI",
        "environment": os.environ.get("RAILWAY_ENVIRONMENT", "production")
    }
