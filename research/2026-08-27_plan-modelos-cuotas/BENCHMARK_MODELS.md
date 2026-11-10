# Benchmark local de modelos de texto

Preparación implementada y probada con respuestas simuladas el 2026-08-27.
**No se ha ejecutado ningún benchmark pagado ni identificado un modelo ganador.**

CLI: `scripts/benchmark-models.mjs`. Contrato: `specs/model-benchmark.allium`.

## Planificar sin red

Desde la raíz del repositorio:

```sh
node scripts/benchmark-models.mjs --cases research/BENCHMARK_CASES_SYNTHETIC.json --phase 2 --models gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol --repetitions 3 --max-output-tokens 4096 > research/BENCHMARK_PHASE2_PLAN.json
```

Esto prepara nueve intentos y **no llama a ningún proveedor**. El caso adjunto es
un ejemplo sintético para comprobar el mecanismo, no un conjunto de evaluación ni
una anotación semántica revisada. Para COMPRENDER se usa `--phase 1`; COMPONER
siempre recibe el mismo NLU validado de cada caso. También se pueden seleccionar
los IDs de Claude y Gemini admitidos por el catálogo para esa fase.

La entrada requiere `synthetic: true`, `cases` con `id` único y `utterance`, y `nlu`
completo para fase 2. `config` es opcional. No se seleccionan bibliotecas privadas.
El orden se mezcla de forma determinista con `--seed`; el manifiesto conserva
orden, entradas, solicitudes, esquemas, precios fechados y hashes.

## Ejecución explícita posterior

La ejecución exige **los cuatro** parámetros `--run`, `--budget-usd`, `--max-calls`
y `--max-output-tokens`. Antes de usarla, acordar presupuesto, casos y repeticiones.
Un ejemplo de sintaxis, que no se ha ejecutado:

```sh
node --env-file=.env scripts/benchmark-models.mjs --cases research/BENCHMARK_CASES_SYNTHETIC.json --phase 2 --models gpt-5.6-luna,gpt-5.6-terra,gpt-5.6-sol --repetitions 3 --max-output-tokens 4096 --max-calls 9 --budget-usd 1 --run
```

Se crea una carpeta nueva `research/benchmark-<fecha>/` con `plan.json`,
`attempts.jsonl` y `results.json`. Se registra la reserva antes de llamar, después
el éxito o error, salida cruda disponible, conformance, modelo devuelto, consumo,
latencia y coste estimado. No hay reintentos automáticos, escalado de límites ni
cambio de modelo. Nunca cambia los valores predeterminados de la aplicación.

## Límites de interpretación

La reserva usa una estimación conservadora de entrada (dos tokens por byte UTF-8
serializado más 8192 de margen) y el límite de salida; Gemini incluye su presupuesto
de pensamiento explícito. Aplica la tarifa de contexto largo cuando corresponde.
Es una regla de admisión conservadora, **no una garantía del tokenizer ni un techo
absoluto de la factura**. Los dólares calculados se etiquetan como estimaciones;
los contadores devueltos por el proveedor se conservan como evidencia.

Si falta consumo, queda reservada la estimación y el experimento se detiene antes
de otra llamada. También se detiene al alcanzar llamadas/presupuesto, exceder la
reserva observada o recibir rechazo de acceso/facturación. Los errores estructurales
con consumo conocido permanecen en el conjunto, sin repetirse para buscar un éxito.

La validación automática mide estructura; no mide comprensión ni utilidad CAA.
El siguiente paso experimental es acordar un conjunto revisado, criterios humanos
ciegos y repeticiones suficientes. Ver `PIPELINE_EVALUATION_PLAN.md`.

Los tokens de entrada cacheados de OpenAI usan su tarifa conocida cuando está
disponible para el contexto correspondiente. Si aparecen cachés de Claude o Vertex
sin tarifas suficientes en el catálogo, o contadores inválidos, el coste queda
como desconocido y el experimento se detiene conservando la reserva. Esto evita
comparar como si fueran equivalentes consumos que tienen reglas de precio distintas.
