# Consideraciones de Seguridad

## Gestión de API Keys

### Estado Actual (v2.6)

Este proyecto expone la API key de Google Gemini en el código del cliente (navegador). El flujo de deployment actual es:

1. **Desarrollo Local:** La API key se lee desde `.env` local
2. **GitHub Actions:** La key se inyecta desde GitHub Secrets (`GEMINI_API_KEY`) durante el build
3. **Deployment:** El código compilado con la key embebida se publica en GitHub Pages
4. **Producción:** La aplicación en [pictos.net](https://pictos.net) expone la key en el JavaScript bundle

**Implicaciones de seguridad:**

- ✅ La API key **no está** en el repositorio Git
- ✅ Los contribuidores necesitan su propia key para desarrollo local
- ❌ La API key es visible en el código JavaScript compilado en producción
- ❌ Cualquier usuario puede inspeccionar el código y obtener la clave
- ❌ No hay control de rate limiting del lado del servidor
- ❌ La clave podría ser extraída y utilizada en otros proyectos

### Para Desarrollo/Investigación

Esta configuración es **aceptable** para:
- Desarrollo local
- Prototipos de investigación
- Proyectos académicos con acceso público limitado
- Herramientas de investigación lingüística (como PICTOS.NET)
- Despliegues donde el costo de abuso es tolerable

### Deployment Actual

El proyecto se despliega en **GitHub Pages** con dominio personalizado (`pictos.net`) mediante GitHub Actions (`.github/workflows/deploy.yml`). El workflow:

1. Ejecuta el build de Vite con la API key desde GitHub Secrets
2. Compila el código JavaScript con la key embebida
3. Despliega los archivos estáticos a GitHub Pages
4. El archivo `CNAME` configura el dominio personalizado

**Este enfoque es apropiado para:**

- Herramientas de investigación académica
- Despliegues internos de bajo tráfico
- Proyectos donde la conveniencia supera los riesgos de seguridad

### Para Producción Comercial

**NO RECOMENDADO** para aplicaciones comerciales o de alto tráfico. En su lugar:

#### Opción 1: Backend Proxy (Recomendado)

Implementa un servidor backend que actúe como proxy:

```
Cliente → Backend Proxy → Google Gemini API
```

**Ventajas:**
- API key protegida en el servidor
- Control de rate limiting
- Registro de uso
- Autenticación de usuarios
- Control de costos

**Implementación sugerida:**
- Node.js + Express
- Next.js API Routes
- Vercel Serverless Functions
- AWS Lambda

#### Opción 2: Variables de Entorno Protegidas

Para frameworks que soportan secrets del lado del servidor:
- Next.js con Server Components
- SvelteKit con server endpoints
- Remix con loaders

#### Opción 3: API Keys con Restricciones

Si debes usar la key en el cliente:
1. Configura restricciones en Google Cloud Console:
   - Limita por dominio (HTTP referrers)
   - Limita por IP
   - Establece quotas diarias
   - Monitorea el uso constantemente

## Buenas Prácticas

### Configuración del Proyecto

#### Desarrollo Local

1. Copia `.env.example` a `.env`:

   ```bash
   cp .env.example .env
   ```

2. Obtén tu API key personal en [Google AI Studio](https://aistudio.google.com/app/apikey)

3. Edita `.env` y reemplaza `your_gemini_api_key_here` con tu key

4. Ejecuta el servidor de desarrollo:

   ```bash
   npm run dev
   ```

#### GitHub Actions Deployment

La API key para producción se configura como GitHub Secret:

1. Ve a tu repositorio → Settings → Secrets and variables → Actions
2. Crea un secret llamado `GEMINI_API_KEY`
3. El workflow de deployment (`.github/workflows/deploy.yml`) inyecta esta key durante el build

**Importante:** Esta key será embebida en el código JavaScript público. Usa una key con quotas y restricciones apropiadas.

#### Configuración del Dominio Personalizado

El proyecto usa un dominio personalizado (`pictos.net`) configurado mediante:

1. Archivo `/public/CNAME` con el contenido `pictos.net`
2. Configuración DNS apuntando a GitHub Pages
3. Base path en `vite.config.ts` configurado como `/` (raíz del dominio)

Esta configuración permite que todos los assets se carguen correctamente desde el dominio personalizado.

### Variables de Entorno

- ✅ Usa `.env` para desarrollo local
- ✅ Mantén `.env` en `.gitignore` (ya configurado)
- ✅ Proporciona `.env.example` sin valores reales
- ✅ Configura `GEMINI_API_KEY` como GitHub Secret para deployment
- ❌ Nunca comitees archivos `.env` a Git
- ❌ Nunca incluyas keys directamente en el código fuente

### Monitoreo

Para PICTOS.NET v2.6 desplegado en producción:

- Monitorea el uso de la API en [Google AI Studio](https://aistudio.google.com/app/apikey)
- Revisa el dashboard de quotas y límites regularmente
- Configura alertas de uso inusual si Google Cloud lo permite
- Considera rotar las keys periódicamente (cada 3-6 meses)
- Revisa los logs de GitHub Actions para verificar deployments exitosos

### Rotación de Keys

Si sospechas que una key ha sido comprometida o para mantenimiento periódico:

1. Genera una nueva key en [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Actualiza tu archivo `.env` local para desarrollo
3. Actualiza el secret `GEMINI_API_KEY` en GitHub (Settings → Secrets → Actions)
4. Ejecuta un nuevo deployment (push a la rama configurada o workflow manual)
5. Verifica que la aplicación en producción funciona correctamente
6. Revoca la key antigua en Google AI Studio
7. Monitorea el uso de la nueva key durante las primeras 24-48 horas

## Recursos

### Documentación del Proyecto

- [README.md](./README.md) - Instrucciones de setup y desarrollo
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Arquitectura del sistema v2.6
- [.env.example](./.env.example) - Template de variables de entorno

### APIs y Servicios

- [Google AI Studio](https://aistudio.google.com/app/apikey) - Gestión de API keys
- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

### Seguridad General

- [Best Practices para API Keys](https://cloud.google.com/docs/authentication/api-keys)
- [Seguridad en aplicaciones web (OWASP)](https://owasp.org/www-project-top-ten/)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)
