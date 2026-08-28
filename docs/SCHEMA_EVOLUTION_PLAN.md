# Esquemas vivos y corpus soberano: diagnóstico y plan

Fecha: 2026-08-27. Estado: contratos y fronteras de aceptación implementados y
verificados localmente. Sin publicación ni entrenamiento.

## Resultado de esta intervención

| Producto | Versión local | Estado |
| --- | --- | --- |
| nlu-schema | 1.1.0 | Documento compatible, perfil estricto derivado, validación común y procedencia de ejecuciones nuevas |
| pictogram-composition-schema | 0.1.0 | Contratos de proveedor/artefacto, árbol recursivo y referencias; incluye regeneración espacial validada |
| mf-svg-schema | 2.0.0-draft.1 | Perfil portable, metadatos completos, vínculos reales, revisión por hash y aceptación protegida frente a resultados tardíos |

Los validadores son ESM precompilado: no requieren generación dinámica de código
en el navegador. Se mantiene la CSP de producción. Las filas preservan datos y
extensiones al cargar; los originales que necesitan ajustes operativos quedan
separados de esos ajustes. Los SVG rechazados pueden conservarse como borradores,
sin sustituir el canónico previo.

Verificaciones ejecutadas: 149 pruebas locales de servicios/scripts/fronteras sin
proveedores reales; 5 pruebas NLU, 4 de composición, 9 MF-SVG y 8 fixtures NLU
históricos; TypeScript, compilación Vite y traducciones. Los tres productos también
se instalaron y probaron en exportaciones aisladas, con hashes de contenido y
validación ejecutada sin permitir generación dinámica de código. La compilación
se abrió en navegador con la CSP original: interfaz y bibliotecas cargaron sin
errores de consola. También se verificó un arranque limpio en localhost:3000 tras
corregir la interoperabilidad de los validadores con Vite en desarrollo, sin
debilitar la CSP. Allium check/analyse se ejecutaron: cero errores/hallazgos;
permanecen advertencias estructurales, no una prueba formal de toda la conducta.

El corpus conserva el mismo hash agregado de sus 20 bibliotecas/819 filas; tampoco
se modificó su índice durante esta intervención. Los cuatro secretos de proveedor
configurados localmente se contrastaron con los JS compilados sin encontrar sus
valores. Esto no equivale a una auditoría exhaustiva de seguridad.

### Límites comprobables

- No se ejecutó un nuevo ciclo pagado completo ni la comparación experimental.
  Las pruebas de SVG cubren el contrato y las fronteras de promoción; no demuestran
  fidelidad geométrica de todos los ensamblados ni comprensión por personas.
- El perfil SVG exige correspondencia completa. Admite vínculos implícitos
  suministrados explícitamente, pero la plataforma aún no tiene un editor de esos
  vínculos. Nunca se inventan para aprobar un resultado.
- La vista puede aplicar estilos actuales como proyección; el SVG guardado y
  descargado conserva sus propios bytes. Cambiar su estilo canónico exige revisión.
- Los estados históricos no se reclasifican como conformes. Para nuevas operaciones
  pueden requerir corrección o regeneración explícita.
- Archivo inmutable de intentos/activos, colisiones SVG entre bibliotecas,
  migración histórica, revisión humana y corpus de entrenamiento siguen en roadmap.
- Las exportaciones son previews verificadas. No se crearon repositorios, commits,
  releases ni publicaciones. Las licencias históricas permanecen intactas.

## Decisión de autoridad

**PictoNet es la fuente canónica.** Los esquemas evolucionan desde la interacción
empírica con la plataforma, dentro de `schemas/`. Los repositorios
`mediafranca/nlu-schema`, `mediafranca/pictogram-composition-schema` y
`mediafranca/mf-svg-schema` son productos
independientes publicados desde esa fuente. No son dependencias que impongan su
estado externo a PictoNet. La copia hermana `../nlu-schema` no se importa ni modifica.

Esto recupera la intención registrada en `eb3849a`: absorber los submódulos para
desarrollar el estándar vivo dentro de PictoNet. No se reintroducen gitlinks.

## Horizonte de investigación

