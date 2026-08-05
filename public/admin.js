/**
 * Dashboard de uso de PictoNet (/admin.html).
 *
 * Archivo externo porque la CSP del sitio (script-src 'self') bloquea
 * scripts inline y CDNs. El gráfico y el heatmap se dibujan en SVG/HTML
 * puro, sin librerías.
 *
 * Lee api-usage-report (protegido con Bearer ADMIN_API_KEY) de ambos
 * despliegues con UNA sola llamada por dominio (rango from/to agregado
 * en el servidor) y consolida los datos por día, por usuario y por modelo.
 */

const DOMAINS = ['https://pictos.net', 'https://next.pictos.net'];
const DOMAIN_COLORS = ['#40069e', '#7c3aed']; // primary y primary-light
const DAILY_LIMIT = 50; // debe coincidir con DAILY_LIMIT_PER_USER en Netlify
const KEY_STORAGE = 'pictonet_admin_key';
const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// --- Utilidades de fecha -----------------------------------------------------

/** Devuelve un arreglo de fechas YYYY-MM-DD desde hoy hacia atrás (para el eje X del gráfico). */
function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

// --- Capa de datos -----------------------------------------------------------

/**
 * Consulta el reporte agregado de un dominio para todo el rango en una sola
 * llamada. Devuelve null si el dominio falla (p. ej. 500), para que un
 * despliegue roto no impida ver los datos del otro. Se usa en loadData().
 */
