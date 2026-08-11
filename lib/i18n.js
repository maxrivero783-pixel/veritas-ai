// ==============================================================================
// Véritas v2.4 — /lib/i18n.js
// ==============================================================================
// Catálogo trilingüe (es/en/fr) con todas las keys de UI.
// Helpers: t(key, params?, lang?) y applyI18n(lang).
//
// Cobertura: 100% de los textos visibles en index.html (data-i18n).
// Pluralización vía Intl.PluralRules. Formateo de fechas/números vía Intl.
// ==============================================================================

export const STRINGS = {
  es: {
    "app.title": "Véritas",
    "app.tagline": "Verdad sin filtro",

    "nav.agent": "Agente",
    "nav.coder": "Coder",
    "nav.general": "General",

    "actions.newChat": "+ Nuevo Chat",
    "actions.repo": "Repositorio",
    "actions.settings": "Ajustes",
    "actions.save": "Guardar",

    "status.online": "En línea",
    "status.offline": "Sin conexión",

    "chat.empty": "Selecciona o crea un chat",
    "chat.welcome": "Inicia una conversación con el modelo seleccionado.",
    "chat.searchPlaceholder": "Buscar chats...",
    "chat.searchNoResults": "Sin resultados para \"{query}\"",
    "chat.emptyCategory": "No hay chats en esta categoría todavía.",

    "welcome.title": "Véritas",
    "welcome.motto": "Información es ventaja. La ventaja es tuya.",
    "welcome.subtitle": "Selecciona un modelo para empezar",
    "welcome.hint": "o escribe tu mensaje abajo ↑",

    "roles.agent": "Agente",
    "roles.estratega": "Estratega",
    "roles.reasoning": "Razonamiento",
    "roles.pensador": "Pensador",
    "roles.coder": "Coder",
    "roles.fast": "Fast",

    "stream.processing": "Procesando...",
    "stream.thinking": "Pensando...",
    "stream.stopped": "Generación detenida",
    "stream.auxFallback": "Enrutando a GLM-4.5 Flash (auxiliar)...",
    "stream.linesProcessing": [
      "▸ Interceptando señales abiertas...",
      "▸ Barriendo el espectro de fuentes...",
      "▸ Correlacionando datos de inteligencia...",
      "▸ Cruzando referencias entre fuentes...",
      "▸ Verificando la cadena de custodia de la información...",
      "▸ Componiendo el informe...",
    ],
    "stream.linesThinking": [
      "▸ Razonamiento en curso — cadena de análisis...",
      "▸ Evaluando escenarios y actores...",
      "▸ Contrastando hipótesis...",
      "▸ Sopesando evidencia y sesgos...",
      "▸ Preparando conclusiones operativas...",
    ],

    "input.placeholder": "Escribe tu mensaje...",

    "shared.invite": "Invitar",
    "shared.leave": "Salir",
    "shared.close": "Cerrar sesión",
    "shared.typing": "está escribiendo...",
    "shared.inviteTitle": "Invitar a sesión compartida",
    "shared.inviteDesc": "Genera un enlace de un solo uso y compártelo con tu invitado. Máximo 1 editor.",
    "shared.generate": "Generar enlace",
    "shared.copy": "Copiar",
    "shared.revoke": "Revocar enlace",
    "shared.copyOk": "Enlace copiado al portapapeles",
    "shared.turnHeldBy": "Turno de {user} — expira en {time}",
    "shared.turnYours": "Tu turno — expira en {time}",
    "shared.sessionFull": "Sesión compartida llena",
    "shared.invalidToken": "Enlace inválido o ya usado",
    "shared.joined": "Te uniste a la sesión compartida",
    "shared.left": "Saliste de la sesión compartida",
    "shared.closed": "El owner cerró la sesión compartida",

    "sandbox.new": "+ Nuevo",
    "sandbox.templates": "Plantillas ▼",
    "sandbox.libraries": "Librerías ▼",
    "sandbox.exportZip": "📦 Export ZIP",
    "sandbox.download": "⬇ Descargar",
    "sandbox.copy": "⧉ Copiar",
    "sandbox.openBrowser": "↗ Navegador",
    "sandbox.pushGithub": "⬆ GitHub",
    "sandbox.preview": "Live Preview",
    "sandbox.console": "Console",
    "sandbox.network": "Network",
    "sandbox.emptyTree": "Sin archivos. El modelo generará archivos aquí.",
    "sandbox.copied": "Copiado ✓",
    "sandbox.downloaded": "Descargado ✓",
    "sandbox.zipReady": "ZIP generado ✓",
    "sandbox.pushedGithub": "Push a GitHub exitoso ✓",

    "settings.title": "Ajustes",
    "settings.profile": "Perfil",
    "settings.personalization": "Personalización",
    "settings.language": "Idioma",
    "settings.maps": "Mapas",
    "settings.connections": "Conexiones",
    "settings.tokens": "Optimización de tokens",
    "settings.shared": "Sesión compartida",
    "settings.notifications": "Notificaciones push",
    "settings.offline": "Modo offline",
    "settings.chats": "Chats",
    "settings.skills": "Skills",
    "settings.repo": "Repositorio",
    "settings.repo.hint": "Gestiona tus documentos de referencia. Desde el chat del Agente puedes adjuntarlos como contexto.",
    "repo.selectDocs": "Seleccionar documentos",
    "repo.attachConfirm": "Adjuntar",
    "repo.noDocsSelected": "Selecciona al menos un documento",
    "title.repoAttach": "Adjuntar documento del repositorio",
    "settings.dashboard": "Dashboard",
    "settings.about": "Acerca de",

    "settings.profile.hint": "Véritas NO aprende detalles automáticamente de los chats. Solo los que pongas aquí se usan para personalizar respuestas.",
    "settings.profile.name": "Nombre",
    "settings.profile.bio": "Sobre ti",
    "settings.profile.prefLang": "Idioma preferido de respuestas",
    "settings.profile.auto": "Automático (detectar del mensaje)",

    "settings.theme": "Tema",
    "settings.theme.dark": "Oscuro",
    "settings.theme.light": "Claro",
    "settings.theme.system": "Sistema",
    "settings.readMode": "Modo lectura",
    "settings.persist": "Persistencia",
    "settings.animations": "Animaciones",
    "settings.purge": "Purgar todos los datos",

    "settings.language.hint": "Cambia al instante todo el texto estático de la UI. No afecta al contenido de los chats ni a los system prompts de los modelos.",

    "settings.maps.hint": "API key opcional para vector tiles premium (MapTiler o Stadia Maps). Si está vacío, MapLibre usa tiles OSM raster.",
    "settings.maps.key": "API key",
    "settings.maps.provider": "Proveedor",

    "connections.connect": "Conectar",
    "connections.disconnect": "Desconectar",
    "connections.connected": "Conectado como {account}",
    "connections.disconnected": "Desconectado",
    "connections.invalid": "Conexión revocada — reconectar",
    "connections.redirecting": "Redirigiendo a {provider}...",

    "settings.tokens.compress": "Compresión de contexto (sliding window)",
    "settings.tokens.recent": "Mensajes recientes a mantener: {n}",
    "settings.tokens.truncate": "Truncar resultados de tools",
    "settings.tokens.truncateLimit": "Límite de truncado: {n} KB",
    "settings.tokens.caching": "Prompt caching (OpenRouter)",
    "settings.tokens.sticky": "Sticky routing por chat",
    "settings.tokens.chips": "Mostrar chips de tokens ahorrados",
    "settings.tokens.counter": "Mostrar contador de tokens en caja de texto",

    "settings.shared.enable": "Activar función en chats elegibles",
    "settings.shared.turnDuration": "Duración de turno: {n} min",
    "settings.shared.inviteNotif": "Notificaciones de invitación",

    "settings.notifications.master": "Activar notificaciones push",
    "settings.notifications.modelDone": "Modelo terminó de responder",
    "settings.notifications.turnAvailable": "Turno disponible en sesión compartida",
    "settings.notifications.newMessage": "Nuevo mensaje en sesión compartida",
    "settings.notifications.toolDone": "Tool completada en background",
    "settings.notifications.granted": "Permiso concedido ✓",
    "settings.notifications.denied": "Permiso bloqueado por el navegador. Haz click en el candado de la URL para permitir notificaciones.",
    "settings.notifications.unsupported": "Tu navegador no soporta notificaciones push.",

    "settings.offline.enable": "Activar cache local",
    "settings.offline.syncNow": "Sincronizar ahora",
    "settings.offline.purge": "Purgar cache local",
    "settings.offline.neverSynced": "Última sincronización: nunca",
    "settings.offline.lastSync": "Última sincronización: hace {minutes} min",
    "settings.offline.cacheSize": "Cache: {size} MB / 5 MB",

    "settings.chats.autoTitle": "Auto-sugerir título tras primer intercambio",
    "settings.chats.renameHint": "Doble click en el título del chat en el sidebar para renombrarlo manualmente.",

    "settings.skills.hint": "Habilita skills de análisis para que el modelo aplique automáticamente sus directivas cuando el contenido sea relevante.",
    "settings.skills.search": "Buscar skill...",
    "settings.skills.filterAll": "Todas",
    "settings.skills.filterCore": "Núcleo",
    "settings.skills.filterAdvanced": "Avanzado",

    "settings.dashboard.keys": "API Key Rotator",

    "settings.about.desc": "Interfaz de orquestación multi-proveedor de modelos de IA con estilo de ópera espacial.",

    "repo.title": "Repositorio de Documentos",
    "repo.dropHere": "Arrastra archivos aquí o click para subir",
    "repo.docName": "Nombre del documento",
    "repo.upload": "Subir",
    "repo.uploaded": "Documento subido ✓",
    "repo.deleted": "Documento eliminado",
    "repo.tooLarge": "Archivo demasiado grande (máx 5 MB)",
    "repo.usage": "{used} MB / 100 MB",
    "repo.searchPlaceholder": "Filtrar por nombre...",
    "repo.download": "Descargar",
    "repo.delete": "Borrar",
    "repo.loadMore": "Cargar más",

    "offline.banner": "Modo offline — Lectura únicamente. Tus mensajes se enviarán al reconectar.",

    "model.unavailable": "El modelo {model} no está disponible. ¿Cambiar a {fallback}?",
    "model.changed": "Cambiado a {model} ({old} caído)",
    "model.fallbackExhausted": "Todos los modelos fallback están agotados. Intenta más tarde.",

    "tool.executing": "Ejecutando: {tool}",
    "tool.completed": "Tool completada",
    "tool.failed": "Tool fallida: {error}",
    "tool.forbidden": "Tool no permitida para este rol.",
    "tool.timeout": "Tool timeout (30s)",
    "tool.iterLimit": "Tool caller: límite de iteraciones alcanzado.",
    "tool.notConnected": "Conecta tu cuenta de {provider} en Ajustes → Conexiones externas.",

    "toast.renamed": "Renombrado",
    "toast.renameFailed": "No se pudo renombrar (sin conexión)",
    "toast.saved": "Guardado ✓",
    "toast.error": "Error: {message}",
    "toast.copied": "Copiado ✓",
    "toast.connectionLost": "Conexión perdida — modo offline",
    "toast.connectionRestored": "Conexión restaurada ✓",
    "toast.sharedTurnYours": "Te toca el turno en \"{chat}\"",
    "toast.sharedNewMessage": "{author} escribió en \"{chat}\"",
    "toast.modelResponded": "{model} respondió en \"{chat}\"",
    "toast.toolCompleted": "Tool {tool} completada",

    "aria.menuToggle": "Abrir/cerrar menú",
    "aria.sandboxToggle": "Abrir/cerrar sandbox",
    "aria.modelSelector": "Selector de modelo",
    "aria.attach": "Adjuntar archivo",
    "aria.send": "Enviar mensaje",
    "aria.stop": "Detener generación",
    "aria.clearSearch": "Limpiar búsqueda",
    "aria.close": "Cerrar",
    "aria.refresh": "Refrescar",
    "aria.collapse": "Colapsar sandbox",
    "aria.closePanel": "Cerrar panel",

    "title.search": "Búsqueda Web",
    "title.scrape": "Scraping",
    "title.thinking": "Pensamiento (solo Nemotron)",
  },

  en: {
    "app.title": "Véritas",
    "app.tagline": "Truth unfiltered",

    "nav.agent": "Agent",
    "nav.coder": "Coder",
    "nav.general": "General",

    "actions.newChat": "+ New Chat",
    "actions.repo": "Repository",
    "actions.settings": "Settings",
    "actions.save": "Save",

    "status.online": "Online",
    "status.offline": "Offline",

    "chat.empty": "Select or create a chat",
    "chat.welcome": "Start a conversation with the selected model.",
    "chat.searchPlaceholder": "Search chats...",
    "chat.searchNoResults": "No results for \"{query}\"",
    "chat.emptyCategory": "No chats in this category yet.",

    "welcome.title": "Véritas",
    "welcome.motto": "Information is advantage. The advantage is yours.",
    "welcome.subtitle": "Select a model to get started",
    "welcome.hint": "or type your message below ↑",

    "roles.agent": "Agent",
    "roles.estratega": "Strategist",
    "roles.reasoning": "Reasoning",
    "roles.pensador": "Thinker",
    "roles.coder": "Coder",
    "roles.fast": "Fast",

    "stream.processing": "Processing...",
    "stream.thinking": "Thinking...",
    "stream.stopped": "Generation stopped",
    "stream.auxFallback": "Routing to GLM-4.5 Flash (auxiliary)...",
    "stream.linesProcessing": [
      "▸ Intercepting open signals...",
      "▸ Sweeping the source spectrum...",
      "▸ Correlating intelligence data...",
      "▸ Cross-referencing sources...",
      "▸ Verifying information chain of custody...",
      "▸ Assembling the report...",
    ],
    "stream.linesThinking": [
      "▸ Reasoning in progress — analysis chain...",
      "▸ Evaluating scenarios and actors...",
      "▸ Testing hypotheses...",
      "▸ Weighing evidence and bias...",
      "▸ Preparing operational conclusions...",
    ],

    "input.placeholder": "Type your message...",

    "shared.invite": "Invite",
    "shared.leave": "Leave",
    "shared.close": "Close session",
    "shared.typing": "is typing...",
    "shared.inviteTitle": "Invite to shared session",
    "shared.inviteDesc": "Generate a single-use link and share it with your guest. Maximum 1 editor.",
    "shared.generate": "Generate link",
    "shared.copy": "Copy",
    "shared.revoke": "Revoke link",
    "shared.copyOk": "Link copied to clipboard",
    "shared.turnHeldBy": "{user}'s turn — expires in {time}",
    "shared.turnYours": "Your turn — expires in {time}",
    "shared.sessionFull": "Shared session full",
    "shared.invalidToken": "Invalid or already used link",
    "shared.joined": "You joined the shared session",
    "shared.left": "You left the shared session",
    "shared.closed": "The owner closed the shared session",

    "sandbox.new": "+ New",
    "sandbox.templates": "Templates ▼",
    "sandbox.libraries": "Libraries ▼",
    "sandbox.exportZip": "📦 Export ZIP",
    "sandbox.download": "⬇ Download",
    "sandbox.copy": "⧉ Copy",
    "sandbox.openBrowser": "↗ Browser",
    "sandbox.pushGithub": "⬆ GitHub",
    "sandbox.preview": "Live Preview",
    "sandbox.console": "Console",
    "sandbox.network": "Network",
    "sandbox.emptyTree": "No files. The model will generate files here.",
    "sandbox.copied": "Copied ✓",
    "sandbox.downloaded": "Downloaded ✓",
    "sandbox.zipReady": "ZIP ready ✓",
    "sandbox.pushedGithub": "Pushed to GitHub ✓",

    "settings.title": "Settings",
    "settings.profile": "Profile",
    "settings.personalization": "Personalization",
    "settings.language": "Language",
    "settings.maps": "Maps",
    "settings.connections": "Connections",
    "settings.tokens": "Token optimization",
    "settings.shared": "Shared session",
    "settings.notifications": "Push notifications",
    "settings.offline": "Offline mode",
    "settings.chats": "Chats",
    "settings.skills": "Skills",
    "settings.repo": "Repository",
    "settings.repo.hint": "Manage your reference documents. From Agent chats you can attach them as context.",
    "repo.selectDocs": "Select documents",
    "repo.attachConfirm": "Attach",
    "repo.noDocsSelected": "Select at least one document",
    "title.repoAttach": "Attach repository document",
    "settings.dashboard": "Dashboard",
    "settings.about": "About",

    "settings.profile.hint": "Véritas does NOT learn details automatically from chats. Only what you put here is used to personalize responses.",
    "settings.profile.name": "Name",
    "settings.profile.bio": "About you",
    "settings.profile.prefLang": "Preferred response language",
    "settings.profile.auto": "Automatic (detect from message)",

    "settings.theme": "Theme",
    "settings.theme.dark": "Dark",
    "settings.theme.light": "Light",
    "settings.theme.system": "System",
    "settings.readMode": "Reading mode",
    "settings.persist": "Persistence",
    "settings.animations": "Animations",
    "settings.purge": "Purge all data",

    "settings.language.hint": "Instantly changes all static UI text. Does not affect chat content or model system prompts.",

    "settings.maps.hint": "Optional API key for premium vector tiles (MapTiler or Stadia Maps). If empty, MapLibre uses OSM raster tiles.",
    "settings.maps.key": "API key",
    "settings.maps.provider": "Provider",

    "connections.connect": "Connect",
    "connections.disconnect": "Disconnect",
    "connections.connected": "Connected as {account}",
    "connections.disconnected": "Disconnected",
    "connections.invalid": "Connection revoked — reconnect",
    "connections.redirecting": "Redirecting to {provider}...",

    "settings.tokens.compress": "Context compression (sliding window)",
    "settings.tokens.recent": "Recent messages to keep: {n}",
    "settings.tokens.truncate": "Truncate tool results",
    "settings.tokens.truncateLimit": "Truncation limit: {n} KB",
    "settings.tokens.caching": "Prompt caching (OpenRouter)",
    "settings.tokens.sticky": "Sticky routing per chat",
    "settings.tokens.chips": "Show saved tokens chips",
    "settings.tokens.counter": "Show token counter in input box",

    "settings.shared.enable": "Enable feature in eligible chats",
    "settings.shared.turnDuration": "Turn duration: {n} min",
    "settings.shared.inviteNotif": "Invitation notifications",

    "settings.notifications.master": "Enable push notifications",
    "settings.notifications.modelDone": "Model finished responding",
    "settings.notifications.turnAvailable": "Turn available in shared session",
    "settings.notifications.newMessage": "New message in shared session",
    "settings.notifications.toolDone": "Tool completed in background",
    "settings.notifications.granted": "Permission granted ✓",
    "settings.notifications.denied": "Permission blocked by browser. Click the lock icon in the URL to allow notifications.",
    "settings.notifications.unsupported": "Your browser does not support push notifications.",

    "settings.offline.enable": "Enable local cache",
    "settings.offline.syncNow": "Sync now",
    "settings.offline.purge": "Purge local cache",
    "settings.offline.neverSynced": "Last sync: never",
    "settings.offline.lastSync": "Last sync: {minutes} min ago",
    "settings.offline.cacheSize": "Cache: {size} MB / 5 MB",

    "settings.chats.autoTitle": "Auto-suggest title after first exchange",
    "settings.chats.renameHint": "Double-click the chat title in the sidebar to rename it manually.",

    "settings.skills.hint": "Enable analysis skills so the model automatically applies their directives when content is relevant.",
    "settings.skills.search": "Search skill...",
    "settings.skills.filterAll": "All",
    "settings.skills.filterCore": "Core",
    "settings.skills.filterAdvanced": "Advanced",

    "settings.dashboard.keys": "API Key Rotator",

    "settings.about.desc": "Multi-provider AI model orchestration interface with space opera style.",

    "repo.title": "Document Repository",
    "repo.dropHere": "Drop files here or click to upload",
    "repo.docName": "Document name",
    "repo.upload": "Upload",
    "repo.uploaded": "Document uploaded ✓",
    "repo.deleted": "Document deleted",
    "repo.tooLarge": "File too large (max 5 MB)",
    "repo.usage": "{used} MB / 100 MB",
    "repo.searchPlaceholder": "Filter by name...",
    "repo.download": "Download",
    "repo.delete": "Delete",
    "repo.loadMore": "Load more",

    "offline.banner": "Offline mode — Read only. Your messages will be sent when reconnected.",

    "model.unavailable": "Model {model} is unavailable. Switch to {fallback}?",
    "model.changed": "Switched to {model} ({old} down)",
    "model.fallbackExhausted": "All fallback models exhausted. Try again later.",

    "tool.executing": "Executing: {tool}",
    "tool.completed": "Tool completed",
    "tool.failed": "Tool failed: {error}",
    "tool.forbidden": "Tool not allowed for this role.",
    "tool.timeout": "Tool timeout (30s)",
    "tool.iterLimit": "Tool caller: iteration limit reached.",
    "tool.notConnected": "Connect your {provider} account in Settings → Connections.",

    "toast.renamed": "Renamed",
    "toast.renameFailed": "Could not rename (offline)",
    "toast.saved": "Saved ✓",
    "toast.error": "Error: {message}",
    "toast.copied": "Copied ✓",
    "toast.connectionLost": "Connection lost — offline mode",
    "toast.connectionRestored": "Connection restored ✓",
    "toast.sharedTurnYours": "Your turn in \"{chat}\"",
    "toast.sharedNewMessage": "{author} wrote in \"{chat}\"",
    "toast.modelResponded": "{model} responded in \"{chat}\"",
    "toast.toolCompleted": "Tool {tool} completed",

    "aria.menuToggle": "Toggle menu",
    "aria.sandboxToggle": "Toggle sandbox",
    "aria.modelSelector": "Model selector",
    "aria.attach": "Attach file",
    "aria.send": "Send message",
    "aria.stop": "Stop generation",
    "aria.clearSearch": "Clear search",
    "aria.close": "Close",
    "aria.refresh": "Refresh",
    "aria.collapse": "Collapse sandbox",
    "aria.closePanel": "Close panel",

    "title.search": "Web Search",
    "title.scrape": "Scraping",
    "title.thinking": "Thinking (Nemotron only)",
  },

  fr: {
    "app.title": "Véritas",
    "app.tagline": "Vérité sans filtre",

    "nav.agent": "Agent",
    "nav.coder": "Coder",
    "nav.general": "Général",

    "actions.newChat": "+ Nouveau Chat",
    "actions.repo": "Dépôt",
    "actions.settings": "Paramètres",
    "actions.save": "Enregistrer",

    "status.online": "En ligne",
    "status.offline": "Hors ligne",

    "chat.empty": "Sélectionnez ou créez un chat",
    "chat.welcome": "Démarrez une conversation avec le modèle sélectionné.",
    "chat.searchPlaceholder": "Rechercher des chats...",
    "chat.searchNoResults": "Aucun résultat pour \"{query}\"",
    "chat.emptyCategory": "Aucun chat dans cette catégorie pour le moment.",

    "welcome.title": "Véritas",
    "welcome.motto": "L'information est un avantage. L'avantage est à vous.",
    "welcome.subtitle": "Sélectionnez un modèle pour commencer",
    "welcome.hint": "ou tapez votre message ci-dessous ↑",

    "roles.agent": "Agent",
    "roles.estratega": "Stratège",
    "roles.reasoning": "Raisonnement",
    "roles.pensador": "Penseur",
    "roles.coder": "Coder",
    "roles.fast": "Fast",

    "stream.processing": "Traitement...",
    "stream.thinking": "Réflexion...",
    "stream.stopped": "Génération arrêtée",
    "stream.auxFallback": "Routage vers GLM-4.5 Flash (auxiliaire)...",
    "stream.linesProcessing": [
      "▸ Interception des signaux ouverts...",
      "▸ Balayage du spectre des sources...",
      "▸ Corrélation des données de renseignement...",
      "▸ Recoupement des sources...",
      "▸ Vérification de la chaîne de traçabilité...",
      "▸ Rédaction du rapport...",
    ],
    "stream.linesThinking": [
      "▸ Raisonnement en cours — chaîne d'analyse...",
      "▸ Évaluation des scénarios et acteurs...",
      "▸ Test des hypothèses...",
      "▸ Pesée des preuves et des biais...",
      "▸ Préparation des conclusions opérationnelles...",
    ],

    "input.placeholder": "Tapez votre message...",

    "shared.invite": "Inviter",
    "shared.leave": "Quitter",
    "shared.close": "Fermer la session",
    "shared.typing": "écrit...",
    "shared.inviteTitle": "Inviter à une session partagée",
    "shared.inviteDesc": "Générez un lien à usage unique et partagez-le avec votre invité. Maximum 1 éditeur.",
    "shared.generate": "Générer le lien",
    "shared.copy": "Copier",
    "shared.revoke": "Révoquer le lien",
    "shared.copyOk": "Lien copié dans le presse-papiers",
    "shared.turnHeldBy": "Tour de {user} — expire dans {time}",
    "shared.turnYours": "Votre tour — expire dans {time}",
    "shared.sessionFull": "Session partagée pleine",
    "shared.invalidToken": "Lien invalide ou déjà utilisé",
    "shared.joined": "Vous avez rejoint la session partagée",
    "shared.left": "Vous avez quitté la session partagée",
    "shared.closed": "Le propriétaire a fermé la session partagée",

    "sandbox.new": "+ Nouveau",
    "sandbox.templates": "Modèles ▼",
    "sandbox.libraries": "Bibliothèques ▼",
    "sandbox.exportZip": "📦 Export ZIP",
    "sandbox.download": "⬇ Télécharger",
    "sandbox.copy": "⧉ Copier",
    "sandbox.openBrowser": "↗ Navigateur",
    "sandbox.pushGithub": "⬆ GitHub",
    "sandbox.preview": "Aperçu en direct",
    "sandbox.console": "Console",
    "sandbox.network": "Réseau",
    "sandbox.emptyTree": "Aucun fichier. Le modèle générera des fichiers ici.",
    "sandbox.copied": "Copié ✓",
    "sandbox.downloaded": "Téléchargé ✓",
    "sandbox.zipReady": "ZIP prêt ✓",
    "sandbox.pushedGithub": "Push vers GitHub réussi ✓",

    "settings.title": "Paramètres",
    "settings.profile": "Profil",
    "settings.personalization": "Personnalisation",
    "settings.language": "Langue",
    "settings.maps": "Cartes",
    "settings.connections": "Connexions",
    "settings.tokens": "Optimisation des tokens",
    "settings.shared": "Session partagée",
    "settings.notifications": "Notifications push",
    "settings.offline": "Mode hors ligne",
    "settings.chats": "Chats",
    "settings.skills": "Skills",
    "settings.repo": "D\u00e9p\u00f4t",
    "settings.repo.hint": "G\u00e9rez vos documents de r\u00e9f\u00e9rence. Depuis les chats Agent, vous pouvez les joindre comme contexte.",
    "repo.selectDocs": "S\u00e9lectionner des documents",
    "repo.attachConfirm": "Joindre",
    "repo.noDocsSelected": "S\u00e9lectionnez au moins un document",
    "title.repoAttach": "Joindre un document du d\u00e9p\u00f4t",
    "settings.dashboard": "Tableau de bord",
    "settings.about": "À propos",

    "settings.profile.hint": "Véritas N'apprend PAS automatiquement les détails des chats. Seul ce que vous mettez ici est utilisé pour personnaliser les réponses.",
    "settings.profile.name": "Nom",
    "settings.profile.bio": "À propos de vous",
    "settings.profile.prefLang": "Langue de réponse préférée",
    "settings.profile.auto": "Automatique (détecter depuis le message)",

    "settings.theme": "Thème",
    "settings.theme.dark": "Sombre",
    "settings.theme.light": "Clair",
    "settings.theme.system": "Système",
    "settings.readMode": "Mode lecture",
    "settings.persist": "Persistance",
    "settings.animations": "Animations",
    "settings.purge": "Purger toutes les données",

    "settings.language.hint": "Change instantanément tout le texte statique de l'UI. N'affecte pas le contenu des chats ni les system prompts des modèles.",

    "settings.maps.hint": "Clé API optionnelle pour tuiles vectorielles premium (MapTiler ou Stadia Maps). Si vide, MapLibre utilise les tuiles raster OSM.",
    "settings.maps.key": "Clé API",
    "settings.maps.provider": "Fournisseur",

    "connections.connect": "Connecter",
    "connections.disconnect": "Déconnecter",
    "connections.connected": "Connecté en tant que {account}",
    "connections.disconnected": "Déconnecté",
    "connections.invalid": "Connexion révoquée — reconnecter",
    "connections.redirecting": "Redirection vers {provider}...",

    "settings.tokens.compress": "Compression du contexte (sliding window)",
    "settings.tokens.recent": "Messages récents à conserver : {n}",
    "settings.tokens.truncate": "Tronquer les résultats d'outils",
    "settings.tokens.truncateLimit": "Limite de troncature : {n} Ko",
    "settings.tokens.caching": "Prompt caching (OpenRouter)",
    "settings.tokens.sticky": "Sticky routing par chat",
    "settings.tokens.chips": "Afficher les puces de tokens économisés",
    "settings.tokens.counter": "Afficher le compteur de tokens dans la boîte de saisie",

    "settings.shared.enable": "Activer la fonction dans les chats éligibles",
    "settings.shared.turnDuration": "Durée du tour : {n} min",
    "settings.shared.inviteNotif": "Notifications d'invitation",

    "settings.notifications.master": "Activer les notifications push",
    "settings.notifications.modelDone": "Le modèle a fini de répondre",
    "settings.notifications.turnAvailable": "Tour disponible en session partagée",
    "settings.notifications.newMessage": "Nouveau message en session partagée",
    "settings.notifications.toolDone": "Outil terminé en arrière-plan",
    "settings.notifications.granted": "Permission accordée ✓",
    "settings.notifications.denied": "Permission bloquée par le navigateur. Cliquez sur l'icône cadenas dans l'URL pour autoriser les notifications.",
    "settings.notifications.unsupported": "Votre navigateur ne supporte pas les notifications push.",

    "settings.offline.enable": "Activer le cache local",
    "settings.offline.syncNow": "Synchroniser maintenant",
    "settings.offline.purge": "Purger le cache local",
    "settings.offline.neverSynced": "Dernière sync : jamais",
    "settings.offline.lastSync": "Dernière sync : il y a {minutes} min",
    "settings.offline.cacheSize": "Cache : {size} Mo / 5 Mo",

    "settings.chats.autoTitle": "Suggérer automatiquement un titre après le premier échange",
    "settings.chats.renameHint": "Double-cliquez sur le titre du chat dans la barre latérale pour le renommer manuellement.",

    "settings.skills.hint": "Activez les skills d'analyse pour que le modèle applique automatiquement leurs directives quand le contenu est pertinent.",
    "settings.skills.search": "Rechercher skill...",
    "settings.skills.filterAll": "Toutes",
    "settings.skills.filterCore": "Noyau",
    "settings.skills.filterAdvanced": "Avancé",

    "settings.dashboard.keys": "API Key Rotator",

    "settings.about.desc": "Interface d'orchestration multi-fournisseur de modèles d'IA avec un style space opera.",

    "repo.title": "Dépôt de Documents",
    "repo.dropHere": "Déposez des fichiers ici ou cliquez pour téléverser",
    "repo.docName": "Nom du document",
    "repo.upload": "Téléverser",
    "repo.uploaded": "Document téléversé ✓",
    "repo.deleted": "Document supprimé",
    "repo.tooLarge": "Fichier trop volumineux (max 5 Mo)",
    "repo.usage": "{used} Mo / 100 Mo",
    "repo.searchPlaceholder": "Filtrer par nom...",
    "repo.download": "Télécharger",
    "repo.delete": "Supprimer",
    "repo.loadMore": "Charger plus",

    "offline.banner": "Mode hors ligne — Lecture uniquement. Vos messages seront envoyés lors de la reconnexion.",

    "model.unavailable": "Le modèle {model} n'est pas disponible. Passer à {fallback} ?",
    "model.changed": "Passé à {model} ({old} tombé)",
    "model.fallbackExhausted": "Tous les modèles fallback sont épuisés. Réessayez plus tard.",

    "tool.executing": "Exécution : {tool}",
    "tool.completed": "Outil terminé",
    "tool.failed": "Outil échoué : {error}",
    "tool.forbidden": "Outil non autorisé pour ce rôle.",
    "tool.timeout": "Outil timeout (30s)",
    "tool.iterLimit": "Tool caller : limite d'itérations atteinte.",
    "tool.notConnected": "Connectez votre compte {provider} dans Paramètres → Connexions.",

    "toast.renamed": "Renommé",
    "toast.renameFailed": "Impossible de renommer (hors ligne)",
    "toast.saved": "Enregistré ✓",
    "toast.error": "Erreur : {message}",
    "toast.copied": "Copié ✓",
    "toast.connectionLost": "Connexion perdue — mode hors ligne",
    "toast.connectionRestored": "Connexion restaurée ✓",
    "toast.sharedTurnYours": "C'est votre tour dans \"{chat}\"",
    "toast.sharedNewMessage": "{author} a écrit dans \"{chat}\"",
    "toast.modelResponded": "{model} a répondu dans \"{chat}\"",
    "toast.toolCompleted": "Outil {tool} terminé",

    "aria.menuToggle": "Ouvrir/fermer le menu",
    "aria.sandboxToggle": "Ouvrir/fermer le sandbox",
    "aria.modelSelector": "Sélecteur de modèle",
    "aria.attach": "Joindre un fichier",
    "aria.send": "Envoyer le message",
    "aria.stop": "Arrêter la génération",
    "aria.clearSearch": "Effacer la recherche",
    "aria.close": "Fermer",
    "aria.refresh": "Rafraîchir",
    "aria.collapse": "Réduire le sandbox",
    "aria.closePanel": "Fermer le panneau",

    "title.search": "Recherche Web",
    "title.scrape": "Scraping",
    "title.thinking": "Réflexion (Nemotron uniquement)",
  },
};

