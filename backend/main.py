from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from routers import analyze, report, chat, geocode, auth, scraper

app = FastAPI(title="Quarter Portrait API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze.router, prefix="/api")
app.include_router(report.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(geocode.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(scraper.router, prefix="/api")

app.mount("/css", StaticFiles(directory="frontend/css"), name="css")
app.mount("/js", StaticFiles(directory="frontend/js"), name="js")

@app.get("/")
async def root():
    return FileResponse("frontend/index.html")

@app.get("/favicon.png")
async def favicon_png():
    return FileResponse("frontend/favicon.png")

@app.get("/favicon.ico")
async def favicon_ico():
    return FileResponse("frontend/favicon.png")
