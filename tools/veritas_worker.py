# ==============================================================================
# Véritas Agent Worker — tools/veritas_worker.py
# ==============================================================================
# Key Rotator con round-robin, rate-limit cooldown y agotamiento mensual.
# 16 tools asíncronas (httpx + asyncio) para el agente OSINT Véritas.
#
# Todas las API keys se inyectan como variables de entorno (Cloudflare Secrets
# o .env). NUNCA hardcodear claves.
#
# Uso:
#   from veritas_worker import KeyRotator, tools
#   rotator = KeyRotator()
#   result = await tools.tavily_search(rotator, "query")
# ==============================================================================

from __future__ import annotations

import asyncio
import json
import os
import time
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import httpx

logger = logging.getLogger("veritas.worker")


# ==============================================================================
# A.1. KEY ROTATOR
# ==============================================================================

class KeyStatus(str, Enum):
    ACTIVE = "active"
    RATE_LIMITED = "rate_limited"
    EXHAUSTED = "exhausted"


@dataclass
class KeyEntry:
    key: str
    status: KeyStatus = KeyStatus.ACTIVE
    cooldown_until: float = 0.0          # timestamp absoluto para rate_limit (60s)
    exhausted_until: float = 0.0        # timestamp absoluto para 402/401 (mes siguiente)
    request_count: int = 0


