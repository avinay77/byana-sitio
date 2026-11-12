// Revisión de la clave de administración (ADMIN_KEY, secreto en Cloudflare) que admin.html manda en X-Admin-Key.
export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function revisar({ request, env }) {
  if (!env.ADMIN_KEY) return json(503, { error: "Falta la variable ADMIN_KEY en Cloudflare." });
  if (!env.BYANA) return json(503, { error: "Falta conectar el KV con el nombre BYANA en Cloudflare." });
  const k = request.headers.get("X-Admin-Key") || "";
  if (k.length !== env.ADMIN_KEY.length || k !== env.ADMIN_KEY) return json(401, { error: "Clave incorrecta." });
  return null;
}
