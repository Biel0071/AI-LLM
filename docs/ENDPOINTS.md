# API Endpoints Inventory - API Platform Enterprise v5.0

## Rotas de Inferência (Acesso Público com API Key `x-api-key`)
`apps/api/src/routes/v1/index.ts`
- `POST /v1/text` - Completions de texto padrão.
- `POST /v1/chat` - Chat history multi-turno.
- `POST /v1/image` - Geração txt2img / img2img (ComfyUI, etc).
- `POST /v1/upscale` - Upscale imagens.
- `POST /v1/vision` - Analise de imagem.
- `POST /v1/embed` - Embeddings texto.
- `POST /v1/ocr` - OCR image to text.
- `POST /v1/jobs` - Job dispatch genérico.
- `GET /v1/jobs/:id` - Job polling result.
- `GET /v1/models` - Lista de modelos ativados no cache local.
- `GET /v1/providers` - Lista de providers online e offline.
- `GET /v1/health` - Payload de health check abrangente.
- `GET /v1/memory` e `POST /v1/reverse` - Endpoints auxiliares de cache inverso e contexto.

## Compatibilidade OpenAI (Acesso Público com Bearer / `x-api-key`)
`apps/api/src/routes/v1/openai-compat.ts`
- `POST /v1/chat/completions` - Mapeamento direto de client nativo OpenAI para a API Platform.

## Rotas Administrativas (Acesso Restrito via Bearer JWT Admin)
`apps/api/src/routes/admin/`
- `POST /admin/login` - Autenticação de painel.
- `GET /admin/overview` - Dashboard base.
- `GET/POST/PUT /admin/providers` & `provider-configs` - Credenciais.
- `GET/POST /admin/api-keys` - Gestão de keys.
- `GET/POST /admin/tenants` - Multitenancy stores.
- `GET/POST /admin/users` - Admin users.
- `GET /admin/workflows`, `/prompts`, `/images`, `/observability` - (Vários endpoints que devem ser expostos na interface completa RC).