class KeyRotator:
    """
    Gestor de cuotas multi-key con round-robin.
    Reglas:
      - Round-robin entre keys disponibles.
      - HTTP 429/403 → rate_limited 60s.
      - HTTP 402/401 → exhausted hasta mes siguiente.
    """

    # Mapa: prefijo de variable de entorno → nombre de servicio interno.
    # Ejemplo: FIRECRAWL_API_KEY_1, FIRECRAWL_API_KEY_2 → servicio "firecrawl"
    SERVICE_PREFIXES: dict[str, list[str]] = {
        "firecrawl": ["FIRECRAWL_API_KEY"],
        "scrape_do": ["SCRAPE_DO_API_KEY"],
        "steel": ["STEEL_API_KEY"],
        "apify": ["APIFY_API_KEY"],
        "browserless": ["BROWSERLESS_API_KEY"],
        "browser_use": ["BROWSER_USE_API_KEY"],
        "tavily": ["TAVILY_API_KEY"],
        "exa": ["EXA_API_KEY"],
        "newsapi": ["NEWSAPI_API_KEY"],
        "llamaparse": ["LLAMAPARSE_API_KEY"],
        "shodan": ["SHODAN_API_KEY"],
        "zoomeye": ["ZOOMEYE_API_KEY"],
        "grayhat": ["GRAYHAT_API_KEY"],
        "github": ["GITHUB_TOKEN"],
        "aviationstack": ["AVIATIONSTACK_API_KEY"],
        "gfw": ["GFW_API_TOKEN"],
    }

    RATE_LIMIT_COOLDOWN: int = 60  # segundos

    def __init__(self) -> None:
        self._keys: dict[str, list[KeyEntry]] = {}
        self._index: dict[str, int] = {}  # round-robin pointer por servicio
        self._load_keys()

    # ------------------------------------------------------------------
    # Carga inicial
    # ------------------------------------------------------------------
    def _load_keys(self) -> None:
        for service, prefixes in self.SERVICE_PREFIXES.items():
            entries: list[KeyEntry] = []
            for prefix in prefixes:
                idx = 1
                while True:
                    val = os.environ.get(f"{prefix}_{idx}")
                    if not val:
                        break
                    entries.append(KeyEntry(key=val.strip()))
                    idx += 1
            if entries:
                self._keys[service] = entries
                self._index[service] = 0
                logger.info(
                    "KeyRotator: servicio=%s  keys_cargadas=%d",
                    service, len(entries),
                )
            else:
                logger.warning("KeyRotator: sin keys para servicio=%s", service)

    # ------------------------------------------------------------------
    # Obtener key válida (round-robin)
    # ------------------------------------------------------------------
    def get_key(self, service: str) -> Optional[str]:
        entries = self._keys.get(service)
        if not entries:
            return None

        now = time.monotonic()
        n = len(entries)
        start = self._index.get(service, 0) % n

        for i in range(n):
            idx = (start + i) % n
            entry = entries[idx]

            # Verificar cooldowns
            if entry.status == KeyStatus.RATE_LIMITED and now >= entry.cooldown_until:
                entry.status = KeyStatus.ACTIVE
            if entry.status == KeyStatus.EXHAUSTED and now >= entry.exhausted_until:
                entry.status = KeyStatus.ACTIVE

            if entry.status == KeyStatus.ACTIVE:
                self._index[service] = (idx + 1) % n
                entry.request_count += 1
                return entry.key

        logger.warning("KeyRotator: todas las keys agotadas para %s", service)
        return None

    # ------------------------------------------------------------------
    # Reportar estado de una key tras una llamada HTTP
    # ------------------------------------------------------------------
    def report(self, service: str, key: str, status_code: int) -> None:
        entries = self._keys.get(service, [])
        for entry in entries:
            if entry.key == key:
                now = time.monotonic()
                if status_code in (429, 403):
                    entry.status = KeyStatus.RATE_LIMITED
                    entry.cooldown_until = now + self.RATE_LIMIT_COOLDOWN
                    logger.info(
                        "KeyRotator: %s key rate_limited 60s (HTTP %d)",
                        service, status_code,
                    )
                elif status_code in (402, 401):
                    entry.status = KeyStatus.EXHAUSTED
                    # Calcular inicio del mes siguiente
                    import calendar
                    from datetime import datetime
                    today = datetime.now()
                    last_day = calendar.monthrange(today.year, today.month)[1]
                    next_month = datetime(today.year, today.month, last_day, 23, 59, 59)
                    entry.exhausted_until = now + (next_month.timestamp() - today.timestamp())
                    logger.warning(
                        "KeyRotator: %s key exhausted hasta mes siguiente (HTTP %d)",
                        service, status_code,
                    )
                break

    # ------------------------------------------------------------------
    # Estado visible (para debug/dashboard)
    # ------------------------------------------------------------------
    def get_status(self, service: str) -> dict[str, Any]:
        entries = self._keys.get(service, [])
        return {
            "service": service,
            "total_keys": len(entries),
            "active": sum(1 for e in entries if e.status == KeyStatus.ACTIVE),
            "rate_limited": sum(1 for e in entries if e.status == KeyStatus.RATE_LIMITED),
            "exhausted": sum(1 for e in entries if e.status == KeyStatus.EXHAUSTED),
            "keys": [
                {
                    "masked": f"{e.key[:6]}…{e.key[-4:]}",
                    "status": e.status.value,
                    "requests": e.request_count,
                }
                for e in entries
            ],
        }

    def all_status(self) -> dict[str, Any]:
        return {svc: self.get_status(svc) for svc in self._keys}


# ==============================================================================
# HELPERS
# ==============================================================================

async def _safe_request(
    method: str,
    url: str,
    *,
    rotator: KeyRotator,
    service: str,
    headers: dict | None = None,
    params: dict | None = None,
    json_body: Any = None,
    timeout: float = 30.0,
    max_retries: int = 1,
) -> dict[str, Any]:
    """
    Wrapper genérico que obtiene key del rotador, hace la petición,
    reporta al rotador y devuelve dict con {ok, data, error, service, status_code}.
    """
    key = rotator.get_key(service)
    if not key:
        return {
            "ok": False,
            "data": None,
            "error": f"No hay keys disponibles para {service}. Cuota agotada.",
            "service": service,
            "status_code": None,
            "exhausted": True,
        }

    # Inyectar key en headers según servicio
    hdrs = dict(headers or {})
    auth_header, auth_prefix = _auth_strategy(service)
    if auth_header:
        hdrs[auth_header] = f"{auth_prefix}{key}"

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.request(
                    method, url, headers=hdrs, params=params, json=json_body,
                )

            # Reportar al rotator
            if resp.status_code in (429, 403, 402, 401):
                rotator.report(service, key, resp.status_code)

            if resp.status_code == 429 and attempt < max_retries:
                await asyncio.sleep(2 ** attempt)
                # Reintentar con siguiente key
                key = rotator.get_key(service)
                if key and auth_header:
                    hdrs[auth_header] = f"{auth_prefix}{key}"
                continue

            try:
                data = resp.json()
            except Exception:
                data = resp.text

            if resp.status_code >= 400:
                return {
                    "ok": False,
                    "data": data,
                    "error": f"HTTP {resp.status_code} desde {service}",
                    "service": service,
                    "status_code": resp.status_code,
                }

            return {
                "ok": True,
                "data": data,
                "error": None,
                "service": service,
                "status_code": resp.status_code,
            }

        except httpx.TimeoutException:
            last_error = f"Timeout ({timeout}s) conectando a {service}"
        except Exception as exc:
            last_error = str(exc)

    return {
        "ok": False,
        "data": None,
        "error": last_error or f"Error desconocido en {service}",
        "service": service,
        "status_code": None,
    }


