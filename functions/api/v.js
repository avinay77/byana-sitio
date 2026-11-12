// /api/v — aviso de visita que manda el sitio (una vez por visita, o de nuevo si vio más productos).
// No guarda IP ni cookies: solo una huella del día (HMAC de día + IP + navegador) para contar personas distintas ese día.
import { TOPE_DIA, DIAS_CRUDO, diaMX, esBot, aparato, fuente, huella } from "../../lib/visitas.js";

const nada = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
const lista = (a, n) => Array.isArray(a) ? [...new Set(a.filter(x => typeof x === "string" && /^[\w-]{1,24}$/.test(x)))].slice(0, n) : [];

// Contador aproximado por día en la caché de Cloudflare (no gasta escrituras de KV) para no pasar el tope.
async function hayCupo(dia) {
  try {
    const c = caches.default, k = new Request(`https://byana.mx/__visitas/${dia}`);
    const r = await c.match(k);
    const n = r ? Number(await r.text()) || 0 : 0;
    if (n >= TOPE_DIA) return false;
    await c.put(k, new Response(String(n + 1), { headers: { "Cache-Control": "max-age=172800" } }));
  } catch {}
  return true;
}

export async function onRequestPost({ request, env }) {
  if (!env.BYANA) return nada();
  const ua = request.headers.get("User-Agent") || "";
  if (esBot(ua)) return nada();
  let b; try { b = JSON.parse(await request.text()); } catch { return nada(); }
  if (!b || typeof b.id !== "string" || !/^[a-z0-9]{6,16}$/.test(b.id)) return nada();
  const dia = diaMX();
  if (!(await hayCupo(dia))) return nada();
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const meta = {
    h: await huella(env.ADMIN_KEY, dia, ip, ua),
    f: fuente({ utm: String(b.u || "").slice(0, 60), amigo: !!b.a, ref: String(b.r || "").slice(0, 80), ua }),
    a: aparato(ua),
    pg: /^\/(terminos|privacidad)/.test(String(b.pg || "")) ? String(b.pg).replace(/\.html$/, "").slice(0, 20) : "/",
    p: lista(b.p, 15),
    c: lista(b.c, 10),
  };
  try { await env.BYANA.put(`v:${dia}:${b.id}`, "", { metadata: meta, expirationTtl: DIAS_CRUDO * 86400 }); } catch {}
  return nada();
}
export const onRequestGet = () => new Response(null, { status: 405 });
