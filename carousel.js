(() => {
  const DEFAULT_SECONDS = 8; // si el servidor no manda duración
  const VIDEO_FALLBACK_MS = 60000; // video cuya duración aún no se conoce
  const VIDEO_URL = /\.(mp4|mov|m4v|webm)(?:[?#]|$)/i;
  // Los elementos antiguos no traen `type`: son imágenes salvo que la URL sea de video.
  const isVideo = (item) => item?.type === 'video' || (item?.type !== 'image' && VIDEO_URL.test(item?.url || ''));
  const POLL_MS = 10000;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const slidesEl = document.getElementById('slides');
  const dotsEl = document.getElementById('dots');
  const emptyEl = document.getElementById('empty');
  const progressFill = document.getElementById('progressFill');
  const carouselEl = document.getElementById('carousel');

  let images = [];
  let current = 0;
  let timer = null;
  let paused = false;
  let currentId = null;
  let userId = null;
  let slideDuration = DEFAULT_SECONDS; // duración por defecto del carrusel (segundos)

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

  function getUserIdFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    return parts[0] === 'carrusel' ? parts[1]?.toUpperCase() : null;
  }

  function build() {
    if (images.length === 0) {
      emptyEl.hidden = false;
      slidesEl.innerHTML = '';
      dotsEl.innerHTML = '';
      stopAutoplay();
      return;
    }

    emptyEl.hidden = true;

    // Aquí no se pide ningún archivo: cada elemento lleva su dirección en `data-src` y
    // `loadWindow` le pone el `src` solo a lo que se va a ver (ver más abajo).
    // Video: siempre silenciado y `playsinline`; sin eso los navegadores (sobre todo en
    // celular) no lo reproducen solos. Debajo va su miniatura, visible mientras carga.
    slidesEl.innerHTML = images
      .map((img, i) => {
        const view = escapeHtml(img.view || 'auto');
        const alt = escapeHtml(img.alt || '');
        const video = isVideo(img);
        const media = video
          ? `${img.poster ? `<img class="slide__poster" data-src="${escapeHtml(img.poster)}" alt="" data-view="${view}" decoding="async" draggable="false" />` : ''}
          <video data-src="${escapeHtml(img.url)}" aria-label="${alt}" data-view="${view}" muted playsinline preload="auto" disablepictureinpicture></video>`
          : `<img data-src="${escapeHtml(img.url)}" alt="${alt}" data-view="${view}" decoding="async" draggable="false" />`;
        return `
        <div class="slide${video ? ' slide--video' : ''}" data-index="${i}" data-id="${escapeHtml(img.id)}" role="group" aria-roledescription="diapositiva" aria-label="${i + 1} de ${images.length}">
          ${media}
        </div>`;
      })
      .join('');

    slidesEl.querySelectorAll('.slide video').forEach((video) => setupVideo(video));

    dotsEl.innerHTML = images
      .map((_, i) => `<button class="dot" data-index="${i}" role="tab" aria-label="Diapositiva ${i + 1}"></button>`)
      .join('');

    if (currentId) {
      const idx = images.findIndex((im) => im.id === currentId);
      current = idx >= 0 ? idx : Math.min(current, images.length - 1);
    } else {
      current = 0;
    }

    show(current, true);
    startAutoplay();
  }

  // Ajusta cómo se muestra cada imagen según su orientación y la de la pantalla.
  // Coincide (vertical/vertical o horizontal/horizontal) -> cover (llena).
  // No coincide -> contain (se ve completa, sin cortar). view='rotate' -> gira 90° y llena.
  function applyFit(img) {
    if (!img) return;
    const view = img.dataset.view || 'auto';
    img.classList.remove('is-rotated', 'fit-contain', 'fit-cover');
    if (view === 'rotate') { img.classList.add('is-rotated'); return; }
    const portraitScreen = window.matchMedia('(orientation: portrait)').matches;
    if (view === 'vertical' || view === 'horizontal') {
      // Forzado desde el admin: llena solo si coincide con la orientación de la pantalla.
      img.classList.add((view === 'vertical') === portraitScreen ? 'fit-cover' : 'fit-contain');
      return;
    }
    // Auto: llena si la proporción del póster es parecida a la de la pantalla (recorte
    // mínimo); si es muy distinta (p. ej. cuadrado o 4:3 en TV 16:9) se ve completo.
    const imgRatio = (img.naturalWidth || img.videoWidth || 1) / (img.naturalHeight || img.videoHeight || 1);
    const screenRatio = window.innerWidth / window.innerHeight;
    const close = Math.abs(Math.log(imgRatio / screenRatio)) < 0.25;
    img.classList.add(close ? 'fit-cover' : 'fit-contain');
  }

  function applyFitAll() {
    slidesEl.querySelectorAll('.slide img, .slide video').forEach(applyFit);
  }
  window.addEventListener('resize', applyFitAll);
  window.addEventListener('orientationchange', applyFitAll);

  // Marca la imagen como lista (fundido) SOLO cuando está 100% decodificada.
  // Si falla (hipo de red/CDN), reintenta con cache-bust y, en última instancia,
  // la muestra igual para no dejarla invisible.
  function revealWhenReady(img) {
    const loaded = () => Boolean(img.getAttribute('src')); // pudo descargarse mientras tanto
    const reveal = () => { if (!loaded()) return; img.classList.add('is-loaded'); applyFit(img); };
    const fail = () => {
      if (!loaded()) return;
      const tries = Number(img.dataset.retry || 0);
      if (tries < 2) {
        img.dataset.retry = String(tries + 1);
        setTimeout(() => {
          if (!loaded()) return;
          img.src = `${img.dataset.src.split('#')[0].split('?')[0]}?r=${Date.now()}`;
          revealWhenReady(img);
        }, 500 * (tries + 1));
      } else {
        reveal();
      }
    };
    if (typeof img.decode === 'function') {
      img.decode().then(reveal).catch(fail);
    } else if (img.complete && img.naturalWidth > 0) {
      reveal();
    } else {
      img.addEventListener('load', reveal, { once: true });
      img.addEventListener('error', fail, { once: true });
    }
  }

  // ==================== Solo se carga lo que se va a ver ====================
  // Una TV tiene poca memoria y a menudo un solo decodificador de video. Por eso solo la
  // diapositiva actual y sus dos vecinas tienen su imagen cargada, y solo la actual tiene
  // el video abierto. Al resto se le quita el `src` para que el navegador libere memoria.

  const UNLOAD_VIDEO_AFTER_MS = 1300; // deja terminar el fundido antes de soltar el video

  function inWindow(i) {
    const n = images.length;
    if (n <= 3) return true;
    return i === current || i === (current + 1) % n || i === (current - 1 + n) % n;
  }

  function loadImage(img) {
    if (img.getAttribute('src')) return;
    delete img.dataset.retry;
    img.src = img.dataset.src;
    revealWhenReady(img);
  }

  function unloadImage(img) {
    if (!img.getAttribute('src')) return;
    img.removeAttribute('src');
    img.classList.remove('is-loaded');
  }

  function loadVideo(video) {
    clearTimeout(video.unloadTimer);
    if (video.getAttribute('src')) return;
    delete video.dataset.failed;
    delete video.dataset.retry;
    video.src = video.dataset.src;
    video.load();
  }

  function unloadVideo(video) {
    if (!video.getAttribute('src')) return;
    video.pause();
    video.removeAttribute('src');
    video.load(); // sin `src`, esto suelta el búfer y el decodificador
    video.classList.remove('is-loaded');
  }

  // Reproduce desde el inicio el video de la diapositiva actual.
  function playVideo(video) {
    const autoAdvance = images.length > 1 && !prefersReduced;
    // Se repite si tiene duración fija (se corta por tiempo) o si no hay a dónde avanzar.
    video.loop = Boolean(ownSeconds()) || !autoAdvance;
    video.muted = true;
    try { video.currentTime = 0; } catch { /* aún sin datos */ }
    if (!paused) video.play().catch(() => { /* el navegador lo bloqueó: se queda en la miniatura */ });
  }

  function loadWindow() {
    slidesEl.querySelectorAll('.slide').forEach((slide) => {
      const i = Number(slide.dataset.index);
      const near = inWindow(i);
      slide.querySelectorAll('img').forEach((img) => (near ? loadImage(img) : unloadImage(img)));

      const video = slide.querySelector('video');
      if (!video) return;
      if (i === current) {
        loadVideo(video);
        playVideo(video);
      } else if (video.getAttribute('src')) {
        video.pause();
        clearTimeout(video.unloadTimer);
        video.unloadTimer = setTimeout(() => { if (slideIndex(video) !== current) unloadVideo(video); }, UNLOAD_VIDEO_AFTER_MS);
      }
    });
  }

  // ==================== Video ====================

  const slideIndex = (el) => Number(el.closest('.slide')?.dataset.index);
  const currentVideo = () => slidesEl.querySelector(`.slide[data-index="${current}"] video`);
  const ownSeconds = () => {
    const own = Number(images[current]?.duration);
    return own > 0 ? own : 0;
  };

  function setupVideo(video) {
    video.muted = true; // la propiedad, no solo el atributo: es lo que mira el navegador
    video.playsInline = true;
    video.addEventListener('loadeddata', () => { video.classList.add('is-loaded'); applyFit(video); });

    // Al conocer su duración real se reprograma el paso a la siguiente.
    video.addEventListener('loadedmetadata', () => {
      applyFit(video);
      if (slideIndex(video) === current && timer) scheduleNext();
    });
    // Sin duración propia, el video manda: al terminar pasa a la siguiente.
    video.addEventListener('ended', () => {
      if (slideIndex(video) !== current || paused) return;
      if (timer && !ownSeconds()) next();
    });
    // Si falla la carga (hipo de red), se reintenta dos veces. Si el dispositivo no puede
    // con él, queda su miniatura y el carrusel sigue; se vuelve a intentar en su próximo turno.
    video.addEventListener('error', () => {
      if (!video.getAttribute('src')) return; // lo descargamos nosotros
      const tries = Number(video.dataset.retry || 0);
      if (tries < 2) {
        video.dataset.retry = String(tries + 1);
        setTimeout(() => {
          if (slideIndex(video) !== current || !video.getAttribute('src')) return;
          video.src = `${video.dataset.src}?r=${Date.now()}`;
          video.load();
          playVideo(video);
        }, 600 * (tries + 1));
        return;
      }
      video.dataset.failed = '1';
      if (slideIndex(video) === current && timer) scheduleNext();
    });
  }

  function show(index, immediate = false) {
    if (images.length === 0) return;
    current = (index + images.length) % images.length;
    currentId = images[current].id;

    const slides = slidesEl.querySelectorAll('.slide');
    slides.forEach((s, i) => s.classList.toggle('is-active', i === current));
    // Carga la actual y sus vecinas (así la transición no sale en negro) y suelta el resto.
    loadWindow();

    const dots = dotsEl.querySelectorAll('.dot');
    dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === current);
      d.setAttribute('aria-selected', i === current ? 'true' : 'false');
    });

    // Cada diapositiva programa la siguiente con su propia duración.
    if (immediate) return;
    if (timer) scheduleNext();
    else restartProgress();
  }

  // Cuánto dura la diapositiva actual: la suya propia o la del carrusel.
  // Un video sin duración propia dura lo que dure el video.
  function currentMs() {
    const own = ownSeconds();
    if (own) return own * 1000;
    const seconds = slideDuration > 0 ? slideDuration : DEFAULT_SECONDS;
    const video = currentVideo();
    if (video) {
      // No se pudo reproducir: con miniatura se trata como una imagen; sin ella, se pasa rápido.
      if (video.dataset.failed) return images[current]?.poster ? seconds * 1000 : 2000;
      if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
      // Aún no se sabe: se usa la que midió el servidor al subirlo.
      const known = Number(images[current]?.durationSec);
      return known > 0 ? known * 1000 : VIDEO_FALLBACK_MS;
    }
    return seconds * 1000;
  }

  function next() { show(current + 1); }
  function prev() { show(current - 1); }

  function scheduleNext() {
    clearTimeout(timer);
    restartProgress();
    // En un video sin duración propia avanza su evento `ended`; el temporizador queda
    // un poco después como respaldo por si el video se traba.
    const video = currentVideo();
    const grace = video && !video.dataset.failed && !ownSeconds() ? 1500 : 0;
    timer = setTimeout(next, currentMs() + grace);
  }

  function startAutoplay() {
    stopAutoplay();
    if (images.length < 2 || paused || prefersReduced) return;
    scheduleNext();
  }

  function stopAutoplay() {
    clearTimeout(timer);
    timer = null;
    // La barra se queda donde iba.
    const at = getComputedStyle(progressFill).transform;
    progressFill.style.transition = 'none';
    progressFill.style.transform = at && at !== 'none' ? at : 'scaleX(0)';
  }

  // La barra avanza con una transición CSS: el navegador la anima sin ejecutar
  // JavaScript en cada cuadro (antes era un temporizador cada 40 ms).
  function restartProgress() {
    progressFill.style.transition = 'none';
    progressFill.style.transform = 'scaleX(0)';
    if (prefersReduced || paused || images.length < 2) return;
    void progressFill.offsetWidth; // aplica el 0 antes de empezar a animar
    progressFill.style.transition = `transform ${Math.round(currentMs())}ms linear`;
    progressFill.style.transform = 'scaleX(1)';
  }

  function pause() {
    paused = true;
    stopAutoplay();
    currentVideo()?.pause();
  }

  function resume() {
    if (!paused) return;
    paused = false;
    currentVideo()?.play().catch(() => {});
    if (images.length > 1) startAutoplay();
  }

  // ==================== Events ====================

  dotsEl.addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    show(Number(dot.dataset.index));
    startAutoplay();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { next(); startAutoplay(); }
    else if (e.key === 'ArrowLeft') { prev(); startAutoplay(); }
    else if (e.key === ' ') { e.preventDefault(); paused ? resume() : pause(); }
    else if (e.key === 'Tab') { /* allow tab navigation for focus management */ }
  });

  // Touch / swipe
  let touchStartX = 0;
  let touchDelta = 0;
  carouselEl.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchDelta = 0;
    pause();
  }, { passive: true });

  carouselEl.addEventListener('touchmove', (e) => {
    touchDelta = e.touches[0].clientX - touchStartX;
  }, { passive: true });

  carouselEl.addEventListener('touchend', () => {
    if (Math.abs(touchDelta) > 50) {
      touchDelta < 0 ? next() : prev();
    }
    resume();
  });

  // Pause when tab hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pause();
    } else {
      resume();
      refresh();
    }
  });

  // ==================== Data ====================

  const storeKey = () => `carrusel:last:${userId}`;

  // Aplica una lista de imágenes; solo reconstruye si de verdad cambió algo.
  function applyList(incoming, seconds) {
    const signature = JSON.stringify([seconds, incoming.map((i) => [i.id, i.url, i.alt, i.order, i.view, i.duration, i.type, i.poster])]);
    if (signature === refresh._sig) return;
    refresh._sig = signature;
    slideDuration = Number(seconds) > 0 ? Number(seconds) : DEFAULT_SECONDS;
    images = incoming.slice().sort((a, b) => a.order - b.order);
    build();
  }

  // ==================== Versión nueva del sitio ====================
  // Una TV deja el carrusel abierto por días. La lista se refresca sola, pero el código
  // no: sin esto seguiría con el viejo tras una actualización. El servidor manda su
  // versión en cada consulta; si no es la de esta página, se recarga.
  const OWN_BUILD = document.querySelector('meta[name="build"]')?.content || '';
  const RELOAD_KEY = 'carrusel:reloadAt';
  const RELOAD_MIN_MS = 2 * 60 * 1000; // como mucho una recarga cada 2 min: nunca en bucle

  function reloadIfNewBuild(res) {
    const serverBuild = res.headers.get('x-build');
    if (!serverBuild || !OWN_BUILD || OWN_BUILD === '__BUILD__' || serverBuild === OWN_BUILD) return;
    if (res.headers.get('x-from-cache')) return; // respuesta guardada (sin red): no dice cuál es la versión actual
    try {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last < RELOAD_MIN_MS) return;
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      return; // sin storage no se puede garantizar que no haya bucle: mejor no recargar
    }
    window.location.reload();
  }

  async function refresh() {
    try {
      if (!userId) return;
      const res = await fetch(`/api/carrusel?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
      reloadIfNewBuild(res);
      const data = await res.json();
      const list = data?.data?.images ?? data?.images;
      const incoming = Array.isArray(list) ? list : [];
      const seconds = data?.data?.slideDuration ?? data?.slideDuration ?? DEFAULT_SECONDS;
      applyList(incoming, seconds);
      // Última lista buena: si la TV se reinicia sin red, arranca con esto.
      try {
        localStorage.setItem(storeKey(), JSON.stringify(incoming));
        localStorage.setItem(storeKey() + ':seconds', String(seconds));
      } catch { /* sin storage */ }
    } catch (err) {
      console.warn('No se pudieron cargar las imágenes:', err.message);
    }
  }

  // Initialize
  userId = getUserIdFromPath();
  if (!userId || !/^USER\d+$/.test(userId)) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = '<h1>ID de usuario requerido</h1><p>Accede desde <code>/carrusel/USER1</code></p>';
  } else {
    // Pintar al instante la última lista conocida y luego actualizar desde la red.
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey()) || 'null');
      const savedSeconds = Number(localStorage.getItem(storeKey() + ':seconds')) || DEFAULT_SECONDS;
      if (Array.isArray(saved) && saved.length) applyList(saved, savedSeconds);
    } catch { /* storage vacío o bloqueado */ }
    refresh();
    setInterval(() => { if (!paused) refresh(); }, POLL_MS);

    // Service worker: imágenes y app disponibles aunque se caiga la red.
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/carrusel/' }).catch(() => {});
      });
    }
  }
})();