// ------------------------------------------------------------------------------
// Estado del idioma activo (persistido en users.profile_json.ui_lang vía API).
// ------------------------------------------------------------------------------
let _currentLang = "es";

export function getCurrentLang() { return _currentLang; }
export function setCurrentLang(lang) {
  if (STRINGS[lang]) {
    _currentLang = lang;
    document.documentElement.lang = lang;
  }
}

// ------------------------------------------------------------------------------
// t(key, params?, lang?): resuelve la traducción con interpolación {param}.
// Fallback: lang → "es" → key literal (debuggable).
// ------------------------------------------------------------------------------
export function t(key, params, lang) {
  const l = lang || _currentLang;
  const dict = STRINGS[l] || STRINGS.es;
  let str = dict[key];
  if (str === undefined) {
    // Fallback a español.
    str = STRINGS.es[key];
    if (str === undefined) return key; // devolver key literal para debug
  }
  if (params && typeof str === "string") {
    str = str.replace(/\{(\w+)\}/g, (_, name) => (params[name] !== undefined ? String(params[name]) : `{${name}}`));
  }
  return str;
}

// ------------------------------------------------------------------------------
// applyI18n(lang): recorre el DOM y reescribe textContent/placeholder/aria-label
// según data-i18n y data-i18n-attr.
// ------------------------------------------------------------------------------
export function applyI18n(lang) {
  setCurrentLang(lang);

  const elements = document.querySelectorAll("[data-i18n]");
  elements.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const attr = el.getAttribute("data-i18n-attr");
    const val = t(key);
    if (attr) {
      el.setAttribute(attr, val);
    } else {
      // Solo actualizar textContent si no hay elementos hijo con su propio data-i18n.
      const hasI18nChildren = el.querySelector("[data-i18n]");
      if (!hasI18nChildren) {
        el.textContent = val;
      }
    }
  });

  // Elements con data-i18n-attr pero sin data-i18n (ej. solo placeholder).
  document.querySelectorAll("[data-i18n-attr]:not([data-i18n])").forEach((el) => {
    const attr = el.getAttribute("data-i18n-attr");
    // El key se toma del atributo attr mismo: data-i18n-attr="placeholder" usa el atributo data-i18n-placeholder.
    const keyAttr = `data-i18n-${attr}`;
    const key = el.getAttribute(keyAttr);
    if (key) el.setAttribute(attr, t(key));
  });

  // Emitir evento para que app.js re-renderice contenido dinámico.
  document.dispatchEvent(new CustomEvent("veritas:i18n-changed", { detail: { lang } }));
}

