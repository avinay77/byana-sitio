// Crea una preferencia de Mercado Pago Checkout Pro con el TOTAL del carrito.
// Los precios salen de catalogo.json (nunca del navegador) para que nadie pueda cambiar el monto.
// Requiere la variable de entorno MP_ACCESS_TOKEN en Netlify (Site configuration → Environment variables).
const catalogo = require("../../catalogo.json");

const MAX_PIEZAS = 20;
const MAX_NOTA = 100;
const productos = new Map([...catalogo.navidad, ...catalogo.siempre].map(p => [p.id, p]));

const limpiar = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function validar(pedido) {
  if (!pedido || !Array.isArray(pedido.items) || !pedido.items.length) return { error: "El carrito está vacío." };
  if (pedido.items.length > MAX_PIEZAS) return { error: "Demasiados productos." };
  let piezas = 0;
  const items = [];
  for (const it of pedido.items) {
    const p = productos.get(it && it.id);
    const v = p && p.v && p.v[it.v];
    const qty = Number(it && it.qty);
    if (!v) return { error: "Hay un producto que ya no está disponible en línea." };
    if (!Number.isInteger(qty) || qty < 1) return { error: "Cantidad inválida." };
    piezas += qty;
    let tag = "";
    if (p.tag && p.tag.v.includes(it.v)) {
      tag = limpiar(it.tag, p.tag.max);
      if (!tag) return { error: `Falta el texto para "${p.t}".` };
    }
    const nota = limpiar(it.nota, MAX_NOTA);
    const titulo = [p.t, v.n, tag && `“${tag}”`].filter(Boolean).join(" · ");
    items.push({ id: p.id, title: titulo.slice(0, 250), description: nota || undefined, quantity: qty, unit_price: v.p, currency_id: "MXN" });
  }
  if (piezas > MAX_PIEZAS) return { error: `En línea el máximo es ${MAX_PIEZAS} piezas por pedido. Para más, escríbenos por WhatsApp.`, limite: true };
  const nombre = limpiar(pedido.cliente && pedido.cliente.nombre, 60);
  const tel = String(pedido.cliente && pedido.cliente.tel || "").replace(/\D/g, "");
  if (nombre.length < 2) return { error: "Escribe tu nombre." };
  if (tel.length < 10 || tel.length > 13) return { error: "Escribe un teléfono de 10 dígitos." };
  const fecha = limpiar(pedido.cliente && pedido.cliente.fecha, 10);
  return { items, piezas, cliente: { nombre, tel, fecha } };
}

exports.validar = validar;

exports.handler = async (event) => {
  const token = process.env.MP_ACCESS_TOKEN;
  // GET: el sitio pregunta si el pago en línea ya está activo para mostrar u ocultar el botón.
  if (event.httpMethod === "GET") return json(200, { activo: !!token });
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  if (!token) return json(503, { error: "El pago en línea todavía no está activo.", sinConfigurar: true });

  let pedido;
  try { pedido = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Pedido inválido." }); }
  const r = validar(pedido);
  if (r.error) return json(400, r);

  const base = (process.env.URL || "https://byana.netlify.app").replace(/\/$/, "");
  const ref = "BA-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const preferencia = {
    items: r.items,
    payer: { name: r.cliente.nombre, phone: { number: r.cliente.tel } },
    external_reference: ref,
    statement_descriptor: "BYANA",
    back_urls: { success: `${base}/?pago=ok`, pending: `${base}/?pago=pendiente`, failure: `${base}/?pago=error` },
    auto_return: "approved",
    metadata: { cliente: r.cliente.nombre, telefono: r.cliente.tel, fecha_entrega: r.cliente.fecha, piezas: r.piezas },
  };
  if (process.env.MP_WEBHOOK_URL) preferencia.notification_url = process.env.MP_WEBHOOK_URL;

  try {
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Idempotency-Key": ref },
      body: JSON.stringify(preferencia),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.init_point) {
      console.error("Mercado Pago respondió", res.status, JSON.stringify(data).slice(0, 500));
      const motivo = [res.status, data.error, data.message].filter(Boolean).join(" · ").slice(0, 160);
      return json(502, { error: "No pudimos conectar con Mercado Pago. Intenta de nuevo o pide por WhatsApp.", motivo });
    }
    const total = r.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    return json(200, { url: data.init_point, ref, total });
  } catch (e) {
    console.error(e);
    return json(502, { error: "No pudimos conectar con Mercado Pago. Intenta de nuevo o pide por WhatsApp." });
  }
};
