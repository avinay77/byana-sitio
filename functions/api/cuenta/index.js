// /api/cuenta
// GET    → datos de la cuenta, cupones y pedidos (401 si no hay sesión).
// POST   { nombre, tel, dir } → guarda los datos para no escribirlos en cada compra.
// DELETE → borra la cuenta (los pedidos ya hechos siguen en los registros de la tienda).
import { json, sesion, leerCliente, guardarCliente, cerrarSesion, cookieSesion, soloTel, PREMIO_REFERIDO } from "../../../lib/cuenta.js";
import { leerCupon, evaluar, etiqueta } from "../../../lib/cupones.js";
import { limpiar } from "../../../lib/pedido.js";

async function quien(ctx) {
  if (!ctx.env.BYANA) return [null, json(503, { error: "Las cuentas todavía no están activas." })];
  const email = await sesion(ctx.env, ctx.request);
  const c = email && await leerCliente(ctx.env, email);
  return c ? [c, null] : [null, json(401, { error: "No has entrado a tu cuenta." })];
}

export async function onRequestGet(ctx) {
  const [c, no] = await quien(ctx); if (no) return no;
  const cupones = [];
  for (const codigo of (c.cupones || []).slice(-20)) {
    const x = await leerCupon(ctx.env, codigo);
    if (!x) continue;
    const usado = x.usosMax && (x.usos || 0) >= x.usosMax;
    const ev = evaluar(x, 1e9);
    cupones.push({ codigo: x.codigo, etiqueta: etiqueta(x), nota: x.nota || "", minimo: x.minimo || 0, vence: x.vence || "",
      estado: usado ? "usado" : ev.ok ? "disponible" : "no disponible" });
  }
  return json(200, { email: c.email, nombre: c.nombre, tel: c.tel, dir: c.dir, ref: c.ref, referidos: c.referidos || 0,
    premio: PREMIO_REFERIDO, pedidos: (c.pedidos || []).slice(-30).reverse(), cupones: cupones.reverse() });
}

export async function onRequestPost(ctx) {
  const [c, no] = await quien(ctx); if (no) return no;
  let b = {}; try { b = await ctx.request.json(); } catch {}
  if (b.nombre !== undefined) c.nombre = limpiar(b.nombre, 60);
  if (b.tel !== undefined) c.tel = soloTel(b.tel);
  if (b.dir !== undefined) {
    const d = b.dir || {};
    c.dir = d && d.calle ? { calle: limpiar(d.calle, 100), colonia: limpiar(d.colonia, 60), cp: String(d.cp || "").replace(/\D/g, "").slice(0, 5),
      municipio: limpiar(d.municipio, 60), estado: limpiar(d.estado, 40), refs: limpiar(d.refs, 120) } : null;
  }
  await guardarCliente(ctx.env, c);
  return json(200, { ok: true });
}

export async function onRequestDelete(ctx) {
  const [c, no] = await quien(ctx); if (no) return no;
  const { env, request } = ctx;
  if (c.ref) await env.BYANA.delete("ref:" + c.ref);
  await env.BYANA.delete("cliente:" + c.email);
  await cerrarSesion(env, request);
  return json(200, { ok: true }, { "Set-Cookie": cookieSesion("", request) });
}
