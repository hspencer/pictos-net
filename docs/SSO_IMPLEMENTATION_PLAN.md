# Plan de Implementacion SSO + Proxy API

> **Estado: Implementado.** Este plan fue ejecutado y está en producción. El proxy con Netlify Identity, JWT y Google SSO está activo. Se conserva como referencia histórica. Para el estado actual, ver [ARCHITECTURE.md](./ARCHITECTURE.md) y [SECURITY.md](./SECURITY.md).

## Resumen

Mover las llamadas a servicios de IA desde el cliente a Netlify Functions (proxy),
protegidas por autenticacion via Netlify Identity con Google SSO.

## Arquitectura actual vs. propuesta

### Hoy (inseguro)
```
Browser ---[API_KEY embebida en JS]---> Gemini API
```

### Propuesto
```
Browser ---> Login Google (Netlify Identity)
Browser --[JWT]---> Netlify Function (proxy)
Netlify Function --[GEMINI_API_KEY server-side]---> Gemini API
```

## Alcance del cambio

### Netlify Functions a crear (4 endpoints)

Cada funcion recibe el JWT del usuario, lo valida, y hace la llamada a Gemini:

| Funcion | Reemplaza | Parametros del cliente |
|---|---|---|
| `api-generate-nlu` | `Gemini.generateNLU()` | utterance, config parcial |
| `api-generate-blueprint` | `Gemini.generateVisualBlueprint()` | nlu, config parcial |
| `api-generate-prompt` | `Gemini.generateSpatialPrompt()` | nlu, elements, config parcial |
| `api-generate-image` | `Gemini.generateImage()` | elements, prompt, row parcial, config parcial |
| `api-structure-svg` | `structureSVG()` | rawSvg, bitmap, nlu, elements, utterance, config parcial |

### Cambios en el frontend

1. **Nuevo servicio**: `services/apiClient.ts` - wrapper que agrega JWT a cada request
2. **Modificar**: `services/geminiService.ts` - las funciones exportadas llaman al proxy en vez de a Gemini directo
3. **Modificar**: `services/svgStructureService.ts` - `structureSVG()` llama al proxy
4. **Eliminar**: `process.env.API_KEY` de `vite.config.ts` (ya no se necesita en el cliente)
5. **Nuevo componente**: `components/AuthGate.tsx` - wrapper de login/logout
6. **Modificar**: `App.tsx` - envolver la app en AuthGate

### Archivos que NO cambian

- Toda la logica de UI (componentes, stores, hooks)
- Los tipos (`types.ts`)
- Las librerias SVG, el editor, VTracer

## Pasos de implementacion

### Paso 1: Lo que debe hacer Herbert en Netlify Dashboard

**Site: pictos-next.netlify.app**

#### 1.1 Habilitar Netlify Identity

1. Ir a **Site settings > Identity**
2. Click **Enable Identity**
3. En **Registration preferences**: seleccionar **Invite only** (para controlar acceso)
4. En **External providers**: click **Add provider > Google**
   - Dejar "Use default configuration" (Netlify provee OAuth app propia)
   - Si quieres restringir a un dominio (ej: `ead.cl`), no se puede desde aqui;
     lo haremos por codigo en las funciones

#### 1.2 Configurar variables de entorno

1. Ir a **Site settings > Environment variables**
2. Agregar (o verificar que exista):
   - `GEMINI_API_KEY` = tu API key de Gemini
3. Scope: **Functions** (no necesita estar en Build)
4. NO agregar `GITHUB_TOKEN` por ahora (share-pictogram no funciona)

#### 1.3 Configurar branch deploys

1. Ir a **Site settings > Build & deploy > Branches and deploy contexts**
2. Verificar que **Branch deploys** incluya `lab`
3. El deploy de `lab` sera accesible en `lab--pictos-next.netlify.app` o similar

#### 1.4 Habilitar Netlify Identity en el sitio de prueba

- La identidad es por site, no por branch. Al habilitarla en el site
  `pictos-next.netlify.app`, funciona para todos los branch deploys.

### Paso 2: Lo que hago yo en codigo