Conservar evidencia verificable de la transformación de intención comunicativa a
representación pictográfica: enunciado y contexto → análisis semántico → composición
→ imagen → intervenciones y evaluación humana. JSON válido no demuestra corrección
semántica, accesibilidad, consentimiento, licencia de entrenamiento ni calidad del
ejemplo. No se entrena ni se publica un corpus como efecto secundario de este trabajo.

## Diagnóstico confirmado

| Hallazgo | Evidencia | Consecuencia |
| --- | --- | --- |
| NLU canónico, tools y tipos divergen | `schemas/nlu-schema/pictonet-nlu-1.0.1.schema.json`, `services/claudeService.ts`, `netlify/functions/_shared/pipelineRunner.js`, `types.ts` | La generación no prueba conformidad con el producto documentado. |
| Tool use se presenta como validación | Cast `as NLUData` y extracción de tool sin validador canónico | Se aceptan estructuras fuera del contrato. |
| COMPONER individual recibe solo parte del NLU | `claudeService.ts:305`; batch recibe NLU completo | Se pierden intención, NSM, pragmática y forma lógica en una ruta. |
| Árboles normalizados de manera distinta | `visualElementUtils.ts`; helpers de `pipelineRunner.js` | Se descartan nodos o se inventa `unknown`; no se detectan IDs duplicados. |
| Adaptador Gemini elimina referencias sin resolver | `geminiTranslate.js` | Importar JSON Schema directamente puede borrar restricciones. |
| El contrato Allium de composición devuelve un tipo de estructuración SVG | `specs/visual-reasoning.allium`, `CompositionBoundary` | Contrato declarado incorrecto. |
| Deserialización omite metadatos existentes | `App.tsx`, `sanitizeRow` | Modelo, calidad y otras propiedades no sobreviven necesariamente al roundtrip. |
| Versiones y licencia inconsistentes | package/README/schema/LICENSE del NLU | No hay release inequívoca ni licencia coherente. |
| Publicador copia árbol sucio y reemplaza remoto | `scripts/publish-schema.sh` | Publicación no reproducible, posible pérdida de archivos remotos. |
| No hay versiones semánticas por fila | Inspección de tipos y corpus público | No atribuir retrospectivamente versiones o configuración. |
| Activos no son un archivo inmutable | Recompresión JPEG en IndexedDB, exportaciones sin binarios, claves SVG por row ID | No afirmar reconstrucción completa del proceso. |

El diagnóstico agregado del corpus público identifica 20 bibliotecas y 819 filas,
817 con enunciado y activo visual, 685 IDs únicos y 630 enunciados normalizados
únicos. Son candidatos técnicos, no ejemplos autorizados ni revisados para entrenar.
El informe reproducible debe conservar conteos y motivos sin imprimir contenido
personal ni blobs de imagen.

La auditoría posterior confirma que las 819 salidas NLU históricas divergen tanto
del contrato congelado 1.0.1 como del documento compatible 1.1.0, sin diferencias
entre ambos validadores. Esto identifica una divergencia previa entre generación
y especificación, no una degradación introducida por la nueva versión ni una
evaluación de su calidad semántica. Composición: 105 documentos conformes con el
contrato actual, 713 divergentes y uno ausente. No se reescribieron esas filas.

### Ampliación confirmada: SVG como unidad canónica portable

El usuario incorpora `mf-svg-schema` al mismo proceso de evolución y confirma que
el SVG debe funcionar como single source of truth del pictograma. Se propone esta
frontera: el SVG consolidado es el artefacto canónico de una revisión; el JSON de
fila conserva el trabajo y la procedencia y referencia esa revisión por hash.
No deben existir dos fuentes finales editables independientemente.

El SVG transporta geometría, intención, NLU completo, composición, vínculos con
grupos gráficos y procedencia conocida. Los conceptos implícitos no requieren
inventar geometría. La revisión humana no se fabrica ni se hereda tras cambios.
La portabilidad no exige distribuir identidades, geografía detallada, audio o
historial privado: los perfiles de exportación deben explicitar qué se incluye.