def _auth_strategy(service: str) -> tuple[Optional[str], str]:
    """Devuelve (header_name, prefix) para cada servicio."""
    strategies = {
        "firecrawl": ("Authorization", "Bearer "),
        "scrape_do": ("Authorization", "Bearer "),
        "steel": ("Authorization", "Bearer "),
        "apify": (None, ""),          # se pasa como query param
        "browserless": ("Authorization", "Bearer "),
        "browser_use": ("Authorization", "Bearer "),
        "tavily": ("Authorization", "Bearer "),
        "exa": ("x-api-key", ""),
        "newsapi": (None, ""),          # se pasa como query param
        "llamaparse": ("Authorization", "Bearer "),
        "shodan": ("Authorization", "Bearer "),  # o X-API-Key
        "zoomeye": ("Authorization", "Bearer "),
        "grayhat": (None, ""),           # custom header
        "github": ("Authorization", "Bearer "),
        "aviationstack": (None, ""),     # query param
        "gfw": (None, ""),               # query param
    }
    return strategies.get(service, (None, ""))


# ==============================================================================
# A.2. TOOL FUNCTIONS
# ==============================================================================

# ─── SCRAPING & BROWSING ─────────────────────────────────────────────────────

async def firecrawl_scrape(
    rotator: KeyRotator,
    url: str,
    formats: list[str] | None = None,
    stealth: bool = False,
) -> dict[str, Any]:
    """
    Firecrawl — Scrape rápido (markdown/JSON).
    Cuota: ~1k peticiones/mes (tier free).
    """
    if formats is None:
        formats = ["markdown"]

    payload: dict[str, Any] = {
        "url": url,
        "formats": formats,
    }
    if stealth:
        payload["actions"] = [{"type": "wait", "milliseconds": 2000}]

    return await _safe_request(
        "POST",
        "https://api.firecrawl.dev/v1/scrape",
        rotator=rotator,
        service="firecrawl",
        json_body=payload,
        timeout=30.0,
    )


async def scrape_do_fetch(
    rotator: KeyRotator,
    url: str,
    render: bool = False,
    super_proxy: bool = False,
) -> dict[str, Any]:
    """
    Scrape.do — Anti-bot/WAF bypass.
    Cuota: ~1k peticiones/mes (tier free).
    """
    payload: dict[str, Any] = {"url": url}
    if render:
        payload["render"] = True
    if super_proxy:
        payload["superProxy"] = True

    return await _safe_request(
        "POST",
        "https://api.scrape.do/token",
        rotator=rotator,
        service="scrape_do",
        json_body=payload,
        timeout=30.0,
    )


# Mapa de actores Apify predefinidos para redes sociales
APIFY_DEFAULT_ACTORS: dict[str, str] = {
    "instagram": "apify/instagram-scraper",
    "facebook": "apify/facebook-pages-scraper",
    "twitter": "apify/twitter-scraper",
    "tiktok": "apify/tiktok-scraper",
    "linkedin": "apify/linkedin-profile-scraper",
}


