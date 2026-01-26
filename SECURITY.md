# Consideraciones de Seguridad

## Gestión de API Keys

### Estado Actual

Este proyecto actualmente expone la API key de Google Gemini en el código del cliente (navegador). Esto significa que:

- La API key es visible en el código JavaScript compilado
- Cualquier usuario puede inspeccionar el código y obtener la clave
- No hay control de rate limiting del lado del servidor
- La clave podría ser extraída y utilizada en otros proyectos

### Para Desarrollo/Investigación

Esta configuración es **aceptable** para:
- Desarrollo local
- Prototipos de investigación
- Proyectos académicos
- Entornos controlados sin acceso público

### Para Producción

**NO RECOMENDADO** para entornos de producción. En su lugar:

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

### Variables de Entorno

- ✅ Usa `.env` para desarrollo local
- ✅ Mantén `.env` en `.gitignore`
- ✅ Proporciona `.env.example` sin valores reales
- ❌ Nunca comitees archivos `.env` a Git
- ❌ Nunca incluyas keys en el código fuente

### Monitoreo

- Revisa regularmente el uso de la API en Google Cloud Console
- Configura alertas de uso inusual
- Rota las keys periódicamente si están expuestas

### Rotación de Keys

Si sospechas que una key ha sido comprometida:

1. Genera una nueva key en Google AI Studio
2. Actualiza tu archivo `.env` local
3. Revoca la key antigua en Google Cloud Console
4. Monitorea el uso de la nueva key

## Recursos

- [Google AI Studio](https://aistudio.google.com/app/apikey)
- [Best Practices para API Keys](https://cloud.google.com/docs/authentication/api-keys)
- [Seguridad en aplicaciones web](https://owasp.org/www-project-top-ten/)
