# Exportación independiente de esquemas

## Autoridad y alcance

`schemas/pictos-nlu-schema`, `schemas/pictos-composition-schema`,
`schemas/pictos-svg-schema` y `schemas/pictos-api-schema` son las fuentes
canónicas. Los productos evolucionan con la evidencia empírica de PICTOS y se
comitean aquí. Cada uno tiene un repositorio de referencia en `mediafranca` con el
mismo nombre, que recibe versiones en un solo sentido. No usamos submódulos.

Hay dos herramientas con responsabilidades separadas:

- `scripts/export-schema.mjs` (y su alias `publish-schema.sh`) **solo escribe un
  directorio local nuevo**, fuera del repositorio. Aplica la lista de archivos
  permitidos, rechaza credenciales reconocibles y escribe `EXPORT_MANIFEST.json`.
  Nunca crea repositorios, commits, tags ni pushes.
- `scripts/sync-schema-mirror.sh` lleva una instantánea comprometida del exportador
  al repositorio de referencia. Sin `--push` es una prueba en seco; con `--push`
  hace commit, etiqueta y push. Es la única ruta de publicación.

## Preview del trabajo actual

Desde la raíz de PICTOS:

```sh
node scripts/export-schema.mjs preview pictos-nlu-schema
node scripts/export-schema.mjs preview pictos-composition-schema
node scripts/export-schema.mjs preview pictos-svg-schema
```

Se imprimen las rutas temporales y el hash del contenido. Puede usarse
`--output /tmp/mi-preview-nlu` si el directorio no existe. La preview puede incluir
cambios sin commit; el manifiesto registra `mode: preview`, el commit base y si el
repositorio tiene cambios. Siempre lleva `release: false` y `validation: not-run`.
**No afirma que esos bytes estén contenidos en el commit base.**

## Instantánea reproducible de un commit

```sh
node scripts/export-schema.mjs committed pictos-nlu-schema --ref <SHA-completo>
node scripts/export-schema.mjs committed pictos-composition-schema --ref <SHA-completo>
node scripts/export-schema.mjs committed pictos-svg-schema --ref <SHA-completo>
```

El SHA debe identificar un commit completo, no `HEAD`, una rama o un tag móvil.
El exportador lee blobs inmutables de ese commit, aunque haya cambios locales no
relacionados. `source.dirty: false` describe esa instantánea Git, no el checkout
actual. El contrato debe existir ya en ese commit. No se comitea nada automáticamente.

`EXPORT_MANIFEST.json` registra producto, versión, commit fuente, ruta, hash SHA-256
por archivo, tamaño, ejecutabilidad y hash agregado. Se omiten fecha y ruta temporal
para que exportaciones de los mismos bytes produzcan el mismo manifiesto. La lista
de archivos ordenada y sus hashes permiten vincular las verificaciones con la
instantánea exacta; editarla después invalida esas verificaciones.

## Verificación independiente

Ejecutar en **cada directorio exportado**, no solo en PICTOS:

```sh
npm ci --ignore-scripts
npm test
```

`npm ci` requiere el lockfile del producto y acceso al registro si las dependencias
no están en caché. No copiar `node_modules` de PICTOS ni depender de sus archivos
para declarar que el producto funciona aislado. La exportación no ejecuta scripts
ni instala paquetes por sí sola. Conservar el resultado de pruebas junto al hash
agregado; el manifiesto no inventa una validación que no ejecutó.

Los validadores se generan antes de ejecutar la aplicación y se distribuyen como
ESM estático. Cada producto verifica con `scripts/build-validators.js --check`
que esos bytes corresponden a sus contratos; no se compilan funciones durante la
carga del navegador ni se debilita CSP. Tras cambiar un contrato, regenerar con
`npm run build:validators` antes de las pruebas y la exportación.

