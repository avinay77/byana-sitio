// /api/cupon?codigo=XXX&subtotal=NNN → revisa si el cupón existe y aplica. El cobro final lo vuelve a validar crear-pago.
// Si el código es de "recomienda a un amigo", responde tipo "ref": $100 de descuento desde $500 (solo en la primera compra).
import { leerCupon, evaluar, publico } from "../../lib/cupones.js";
import { leerReferido, sesion, cuponAmigo, DESCUENTO_AMIGO, MINIMO_REFERIDO } from "../../lib/cuenta.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  if (!env.BYANA) return json(503, { ok: false, motivo: "Los cupones todavía no están activos." });
  const q = new URL(request.url).searchParams;
  const c = await leerCupon(env, q.get("codigo"));
  if (!c) {
    const r = await leerReferido(env, q.get("codigo"));
    if (r) {
      if (r.email === await sesion(env, request)) return json(200, { ok: false, motivo: "Ese es tu propio código; compártelo con tus amigos." });
      const pub = { codigo: r.codigo, tipo: "ref", valor: DESCUENTO_AMIGO, minimo: MINIMO_REFERIDO, etiqueta: `${r.nombre ? "Recomendación de " + r.nombre : "Recomendación de un amigo"} · $${DESCUENTO_AMIGO}` };
      const ev = evaluar(cuponAmigo(r), Number(q.get("subtotal")) || 0);
      return json(200, ev.ok ? { ok: true, descuento: ev.descuento, cupon: pub } : { ok: false, motivo: `El descuento de amigo aplica en tu primera compra desde $${MINIMO_REFERIDO} en productos.`, cupon: pub });
    }
  }
  const r = evaluar(c, Number(q.get("subtotal")) || 0);
  if (!r.ok) return json(c && c.activo ? 200 : 404, { ok: false, motivo: r.motivo, ...(c && c.activo && r.motivo.includes("desde") ? { cupon: publico(c) } : {}) });
  return json(200, { ok: true, descuento: r.descuento, cupon: publico(c) });
}
