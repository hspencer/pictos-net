/**
 * TEMPORARY diagnostic endpoint — avatar_url / roles investigation.
 * Reads the GoTrue admin API via the identity context Netlify injects into
 * functions, and reports the stored user_metadata for the researcher's two
 * accounts only. Gated by a random key. DELETE after the investigation.
 */

const DEBUG_KEY = 'pictos-avatar-debug-x7k93qf2mw';
const EMAILS = ['hspencer@ead.cl', 'herbert.spencer@gmail.com'];

export const handler = async (event, context) => {
  if (event.queryStringParameters?.key !== DEBUG_KEY) {
    return { statusCode: 404, body: 'Not found' };
  }

  const identity = context.clientContext?.identity;
  const out = {
    hasIdentityCtx: !!identity,
    identityUrl: identity?.url ?? null,
    hasAdminToken: !!identity?.token,
  };

  if (identity?.token) {
    // Loopback to the custom domain can edge-404 (see _shared/identity.js);
    // try the injected URL first, then the canonical *.netlify.app origin.
    const bases = [identity.url];
    if (process.env.SITE_NAME) {
      bases.push(`https://${process.env.SITE_NAME}.netlify.app/.netlify/identity`);
    }

    for (const base of bases) {
      try {
        const res = await fetch(`${base}/admin/users?per_page=100`, {
          headers: { Authorization: `Bearer ${identity.token}` },
        });
        out.adminStatus = res.status;
        out.adminBase = base;
        if (!res.ok) {
          out.adminBody = (await res.text().catch(() => '')).slice(0, 300);
          continue;
        }
        const data = await res.json();
        out.totalUsers = (data.users ?? []).length;
        out.users = (data.users ?? [])
          .filter(u => EMAILS.includes(u.email))
          .map(u => ({
            email: u.email,
            provider: u.app_metadata?.provider ?? null,
            roles: u.app_metadata?.roles ?? [],
            metaKeys: Object.keys(u.user_metadata ?? {}),
            full_name: u.user_metadata?.full_name ?? null,
            avatar_url: u.user_metadata?.avatar_url ?? null,
            created_at: u.created_at,
            last_login: u.last_login ?? null,
          }));
        break;
      } catch (err) {
        out.adminError = `${base}: ${err.message}`;
      }
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(out, null, 2),
  };
};
