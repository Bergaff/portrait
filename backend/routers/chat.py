from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
try:
    from backend.services import nvidia_ai
except ModuleNotFoundError:
    from services import nvidia_ai

router = APIRouter()

class ChatMessage(BaseModel):
    role: str  # 'user' или 'assistant'
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []
    context_data: Optional[dict] = None  # Сюда передаются текущие метрики зоны с карты

class ChatResponse(BaseModel):
    response: str

# Профессиональный системный промпт: убирает воду, заставляет писать лаконично, как SaaS-метрика
SYSTEM_PROMPT = """You are an elite, concise commercial real estate & urban data analyst.
Your tone is laser-focused, data-driven, and brief.

CRITICAL RULES:
1. NEVER use conversational filler, greetings, or opening fluff (e.g., "Certainly!", "Let's analyze this", "Based on the data").
2. Answer instantly with facts, bullet points, or numbers.
3. Do not repeat numbers or metrics that the user can already see on their dashboard unless explicitly asked to calculate a derivative value.
4. Keep paragraphs shorter than 2 lines. Use clean Markdown structure.
5. Answer in Russian.
"""

@router.post("/", response_model=ChatResponse)
async def handle_chat(payload: ChatRequest):
    try:
        # Сборка контекста из истории сообщений и текущих гео-данных
        formatted_messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        # Если передан контекст выделенной на карте зоны, подмешиваем его для точности
        if payload.context_data:
            context_summary = f"[Контекст локации: Баллы={payload.context_data.get('score', 0)}, Объектов={payload.context_data.get('total_pois', 0)}]"
            formatted_messages.append({"role": "system", "content": context_summary})

        # Добавление истории диалога
        for msg in payload.history:
            formatted_messages.append({"role": msg.role, "content": msg.content})

        # Добавление свежего запроса пользователя
        formatted_messages.append({"role": "user", "content": payload.message})

        # Вызов твоей рабочей функции отправки запроса в API модели
        ai_output = await nvidia_ai.generate_response(formatted_messages)

        return ChatResponse(response=ai_output.strip())

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка обработки запроса ИИ-ассистентом: {str(e)}")
