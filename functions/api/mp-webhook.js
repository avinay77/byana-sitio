// Cloudflare Pages Function: /api/mp-webhook
// Mercado Pago avisa aquí cada pago. Con cada pago APROBADO consultamos el pago en la API de Mercado Pago
// (así nadie puede inventar un pedido) y le mandamos a Ana un correo con el pedido completo usando Resend.
// Variables: MP_ACCESS_TOKEN, RESEND_API_KEY (secretos) y AVISO_EMAIL (a dónde llegan los pedidos).
// Opcional: AVISO_FROM, p. ej. "By Ana <pedidos@byana.mx>" cuando el dominio esté verificado en Resend.
import { sumarUso } from "../../lib/cupones.js";
import { leerCliente, guardarCliente, leerReferido, limpiarCorreo, correoValido, soloTel, aleatorio, enviarCorreo, marco, PREMIO_REFERIDO } from "../../lib/cuenta.js";

const money = n => "$" + Number(n || 0).toLocaleString("es-MX");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Con cupón, el detalle real de productos viene en metadata.lineas (Mercado Pago solo trae una línea "Pedido By Ana").
function lineasDe(md, items) {
  let l = null;
  try { l = md.lineas ? JSON.parse(md.lineas) : null; } catch {}
  const envio = items.filter(i => String(i.id || "").startsWith("envio-") || /env[ií]o/i.test(i.title || ""));
  if (Array.isArray(l) && l.length) return [...l.map(i => ({ t: i.t, q: Number(i.q), p: Number(i.p), d: i.d || "" })), ...envio.map(i => ({ t: i.title, q: Number(i.quantity), p: Number(i.unit_price), d: "" }))];
  return items.map(i => ({ t: i.title, q: Number(i.quantity), p: Number(i.unit_price), d: i.description || "" }));
}

export function armarPedido(pago) {
  const md = pago.metadata || {};
  const items = (pago.additional_info && pago.additional_info.items) || [];
  return {
    ref: pago.external_reference || "",
    cliente: md.cliente || [pago.payer && pago.payer.first_name, pago.payer && pago.payer.last_name].filter(Boolean).join(" "),
    telefono: md.telefono || "",
    email: (pago.payer && pago.payer.email) || "",
    productos: lineasDe(md, items),
    cupon: md.cupon || "",
    referido: md.referido || "",
    cuenta: md.cuenta || "",
    descuento: Number(md.descuento) || 0,
    envio: md.envio || "",
    direccion: md.direccion || "",
    total: money(pago.transaction_amount),
    pago: String(pago.id),
  };
}

export function correo(o) {
  const filas = o.productos.map(i => `<tr><td style="padding:6px 0">${i.q} × ${esc(i.t)}${i.d ? `<br><small style="color:#8A827D">${esc(i.d)}</small>` : ""}</td><td style="padding:6px 0;text-align:right;white-space:nowrap">${money(i.p * i.q)}</td></tr>`).join("");
  const wa = o.telefono ? `https://wa.me/52${o.telefono.replace(/\D/g, "").slice(-10)}` : "";
  const html = `<div style="font-family:Arial,sans-serif;color:#5E5753;max-width:520px">
  <h2 style="margin:0 0 4px">Nuevo pedido pagado 🎁</h2><p style="margin:0 0 16px;color:#8A827D">${esc(o.ref)} · pago Mercado Pago ${esc(o.pago)}</p>
  <p style="margin:0"><b>${esc(o.cliente)}</b><br>Tel: ${esc(o.telefono)}${wa ? ` · <a href="${wa}">Abrir WhatsApp</a>` : ""}${o.email ? `<br>${esc(o.email)}` : ""}</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:1px solid #E6E2DC;border-bottom:1px solid #E6E2DC">${filas}
  ${o.descuento ? `<tr><td style="padding:6px 0;color:#4F6B55">Cupón ${esc(o.cupon)}</td><td style="padding:6px 0;text-align:right;color:#4F6B55">−${money(o.descuento)}</td></tr>` : ""}
  <tr><td style="padding:8px 0"><b>Total pagado</b></td><td style="text-align:right"><b>${esc(o.total)}</b></td></tr></table>
  <p style="margin:0"><b>Entrega:</b> ${esc(o.envio || "—")}${o.direccion ? `<br><b>Dirección:</b> ${esc(o.direccion)}` : ""}</p>
  ${o.referido || o.cuenta ? `<p style="margin:12px 0 0;color:#8A827D;font-size:13px">${o.cuenta ? "Compró con su cuenta. " : ""}${o.referido ? `Llegó recomendado (código ${esc(o.referido)}).` : ""}</p>` : ""}</div>`;
  const text = `Nuevo pedido pagado ${o.ref}\n${o.cliente} · ${o.telefono}\n` +
    o.productos.map(i => `${i.q} × ${i.t}${i.d ? ` (${i.d})` : ""} = ${money(i.p * i.q)}`).join("\n") +
    (o.descuento ? `\nCupón ${o.cupon}: −${money(o.descuento)}` : "") + `\nTotal: ${o.total}\nEntrega: ${o.envio}\n${o.direccion ? "Dirección: " + o.direccion : ""}`;
  return { subject: `Nuevo pedido ${o.ref} · ${o.total} · ${o.cliente}`, html, text };
}