async function fetchReport(domain, from, to, key) {
  const res = await fetch(`${domain}/.netlify/functions/api-usage-report?from=${from}&to=${to}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  if (res.status === 401) throw new Error('401');
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function emptyHeatmap() {
  return Array.from({ length: 7 }, () => Array(24).fill(0));
}

/**
 * Descarga el rango completo en paralelo para ambos dominios y consolida:
 * serie diaria por dominio, agregado por usuario, agregado por modelo y
 * heatmap hora×día-de-semana. Se usa en refresh().
 */
async function loadData(days, key) {
  const dates = lastDays(days);
  const from = dates[0];
  const to = dates[dates.length - 1];

  const results = await Promise.all(DOMAINS.map(domain =>
    fetchReport(domain, from, to, key).then(
      data => ({ domain, data }),
      err => { if (err.message === '401') throw err; return { domain, data: null, failed: true }; }
    )
  ));

  const daily = {};        // date -> { hostname -> units }
  const users = {};        // email -> { calls, units, maxDayUnits, phases, domains, errors }
  const models = {};       // modelId -> { calls, units, errors, totalMs, label, phaseLabel, description }
  const heatmap = emptyHeatmap();
  const failedDomains = new Set();

  for (const { domain, data, failed } of results) {
    if (failed) { failedDomains.add(domain); continue; }
    if (!data) continue;
    const host = new URL(domain).hostname;

    for (const [date, d] of Object.entries(data.byDate || {})) {
      daily[date] = daily[date] || {};
      daily[date][host] = (daily[date][host] || 0) + (d.units || 0);
    }

    for (const [email, u] of Object.entries(data.users || {})) {
      const agg = users[email] = users[email] || {
        calls: 0, units: 0, maxDayUnits: 0, phases: {}, domains: new Set(), errors: 0
      };
      agg.calls += u.calls;
      agg.units += u.units;
      // maxDayUnits ya no viene por día del servidor (el rango se agrega de
      // una vez); usamos units de este dominio en el rango como aproximación
      // del peor caso — sigue sirviendo para la barra de "consumo" relativa.
      agg.maxDayUnits = Math.max(agg.maxDayUnits, u.units);
      agg.errors += u.errors || 0;
      agg.domains.add(host);
      for (const [phase, n] of Object.entries(u.phases || {})) {
        agg.phases[phase] = (agg.phases[phase] || 0) + n;
      }
    }

    for (const [modelId, m] of Object.entries(data.models || {})) {
      const agg = models[modelId] = models[modelId] || {
        calls: 0, units: 0, errors: 0, totalMs: 0,
        label: m.label, phaseLabel: m.phaseLabel, description: m.description,
      };
      agg.calls += m.calls;
      agg.units += m.units;
      agg.errors += m.errors;
      agg.totalMs += m.totalMs;
    }

    (data.heatmap || []).forEach((row, weekday) => {
      row.forEach((v, hour) => { heatmap[weekday][hour] += v; });
    });
  }

  for (const m of Object.values(models)) {
    m.avgMs = m.calls > 0 ? Math.round(m.totalMs / m.calls) : 0;
  }

  return { dates, daily, users, models, heatmap, failedDomains };
}

// --- Render: gráfico SVG (unidades por día) ----------------------------------

/**
 * Dibuja un gráfico de barras apiladas (unidades por día, por dominio)
 * en SVG puro — la CSP impide cargar Chart.js desde un CDN.
 * Se usa en refresh().
 */
function renderChart(dates, daily) {
  const hosts = DOMAINS.map(d => new URL(d).hostname);
  const W = 960, H = 240, PAD_L = 36, PAD_B = 24, PAD_T = 10;
  const plotW = W - PAD_L - 8, plotH = H - PAD_T - PAD_B;

  const totals = dates.map(d => hosts.reduce((s, h) => s + (daily[d]?.[h] || 0), 0));
  const maxY = Math.max(4, ...totals);
  const barW = Math.min(40, (plotW / dates.length) * 0.7);
  const step = plotW / dates.length;

  const svgEl = (tag, attrs, text) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Unidades por día y dominio' });

  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const yVal = Math.round(maxY * i / ticks);
    const y = PAD_T + plotH - (plotH * i / ticks);
    svg.appendChild(svgEl('line', { x1: PAD_L, y1: y, x2: W - 8, y2: y, stroke: '#e2e8f0', 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: PAD_L - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#94a3b8' }, yVal));
  }

  dates.forEach((date, i) => {
    const x = PAD_L + step * i + (step - barW) / 2;
    let yCursor = PAD_T + plotH;
    hosts.forEach((host, hi) => {
      const v = daily[date]?.[host] || 0;
      if (v === 0) return;
      const h = (v / maxY) * plotH;
      yCursor -= h;
      const rect = svgEl('rect', { x, y: yCursor, width: barW, height: h, rx: 2, fill: DOMAIN_COLORS[hi] });
      rect.appendChild(svgEl('title', {}, `${date} · ${host}: ${v} unidades`));
      svg.appendChild(rect);
    });
    const every = dates.length > 16 ? 3 : dates.length > 8 ? 2 : 1;
    if (i % every === 0) {
      svg.appendChild(svgEl('text', {
        x: x + barW / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#94a3b8'
      }, date.slice(5)));
    }
  });

  const box = document.getElementById('chart');
  box.innerHTML = '';
  box.appendChild(svg);

  document.getElementById('chart-legend').innerHTML = hosts.map((h, i) =>
    `<span><span class="dot" style="background:${DOMAIN_COLORS[i]}"></span>${h}</span>`
  ).join('');
}

// --- Render: heatmap hora × día de semana ------------------------------------

/**
 * Pinta la concentración de llamadas por hora (UTC) y día de la semana como
 * una grilla de celdas coloreadas por intensidad. Se usa en refresh().
 */
function renderHeatmap(heatmap) {
  const max = Math.max(1, ...heatmap.flat());
  const cellColor = (v) => {
    if (v === 0) return 'rgba(64, 6, 158, 0.05)';
    return `rgba(64, 6, 158, ${(0.15 + 0.85 * (v / max)).toFixed(2)})`;
  };

  let html = '<table class="heatmap"><thead><tr><th></th>';
  for (let h = 0; h < 24; h++) html += `<th>${h}</th>`;
  html += '</tr></thead><tbody>';
  WEEKDAY_LABELS.forEach((label, weekday) => {
    html += `<tr><td class="wd">${label}</td>`;
    heatmap[weekday].forEach((v, hour) => {
      html += `<td style="background:${cellColor(v)}" title="${label} ${hour}:00 UTC — ${v} llamadas"></td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('heatmap-box').innerHTML = html;
}

// --- Render: tabla por modelo -------------------------------------------------

/**
 * Pinta la tabla de modelos con su descripción (fase del pipeline, para qué
 * sirve), conteo de llamadas/unidades, latencia media y tasa de error.
 * Se usa en refresh().
 */
function renderModelTable(models) {
  const rows = Object.entries(models).sort((a, b) => b[1].calls - a[1].calls);
  const tbody = document.getElementById('model-rows');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Sin actividad registrada en el rango.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(([modelId, m]) => {
    const errPct = m.calls > 0 ? Math.round((m.errors / m.calls) * 100) : 0;
    return `<tr>
      <td><strong>${m.label || modelId}</strong></td>
      <td>${m.phaseLabel || '—'}</td>
      <td class="muted">${m.description || ''}</td>
      <td class="num">${m.calls}</td>
      <td class="num">${m.units}</td>
      <td class="num">${m.avgMs} ms</td>
      <td class="num">${errPct}%</td>
    </tr>`;
  }).join('');
}

// --- Render: tabla por usuario -------------------------------------------------

/**
 * Pinta la tabla de usuarios ordenada por unidades consumidas.
 * La columna de consumo muestra el peor día respecto al tope diario,
 * que es lo relevante para detectar abuso. Se usa en refresh().
 */
function renderTable(users) {
  const rows = Object.entries(users).sort((a, b) => b[1].units - a[1].units);
  const tbody = document.getElementById('user-rows');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">Sin actividad registrada en el rango.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(([email, u]) => {
    const pct = Math.min(100, Math.round(u.maxDayUnits / DAILY_LIMIT * 100));
    const cls = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : '';
    const phases = Object.entries(u.phases).map(([p, n]) => `<span class="pill">${p}: ${n}</span>`).join('');
    return `<tr>
      <td>${email}</td>
      <td class="num">${u.calls}</td>
      <td class="num">${u.units}</td>
      <td><div class="bar ${cls}" title="${u.maxDayUnits}/${DAILY_LIMIT} en su peor día"><div style="width:${pct}%"></div></div></td>
      <td>${phases}</td>
      <td>${[...u.domains].join(', ')}</td>
      <td class="num">${u.errors}</td>
    </tr>`;
  }).join('');
}