async def apify_run_actor(
    rotator: KeyRotator,
    actor_id: str,
    input_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Apify — Ejecutar actor (scraping de redes, etc.).
    Cuota: ~$5/mes (tier free).
    """
    # Resolver alias
    resolved = APIFY_DEFAULT_ACTORS.get(actor_id.lower(), actor_id)

    key = rotator.get_key("apify")
    if not key:
        return {
            "ok": False, "data": None,
            "error": "No hay keys para Apify. Cuota agotada.",
            "service": "apify", "status_code": None, "exhausted": True,
        }

    return await _safe_request(
        "POST",
        f"https://api.apify.com/v2/acts/{resolved}/runs?token={key}",
        rotator=rotator,
        service="apify",
        json_body=input_data or {},
        timeout=60.0,
    )


async def browserless_navigate(
    rotator: KeyRotator,
    url: str,
    actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Browserless — Headless cloud. CAPTCHA gratis.
    Cuota: ~1k units/mes (tier free).
    """
    payload: dict[str, Any] = {
        "url": url,
    }
    if actions:
        payload["actions"] = actions

    return await _safe_request(
        "POST",
        "https://chrome.browserless.io/content",
        rotator=rotator,
        service="browserless",
        json_body=payload,
        timeout=60.0,
    )


async def steel_browser_session(
    rotator: KeyRotator,
    task: dict[str, Any],
    stealth: bool = True,
) -> dict[str, Any]:
    """
    Steel.dev — Sesión de navegador stealth con CDP.
    Cuota: ~100h/mes (tier free).
    """
    payload: dict[str, Any] = {
        **task,
        "stealth": stealth,
    }

    return await _safe_request(
        "POST",
        "https://api.steel.dev/v1/sessions",
        rotator=rotator,
        service="steel",
        json_body=payload,
        timeout=120.0,
    )


async def browser_use_agent(
    rotator: KeyRotator,
    task: str,
    model: str = "claude-sonnet-4-6",
) -> dict[str, Any]:
    """
    Browser-use — Agente LLM que razona y navega.
    Cuota: ~10 tasks/mes (tier free).
    """
    payload: dict[str, Any] = {
        "task": task,
        "model": model,
    }

    return await _safe_request(
        "POST",
        "https://api.browser-use.com/v1/tasks",
        rotator=rotator,
        service="browser_use",
        json_body=payload,
        timeout=180.0,
    )


# ─── BÚSQUEDA Y NOTICIAS ─────────────────────────────────────────────────────

async def tavily_search(
    rotator: KeyRotator,
    query: str,
    max_results: int = 5,
) -> dict[str, Any]:
    """
    Tavily — Búsqueda AI con resúmenes.
    Cuota: ~1k peticiones/mes (tier free).
    """
    payload: dict[str, Any] = {
        "query": query,
        "max_results": max_results,
        "include_answer": True,
    }

    return await _safe_request(
        "POST",
        "https://api.tavily.com/search",
        rotator=rotator,
        service="tavily",
        json_body=payload,
        timeout=20.0,
    )


async def exa_search(
    rotator: KeyRotator,
    query: str,
    num_results: int = 5,
) -> dict[str, Any]:
    """
    Exa — Búsqueda semántica neuronal.
    Cuota: ~1k peticiones/mes (tier free).
    """
    payload: dict[str, Any] = {
        "query": query,
        "numResults": num_results,
        "contents": {"text": {"maxCharacters": 1000}},
    }

    return await _safe_request(
        "POST",
        "https://api.exa.ai/search",
        rotator=rotator,
        service="exa",
        json_body=payload,
        timeout=20.0,
    )


async def gdelt_search_events(
    rotator: KeyRotator,
    keyword: str,
    tone: str | None = None,
    timespan: str = "1w",
) -> dict[str, Any]:
    """
    GDELT Project — Análisis de eventos globales y tono.
    GRATUITO E ILIMITADO. No requiere key.
    
    Parámetros tone: "Positive", "Negative", "Neutral" (o None para todos).
    Timespan: "1d", "1w", "1m", "3m", "6m", "1y".
    """
    params: dict[str, Any] = {
        "maxrecords": 50,
        "timespan": timespan,
        "format": "json",
    }
    if keyword:
        params["keyword"] = keyword
    if tone:
        params["tone"] = tone

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params=params,
            )
        if resp.status_code == 200:
            try:
                data = resp.json()
            except Exception:
                data = resp.text
            return {
                "ok": True, "data": data, "error": None,
                "service": "gdelt", "status_code": 200,
            }
        return {
            "ok": False, "data": None,
            "error": f"GDELT HTTP {resp.status_code}",
            "service": "gdelt", "status_code": resp.status_code,
        }
    except Exception as exc:
        return {
            "ok": False, "data": None,
            "error": str(exc),
            "service": "gdelt", "status_code": None,
        }


