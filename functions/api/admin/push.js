// /api/admin/push — avisos de pedidos nuevos en los aparatos de administración. Protegido con ADMIN_KEY.
// GET                          → { publica } (llave VAPID para suscribirse) y cuántos aparatos hay
// POST { suscripcion, nombre } → guarda este aparato
// POST { prueba: true }        → manda una notificación de prueba a todos
// DELETE ?endpoint=...         → quita este aparato
import { json, revisar } from "../../../lib/admin.js";
import { vapid, idSub, avisarAdmins } from "../../../lib/push.js";

export async function onRequestGet(ctx) {
  const no = revisar(ctx); if (no) return no;
  const v = await vapid(ctx.env);
  const r = await ctx.env.BYANA.list({ prefix: "push:" });
  return json(200, { publica: v.publica, aparatos: r.keys.length });
}

export async function onRequestPost(ctx) {
  const no = revisar(ctx); if (no) return no;
  const { env, request } = ctx;
  let b = {}; try { b = await request.json(); } catch {}
  if (b.prueba) {
    const n = await avisarAdmins(env, { title: "By Ana · prueba", body: "Así te llegarán los avisos de pedidos nuevos.", url: "/admin" });
    return json(200, { enviados: n });
  }
  const s = b.suscripcion || {};
  if (!/^https:\/\//.test(s.endpoint || "") || !s.keys || !s.keys.p256dh || !s.keys.auth) return json(400, { error: "Suscripción inválida." });
  await env.BYANA.put("push:" + await idSub(s.endpoint), JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, nombre: String(b.nombre || "").slice(0, 60), creado: new Date().toISOString() }));
  return json(200, { ok: true });
}

export async function onRequestDelete(ctx) {
  const no = revisar(ctx); if (no) return no;
  const e = new URL(ctx.request.url).searchParams.get("endpoint") || "";
  if (e) await ctx.env.BYANA.delete("push:" + await idSub(e));
  return json(200, { ok: true });
}