// Correo de confirmación para el cliente (solo si el dominio byana.mx está verificado en Resend, o sea, AVISO_FROM puesto).
export function correoCliente(o) {
  const nombre = String(o.cliente || "").split(" ")[0];
  const filas = o.productos.map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #EFEBE6">${i.q} × ${esc(i.t)}${i.d ? `<br><small style="color:#8A827D">${esc(i.d)}</small>` : ""}</td><td style="padding:8px 0;border-bottom:1px solid #EFEBE6;text-align:right;white-space:nowrap">${money(i.p * i.q)}</td></tr>`).join("");
  const html = `<div style="background:#FEFEFC;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#5E5753">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E6E2DC;border-radius:6px;padding:28px 24px">
  <p style="margin:0;text-align:center;font-size:30px;font-style:italic;color:#5E5753">By Ana</p>
  <p style="margin:2px 0 22px;text-align:center;font:11px Arial,sans-serif;letter-spacing:.22em;color:#8A827D">ESTUDIO DE DETALLES</p>
  <h1 style="margin:0 0 8px;font:600 20px Arial,sans-serif;color:#4F6B55">¡Gracias por tu pedido${nombre ? ", " + esc(nombre) : ""}!</h1>
  <p style="margin:0 0 18px;font:15px/1.5 Arial,sans-serif">Recibimos tu pago y Ana ya está preparando tus detalles. Te escribirá por WhatsApp para confirmar la entrega. Entregamos en 2 a 7 días hábiles.</p>
  <table style="width:100%;border-collapse:collapse;font:14px Arial,sans-serif">${filas}
  ${o.descuento ? `<tr><td style="padding:8px 0;color:#4F6B55">Cupón ${esc(o.cupon)}</td><td style="padding:8px 0;text-align:right;color:#4F6B55">−${money(o.descuento)}</td></tr>` : ""}
  <tr><td style="padding:10px 0"><b>Total pagado</b></td><td style="padding:10px 0;text-align:right"><b>${esc(o.total)}</b></td></tr></table>
  <p style="margin:14px 0 0;font:14px/1.5 Arial,sans-serif"><b>Entrega:</b> ${esc(o.envio || "—")}${o.direccion ? `<br><b>Dirección:</b> ${esc(o.direccion)}` : ""}</p>
  <p style="margin:14px 0 0;font:12px Arial,sans-serif;color:#8A827D">Pedido ${esc(o.ref)} · Mercado Pago ${esc(o.pago)}</p>
  <p style="margin:22px 0 0;font:14px/1.6 Arial,sans-serif;text-align:center">¿Dudas? <a href="https://wa.me/525529434279" style="color:#4F6B55">WhatsApp 55 2943 4279</a> · <a href="mailto:ventas@byana.mx" style="color:#4F6B55">ventas@byana.mx</a><br><a href="https://byana.mx" style="color:#8A827D">byana.mx</a> · <a href="https://www.instagram.com/byana.mx/" style="color:#8A827D">@byana.mx</a></p>
  </div></div>`;
  const text = `¡Gracias por tu pedido${nombre ? ", " + nombre : ""}!\nRecibimos tu pago y Ana ya está preparando tus detalles. Te escribirá por WhatsApp para confirmar la entrega (2 a 7 días hábiles).\n\n` +
    o.productos.map(i => `${i.q} × ${i.t}${i.d ? ` (${i.d})` : ""} = ${money(i.p * i.q)}`).join("\n") +
    (o.descuento ? `\nCupón ${o.cupon}: −${money(o.descuento)}` : "") + `\nTotal pagado: ${o.total}\nEntrega: ${o.envio}${o.direccion ? "\nDirección: " + o.direccion : ""}\nPedido ${o.ref}\n\nDudas: WhatsApp 55 2943 4279 · ventas@byana.mx · byana.mx`;
  return { subject: `¡Gracias por tu pedido! By Ana ${o.ref}`, html, text };
}

