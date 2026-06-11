from fastapi import APIRouter
from pydantic import BaseModel
from services.nvidia_ai import ask_nvidia

router = APIRouter()

class ChatRequest(BaseModel):
    question: str = ""
    org_text: str = ""
    scores: dict = {}
    history: list = []

@router.post("/chat")
async def chat_answer(req: ChatRequest):
    question = (req.question or "")[:500]
    if not question:
        return {"answer": "Задайте вопрос."}
    history_text = ""
    for msg in (req.history or [])[-6:]:
        role = "Пользователь" if msg.get("role") == "user" else "Ассистент"
        history_text += role + ": " + (msg.get("content", "") or "") + "\n"
    p = "ПРАВИЛА: отвечай ТОЛЬКО про городскую среду, районы, бизнес, урбанистику. На русском.\n"
    p += "Оценка района: " + str((req.scores or {}).get("overall", "?")) + "/100\n"
    p += "Организации:\n" + (req.org_text or "")[:2000] + "\n"
    if history_text:
        p += "История:\n" + history_text + "\n"
    p += "Вопрос: " + question + "\nОтвет:"
    try:
        result = ask_nvidia(p)
        return {"answer": result}
    except Exception as e:
        return {"answer": "Ошибка: " + str(e)[:200]}
