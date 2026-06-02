from fastapi import APIRouter
from pydantic import BaseModel
from services.nvidia_ai import ask_nvidia

router = APIRouter()

class ReportRequest(BaseModel):
    org_text: str
    scores: dict
    scraped_data: list = []

@router.post("/report")
async def generate_report(req: ReportRequest):
    s = req.scores

    # БАЗОВЫЕ ДАННЫЕ
    p = "Ты опытный городской эксперт. Пишешь живо, с конкретикой, без воды. На русском.\\n\\n"
    p += "=== РАЙОН ===\\n"
    p += f"Индекс района: {s.get('overall','?')}/100\\n"
    p += f"Площадь: {s.get('area_km2','?')} км², всего мест: {s.get('total_places','?')}\\n"
    p += f"Метрики: Еда {s.get('food','?')}, Здоровье {s.get('health','?')}, "
    p += f"Шопинг {s.get('shopping','?')}, Спорт {s.get('sport','?')}, "
    p += f"Образование {s.get('education','?')}, Досуг {s.get('entertainment','?')}\\n\\n"

    has_scraped = bool(req.scraped_data)
    has_summaries = any(x.get("ai_summary") for x in req.scraped_data) if has_scraped else False

    if has_scraped:
        # Сортируем по количеству отзывов (популярные сверху)
        sorted_data = sorted(req.scraped_data, key=lambda x: (x.get("reviews_count", 0) or 0), reverse=True)

        # Топ 20 заведений
        p += "=== ЗАВЕДЕНИЯ В ЭТОМ РАЙОНЕ (с Яндекс.Карт) ===\\n"
        for item in sorted_data[:20]:
            name = (item.get("name") or "")[:60]
            rating = item.get("rating", 0)
            reviews = item.get("reviews_count", 0)
            cat = (item.get("category") or "")[:30]
            summary = (item.get("ai_summary") or "").strip()

            if not name:
                continue

            line = f"• {name} [{cat}] ★{rating} ({reviews} отзывов)"
            if summary:
                line += f"\\n  Отзывы: {summary}"
            p += line + "\\n"

        # Статистика по рейтингам
        ratings = [x.get("rating", 0) for x in req.scraped_data if x.get("rating", 0) > 0]
        if ratings:
            avg = round(sum(ratings) / len(ratings), 2)
            top_places = [x for x in req.scraped_data if x.get("rating", 0) >= 4.5]
            bad_places = [x for x in req.scraped_data if 0 < x.get("rating", 0) < 3.5]
            p += f"\\nСтатистика: средний рейтинг района {avg}/5. "
            p += f"Высокий рейтинг (4.5+): {len(top_places)} мест. "
            p += f"Низкий рейтинг (<3.5): {len(bad_places)} мест.\\n\\n"

    else:
        p += "=== ОРГАНИЗАЦИИ (из OSM) ===\\n"
        p += req.org_text[:1500] + "\\n\\n"

    # ИНСТРУКЦИЯ ДЛЯ AI - новый тон
    p += "=== ЗАДАНИЕ ===\\n"
    p += "Напиши КРАТКО (3-5 предложений на раздел), ЖИВО, с конкретикой.\\n"
    p += "Упоминай НАЗВАНИЯ заведений из списка выше, когда это уместно.\\n"
    p += "Если есть данные об отзывах — обязательно используй их в анализе.\\n\\n"

    p += "Структура отчёта:\\n\\n"
    p += "## Характер квартала\\n"
    p += "(Какой это район: тусовочный, семейный, деловой, спальный. Кто здесь живёт.)\\n\\n"

    if has_scraped:
        p += "## Куда стоит сходить\\n"
        p += "(Назови 3-5 КОНКРЕТНЫХ заведений с высоким рейтингом и хорошими отзывами. "
        p += "Например: «Хвалят кафе X — отличный кофе и вид. Стоит зайти в Y, посетители отмечают...».)\\n\\n"

        p += "## Куда лучше не ходить\\n"
        p += "(Если есть заведения с низким рейтингом — назови их и причину. "
        p += "Если плохих нет — напиши «в районе нет проблемных мест».)\\n\\n"
    else:
        p += "## Еда и досуг\\n"
        p += "## Шопинг и сервисы\\n\\n"

    p += "## Плюсы района\\n"
    p += "## Минусы района\\n\\n"

    if has_summaries:
        p += "## О чём говорят жители (по отзывам)\\n"
        p += "(Общие темы из отзывов: что хвалят, на что жалуются. По-человечески.)\\n\\n"

    p += "## Идеи для бизнеса\\n"
    p += "(Чего не хватает в районе на основании анализа.)"

    result = ask_nvidia(p)
    return {"report": result}