#### 2.1 Crear branch `sso` desde `dev`

```bash
git checkout dev
git checkout -b sso
```

#### 2.2 Netlify Functions (proxy)

Crear en `netlify/functions/` las 5 funciones proxy. Cada una:
- Extrae y valida el JWT de Netlify Identity (`Authorization: Bearer <token>`)
- Lee `process.env.GEMINI_API_KEY` (server-side, nunca expuesta)
- Llama a Gemini con `@google/genai`
- Retorna el resultado al cliente

Estructura de cada funcion:
```javascript
// netlify/functions/api-generate-nlu.js
const { GoogleGenAI } = require("@google/genai");

exports.handler = async (event, context) => {
  // 1. Validar JWT
  const { identity, user } = context.clientContext || {};
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  // 2. Parsear body
  const { utterance, config } = JSON.parse(event.body);

  // 3. Llamar a Gemini con key server-side
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // ... logica de generateNLU ...

  // 4. Retornar resultado
  return { statusCode: 200, body: JSON.stringify(result) };
};
```

#### 2.3 Cliente: apiClient.ts

```typescript
// services/apiClient.ts
import netlifyIdentity from "netlify-identity-widget";

const API_BASE = "/.netlify/functions";

export async function apiCall<T>(endpoint: string, body: object): Promise<T> {
  const user = netlifyIdentity.currentUser();
  const token = user?.token?.access_token;

  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }

  return res.json();
}
```

#### 2.4 Modificar geminiService.ts y svgStructureService.ts

Las funciones exportadas dejan de instanciar `GoogleGenAI` y en vez llaman a `apiCall()`:

```typescript
// Antes:
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });
export const generateNLU = async (...) => {
  const ai = getAI();
  // ... llamada directa a Gemini
};

// Despues:
import { apiCall } from "./apiClient";
export const generateNLU = async (...) => {
  return apiCall<NLUData>("api-generate-nlu", { utterance, config });
};
```

#### 2.5 Eliminar API key del bundle

En `vite.config.ts`, eliminar:
```typescript
define: {
  'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),      // BORRAR
  'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY) // BORRAR
}
```

#### 2.6 AuthGate component

```typescript
// components/AuthGate.tsx
import netlifyIdentity from "netlify-identity-widget";

// Inicializar una vez
netlifyIdentity.init();

// Componente que muestra login o la app
```

#### 2.7 Actualizar netlify.toml

- Agregar security headers
- Restringir CORS a pictos.net / pictos-next.netlify.app

### Paso 3: Testing en lab

```bash
git checkout lab
git merge sso
git push origin lab
```

Verificar en `pictos-next.netlify.app`:
- [ ] Login con Google funciona
- [ ] Llamadas a Gemini pasan por las funciones proxy
- [ ] No hay API key en el bundle JS (verificar en DevTools > Sources)
- [ ] Sin login, la app muestra pantalla de autenticacion
- [ ] Logout funciona y bloquea las llamadas

### Paso 4: Merge a produccion

```bash
git checkout dev && git merge sso
git checkout main && git merge dev
git push origin main
```

Repetir la configuracion de Identity en el site de produccion (`pictos.net`).

## Dependencias npm nuevas

```bash
npm install netlify-identity-widget
```

Solo en el frontend. Las funciones de Netlify usan `@google/genai` que
se instala como dependencia del proyecto (ya existe en package.json).

## Consideraciones

### Limitaciones de Netlify Functions
- Timeout: 10 segundos (tier gratuito), 26s (Pro)
- `generateImage` puede tardar mas; evaluar si necesitamos Netlify Background Functions (suffix `-background`)
- Payload max: 6MB (suficiente para nuestros casos)

### Desarrollo local
- `netlify dev` levanta las funciones localmente y simula Identity
- Agregar `GEMINI_API_KEY` al archivo `.env` (ya existe)
- El widget de Identity funciona en localhost con `netlify dev`

### Rollback
- Si algo falla, el branch `dev` sigue funcionando con la key en el cliente
- La rama `sso` es independiente y no afecta produccion
