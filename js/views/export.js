// Exportación por plataforma (calidad óptima y peso adecuado) + centro de publicación.
import { h, icon, toast, modal, segmented, toggle, progressModal, textInput } from '../lib/dom.js';
import { fmtTime, fmtBytes, sanitizeFilename, uid } from '../lib/util.js';
import { addMedia, saveProject, saveSettings, mediaUrl } from '../store.js';
import { db } from '../lib/db.js';
import { ExportSession } from '../core/exporter.js';
import { proExport, proExportSupport } from '../core/pro-export.js';
import { IS_MOBILE, IS_IOS } from '../lib/util.js';
import { PLATFORMS, PLATFORM_GROUPS, fitToPlatform, estimateMB } from '../core/platforms.js';
import { buildSegments } from '../core/timeline.js';
import { captionCues, toSRT, buildCaptionIndex } from '../core/captions.js';
import { generatePost, PLATFORMS as POST_PLATFORMS } from '../core/script-tools.js';
import { shareFile, downloadBlob } from './share.js';
import { copyText } from './script-dialogs.js';

const QUALITY = { max: { label: 'Máxima', f: 1 }, balanced: { label: 'Equilibrada', f: 0.7 }, light: { label: 'Liviana', f: 0.45 } };

export const OPEN_LINKS = {
  'ig-reels': ['Instagram', 'https://www.instagram.com/'],
  'ig-feed': ['Instagram', 'https://www.instagram.com/'],
  'ig-stories': ['Instagram', 'https://www.instagram.com/'],
  'fb-reels': ['Meta Business Suite', 'https://business.facebook.com/latest/content_calendar'],
  'fb-feed': ['Meta Business Suite', 'https://business.facebook.com/latest/content_calendar'],
  tiktok: ['TikTok Studio', 'https://www.tiktok.com/tiktokstudio/upload'],
  'yt-shorts': ['YouTube Studio', 'https://studio.youtube.com/'],
  'yt-1080': ['YouTube Studio', 'https://studio.youtube.com/'],
  'yt-4k': ['YouTube Studio', 'https://studio.youtube.com/'],
  'google-ads': ['Google Ads', 'https://ads.google.com/'],
  linkedin: ['LinkedIn', 'https://www.linkedin.com/feed/?shareActive=true'],
  x: ['X', 'https://x.com/compose/post'],
  pinterest: ['Pinterest', 'https://www.pinterest.com/pin-creation-tool/'],
  whatsapp: ['WhatsApp', null],
};

const POST_KEY = { 'ig-reels': 'instagram', 'ig-feed': 'instagram', 'ig-stories': 'instagram', 'fb-reels': 'facebook', 'fb-feed': 'facebook', tiktok: 'tiktok', 'yt-shorts': 'youtube', 'yt-1080': 'youtube', 'yt-4k': 'youtube', linkedin: 'linkedin', x: 'x' };

function defaultPlatforms(aspect) {
  return { '9:16': ['ig-reels', 'tiktok', 'yt-shorts'], '1:1': ['fb-feed', 'linkedin'], '4:5': ['ig-feed'], '16:9': ['yt-1080'] }[aspect] || [];
}

/** Agrupa plataformas que comparten resolución en un solo archivo. */
// Plataformas que aceptan y reproducen bien 60 fps.
const FPS60 = new Set(['ig-reels', 'fb-reels', 'tiktok', 'yt-shorts', 'yt-1080', 'yt-4k']);

