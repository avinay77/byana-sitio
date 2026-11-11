// Recibe los avisos de Mercado Pago. Con cada pago APROBADO consulta el pago en la API de
// Mercado Pago (así nadie puede inventar un pedido) y lo registra en el formulario "pedido"
// de Netlify Forms, que guarda el pedido y le manda el correo de aviso a Ana.
const ok = (body = "ok") => ({ statusCode: 200, body });
const money = n => "$" + Number(n || 0).toLocaleString("es-MX");

function idDelAviso(event) {
  const q = event.queryStringParameters || {};
  let b = {};
  try { b = JSON.parse(event.body || "{}"); } catch {}
  const tipo = b.type || q.type || q.topic;
  const id = (b.data && b.data.id) || q["data.id"] || q.id;
  return { tipo, id: id && String(id).replace(/\D/g, ""), accion: b.action || "" };
}

function armarPedido(pago) {
  const md = pago.metadata || {};
  const items = (pago.additional_info && pago.additional_info.items) || [];
  const productos = items.map(i => `${i.quantity} × ${i.title} = ${money(i.unit_price * i.quantity)}${i.description ? ` (${i.description})` : ""}`).join("\n");
  return {
    "form-name": "pedido",
    pedido: pago.external_reference || "",
    estado: pago.status === "approved" ? "Pagado" : pago.status,
    cliente: md.cliente || [pago.payer && pago.payer.first_name, pago.payer && pago.payer.last_name].filter(Boolean).join(" "),
    telefono: md.telefono || "",
    email: (pago.payer && pago.payer.email) || "",
    productos,
    envio: md.envio || "",
    direccion: md.direccion || "",
    total: money(pago.transaction_amount),
    pago_mp: String(pago.id),
  };
}

exports.armarPedido = armarPedido;

exports.handler = async (event) => {
  const token = process.env.MP_ACCESS_TOKEN;
  const { tipo, id, accion } = idDelAviso(event);
  if (!token || tipo !== "payment" || !id) return ok("ignorado");

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error("No se pudo leer el pago", id, res.status); return { statusCode: 500, body: "reintentar" }; }
  const pago = await res.json();
  if (pago.status !== "approved") return ok("no aprobado");

  // Mercado Pago manda varios avisos por pago. Registramos el de creación (tarjeta: se aprueba al instante)
  // o la actualización cuando la aprobación llegó después (OXXO, transferencia).
  const tarde = new Date(pago.date_approved) - new Date(pago.date_created) > 60000;
  if (accion === "payment.updated" && !tarde) return ok("repetido");
  if (accion === "payment.created" && tarde) return ok("pendiente");

  const base = (process.env.URL || "https://byana.netlify.app").replace(/\/$/, "");
  const r = await fetch(`${base}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(armarPedido(pago)).toString(),
  });
  if (!r.ok) { console.error("Netlify Forms respondió", r.status); return { statusCode: 500, body: "reintentar" }; }
  return ok("registrado");
};
