# AI Platform SDK (Python)

```bash
pip install -e packages/sdk-python
```

```python
from ai_platform import AIPlatform

ai = AIPlatform(base_url="http://localhost:3000", api_key="ap_...")

# Texto
res = ai.text(prompt="Descreva um tenis de corrida azul")
print(res["result"]["text"])

# Imagem
res = ai.image(prompt="product photography, blue running shoe, white background")
img_b64 = res["result"]["images"][0]["base64"]

# Job assincrono (SEO)
job = ai.create_job("seo", {"product": "Tenis Runner X", "language": "pt-BR"})
done = ai.wait_job(job["jobId"])
print(done["result"])
```

Todas as respostas seguem o envelope padrão
`{success, provider, model, executionTime, tokens, cached, result}`.
