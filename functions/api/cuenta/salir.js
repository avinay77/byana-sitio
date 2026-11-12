// POST /api/cuenta/salir → cierra la sesión.
import { json, cerrarSesion, cookieSesion } from "../../../lib/cuenta.js";

export async function onRequestPost({ request, env }) {
  await cerrarSesion(env, request);
  return json(200, { ok: true }, { "Set-Cookie": cookieSesion("", request) });
}
