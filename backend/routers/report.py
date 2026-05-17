from fastapi import APIRouter
from pydantic import BaseModel
from services.nvidia_ai import ask_nvidia

router = APIRouter()

class ReportRequest(BaseModel):
    org_text: str
    scores: dict

@router.post("/report")
async def generate_report(req: ReportRequest):
    s = req.scores
    p = "Ты урбанист. Подробный портрет квартала на русском.\n"
    p += "Оценка: " + str(s.get("overall","?")) + "/100\n"
    p += "Еда: " + str(s.get("food","?")) + ", Здоровье: " + str(s.get("health","?")) + "\n"
    p += "Шопинг: " + str(s.get("shopping","?")) + ", Спорт: " + str(s.get("sport","?")) + "\n"
    p += "Образование: " + str(s.get("education","?")) + ", Досуг: " + str(s.get("entertainment","?")) + "\n"
    p += "Площадь: " + str(s.get("area_km2","?")) + " км2, Мест: " + str(s.get("total_places","?")) + "\n\n"
    p += "Организации:\n" + req.org_text[:3000] + "\n\n"
    p += "Ответь:\n"
    p += "## Характер квартала\n## Кто здесь живёт\n## Еда и развлечения\n"
    p += "## Шопинг и сервисы\n## Плюсы\n## Чего не хватает\n## Идеи для бизнеса"

    result = ask_nvidia(p)
    return {"report": result}
