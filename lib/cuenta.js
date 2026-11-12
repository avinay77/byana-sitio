// Cuentas de cliente (opcionales) y "recomienda a un amigo". Todo vive en el KV con binding BYANA:
//   cliente:<correo>  → { email, nombre, tel, dir, ref, creado, pedidos: [...], cupones: [...], referidos }
//   ref:<CÓDIGO>      → correo de quien recomienda
//   sesion:<token>    → correo (dura 30 días)
//   otp:<correo>      → { hash, intentos, enviado } (dura 10 minutos)
//   compro:<correo> / compro:tel:<10 dígitos> → "1" (ya compró alguna vez; sirve para saber si un amigo es nuevo)
//   pago:<id de Mercado Pago> → "1" (ese pago ya se registró; evita contar dos veces)
// No hay contraseñas: se entra con un código de 6 dígitos que llega al correo.
import { normalizar } from "./cupones.js";

export const COOKIE = "byana_s";
export const DIAS_SESION = 30;
export const PREMIO_REFERIDO = 100; // pesos para quien recomienda, cuando su amigo compra por primera vez
export const DESCUENTO_AMIGO = 100; // pesos de descuento para el amigo en su primera compra
export const MINIMO_REFERIDO = 500; // compra mínima en productos, tanto para el amigo como para el cupón de premio

// El código de amigo funciona como un cupón de $100 con mínimo de $500 (solo primera compra; eso lo revisa crear-pago).
export const cuponAmigo = rf => ({ codigo: rf.codigo, tipo: "monto", valor: DESCUENTO_AMIGO, minimo: MINIMO_REFERIDO, activo: true });

export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
export const correoValido = e => /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e);
export const limpiarCorreo = e => String(e || "").trim().toLowerCase().slice(0, 120);
export const soloTel = t => String(t || "").replace(/\D/g, "").slice(-10);

export async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export const aleatorio = (n, abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789") => {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return [...a].map(x => abc[x % abc.length]).join("");
};

export function cookieSesion(token, request) {
  const seguro = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESION * 86400}${seguro}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro}`;
}

const tokenDe = request => {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : "";
};

// Correo de la sesión activa, o "" si no hay sesión.
export async function sesion(env, request) {
  const t = tokenDe(request);
  if (!t || !env.BYANA) return "";
  return (await env.BYANA.get("sesion:" + t)) || "";
}
export async function cerrarSesion(env, request) {
  const t = tokenDe(request);
  if (t && env.BYANA) await env.BYANA.delete("sesion:" + t);
}
export async function abrirSesion(env, email) {
  const t = aleatorio(64, "0123456789abcdef");
  await env.BYANA.put("sesion:" + t, email, { expirationTtl: DIAS_SESION * 86400 });
  return t;
}

export const leerCliente = (env, email) => env.BYANA.get("cliente:" + email, "json");
export const guardarCliente = (env, c) => env.BYANA.put("cliente:" + c.email, JSON.stringify(c));

// Crea la cuenta la primera vez que alguien entra, con su código para recomendar.
export async function asegurarCliente(env, email) {
  let c = await leerCliente(env, email);
  if (c) return c;
  let ref = "";
  for (let i = 0; i < 6 && !ref; i++) {
    const x = "AMIGOS-" + aleatorio(5);
    if (!(await env.BYANA.get("ref:" + x)) && !(await env.BYANA.get("cupon:" + x))) ref = x;
  }
  c = { email, nombre: "", tel: "", dir: null, ref, creado: new Date().toISOString(), pedidos: [], cupones: [], referidos: 0 };
  await env.BYANA.put("ref:" + ref, email);
  await guardarCliente(env, c);
  return c;
}

// ¿Este código es de "recomienda a un amigo"? Devuelve { codigo, email, nombre } o null.
export async function leerReferido(env, codigo) {
  const c = normalizar(codigo);
  if (!c || !env.BYANA) return null;
  const email = await env.BYANA.get("ref:" + c);
  if (!email) return null;
  const cl = await leerCliente(env, email);
  return { codigo: c, email, nombre: (cl && cl.nombre ? cl.nombre.split(" ")[0] : "") , tel: cl ? soloTel(cl.tel) : "" };
}

// Manda un correo con Resend desde AVISO_FROM. Devuelve "" si salió bien o el motivo del error.
export async function enviarCorreo(env, para, { subject, html, text }) {
  if (!env.RESEND_API_KEY || !env.AVISO_FROM) return "Falta configurar el correo (RESEND_API_KEY / AVISO_FROM).";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: env.AVISO_FROM, to: [para], reply_to: "ventas@byana.mx", subject, html, text }),
  });
  if (r.ok) return "";
  const t = (await r.text()).slice(0, 200);
  console.error("Resend respondió", r.status, t);
  return "Resend " + r.status;
}

// Marco de correo con la marca, para los correos de cuenta.
export const marco = cuerpo => `<div style="background:#FEFEFC;padding:24px 12px;font-family:Arial,sans-serif;color:#5E5753">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E6E2DC;border-radius:6px;padding:28px 24px;font-size:15px;line-height:1.55">
  <p style="margin:0;text-align:center;font:italic 30px Georgia,serif;color:#5E5753">By Ana</p>
  <p style="margin:2px 0 22px;text-align:center;font-size:11px;letter-spacing:.22em;color:#8A827D">ESTUDIO DE DETALLES</p>
  ${cuerpo}
  <p style="margin:22px 0 0;font-size:13px;text-align:center;color:#8A827D"><a href="https://byana.mx" style="color:#8A827D">byana.mx</a> · WhatsApp 55 2943 4279 · ventas@byana.mx</p>
  </div></div>`;