// ------------------------------------------------------------------------------
// detectInitialLang(): mapea navigator.language → es|en|fr (default: es).
// ------------------------------------------------------------------------------
export function detectInitialLang() {
  const nav = (navigator.language || "es").toLowerCase();
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("en")) return "en";
  if (nav.startsWith("fr")) return "fr";
  return "es";
}

// ------------------------------------------------------------------------------
// formatDate(dateStr, lang) / formatNumber(num, lang) / pluralize(count, singular, plural, lang)
// ------------------------------------------------------------------------------
export function formatDate(dateStr, lang) {
  try {
    const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return new Intl.DateTimeFormat(lang || _currentLang, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(d);
  } catch { return String(dateStr); }
}

export function formatNumber(num, lang) {
  try {
    return new Intl.NumberFormat(lang || _currentLang).format(num);
  } catch { return String(num); }
}

export function pluralize(count, singular, plural, lang) {
  const l = lang || _currentLang;
  const rules = new Intl.PluralRules(l);
  const rule = rules.select(count);
  // Por convención: singular para "one", plural para "other" y resto.
  return rule === "one" ? singular : plural;
}

export default {
  STRINGS,
  t,
  applyI18n,
  detectInitialLang,
  formatDate,
  formatNumber,
  pluralize,
  getCurrentLang,
  setCurrentLang,
};
