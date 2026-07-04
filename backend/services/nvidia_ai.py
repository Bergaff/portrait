import os
import time
from openai import OpenAI

NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "")

nvidia_client = OpenAI(
    api_key=NVIDIA_API_KEY,
    base_url="https://integrate.api.nvidia.com/v1",
    timeout=45.0
) if NVIDIA_API_KEY else None

PRIMARY_MODEL = "meta/llama-3.3-70b-instruct"
FALLBACK_MODEL = "mistralai/mixtral-8x7b-instruct-v0.1"

def ask_nvidia(prompt, max_tokens=1200):
    if not nvidia_client:
        print("NVIDIA_API_KEY отсутствует в переменных окружения!")
        return "AI недоступен: ключ NVIDIA_API_KEY не настроен на сервере."

    start = time.time()
    try:
        r = nvidia_client.chat.completions.create(
            model=PRIMARY_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.6,
            timeout=45.0
        )
        print("NVIDIA OK (" + PRIMARY_MODEL + ") за " + str(round(time.time()-start,1)) + "с")
        return r.choices[0].message.content.strip()
    except Exception as e:
        print("NVIDIA PRIMARY FAILED: " + repr(e))

    try:
        r = nvidia_client.chat.completions.create(
            model=FALLBACK_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=min(max_tokens, 800),
            temperature=0.6,
            timeout=25.0
        )
        print("NVIDIA OK (fallback) за " + str(round(time.time()-start,1)) + "с")
        return r.choices[0].message.content.strip()
    except Exception as e2:
        print("NVIDIA FALLBACK FAILED: " + repr(e2))
        return "AI временно недоступен (перегружен или ошибка ключа на сервере). Попробуйте через минуту."
