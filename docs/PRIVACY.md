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

Para aplicar el límite diario de generación y acotar el costo de los servicios de IA, el servidor mantiene además un contador diario de unidades por correo electrónico y un registro de auditoría de cada llamada a un modelo (`logCall` en `netlify/functions/_shared/usage.js`). Cada entrada guarda el correo, la marca de tiempo, la fase, el modelo, las unidades cobradas, la duración, el número de tokens, si la llamada tuvo éxito, identificadores técnicos de la solicitud y, si falló, un resumen técnico del error. Ese registro operacional existe para prevención de abuso y control de costos; no contiene enunciados, prompts, pictogramas ni imágenes, no se analiza como dato de investigación y no se usa para contactarte.

El sistema no almacena perfiles, no rastrea sesiones entre visitas, y no construye un historial de comportamiento. Los costos de los servicios de inteligencia artificial son financiados por la cuenta personal del investigador principal; el usuario no paga ni contrae obligación alguna al utilizar la herramienta.

## Qué sale de tu dispositivo

Solo las solicitudes de generación cruzan el límite de tu dispositivo con contenido tuyo, y todas pasan por las funciones del sitio (Netlify Functions), que las reenvían al proveedor sin conservarlas. Según la fase:

- **COMPRENDER y COMPONER**: el enunciado y el contexto configurado (idioma, región, dominio) van a OpenAI por defecto (GPT-6 Luna) o a Anthropic si eliges Claude Haiku 5.5.
- **PRODUCIR**: el prompt de imagen, que incluye el enunciado, los elementos de la composición y el estilo visual, va a OpenAI, a Google (Vertex AI), a Recraft o a Quiver, según el modelo elegido.
- **ESTRUCTURAR**, cuando lo pides: al estructurar desde el bitmap, la imagen, el enunciado y los nombres de los elementos van primero a Google (Vertex AI) para detectar dónde está dibujado cada uno; luego la imagen original, una copia rasterizada con marcas numeradas, el árbol de elementos y la descripción de las regiones trazadas van a Anthropic. Al estructurar un trazado o un SVG nativo van a Anthropic las imágenes rasterizadas, el árbol de elementos y el código fuente del SVG (hasta 10.000 caracteres).

La imagen generada en PRODUCIR queda en el almacenamiento del sitio solo hasta que tu navegador la recoge; en ese momento se borra. Lo mismo ocurre con los datos de entrada de un trabajo en segundo plano. No escribas información personal sobre otras personas.

Si escribes una ciudad en el contexto geográfico de la configuración, ese texto se envía al servicio público Nominatim de OpenStreetMap para sugerir lugares.

Las grabaciones de audio de los tableros se guardan solo en tu navegador y no se envían a ningún servidor. Exportar una librería, un respaldo o un PDF produce un archivo en tu dispositivo; nada se publica. La aplicación no ofrece hoy ninguna forma de compartir pictogramas o librerías con un servidor: la función `share-pictogram` existe en el código, pero ningún flujo de la interfaz la llama.

La API de máquina v1 (`/api/v1/*`) es un servicio entre servidores para otros sistemas; no la usa tu navegador y no recibe nada de tu dispositivo.

## Soberanía

El principio de diseño detrás de estas decisiones es la soberanía del usuario: la persona que crea materiales de comunicación, y la persona que se comunica a través de ellos, retiene el control sobre ese material. Almacenamiento en tu dispositivo, grabaciones bajo tu control, y formatos abiertos (SVG, JSON) que puedes llevar a cualquier lugar en cualquier momento.

## Licencia y auditabilidad

El código fuente está licenciado bajo Apache 2.0. Los pictogramas generados con la herramienta pueden compartirse bajo CC-BY 4.0 a elección del autor. Todo el código base es público en este repositorio: cualquier afirmación de este documento puede verificarse contra el código, y los problemas o preguntas sobre el manejo de datos son bienvenidos a través del rastreador de problemas del repositorio.

*Actualizado el 12 de noviembre de 2026.*
