# PictoNet 2.6.3

## Coherencia con el expediente de bioética

El texto visible de la aplicación y la documentación de privacidad ya no afirman
que el sitio recluta participantes ni que la persona que inicia sesión forma
parte de un estudio.

- El bloque «Colaborar» del pie y el modal asociado pasan a llamarse «Contacto».
  Se eliminó la invitación a evaluar pictogramas y la frase sobre participar en
  el estudio; en su lugar se declara que ningún estudio recluta a través de este
  sitio.
- El aviso de límite diario deja de atribuir la cuota a «participantes del
  proyecto» y la expresa como máximo por día.
- El pie declara la licencia Apache 2.0, que es la del archivo `LICENSE`. Antes
  declaraba MIT.
- La auditoría del pictograma pasa a llamarse registro de ediciones en etiqueta,
  título, descripción vacía y ayudas contextuales.
- `docs/PRIVACY.md` y `docs/PRIVACY_en.md` describen la autenticación tal como
  está implementada: Netlify Identity (GoTrue), acceso con cuenta de Google o
  con correo y contraseña, y los datos que Google entrega en el primer caso.

La sección de autenticación afirmaba que el registro de acceso «no registra
uso». Eso no era exacto: `netlify/functions/_shared/usage.js` mantiene un
contador diario por correo en `quota/{email}/{fecha}` y una entrada por llamada
en `audit/{fecha}/{ts}-{email}` con fase, modelo y marca de tiempo. El texto
ahora declara ese registro operacional, su propósito de control de abuso y
costo, y que no contiene enunciados ni pictogramas. Quien cite estos documentos
como texto literal debe citar la versión corregida.

## Idioma de la pantalla de acceso

El widget de Netlify Identity se inicializaba sin locale, de modo que el
formulario de acceso aparecía en inglés aunque la interfaz estuviera en español.

- `init()` recibe el locale derivado de la preferencia de interfaz y se vuelve a
  fijar con `setLocale()` antes de abrir el diálogo, de modo que un cambio de
  idioma posterior a la carga también alcanza al widget.
- `getLocale()` se expone desde `useTranslation` y reemplaza la lectura
  duplicada de `localStorage` en `AuthGate`.
- El aviso previo al acceso recomendaba un botón «Iniciar sesión con Google» que
  no existe: el widget lo rotula «Continúa con Google». El aviso ahora coincide.
- Se corrigieron las tildes ausentes en los textos de acceso en es-419.

## Verificación

- 214 pruebas unitarias: 209 correctas, cinco omitidas, ninguna fallida.
- TypeScript y compilación completa correctos. Persisten las advertencias
  previas de tamaño de bundle.
- 810 claves i18n con paridad entre catálogos y uso en código.
- Cobertura del locale `es` del widget comprobada contra su propio código fuente
  (sourcemap de `netlify-identity-widget` 2.0.3): 39 de 39 claves presentes, sin
  recurso al inglés, incluidos los mensajes de error de GoTrue.

Quedan dos limitaciones en el widget, ajenas a este repositorio: la etiqueta
«Close» del botón de cierre está fija en inglés para lectores de pantalla, y los
errores del servidor fuera de los cuatro previstos se muestran sin traducir.

No se verificó la pantalla de acceso en navegador: la interfaz de autenticación
está oculta en desarrollo, por lo que la comprobación es estática y no un
registro de ejecución.