export async function onRequest({ request, env }) {
  const ok = (b = "ok") => new Response(b, { status: 200 });
  const url = new URL(request.url);
  // GET sin parámetros: diagnóstico de la configuración (no muestra ninguna clave).
  if (request.method === "GET" && !url.searchParams.has("id") && !url.searchParams.has("data.id")) {
    const m = env.AVISO_EMAIL || "";
    return new Response(JSON.stringify({
      mercadopago: env.MP_ACCESS_TOKEN ? (env.MP_ACCESS_TOKEN.startsWith("TEST-") ? "token de prueba" : "token puesto") : "FALTA MP_ACCESS_TOKEN",
      resend: env.RESEND_API_KEY ? "clave puesta" : "FALTA RESEND_API_KEY",
      aviso_email: m ? m.replace(/^(.{2}).*(@.*)$/, "$1***$2") : "FALTA AVISO_EMAIL",
      aviso_from: env.AVISO_FROM ? env.AVISO_FROM.replace(/<(.{2}).*(@.*)>/, "<$1***$2>") : "FALTA AVISO_FROM (no se manda correo al cliente)",
    }, null, 1), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  console.log("Aviso de Mercado Pago", request.method, url.search);
  let b = {};
  try { b = await request.json(); } catch {}
  const tipo = b.type || url.searchParams.get("type") || url.searchParams.get("topic");
  const id = String((b.data && b.data.id) || url.searchParams.get("data.id") || url.searchParams.get("id") || "").replace(/\D/g, "");
  const accion = b.action || "";
  if (!env.MP_ACCESS_TOKEN || tipo !== "payment" || !id) return ok("ignorado");

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!res.ok) { console.error("No se pudo leer el pago", id, res.status); return new Response("reintentar: Mercado Pago respondió " + res.status + " al leer el pago " + id, { status: 500 }); }
  const pago = await res.json();
  console.log("Pago", id, pago.status, accion);
  if (pago.status !== "approved") return ok("no aprobado: " + pago.status);

  // Mercado Pago manda varios avisos por pago: avisamos con el de creación (tarjeta, se aprueba al instante)
  // o con la actualización cuando la aprobación llegó después (OXXO, transferencia).
  const tarde = new Date(pago.date_approved) - new Date(pago.date_created) > 60000;
  if (accion === "payment.updated" && !tarde) return ok("repetido");
  if (accion === "payment.created" && tarde) return ok("pendiente");

  if (!env.RESEND_API_KEY || !env.AVISO_EMAIL) { console.error("Falta RESEND_API_KEY o AVISO_EMAIL"); return ok("sin correo"); }
  const pedido = armarPedido(pago);
  // Registra el pedido (uso del cupón, historial de la cuenta, premio por recomendación) solo con el aviso real
  // de Mercado Pago, no al reenviar correos a mano por GET. Un mismo pago se registra una sola vez.
  if (request.method === "POST" && env.BYANA) { try { await registrar(env, pedido, pago); } catch (e) { console.error("No se pudo registrar el pedido", e); } }
  const c = correo(pedido);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: env.AVISO_FROM || "By Ana pedidos <onboarding@resend.dev>", to: env.AVISO_EMAIL.split(",").map(s => s.trim()), ...c }),
  });
  if (!r.ok) { const t = (await r.text()).slice(0, 300); console.error("Resend respondió", r.status, t); return new Response("reintentar: Resend respondió " + r.status + " " + t, { status: 500 }); }

  // Confirmación al cliente: solo con remitente de byana.mx (Resend no deja mandar a clientes desde onboarding@resend.dev).
  const para = String(pedido.email || "").trim();
  if (env.AVISO_FROM && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) {
    const rc = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: env.AVISO_FROM, to: [para], reply_to: "ventas@byana.mx", ...correoCliente(pedido) }),
    });
    if (!rc.ok) { const t = (await rc.text()).slice(0, 300); console.error("Correo al cliente falló", rc.status, t); return ok(`enviado a ${env.AVISO_EMAIL}; al cliente falló: ${rc.status} ${t}`); }
    return ok(`enviado a ${env.AVISO_EMAIL} y al cliente ${para}`);
  }
  return ok(`enviado a ${env.AVISO_EMAIL}; al cliente no (${env.AVISO_FROM ? "el pago no trae correo" : "falta AVISO_FROM"})`);
}

