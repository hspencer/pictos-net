# Prompt Maestro — Trabajo de UI/Diseño
> Copia y pega esto al inicio de cada sesión de Claude Code dedicada a diseño de interfaz.
> Adapta la sección "TAREA" con tu instrucción específica.

---

## PROMPT PARA CLAUDE CODE

```
Antes de responder, lee los siguientes archivos en este orden:
1. docs/UI_MAP.md
2. docs/UI_CONVENTIONS.md

Luego verifica los IDs existentes en App.tsx con:
grep -n 'id="' App.tsx components/**/*.tsx styles/globals.css

---

CONTEXTO DE LA SESIÓN:

Soy el diseñador de PICTOS. Trabajamos en el branch `dev`.
El sistema de diseño está definido en:
- styles/variables.css (tokens de color, espaciado, sombras)
- tailwind.config.js (extensiones de Tailwind)
- styles/globals.css (estilos globales e IDs estructurales)
- docs/UI_CONVENTIONS.md (reglas de nomenclatura y uso)
- docs/UI_MAP.md (mapa completo de la interfaz)

REGLAS OBLIGATORIAS para esta sesión:
1. Toda región nueva debe tener ID semántico según UI_MAP.md
2. No usar valores hardcodeados: usar clases Tailwind o var(--*)
3. No modificar variables.css ni tailwind.config.js sin pedirme confirmación
4. Si creas un ID nuevo, actualiza UI_MAP.md
5. No tocar lógica de estado, servicios, ni storage — solo UI

---

TAREA:

[DESCRIBE AQUÍ TU CAMBIO DE DISEÑO]

Por favor:
a) Identifica el ID semántico de la sección afectada (según UI_MAP.md)
b) Lista los archivos que vas a modificar antes de hacerlo
c) Aplica el cambio respetando todas las reglas anteriores
d) Si agregas IDs nuevos, actualiza UI_MAP.md
```

---

## Ejemplos de tareas bien formuladas

### Para cambiar el header
```
TAREA:
Quiero rediseñar el #toolbar para que tenga menos altura (h-14 en vez de h-20)
y que el #brand-area sea más compacto. El logo debe reducir a 32px.
Ajusta también #globalSettings que depende de top-20.
```

### Para homogeneizar botones
```
TAREA:
Audita todos los botones en App.tsx. Clasifícalos como primario/secundario/icon/destructivo
según UI_CONVENTIONS.md. Luego unifica los que no sigan la convención, sin cambiar
funcionalidad ni IDs existentes.
```

### Para agregar un ID faltante
```
TAREA:
Agrega el ID #home-view al div de viewMode=home en App.tsx,
y el ID #list-view al div de viewMode=list.
Luego actualiza su estado a [OK] en UI_MAP.md.
```

### Para refactorizar un componente visual
```
TAREA:
El área de preview del bitmap en #block-produce tiene un style inline
`style={{ backgroundColor: '#eeeeee' }}`. Reemplázalo con la clase
Tailwind equivalente. Identifica el ID correcto de esa área en UI_MAP.md
(#bitmap-preview, actualmente [PENDING] sin implementar) y agrégalo al div.
```

---

## Workflow recomendado: "captura → análisis → instrucción → captura"

1. Toma screenshot de la sección que quieres cambiar
2. Tráelo a claude.ai (este chat) para analizar el problema de diseño
3. Aquí te ayudo a formular la instrucción precisa con IDs correctos
4. Llevas esa instrucción a Claude Code usando el prompt maestro de arriba
5. Vuelve aquí con el resultado si necesitas feedback visual
