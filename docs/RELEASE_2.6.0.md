# PictoNet 2.6.0

Preparación de entrega: 2026-08-27. Destino previsto: rama `dev` y sitio de pruebas
`next.pictos.net`. Este documento no afirma que el commit, push o despliegue ya se
hayan realizado.

## Cambios

- Catálogo de modelos compartido, precios de referencia fechados y opciones
  OpenAI para comprender, componer, producir imágenes y estructurar SVG.
- Paneles de configuración básica y avanzada mutuamente excluyentes, sin
  modificar sus valores al abrirlos o cerrarlos.
- Modelos Recraft V4.1/V4 Styles actualizados, con selección explícita de un estilo
  existente, validación antes del cobro y conservación del identificador de estilo.
- Reintentos con presupuesto temporal, respeto de `Retry-After` y distinción entre
  cuota interna, capacidad del proveedor, facturación y permisos. Los lotes se
  detienen ante un 429 terminal y conservan las etapas ya aceptadas.
- Contratos canónicos NLU 1.1.0 y composición 0.1.0; candidato MF-SVG
  2.0.0-draft.1 con metadatos semánticos, validación y promoción de revisiones.
- Preservación de campos históricos y procedencia al importar/exportar filas;
  validadores estáticos compatibles con la política CSP sin `unsafe-eval`.
- Exportaciones independientes verificables de los tres productos de esquema y
  CLI de benchmark de texto que, por defecto, solo planifica sin usar la red.
- Estructuración SVG asíncrona con entradas guardadas antes de encolar el trabajo,
  para respetar el límite de carga de las funciones de fondo de Netlify.

## Compatibilidad y alcance

La aplicación pasa de 2.5.1 a 2.6.0 por la incorporación de capacidades. Los
esquemas mantienen sus propias versiones; no se publican como repositorios
independientes ni se convierten en submódulos en esta entrega. Se conservan las
licencias históricas y no se migran automáticamente las bibliotecas existentes.
La aceptación estricta de nuevos resultados puede revelar datos incompletos que
antes circulaban sin validación; no certifica la calidad comunicativa del dibujo.

`research/` permanece local e ignorado por Git: protocolos, referencias privadas
y resultados experimentales no forman parte del despliegue. Tampoco deben entrar
las credenciales, worktrees locales ni cambios de fecha del índice de bibliotecas.

## Verificación y publicación

Antes del commit se exige completar la suite local sin la antigua prueba de
integración pagada, los contratos Allium, TypeScript, traducciones y compilación.
Las pruebas simuladas no demuestran disponibilidad de la cuenta ni superioridad
semántica de un modelo. No se ejecuta un benchmark pagado durante la preparación.

Tras el push a `dev`, verificar el despliegue de Netlify y la versión 2.6.0 visible
en `next.pictos.net`. Las pruebas con proveedores y cualquier gasto requieren un
alcance explícito. Las limitaciones de acceso a métricas/cuotas de GCP siguen
pendientes de autorización; no se cambian IAM, facturación ni capacidad contratada.
