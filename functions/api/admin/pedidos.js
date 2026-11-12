// /api/admin/pedidos — lista, detalle y cambio de estado de los pedidos pagados. Protegido con ADMIN_KEY.
// GET            → { pedidos: [{ ref, fecha, cliente, total, estado, piezas }] } (más recientes primero)
// GET ?ref=XXX   → { pedido }
// POST { ref, estado?, guia?, notaInterna?, avisar? } → actualiza; con avisar y estado "enviado" le manda correo al cliente.
import { json, revisar } from "../../../lib/admin.js";
import { ESTADOS, leerPedido, guardarPedido } from "../../../lib/pedidos.js";
import { enviarCorreo, marco } from "../../../lib/cuenta.js";
import { limpiar } from "../../../lib/pedido.js";

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function onRequestGet(ctx) {
  const no = revisar(ctx); if (no) return no;
  const { env, request } = ctx;
  const ref = new URL(request.url).searchParams.get("ref");
  if (ref) {
    const p = await leerPedido(env, ref);
    return p ? json(200, { pedido: p, estados: ESTADOS }) : json(404, { error: "No encontramos ese pedido." });
  }
  const out = [];
  let cursor;
  do {
    const r = await env.BYANA.list({ prefix: "pedido:", cursor });
    for (const k of r.keys) out.push({ ref: k.name.slice(7), ...(k.metadata || {}) });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && out.length < 5000);
  out.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  return json(200, { pedidos: out, estados: ESTADOS });
}

export async function onRequestPost(ctx) {
  const no = revisar(ctx); if (no) return no;
  const { env, request } = ctx;
  let b = {}; try { b = await request.json(); } catch {}
  const p = await leerPedido(env, b.ref);
  if (!p) return json(404, { error: "No encontramos ese pedido." });
  if (b.guia !== undefined) p.guia = limpiar(b.guia, 120);
  if (b.notaInterna !== undefined) p.notaInterna = limpiar(b.notaInterna, 500);
  let cambio = false;
  if (b.estado && b.estado !== p.estado) {
    if (!ESTADOS[b.estado]) return json(400, { error: "Estado inválido." });
    p.estado = b.estado; cambio = true;
    p.historial = [...(p.historial || []), { estado: b.estado, fecha: new Date().toISOString() }].slice(-20);
  }
  await guardarPedido(env, p);

  let aviso = "";
  if (b.avisar && p.estado === "enviado") {
    const para = String(p.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) aviso = "El pedido no tiene correo del cliente; avísale por WhatsApp.";
    else {
      const nombre = String(p.cliente || "").split(" ")[0];
      const guia = p.guia ? (/^https?:\/\//.test(p.guia) ? `<a href="${esc(p.guia)}" style="color:#4F6B55">${esc(p.guia)}</a>` : `<b>${esc(p.guia)}</b>`) : "";
      const err = await enviarCorreo(env, para, {
        subject: `Tu pedido de By Ana va en camino 🚚 ${p.ref}`,
        html: marco(`<h1 style="margin:0 0 10px;font-size:20px;color:#4F6B55">¡Tu pedido va en camino${nombre ? ", " + esc(nombre) : ""}!</h1>
          <p style="margin:0 0 12px">Ya salió tu pedido <b>${esc(p.ref)}</b>${p.direccion ? ` hacia ${esc(p.direccion)}` : ""}.</p>
          ${guia ? `<p style="margin:0 0 12px">Guía de rastreo: ${guia}</p>` : ""}
          <p style="margin:0">Si tienes cualquier duda, escríbenos por WhatsApp al 55 2943 4279.</p>`),
        text: `¡Tu pedido va en camino${nombre ? ", " + nombre : ""}! Ya salió tu pedido ${p.ref}${p.direccion ? " hacia " + p.direccion : ""}.${p.guia ? " Guía: " + p.guia + "." : ""} Dudas: WhatsApp 55 2943 4279.`,
      });
      aviso = err ? "No se pudo mandar el correo al cliente (" + err + ")." : `Le avisamos por correo a ${para}.`;
    }
  }
  return json(200, { pedido: p, cambio, aviso });
}
