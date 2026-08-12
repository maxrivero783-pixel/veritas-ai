# Prompts de skills de Véritas

Esta carpeta contiene los prompts Markdown que carga `lib/skillsRegistry.js` para las skills built-in de Véritas.

## Contenido

- `*.md`: directivas operativas de cada skill.
- `veritas_agent_system_prompt.md`: prompt de referencia del Agente Véritas v2.4 con matriz de herramientas real del proyecto.
- `references/*.md`: guías de apoyo cargadas bajo demanda para skills que declaran `references`.
- `evals.json`: casos de smoke testing para validar activación, estructura, evidencia, seguridad y utilidad.

Los archivos están diseñados para ser servidos estáticamente desde Cloudflare Pages y consumidos vía `fetch('/prompts/<skill>.md')`.

## Convenciones

Cada skill mantiene esta estructura base:

1. Misión.
2. Cuándo activarla.
3. Principios de operación.
4. Procedimiento.
5. Integración con herramientas Véritas.
6. Formato de salida.
7. Criterios de calidad.
8. Preguntas de aclaración mínimas.

## Totales

- Skills generadas: 77.
- Referencias de apoyo: 7.
- Prompt de sistema de agente: 1.
