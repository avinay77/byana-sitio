// Cupones de descuento. Se guardan en Cloudflare KV (binding BYANA) con la llave "cupon:<CÓDIGO>".
// El mismo KV servirá después para "recomienda a un amigo" (cupones creados automáticamente) y cuentas de cliente.
//
// Un cupón es: { codigo, tipo: "pct" | "monto", valor, minimo?, vence? (AAAA-MM-DD, incluido),
//               usosMax?, usos, activo, nota?, origen? ("manual" | "referido"), creado }

export const normalizar = c => String(c || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);

const hoyMX = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // hora de CDMX

export async function leerCupon(env, codigo) {
  const c = normalizar(codigo);
  if (!c || !env.BYANA) return null;
  return env.BYANA.get("cupon:" + c, "json");
}

// Texto corto para mostrar: "10%" o "$100"
export const etiqueta = c => c.tipo === "pct" ? `${c.valor}%` : `$${Number(c.valor).toLocaleString("es-MX")}`;

// ¿Aplica el cupón a este subtotal de productos? Devuelve { ok, descuento } o { ok: false, motivo }.
export function evaluar(c, subtotal) {
  if (!c || !c.activo) return { ok: false, motivo: "Ese cupón no existe o ya no está activo." };
  if (c.vence && hoyMX() > c.vence) return { ok: false, motivo: "Ese cupón ya venció." };
  if (c.usosMax && (c.usos || 0) >= c.usosMax) return { ok: false, motivo: "Ese cupón ya se usó el máximo de veces." };
  if (c.minimo && subtotal < c.minimo) return { ok: false, motivo: `Este cupón aplica en compras desde $${Number(c.minimo).toLocaleString("es-MX")} en productos.` };
  const d = c.tipo === "pct" ? Math.round(subtotal * Math.min(100, c.valor) / 100) : Math.min(Number(c.valor) || 0, subtotal);
  if (!(d > 0)) return { ok: false, motivo: "Ese cupón no aplica a este pedido." };
  return { ok: true, descuento: d };
}

// Datos públicos que el carrito necesita para calcular el descuento (no expone usos ni notas).
export const publico = c => ({ codigo: c.codigo, tipo: c.tipo, valor: c.valor, minimo: c.minimo || 0, etiqueta: etiqueta(c) });

export async function sumarUso(env, codigo) {
  const c = await leerCupon(env, codigo);
  if (!c) return;
  c.usos = (c.usos || 0) + 1;
  await env.BYANA.put("cupon:" + c.codigo, JSON.stringify(c));
}
