from fastapi import APIRouter
from pydantic import BaseModel
import requests

router = APIRouter()

class AnalyzeRequest(BaseModel):
    bbox: str

def query_overpass(bbox):
    q = "[out:json][timeout:30];("
    q += 'node["amenity"](' + bbox + ');'
    q += 'node["shop"](' + bbox + ');'
    q += 'node["leisure"](' + bbox + ');'
    q += 'node["tourism"](' + bbox + ');'
    q += 'node["office"](' + bbox + ');'
    q += ");out body;"
    servers = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ]
    for server in servers:
        try:
            r = requests.get(server, params={"data": q}, timeout=35, headers={"User-Agent": "QuarterPortrait/1.0"})
            if r.status_code == 200:
                elements = r.json().get("elements", [])
                if elements:
                    return elements
        except:
            continue
    return []

def categorize(elements):
    cat_map = {
        "Еда и напитки": ["cafe","restaurant","fast_food","bar","pub","food_court","ice_cream"],
        "Шопинг": ["clothes","shoes","jewelry","convenience","supermarket","books","gift","electronics","mobile_phone","florist","kiosk","mall","department_store"],
        "Здоровье": ["pharmacy","clinic","dentist","doctors","hospital","veterinary","optician"],
        "Красота": ["beauty","hairdresser","massage","nail_salon"],
        "Финансы": ["bank","atm","bureau_de_change"],
        "Спорт": ["gym","fitness_centre","sports_centre","swimming_pool","yoga"],
        "Образование": ["school","kindergarten","university","library","language_school"],
        "Досуг": ["cinema","theatre","museum","playground","nightclub","park","arts_centre"],
        "Авто": ["car_repair","car_wash","fuel","parking"],
        "Услуги": ["laundry","dry_cleaning","tailor","post_office"],
    }
    result = {}
    for el in elements:
        tags = el.get("tags", {})
        amenity = tags.get("amenity", tags.get("shop", tags.get("leisure", tags.get("tourism", tags.get("office", "")))))
        for cat_name, keywords in cat_map.items():
            if amenity in keywords:
                result[cat_name] = result.get(cat_name, 0) + 1
                break
    return {k: v for k, v in sorted(result.items(), key=lambda x: -x[1]) if v > 0}

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
    poi_density = round(len(elements) / area, 1)
    return {
        "overall":overall,"density":density,"food":food_s,"health":health_s,
        "sport":sport_s,"education":edu_s,"shopping":shop_s,
        "entertainment":fun_s,"diversity":div_s,
        "area_km2":round(area,3),"total_places":len(elements),
        "poi_density": poi_density
    }

@router.post("/analyze")
async def analyze(req: AnalyzeRequest):
    elements = query_overpass(req.bbox)
    if not elements:
        return {"error": "Организации не найдены. Попробуйте выделить область побольше."}
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
        orgs.append({"name": name, "amenity": amenity, "lat": el["lat"], "lon": el["lon"]})
        lines.append("- " + name + ": " + amenity)
    return {
        "organizations": orgs,
        "scores": scores,
        "categories": cats,
        "org_text": "\\n".join(lines)
    }
