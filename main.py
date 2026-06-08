import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routers import analyze, report, chat, geocode

app = FastAPI(
    title="Atlas Urban Analytics API",
    description="Высокопроизводительный бэкенд пространственного анализа среды",
    version="2.5"
)

# Настройка CORS-политик для бесшовного общения с фронтендом Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение изолированных сервисных роутеров
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