// --- Orquestación ------------------------------------------------------------

/**
 * Carga completa: KPIs, gráfico, heatmap, tabla de modelos, tabla de
 * usuarios y avisos de dominios caídos. Se usa al entrar, al cambiar el
 * rango y con el botón Actualizar.
 */
async function refresh() {
  const key = sessionStorage.getItem(KEY_STORAGE);
  if (!key) return logout();
  const days = parseInt(document.getElementById('range').value, 10);
  const status = document.getElementById('status');
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;
  status.textContent = 'Cargando…';
  try {
    const { dates, daily, users, models, heatmap, failedDomains } = await loadData(days, key);

    const totals = Object.values(users).reduce(
      (t, u) => ({ calls: t.calls + u.calls, units: t.units + u.units, errors: t.errors + u.errors }),
      { calls: 0, units: 0, errors: 0 }
    );
    document.getElementById('kpi-calls').textContent = totals.calls;
    document.getElementById('kpi-units').textContent = totals.units;
    document.getElementById('kpi-users').textContent = Object.keys(users).length;
    document.getElementById('kpi-errors').textContent = totals.errors;

    renderChart(dates, daily);
    renderHeatmap(heatmap);
    renderModelTable(models);
    renderTable(users);

    document.getElementById('domain-errors').innerHTML = [...failedDomains]
      .map(d => `<div class="domain-fail">Sin respuesta de ${new URL(d).hostname} — datos parciales.</div>`)
      .join('');
    status.textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    if (err.message === '401') return logout('Clave inválida o revocada.');
    status.textContent = 'Error al cargar datos.';
  } finally {
    btn.disabled = false;
  }
}

// --- Autenticación -----------------------------------------------------------

/**
 * Valida la clave contra el endpoint del propio origen (hoy) y, si
 * responde 200, la guarda en sessionStorage y muestra el dashboard.
 * Se usa en el botón Entrar.
 */
async function login() {
  const key = document.getElementById('apikey').value.trim();
  const errEl = document.getElementById('login-error');
  if (!key) { errEl.textContent = 'Ingresa la clave.'; return; }
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  errEl.textContent = '';
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Valida contra el origen actual: funciona igual en pictos.net y next
    const res = await fetch(`/.netlify/functions/api-usage-report?date=${today}`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (res.status === 401) { errEl.textContent = 'Clave incorrecta.'; return; }
    sessionStorage.setItem(KEY_STORAGE, key);
    document.getElementById('login').classList.add('hidden');
    document.getElementById('dash').classList.remove('hidden');
    refresh();
  } catch {
    errEl.textContent = 'No se pudo conectar.';
  } finally {
    btn.disabled = false;
  }
}

/**
 * Cierra la sesión local (borra la clave de sessionStorage).
 * Se usa en el botón Salir y ante respuestas 401.
 */
function logout(message) {
  sessionStorage.removeItem(KEY_STORAGE);
  document.getElementById('dash').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
  if (message) document.getElementById('login-error').textContent = message;
}

// --- Eventos -----------------------------------------------------------------
document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('apikey').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
document.getElementById('btn-refresh').addEventListener('click', refresh);
document.getElementById('range').addEventListener('change', refresh);
document.getElementById('btn-logout').addEventListener('click', () => logout());
document.getElementById('limit-label').textContent = DAILY_LIMIT;

// Si ya hay clave en la sesión, entra directo.
if (sessionStorage.getItem(KEY_STORAGE)) {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('dash').classList.remove('hidden');
  refresh();
}
