# Quiver Arrow 2 en PRODUCIR (2026-11-10)

Prueba de `arrow-2` (QuiverAI, SVG nativo) con las 8 composiciones de `research/2026-11-01_benchmark-modelos/corpus/compositions-8.json`. Runner: `bench-quiver.mjs`. Mosaico: `mosaico.png` (columnas: gpt-image-2.5-flare del 2026-11-06, A, B, C).

| Variante | Qué cambia | OK | p50 | US$ mediana | Tokens salida (mediana) | viewBox |
|---|---|---|---|---|---|---|
| A | prompt actual con el estilo AIGA dentro, parámetros por defecto | 8/8 | 36,6 s | 0,116 | 5446 | 0 0 80 80 |
| B | estilo AIGA en `instructions`, `attributes.viewBox` 512, `temperature` 0.4, `reasoning_effort` low | 8/8 | 29,1 s | 0,066 | 2936 | 0 0 512 512 |
| C | B con el estilo de PICTOS - Señalética y dos pictogramas suyos en `references` | 8/8 | 34,0 s | 0,080 | 3604 | 0 0 512 512 |

Total gastado: US$2,30 (más una prueba previa de US$0,19). Ningún SVG trae texto ni scripts; A usa degradados, B y C no. C quedó con unos 8 trazados por pictograma; B con unos 37.