# ─── PROCESAMIENTO ────────────────────────────────────────────────────────────

async def llamaparse_pdf(
    rotator: KeyRotator,
    file_url: str,
) -> dict[str, Any]:
    """
    LlamaParse — PDF complejo a Markdown.
    Cuota: ~1k páginas/día (tier free).
    """
    payload: dict[str, Any] = {
        "url": file_url,
        "language": "es",
    }

    return await _safe_request(
        "POST",
        "https://api.cloud.llamaindex.ai/api/parsing/parse",
        rotator=rotator,
        service="llamaparse",
        json_body=payload,
        timeout=60.0,
    )


# ─── OSINT ────────────────────────────────────────────────────────────────────

async def shodan_lookup_ip(
    rotator: KeyRotator,
    ip: str,
) -> dict[str, Any]:
    """
    Shodan — Lookup de IP (puertos, SSL, ISP, geo).
    GRATUITO: 1 req/seg, 100 resultados por search.
    """
    return await _safe_request(
        "GET",
        f"https://api.shodan.io/shodan/host/{ip}",
        rotator=rotator,
        service="shodan",
        timeout=15.0,
    )


async def zoomeye_search(
    rotator: KeyRotator,
    query: str,
) -> dict[str, Any]:
    """
    ZoomEye — Búsqueda de dispositivos expuestos (similar a Censys).
    Cuota: ~10k peticiones/mes (tier free).
    """
    params: dict[str, Any] = {
        "query": query,
        "page": 1,
        "mode": "host",
    }

    return await _safe_request(
        "GET",
        "https://api.zoomeye.org/host/search",
        rotator=rotator,
        service="zoomeye",
        params=params,
        timeout=15.0,
    )


async def grayhat_search(
    rotator: KeyRotator,
    query: str,
) -> dict[str, Any]:
    """
    Grayhat Warfare — Cámaras IP y streams abiertos.
    Cuota: ~100 peticiones/día (tier free).
    """
    key = rotator.get_key("grayhat")
    if not key:
        return {
            "ok": False, "data": None,
            "error": "No hay keys para Grayhat. Cuota agotada.",
            "service": "grayhat", "status_code": None, "exhausted": True,
        }

    headers = {"X-API-KEY": key}
    return await _safe_request(
        "GET",
        f"https://api.grayhatwarfare.com/v1/search?q={query}",
        rotator=rotator,
        service="grayhat",
        headers=headers,
        timeout=15.0,
    )


async def github_search_user(
    rotator: KeyRotator,
    username: str,
) -> dict[str, Any]:
    """
    GitHub — OSINT de desarrolladores (perfil, repos, actividad).
    Cuota: ~5k req/hora (autenticado).
    """
    # Perfil
    profile = await _safe_request(
        "GET",
        f"https://api.github.com/users/{username}",
        rotator=rotator,
        service="github",
        timeout=10.0,
    )
    # Repos públicos (top 10)
    repos = await _safe_request(
        "GET",
        f"https://api.github.com/users/{username}/repos?sort=updated&per_page=10",
        rotator=rotator,
        service="github",
        timeout=10.0,
    )

    return {
        "ok": profile["ok"] and repos["ok"],
        "data": {
            "profile": profile.get("data"),
            "repos": repos.get("data"),
        },
        "error": ", ".join(filter(None, [profile.get("error"), repos.get("error")])) or None,
        "service": "github",
        "status_code": profile.get("status_code"),
    }


