// Kit de marca: nombre, usuario, logo, colores y estilo por defecto, con vista previa en vivo.
import { h, icon, toast, textInput, colorPick, toggle, select, pickFile, confirmDialog } from '../lib/dom.js';
import { debounce } from '../lib/util.js';
import { getBrand, saveBrand, addMedia, deleteMedia, mediaUrl, newProject, applyBrandDefaults } from '../store.js';
import { loadImage } from '../core/media.js';
import { renderFrame } from '../core/render.js';
import { CAPTION_PRESETS, buildCaptionIndex } from '../core/captions.js';

const SAMPLE = [
  ['Así', 0.8, 1.0], ['se', 1.0, 1.15], ['verán', 1.15, 1.5], ['tus', 1.5, 1.7], ['videos', 1.7, 2.2],
];

export default async function render(root) {
  const brand = await getBrand();
  let logo = brand.logoMediaId ? await loadImage(await mediaUrl(brand.logoMediaId)) : null;
  const save = debounce(() => saveBrand(brand), 300);
  const canvas = h('canvas', { width: 540, height: 960, 'aria-label': 'Vista previa de la marca', role: 'img' });

  function drawPreview() {
    const demo = newProject({ title: 'Vista previa' });
    applyBrandDefaults(demo, brand);
    demo.brand.lowerThird.enabled = !!(brand.name || brand.role);
    demo.captions.words = SAMPLE.map(([text, t0, t1]) => ({ text, t0, t1, clip: 0 }));
    demo.captions.style.maxWords = 5;
    const seg = { type: 'video', clip: 0, src0: 0, src1: 5, tlStart: 0, dur: 5, vi: 0 };
    renderFrame(canvas.getContext('2d'), canvas.width, canvas.height, {
      project: demo, brand, t: 1.8, total: 5, videoStart: 0, seg, local: 1.8, src: 1.8, video: null, placeholder: true,
      capIndex: buildCaptionIndex(demo), assets: { logo },
    });
  }
  const upd = (k) => (v) => {
    brand[k] = v;
    save();
    drawPreview();
  };

  const logoBox = h('div', { class: 'logo-box' });
  const renderLogo = () => {
    logoBox.replaceChildren();
    logoBox.append(
      logo ? h('img', { src: logo.src, alt: 'Logo' }) : h('div', { class: 'muted small' }, 'Sin logo'),
      h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          const [file] = await pickFile('image/*');
          if (!file) return;
          const rec = await addMedia({ blob: file, name: file.name, kind: 'image' });
          if (brand.logoMediaId) await deleteMedia(brand.logoMediaId);
          brand.logoMediaId = rec.id;
          logo = await loadImage(await mediaUrl(rec.id));
          await saveBrand(brand);
          renderLogo();
          drawPreview();
          toast('Logo guardado', 'ok');
        },
      }, icon('upload', 16), logo ? 'Cambiar' : 'Subir logo'),
      logo
        ? h('button', {
            class: 'btn btn-sm btn-danger',
            onclick: async () => {
              if (!(await confirmDialog('¿Quitar el logo?', { ok: 'Quitar', danger: true }))) return;
              await deleteMedia(brand.logoMediaId);
              brand.logoMediaId = null;
              logo = null;
              await saveBrand(brand);
              renderLogo();
              drawPreview();
            },
          }, 'Quitar')
        : ''
    );
  };
  renderLogo();

  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Mi marca'), h('p', { class: 'muted small' }, 'Se aplica automáticamente a los videos nuevos. En un video existente: Editor › Marca › Aplicar mi marca.'))),
    h('div', { class: 'brand-layout' },
      h('div', null,
        h('div', { class: 'card' },
          h('h2', null, 'Identidad'),
          textInput({ label: 'Tu nombre o el de tu negocio', value: brand.name, onInput: upd('name') }),
          textInput({ label: 'Cargo o descripción corta', value: brand.role, placeholder: 'p. ej. Nutricionista deportiva', onInput: upd('role') }),
          textInput({ label: 'Usuario en redes', value: brand.handle, placeholder: '@tuusuario', onInput: upd('handle') }),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Logo (mejor PNG con fondo transparente)'), logoBox)
        ),
        h('div', { class: 'card' },
          h('h2', null, 'Colores'),
          h('div', { class: 'two' },
            colorPick({ label: 'Principal', value: brand.primary, onChange: upd('primary') }),
            colorPick({ label: 'Secundario', value: brand.secondary, onChange: upd('secondary') }),
            colorPick({ label: 'Texto sobre color', value: brand.textColor, onChange: upd('textColor') }),
            colorPick({ label: 'Fondo de los videos', value: brand.bg, onChange: upd('bg') })
          )
        ),
        h('div', { class: 'card' },
          h('h2', null, 'Estilo por defecto'),
          select({ label: 'Subtítulos', value: brand.captionPreset, options: Object.entries(CAPTION_PRESETS).map(([k, p]) => [k, p.label]), onChange: upd('captionPreset') }),
          toggle({ label: 'Mostrar el logo', checked: brand.useLogo, onChange: upd('useLogo') }),
          toggle({ label: 'Rótulo con mi nombre al inicio', checked: brand.useLowerThird, onChange: upd('useLowerThird') }),
          toggle({ label: 'Barra de progreso', checked: brand.useProgress, onChange: upd('useProgress') }),
          toggle({ label: 'Tarjeta de cierre', checked: brand.useOutro, onChange: upd('useOutro') }),
          textInput({ label: 'Texto de la intro (opcional)', value: brand.introText, placeholder: 'Por defecto: el título del video', onInput: upd('introText') }),
          textInput({ label: 'Texto del cierre', value: brand.outroText, onInput: upd('outroText') })
        )
      ),
      h('div', { class: 'brand-preview card' }, h('h2', { style: { marginBottom: '10px' } }, 'Vista previa'), canvas)
    )
  );
  drawPreview();
  return () => save.flush();
}
