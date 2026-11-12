// /api/admin/visitas?dias=30 — visitas por día, de dónde llegan, aparatos y productos más vistos. Protegido con ADMIN_KEY.
import { json, revisar } from "../../../lib/admin.js";
import { DIAS_CRUDO, TOPE_DIA, diaMX, restarDias, resumirDia } from "../../../lib/visitas.js";

const juntar = (a, b) => { for (const [k, n] of Object.entries(b || {})) a[k] = (a[k] || 0) + n; return a; };
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

export async function onRequestGet(ctx) {
  const no = revisar(ctx); if (no) return no;
  const { env, request } = ctx;
  const dias = Math.min(90, Math.max(7, Number(new URL(request.url).searchParams.get("dias")) || 30));
  const hoy = diaMX();
  const porDia = [];
  for (let i = dias - 1; i >= 0; i--) {
    const dia = restarDias(hoy, i);
    let r = i > 0 ? await env.BYANA.get(`vd:${dia}`, "json") : null;
    if (!r && i < DIAS_CRUDO) {
      r = await resumirDia(env, dia);
      // Un día ya terminado se guarda resumido (una sola escritura) para cuando se borren las visitas sueltas.
      if (i > 1) await env.BYANA.put(`vd:${dia}`, JSON.stringify(r));
    }
    porDia.push(r || { dia, visitas: 0, personas: 0 });
  }
  const suma = (lista, campo) => lista.reduce((t, d) => t + (d[campo] || 0), 0);
  const tot = n => { const l = porDia.slice(-n); return { visitas: suma(l, "visitas"), personas: suma(l, "personas") }; };
  const acum = { fuentes: {}, aparatos: {}, paginas: {}, productos: {}, carrito: {} };
  for (const d of porDia) for (const k in acum) juntar(acum[k], d[k]);
  return json(200, {
    hoy, tope: TOPE_DIA,
    totales: { hoy: tot(1), semana: tot(7), periodo: tot(dias) },
    dias: porDia.map(d => ({ dia: d.dia, visitas: d.visitas || 0, personas: d.personas || 0 })),
    fuentes: top(acum.fuentes, 12), aparatos: top(acum.aparatos, 4), paginas: top(acum.paginas, 5),
    productos: top(acum.productos, 15), carrito: top(acum.carrito, 10),
  });
}