Diagnóstico inicial: `buildMetadataJSON` actualmente genera `nsm.explications`
mientras el esquema exige `nsm.primes/gloss`; omite `concepts`, agrega campos que el
esquema cierra y fija `pipeline: claude+recraft` aunque existan otros proveedores.
Además transforma el NLU y pierde campos. La validación XML actual no demuestra
conformidad con el contrato. Se requiere una nueva versión coherente y pruebas
del productor y validador, conservando el formato histórico sin reescritura.

## Fases y puertas de verificación

### Fase 0 — Evidencia y preservación

- Diagnosticar las rutas individual, lote, importación y exportación.
- Conservar el NLU histórico 1.0.1 sin reescritura, el corpus y el trabajo externo.
- Referencias: archivos de la tabla; `specs/intervention-recording.allium` y
  `specs/library-manager.allium` para límites de registro y persistencia.
- Verificación: hashes previos, informe agregado, lectura del historial Git.
- Prohibido: migración masiva, importar el borrador externo 2.0 o fabricar procedencia.

### Fase 1 — Contratos Allium

- Corregir las fronteras de comprensión/composición y especificar evolución,
  publicación y aptitud del corpus con estados, invariantes y preguntas abiertas.
- Diferenciar: salida del proveedor, artefacto aceptado, dato histórico y ejemplo
  elegible para entrenamiento. El root sintético pertenece al artefacto local.
- Verificación: `allium check` y `allium analyse`; informar advertencias y no
  equiparar anotaciones en prosa con propiedades demostradas.
- Prohibido: documentar conducta futura como implementada.

### Fase 2 — Productos canónicos y fronteras ejecutables

- Publicar una nueva versión/perfil NLU sin cambiar los bytes de 1.0.1.
- Crear `schemas/pictogram-composition-schema` con contrato recursivo, pruebas,
  documentación y dos fronteras claras: hijos del proveedor y árbol con root.
- Reutilizar contratos en cliente/servidor; validar con JSON Schema y comprobaciones
  de referencias/IDs. La proyección para el proveedor no sustituye al validador.
- Compartir NLU completo en COMPONER; eliminar normalización divergente.
- Referencias: API actual `generateNLU`, `generateVisualBlueprint`, `runPhase1`,
  `runPhase2`, fixtures existentes y documentación Ajv al final.
- Verificación: fixtures positivos/negativos, adapters Gemini, igualdad de rutas,
  errores explícitos, TypeScript y compilación. Sin llamadas de pago automáticas.
- Prohibido: aceptar árbol vacío, inventar IDs/conceptos o destruir información para
  que un resultado inválido pase. Lectura histórica separada de generación nueva.

### Fase 3 — Preservación y diagnóstico del corpus

- Corregir pérdidas de propiedades en roundtrip de filas. Conservar extensiones y
  procedencia existente sin atribuir validez a versiones desconocidas.
- Añadir un diagnóstico agregado reproducible que señale contratos ausentes,
  duplicados, activos, revisiones y derechos desconocidos.
- Incorporar procedencia de ejecuciones nuevas solo donde pueda ligarse de forma
  comprobable a entrada, salida y configuración; no usar configuración actual como
  sustituto de configuración histórica.
- Verificación: roundtrip con modelo/calidad/audio/extensiones; originales sin
  modificar; duplicados nunca contados como ejemplos independientes revisados.
- Prohibido: inferir permiso de entrenamiento de que una biblioteca sea pública,
  o tratar evaluaciones vacías como revisión humana.

### Fase 4 — Exportación independiente

- Un mismo flujo para los tres productos: preview explícita del árbol de trabajo y
  exportación reproducible desde un commit concreto, con manifiesto y hashes.
- Preparar propuestas sobre el historial remoto existente; no force push, borrado
  indiscriminado ni publicación directa automática a main.
- Referencias: `scripts/publish-schema.sh`, Git archive/subtree y workflows existentes.
- Verificación: paquete exportado funciona aislado; allowlist sin `.env`, corpus,
  dependencias o referencias a archivos externos; manifest identifica fuente sucia
  como preview, nunca como release.
- Puerta humana: resolver licencia, visibilidad y autorización de publicación.
  La licencia de los esquemas no concede derechos sobre los datos de entrenamiento.

### Fase 4B — Conformidad SVG semántica (perfil local implementado)

