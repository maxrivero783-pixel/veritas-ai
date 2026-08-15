# Guía de despliegue de Véritas en Cloudflare

Guía completa paso a paso para desplegar Véritas en Cloudflare Pages + Pages Functions + D1 + R2.

---

## 1. Arquitectura objetivo

```
Navegador (SPA vanilla: index.html, app.js, styles.css)
        │
        ▼
Cloudflare Pages (estáticos)  +  Pages Functions  /functions/api/[[route]].js
        │                                     │
        │                                     ├── D1 (SQLite) → chats, mensajes, users,
        │                                     │                 skills, OAuth, cuotas, caché
        │                                     └── R2 → documentos, archivos de proyecto
        │
        └── SDKs externos: Puter, OpenRouter, Jina, Tavily, Serper, Firecrawl, …
```

- **Sin build step**: el frontend es ES modules vanilla. El directorio de publicación es la raíz del repo (`.`).
- **Backend**: `functions/api/[[route]].js` y `functions/purge/scheduled.js`.
- **Cron**: cada 6 horas (`0 */6 * * *`) ejecuta purga y alertas.
- **Plan Free alcanza**, pero ten en cuenta: CPU 10 ms/request, 50 subrequests, 100k requests/día, 5 GB D1, 10 GB R2.

---

## 2. Prerrequisitos

- Cuenta en Cloudflare (gratuita).
- Cuenta de GitHub con el repo `maxrivero783-pixel/veritas-ai`.
- Una API key de **OpenRouter** (mínimo 1; recomendadas 2–3 para rotación).
- (Opcional) API keys de los servicios que quieras usar: Jina, Tavily, Serper, ScrapingBee, Firecrawl, Browser Use, Steel, Shodan, ZoomEye, etc. Sin ellas esas herramientas simplemente no estarán disponibles.
- (Opcional, para OAuth) una **OAuth App de GitHub**.
- Node.js 18+ y Wrangler CLI en tu máquina local:

```bash
npm install -g wrangler
wrangler --version
wrangler login          # abre el navegador y autoriza
```

---

## 3. Crear los recursos D1 y R2

### 3.1 Base de datos D1

```bash
wrangler d1 create veritas-db
```

