// /api/admin/cupones — crear, listar, activar/desactivar y borrar cupones.
// Protegido con la clave ADMIN_KEY (variable secreta en Cloudflare), que se manda en el encabezado X-Admin-Key.
// Requiere el KV con binding BYANA.
import { normalizar } from "../../../lib/cupones.js";
import { json, revisar } from "../../../lib/admin.js";

export async function onRequestGet(ctx) {
  const no = revisar(ctx); if (no) return no;
  const { env } = ctx;
  const out = [];
  let cursor;
  do {
    const r = await env.BYANA.list({ prefix: "cupon:", cursor });
    for (const k of r.keys) { const c = await env.BYANA.get(k.name, "json"); if (c) out.push(c); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  out.sort((a, b) => String(b.creado || "").localeCompare(String(a.creado || "")));
  return json(200, { cupones: out });
}

// Crear o editar. Cuerpo: { codigo, tipo: "pct"|"monto", valor, minimo?, vence?, usosMax?, activo?, nota? }
export async function onRequestPost(ctx) {
  const no = revisar(ctx); if (no) return no;
  const { env, request } = ctx;
  let b; try { b = await request.json(); } catch { return json(400, { error: "Datos inválidos." }); }
  const codigo = normalizar(b.codigo);
  if (codigo.length < 3) return json(400, { error: "El código debe tener al menos 3 letras o números." });
  if (b.soloActivo !== undefined) {
    const prev = await env.BYANA.get("cupon:" + codigo, "json");
    if (!prev) return json(404, { error: "Ese cupón no existe." });
    prev.activo = !!b.soloActivo; await env.BYANA.put("cupon:" + codigo, JSON.stringify(prev));
    return json(200, { cupon: prev });
  }
  const tipo = b.tipo === "monto" ? "monto" : "pct";
  const valor = Math.round(Number(b.valor));
  if (!(valor > 0) || (tipo === "pct" && valor > 90)) return json(400, { error: tipo === "pct" ? "El porcentaje va de 1 a 90." : "El monto debe ser mayor a 0." });
  const vence = b.vence && /^\d{4}-\d{2}-\d{2}$/.test(b.vence) ? b.vence : "";
  const prev = await env.BYANA.get("cupon:" + codigo, "json");
  const c = {
    codigo, tipo, valor,
    minimo: Math.max(0, Math.round(Number(b.minimo) || 0)),
    vence,
    usosMax: Math.max(0, Math.round(Number(b.usosMax) || 0)),
    usos: prev ? prev.usos || 0 : 0,
    activo: b.activo !== false,
    nota: String(b.nota || "").slice(0, 120),
    origen: (prev && prev.origen) || "manual",
    creado: (prev && prev.creado) || new Date().toISOString(),
  };
  await env.BYANA.put("cupon:" + codigo, JSON.stringify(c));
  return json(200, { cupon: c });
}

export async function onRequestDelete(ctx) {
  const no = revisar(ctx); if (no) return no;
  const codigo = normalizar(new URL(ctx.request.url).searchParams.get("codigo"));
  if (!codigo) return json(400, { error: "Falta el código." });
  await ctx.env.BYANA.delete("cupon:" + codigo);
  return json(200, { ok: true });
}
