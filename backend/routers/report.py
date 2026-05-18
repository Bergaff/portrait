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
    # Короткий промпт = быстрый ответ
    p = "Ты урбанист. Краткий портрет квартала на русском, без воды.\n"
    p += "Индекс: " + str(s.get("overall","?")) + "/100. "
    p += "Еда:" + str(s.get("food","?")) + " Здоровье:" + str(s.get("health","?")) + " "
    p += "Шопинг:" + str(s.get("shopping","?")) + " Спорт:" + str(s.get("sport","?")) + " "
    p += "Образование:" + str(s.get("education","?")) + " Досуг:" + str(s.get("entertainment","?")) + "\n"
    p += "Площадь: " + str(s.get("area_km2","?")) + " км², мест: " + str(s.get("total_places","?")) + "\n"
    p += "Топ организаций:\n" + req.org_text[:1500] + "\n\n"
    p += "Напиши КРАТКО (3-4 предложения на раздел):\n"
    p += "## Характер квартала\n"
    p += "## Еда и досуг\n"
    p += "## Шопинг и сервисы\n"
    p += "## Плюсы и минусы\n"
    p += "## Идеи для бизнеса"

    result = ask_nvidia(p)
    return {"report": result}
