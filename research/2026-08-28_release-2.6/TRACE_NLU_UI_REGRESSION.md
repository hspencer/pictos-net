# TRAZAR bloqueado por validación NLU: diagnóstico y prueba local

Fecha: 2026-08-28. Base publicada: 351a1d8 (2.6.1). Esta corrección está **sin publicar y sin commit**, para revisión local.

## Causa confirmada

El retorno anticipado de `components/SVGGenerator.tsx` reemplazaba todo el espacio de trabajo cuando `canStructureSVG` rechazaba el NLU. Esa validación corresponde a ESTRUCTURAR (fase 5), pero también ocultaba el SVG geométrico recién trazado y sus controles. El bloque no borraba el trazado: impedía acceder a él. Además mostraba literalmente el error inglés del validador.

TRAZAR convierte un bitmap en geometría mediante VTracer. No necesita NLU. ESTRUCTURAR vincula la geometría con la composición y el NLU para construir una revisión MF-SVG canónica; allí sí corresponde exigir contratos válidos.

## Evidencia de la fila reportada

Biblioteca: `public/libraries/escena_descriptiva_graph_2026-08-26.json`.
Frase: «Abro la app de delivery en mi teléfono».

El NLU histórico incumple cinco enumeraciones del perfil de generación vigente:

- `/metadata/speech_act`: «Asserción de acción».
- `/metadata/intent`: una descripción libre en español.
- `/pragmatics/formality`: «coloquial».
- `/pragmatics/expected_response`: una descripción libre en español.
- `/visual_guidelines/temporal`: una descripción libre en español.

El editor mostraba la primera opción de ciertos selectores aunque el dato almacenado no perteneciera a sus opciones. También ofrecía intenciones incompatibles con el contrato actual. Ahora muestra el valor histórico con aviso de revisión y obtiene las opciones de acto de habla e intención directamente del esquema. No se normalizó ni reemplazó la evidencia semántica.

## Corrección

- Contrato Allium `GeometricEditingBoundary`: separación entre acceso geométrico y admisión semántica.
- SVG y controles de editar, descargar y retrazar permanecen accesibles aunque NLU o composición sean inválidos.
- Solo ESTRUCTURAR queda deshabilitado; diagnóstico localizado con fase y rutas JSON que requieren revisión.
- Un error de estructuración conserva el trazado y sus controles.
- Pruebas del componente real, ambos diseños y ambos idiomas, con NLU histórico incompatible o ausente.

## Verificación realizada

Origen de prueba separado: http://127.0.0.1:3002/. Se abrió una copia local de la biblioteca comunitaria; no se operó sobre la biblioteca original del usuario.

1. TRAZAR con VTracer real: 705 trazados, 511 KB; Aplicar conserva SVG y controles.
2. Re-trazar vuelve a abrir VTracer y termina nuevamente; Aplicar conserva acceso.
3. Editar SVG trazado abre el editor con la geometría; se cerró sin guardar cambios.
4. Vista enfocada → Formatear y Ajustar conserva SVG, editor, descarga y retrazado; ESTRUCTURAR muestra el diagnóstico específico.
5. La recarga conserva el trazado. Los selectores muestran los valores históricos reales.
6. 202 pruebas unitarias sin proveedores: todas pasan. Contratos: 5 NLU, 4 composición, 9 MF-SVG; sincronización de contratos embebidos correcta.
7. TypeScript, i18n (789 claves) y compilación Vite correctos. `allium check` y `allium analyse`: sin errores ni findings; persisten advertencia de origen externo de Editor y aviso de campo no usado. La compilación conserva advertencias previas de tamaño de bundles.

Biblioteca fuente sin cambios respecto de HEAD: blob Git `ecf9b9f2e0e27ed6993c182e4f9762d2edaea9e6`; SHA-256 `b2e13724274ce9c703866d476cab361a417af3db621f701c048435df6ac17b4b`.

No se hicieron llamadas de generación IA ni se consumieron créditos. No se verificó generación semántica con proveedores ni se afirmó que el NLU histórico ya esté reparado. Este registro y la carpeta research permanecen excluidos de Git.

## Pendientes separados

- Revisión humana antes de commit, incremento de versión y despliegue.
- La migración semántica de bibliotecas históricas requiere decisiones explícitas y preservar su procedencia; no debe inventar equivalencias silenciosas.
- Al alternar el idioma de la interfaz, algunas filas memorizadas conservan el idioma anterior hasta recargar. Detectado durante la prueba; el mensaje nuevo sí tiene ambas traducciones. No se amplió esta corrección a la actualización global del idioma.
