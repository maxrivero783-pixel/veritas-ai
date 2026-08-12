# Tipos de entidades para grafos Véritas

## Nodos sugeridos
- **person:** individuo identificable o actor público.
- **organization:** empresa, ONG, partido, medio, institución o grupo informal.
- **location:** país, ciudad, instalación, región o punto geográfico.
- **event:** suceso delimitado temporalmente.
- **asset:** dominio, cuenta, documento, vehículo, infraestructura, producto o recurso.
- **claim:** afirmación verificable.
- **topic:** tema, narrativa, campaña o marco discursivo.

## Relaciones sugeridas
- authored, owns, funds, employs, located_in, attended, published, amplifies, contradicts, supports, mentions, transacted_with, linked_to.

## Campos mínimos
Cada nodo debe incluir id estable, label, type, confidence y evidence. Cada arista debe incluir source, target, relation, direction, confidence y evidence.

## Buenas prácticas
Evita duplicados, fusiona aliases con cautela y no conviertas coincidencias nominales en identidad confirmada.