Antes de una release también hay que verificar ejemplos, versiones documentadas,
compatibilidad y que el producto no cambió respecto al hash probado. Preparar una
instantánea comprometida no equivale al estado Allium `exportable`: ese estado
requiere evidencia de validación completa para exactamente esos bytes.

## Límites de exportación

La allowlist incluye paquete/lockfile, README, licencia, changelog, registro de
versiones congeladas, contratos JSON, `index.js`, `validators.js` estático, runner y archivos de pruebas,
scripts y documentación del producto, además de su workflow de validación.
Para `pictos-svg-schema` se admiten únicamente estos recursos heredados adicionales:
`requirements.txt`, `schemas/metadata.schema.json`, `schemas/styles.css`,
`tools/validator.py`, `examples/canonical.svg` y `examples/v2example.svg`. No es una
autorización general para exportar carpetas de SVGs, programas Python u otros datos.
No incluye bibliotecas de PICTOS, corpus, `.env`, dependencias ni directorios Git.
Se rechazan symlinks y marcadores reconocibles de credenciales en archivos admitidos.
Los nombres de archivo no se ejecutan como comandos. La revisión humana sigue
siendo necesaria: ningún detector puede demostrar la ausencia de cualquier dato
personal o secreto incrustado en documentación o ejemplos.

`npm run copy-schemas` tiene otro propósito: copia solo contratos JSON públicos
para servirlos con la app, incluidos los contratos de `pictos-svg-schema` y su
contrato histórico 1.0 en la ruta anidada original. No borra otros archivos
públicos. No es una publicación ni una exportación del corpus.

CI ejecuta las pruebas de los productos, todas las suites locales de
`scripts/*.test.mjs` (incluida la auditoría del corpus) y exporta los cuatro desde
el commit probado. Los tres que tienen pruebas propias se instalan y verifican de
forma independiente; las de `pictos-api-schema` corren en la suite raíz.
El producto SVG incorpora snapshots de los contratos NLU y composición; su
comprobación de sincronización en PICTOS debe pasar antes de preparar una
exportación, aunque las pruebas exportadas funcionen sin el monorepo.

## Sincronización con el repositorio de referencia

```sh
scripts/sync-schema-mirror.sh pictos-nlu-schema          # prueba en seco
scripts/sync-schema-mirror.sh pictos-nlu-schema --push   # publicación
```

El script exige que el producto no tenga cambios sin commitear, corre sus
pruebas, exporta el commit actual en modo `committed` y compara con un clon
fresco del espejo. Se detiene, sin publicar nada, en tres casos:

1. Un archivo de `FROZEN_RELEASES.json` tiene en el espejo bytes distintos del
   hash congelado. Para reemplazarlo hay que nombrarlo en
   `ALLOW_FROZEN_OVERWRITE`, lo que deja constancia de la decisión.
2. Un archivo existe solo en el espejo. Para retirarlo hay que nombrarlo en
   `ALLOW_REMOTE_DELETE`.
3. La etiqueta `v<versión>` ya existe y algún `*.schema.json` difiere de ella. Una
   versión no se reutiliza para contratos distintos: hay que subir la versión.

Si la etiqueta existe y los contratos son idénticos, el cambio (README, metadatos
del paquete) se publica como commit sin etiqueta nueva. El historial del espejo se
conserva: el push nunca es forzado, y si el espejo avanzó entre el clon y el push,
Git lo rechaza. El manifiesto registra el commit fuente; por eso la comparación lo
ignora al decidir si el espejo ya está al día.

Publicar sigue requiriendo la aprobación explícita de quien mantiene el proyecto
para el producto, la versión, el destino y la licencia: ejecutar `--push` es ese
acto. No se usan PR porque los espejos no reciben contribuciones propias; los
cambios externos se revisan e incorporan primero en pictos-net. La licencia de un
producto no concede por sí sola derechos de entrenamiento sobre bibliotecas,
participantes o imágenes de proveedores.

Referencia de comportamiento: [schema-evolution.allium](../specs/schema-evolution.allium).
