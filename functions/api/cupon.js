// /api/cupon?codigo=XXX&subtotal=NNN → revisa si el cupón existe y aplica. El cobro final lo vuelve a validar crear-pago.
import { leerCupon, evaluar, publico } from "../../lib/cupones.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequestGet({ request, env }) {
  if (!env.BYANA) return json(503, { ok: false, motivo: "Los cupones todavía no están activos." });
  const q = new URL(request.url).searchParams;
  const c = await leerCupon(env, q.get("codigo"));
  const r = evaluar(c, Number(q.get("subtotal")) || 0);
  if (!r.ok) return json(c && c.activo ? 200 : 404, { ok: false, motivo: r.motivo, ...(c && c.activo && r.motivo.includes("desde") ? { cupon: publico(c) } : {}) });
  return json(200, { ok: true, descuento: r.descuento, cupon: publico(c) });
}