# ─── RASTREO ──────────────────────────────────────────────────────────────────

async def aviationstack_get_flight(
    rotator: KeyRotator,
    flight_iata: str | None = None,
    arr_iata: str | None = None,
) -> dict[str, Any]:
    """
    AviationStack — Vuelos comerciales por número o aeropuerto.
    Cuota: ~100 peticiones/mes (tier free).
    """
    key = rotator.get_key("aviationstack")
    if not key:
        return {
            "ok": False, "data": None,
            "error": "No hay keys para AviationStack. Cuota agotada.",
            "service": "aviationstack", "status_code": None, "exhausted": True,
        }

    params: dict[str, Any] = {"access_key": key}
    if flight_iata:
        params["flight_iata"] = flight_iata
    if arr_iata:
        params["arr_iata"] = arr_iata

    return await _safe_request(
        "GET",
        "https://api.aviationstack.com/v1/flights",
        rotator=rotator,
        service="aviationstack",
        params=params,
        timeout=15.0,
    )


async def gfw_get_vessel(
    rotator: KeyRotator,
    imo: str | None = None,
) -> dict[str, Any]:
    """
    Global Fishing Watch — Rastreo de barcos comerciales/pesqueros.
    GRATUITO (con token de investigación).
    """
    key = rotator.get_key("gfw")
    if not key:
        return {
            "ok": False, "data": None,
            "error": "No hay token GFW configurado.",
            "service": "gfw", "status_code": None, "exhausted": True,
        }

    params: dict[str, Any] = {"token": key}
    if imo:
        params["imo"] = imo

    return await _safe_request(
        "GET",
        "https://gateway.api.globalfishingwatch.org/v1/vessels",
        rotator=rotator,
        service="gfw",
        params=params,
        timeout=15.0,
    )


# ==============================================================================
# REGISTRO DE TOOLS (para el orquestador)
# ==============================================================================

