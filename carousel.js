(() => {
  const AUTOPLAY_MS = 5000;
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

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
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
      .map((img, i) => {
        const caption = img.alt
          ? `<div class="slide-caption">
               <span class="slide-index">${String(i + 1).padStart(2, '0')} / ${String(images.length).padStart(2, '0')}</span>
               <h2 class="slide-title">${escapeHtml(img.alt)}</h2>
             </div>`
          : '';
        return `<div class="slide" data-index="${i}" data-id="${escapeHtml(img.id)}" role="group" aria-roledescription="diapositiva" aria-label="${i + 1} de ${images.length}">
            <img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" draggable="false" />
            ${caption}
          </div>`;
      })
      .join('');

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

  function show(index, immediate = false) {
    if (images.length === 0) return;
    current = (index + images.length) % images.length;
    currentId = images[current].id;

    const slides = slidesEl.querySelectorAll('.slide');
    slides.forEach((s, i) => s.classList.toggle('is-active', i === current));

    const dots = dotsEl.querySelectorAll('.dot');
    dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === current);
      d.setAttribute('aria-selected', i === current ? 'true' : 'false');
    });

    if (!immediate) restartProgress();
  }

  function next() { show(current + 1); }
  function prev() { show(current - 1); }

  function startAutoplay() {
    stopAutoplay();
    if (images.length < 2 || paused || prefersReduced) return;
    restartProgress();
    timer = setInterval(next, AUTOPLAY_MS);
  }

  function stopAutoplay() {
    clearInterval(timer);
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
    progressTimer = setInterval(() => {
      const pct = Math.min((performance.now() - progressStart) / AUTOPLAY_MS, 1) * 100;
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

  document.getElementById('nextBtn').addEventListener('click', () => { next(); startAutoplay(); });
  document.getElementById('prevBtn').addEventListener('click', () => { prev(); startAutoplay(); });

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
  });

  // Pausar solo al pasar sobre los controles, no en toda la pantalla
  // (el carrusel es full-screen: un hover global detendría el autoplay siempre).
  document.querySelectorAll('.nav-arrow, .dots').forEach((el) => {
    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', resume);
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

  async function refresh() {
    try {
      const res = await fetch('/api/images', { cache: 'no-store' });
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      const incoming = Array.isArray(data.images) ? data.images : [];
      const signature = JSON.stringify(incoming.map((i) => [i.id, i.url, i.alt, i.order]));
      if (signature !== refresh._sig) {
        refresh._sig = signature;
        images = incoming.slice().sort((a, b) => a.order - b.order);
        build();
      }
    } catch (err) {
      console.warn('No se pudieron cargar las imágenes:', err.message);
    }
  }

  refresh();
  setInterval(() => { if (!paused) refresh(); }, POLL_MS);
})();
