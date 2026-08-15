# Guía de despliegue de Véritas en Cloudflare (100% navegador)

Guía completa paso a paso para desplegar Véritas en Cloudflare Pages + D1 usando **únicamente el navegador**: sin Node.js, sin Wrangler, sin terminal ni línea de comandos.

> **R2 es opcional** (desde v2.7.2). Si no puedes o no quieres activar R2
> (pide tarjeta aunque el plan sea gratuito), simplemente sáltate los pasos de
> R2: la app funciona igual para chat, LLM y herramientas; solo quedan
> desactivadas las funciones de archivo (subir/descargar documentos y
> attachments multimedia). Verás el aviso `r2_unavailable` si intentas usarlas.

---

## 1. Lo que vas a necesitar

- Una cuenta gratuita de [Cloudflare](https://dash.cloudflare.com/sign-up).
- Una cuenta de GitHub con acceso al repositorio `maxrivero783-pixel/veritas-ai`.
- Una API key de [OpenRouter](https://openrouter.ai/keys) (la única imprescindible; recomendables 2-3 para rotación).
- (Opcional) API keys de Jina, Tavily, Serper, Firecrawl, ScrapingBee, Browser Use, Steel, Shodan, etc. — las herramientas que no tengan key simplemente quedan deshabilitadas.
- (Opcional, para conexiones) una OAuth App en GitHub.

Toda la configuración se hace desde:

- **Cloudflare Dashboard**: <https://dash.cloudflare.com>
- **GitHub**: <https://github.com>

---

## 2. Arquitectura que vas a crear

```
Navegador
   │
   ▼
Cloudflare Pages  (index.html, app.js, styles.css — estáticos)
   │
   ├── Pages Functions  /functions/api/[[route]].js
   │
   ├── D1 database  "veritas-db"        (22 tablas: chats, users, mensajes, …)
   │
   └── R2 bucket    "veritas-storage"   (documentos y archivos de proyecto)  ← OPCIONAL
```

No hay build step: la raíz del repo (`.`) es el directorio que se publica.

---

## 3. Crear la base de datos D1

1. Entra al **[Cloudflare Dashboard](https://dash.cloudflare.com)**.
2. En el menú lateral, expande **Storage & Databases** y haz clic en **D1 SQL Database**.
3. Botón **Create database**.
4. Rellena:
   - **Database name**: `veritas-db`
   - **Location**: deja la región por defecto (o la más cercana a tus usuarios).
5. Pulsa **Create**.
6. En la página de la base, localiza el **Database ID** (algo como `a1b2c3d4-...`) y guárdalo: lo necesitarás si en el futuro usas Wrangler, pero para el flujo navegador no hace falta.

### 3.1 Crear las tablas (importar el schema)

1. Dentro de `veritas-db`, abre la pestaña **Console**.
2. Abre el archivo [`schema.sql`](../schema.sql) del repo en otra pestaña:
   <https://github.com/maxrivero783-pixel/veritas-ai/blob/main/schema.sql>
3. Copia **todo el contenido** del archivo (botón **Raw** → `Ctrl+A` / `Ctrl+C`).
4. Vuelve a la consola D1 y pega el SQL completo en el editor.
5. Pulsa **Execute** (o **Run**).
6. Debes ver "22 statements executed" o similar, sin errores.
7. Verificación: en el editor ejecuta:

   ```sql
   SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
   ```

   Deben aparecer 22 tablas: `users, sessions, rate_limits, chats, messages, repo_documents, openrouter_calls, api_key_state, api_key_cursor, tool_calls, oauth_pending, external_connections, external_api_calls, chat_participants, chat_turn_lock, chat_presence, user_memories, user_skills, notification_events, tool_cache, llm_cache, async_jobs`.

> El archivo mide ~21 KB; el editor de D1 lo acepta de una sola vez. Si por algo diera error de tamaño, divídelo en 2-3 bloques cortando entre sentencias `;`.

---

## 4. Crear el bucket R2 (OPCIONAL — puedes saltarte esta sección)

> Desde v2.7.2, si no configuras R2, Véritas funciona igual para chat, LLM y
> herramientas. Solo quedarán desactivadas las funciones de archivo (subir/
> descargar documentos y attachments multimedia). Si no puedes activar R2
> (pide tarjeta), pasa directamente a la sección 5.

1. En el menú lateral, **Storage & Databases → R2 Object Storage**.
2. (Primera vez) Botón **Purchase R2 Storage** — el plan gratuito incluye 10 GB/mes; no se cobrará nada mientras no lo superes. Confirma.
3. **Create bucket**.
4. **Bucket name**: `veritas-storage`
5. **Location**: Automatic (o la región que prefieras).
6. Pulsa **Create bucket**.

No necesitas crear carpetas ni subir nada; el Worker las crea solas.

---

## 5. Conectar el repositorio a Cloudflare Pages

1. En el menú lateral, **Workers & Pages → Create application**.
2. Abre la pestaña **Pages** y pulsa **Connect to Git**.
3. Autoriza a Cloudflare sobre tu cuenta de GitHub si es la primera vez (puedes limitar el acceso al repositorio `veritas-ai`).
4. Selecciona `maxrivero783-pixel/veritas-ai` y pulsa **Begin setup**.
5. En **Build settings** (sistema *Workers Builds*):
   - **Project name**: `veritas-ai` (este nombre define tu URL final).
   - **Production branch**: `main`.
   - **Framework preset**: `None`.
   - **Build command**: déjalo **vacío**.
   - **Build output directory**: escribe `.` (un punto).
   - **Root directory**: déjalo vacío.
   - **Deploy command**: ⚠️ En el sistema nuevo este campo es **obligatorio**.
     Escribe exactamente: `npx wrangler pages deploy . --project-name=veritas-ai`
     (NO uses `npx wrangler deploy` — eso es para Workers y falla con
     `Missing entry-point…`).
   - **API token** (¡la pieza clave!): Cloudflare genera uno automático que **no
     tiene permiso de Pages** y el build falla con `Authentication error
     [code: 10000]`. Selecciona **tu propio token** — el que creaste con permiso
     `Account → Pages → Edit` (Apéndice B). No uses el autogenerado.
   - **Build variables** (opcional): variables solo para el build; no hacen falta aquí.
   - **Environment variables**: añade las variables de runtime listadas en la sección 7 (puedes hacerlo después).
6. Pulsa **Save and Deploy**.

El primer deploy tarda entre 30 s y 2 min. Cuando termine verás una URL tipo `https://veritas-ai.pages.dev`. **Aún no funcionará**: faltan los bindings y los secretos.

---

## 6. Configurar los bindings (D1 y R2)

1. Ve a **Workers & Pages → `veritas-ai` → Settings**.
2. Sección **Bindings** → pulsa **Add binding**.
3. Añade el binding de D1 (obligatorio) y, si creaste R2, el de R2 (opcional):

### 6.1 D1 (obligatorio)

- Tipo: **D1 database**
- **Variable name**: `DB`
- **D1 database**: selecciona `veritas-db` (ID `5733290e-0553-4b78-8ad6-1073fac7ecf2`)

### 6.2 R2 (opcional)

- Tipo: **R2 bucket**
- **Variable name**: `BUCKET`
- **R2 bucket**: selecciona `veritas-storage`

> Si no creaste el bucket, no añadas este binding. Sin `BUCKET`, Véritas
> desactiva limpiamente las funciones de archivo y devuelve `r2_unavailable`
> solo en esas rutas; todo lo demás sigue funcionando.

4. Pulsa **Save**.

> En el plan Pages gratuito, los cambios de binding se aplican al **siguiente deploy**. Más adelante forzaremos un redeploy.

---

## 7. Variables y secretos

### 7.1 Generar la clave de cifrado OAuth (obligatoria)

Aunque no uses OAuth, el Worker la requiere para arrancar. Genera 64 caracteres hexadecimales:

**Opción A (recomendada, en tu navegador):**
1. Abre cualquier página web (por ejemplo `https://cloudflare.com`).
2. Pulsa `F12` → pestaña **Console**.
3. Pega y Enter:
   ```js
   [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('')
   ```
4. Copia el resultado (64 hex chars).

**Opción B:** usa uno de estos generadores y copia el output:
- <https://www.uuidgenerator.net/> (usa la versión "hex/API key")
- <https://1password.com/password-generator> (modo "Random Password", 64 chars, solo hex)

> No compartas esta clave. Es la que cifra los tokens OAuth en la base de datos.

### 7.2 Añadir variables públicas

Ve a **Workers & Pages → `veritas-ai` → Settings → Environment variables → Production**.

Pulsa **Add variable** y añade estas como **plaintext** (texto plano):

| Variable | Valor |
|---|---|
| `APP_VERSION` | `2.7.1` |
| `PAGES_URL` | tu URL real de Pages (p. ej. `https://veritas-ai-brp.pages.dev` — ojo: si tu subdominio estaba ocupado, Cloudflare añade un sufijo como `-brp`) |
| `ADMIN_EMAILS` | tu correo (ej. `tucorreo@dominio.com`). CSV si hay varios admins |
| `ALLOW_REGISTRATION` | `true` |
| `ARTIFACT_PROXY_ALLOWED_HOSTS` | (déjalo vacío: usará el valor por defecto del Worker) |

Si tienes pensado usar OAuth:

| Variable | Valor |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | Client ID de tu GitHub OAuth App (paso 10) |

### 7.3 Añadir secretos

Para cada secreto, en la misma pantalla de Environment variables:

1. Pulsa **Add variable**.
2. Escribe el **nombre**.
3. Marca la casilla **Encrypt** (o selecciona "Secret" si aparece).
4. Pega el **valor**.
5. Repite.

Secrets obligatorios mínimos:

| Nombre | Valor |
|---|---|
| `OAUTH_ENCRYPTION_KEY` | la clave hex de 64 chars generada en 7.1 |
| `OPENROUTER_API_KEY_1` | tu key `sk-or-v1-...` de OpenRouter |

Secrets opcionales (añade los que tengas; las herramientas sin key se deshabilitan solas):

```
JINA_API_KEY_1
TAVILY_API_KEY_1
SERPER_API_KEY_1
SCRAPINGBEE_API_KEY_1
FIRECRAWL_API_KEY_1
BROWSER_USE_API_KEY_1
STEEL_API_KEY_1
STEEL_AUTH_API_KEY_1
BROWSERLESS_API_KEY_1
APIFY_API_TOKEN_1
LLAMA_CLOUD_API_KEY_1
ASSEMBLYAI_API_KEY_1
SHODAN_API_KEY_1
ZOOMEYE_API_KEY_1
INTELX_API_KEY_1
ROVER_API_KEY_1
SPIDER_CLOUD_API_KEY_1
GFW_API_KEY_1
JINA_READER_API_KEY_1
JINA_GITHUB_API_KEY_1
NVD_API_KEY
EMAIL_API_KEY          # API key de Brevo (notificaciones)
BREVO_SENDER_EMAIL     # remitente verificado en Brevo
BREVO_SENDER_NAME      # ej. "Véritas"
GITHUB_OAUTH_CLIENT_SECRET
```

> **Sobre los pools de keys**: sufijar con `_1`, `_2`, `_3…` hace que Véritias rote automáticamente entre ellas. Si tienes 2 keys de OpenRouter, añade `OPENROUTER_API_KEY_2` además de la `_1`; si una recibe 429/5xx pasa a cooldown 60 s y el tráfico sigue por la otra.

### 7.4 Guardar y redeployar

- Pulsa **Save** al final de la pantalla de variables.
- Ve a la pestaña **Deployments**.
- Abre el menú `⋯` del último deploy → **Retry deployment** (o **Create new deployment**). Esto aplica los bindings y secretos nuevos.

---

## 8. Configurar el Cron (mantenimiento cada 6 horas)

> ⚠️ **Cloudflare Pages NO soporta Cron Triggers** (son exclusivos de
> Workers). Véritas resuelve esto exponiendo la purga como endpoint HTTP
> protegido y programándolo con **GitHub Actions** (incluido en el repo:
> `.github/workflows/cron-purge.yml`).

**Endpoint:** `GET/POST https://<tu-dominio>/purge/scheduled` con header `x-purge-secret`.

### Pasos

1. **Genera un secreto** (en cualquier página web, F12 → Console):
   ```js
   [...crypto.getRandomValues(new Uint8Array(24))].map(b=>b.toString(16).padStart(2,'0')).join('')
   ```
2. **En Cloudflare Pages**: Settings → Variables and Secrets → Production →
   añade `PURGE_SECRET` con ese valor → **Encrypt** 🔒.
3. **En GitHub**: repo → Settings → Secrets and variables → Actions →
   **New repository secret** → nombre `PURGE_SECRET`, mismo valor.
4. **Redespliega** la app (Run workflow del deploy) para que tome la variable.
5. **Prueba**: GitHub → Actions → *Cron — mantenimiento Véritas* →
   **Run workflow**. El log debe mostrar `HTTP 200` y un JSON con
   `messages_purged`, `memories_purged`, etc.

A partir de ahí corre solo cada 6 h (00/06/12/18 UTC). Alternativa sin
GitHub: cualquier programador HTTP gratuito (p. ej. cron-job.org) que llame
al mismo endpoint con el header.

> Nota: GitHub puede retrasar los crons unos minutos y los desactiva si el
> repo pasa 60 días sin actividad (basta un push o Run workflow para revivirlo).

---

## 9. OAuth apps (opcional)

Solo necesitas esto si vas a conectar GitHub como fuente de archivos.

### 9.1 GitHub OAuth App

1. Abre <https://github.com/settings/developers> → **OAuth Apps → New OAuth App**.
2. Rellena:
   - **Application name**: `Véritas`
   - **Homepage URL**: `https://veritas-ai.pages.dev`
   - **Authorization callback URL**: `https://veritas-ai.pages.dev/api/oauth/github/callback`
3. **Register application**.
4. Copia el **Client ID** (público) → ponlo en la variable pública `GITHUB_OAUTH_CLIENT_ID`.
5. Pulsa **Generate a new client secret** → copia el secreto → ponlo como secreto `GITHUB_OAUTH_CLIENT_SECRET`.

Tras cambiar variables en Cloudflare, haz un **Retry deployment** (paso 7.4).

---

## 10. Despliegue continuo

A partir de este momento:

- Cada push a la rama `main` del repo en GitHub dispara un deploy automático en Pages.
- Puedes ver el progreso y los logs en la pestaña **Deployments**.
- Para despliegues de prueba, crea una rama nueva y pushea: Pages creará una URL de preview `<rama>.veritas-ai.pages.dev`.

---

## 11. Verificar que funciona

1. Abre tu URL `https://veritas-ai.pages.dev`.
2. Debes ver la pantalla de **registro/login** de Véritas.
3. Crea una cuenta con email y contraseña.
4. Crea un chat nuevo y escribe un mensaje simple ("hola").
5. Debe responder tras unos segundos. Si hay errores, aparece un toast rojo.
6. Atajos para diagnosticar:
   - Abre `https://veritas-ai.pages.dev/api/status` en el navegador:
     - Debe devolver JSON con `openrouter`, `services` y un campo `storage`.
     - Si `storage.available = true`, R2 está operativo. Si es `false`, la app
       funciona igual pero sin funciones de archivo (no añadiste el binding `BUCKET`).
     - Si la petición devuelve un error 500 de D1, revisa el paso 6 (bindings).
7. Logs en vivo (navegador):
   - **Workers & Pages → `veritas-ai` → Logs & Observability → Begin log stream**.
   - Envía un mensaje desde la app y verás las trazas en tiempo real.

---

## 12. Errores comunes y arreglo rápido

| Síntoma | Causa | Arreglo en el dashboard |
|---|---|---|
| Build falla con `Missing entry-point to Worker script or to assets directory` (y el log muestra `Executing user deploy command: npx wrangler deploy`) | Pusiste `npx wrangler deploy` en el **Deploy command** | Settings → Builds & deployments → Build settings → Edit → **borra el Deploy command** (déjalo vacío) → Save → Retry deployment |
| Al guardar Build configuration el dashboard responde `Invalid request body` | Bug del dashboard guardando campos vacíos (a veces porque **Build output directory** quedó vacío) | Pon **Build output directory = `.`**, luego vacía el Deploy command y guarda. Si sigue fallando: modo incógnito u otro navegador; último recurso: recrear el proyecto (sección 5). |
| Build falla con `Authentication error [code: 10000]` ejecutando `wrangler pages deploy` | El build usa el **API token autogenerado**, que no tiene permiso *Pages: Edit* (tu token en variables de runtime NO llega al build) | En **Build settings** busca el campo **API token** y selecciona tu propio token con `Account → Pages → Edit` (Apéndice B). No uses el autogenerado. |
| `D1_ERROR: no such table: users` | Schema no aplicado | D1 → `veritas-db` → Console → pega `schema.sql` → Execute |
| `DB binding is required` | Falta binding D1 | Settings → Bindings → añade `DB` → Retry deployment |
| `r2_unavailable` (solo al subir/bajar archivos) | No añadiste el binding `BUCKET` | Opcional: crea el bucket (paso 4), añade binding `BUCKET` y redeployea. Si no quieres R2, ignóralo. |
| `OPENROUTER_API_KEY no configurada` | Secreto ausente | Settings → Environment variables → añade `OPENROUTER_API_KEY_1` como Encrypt |
| `OAUTH_ENCRYPTION_KEY` inválida / faltante | No la generaste o tiene otra longitud | Genera 64 hex chars (paso 7.1) y guárdala como secreto |
| OAuth GitHub regresa 404 | Callback URL mal | GitHub OAuth App → Authorization callback URL exacta: `https://<tu-dominio>/api/oauth/github/callback` |
| La llamada al chat tarda mucho / corta | CPU límite del Free (10 ms/request) | Las tools largas ya van en modo async/pending; considera Workers Paid si lo usas intensivamente |
| Veo la app pero el chat no responde | Key inválida o sin saldo en OpenRouter | Prueba la key en <https://openrouter.ai/keys>; revisa Begin log stream |
| Cambié una variable pero no se refleja | Falta redeployar | Deployments → menú `⋯` del último deploy → Retry deployment |

---

## 13. Mantenimiento desde el navegador

### 13.1 Backups D1

1. D1 → `veritas-db` → pestaña **Backups**.
2. **Create backup** (manual) o configura backups automáticos diarios.
3. Restaura desde un backup en dos clics si algo sale mal.

Exportar los datos a un archivo:
1. D1 → Console → ejecuta:
   ```sql
   SELECT * FROM chats; SELECT * FROM messages;
   ```
2. Copia el resultado (el botón **Download** baja el JSON completo de cada query).

### 13.2 Rotar / añadir API keys

- Añade una key nueva creando otra variable secreta con sufijo `_2`, `_3`…
- Para rotar una key comprometida, edita la variable (sustituye el valor) y redeploya.
- Las keys que reciben 429/5xx entran en cooldown automático durante 60 s; vuelven solas.

### 13.3 Logs y observabilidad

- **Workers & Pages → `veritas-ai` → Logs & Observability → Begin log stream** para ver requests en vivo.
- La pestaña **Observability** muestra métricas agregadas (CPU, errores, volumen).
- El sampling está en 10 % (`head_sampling_rate = 0.1` en el repo). Si depuras un incidente, puedes subirlo en **Settings → Observability** (afecta a todos los deploys nuevos).

### 13.4 Cron

- El mantenimiento corre vía GitHub Actions (workflow *Cron — mantenimiento Véritas*); revisa sus ejecuciones en la pestaña **Actions** del repo.
- Si quieres otra frecuencia, elimina el trigger y crea uno nuevo (mínimo 1 h en Free).

### 13.5 Actualizar Véritas

- Los cambios al código llegan solos al hacer push a `main`.
- Si cambia el `schema.sql` (nuevas columnas/tablas), copia el archivo actualizado y ejecútalo en la Consola D1. Usa `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE`; no hace falta borrar nada.
- La versión visible en la app se controla con la variable pública `APP_VERSION`.

---

## 14. Checklist final

- [ ] D1 `veritas-db` creada y schema importado (22 tablas visibles)
- [ ] Binding `DB` → D1 `veritas-db` (ID `5733290e-0553-4b78-8ad6-1073fac7ecf2`)
- [ ] (Opcional) R2 `veritas-storage` creado
- [ ] Repo conectado a Pages (output dir `.`, sin build command)
- [ ] (Opcional) Binding `BUCKET` → R2 `veritas-storage`
- [ ] Secreto `OAUTH_ENCRYPTION_KEY` (64 hex) generado y guardado
- [ ] Secreto `OPENROUTER_API_KEY_1` configurado
- [ ] Variable pública `PAGES_URL` con la URL real de Pages
- [ ] Variable pública `ADMIN_EMAILS` con tu correo
- [ ] `PURGE_SECRET` configurado (Cloudflare Encrypt + GitHub secret) y cron probado con **Run workflow**
- [ ] (Opcional) OAuth app de GitHub con callback correcta
- [ ] Retry deployment hecho tras añadir bindings/variables
- [ ] `https://<tu-dominio>/api/status` responde 200 (y `storage.available` indica si R2 está activo)
- [ ] Registro de usuario y primer mensaje funcionando

---

## Apéndice B — Token de Cloudflare con permiso Pages (si necesitas Deploy command)

Solo si el dashboard no te deja vaciar el Deploy command y prefieres mantener
`npx wrangler pages deploy`. Se hace todo en el navegador. El token del build
falla con `Authentication error [code: 10000]` porque no trae permiso
**Pages: Edit**; con un token propio sí funciona.

1. Ve a <https://dash.cloudflare.com/profile/api-tokens> (menú arriba-derecha → **My Profile** → **API Tokens**).
2. Pulsa **Create Token**.
3. Elige **Create Custom Token** (abajo) → **Get started**.
4. Configura:
   - **Token name**: `veritas-pages-deploy`.
   - **Permissions**: añade dos filas:
     - `Account` → `Pages` → `Edit`
     - `Account` → `Account Settings` → `Read`
   - **Account Resources**: tu cuenta (`...@gmail.com's Account`).
   - **TTL**: Start Date = hoy; deja End Date vacío (o pon un fin lejano).
5. **Continue to summary → Create Token**. Copia el token (solo se muestra una vez).
6. **Dónde ponerlo** — usa el campo del build, NO las variables de runtime:
   - **Workers & Pages → `veritas-ai` → Settings → Builds & deployments → Build settings → Edit**.
   - Campo **API token**: elige la opción de usar un token propio / existente y
     pega (o selecciona) el token `veritas-pages-deploy`.
   - ⚠️ Si lo pones como variable de runtime `CLOUDFLARE_API_TOKEN`, el build
     puede ignorarla y seguir usando su token autogenerado (error 10000).
7. **Save** y luego **Retry deployment**. El build usará tu token y podrá desplegar.

> ⚠️ No pegues ese token en el chat ni en ningún archivo del repo: es una
> credencial de tu cuenta. Si se filtra, bórralo en la misma pantalla (
> **Roll** / **Delete**) y crea otro.

---

## Referencias rápidas

- Cloudflare D1 Console: <https://dash.cloudflare.com/?to=/:account/d1>
- Cloudflare R2: <https://dash.cloudflare.com/?to=/:account/r2/overview>
- Cloudflare Pages: <https://dash.cloudflare.com/?to=/:account/pages>
- OpenRouter keys: <https://openrouter.ai/keys>
- GitHub OAuth Apps: <https://github.com/settings/developers>
