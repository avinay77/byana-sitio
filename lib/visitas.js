// Estadística de visitas anónima (sin cookies ni IPs guardadas).
// Cada visita al sitio manda un aviso a /api/v y se guarda en KV como v:<día>:<id> (solo metadatos, se borra solo a los 10 días).
// El admin resume cada día terminado en vd:<día> para que quede para siempre sin ocupar espacio.
export const TOPE_DIA = 600;      // escrituras de visitas por día, para no gastar el límite gratis de KV (1,000/día) que también usan los pedidos
export const DIAS_CRUDO = 10;     // días que se guardan las visitas sueltas antes de resumirse

// Día en hora de la Ciudad de México (UTC-6, sin horario de verano desde 2022).
export const diaMX = (t = Date.now()) => new Date(t - 6 * 3600e3).toISOString().slice(0, 10);
export const restarDias = (dia, n) => new Date(Date.parse(dia + "T12:00:00Z") - n * 864e5).toISOString().slice(0, 10);

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|meta-external|whatsapp\/|telegram|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|scrapy|phantom|selenium|puppeteer|playwright/i;
export const esBot = ua => !ua || ua.length < 20 || BOTS.test(ua);

export function aparato(ua) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "Tableta";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "Celular";
  return "Computadora";
}

const FUENTES = [
  [/instagram/i, "Instagram"], [/facebook|fb\.me|fb\.com|messenger/i, "Facebook"], [/whatsapp|wa\.me/i, "WhatsApp"],
  [/google/i, "Google"], [/bing/i, "Bing"], [/tiktok/i, "TikTok"], [/pinterest|pin\.it/i, "Pinterest"],
  [/linktr\.ee/i, "Linktree"], [/youtube/i, "YouTube"], [/(^|\.)t\.co$|twitter|x\.com/i, "X"], [/yahoo/i, "Yahoo"], [/duckduckgo/i, "DuckDuckGo"],
];
// De dónde llegó: utm_source o ?ref= de amigos, el navegador interno de Instagram/Facebook, o la página anterior.
export function fuente({ utm, amigo, ref, ua }) {
  if (amigo) return "Recomendación";
  for (const s of [utm, ref]) {
    if (!s) continue;
    for (const [re, n] of FUENTES) if (re.test(s)) return n;
  }
  if (/instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return "Facebook";
  if (utm) return String(utm).slice(0, 30);
  if (ref && !/(^|\.)byana\.(mx|netlify\.app)$|pages\.dev$/i.test(ref)) return String(ref).replace(/^www\./, "").slice(0, 40);
  return "Directo";
}

export async function huella(secreto, dia, ip, ua) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto || "byana"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${dia}|${ip}|${ua}`)));
  return [...s.slice(0, 5)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const sumar = (o, k, n = 1) => { if (k) o[k] = (o[k] || 0) + n; };

// Junta las visitas sueltas de un día en un resumen.
export async function resumirDia(env, dia) {
  const r = { dia, visitas: 0, personas: 0, fuentes: {}, aparatos: {}, paginas: {}, productos: {}, carrito: {} };
  const vistos = new Set();
  let cursor;
  do {
    const l = await env.BYANA.list({ prefix: `v:${dia}:`, cursor });
    for (const k of l.keys) {
      const m = k.metadata; if (!m) continue;
      r.visitas++;
      if (!vistos.has(m.h)) {
        vistos.add(m.h);
        sumar(r.fuentes, m.f); sumar(r.aparatos, m.a);
      }
      sumar(r.paginas, m.pg);
      for (const id of m.p || []) sumar(r.productos, id);
      for (const id of m.c || []) sumar(r.carrito, id);
    }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  r.personas = vistos.size;
  return r;
}