TOOLS_REGISTRY: list[dict[str, Any]] = [
    {
        "name": "firecrawl_scrape",
        "description": "Scrapea una URL y devuelve el contenido en formato markdown o JSON. Rápido, ideal para artículos y páginas estáticas.",
        "params": {
            "url": {"type": "string", "required": True, "description": "URL a scrapear"},
            "formats": {"type": "array", "required": False, "description": "Formatos de salida: [\"markdown\", \"html\", \"rawHtml\"]"},
            "stealth": {"type": "boolean", "required": False, "description": "Activar modo stealth (espera 2s para JS)"},
        },
        "quota": "~1k/mes",
        "function": firecrawl_scrape,
    },
    {
        "name": "scrape_do_fetch",
        "description": "Scrapeo con bypass anti-bot/WAF. Útil para sitios protegidos por Cloudflare, Datadome, etc.",
        "params": {
            "url": {"type": "string", "required": True, "description": "URL a scrapear"},
            "render": {"type": "boolean", "required": False, "description": "Ejecutar JavaScript antes de extraer"},
            "super_proxy": {"type": "boolean", "required": False, "description": "Usar super proxy residencial"},
        },
        "quota": "~1k/mes",
        "function": scrape_do_fetch,
    },
    {
        "name": "apify_run_actor",
        "description": "Ejecuta un actor de Apify para scraping de redes sociales. Actores predefinidos: instagram, facebook, twitter, tiktok, linkedin.",
        "params": {
            "actor_id": {"type": "string", "required": True, "description": "ID del actor o alias (instagram, facebook, twitter, tiktok, linkedin)"},
            "input_data": {"type": "object", "required": False, "description": "Input JSON para el actor"},
        },
        "quota": "~$5/mes",
        "function": apify_run_actor,
    },
    {
        "name": "browserless_navigate",
        "description": "Navegador headless en la nube. Ejecuta acciones en la página y devuelve contenido. CAPTCHA handling incluido.",
        "params": {
            "url": {"type": "string", "required": True, "description": "URL a navegar"},
            "actions": {"type": "array", "required": False, "description": "Lista de acciones a ejecutar en la página"},
        },
        "quota": "~1k units/mes",
        "function": browserless_navigate,
    },
    {
        "name": "steel_browser_session",
        "description": "Sesión de navegador con stealth avanzado y CDP. Ideal para sitios con detección de bots agresiva.",
        "params": {
            "task": {"type": "object", "required": True, "description": "Objeto con url y opciones de sesión"},
            "stealth": {"type": "boolean", "required": False, "description": "Activar modo stealth (por defecto true)"},
        },
        "quota": "~100h/mes",
        "function": steel_browser_session,
    },
    {
        "name": "browser_use_agent",
        "description": "Agente LLM que razona y navega la web. Puede completar formularios, wizards y flujos multi-paso. El más costoso.",
        "params": {
            "task": {"type": "string", "required": True, "description": "Instrucción en lenguaje natural de lo que debe hacer en la web"},
            "model": {"type": "string", "required": False, "description": "Modelo LLM a usar (claude-sonnet-4-6 por defecto)"},
        },
        "quota": "~10 tasks/mes",
        "function": browser_use_agent,
    },
    {
        "name": "tavily_search",
        "description": "Búsqueda web con IA. Devuelve resultados con resúmenes generativos. Ideal para investigación rápida.",
        "params": {
            "query": {"type": "string", "required": True, "description": "Consulta de búsqueda"},
            "max_results": {"type": "integer", "required": False, "description": "Máximo de resultados (1-10, defecto 5)"},
        },
        "quota": "~1k/mes",
        "function": tavily_search,
    },
    {
        "name": "exa_search",
        "description": "Búsqueda semántica neuronal. Encuentra contenido conceptualmente relacionado, no solo por keywords.",
        "params": {
            "query": {"type": "string", "required": True, "description": "Consulta de búsqueda semántica"},
            "num_results": {"type": "integer", "required": False, "description": "Número de resultados (1-10, defecto 5)"},
        },
        "quota": "~1k/mes",
        "function": exa_search,
    },
    {
        "name": "gdelt_search_events",
        "description": "Búsqueda de eventos globales en GDELT. Análisis de tono (positivo/negativo/neutro). GRATUITO E ILIMITADO.",
        "params": {
            "keyword": {"type": "string", "required": True, "description": "Palabra clave o frase para buscar eventos"},
            "tone": {"type": "string", "required": False, "description": "Filtrar por tono: Positive, Negative, Neutral, o null para todos"},
            "timespan": {"type": "string", "required": False, "description": "Período: 1d, 1w, 1m, 3m, 6m, 1y (defecto 1w)"},
        },
        "quota": "GRATUITO / ilimitado",
        "function": gdelt_search_events,
    },
    {
        "name": "llamaparse_pdf",
        "description": "Convierte PDFs complejos (tablas, imágenes, multi-columna) a Markdown. Ideal para documentos legales, informes financieros.",
        "params": {
            "file_url": {"type": "string", "required": True, "description": "URL pública del PDF a parsear"},
        },
        "quota": "~1k páginas/día",
        "function": llamaparse_pdf,
    },
    {
        "name": "shodan_lookup_ip",
        "description": "Lookup de IP en Shodan. Devuelve puertos abiertos, certificados SSL, ISP, geolocalización, banner de servicios.",
        "params": {
            "ip": {"type": "string", "required": True, "description": "Dirección IP a consultar"},
        },
        "quota": "GRATUITO / 1 req/seg",
        "function": shodan_lookup_ip,
    },
    {
        "name": "zoomeye_search",
        "description": "Búsqueda de dispositivos expuestos en internet. Similar a Censys. Busca por puerto, servicio, banner, ubicación.",
        "params": {
            "query": {"type": "string", "required": True, "description": "Consulta de búsqueda (ej: port:8080 country:CU)"},
        },
        "quota": "~10k/mes",
        "function": zoomeye_search,
    },
    {
        "name": "grayhat_search",
        "description": "Búsqueda de cámaras IP y streams abiertos (no autenticados). OSINT de dispositivos IoT visuales.",
        "params": {
            "query": {"type": "string", "required": True, "description": "Consulta de búsqueda (ubicación, tipo de cámara, etc.)"},
        },
        "quota": "~100/día",
        "function": grayhat_search,
    },
    {
        "name": "github_search_user",
        "description": "OSINT de desarrolladores en GitHub. Perfil, repos públicos, actividad reciente, lenguajes usados.",
        "params": {
            "username": {"type": "string", "required": True, "description": "Nombre de usuario de GitHub"},
        },
        "quota": "~5k/hora",
        "function": github_search_user,
    },
    {
        "name": "aviationstack_get_flight",
        "description": "Consulta vuelos comerciales por número de vuelo o aeropuerto de llegada. Datos en tiempo real y programados.",
        "params": {
            "flight_iata": {"type": "string", "required": False, "description": "Número de vuelo IATA (ej: AV123)"},
            "arr_iata": {"type": "string", "required": False, "description": "Código IATA del aeropuerto de llegada"},
        },
        "quota": "~100/mes",
        "function": aviationstack_get_flight,
    },
    {
        "name": "gfw_get_vessel",
        "description": "Rastreo de barcos comerciales y pesqueros por número IMO. Rutas, velocidad, bandera, historial de puertos.",
        "params": {
            "imo": {"type": "string", "required": False, "description": "Número IMO del barco"},
        },
        "quota": "GRATUITO (con token)",
        "function": gfw_get_vessel,
    },
]


