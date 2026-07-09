# Providers

Um provider só é registrado quando sua variável de ambiente chave está definida.
O campo `provider` de qualquer requisição seleciona o provider; `model` seleciona o modelo.

| Provider | Ativado por | Capacidades | Observações |
|---|---|---|---|
| `ollama` | `OLLAMA_BASE_URL` | text, chat, embed, vision | Local. Modelos: Gemma, Llama3, Qwen, Mistral, DeepSeek, Phi... listados dinamicamente via `/api/tags`; troca de modelo por request |
| `openai` | `OPENAI_API_KEY` | text, chat, embed, vision, image | `OPENAI_BASE_URL` permite apontar para proxies compatíveis |
| `gemini` | `GEMINI_API_KEY` | text, chat, embed, vision | REST `generativelanguage.googleapis.com` |
| `claude` | `ANTHROPIC_API_KEY` | text, chat, vision | SDK oficial `@anthropic-ai/sdk`; modelo padrão `claude-opus-4-8` |
| `openrouter` | `OPENROUTER_API_KEY` | text, chat, vision | Centenas de modelos de terceiros |
| `lmstudio` | `LMSTUDIO_BASE_URL` | text, chat, embed, vision | Servidor local OpenAI-compatível |
| `comfyui` | `COMFYUI_BASE_URL` | image, upscale | txt2img, img2img, upscale, fila, progresso, cancelamento |
| `a1111` | `A1111_BASE_URL` | image, upscale | Automatic1111 WebUI (`/sdapi/v1/*`) |
| `sdapi` | `SD_API_KEY` | image | modelslab.com / stablediffusionapi.com |
| `replicate` | `REPLICATE_API_TOKEN` | text, image | Flux Schnell/Dev, Llama, etc. |

## Defaults por capacidade

```
DEFAULT_TEXT_PROVIDER=ollama
DEFAULT_CHAT_PROVIDER=ollama
DEFAULT_IMAGE_PROVIDER=comfyui
DEFAULT_EMBED_PROVIDER=ollama
DEFAULT_VISION_PROVIDER=ollama
DEFAULT_UPSCALE_PROVIDER=comfyui
```

Sem default configurado, a plataforma usa o primeiro provider registrado que suporta a
capacidade. Cada tenant pode ter os próprios defaults (`Tenant.defaultTextProvider`, etc.).

## Ollama

```
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=llama3
OLLAMA_FAST_MODEL=qwen2.5:3b
OLLAMA_VISION_MODEL=moondream
OLLAMA_EMBED_MODEL=nomic-embed-text
```

- Health check: `GET /api/tags`
- `GET /v1/models?provider=ollama` lista tudo que está instalado (`ollama pull gemma3` etc.)
- Troca dinâmica: `{"model": "qwen3"}` em qualquer request (sempre tem prioridade sobre o roteamento automático).
- Em Docker, use `OLLAMA_BASE_URL_DOCKER` (padrão `http://host.docker.internal:11434`).

### Roteamento automático de modelo por tarefa

Quando a requisição **não** informa `model`, `packages/shared/src/model-router.ts`
escolhe o melhor modelo Ollama para a tarefa:

| Situação | Modelo usado |
|---|---|
| `chat` / `/v1/text` sem `task` / tarefas gerais | `OLLAMA_DEFAULT_MODEL` (flagship, melhor qualidade) |
| `task: "classification"`, `"translation"` ou `"seo"` (ou jobs `classification`/`translation`/`seo`) | `OLLAMA_FAST_MODEL` (pequeno, rápido, barato) |
| capacidade `vision`, `task: "vision"`/`"ocr"`, ou job `ocr` | `OLLAMA_VISION_MODEL` (multimodal de verdade) |
| capacidade `embed` | `OLLAMA_EMBED_MODEL` |

Envie `task` explicitamente em qualquer endpoint síncrono para forçar o roteamento
mesmo fora dos jobs assíncronos:

```json
POST /v1/text
{ "prompt": "Traduza: bom dia", "task": "translation" }
```

Um `model` explícito sempre vence o roteamento automático. O roteamento só se
aplica ao provider `ollama` — outros providers continuam usando seu próprio
modelo padrão configurado.

## ComfyUI

```
COMFYUI_BASE_URL=http://localhost:8188
COMFYUI_CHECKPOINT=DreamShaper_8_pruned.safetensors  # ou sd_xl_base_1.0 / flux1-schnell / flux1-dev
COMFYUI_UPSCALE_MODEL=RealESRGAN_x4plus.pth
```

O workflow interno usa `dpmpp_2m` + `karras` (muito melhor que `euler`/`normal` no
mesmo número de passos) e aplica um negative prompt genérico de qualidade
quando a requisição não informa nenhum (mande `"negativePrompt": ""` para
gerar sem nenhum). `RealESRGAN_x4plus.pth` precisa estar de fato em
`ComfyUI/models/upscale_models/` — sem o arquivo, `/v1/upscale` falha.

