// Registro de pedidos pagados en el KV (binding BYANA), para administrarlos en admin.html.
//   pedido:<ref> → { ref, fecha, estado, historial, cliente, telefono, email, cuenta, productos, cupon, descuento,
//                   referido, envio, direccion, total, totalNum, pago, guia, notaInterna }
// La lista usa los metadatos de KV (fecha, cliente, total, estado) para no leer cada pedido.

export const ESTADOS = {
  pagado: "Pagado",
  preparacion: "En preparación",
  enviado: "Enviado",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

const meta = p => ({ fecha: p.fecha, cliente: String(p.cliente || "").slice(0, 60), total: p.total, estado: p.estado, piezas: p.piezas || 0 });

export async function guardarPedido(env, p) {
  await env.BYANA.put("pedido:" + p.ref, JSON.stringify(p), { metadata: meta(p) });
}

export const leerPedido = (env, ref) => env.BYANA.get("pedido:" + String(ref || "").replace(/[^A-Z0-9-]/gi, ""), "json");

// Se llama desde el webhook con cada pago aprobado. Si el pedido ya existe, solo completa datos sin tocar su estado.
// Devuelve true si el pedido es nuevo.
export async function registrarPedido(env, pedido, pago) {
  if (!pedido.ref) return false;
  const prev = await leerPedido(env, pedido.ref);
  const p = {
    ...pedido,
    fecha: (prev && prev.fecha) || pago.date_approved || new Date().toISOString(),
    estado: (prev && prev.estado) || "pagado",
    historial: (prev && prev.historial) || [{ estado: "pagado", fecha: pago.date_approved || new Date().toISOString() }],
    totalNum: Number(pago.transaction_amount) || 0,
    piezas: pedido.productos.filter(i => !/env[ií]o/i.test(i.t)).reduce((s, i) => s + (Number(i.q) || 0), 0),
    guia: (prev && prev.guia) || "",
    notaInterna: (prev && prev.notaInterna) || "",
  };
  await guardarPedido(env, p);
  return !prev;
}
