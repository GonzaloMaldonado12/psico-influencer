// Fondos de «box de atención» dibujados por código (sin imágenes con derechos): consulta, estudio y oficina.
// Se dibujan nítidos y luego se desenfocan como lo haría un lente con poca profundidad de campo;
// así la persona destaca y el fondo no delata que es virtual.

function mulberry(a) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCENES = {
  calido: { label: 'Box cálido', wall: ['#e9dccb', '#cdb79c'], wood: '#8a5a3b', accent: '#7d9b76', glow: '255,214,150', art: ['#c98f6b', '#e8c9a0', '#7d9b76'], shelf: 'left', light: 0.34 },
  claro: { label: 'Box claro', wall: ['#f3f1ee', '#d9d6d1'], wood: '#b9906a', accent: '#6f9a87', glow: '255,244,225', art: ['#9db4c0', '#e3d5c5', '#c9a28f'], shelf: 'right', light: 0.42 },
  sereno: { label: 'Box sereno', wall: ['#b7c4b3', '#8fa18d'], wood: '#6e4a33', accent: '#d9b98a', glow: '255,228,180', art: ['#e6d3b3', '#7a8f7a', '#c48f73'], shelf: 'left', light: 0.3 },
  oficina: { label: 'Oficina azul', wall: ['#cfd8df', '#9fb0bd'], wood: '#5d6b77', accent: '#d8a657', glow: '240,248,255', art: ['#3e5c76', '#d6dde3', '#d8a657'], shelf: 'right', light: 0.4 },
  estudio: { label: 'Estudio oscuro', wall: ['#2d2a33', '#1a181e'], wood: '#3a2d26', accent: '#ff9f5a', glow: '255,160,90', art: ['#4b4458', '#6b5a7a', '#ff9f5a'], shelf: 'left', light: 0.25 },
};

const BOOKS = ['#6d4c41', '#8d6e63', '#37474f', '#546e7a', '#9c7a5b', '#a1887f', '#455a64', '#b08968', '#5d4037', '#7b8f7a', '#b5a58f', '#8a9a9b'];

function leaf(ctx, x, y, len, ang, w, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const g = ctx.createLinearGradient(0, 0, 0, -len);
  g.addColorStop(0, 'rgba(20,35,20,0.85)');
  g.addColorStop(0.5, color);
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, -len / 2, w, len / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, w * 0.08);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -len * 0.95);
  ctx.stroke();
  ctx.restore();
}

