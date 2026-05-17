from fastapi import APIRouter
from pydantic import BaseModel
import requests

router = APIRouter()

class AnalyzeRequest(BaseModel):
    bbox: str

class OrgItem(BaseModel):
    name: str
    amenity: str
    cuisine: str
    lat: float
    lon: float

class ScoreItem(BaseModel):
    overall: int
    density: int
    food: int
    health: int
    sport: int
    education: int
    shopping: int
    entertainment: int
    diversity: int
    area_km2: float
    total_places: int

class AnalyzeResponse(BaseModel):
    organizations: list
    scores: dict
    categories: dict
    org_text: str

def query_overpass(bbox):
    q = "[out:json][timeout:25];("
    q += 'node["amenity"~"cafe|restaurant|bar|pharmacy|bank|clinic|gym|beauty|fast_food|pub|hotel|dentist|school|kindergarten"](' + bbox + ');'
    q += 'node["shop"](' + bbox + ');'
    q += 'node["leisure"~"fitness_centre|sports_centre|playground"](' + bbox + ');'
    q += 'node["tourism"](' + bbox + ');'
    q += 'node["office"](' + bbox + ');'
    q += ");out body;"
    for server in ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]:
        try:
            r = requests.get(server, params={"data": q}, timeout=25)
            if r.status_code == 200:
                return r.json().get("elements", [])
        except:
            continue
    return []

def categorize(elements):
    cat_map = {
        "Еда и напитки": ["cafe","restaurant","fast_food","bar","pub"],
        "Шопинг": ["clothes","shoes","jewelry","cosmetics","convenience","supermarket","watches","books"],
        "Здоровье": ["pharmacy","clinic","dentist","doctors"],
        "Красота": ["beauty","hairdresser"],
        "Финансы": ["bank","atm"],
        "Спорт": ["gym","fitness_centre","sports_centre"],
        "Образование": ["school","kindergarten","university"],
        "Гостиницы": ["hotel","hostel"],
        "Досуг": ["cinema","theatre","museum","playground","nightclub"],
    }
    result = {}
    for el in elements:
        tags = el.get("tags", {})
        amenity = tags.get("amenity", tags.get("shop", tags.get("leisure", "")))
        found = False
        for cat_name, keywords in cat_map.items():
            if amenity in keywords:
                result[cat_name] = result.get(cat_name, 0) + 1
                found = True
                break
        if not found:
            result["Прочее"] = result.get("Прочее", 0) + 1
    return result

def calculate_scores(elements, bbox):
    parts = [float(x) for x in bbox.split(",")]
    area = max((parts[2]-parts[0])*111*(parts[3]-parts[1])*111*0.6, 0.01)
    total = max(len(elements), 1)
    cats = categorize(elements)
    food_s = min(100, int(cats.get("Еда и напитки",0)/total*280))
    health_s = min(100, int(cats.get("Здоровье",0)/area/5*100))
    sport_s = min(100, int(cats.get("Спорт",0)/area/3*100))
    edu_s = min(100, int(cats.get("Образование",0)/area/2*100))
    shop_s = min(100, int(cats.get("Шопинг",0)/total*220))
    fun_s = min(100, int(cats.get("Досуг",0)/area/3*100))
    density = min(100, int(total/area/150*100))
    div_s = min(100, int(len(cats)/10*100))
    overall = int(density*0.15+food_s*0.2+health_s*0.15+sport_s*0.1+edu_s*0.1+shop_s*0.15+div_s*0.15)
    return {
        "overall":overall,"density":density,"food":food_s,"health":health_s,
        "sport":sport_s,"education":edu_s,"shopping":shop_s,
        "entertainment":fun_s,"diversity":div_s,
        "area_km2":round(area,3),"total_places":len(elements)
    }

@router.post("/analyze")
async def analyze(req: AnalyzeRequest):
    elements = query_overpass(req.bbox)
    if not elements:
        return {"error": "Организации не найдены"}

    scores = calculate_scores(elements, req.bbox)
    cats = categorize(elements)

    orgs = []
    lines = []
    for el in elements:
        if "lat" not in el or "lon" not in el:
            continue
        tags = el.get("tags", {})
        name = tags.get("name", "Без названия")
        amenity = tags.get("amenity", tags.get("shop", tags.get("leisure", "другое")))
        cuisine = tags.get("cuisine", "")
        orgs.append({"name": name, "amenity": amenity, "cuisine": cuisine, "lat": el["lat"], "lon": el["lon"]})
        extra = " (" + cuisine + ")" if cuisine else ""
        lines.append("- " + name + ": " + amenity + extra)

    return {
        "organizations": orgs,
        "scores": scores,
        "categories": cats,
        "org_text": "\n".join(lines)
    }
