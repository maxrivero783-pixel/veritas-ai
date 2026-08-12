# Recuperación Véritas v2.4

Este documento registra la reconstrucción iniciada a partir del artefacto de rescate compartido por el usuario. El patch pegado en chat contiene transformaciones de Markdown, por lo que no se aplica directamente.

## Base actual

- Rama de trabajo: `arena/019fd763-v-ritas`.
- Base: cambios del PR #1 ya fusionados en `main`.
- Objetivo: recuperar los cambios v2.4 ausentes sin sobrescribir funcionalidad ya integrada.

## Inicio reconstruido

Se creó la base no dependiente de credenciales para herramientas públicas estructuradas:

- `lib/tools/_publicData.js`: límites, fetch JSON seguro y formateo común.
- `semantic_scholar_search`
- `openalex_search`
- `crossref_search`
- `wikidata_search`
- `wikipedia_search`

Las herramientas se registrarán en los catálogos cliente/servidor junto con el resto de la segunda mitad del rescate para mantener ambos mirrors sincronizados.

## Pendiente de la segunda mitad

- Registro final de todas las fuentes públicas y sus handlers.
- Brevo y endpoints de notificaciones.
- Sandbox Pro, roles/model routing y UI.
- Guard rails R2 y modo async/pending, verificando qué partes ya viven en la base.
- Suite de validación e integración.
