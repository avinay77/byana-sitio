// POST /api/cuenta/entrar { email, codigo } → revisa el código y abre la sesión (cookie HttpOnly de 30 días).
import { json, limpiarCorreo, sha, abrirSesion, asegurarCliente, cookieSesion } from "../../../lib/cuenta.js";

export async function onRequestPost({ request, env }) {
  if (!env.BYANA) return json(503, { error: "Las cuentas todavía no están activas." });
  let b = {}; try { b = await request.json(); } catch {}
  const email = limpiarCorreo(b.email);
  const codigo = String(b.codigo || "").replace(/\D/g, "");
  const o = await env.BYANA.get("otp:" + email, "json");
  if (!o) return json(400, { error: "El código venció. Pide uno nuevo." });
  if (o.intentos >= 5) { await env.BYANA.delete("otp:" + email); return json(400, { error: "Demasiados intentos. Pide un código nuevo." }); }
  if (codigo.length !== 6 || (await sha(email + ":" + codigo)) !== o.hash) {
    o.intentos++;
    await env.BYANA.put("otp:" + email, JSON.stringify(o), { expirationTtl: 600 });
    return json(400, { error: "El código no coincide. Revisa el correo e intenta de nuevo." });
  }
  await env.BYANA.delete("otp:" + email);
  const cliente = await asegurarCliente(env, email);
  const token = await abrirSesion(env, email);
  return json(200, { ok: true, nuevo: !cliente.nombre }, { "Set-Cookie": cookieSesion(token, request) });
}