Guarda el `database_id` que imprime (algo como `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

Crea las tablas (22 tablas) en la base **remota**:

```bash
wrangler d1 execute veritas-db --remote --file=./schema.sql
```

> Para desarrollo local también puedes ejecutarla sin `--remote`:
> `wrangler d1 execute veritas-db --file=./schema.sql`

Verifica:

```bash
wrangler d1 execute veritas-db --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

Deben aparecer: `users, sessions, rate_limits, chats, messages, repo_documents, openrouter_calls, api_key_state, api_key_cursor, tool_calls, oauth_pending, external_connections, external_api_calls, chat_participants, chat_turn_lock, chat_presence, user_memories, user_skills, notification_events, tool_cache, llm_cache, async_jobs`.

### 3.2 Bucket R2

```bash
wrangler r2 bucket create veritas-storage
wrangler r2 bucket list
```

---

## 4. Conectar el repositorio a Cloudflare Pages (recomendado)

Esta es la forma más simple: cada push a `main` despliega automáticamente.

1. Entra al **Dashboard de Cloudflare** → **Workers & Pages** → **Create application** → pestaña **Pages** → **Connect to Git**.
2. Autoriza a Cloudflare sobre GitHub si no lo has hecho.
3. Selecciona el repositorio `maxrivero783-pixel/veritas-ai`.
4. Configuración del build:
   - **Framework preset**: `None`
   - **Build command**: *(vacío)*
   - **Build output directory**: `.`
   - **Root directory**: *(vacío, raíz del repo)*
5. Antes de pulsar **Save and Deploy**, abre **Environment variables (advanced)** y añade las variables de la sección 6.
6. Pulsa **Save and Deploy**.

El primer deploy tarda ~1 minuto. Al final tendrás una URL tipo `https://veritas-ai.pages.dev`.

---

## 5. Configurar bindings en el dashboard

Con Pages conectado a Git, los bindings se configuran en el dashboard (no se leen del `wrangler.toml` en ese flujo).

Ve a: **Workers & Pages → `veritas-ai` → Settings → Bindings**.

### 5.1 D1

- Tipo: **D1 database**
- Variable name: `DB`
- D1 database: `veritas-db`

### 5.2 R2

- Tipo: **R2 bucket**
- Variable name: `BUCKET`
- R2 bucket: `veritas-storage`

### 5.3 KV (opcional)

El código también admite bindings KV con nombres `OSINT_STORE`, `OSINT_PROFILES`, `OSINT_LOGS`. No son obligatorios para Véritas (usa D1), pero si quieres activarlos:

- Tipo: **KV namespace**
- Crea el namespace en **Workers & Pages → KV → Create** (p. ej. `veritas-kv`) y asíócialo con las tres variables.

---

## 6. Variables y secretos

Las **variables públicas** (no sensibles) se ponen en **Settings → Environment variables → Production** (y Preview si quieres). Los **secretos** se añaden con `wrangler pages secret put` (recomendado) o marcando *"Encrypt"* en el dashboard.

### 6.1 Variables públicas (texto plano)

| Nombre | Valor | ¿Obligatorio? |
|---|---|---|
| `APP_VERSION` | `2.7.1` | recomendado |
| `PAGES_URL` | `https://veritas-ai.pages.dev` (tu URL real) | obligatorio para OAuth |
| `ARTIFACT_PROXY_ALLOWED_HOSTS` | déjalo como está en `wrangler.toml` | recomendado |
| `ADMIN_EMAILS` | `tu.email@dominio.com` (CSV) | recomendado |
| `ALLOW_REGISTRATION` | `true` o `false` | opcional (default `true`) |
| `FROM_EMAIL` | correo remitente (p. ej. `veritas@tu-dominio.com`) | opcional, para Brevo |
| `FROM_NAME` | `Véritas` | opcional |
| `GEONAMES_USERNAME` | tu usuario de GeoNames | opcional |
| `CROSSREF_MAILTO` | email para la API de Crossref | opcional |
| `OPENALEX_MAILTO` | email para la API de OpenAlex | opcional |
| `GITHUB_OAUTH_CLIENT_ID` | Client ID de la GitHub OAuth App | obligatorio para GitHub |

### 6.2 Secretos (encriptados)

Configuración recomendada por CLI (asegúrate de estar en la carpeta del repo):

```bash
# 1) Llave de cifrado de tokens OAuth (32 bytes en hex)
openssl rand -hex 32           # copia el resultado
wrangler pages secret put OAUTH_ENCRYPTION_KEY

# 2) Pool de OpenRouter (1 como mínimo; 2-3 para rotación)
wrangler pages secret put OPENROUTER_API_KEY_1
# pega tu sk-or-v1-... y Enter

# 3) Secrets de OAuth (solo si usas GitHub)
wrangler pages secret put GITHUB_OAUTH_CLIENT_SECRET

# 4) Herramientas opcionales, según lo que vayas a usar:
wrangler pages secret put JINA_API_KEY_1
wrangler pages secret put TAVILY_API_KEY_1
wrangler pages secret put SERPER_API_KEY_1
wrangler pages secret put SCRAPINGBEE_API_KEY_1
wrangler pages secret put FIRECRAWL_API_KEY_1
wrangler pages secret put BROWSER_USE_API_KEY_1
wrangler pages secret put STEEL_API_KEY_1
wrangler pages secret put SHODAN_API_KEY_1
wrangler pages secret put ZOOMEYE_API_KEY_1
wrangler pages secret put INTELX_API_KEY_1
wrangler pages secret put LLAMA_CLOUD_API_KEY_1
wrangler pages secret put ASSEMBLYAI_API_KEY_1
wrangler pages secret put APIFY_API_TOKEN_1
wrangler pages secret put BROWSERLESS_API_KEY_1
wrangler pages secret put ROVER_API_KEY_1
wrangler pages secret put SPIDER_CLOUD_API_KEY_1
wrangler pages secret put GFW_API_KEY_1
wrangler pages secret put JINA_READER_API_KEY_1
wrangler pages secret put JINA_GITHUB_API_KEY_1
wrangler pages secret put STEEL_AUTH_API_KEY_1
wrangler pages secret put NVD_API_KEY
```

Secrets de correo (notificaciones, opcional):

```bash
wrangler pages secret put EMAIL_API_KEY       # API key de Brevo
wrangler pages secret put BREVO_API_KEY       # alternativa reconocida
wrangler pages secret put BREVO_SENDER_EMAIL  # remitente verificado en Brevo
wrangler pages secret put BREVO_SENDER_NAME
```

Ver los secretos configurados (nunca se muestran los valores):

```bash
wrangler pages secret list
```

> **Importante sobre el sufijo `_1`, `_2`, `_N`**: el key rotador descubre automáticamente todas las variables con el prefijo y sufijo numérico. Añadir `OPENROUTER_API_KEY_2` te da rotación instantánea sin tocar código.

---

## 7. Cron Triggers

1. En el dashboard: **Workers & Pages → `veritas-ai` → Settings → Triggers → Cron Triggers**.
2. Añade:
   - **Cron expression**: `0 */6 * * *`
   - (c/6 horas; el mínimo del plan Free es cada 1 hora)
3. Salva.

Si prefieres desplegar por CLI, el bloque `[triggers]` del `wrangler.toml` se aplica al hacer:

```bash
wrangler pages deploy . --project-name=veritas-ai
```

---

## 8. OAuth apps (solo si conectas GitHub)

### 8.1 GitHub OAuth App

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Application name**: `Véritas`
3. **Homepage URL**: `https://veritas-ai.pages.dev`
4. **Authorization callback URL**: `https://veritas-ai.pages.dev/api/oauth/github/callback`
5. Crea el Client ID y genera un Client Secret.
6. Pon el Client ID en la variable pública `GITHUB_OAUTH_CLIENT_ID` y el Client Secret en el secreto `GITHUB_OAUTH_CLIENT_SECRET`.

---

## 9. Despliegue

### 9.1 Automático (recomendado)

Cada push a `main` dispara un deploy en Pages. Verifícalo en la pestaña **Deployments** del dashboard.

### 9.2 Manual por CLI

```bash
# Producción
wrangler pages deploy . --project-name=veritas-ai

# Preview (crea una URL efímera)
wrangler pages deploy . --project-name=veritas-ai --branch=preview
```

---

## 10. Desarrollo local

Crea `.dev.vars` en la raíz (NO se commitea):

```dotenv
DEV_USER_EMAIL=dev@veritas.local
ADMIN_EMAILS=dev@veritas.local
OPENROUTER_API_KEY_1=sk-or-v1-...
OAUTH_ENCRYPTION_KEY=<openssl rand -hex 32>
# opcionales:
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
JINA_API_KEY_1=...
TAVILY_API_KEY_1=...
```

Edita `wrangler.toml` y descomenta los bloques D1/R2 con el `database_id` real:

```toml
[[d1_databases]]
binding       = "DB"
database_name = "veritas-db"
database_id   = "tu-database-id-aqui"

[[r2_buckets]]
binding      = "BUCKET"
bucket_name  = "veritas-storage"
```

Lanza el entorno local:

```bash
wrangler pages dev .
```

Abre `http://localhost:8788`.

---

## 11. Verificación post-deploy

Sobre tu URL de producción:

1. `https://veritas-ai.pages.dev/` carga la SPA (debe aparecer la pantalla de login).
2. Registra un usuario con email + contraseña.
3. Crea un chat, selecciona un modelo y envía un mensaje.
4. Abre las **herramientas de desarrollador → Network**: las llamadas a `/api/chat/*` deben devolver 200.
5. En **Ajustes → Acerca de** debe aparecer la versión y el estado del proveedor.
6. Endpoints de salud:
   - `GET /api/status` → JSON con versión, bindings y cuotas
   - `GET /api/health` (si existe) → 200 OK
7. Revisa los logs en vivo:

```bash
wrangler pages deployment tail --project-name=veritas-ai
```

### Síntomas y arreglos rápidos

| Síntoma | Causa típica | Arreglo |
|---|---|---|
| `D1_ERROR: no such table` | Schema no aplicado | `wrangler d1 execute veritas-db --remote --file=./schema.sql` |
| `The D1 database binding is required` | Binding `DB` no configurado | Settings → Bindings → D1 |
| `The R2 bucket binding is required` | Binding `BUCKET` no configurado | Settings → Bindings → R2 |
| `OPENROUTER_API_KEY no configurada` | Secreto no puesto / typo | `wrangler pages secret list`, volver a poner |
| OAuth GitHub regresa 404 | Callback URL mal | Debe terminar en `/api/oauth/github/callback` |
| El panel derecho no aparece | Espera un chat activo o abre una herramienta que genere output | Es normal; se abre al crear archivos en el sandbox |

---

## 12. Mantenimiento

### 12.1 Backups D1

```bash
# Exportar toda la base a un archivo SQL
wrangler d1 execute veritas-db --remote --command ".dump" > backup-$(date +%F).sql

# Backup descargable desde el dashboard: D1 → veritas-db → Backups
```

### 12.2 Rotación de keys

- Añade una key nueva:
  ```bash
  wrangler pages secret put OPENROUTER_API_KEY_3
  ```
- Para rotar, sobrescribe la misma variable; el rotador distribuirá tráfico a partir del siguiente request.
- Las keys con HTTP 429/5xx pasan a cooldown 60 s automáticamente.

### 12.3 Purga y cron

- El cron cada 6 h corre `functions/purge/scheduled.js` (limpieza de sesiones caducadas, alerta de cuotas).
- Si quieres cambiar la frecuencia: Settings → Triggers (mínimo 1 h en Free).

### 12.4 Logs y observabilidad

- `wrangler pages deployment tail --project-name=veritas-ai`
- El sampling del Worker está en 0.1 (`head_sampling_rate = 0.1`). Si depuras algo específico, súbelo temporalmente a 1.0 en **Settings → Observability**.

### 12.5 Actualizar a una nueva versión

```bash
git pull
wrangler pages deploy . --project-name=veritas-ai   # si no usas Git conectado
```

Si el `schema.sql` cambió, aplica las migraciones:

```bash
wrangler d1 execute veritas-db --remote --file=./schema.sql
```

(`CREATE TABLE IF NOT EXISTS` es no destructivo; para cambios reales de columnas usa migraciones explícitas.)

---

## 13. Checklist de puesta en producción

- [ ] D1 creado y schema aplicado
- [ ] R2 creado
- [ ] Repo conectado a Pages (output dir `.`, sin build)
- [ ] Binding `DB` → D1
- [ ] Binding `BUCKET` → R2
- [ ] `OAUTH_ENCRYPTION_KEY` generado con `openssl rand -hex 32`
- [ ] `OPENROUTER_API_KEY_1` configurado
- [ ] `ADMIN_EMAILS` con tu correo
- [ ] `PAGES_URL` con la URL real de producción
- [ ] Cron `0 */6 * * *` registrado
- [ ] OAuth apps (opcional) con callback URL correcta
- [ ] Primer deploy verde
- [ ] Login + chat enviando mensaje funcionando
- [ ] `/api/status` devuelve 200 con bindings OK
- [ ] Logs en vivo sin errores

---

## Referencias

- Docs Pages Functions: <https://developers.cloudflare.com/pages/functions/>
- D1: <https://developers.cloudflare.com/d1/>
- R2: <https://developers.cloudflare.com/r2/>
- Wrangler: <https://developers.cloudflare.com/workers/wrangler/>
- Secretos de Pages: <https://developers.cloudflare.com/pages/functions/secrets/>
