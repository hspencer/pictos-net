# PictoNet 2.6.0

Entrega inicial verificada el 2026-08-27 en la rama `dev` y el sitio de pruebas
`next.pictos.net`: commit `a0df2f5cb8afe5bd9f28bbf698f9f730a2b05066`.
La entrega se promueve de `dev` a `main` tras verificar CI y el despliegue de
pruebas; la publicación en producción requiere su propia comprobación.

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
las credenciales, worktrees locales ni cambios aislados de fecha del índice de bibliotecas.

El cierre de entrega incorpora además la actualización local de la biblioteca
Escena descriptiva de 8 a 15 filas, su nuevo nombre de archivo, el índice y sus
miniaturas derivadas. El inventario resultante contiene 20 bibliotecas y 826 filas.
Se sincronizan también las dependencias de tipos React del archivo `deno.lock`;
los worktrees de `/.codex/` permanecen locales e ignorados.

## Verificación y publicación

La entrega inicial pasó 193 pruebas locales sin la antigua prueba de integración
pagada, 18 pruebas de esquemas y 8 fixtures, contratos Allium sin errores,
TypeScript, 781 traducciones y compilación. La comprobación en navegador verificó
la versión 2.6.0 y la exclusión mutua de los paneles de configuración.
Las pruebas simuladas no demuestran disponibilidad de la cuenta ni superioridad
semántica de un modelo. No se ejecuta un benchmark pagado durante la preparación.

- GitHub CI del commit inicial: [ejecución 33128822569](https://github.com/hspencer/pictos-net/actions/runs/33128822569), resultado `success`.
- Netlify: despliegue `6a90d1d7c229aa0009521995`, estado `ready`; versión 2.6.0
  comprobada en el DOM de [next.pictos.net](https://next.pictos.net).

Después del commit de cierre y de la promoción a `main`, se deben verificar de
nuevo CI, ambos despliegues y su versión publicada. Las pruebas con proveedores y cualquier gasto requieren un
alcance explícito. Las limitaciones de acceso a métricas/cuotas de GCP siguen
pendientes de autorización; no se cambian IAM, facturación ni capacidad contratada.