Recursos implementados:

- **Text to Image** — workflow SDXL/Flux montado dinamicamente (`model` = checkpoint).
- **Image to Image** — envie `image` (base64) + `denoise` no `/v1/image`, ou use
  `/v1/image-to-image` com `strength`. Ambos aceitam `"wait": false` (recomendado) para
  devolver `jobId` na hora em vez de segurar a conexão — geração de imagem passa fácil de
  100s e qualquer proxy na frente da API (Cloudflare Tunnel incluso) mata a conexão nesse
  ponto. Consulte `GET /v1/jobs/:id` até `status: "completed"`.
- **Galeria (N imagens a partir de 1 foto)** — `POST /v1/image-gallery` com `image` +
  `prompt` + `count` (padrão 5). Sempre assíncrono (retorna `jobId` na hora). Gera `count`
  variações aplicando prompts de enquadramento/contexto diferentes (frente, detalhe,
  ângulo 3/4, lifestyle, perfil...) sobre a mesma foto via img2img. **Não é rotação 3D
  real** — o checkpoint instalado é SD1.5-class/img2img, que preserva a composição da
  imagem de entrada; não há modelo multi-view instalado para gerar um ângulo físico
  diferente de verdade. O resultado é variedade de estilo/contexto de vitrine, não
  fotos de outros lados do produto.
- **Vídeo → imagens** — `POST /v1/video-to-image` extrai frames por detecção de cena
  (`frameCount`, padrão 5) e roda img2img em cada um. Sempre assíncrono. Essa é a opção
  certa quando você já tem um vídeo girando o produto — os frames extraídos são ângulos
  reais, ao contrário da galeria a partir de 1 foto.
- **Upscale** — `/v1/upscale` via `ImageUpscaleWithModel` (RealESRGAN etc.).
- **Fila / progresso / cancelamento** — `/v1/comfyui/queue`, `/v1/comfyui/progress/:id`,
  `/v1/comfyui/cancel`.
- **Remoção de fundo / ControlNet** — dependem de custom nodes instalados no seu ComfyUI;
  o método `generateImage` aceita qualquer checkpoint e o provider pode ser estendido com
  novos workflows em `packages/shared/src/providers/comfyui.provider.ts`.

### Receitas de imagem para e-commerce

| Objetivo | Como |
|---|---|
| Produto em fundo branco | `prompt: "product photography, <produto>, pure white background, studio lighting"` |
| Produto humanizado | img2img: foto do produto + `prompt: "person wearing <produto>, lifestyle photo"` |
| Produto em ambiente | img2img com `denoise: 0.5` + prompt do cenário |
| Mockup | img2img sobre template do mockup |
| Melhorar imagem | img2img com `denoise: 0.3` |
| Upscale / catálogo | `/v1/upscale` (RealESRGAN 4x) |

## Claude (Anthropic)

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_DEFAULT_MODEL=claude-opus-4-8
```

Usa o SDK oficial. Observações importantes:

- Modelos Opus 4.7+ não aceitam `temperature`/`top_p` — o provider não os repassa.
- `stop_reason: "refusal"` vira erro `422 REFUSED` no envelope de erro da plataforma.
- `GET /v1/models?provider=claude` consulta a Models API oficial.

## Custos

Cadastre custos por modelo no dashboard (Modelos → Custos) ou via
`POST /admin/models { provider, modelId, costPer1kInput, costPer1kOutput }`.
Cada requisição calcula o custo com base nos tokens reportados pelo provider e alimenta
os relatórios de uso por tenant.

## Criando um novo provider

1. Crie `packages/shared/src/providers/meuprovider.provider.ts` estendendo `BaseProvider`.
2. Implemente as capacidades suportadas (os métodos não implementados respondem
   `CAPABILITY_NOT_SUPPORTED` automaticamente).
3. Registre em `createRegistryFromEnv` com a env correspondente.
4. Exporte em `packages/shared/src/index.ts`.

## Roteamento resiliente e gratuito

Quando `fallback` nao for `false`, uma falha de provider tenta automaticamente os demais
providers compativeis na ordem de `FREE_PROVIDER_ORDER`. Isso cobre cota gratuita esgotada,
timeout e indisponibilidade. Para exigir um provider sem fallback, envie `"fallback": false`.

Ordem recomendada:

```env
FREE_PROVIDER_ORDER=ollama,groq,gemini,cloudflare,openrouter,lmstudio
OPENROUTER_DEFAULT_MODEL=openrouter/free
```

A chave entregue aos projetos e a chave da propria plataforma (`DEFAULT_API_KEY`), nunca as
chaves dos providers. Use `x-api-key: ap_...` ou `Authorization: Bearer ap_...`.