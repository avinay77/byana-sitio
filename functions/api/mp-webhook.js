// Cloudflare Pages Function: /api/mp-webhook
// Mercado Pago avisa aquí cada pago. Con cada pago APROBADO consultamos el pago en la API de Mercado Pago
// (así nadie puede inventar un pedido) y le mandamos a Ana un correo con el pedido completo usando Resend.
// Variables: MP_ACCESS_TOKEN, RESEND_API_KEY (secretos) y AVISO_EMAIL (a dónde llegan los pedidos).
// Opcional: AVISO_FROM, p. ej. "By Ana <pedidos@byana.mx>" cuando el dominio esté verificado en Resend.
const money = n => "$" + Number(n || 0).toLocaleString("es-MX");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function armarPedido(pago) {
  const md = pago.metadata || {};
  const items = (pago.additional_info && pago.additional_info.items) || [];
  return {
    ref: pago.external_reference || "",
    cliente: md.cliente || [pago.payer && pago.payer.first_name, pago.payer && pago.payer.last_name].filter(Boolean).join(" "),
    telefono: md.telefono || "",
    email: (pago.payer && pago.payer.email) || "",
    productos: items.map(i => ({ t: i.title, q: Number(i.quantity), p: Number(i.unit_price), d: i.description || "" })),
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
  <tr><td style="padding:8px 0"><b>Total pagado</b></td><td style="text-align:right"><b>${esc(o.total)}</b></td></tr></table>
  <p style="margin:0"><b>Entrega:</b> ${esc(o.envio || "—")}${o.direccion ? `<br><b>Dirección:</b> ${esc(o.direccion)}` : ""}</p></div>`;
  const text = `Nuevo pedido pagado ${o.ref}\n${o.cliente} · ${o.telefono}\n` +
    o.productos.map(i => `${i.q} × ${i.t}${i.d ? ` (${i.d})` : ""} = ${money(i.p * i.q)}`).join("\n") +
    `\nTotal: ${o.total}\nEntrega: ${o.envio}\n${o.direccion ? "Dirección: " + o.direccion : ""}`;
  return { subject: `Nuevo pedido ${o.ref} · ${o.total} · ${o.cliente}`, html, text };
}

export async function onRequest({ request, env }) {
  const ok = (b = "ok") => new Response(b, { status: 200 });
  const url = new URL(request.url);
  let b = {};
  try { b = await request.json(); } catch {}
  const tipo = b.type || url.searchParams.get("type") || url.searchParams.get("topic");
  const id = String((b.data && b.data.id) || url.searchParams.get("data.id") || url.searchParams.get("id") || "").replace(/\D/g, "");
  const accion = b.action || "";
  if (!env.MP_ACCESS_TOKEN || tipo !== "payment" || !id) return ok("ignorado");

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
  if (!res.ok) { console.error("No se pudo leer el pago", id, res.status); return new Response("reintentar", { status: 500 }); }
  const pago = await res.json();
  if (pago.status !== "approved") return ok("no aprobado");

  // Mercado Pago manda varios avisos por pago: avisamos con el de creación (tarjeta, se aprueba al instante)
  // o con la actualización cuando la aprobación llegó después (OXXO, transferencia).
  const tarde = new Date(pago.date_approved) - new Date(pago.date_created) > 60000;
  if (accion === "payment.updated" && !tarde) return ok("repetido");
  if (accion === "payment.created" && tarde) return ok("pendiente");

  if (!env.RESEND_API_KEY || !env.AVISO_EMAIL) { console.error("Falta RESEND_API_KEY o AVISO_EMAIL"); return ok("sin correo"); }
  const c = correo(armarPedido(pago));
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: env.AVISO_FROM || "By Ana pedidos <onboarding@resend.dev>", to: env.AVISO_EMAIL.split(",").map(s => s.trim()), ...c }),
  });
  if (!r.ok) { console.error("Resend respondió", r.status, (await r.text()).slice(0, 300)); return new Response("reintentar", { status: 500 }); }
  return ok("enviado");
}
