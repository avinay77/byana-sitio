// Cloudflare Pages Function: /api/crear-pago
// GET  → { activo } para que el sitio sepa si muestra el botón de Mercado Pago.
// POST → valida el carrito con catalogo.json y crea la preferencia de Checkout Pro por el TOTAL (productos + envío).
// Variables (Cloudflare → proyecto → Settings → Variables and Secrets): MP_ACCESS_TOKEN (secreto).
import { validar } from "../../lib/pedido.js";
import { leerCupon } from "../../lib/cupones.js";
import { sesion, leerCliente, guardarCliente, leerReferido, soloTel, cuponAmigo, MINIMO_REFERIDO } from "../../lib/cuenta.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const catalogo = async ({ env, request }) => (await env.ASSETS.fetch(new URL("/catalogo.json", request.url))).json();

export const onRequestGet = ({ env }) => json(200, { activo: !!env.MP_ACCESS_TOKEN });

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = env.MP_ACCESS_TOKEN;
  if (!token) return json(503, { error: "El pago en línea todavía no está activo.", sinConfigurar: true });

  let pedido;
  try { pedido = await request.json(); } catch { return json(400, { error: "Pedido inválido." }); }
  // Cuenta (opcional) y "recomienda a un amigo": el código de amigo da $100 desde $500, solo en la primera compra.
  const cuenta = env.BYANA && pedido ? await sesion(env, request) : "";
  let referido = "", cupon = null;
  if (pedido && pedido.referido && env.BYANA) {
    const rf = await leerReferido(env, pedido.referido);
    if (!rf) return json(400, { error: "Ese código de amigo ya no existe.", cupon: true });
    const tel = soloTel(pedido.cliente && pedido.cliente.tel);
    if (rf.email === cuenta || (rf.tel && rf.tel === tel))
      return json(400, { error: "No puedes usar tu propio código de recomendación.", cupon: true });
    const ya = (tel.length === 10 && await env.BYANA.get("compro:tel:" + tel)) || (cuenta && await env.BYANA.get("compro:" + cuenta));
    if (ya) return json(400, { error: "El descuento de amigo es solo para la primera compra.", cupon: true });
    referido = rf.codigo; cupon = cuponAmigo(rf); pedido.cupon = rf.codigo;
  } else if (pedido && pedido.cupon) cupon = await leerCupon(env, pedido.cupon);
  const r = validar(pedido, await catalogo(context), cupon);
  if (r.error) return json(400, r.cupon && referido ? { ...r, error: `El descuento de amigo aplica en compras desde $${MINIMO_REFERIDO} en productos.` } : r);
  if (cuenta) {
    // Guarda nombre, WhatsApp y dirección para la próxima compra.
    try {
      const c = await leerCliente(env, cuenta);
      if (c) { c.nombre = r.cliente.nombre; c.tel = soloTel(r.cliente.tel); if (r.envio.dir) c.dir = r.envio.dir; await guardarCliente(env, c); }
    } catch (e) { console.error("No se pudo guardar la cuenta", e); }
  }

  const base = new URL(request.url).origin;
  const ref = "BA-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const preferencia = {
    items: r.items,
    payer: Object.assign({ name: r.cliente.nombre, phone: { number: r.cliente.tel } },
      r.envio.dir ? { address: { zip_code: r.envio.dir.cp, street_name: r.envio.dir.calle } } : {}),
    external_reference: ref,
    statement_descriptor: "BYANA",
    back_urls: { success: `${base}/?pago=ok`, pending: `${base}/?pago=pendiente`, failure: `${base}/?pago=error` },
    auto_return: "approved",
    // Mercado Pago avisa aquí cada pago; mp-webhook lo verifica y le manda el correo a Ana.
    notification_url: `${base}/api/mp-webhook`,
    metadata: { cliente: r.cliente.nombre, telefono: r.cliente.tel, piezas: r.piezas,
      envio: r.envio.n, direccion: r.envio.dir ? Object.values(r.envio.dir).filter(Boolean).join(", ") : "",
      ...(cuenta ? { cuenta } : {}), ...(referido ? { referido } : {}),
      ...(r.descuento ? { cupon: r.cupon, descuento: r.descuento, lineas: JSON.stringify(r.lineas).slice(0, 6000) } : {}),
      subtotal: r.subtotal },
  };

  try {
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Idempotency-Key": ref },
      body: JSON.stringify(preferencia),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.init_point) {
      console.error("Mercado Pago respondió", res.status, JSON.stringify(data).slice(0, 500));
      const motivo = [res.status, data.error, data.message].filter(Boolean).join(" · ").slice(0, 160);
      return json(502, { error: "No pudimos conectar con Mercado Pago. Intenta de nuevo o pide por WhatsApp.", motivo });
    }
    const total = r.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    return json(200, { url: data.init_point, ref, total });
  } catch (e) {
    console.error(e);
    return json(502, { error: "No pudimos conectar con Mercado Pago. Intenta de nuevo o pide por WhatsApp." });
  }
}
