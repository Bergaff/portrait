import os
import sys

# Динамически добавляем корень проекта и текущую папку в пути поиска модулей Python
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)
    
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routers import analyze, report, chat, geocode

app = FastAPI(
    title="Atlas Urban Analytics API",
    description="Высокопроизводительный бэкенд пространственного анализа среды",
    version="2.5"
)

# Настройка CORS-политик
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