- Diagnosticar `schemas/mf-svg-schema`, la copia `lib/mf-schema`, ensambladores de
  ESTRUCTURAR y validadores. Separar requisitos comprobables de afirmaciones de
  eficacia o accesibilidad que necesitan evaluación humana.
- Especificar en Allium la revisión SVG autocontenida y su relación con la fila;
  versión nueva, metadatos sin pérdida, referencias existentes y estados de revisión.
- Implementar el perfil del producto y la frontera de generación/validación sin
  declarar conformes automáticamente los SVG históricos.
- Verificación: fixtures válidos/negativos, referencias y unicidad, integridad de
  metadatos, geometría preservada donde corresponda, paquete exportable independiente.
- Prohibido: rellenar primos NSM o aprobaciones ficticias para pasar un esquema,
  confundir XML bien formado con conformidad semántica o eficacia CAA.

### Fase 5 — Corpus de entrenamiento (roadmap, no incluido como entrenamiento actual)

- Historial inmutable de intentos y revisiones enlazado a activos originales por
  hash; preservar correcciones, rechazos y motivos sin confundirlos con positivos.
- Relaciones espaciales estructuradas y referencias composición→NLU, introducidas
  con corpus de regresión; no inferirlas retrospectivamente del prompt sin revisión.
- Resolver colisiones SVG entre bibliotecas y preservación del original frente a
  recomprensión. Migración explícita, verificable y reversible.
- Definir consentimiento/derechos/retiro, revisión semántica y accesibilidad con
  criterios acordados. Desidentificación y minimización antes de exportar.
- Exportar snapshots versionados con exclusiones justificadas; agrupar derivados,
  duplicados y participantes/escenarios según corresponda antes de dividir train,
  validation y test. Mantener evaluación independiente de la generación.
- Selección del modelo soberano, arquitectura y entrenamiento quedan abiertos: el
  dataset debe servir a ese estudio sin fijar ahora un proveedor o modelo.

## Decisiones pendientes

1. Licencia de los tres productos: el LICENSE NLU conserva CC BY-SA 4.0 y su
   package ya refleja esa licencia; mf-svg conserva CC BY 4.0. Composición sigue
   privado/sin licencia de distribución asignada. No cambiar derechos ni publicar
   hasta resolver.
   Propuesta discutida: CC BY-SA 4.0 para contratos/documentación; licencia de
   software explícita para código ejecutable. AGPL-3.0-only, como Vera según el
   usuario, es coherente para aplicaciones/servicios, pero no se extiende de forma
   automática a todos los archivos, datos o pesos. No se cambia la licencia de
   PictoNet en este trabajo. Esta decisión no bloquea validación ni desarrollo local.
2. Crear el repositorio de composición público en `mediafranca`.
3. Criterios humanos de aceptación, usos autorizados y política de conservación de
   datos personales; no quedan resueltos por una validación JSON.

## Evaluación de la hipótesis de generación escalonada

La capacidad de exponer y corregir artefactos intermedios es una propiedad del
diseño; su superioridad semántica frente a un prompt directo sigue sin medirse.
El protocolo local `research/PIPELINE_EVALUATION_PLAN.md` (no incluido en Git) separa prompt directo
cuidado, prompt expandido, cadena automática y cadena intervenida, con controles
de modelo, contexto, coste y trabajo humano. Incluye comprensión por personas,
errores críticos, estudios de componentes y límites de generalización. No se
ejecutó ese experimento ni se presentan resultados hipotéticos como evidencia.

## Fuentes técnicas

- [Git subtree](https://raw.githubusercontent.com/git/git/master/contrib/subtree/git-subtree.adoc): permite separar historia de subdirectorios; no garantiza por sí
  solo continuidad con un remoto que tiene otra historia. Se prefiere exportación
  trazable con revisión para conservar el flujo canónico actual.
- [JSON Schema: dialecto](https://json-schema.org/understanding-json-schema/reference/schema):
  `$schema` identifica el dialecto; la versión del producto se registra por separado.
- [Ajv: gestión de esquemas](https://ajv.js.org/guide/managing-schemas.html): reutilizar
  validadores compilados y resolver referencias del contrato.
