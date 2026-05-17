from openai import OpenAI

nvidia_client = OpenAI(
    api_key="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",
    base_url="https://integrate.api.nvidia.com/v1"
)

def ask_nvidia(prompt):
    try:
        r = nvidia_client.chat.completions.create(
            model="meta/llama-3.3-70b-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2500,
            temperature=0.7
        )
        return r.choices[0].message.content.strip()
    except Exception as e:
        return "AI временно недоступен: " + str(e)[:100]
