# PictoNet 2.6.1

## Corrección

Se corrige el rechazo `Unauthorized (no valid authorization grant)` de los
trabajos en segundo plano. En 2.6.0 se activó la lectura fuerte de permisos, pero
`connectLambda` de `@netlify/blobs` 10.7.9 omite `url_uncached` al configurar el
almacenamiento. El SDK lanza `BlobsConsistencyError` antes de leer el permiso;
el consumidor lo convierte en un rechazo de autorización.

El adaptador compartido ahora conserva `url_uncached` como `uncachedEdgeURL`,
junto con el sitio y las credenciales entregadas por Netlify. No se cambia el
modelo de consistencia, no se desactiva Identity y no se aumenta ninguna cuota.
El arreglo cubre permisos y otras lecturas fuertes de los workers de Gemini,
OpenAI y Recraft. No modifica bibliotecas, esquemas canónicos ni modelos elegidos.

## Verificación

- Una prueba con el SDK real, sin el bypass de desarrollo, reprodujo el mismo
  error antes del cambio y pasó después. Cubre autorización síncrona y consumo
  por el worker Gemini; las peticiones de red están simuladas.
- Se verifican lecturas fuertes de staging/resultados, rechazo de permisos
  ausentes o vencidos y conservación del contexto de funciones síncronas.
- 198 pruebas unitarias correctas; TypeScript correcto.
- Allium: 0 errores y 0 hallazgos en los cinco archivos revisados, con siete
  advertencias previas. El contrato de autorización queda documentado.

Estas comprobaciones no equivalen a una generación pagada en producción ni
demuestran disponibilidad de Google. La comprobación del despliegue se registra
localmente en `research/`.

## Referencias

- [Adaptador Lambda de Netlify Blobs](https://github.com/netlify/primitives/blob/main/packages/blobs/src/lambda_compat.ts).
- [Consistencia de Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#consistency).

Los enlaces apuntan a documentación mantenida por Netlify; la evidencia del SDK
utilizado está en la dependencia fijada por `package-lock.json` y en la prueba
`netlify/functions/_shared/blobs.test.mjs`.
