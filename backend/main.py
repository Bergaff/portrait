import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routers import analyze, report, chat, geocode

app = FastAPI(
    title="Urban Analytics Platform API",
    description="Профессиональный бэкенд для геомаркетингового анализа и расчета коммерческого потенциала зон",
    version="1.0.0"
)

# Настройка CORS для бесшовной интеграции с фронтендом Next.js на Railway
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение изолированных роутеров системы
app.include_router(analyze.router, prefix="/api/analyze", tags=["Analysis"])
app.include_router(report.router, prefix="/api/report", tags=["Reports"])
app.include_router(chat.router, prefix="/api/chat", tags=["AI Chat"])
app.include_router(geocode.router, prefix="/api/geocode", tags=["Geocoding"])

@app.get("/")
async def root():
    return {
        "status": "online",
        "service": "Urban Analytics API",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
