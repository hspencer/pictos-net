# Despliegue en Netlify - Guía Rápida

## ¿Por qué migrar de GitHub Pages a Netlify?

- ✅ Funciones serverless (para proteger GITHUB_TOKEN)
- ✅ Gratis para proyectos open source
- ✅ Configuración en 5 minutos
- ✅ Despliegue automático desde GitHub

## Pasos para Desplegar

### 1. Crear Cuenta en Netlify

1. Ve a https://netlify.com
2. Regístrate con tu cuenta de GitHub (más fácil)

### 2. Importar Proyecto

1. En Netlify dashboard, click "Add new site" → "Import an existing project"
2. Conecta con GitHub
3. Selecciona el repositorio `pictos-net`
4. Netlify detectará automáticamente la configuración de `netlify.toml`
5. Click "Deploy site"

### 3. Configurar Variables de Entorno

Una vez desplegado, configura las variables:

1. En Netlify dashboard → Tu sitio → Site settings
2. Build & deploy → Environment variables
3. Agrega estas variables:
   - `GEMINI_API_KEY` = tu_api_key_de_gemini
   - `GITHUB_TOKEN` = tu_token_de_github (con permisos repo + workflow)

### 4. Re-desplegar

1. Después de agregar las variables, en Deploys → Trigger deploy
2. Click "Deploy site"

### 5. Configurar Dominio (Opcional)

Si quieres usar `pictos.net`:

1. Site settings → Domain management
2. Add custom domain → `pictos.net`
3. Netlify te dará instrucciones para actualizar los DNS

## Verificación

Una vez desplegado:

1. Abre tu sitio (URL tipo: `https://tu-sitio.netlify.app`)
2. Genera un pictograma y evalúalo con score ≥ 4.0
3. Click en el botón verde "Share"
4. Verifica en la consola del navegador:
   ```
   [SHARE] Enviando a función serverless
   [SHARE] Respuesta recibida { status: 200 }
   [SHARE] ✓ Pictograma compartido exitosamente
   ```
5. Verifica que el pictogram-collector recibió el dispatch

## Archivos Creados/Modificados

- ✅ `netlify/functions/share-pictogram.js` - Función serverless
- ✅ `netlify.toml` - Configuración de Netlify
- ✅ `App.tsx` - Actualizado para usar función de Netlify
- ✅ `vite.config.ts` - Removido GITHUB_TOKEN (ya no se expone al cliente)
- ✅ `.env.example` - Actualizado con nota sobre Netlify

## Desarrollo Local

Para probar localmente las funciones de Netlify:

```bash
# Instalar Netlify CLI
npm install -g netlify-cli

# Ejecutar en modo desarrollo
netlify dev
```

Esto levantará el servidor en http://localhost:8888 con las funciones disponibles.

## Troubleshooting

### Error 403 al compartir

- Verifica que `GITHUB_TOKEN` esté configurado en Netlify
- Verifica que el token tenga permisos `repo` + `workflow`
- Verifica que el token sea de una cuenta con acceso al repositorio

### Función no responde

- Revisa los logs en Netlify: Functions → Logs
- Verifica que la función esté en `netlify/functions/share-pictogram.js`

### Build falla

- Verifica que `netlify.toml` esté en la raíz del proyecto
- Verifica que el comando de build sea correcto: `npm run build`

## Configuración en Namecheap para Netlify
### Paso 1: Obtener la URL de Netlify
Primero, necesitas saber tu URL temporal de Netlify:

- Ve a tu sitio en Netlify
- Copia la URL que te dio (algo como: amazing-site-abc123.netlify.app)

### Paso 2: Configurar DNS en Namecheap

En Namecheap → Domain List → Manage → Advanced DNS:

ELIMINA estos 3 registros actuales:

❌ A Record @ → 185.199.108.153
❌ CNAME @ → hspencer.github.io
❌ CNAME www → hspencer.github.io
AGREGA estos nuevos registros:

Type	Host	Value	TTL
CNAME Record	@	tu-sitio.netlify.app	Automatic
CNAME Record	www	tu-sitio.netlify.app	Automatic
⚠️ Importante: Reemplaza tu-sitio.netlify.app con tu URL real de Netlify.

Ejemplo Visual:

┌─────────────┬──────┬─────────────────────────────┬───────────┐
│ Type        │ Host │ Value                       │ TTL       │
├─────────────┼──────┼─────────────────────────────┼───────────┤
│ CNAME       │ @    │ amazing-site-abc123.netlify.app │ Automatic │
│ CNAME       │ www  │ amazing-site-abc123.netlify.app │ Automatic │
└─────────────┴──────┴─────────────────────────────┴───────────┘
### Paso 3: Configurar en Netlify

- Netlify → Site settings → Domain management
- Click "Add custom domain"
- Ingresa: pictos.net
- Click "Verify"
- Netlify detectará que ya configuraste el DNS
- Espera a que Netlify provisione el certificado SSL (5-10 minutos)

### Paso 4: Verificación

Después de 10-30 minutos:

# Verifica que apunte a Netlify
dig pictos.net CNAME +short
# Debería mostrar: tu-sitio.netlify.app
O visita: https://pictos.net

⏱️ Tiempo de Propagación
Namecheap → Netlify: 5-30 minutos (usualmente rápido)
Durante ese tiempo, puede mostrar error SSL o "Site not found" - es normal