/** srcFps: fotogramas por segundo con que se grabó; si es 60 y la plataforma lo admite, se conservan. */
export function planFiles(keys, total, qualityF = 1, srcFps = 30) {
  const groups = new Map();
  for (const k of keys) {
    const p = PLATFORMS[k];
    const id = `${p.aspect}|${p.w}x${p.h}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(k);
  }
  return [...groups.values()].map((ks) => {
    const ps = ks.map((k) => PLATFORMS[k]);
    const fits = ps.map((p) => fitToPlatform(p, total));
    const maxV = Math.max(...ps.map((p) => p.vbr));
    const fps = srcFps >= 50 && ks.every((k) => FPS60.has(k)) ? 60 : 30;
    const vbr = Math.round(Math.min(maxV * qualityF * (fps === 60 ? 1.3 : 1), ...fits.map((f) => f.vbr * (fps === 60 ? 1.3 : 1))));
    const abr = Math.max(...ps.map((p) => p.abr));
    const small = fits.find((f) => f.w !== ps[0].w);
    return {
      keys: ks,
      spec: { aspect: ps[0].aspect, w: small ? small.w : ps[0].w, h: small ? small.h : ps[0].h, fps, vbr, abr },
      warnings: [...new Set(fits.flatMap((f) => f.warnings))],
      mb: ((vbr + abr) * total) / 8e6,
    };
  });
}

export async function openExport({ project, brand, assets, analysis, settings, onSaved }) {
  const total = buildSegments(project).total;
  if (!total) return toast('El video está vacío: restaura algún corte.');
  const support = await proExportSupport();
  const saved = await db.getKV('exportPlatforms', null);
  const selected = new Set((saved?.[project.layout.aspect] || defaultPlatforms(project.layout.aspect)).filter((k) => PLATFORMS[k]));
  let quality = settings.exportQualityLevel || 'max';
  let normalize = settings.normalizeAudio !== false;
  let session = null;
  const summary = h('div', { class: 'export-summary' });
  const updSummary = () => {
    const plan = planFiles([...selected], total, QUALITY[quality].f, project.recFps || 30);
    summary.replaceChildren(
      plan.length
        ? h('div', null,
            h('p', null, h('b', null, `${plan.length} archivo${plan.length > 1 ? 's' : ''}`), ` · duración ${fmtTime(total)} · ${support.ok ? 'exportación profesional cuadro a cuadro (H.264 + AAC)' : 'exportación en tiempo real'}`),
            h('ul', { class: 'install-steps' },
              plan.map((f) => h('li', null, `${f.spec.w}×${f.spec.h} para ${f.keys.map((k) => PLATFORMS[k].label).join(', ')} · ~${f.mb.toFixed(f.mb < 10 ? 1 : 0)} MB`, f.warnings.length ? h('div', { class: 'hint', style: { color: 'var(--warn)' } }, f.warnings.join(' ')) : ''))
            )
          )
        : h('p', { class: 'muted' }, 'Elige al menos una red social.')
    );
  };
  const groups = PLATFORM_GROUPS.map((g) =>
    h('div', { class: 'plat-group' },
      h('h3', null, g),
      h('div', { class: 'plat-grid' },
        Object.entries(PLATFORMS).filter(([k, p]) => p.group === g && !(IS_MOBILE && k === 'yt-4k')).map(([k, p]) => {
          const cb = h('input', { type: 'checkbox', 'aria-label': p.label });
          cb.checked = selected.has(k);
          cb.addEventListener('change', () => {
            if (cb.checked) selected.add(k);
            else selected.delete(k);
            updSummary();
          });
          const same = p.aspect === project.layout.aspect;
          return h('label', { class: `plat${same ? '' : ' other'}` }, cb, h('div', null, h('b', null, p.label), h('small', null, `${p.aspect} · ${p.w}×${p.h} · ~${estimateMB(p, total).toFixed(estimateMB(p, total) < 10 ? 1 : 0)} MB`)));
        })
      )
    )
  );
  updSummary();
  const choice = await modal({
    title: 'Exportar para redes',
    wide: true,
    body: h('div', null,
      h('p', { class: 'hint' }, 'Cada red tiene su resolución, peso y formato óptimos. Si eliges un formato distinto al del proyecto, se adapta automáticamente (encuadre, título y subtítulos).'),
      ...groups,
      segmented({ label: 'Calidad', value: quality, options: Object.entries(QUALITY).map(([k, q]) => [k, q.label]), onChange: (v) => { quality = v; updSummary(); } }),
      toggle({ label: 'Volumen estándar de redes (-14 LUFS)', hint: 'Evita que tu video suene más bajo que el resto.', checked: normalize, onChange: (v) => (normalize = v) }),
      summary,
      h('p', { class: 'hint' }, 'Mantén la app abierta mientras exporta. Todo se procesa en tu dispositivo.')
    ),
    actions: [
      { label: 'Cancelar', value: null },
      {
        label: 'Exportar',
        kind: 'primary',
        validate: () => selected.size > 0 || (toast('Elige al menos una red social'), false),
        value: () => {
          if (!support.ok) {
            // En iPhone sin WebCodecs completo: sesión creada dentro del toque.
            try {
              session = new ExportSession({ project, brand, assets, analysis, urlFor: mediaUrl });
            } catch (e) {
              toast(e.message, 'error', 6000);
              return null;
            }
          }
          return 'go';
        },
      },
    ],
  });
  if (choice !== 'go') return;
  settings.exportQualityLevel = quality;
  settings.normalizeAudio = normalize;
  saveSettings(settings);
  await db.setKV('exportPlatforms', { ...(saved || {}), [project.layout.aspect]: [...selected] });
  let wake = null;
  try {
    wake = await navigator.wakeLock?.request('screen');
  } catch {
    /* no soportado */
  }
  const plan = planFiles([...selected], total, QUALITY[quality].f, project.recFps || 30);
  const prog = progressModal('Exportando…');
  const results = [];
  try {
    for (let i = 0; i < plan.length; i++) {
      const f = plan[i];
      const label = `${f.spec.w}×${f.spec.h} (${i + 1}/${plan.length})`;
      const onProgress = (p, text) => prog.set((i + p) / plan.length, `${label} · ${text || `${Math.round(p * 100)}%`}`);
      const res = support.ok
        ? await proExport({ project, brand, assets, analysis, spec: f.spec, normalize, onProgress, isCancelled: () => prog.cancelled })
        : await session.run({ aspect: f.spec.aspect, width: f.spec.w, height: f.spec.h, onProgress: (p) => onProgress(p), isCancelled: () => prog.cancelled });
      if (!res) break;
      const rec = await addMedia({ blob: res.blob, name: `${project.title} ${f.spec.aspect}`, kind: 'export', duration: total, width: res.width, height: res.height });
      project.exports.push({ mediaId: rec.id, aspect: f.spec.aspect, width: res.width, height: res.height, createdAt: Date.now(), size: res.blob.size, ext: res.ext, platforms: f.keys });
      results.push({ ...res, platforms: f.keys });
    }
  } catch (e) {
    console.error(e);
    toast(`Error al exportar: ${e.message}`, 'error', 8000);
  } finally {
    session?.destroy();
    prog.close();
    wake?.release?.().catch(() => {});
  }
  if (results.length) {
    await saveProject(project);
    onSaved?.();
    showResults(project, results);
  } else if (prog.cancelled) toast('Exportación cancelada');
}

async function scheduleDialog(project, platforms) {
  const d = new Date(Date.now() + 86400000);
  const date = h('input', { class: 'input', type: 'date', 'aria-label': 'Fecha' });
  date.value = d.toISOString().slice(0, 10);
  const time = h('input', { class: 'input', type: 'time', 'aria-label': 'Hora' });
  time.value = '19:00';
  const v = await modal({
    title: 'Programar publicación',
    body: h('div', null,
      h('p', { class: 'muted small' }, `Se agrega a tu calendario de Ideas y te aviso a la hora indicada (con la app abierta). Tip: Meta Business Suite permite dejar programados Reels de Instagram y Facebook gratis.`),
      h('div', { class: 'two' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Día'), date), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Hora'), time)),
      h('p', { class: 'hint' }, 'Mejores horarios en Chile para salud mental y bienestar: 12:00–14:00 y 19:00–22:00, de martes a jueves.')
    ),
    actions: [{ label: 'Cancelar', value: null }, { label: 'Programar', value: 'ok', kind: 'primary' }],
  });
  if (v !== 'ok') return;
  const plats = [...new Set(platforms.map((k) => POST_KEY[k]).filter(Boolean))];
  await db.put('ideas', { id: uid('i_'), title: project.title, notes: 'Video exportado y listo para publicar.', status: 'editado', date: date.value, time: time.value, platforms: plats, projectId: project.id, createdAt: Date.now() });
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  toast(`Programado para el ${date.value} a las ${time.value}`, 'ok');
}

function publishBox(project, r) {
  const texto = project.captions.words.map((w) => w.text).join(' ') || project.scriptText || '';
  return h('div', { class: 'publish' },
    r.platforms.map((k) => {
      const [name, link] = OPEN_LINKS[k] || [PLATFORMS[k].label, null];
      return h('div', { class: 'publish-row' },
        h('b', null, PLATFORMS[k].label),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', onclick: () => copyText(generatePost({ tema: project.title, texto, plataforma: POST_KEY[k] || 'instagram' })) }, icon('copy', 14), 'Copiar texto'),
          link ? h('a', { class: 'btn btn-sm', href: link, target: '_blank', rel: 'noopener' }, icon('share', 14), `Abrir ${name}`) : ''
        )
      );
    })
  );
}

export async function showResults(project, results) {
  const fileName = (r) => `${sanitizeFilename(project.title)}-${r.aspect.replace(':', 'x')}-${r.width}x${r.height}.${r.ext}`;
  const urls = [];
  const allPlatforms = results.flatMap((r) => r.platforms || []);
  await modal({
    title: '¡Video listo para publicar!',
    wide: true,
    body: h('div', null,
      results.map((r) => {
        const url = URL.createObjectURL(r.blob);
        urls.push(url);
        const v = h('video', { src: url, controls: true, playsinline: true, preload: 'metadata', style: { width: '100%', maxHeight: '42vh', borderRadius: '10px', background: '#000' } });
        v.setAttribute('playsinline', '');
        return h('div', { class: 'card' },
          v,
          h('div', { class: 'row', style: { marginTop: '8px', justifyContent: 'space-between' } },
            h('span', { class: 'muted small' }, `${r.width}×${r.height} · ${fmtBytes(r.blob.size)} · ${r.ext.toUpperCase()}`),
            h('div', { class: 'row' },
              IS_IOS
                ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => shareFile(r.blob, fileName(r), project.title) }, icon('download', 16), 'Guardar en Fotos')
                : [
                    h('button', { class: 'btn btn-sm', onclick: () => downloadBlob(r.blob, fileName(r)) }, icon('download', 16), 'Descargar'),
                    h('button', { class: 'btn btn-sm btn-primary', onclick: () => shareFile(r.blob, fileName(r), project.title) }, icon('share', 16), 'Compartir / Guardar'),
                  ]
            )
          ),
          IS_IOS ? h('p', { class: 'hint' }, 'Toca «Guardar en Fotos» y, en la hoja que aparece, elige «Guardar video». Así queda en tu carrete (iOS no permite guardarlo sin ese paso).') : '',
          r.platforms?.length ? publishBox(project, r) : ''
        );
      }),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn btn-sm', onclick: () => scheduleDialog(project, allPlatforms) }, icon('calendar', 16), 'Programar publicación'),
        project.captions.words.length
          ? h('button', {
              class: 'btn btn-sm',
              onclick: () => {
                const cues = captionCues(buildSegments(project), buildCaptionIndex(project), project.captions.style.upper);
                downloadBlob(new Blob([toSRT(cues)], { type: 'application/x-subrip' }), `${sanitizeFilename(project.title)}.srt`);
              },
            }, icon('cc', 16), 'Subtítulos .SRT (YouTube)')
          : ''
      ),
      h('p', { class: 'hint' }, 'En iPhone: «Compartir / Guardar» → «Guardar video» lo deja en Fotos, o envíalo directo a Instagram, TikTok o WhatsApp.')
    ),
    actions: [{ label: 'Cerrar', value: null }],
  });
  urls.forEach((u) => URL.revokeObjectURL(u));
}

export { POST_PLATFORMS };