function drawRoom(ctx, W, H, key) {
  const s = SCENES[key] || SCENES.calido;
  const rnd = mulberry(key.length * 97 + 13);
  const m = Math.min(W, H);
  const dark = key === 'estudio';

  // Pared con luz suave
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, s.wall[0]);
  wall.addColorStop(1, s.wall[1]);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);
  const side = s.shelf === 'left' ? 1 : 0;
  const gl = ctx.createRadialGradient(W * (side ? 0.78 : 0.22), H * 0.22, 0, W * (side ? 0.78 : 0.22), H * 0.22, Math.max(W, H) * 0.7);
  gl.addColorStop(0, `rgba(${s.glow},${s.light})`);
  gl.addColorStop(1, `rgba(${s.glow},0)`);
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, W, H);

  // Haz de luz de ventana sobre la pared (da profundidad y dirección a la luz)
  ctx.fillStyle = `rgba(${s.glow},${dark ? 0.05 : 0.13})`;
  ctx.beginPath();
  const bx = side ? W * 0.5 : W * 0.05;
  ctx.moveTo(bx, 0);
  ctx.lineTo(bx + W * 0.3, 0);
  ctx.lineTo(bx + W * (side ? 0.55 : 0.75), H);
  ctx.lineTo(bx + W * (side ? 0.15 : 0.35), H);
  ctx.fill();

  // Zócalo / friso
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, H * 0.9, W, H * 0.012);
  ctx.fillStyle = dark ? 'rgba(0,0,0,0.25)' : 'rgba(80,60,40,0.12)';
  ctx.fillRect(0, H * 0.912, W, H * 0.088);

  // Librero
  const sw = W * (W > H ? 0.26 : 0.4);
  const sx = side ? W * 0.015 : W - sw - W * 0.015;
  const sy = H * 0.3;
  const sh = H * 0.68;
  ctx.fillStyle = s.wood;
  ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(sx + sw * 0.03, sy + sh * 0.02, sw * 0.94, sh * 0.96);
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const ry = sy + (sh * (r + 1)) / rows - m * 0.012;
    const rowH = sh / rows;
    let x = sx + sw * 0.05;
    const end = sx + sw * 0.95;
    while (x < end - m * 0.02) {
      const pick = rnd();
      if (pick < 0.78) {
        const bw = m * (0.014 + rnd() * 0.022);
        const bh = rowH * (0.55 + rnd() * 0.32);
        ctx.fillStyle = BOOKS[Math.floor(rnd() * BOOKS.length)];
        const bwc = Math.min(bw, end - x);
        ctx.fillRect(x, ry - bh, bwc, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x, ry - bh + bh * 0.1, bwc, Math.max(1, m * 0.003));
        ctx.fillRect(x, ry - bh * 0.18, bwc, Math.max(1, m * 0.003));
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x + bwc * 0.86, ry - bh, bwc * 0.14, bh);
        x += bw + m * 0.002;
      } else if (pick < 0.9) {
        const vw = m * 0.05;
        ctx.fillStyle = s.accent;
        ctx.beginPath();
        ctx.ellipse(x + vw / 2, ry - rowH * 0.2, vw / 2, rowH * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        leaf(ctx, x + vw / 2, ry - rowH * 0.36, rowH * 0.3, -0.3, m * 0.012, '#6f8f6b');
        leaf(ctx, x + vw / 2, ry - rowH * 0.36, rowH * 0.26, 0.4, m * 0.011, '#7fa07a');
        x += vw + m * 0.012;
      } else {
        const fw = m * 0.06;
        ctx.fillStyle = s.wood;
        ctx.fillRect(x, ry - rowH * 0.45, fw, rowH * 0.45);
        ctx.fillStyle = s.art[Math.floor(rnd() * 3)];
        ctx.fillRect(x + fw * 0.1, ry - rowH * 0.45 + fw * 0.1, fw * 0.8, rowH * 0.45 - fw * 0.2);
        x += fw + m * 0.012;
      }
    }
    ctx.fillStyle = s.wood;
    ctx.fillRect(sx, ry, sw, m * 0.014);
    const sg = ctx.createLinearGradient(0, ry + m * 0.014, 0, ry + m * 0.05);
    sg.addColorStop(0, 'rgba(0,0,0,0.35)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx + sw * 0.03, ry + m * 0.014, sw * 0.94, m * 0.036);
  }

  // Cuadro en la pared
  const aw = W * (W > H ? 0.14 : 0.26);
  const ah = aw * 1.25;
  const ax = side ? W * 0.66 : W * 0.12;
  const ay = H * 0.1;
  ctx.fillStyle = dark ? '#15131a' : '#f8f5f0';
  ctx.fillRect(ax - m * 0.012, ay - m * 0.012, aw + m * 0.024, ah + m * 0.024);
  ctx.fillStyle = s.art[0];
  ctx.fillRect(ax, ay, aw, ah);
  ctx.fillStyle = s.art[1];
  ctx.beginPath();
  ctx.arc(ax + aw * 0.5, ay + ah * 0.42, aw * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = s.art[2];
  ctx.fillRect(ax, ay + ah * 0.72, aw, ah * 0.28);

  // Planta grande
  const px = side ? W * 0.86 : W * 0.14;
  const py = H * 0.98;
  ctx.fillStyle = dark ? '#3d3540' : '#c7b39a';
  ctx.beginPath();
  ctx.moveTo(px - m * 0.06, py - m * 0.12);
  ctx.lineTo(px + m * 0.06, py - m * 0.12);
  ctx.lineTo(px + m * 0.045, py);
  ctx.lineTo(px - m * 0.045, py);
  ctx.fill();
  const greens = ['#5f8a5b', '#6e9a68', '#4f7a4e', '#7aa574'];
  for (let i = 0; i < 16; i++) {
    const ang = -1.3 + (i / 15) * 2.6;
    leaf(ctx, px, py - m * 0.12, m * (0.22 + rnd() * 0.16), ang, m * 0.035, greens[i % 4]);
  }

  // Luces bokeh cálidas (lámpara, guirnalda)
  for (let i = 0; i < 9; i++) {
    const x = (side ? 0.55 + rnd() * 0.4 : 0.05 + rnd() * 0.4) * W;
    const y = H * (0.04 + rnd() * 0.22);
    const r = m * (0.02 + rnd() * 0.035);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(${s.glow},${dark ? 0.75 : 0.5})`);
    rg.addColorStop(1, `rgba(${s.glow},0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Viñeta suave
  const vg = ctx.createRadialGradient(W / 2, H / 2, m * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${dark ? 0.35 : 0.16})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

/** Dibuja la escena en ctx (W×H) con desenfoque de lente. */
export function drawScene(ctx, W, H, key) {
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  drawRoom(tmp.getContext('2d'), W, H, key);
  const blur = Math.max(3, Math.round(Math.min(W, H) * 0.011));
  ctx.save();
  if ('filter' in ctx) {
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(tmp, -blur, -blur, W + blur * 2, H + blur * 2);
  } else {
    // Sin filtro de lienzo (Safari antiguo): reducir y ampliar suaviza lo mismo.
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(W / 6));
    small.height = Math.max(1, Math.round(H / 6));
    small.getContext('2d').drawImage(tmp, 0, 0, small.width, small.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
  }
  // Grano fino de sensor sobre el fondo: el fondo desenfocado de una cámara real nunca es liso.
  const n = document.createElement('canvas');
  n.width = Math.min(W, 512);
  n.height = Math.min(H, 512);
  const nx = n.getContext('2d');
  const id = nx.createImageData(n.width, n.height);
  const rnd = mulberry(99);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = rnd() > 0.5 ? 255 : 0;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 7 + Math.floor(rnd() * 8);
  }
  nx.putImageData(id, 0, 0);
  ctx.filter = 'none';
  ctx.fillStyle = ctx.createPattern(n, 'repeat');
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
