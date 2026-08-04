"""AI Platform SDK (Python).

Exemplo:
    from ai_platform import AIPlatform

    ai = AIPlatform(base_url="http://localhost:3000", api_key="ap_...")
    res = ai.text(prompt="Descreva um tenis de corrida")
    print(res["result"]["text"])
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Union

import requests


class AIPlatformError(Exception):
    def __init__(self, code: str, message: str, status: Optional[int] = None):
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.status = status


class AIPlatform:
    def __init__(self, base_url: str, api_key: str, timeout: float = 300.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update(
            {"content-type": "application/json", "x-api-key": api_key}
        )

    # ------------------------------------------------------------------ core
    def _request(self, path: str, method: str = "POST", body: Optional[dict] = None) -> dict:
        res = self._session.request(
            method, self.base_url + path, json=body, timeout=self.timeout
        )
        try:
            data = res.json()
        except ValueError as exc:
            raise AIPlatformError("INVALID_RESPONSE", str(exc), res.status_code) from exc
        if not res.ok or data.get("success") is False:
            error = data.get("error") or {}
            raise AIPlatformError(
                error.get("code", "HTTP_ERROR"),
                error.get("message", f"HTTP {res.status_code}"),
                res.status_code,
            )
        return data

    @staticmethod
    def _clean(params: Dict[str, Any]) -> Dict[str, Any]:
        return {k: v for k, v in params.items() if v is not None}

    # ------------------------------------------------------------- endpoints
    def text(self, prompt: str, *, system: Optional[str] = None, provider: Optional[str] = None,
             model: Optional[str] = None, max_tokens: Optional[int] = None,
             temperature: Optional[float] = None, cache: Optional[bool] = None) -> dict:
        return self._request("/v1/text", body=self._clean({
            "prompt": prompt, "system": system, "provider": provider, "model": model,
            "maxTokens": max_tokens, "temperature": temperature, "cache": cache,
        }))

    def chat(self, messages: List[dict], *, provider: Optional[str] = None,
             model: Optional[str] = None, max_tokens: Optional[int] = None) -> dict:
        return self._request("/v1/chat", body=self._clean({
            "messages": messages, "provider": provider, "model": model, "maxTokens": max_tokens,
        }))

    def image(self, prompt: str, *, negative_prompt: Optional[str] = None,
              width: Optional[int] = None, height: Optional[int] = None,
              steps: Optional[int] = None, seed: Optional[int] = None,
              image: Optional[str] = None, provider: Optional[str] = None,
              model: Optional[str] = None, wait: bool = True) -> dict:
        return self._request("/v1/image", body=self._clean({
            "prompt": prompt, "negativePrompt": negative_prompt, "width": width,
            "height": height, "steps": steps, "seed": seed, "image": image,
            "provider": provider, "model": model, "wait": wait,
        }))

    def upscale(self, image: str, *, scale: int = 4, provider: Optional[str] = None,
                wait: bool = True) -> dict:
        return self._request("/v1/upscale", body=self._clean({
            "image": image, "scale": scale, "provider": provider, "wait": wait,
        }))

    def vision(self, prompt: str, images: List[str], *, provider: Optional[str] = None,
               model: Optional[str] = None) -> dict:
        return self._request("/v1/vision", body=self._clean({
            "prompt": prompt, "images": images, "provider": provider, "model": model,
        }))

    def embed(self, input: Union[str, List[str]], *, provider: Optional[str] = None,
              model: Optional[str] = None) -> dict:
        return self._request("/v1/embed", body=self._clean({
            "input": input, "provider": provider, "model": model,
        }))

    def ocr(self, image: str, *, language: Optional[str] = None, wait: bool = True) -> dict:
        return self._request("/v1/ocr", body=self._clean({
            "image": image, "language": language, "wait": wait,
        }))

    def create_job(self, type: str, payload: dict, *, priority: Optional[int] = None) -> dict:
        return self._request("/v1/jobs", body=self._clean({
            "type": type, "payload": payload, "priority": priority,
        }))

    def get_job(self, job_id: str) -> dict:
        return self._request(f"/v1/jobs/{job_id}", method="GET")

    def wait_job(self, job_id: str, *, poll_seconds: float = 2.0, timeout: float = 300.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = self.get_job(job_id)
            if status.get("status") in ("completed", "failed"):
                return status
            time.sleep(poll_seconds)
        raise AIPlatformError("TIMEOUT", f"job {job_id} did not finish in time")

    def models(self, provider: Optional[str] = None) -> dict:
        qs = f"?provider={provider}" if provider else ""
        return self._request(f"/v1/models{qs}", method="GET")

    def providers(self) -> dict:
        return self._request("/v1/providers", method="GET")

    def health(self) -> dict:
        return self._request("/v1/health", method="GET")
