# Uso de IA

Cada persona anota aquí qué herramienta de IA usó y para qué.

| Fecha | Rol | Herramienta | Para qué |
| --- | --- | --- | --- |
| 2026-11-14 | 1 | Claude (Anthropic) | Estructura inicial del proyecto, escenas del motor y generador de recursos provisionales |
| 2026-11-14 | IA y ML | Claude (Anthropic) | Robot de la IA (comportamiento y dibujo provisional), script de entrenamiento del pronóstico de llamaradas y su uso en el navegador |

## El pronóstico de la IA de la base

- **Qué es:** una regresión logística, un modelo de machine learning muy simple. **No** es IA generativa: no inventa texto. Las frases del robot están escritas por el equipo.
- **Con qué aprende:** datos reales de NOAA SWPC, un registro por día desde 1996.
- **Qué tan bien funciona:** está medido con años que no vio. Las cifras están en `data/modelo_pronostico.json` → `evaluacion`. Falla, igual que los pronósticos reales, y el robot lo dice.
- **Dónde corre:** en el navegador, sin servidor ni cuentas. Si no hay internet, usa los últimos 30 días guardados en el juego.


- **Skill «Anatomy»** ([wheresryan22/anatomy](https://github.com/wheresryan22/anatomy), licencia MIT), instalada el 14-11-2026 para Claude Code. Sirve para dibujar máquinas isométricas interactivas que explican cómo funcionan (por ejemplo, el interior de una estación). Corre en local; su script de publicación en la galería comunitaria (`publish.mjs --submit`) **no se usa**.
