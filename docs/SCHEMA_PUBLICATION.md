# Exportación independiente de esquemas

## Autoridad y alcance

`schemas/nlu-schema`, `schemas/pictogram-composition-schema` y
`schemas/mf-svg-schema` son las fuentes
canónicas. Los productos evolucionan con la evidencia empírica de PictoNet y se
comitean aquí. Los repositorios de `mediafranca` reciben propuestas de exportación;
no sustituyen automáticamente la fuente local. No usamos submódulos.

El exportador **solo escribe un directorio local nuevo**, fuera del repositorio.
Nunca crea repositorios, commits, tags, PRs ni pushes. El antiguo publicador que
reemplazaba el contenido remoto fue retirado. `publish-schema.sh` ahora delega al
exportador local y requiere los mismos argumentos nuevos.

## Preview del trabajo actual

Desde la raíz de PictoNet:

```sh
node scripts/export-schema.mjs preview nlu-schema
node scripts/export-schema.mjs preview pictogram-composition-schema
node scripts/export-schema.mjs preview mf-svg-schema
```

Se imprimen las rutas temporales y el hash del contenido. Puede usarse
`--output /tmp/mi-preview-nlu` si el directorio no existe. La preview puede incluir
cambios sin commit; el manifiesto registra `mode: preview`, el commit base y si el
repositorio tiene cambios. Siempre lleva `release: false` y `validation: not-run`.
**No afirma que esos bytes estén contenidos en el commit base.**

## Instantánea reproducible de un commit

```sh
node scripts/export-schema.mjs committed nlu-schema --ref <SHA-completo>
node scripts/export-schema.mjs committed pictogram-composition-schema --ref <SHA-completo>
node scripts/export-schema.mjs committed mf-svg-schema --ref <SHA-completo>
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

Ejecutar en **cada directorio exportado**, no solo en PictoNet:

```sh
npm ci --ignore-scripts
npm test
```

`npm ci` requiere el lockfile del producto y acceso al registro si las dependencias
no están en caché. No copiar `node_modules` de PictoNet ni depender de sus archivos
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
Para `mf-svg-schema` se admiten únicamente estos recursos heredados adicionales:
`requirements.txt`, `schemas/metadata.schema.json`, `schemas/styles.css`,
`tools/validator.py`, `examples/canonical.svg` y `examples/v2example.svg`. No es una
autorización general para exportar carpetas de SVGs, programas Python u otros datos.
No incluye bibliotecas de PictoNet, corpus, `.env`, dependencias ni directorios Git.
Se rechazan symlinks y marcadores reconocibles de credenciales en archivos admitidos.
Los nombres de archivo no se ejecutan como comandos. La revisión humana sigue
siendo necesaria: ningún detector puede demostrar la ausencia de cualquier dato
personal o secreto incrustado en documentación o ejemplos.

`npm run copy-schemas` tiene otro propósito: copia solo contratos JSON públicos
para servirlos con la app, incluidos los contratos de `mf-svg-schema` y su
contrato histórico 1.0 en la ruta anidada original. No borra otros archivos
públicos. No es una publicación ni una exportación del corpus.

CI ejecuta las pruebas de los tres productos, todas las suites locales de
`scripts/*.test.mjs` (incluida la auditoría del corpus) y exporta los tres desde
el commit probado para instalarlos y verificarlos de forma independiente.
El producto SVG incorpora snapshots de los contratos NLU y composición; su
comprobación de sincronización en PictoNet debe pasar antes de preparar una
exportación, aunque las pruebas exportadas funcionen sin el monorepo.

## Publicación posterior: aprobación obligatoria

1. Acordar licencia, visibilidad y autorización para cada producto/revisión.
2. Verificar de nuevo permisos, rama predeterminada y commit remoto actual.
3. Preparar el cambio como descendiente de ese commit remoto existente.
   Conservar archivos exclusivos del repositorio remoto hasta revisarlos expresamente.
4. Revisar diff y manifiesto, ejecutar pruebas aisladas y crear un PR autorizado.
   Si la rama remota avanzó, detenerse y revisar el cambio; nunca usar force push.
5. Tras revisión, versionar el producto y conservar relación entre release,
   commit de PictoNet, commit publicado y hashes.

Este flujo conserva el historial independiente de NLU. Para composición, crear
un repositorio nuevo requiere autorización expresa; no lo hace el exportador.
La automatización de PRs y releases queda pendiente. La licencia del producto no
concede por sí sola derechos de entrenamiento sobre bibliotecas, participantes o
imágenes de proveedores.

Referencia de comportamiento: [schema-evolution.allium](../specs/schema-evolution.allium).
