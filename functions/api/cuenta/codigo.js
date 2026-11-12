// POST /api/cuenta/codigo { email } → manda un código de 6 dígitos al correo para entrar (no hay contraseñas).
import { json, correoValido, limpiarCorreo, sha, enviarCorreo, marco } from "../../../lib/cuenta.js";

export async function onRequestPost({ request, env }) {
  if (!env.BYANA) return json(503, { error: "Las cuentas todavía no están activas." });
  let b = {}; try { b = await request.json(); } catch {}
  const email = limpiarCorreo(b.email);
  if (!correoValido(email)) return json(400, { error: "Escribe un correo válido." });

  // Límite: un código por minuto por correo y 10 por hora por conexión.
  const prev = await env.BYANA.get("otp:" + email, "json");
  if (prev && Date.now() - prev.enviado < 60e3) return json(429, { error: "Ya te mandamos un código. Espera un minuto para pedir otro." });
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const n = Number(await env.BYANA.get("lim:" + ip)) || 0;
  if (n >= 10) return json(429, { error: "Demasiados intentos. Intenta más tarde." });
  await env.BYANA.put("lim:" + ip, String(n + 1), { expirationTtl: 3600 });

  const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, "0");
  await env.BYANA.put("otp:" + email, JSON.stringify({ hash: await sha(email + ":" + codigo), intentos: 0, enviado: Date.now() }), { expirationTtl: 600 });

  const err = await enviarCorreo(env, email, {
    subject: `${codigo} es tu código para entrar a By Ana`,
    html: marco(`<p style="margin:0 0 12px">Tu código para entrar a tu cuenta es:</p>
      <p style="margin:0 0 16px;text-align:center;font:600 32px/1 ui-monospace,Menlo,monospace;letter-spacing:.3em;color:#4F6B55">${codigo}</p>
      <p style="margin:0;color:#8A827D;font-size:13px">Vence en 10 minutos. Si tú no lo pediste, ignora este correo.</p>`),
    text: `Tu código para entrar a By Ana es ${codigo}. Vence en 10 minutos. Si tú no lo pediste, ignora este correo.`,
  });
  if (err) return json(502, { error: "No pudimos mandar el correo. Intenta de nuevo en un momento." });
  return json(200, { ok: true });
}