// Guarda el pedido en la cuenta, marca que esta persona ya compró y, si llegó recomendada y es su primera compra,
// crea un cupón de $100 para quien la recomendó y se lo manda por correo.
export async function registrar(env, pedido, pago) {
  const marca = "pago:" + pago.id;
  if (await env.BYANA.get(marca)) return;
  await env.BYANA.put(marca, "1", { expirationTtl: 400 * 86400 });
  if (pedido.cupon) await sumarUso(env, pedido.cupon);

  const correos = [...new Set([limpiarCorreo(pedido.cuenta), limpiarCorreo(pedido.email)].filter(correoValido))];
  const tel = soloTel(pedido.telefono);
  const marcas = [...correos.map(e => "compro:" + e), ...(tel.length === 10 ? ["compro:tel:" + tel] : [])];
  let yaCompro = false;
  for (const m of marcas) if (await env.BYANA.get(m)) yaCompro = true;
  for (const m of marcas) await env.BYANA.put(m, "1");

  // Historial en la cuenta (la de la sesión, o una cuenta que tenga el mismo correo del pago).
  const resumen = { ref: pedido.ref, fecha: pago.date_approved || new Date().toISOString(), total: pedido.total,
    productos: pedido.productos.filter(i => !/env[ií]o/i.test(i.t)).map(i => `${i.q} × ${i.t}`).slice(0, 20), envio: pedido.envio };
  for (const e of correos) {
    const c = await leerCliente(env, e);
    if (!c) continue;
    c.pedidos = [...(c.pedidos || []).filter(p => p.ref !== resumen.ref), resumen].slice(-50);
    await guardarCliente(env, c);
  }

  if (!pedido.referido || yaCompro) return;
  const rf = await leerReferido(env, pedido.referido);
  if (!rf || correos.includes(rf.email) || (rf.tel && rf.tel === tel)) return;
  const quien = await leerCliente(env, rf.email);
  if (!quien) return;
  let codigo = "";
  for (let i = 0; i < 6 && !codigo; i++) { const x = "GRACIAS-" + aleatorio(5); if (!(await env.BYANA.get("cupon:" + x))) codigo = x; }
  const amigo = String(pedido.cliente || "").split(" ")[0];
  const cupon = { codigo, tipo: "monto", valor: PREMIO_REFERIDO, minimo: 0, vence: "", usosMax: 1, usos: 0, activo: true,
    nota: `Por recomendar a ${amigo || "un amigo"} (${pedido.ref}) · ${rf.email}`.slice(0, 120), origen: "referido", para: rf.email, creado: new Date().toISOString() };
  await env.BYANA.put("cupon:" + codigo, JSON.stringify(cupon));
  quien.cupones = [...(quien.cupones || []), codigo];
  quien.referidos = (quien.referidos || 0) + 1;
  await guardarCliente(env, quien);
  const nombre = (quien.nombre || "").split(" ")[0];
  await enviarCorreo(env, rf.email, {
    subject: `¡Ganaste $${PREMIO_REFERIDO} en By Ana!`,
    html: marco(`<h1 style="margin:0 0 10px;font-size:20px;color:#4F6B55">¡Gracias por recomendarnos${nombre ? ", " + esc(nombre) : ""}!</h1>
      <p style="margin:0 0 14px">${amigo ? esc(amigo) : "Alguien que recomendaste"} hizo su primera compra con tu código. Aquí tienes <b>$${PREMIO_REFERIDO} de descuento</b> para tu próximo pedido:</p>
      <p style="margin:0 0 14px;text-align:center;font:600 22px ui-monospace,Menlo,monospace;letter-spacing:.08em;color:#A8312F;border:1px dashed #B8955A;border-radius:4px;padding:12px">${codigo}</p>
      <p style="margin:0">Escríbelo en el carrito de <a href="https://byana.mx" style="color:#4F6B55">byana.mx</a> o úsalo desde tu cuenta. Es de un solo uso.</p>`),
    text: `¡Gracias por recomendarnos! ${amigo || "Alguien que recomendaste"} hizo su primera compra con tu código. Tu cupón de $${PREMIO_REFERIDO} para tu próximo pedido es ${codigo} (un solo uso). Úsalo en byana.mx.`,
  });
}
