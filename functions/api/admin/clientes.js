// /api/admin/clientes — clientes con cuenta. Protegido con ADMIN_KEY.
// GET              → { clientes: [{ email, nombre, tel, creado, ref, pedidos, total, referidos, ultimo }] }
// GET ?email=XXX   → { cliente, pedidos (con estado), cupones (con estado) }
import { json, revisar } from "../../../lib/admin.js";
import { leerCliente, resumenCliente, limpiarCorreo } from "../../../lib/cuenta.js";
import { leerCupon, evaluar, etiqueta } from "../../../lib/cupones.js";
import { leerPedido, ESTADOS } from "../../../lib/pedidos.js";

export async function onRequestGet(ctx) {
  const no = revisar(ctx); if (no) return no;
  const { env, request } = ctx;
  const email = new URL(request.url).searchParams.get("email");
  if (email) {
    const c = await leerCliente(env, limpiarCorreo(email));
    if (!c) return json(404, { error: "No encontramos esa cuenta." });
    const pedidos = [];
    for (const p of (c.pedidos || []).slice(-50).reverse()) {
      const x = await leerPedido(env, p.ref);
      pedidos.push({ ...p, estado: x ? ESTADOS[x.estado] || x.estado : "", registrado: !!x });
    }
    const cupones = [];
    for (const codigo of (c.cupones || []).slice(-30).reverse()) {
      const x = await leerCupon(env, codigo); if (!x) continue;
      const usado = x.usosMax && (x.usos || 0) >= x.usosMax;
      cupones.push({ codigo: x.codigo, etiqueta: etiqueta(x), nota: x.nota || "", estado: usado ? "Usado" : evaluar(x, 1e9).ok ? "Disponible" : "No disponible" });
    }
    return json(200, { cliente: { email: c.email, ...resumenCliente(c), dir: c.dir }, pedidos, cupones });
  }
  const out = [];
  let cursor;
  do {
    const r = await env.BYANA.list({ prefix: "cliente:", cursor });
    for (const k of r.keys) {
      let m = k.metadata;
      if (!m) { const c = await env.BYANA.get(k.name, "json"); m = c ? resumenCliente(c) : null; }
      if (m) out.push({ email: k.name.slice(8), ...m });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && out.length < 10000);
  out.sort((a, b) => String(b.creado || "").localeCompare(String(a.creado || "")));
  return json(200, { clientes: out });
}
