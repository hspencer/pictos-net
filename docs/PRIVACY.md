# Arquitectura de datos y privacidad

PICTOS.net es un prototipo de investigación desarrollado como parte de una investigación doctoral en diseño para la Comunicación Aumentativa y Alternativa (CAA). Este documento establece qué datos maneja la plataforma, dónde residen y qué sale de tu dispositivo. Cada afirmación aquí es verificable mediante la inspección de este repositorio.

## Estado de prototipo de investigación

PICTOS.net es un prototipo de investigación público. Actualmente no hay ningún estudio de investigación reclutando participantes a través de este sitio, y no se están recopilando datos de investigación de sus visitantes o usuarios. Si en el futuro la plataforma se utiliza dentro de un estudio formal, la participación estará regida por un protocolo de ética aprobado y un consentimiento informado explícito, y ese estado se anunciará aquí.

## Local por diseño

Todo lo que creas en PICTOS.net (pictogramas, librerías, estado de trabajo) se almacena en tu propio navegador, en tu propio dispositivo, usando IndexedDB y localStorage. No existe una base de datos de contenido de usuarios en el servidor. No hay cuentas de usuario gestionadas por el proyecto, sin análisis, sin cookies publicitarias, sin rastreadores de terceros, y sin ningún tipo de perfilado de comportamiento.

La consecuencia práctica: tu trabajo te pertenece, vive contigo, y desaparece cuando limpias el almacenamiento de tu navegador. No existe una copia central.

## Qué sale de tu dispositivo

Exactamente dos flujos cruzan el límite de tu dispositivo, ambos visibles en el código fuente.

Primero, las solicitudes de generación. Cuando pides al sistema que produzca un pictograma, el texto que escribiste se envía a las APIs de modelos externos (Anthropic para el análisis lingüístico y la composición, Recraft para la generación de SVG) y el resultado se devuelve a tu navegador. Este es un procesamiento transitorio; el proyecto no retiene nada.

Segundo, el intercambio que tú inicias. Puedes elegir publicar una librería de pictogramas usando un token que tú mismo configuras. Nada se comparte por defecto y nada se comparte en silencio. Las librerías compartidas registran la autoría, el nombre de la librería y la procedencia, de modo que la atribución se preserve y el contenido pueda revisarse o retirarse.

## Soberanía

El principio de diseño detrás de estas decisiones es la soberanía del usuario: la persona que crea materiales de comunicación, y la persona que se comunica a través de ellos, retiene el control sobre ese material. Almacenamiento en tu dispositivo, intercambio solo a tu iniciativa, capacidades de registro bajo tu control, y formatos abiertos (SVG, JSON) que puedes llevar a cualquier lugar en cualquier momento.

## Licencia y auditabilidad

El código fuente está licenciado bajo Apache 2.0. Los pictogramas generados con la herramienta pueden compartirse bajo CC-BY 4.0 a elección del autor. Todo el código base es público en este repositorio: cualquier afirmación de este documento puede verificarse contra el código, y los problemas o preguntas sobre el manejo de datos son bienvenidos a través del rastreador de problemas del repositorio.
