// Notificaciones push (Web Push) para la app de administración.
// Las llaves VAPID se crean solas la primera vez y se guardan en el KV (llave "vapid"), así no hay que configurar nada.
// Cada aparato suscrito se guarda como push:<hash del endpoint> → { endpoint, keys: { p256dh, auth }, nombre, creado }.
// El contenido va cifrado como pide el estándar (RFC 8291, aes128gcm) y firmado con VAPID (RFC 8292).

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const deB64u = s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const unir = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), data));

export async function vapid(env) {
  let v = await env.BYANA.get("vapid", "json");
  if (!v) {
    const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { privada: await crypto.subtle.exportKey("jwk", k.privateKey), publica: b64u(await crypto.subtle.exportKey("raw", k.publicKey)) };
    await env.BYANA.put("vapid", JSON.stringify(v));
  }
  return v;
}

async function firma(v, endpoint) {
  const aud = new URL(endpoint).origin;
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:ventas@byana.mx" })));
  const key = await crypto.subtle.importKey("jwk", v.privada, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(h + "." + p));
  return `vapid t=${h}.${p}.${b64u(s)}, k=${v.publica}`;
}

// Cifra el mensaje para un aparato (RFC 8291).
export async function cifrar(sub, texto) {
  const uaPub = deB64u(sub.keys.p256dh), auth = deB64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, unir(enc.encode("WebPush: info\0"), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, unir(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, unir(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, unir(enc.encode(texto), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return unir(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export const idSub = async endpoint => [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(endpoint)))].slice(0, 12).map(x => x.toString(16).padStart(2, "0")).join("");

// Manda { title, body, url } a todos los aparatos suscritos. Borra los que ya no existen (404/410).
export async function avisarAdmins(env, msg) {
  if (!env.BYANA) return 0;
  const v = await vapid(env);
  const r = await env.BYANA.list({ prefix: "push:" });
  let n = 0;
  for (const k of r.keys) {
    const sub = await env.BYANA.get(k.name, "json");
    if (!sub) continue;
    try {
      const res = await fetch(sub.endpoint, {
        method: "POST",
        headers: { Authorization: await firma(v, sub.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
        body: await cifrar(sub, JSON.stringify(msg)),
      });
      if (res.status === 404 || res.status === 410) await env.BYANA.delete(k.name);
      else if (!res.ok) console.error("Push respondió", res.status, (await res.text()).slice(0, 200));
      else n++;
    } catch (e) { console.error("Push falló", e); }
  }
  return n;
}
