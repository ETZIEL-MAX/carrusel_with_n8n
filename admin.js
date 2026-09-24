(() => {
  const loginView = document.getElementById('loginView');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const passwordInput = document.getElementById('password');
  const logoutBtn = document.getElementById('logoutBtn');
  const addBtn = document.getElementById('addBtn');
  const grid = document.getElementById('grid');
  const gridEmpty = document.getElementById('gridEmpty');
  const countHint = document.getElementById('countHint');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const imageForm = document.getElementById('imageForm');
  const modalTitle = document.getElementById('modalTitle');
  const imgUrl = document.getElementById('imgUrl');
  const imgAlt = document.getElementById('imgAlt');
  const formError = document.getElementById('formError');
  const cancelBtn = document.getElementById('cancelBtn');
  const saveBtn = document.getElementById('saveBtn');
  const toasts = document.getElementById('toasts');

  let images = [];
  let editingId = null;
  let dragId = null;

  // ==================== Toast ====================
  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast--error' : '');
    el.textContent = message;
    toasts.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ==================== Auth ====================
  async function checkAuth() {
    try {
      const res = await API.me();
      if (res.authenticated) {
        showDashboard();
        return;
      }
    } catch { /* ignore */ }
    showLogin();
  }

  function showLogin() {
    loginView.hidden = false;
    dashboard.hidden = true;
  }

  function showDashboard() {
    loginView.hidden = true;
    dashboard.hidden = false;
    loadImages();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Entrando…';
    try {
      await API.login(passwordInput.value);
      passwordInput.value = '';
      showDashboard();
      toast('Sesión iniciada');
    } catch (err) {
      loginError.textContent = err.message || 'Error de acceso';
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Entrar';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try { await API.logout(); } catch { /* ignore */ }
    showLogin();
    toast('Sesión cerrada');
  });

  // ==================== Data ====================
  async function loadImages() {
    grid.innerHTML = Array.from({ length: 4 }).map(() => '<div class="skeleton"></div>').join('');
    try {
      const res = await API.getImages();
      images = (res.images || []).slice().sort((a, b) => a.order - b.order);
      renderGrid();
    } catch (err) {
      toast(err.message, 'error');
      grid.innerHTML = '';
    }
  }

  function renderGrid() {
    countHint.textContent = `${images.length} imagen${images.length === 1 ? '' : 'es'}`;
    if (images.length === 0) {
      grid.innerHTML = '';
      gridEmpty.hidden = false;
      return;
    }
    gridEmpty.hidden = true;
    grid.innerHTML = images
      .map((img) => `
      <article class="image-card" draggable="true" data-id="${escapeHtml(img.id)}">
        <a class="image-card__thumb-link" href="${escapeHtml(img.url)}" target="_blank" rel="noopener noreferrer" draggable="false" title="Abrir imagen en una pestaña nueva">
          <img class="image-card__thumb" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" loading="lazy" draggable="false" />
          <span class="image-card__open">Abrir ↗</span>
        </a>
        <div class="image-card__body">
          <div class="image-card__alt">${escapeHtml(img.alt || 'Sin título')}</div>
          <a class="image-card__url" href="${escapeHtml(img.url)}" target="_blank" rel="noopener noreferrer" draggable="false" title="Abrir: ${escapeHtml(img.url)}">${escapeHtml(img.url)}</a>
          <div class="image-card__foot">
            <span class="image-card__order">#${img.order}</span>
            <div style="display:flex; gap:.4rem;">
              <button class="icon-btn" data-action="edit" data-id="${escapeHtml(img.id)}" aria-label="Editar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button class="icon-btn icon-btn--danger" data-action="delete" data-id="${escapeHtml(img.id)}" aria-label="Eliminar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>
          </div>
        </div>
      </article>`)
      .join('');
  }

  // ==================== Modal ====================
  function openModal(image = null) {
    editingId = image ? image.id : null;
    modalTitle.textContent = image ? 'Editar imagen' : 'Añadir imagen';
    imgUrl.value = image ? image.url : '';
    imgAlt.value = image ? image.alt : '';
    formError.textContent = '';
    modalBackdrop.classList.add('is-open');
    setTimeout(() => imgUrl.focus(), 60);
  }

  function closeModal() {
    modalBackdrop.classList.remove('is-open');
    editingId = null;
  }

  addBtn.addEventListener('click', () => openModal());
  cancelBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop.classList.contains('is-open')) closeModal();
  });

  imageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    const payload = { url: imgUrl.value.trim(), alt: imgAlt.value.trim() };

    if (!payload.url) {
      formError.textContent = 'La URL es obligatoria';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando…';
    try {
      if (editingId) {
        await API.updateImage(editingId, payload);
        toast('Imagen actualizada');
      } else {
        await API.addImage(payload);
        toast('Imagen añadida');
      }
      closeModal();
      await loadImages();
    } catch (err) {
      formError.textContent = Array.isArray(err.details)
        ? err.details.join(', ')
        : err.message;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Guardar';
    }
  });

  // ==================== Grid actions ====================
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const image = images.find((i) => i.id === id);
    if (!image) return;

    if (action === 'edit') {
      openModal(image);
    } else if (action === 'delete') {
      if (!confirm('¿Eliminar esta imagen?')) return;
      try {
        await API.deleteImage(id);
        toast('Imagen eliminada');
        await loadImages();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // ==================== Drag & drop reorder ====================
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.image-card');
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  grid.addEventListener('dragend', (e) => {
    const card = e.target.closest('.image-card');
    if (card) card.classList.remove('is-dragging');
    grid.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    dragId = null;
  });

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const card = e.target.closest('.image-card');
    if (!card || card.dataset.id === dragId) return;
    grid.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    card.classList.add('is-drop-target');
  });

  grid.addEventListener('drop', async (e) => {
    e.preventDefault();
    const target = e.target.closest('.image-card');
    if (!target || !dragId || target.dataset.id === dragId) return;

    const fromIdx = images.findIndex((i) => i.id === dragId);
    const toIdx = images.findIndex((i) => i.id === target.dataset.id);
    if (fromIdx < 0 || toIdx < 0) return;

    const [moved] = images.splice(fromIdx, 1);
    images.splice(toIdx, 0, moved);

    const orders = images.map((img, idx) => ({ id: img.id, order: idx }));
    images.forEach((img, idx) => (img.order = idx));
    renderGrid();

    try {
      await API.reorderImages(orders);
      toast('Orden actualizado');
    } catch (err) {
      toast(err.message, 'error');
      await loadImages();
    }
  });

  checkAuth();
})();
