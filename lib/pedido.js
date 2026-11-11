// Lógica compartida del carrito: valida el pedido contra catalogo.json y calcula precios y envío.
// Los precios SIEMPRE salen del catálogo del servidor, nunca de lo que mande el navegador.
export const MAX_PIEZAS = 20;
const MAX_NOTA = 100;

export const limpiar = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function validar(pedido, catalogo) {
  const envio = catalogo.envio || { opciones: [] };
  const productos = new Map([...catalogo.navidad, ...catalogo.siempre].map(p => [p.id, p]));
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

  // Envío: el costo sale de catalogo.json, nunca del navegador.
  const op = envio.opciones.find(o => o.id === (pedido.envio && pedido.envio.id));
  if (!op) return { error: "Elige cómo quieres recibir tu pedido." };
  if (op.cotiza || typeof op.p !== "number") return { error: "Ese tipo de envío se cotiza por WhatsApp.", cotiza: true };
  let dir = null;
  if (op.dir) {
    const d = pedido.envio.dir || {};
    dir = { calle: limpiar(d.calle, 100), colonia: limpiar(d.colonia, 60), cp: String(d.cp || "").replace(/\D/g, "").slice(0, 5),
            municipio: limpiar(d.municipio, 60), estado: limpiar(d.estado, 40), refs: limpiar(d.refs, 120) };
    if (!dir.calle || !dir.colonia || !dir.municipio || !dir.estado) return { error: "Completa la dirección de envío." };
    if (dir.cp.length !== 5) return { error: "El código postal debe tener 5 dígitos." };
  }
  const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const gratis = typeof envio.gratisDesde === "number" && subtotal >= envio.gratisDesde;
  const costoEnvio = gratis ? 0 : op.p;
  if (costoEnvio > 0) items.push({ id: "envio-" + op.id, title: op.n, quantity: 1, unit_price: costoEnvio, currency_id: "MXN" });
  return { items, piezas, cliente: { nombre, tel, fecha }, envio: { id: op.id, n: op.n, costo: costoEnvio, dir } };
}

