# Arquitectura de datos y privacidad

PICTOS.net es un prototipo de investigación desarrollado como parte de una investigación doctoral en diseño para la Comunicación Aumentativa y Alternativa (CAA). Este documento establece qué datos maneja la plataforma, dónde residen y qué sale de tu dispositivo. Cada afirmación aquí es verificable mediante la inspección de este repositorio.

## Estado de prototipo de investigación

PICTOS.net es un prototipo de investigación público. Actualmente no hay ningún estudio de investigación reclutando participantes a través de este sitio, y no se están recopilando datos de investigación de sus visitantes o usuarios. Si en el futuro la plataforma se utiliza dentro de un estudio formal, la participación estará regida por un protocolo de ética aprobado y un consentimiento informado explícito. Ese estado se indicará aquí, pero el sitio no se usará para reclutar participantes.

## Local por diseño

Todo lo que creas en PICTOS.net (pictogramas, librerías, estado de trabajo) se almacena en tu propio navegador, en tu propio dispositivo, usando IndexedDB y localStorage. No existe una base de datos de contenido de usuarios en el servidor. No hay análisis, no hay cookies publicitarias, no hay rastreadores de terceros, y no hay ningún tipo de perfilado de comportamiento.

La consecuencia práctica: tu trabajo te pertenece, vive contigo, y desaparece cuando limpias el almacenamiento de tu navegador. No existe una copia central.

## Autenticación e identidad

PICTOS.net no tiene una base de datos de usuarios propia. El inicio de sesión existe exclusivamente como mecanismo de verificación humana para evitar la extracción automatizada de los servicios de IA, no para identificar ni perfilar personas, e iniciar sesión no constituye la incorporación a ningún estudio.

La autenticación la realiza Netlify Identity (GoTrue), el servicio de autenticación del proveedor de alojamiento. Puedes iniciar sesión con una cuenta de Google o con un correo electrónico y una contraseña. Al iniciar sesión con Google, el sitio recibe únicamente tu correo electrónico, tu nombre y la URL de tu foto de perfil, tal como los entrega Google; el proyecto no obtiene acceso a tu cuenta de Google ni solicita nada más de ella. Al iniciar sesión con correo, se crea un registro que consiste en tu correo electrónico y una contraseña cifrada. Ese registro de acceso es la única información de identidad que se guarda en un servidor.

Para aplicar el límite diario de generación y acotar el costo de los servicios de IA, el servidor mantiene además un contador técnico de llamadas de generación por correo electrónico, junto con la marca de tiempo, la fase del proceso y el modelo utilizado. Ese registro operacional existe para prevención de abuso y control de costos; no contiene enunciados, ni pictogramas, ni contenido de ningún tipo, no se analiza como dato de investigación y no se usa para contactarte.

El sistema no almacena perfiles, no rastrea sesiones entre visitas, y no construye un historial de comportamiento. Los costos de los servicios de inteligencia artificial son financiados por la cuenta personal del investigador principal; el usuario no paga ni contrae obligación alguna al utilizar la herramienta.

## Qué sale de tu dispositivo

Exactamente dos flujos cruzan el límite de tu dispositivo, ambos visibles en el código fuente.

Primero, las solicitudes de generación. Cuando pides al sistema que produzca un pictograma, el texto que escribiste se envía a las APIs de modelos externos (Anthropic para el análisis lingüístico y la composición; Google Gemini u OpenAI para la generación de imágenes, según el modelo elegido en la herramienta) y el resultado se devuelve a tu navegador. Este es un procesamiento transitorio; el proyecto no retiene nada. No escribas información personal sobre otras personas.

Segundo, el intercambio que tú inicias. Puedes elegir publicar una librería de pictogramas usando un token que tú mismo configuras. Nada se comparte por defecto y nada se comparte en silencio. Las librerías compartidas registran la autoría, el nombre de la librería y la procedencia, de modo que la atribución se preserve y el contenido pueda revisarse o retirarse.

## Soberanía

El principio de diseño detrás de estas decisiones es la soberanía del usuario: la persona que crea materiales de comunicación, y la persona que se comunica a través de ellos, retiene el control sobre ese material. Almacenamiento en tu dispositivo, intercambio solo a tu iniciativa, capacidades de registro bajo tu control, y formatos abiertos (SVG, JSON) que puedes llevar a cualquier lugar en cualquier momento.

## Licencia y auditabilidad

El código fuente está licenciado bajo Apache 2.0. Los pictogramas generados con la herramienta pueden compartirse bajo CC-BY 4.0 a elección del autor. Todo el código base es público en este repositorio: cualquier afirmación de este documento puede verificarse contra el código, y los problemas o preguntas sobre el manejo de datos son bienvenidos a través del rastreador de problemas del repositorio.