def get_tool(name: str) -> Optional[dict[str, Any]]:
    """Obtiene la definición de una tool por nombre."""
    for t in TOOLS_REGISTRY:
        if t["name"] == name:
            return t
    return None


def get_all_tools_schema() -> list[dict[str, Any]]:
    """Devuelve el schema de todas las tools (para inyectar en el system prompt)."""
    return [
        {
            "name": t["name"],
            "description": t["description"],
            "params": t["params"],
            "quota": t["quota"],
        }
        for t in TOOLS_REGISTRY
    ]


# ==============================================================================
# CHAIN RESOLVER (fallback automático entre herramientas similares)
# ==============================================================================

FALLBACK_CHAINS: dict[str, list[str]] = {
    "web_search": ["gdelt_search_events", "tavily_search", "exa_search"],
    "scrape_static": ["firecrawl_scrape", "scrape_do_fetch", "browserless_navigate"],
    "scrape_stealth": ["apify_run_actor", "steel_browser_session", "browser_use_agent"],
    "scrape_reasoned": ["browser_use_agent", "steel_browser_session"],
    "pdf_parse": ["llamaparse_pdf"],
    "osint_ip": ["shodan_lookup_ip", "zoomeye_search"],
    "osint_cameras": ["grayhat_search", "zoomeye_search"],
    "osint_dev": ["github_search_user"],
    "track_flight": ["aviationstack_get_flight"],
    "track_vessel": ["gfw_get_vessel"],
}


async def execute_chain(
    chain_name: str,
    rotator: KeyRotator,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Ejecuta una cadena de fallback. Intenta cada tool en orden
    hasta que una devuelva ok=True.
    """
    chain = FALLBACK_CHAINS.get(chain_name, [])
    errors: list[str] = []
    last_result: dict[str, Any] = {}

    for tool_name in chain:
        tool = get_tool(tool_name)
        if not tool:
            continue

        func = tool["function"]
        try:
            result = await func(rotator, **kwargs)
            last_result = result
            if result.get("ok"):
                result["tool_used"] = tool_name
                result["chain"] = chain_name
                return result
            errors.append(f"{tool_name}: {result.get('error', 'unknown')}")
        except Exception as exc:
            errors.append(f"{tool_name}: {str(exc)}")

    return {
        "ok": False,
        "data": None,
        "error": f"Todas las tools de la cadena '{chain_name}' fallaron: {'; '.join(errors)}",
        "service": chain_name,
        "chain_errors": errors,
        **last_result,
    }
