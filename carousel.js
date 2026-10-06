(() => {
  const DEFAULT_SECONDS = 8; // si el servidor no manda duración
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
  let progressTimer = null;
  let progressStart = 0;
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

    slidesEl.innerHTML = images
      .map((img, i) => `
        <div class="slide" data-index="${i}" data-id="${escapeHtml(img.id)}" role="group" aria-roledescription="diapositiva" aria-label="${i + 1} de ${images.length}">
          <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" data-view="${escapeHtml(img.view || 'auto')}" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" draggable="false" />
        </div>`)
      .join('');

    // Mostrar cada imagen SOLO cuando está completamente decodificada.
    // Nunca a medias => se acabó ver media imagen con el resto en negro.
    slidesEl.querySelectorAll('.slide img').forEach((img) => revealWhenReady(img));

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

  function preload(url) {
    if (!url) return;
    const im = new Image();
    im.decoding = 'async';
    im.src = url;
    // Decodificar por adelantado: al mostrarse ya está lista (sin tirón ni negro).
    if (typeof im.decode === 'function') im.decode().catch(() => {});
  }

  // Marca la imagen como lista (fundido) SOLO cuando está 100% decodificada.
  // Si falla (hipo de red/CDN), reintenta con cache-bust y, en última instancia,
  // la muestra igual para no dejarla invisible.
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
    const imgRatio = (img.naturalWidth || 1) / (img.naturalHeight || 1);
    const screenRatio = window.innerWidth / window.innerHeight;
    const close = Math.abs(Math.log(imgRatio / screenRatio)) < 0.25;
    img.classList.add(close ? 'fit-cover' : 'fit-contain');
  }

  function applyFitAll() {
    slidesEl.querySelectorAll('.slide img').forEach(applyFit);
  }
  window.addEventListener('resize', applyFitAll);
  window.addEventListener('orientationchange', applyFitAll);

  function revealWhenReady(img) {
    const reveal = () => { img.classList.add('is-loaded'); applyFit(img); };
    const fail = () => {
      const tries = Number(img.dataset.retry || 0);
      if (tries < 2) {
        img.dataset.retry = String(tries + 1);
        const base = (img.getAttribute('src') || '').split('#')[0].split('?')[0];
        setTimeout(() => { img.src = `${base}?r=${Date.now()}`; revealWhenReady(img); }, 500 * (tries + 1));
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

  function show(index, immediate = false) {
    if (images.length === 0) return;
    current = (index + images.length) % images.length;
    currentId = images[current].id;

    // Precargar la siguiente (y anterior) para que la transición no salga en negro.
    if (images.length > 1) {
      preload(images[(current + 1) % images.length]?.url);
      preload(images[(current - 1 + images.length) % images.length]?.url);
    }

    const slides = slidesEl.querySelectorAll('.slide');
    slides.forEach((s, i) => s.classList.toggle('is-active', i === current));

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
  function currentMs() {
    const own = Number(images[current]?.duration);
    const seconds = own > 0 ? own : (slideDuration > 0 ? slideDuration : DEFAULT_SECONDS);
    return seconds * 1000;
  }

  function next() { show(current + 1); }
  function prev() { show(current - 1); }

  function scheduleNext() {
    clearTimeout(timer);
    restartProgress();
    timer = setTimeout(next, currentMs());
  }

  function startAutoplay() {
    stopAutoplay();
    if (images.length < 2 || paused || prefersReduced) return;
    scheduleNext();
  }

  function stopAutoplay() {
    clearTimeout(timer);
    timer = null;
    clearInterval(progressTimer);
    progressTimer = null;
  }

  function restartProgress() {
    clearInterval(progressTimer);
    if (prefersReduced || paused || images.length < 2) {
      progressFill.style.width = '0%';
      return;
    }
    progressStart = performance.now();
    progressFill.style.width = '0%';
    const total = currentMs();
    progressTimer = setInterval(() => {
      const pct = Math.min((performance.now() - progressStart) / total, 1) * 100;
      progressFill.style.width = pct + '%';
    }, 40);
  }

  function pause() {
    paused = true;
    stopAutoplay();
  }

  function resume() {
    if (!paused) return;
    paused = false;
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
    const signature = JSON.stringify([seconds, incoming.map((i) => [i.id, i.url, i.alt, i.order, i.view, i.duration])]);
    if (signature === refresh._sig) return;
    refresh._sig = signature;
    slideDuration = Number(seconds) > 0 ? Number(seconds) : DEFAULT_SECONDS;
    images = incoming.slice().sort((a, b) => a.order - b.order);
    build();
  }

  async function refresh() {
    try {
      if (!userId) return;
      const res = await fetch(`/api/carrusel?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
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