// API de Conversiones de Meta (CAPI): manda el evento Purchase desde el servidor cuando Mercado Pago aprueba un pago.
// Así la compra se mide aunque el navegador bloquee el pixel o la persona no regrese a byana.mx después de pagar.
// Usa el mismo event_id que el pixel del navegador (la referencia BA-...) para que Meta no la cuente dos veces.
// Variables (Cloudflare → byana-sitio → Settings → Variables and Secrets):
//   META_CAPI_TOKEN  (secreto, se genera en Events Manager → pixel → Configuración → API de Conversiones)
//   META_PIXEL_ID    (opcional; si no está, usa el pixel de byana.mx)
//   META_TEST_CODE   (opcional; código TEST... de "Probar eventos" para ver el evento en vivo; quitarlo después)
export const PIXEL_ID = "1150047477389568";

async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
const norm = s => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const h = async (s, limpiar = x => x) => { const v = limpiar(norm(s)); return v ? [await sha256(v)] : undefined; };

// Datos del navegador que se guardan al crear el pago (en la metadata de Mercado Pago) para emparejar la compra.
export function datosNavegador(request) {
  const ck = Object.fromEntries((request.headers.get("Cookie") || "").split(/;\s*/).map(c => c.split("=")).filter(c => c.length >= 2).map(([k, ...v]) => [k, v.join("=")]));
  return {
    px_fbp: (ck._fbp || "").slice(0, 120),
    px_fbc: (ck._fbc || "").slice(0, 300),
    px_ip: (request.headers.get("CF-Connecting-IP") || "").slice(0, 60),
    px_ua: (request.headers.get("User-Agent") || "").slice(0, 400),
  };
}

export async function enviarCompra(env, pago, pedido) {
  const token = env.META_CAPI_TOKEN;
  if (!token) return "sin META_CAPI_TOKEN";
  const md = pago.metadata || {};
  const payer = pago.payer || {};
  // Solo el primer nombre: con nombres compuestos y dos apellidos no se puede saber bien cuál es el apellido.
  const fn = String(pedido.cliente || "").trim().split(/\s+/)[0];
  const tel = String(pedido.telefono || (payer.phone && payer.phone.number) || "").replace(/\D/g, "").slice(-10);
  const dir = String(md.direccion || "");
  const cp = (dir.match(/\b\d{5}\b/) || [])[0] || "";
  const ids = String(md.px_ids || "").split(",").filter(Boolean);
  const user_data = {
    em: await h(payer.email),
    ph: tel.length === 10 ? [await sha256("52" + tel)] : undefined,
    fn: await h(fn, s => s.replace(/[^a-zñ]/g, "")),
    zp: cp ? [await sha256(cp)] : undefined,
    country: [await sha256("mx")],
    external_id: md.cuenta ? [await sha256(norm(md.cuenta))] : undefined,
    client_ip_address: md.px_ip || undefined,
    client_user_agent: md.px_ua || undefined,
    fbp: md.px_fbp || undefined,
    fbc: md.px_fbc || undefined,
  };
  const evento = {
    event_name: "Purchase",
    event_time: Math.floor(new Date(pago.date_approved || Date.now()).getTime() / 1000),
    event_id: pedido.ref || String(pago.id),
    action_source: "website",
    event_source_url: "https://byana.mx/?pago=ok",
    user_data,
    custom_data: {
      currency: "MXN",
      value: Number(pago.transaction_amount) || 0,
      order_id: pedido.ref || String(pago.id),
      content_type: "product",
      ...(ids.length ? { content_ids: ids } : {}),
      num_items: Number(md.piezas) || undefined,
    },
  };
  const body = { data: [evento], ...(env.META_TEST_CODE ? { test_event_code: env.META_TEST_CODE } : {}) };
  const r = await fetch(`https://graph.facebook.com/v21.0/${env.META_PIXEL_ID || PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const t = (await r.text()).slice(0, 300);
  if (!r.ok) { console.error("Meta CAPI respondió", r.status, t); return "Meta respondió " + r.status; }
  console.log("Meta CAPI Purchase", evento.event_id, t);
  return "Purchase enviado a Meta";
}
