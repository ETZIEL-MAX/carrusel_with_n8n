// Firma de peticiones al carrusel. Fuente única: se pega igual en todos los nodos "Firmar…".
// HMAC-SHA256 en JS puro: este n8n no permite el modulo nativo crypto en nodos Code.
function utf8Bytes(s) {
  var o = [], i, c;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00); }
    if (c < 0x80) { o.push(c); }
    else if (c < 0x800) { o.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
    else if (c < 0x10000) { o.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    else { o.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return o;
}
var SHA_K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function sha256(bytes) {
  var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
  var m = new Uint8Array(total), w = new Int32Array(64), i, t;
  m.set(bytes); m[len] = 0x80;
  var bits = len * 8;
  m[total - 1] = bits & 255; m[total - 2] = (bits >>> 8) & 255; m[total - 3] = (bits >>> 16) & 255; m[total - 4] = (bits >>> 24) & 255;
  m[total - 5] = Math.floor(bits / 4294967296) & 255;
  for (i = 0; i < total; i += 64) {
    for (t = 0; t < 16; t++) { w[t] = (m[i + t * 4] << 24) | (m[i + t * 4 + 1] << 16) | (m[i + t * 4 + 2] << 8) | m[i + t * 4 + 3]; }
    for (t = 16; t < 64; t++) {
      var x = w[t - 15], y = w[t - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (t = 0; t < 64; t++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var t1 = (k + S1 + ((e & f) ^ (~e & g)) + SHA_K[t] + w[t]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
  }
  var out = [];
  for (i = 0; i < 8; i++) { out.push((h[i] >>> 24) & 255, (h[i] >>> 16) & 255, (h[i] >>> 8) & 255, h[i] & 255); }
  return out;
}
function hmacSha256Hex(key, msg) {
  var k = utf8Bytes(key), i;
  if (k.length > 64) { k = sha256(k); }
  var ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (i = 0; i < 64; i++) { var kb = i < k.length ? k[i] : 0; ipad[i] = kb ^ 0x36; opad[i] = kb ^ 0x5c; }
  var mb = utf8Bytes(msg), inner = new Uint8Array(64 + mb.length);
  inner.set(ipad); inner.set(mb, 64);
  var ih = sha256(inner), outer = new Uint8Array(96);
  outer.set(opad); outer.set(ih, 64);
  var oh = sha256(outer), hex = '';
  for (i = 0; i < oh.length; i++) { hex += (oh[i] < 16 ? '0' : '') + oh[i].toString(16); }
  return hex;
}

// Firma el cuerpo con el token de la fila del cliente (tabla whatsapp_numeros).
//   token crt_…  -> HMAC(token, '<timestamp>.<cuerpo>')   (token propio del cliente)
//   otro valor   -> HMAC(token, '<cuerpo>')               (secreto global antiguo)
// El timestamp se devuelve siempre: va en la cabecera X-Webhook-Timestamp.
function firmar(token, body, nowMs) {
  var t = String(token == null ? '' : token).trim();
  if (!t) { throw new Error('Este cliente no tiene token en la tabla whatsapp_numeros'); }
  var timestamp = String(Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000));
  var firmado = t.indexOf('crt_') === 0 ? timestamp + '.' + body : body;
  return { body: body, signature: hmacSha256Hex(t, firmado), timestamp: timestamp };
}
