(() => {
  // ===== Elements =====
  const loginView = document.getElementById('loginView');
  const superAdminDashboard = document.getElementById('superAdminDashboard');
  const userDashboard = document.getElementById('userDashboard');

  const adminLoginForm = document.getElementById('adminLoginForm');
  const adminLoginError = document.getElementById('adminLoginError');
  const adminLoginBtn = document.getElementById('adminLoginBtn');
  const adminPassword = document.getElementById('adminPassword');

  const userLoginForm = document.getElementById('userLoginForm');
  const userLoginError = document.getElementById('userLoginError');
  const userLoginBtn = document.getElementById('userLoginBtn');
  const userEmail = document.getElementById('userEmail');
  const userPassword = document.getElementById('userPassword');

  const loginTabs = document.querySelectorAll('.login-tab');
  const loginPanels = document.querySelectorAll('.login-panel');

  const superAdminLogoutBtn = document.getElementById('superAdminLogoutBtn');
  const superAdminLogoutAllBtn = document.getElementById('superAdminLogoutAllBtn');
  const priceForm = document.getElementById('priceForm');
  const priceInput = document.getElementById('priceInput');
  const priceSaveBtn = document.getElementById('priceSaveBtn');
  const planPanel = document.getElementById('planPanel');
  const storageText = document.getElementById('storageText');
  const storageMeter = document.getElementById('storageMeter');
  const storageFill = document.getElementById('storageFill');
  const storageHint = document.getElementById('storageHint');
  const usageMonth = document.getElementById('usageMonth');
  const usageStats = document.getElementById('usageStats');
  const usageHint = document.getElementById('usageHint');
  const addUserBtn = document.getElementById('addUserBtn');
  const superAdminGrid = document.getElementById('superAdminGrid');
  const superAdminEmpty = document.getElementById('superAdminEmpty');
  const superAdminCount = document.getElementById('superAdminCount');

  const userDashboardTitle = document.getElementById('userDashboardTitle');
  const backToUsersBtn = document.getElementById('backToUsersBtn');
  const userPublicLink = document.getElementById('userPublicLink');
  const userLogoutBtn = document.getElementById('userLogoutBtn');
  const addImgBtn = document.getElementById('addImgBtn');
  const uploadImgBtn = document.getElementById('uploadImgBtn');
  const uploadImgInput = document.getElementById('uploadImgInput');
  const cameraBtn = document.getElementById('cameraBtn');
  const cameraInput = document.getElementById('cameraInput');
  const uploadStatus = document.getElementById('uploadStatus');
  const uploadStatusText = document.getElementById('uploadStatusText');
  const uploadStatusFill = document.getElementById('uploadStatusFill');
  const userGrid = document.getElementById('userGrid');
  const userGridEmpty = document.getElementById('userGridEmpty');
  const userCountHint = document.getElementById('userCountHint');

  // Modals
  const userModalBackdrop = document.getElementById('userModalBackdrop');
  const userModalForm = document.getElementById('userModalForm');
  const userModalTitle = document.getElementById('userModalTitle');
  const newUserName = document.getElementById('newUserName');
  const newUserEmail = document.getElementById('newUserEmail');
  const newUserPassword = document.getElementById('newUserPassword');
  const newUserPwdToggle = document.getElementById('newUserPwdToggle');
  const newUserPwdGen = document.getElementById('newUserPwdGen');
  const userFormError = document.getElementById('userFormError');
  const userCancelBtn = document.getElementById('userCancelBtn');
  const userSaveBtn = document.getElementById('userSaveBtn');

  const pwdRevealBackdrop = document.getElementById('pwdRevealBackdrop');
  const pwdRevealTitle = document.getElementById('pwdRevealTitle');
  const pwdRevealText = document.getElementById('pwdRevealText');
  const pwdRevealHint = document.getElementById('pwdRevealHint');
  const pwdRevealLabel = document.getElementById('pwdRevealLabel');
  const pwdRevealCopyBtn = document.getElementById('pwdRevealCopyBtn');
  const pwdRevealCloseBtn = document.getElementById('pwdRevealCloseBtn');

  const settingsModalBackdrop = document.getElementById('settingsModalBackdrop');
  const settingsModalForm = document.getElementById('settingsModalForm');
  const settingsModalTitle = document.getElementById('settingsModalTitle');
  const setName = document.getElementById('setName');
  const setEmail = document.getElementById('setEmail');
  const setPassword = document.getElementById('setPassword');
  const setPwdToggle = document.getElementById('setPwdToggle');
  const setPwdGen = document.getElementById('setPwdGen');
  const settingsFormError = document.getElementById('settingsFormError');
  const settingsCancelBtn = document.getElementById('settingsCancelBtn');
  const settingsSaveBtn = document.getElementById('settingsSaveBtn');
  const accountSection = document.getElementById('accountSection');
  const planSection = document.getElementById('planSection');
  const setStorageLimit = document.getElementById('setStorageLimit');
  const setStorageHint = document.getElementById('setStorageHint');
  const tokenStatus = document.getElementById('tokenStatus');
  const tokenGenBtn = document.getElementById('tokenGenBtn');
  const selfLogoutAllBtn = document.getElementById('selfLogoutAllBtn');
  const webhookDocs = document.getElementById('webhookDocs');
  const whUrl = document.getElementById('whUrl');
  const whHeaders = document.getElementById('whHeaders');
  const whBody = document.getElementById('whBody');
  const whUpload = document.getElementById('whUpload');
  const n8nBlock = document.getElementById('n8nBlock');

  const imgModalBackdrop = document.getElementById('imgModalBackdrop');
  const imgModalForm = document.getElementById('imgModalForm');
  const imgModalTitle = document.getElementById('imgModalTitle');
  const imgUrl = document.getElementById('imgUrl');
  const imgAlt = document.getElementById('imgAlt');
  const imgDuration = document.getElementById('imgDuration');
  const imgFormError = document.getElementById('imgFormError');
  const imgDaysSeg = document.getElementById('imgDaysSeg');
  const imgFrom = document.getElementById('imgFrom');
  const imgTo = document.getElementById('imgTo');
  const imgScheduleClear = document.getElementById('imgScheduleClear');
  const imgBlur = document.getElementById('imgBlur');
  const imgSuspended = document.getElementById('imgSuspended');
  const imgCancelBtn = document.getElementById('imgCancelBtn');
  const imgSaveBtn = document.getElementById('imgSaveBtn');

  const toasts = document.getElementById('toasts');

  const userSettingsBtn = document.getElementById('userSettingsBtn');
  const genDriveUrl = document.getElementById('genDriveUrl');
  const genSlideDuration = document.getElementById('genSlideDuration');
  const colorPaletteRow = document.getElementById('colorPaletteRow');
  const addColorBtn = document.getElementById('addColorBtn');
  const genFormError = document.getElementById('genFormError');
  const genFormOk = document.getElementById('genFormOk');
  const generateImagesBtn = document.getElementById('generateImagesBtn');
  const settingsSaveGenBtn = document.getElementById('settingsSaveGenBtn');
  const orientSeg = document.getElementById('orientSeg');
  const resSeg = document.getElementById('resSeg');
  const formatSizeHint = document.getElementById('formatSizeHint');
  const viewSeg = document.getElementById('viewSeg');

  // ===== State =====
  let genOrientation = 'horizontal'; // default de generación (settings)
  let genResolution = 'fullhd'; // resolución del póster (settings)
  let imgView = 'auto'; // orientación de la imagen en edición
  let session = null; // { role, userId, name, email }
  let superAdminUsers = [];
  let userImages = [];
  let currentUserId = null; // user whose carousel is shown in the dashboard
  let managingAsSuperAdmin = false; // super-admin viewing a user's carousel
  let editingImgId = null;
  let settingsUserId = null;
  let dragId = null;
  let colorSwatches = [];

  function activeUserId() {
    return currentUserId || session?.userId;
  }

  // ===== Toast =====
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
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

  const MIN_PASSWORD = 10;
  const PASSWORD_ERROR = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;

  // ===== Espacio y consumo =====
  const MB = 1024 * 1024;
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * MB) return `${(n / (1024 * MB)).toFixed(2)} GB`;
    if (n >= 10 * MB) return `${Math.round(n / MB)} MB`;
    return `${(n / MB).toFixed(1)} MB`;
  }
  const formatInt = (n) => (Number(n) || 0).toLocaleString('es-MX');
  const formatUsd = (n) => `$${(Number(n) || 0).toFixed(2)} USD`;
  // 0..100 y la clase de color: ámbar desde 80 %, rojo desde 95 %.
  function storageLevel(used, limit) {
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    return { pct, cls: pct >= 95 ? 'is-full' : pct >= 80 ? 'is-warn' : '' };
  }
  function recentMonths(count = 6) {
    const out = [];
    const d = new Date();
    for (let i = 0; i < count; i++) {
      out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    }
    return out;
  }
  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  usageMonth.innerHTML = recentMonths()
    .map((ym) => `<option value="${ym}">${escapeHtml(monthLabel(ym))}</option>`)
    .join('');

  async function loadPlan() {
    const id = activeUserId();
    if (!id) return;
    try {
      const res = await API.getUsage(managingAsSuperAdmin ? id : null, usageMonth.value);
      if (id !== activeUserId()) return; // cambió de carrusel mientras cargaba
      renderPlan(res?.data || {});
    } catch {
      planPanel.hidden = true;
    }
  }

  function renderPlan({ storage, usage }) {
    if (!storage || !usage) { planPanel.hidden = true; return; }
    const { pct, cls } = storageLevel(storage.usedBytes, storage.limitBytes);
    storageText.textContent = `${formatBytes(storage.usedBytes)} de ${formatBytes(storage.limitBytes)}`;
    storageMeter.className = `meter ${cls}`.trim();
    storageMeter.setAttribute('aria-valuenow', String(pct));
    storageFill.style.width = `${pct}%`;
    storageHint.textContent = storage.freeBytes > 0
      ? `Te quedan ${formatBytes(storage.freeBytes)} (${100 - pct} % libre).`
      : 'Espacio lleno: borra imágenes o pide más espacio para seguir subiendo.';

    const videos = usage.videos
      ? `${formatInt(usage.videos)}${usage.videoSeconds ? ` · ${formatInt(usage.videoSeconds)} s` : ''}`
      : '0';
    const stats = [
      ['Imágenes', formatInt(usage.images)],
      ['Videos', videos],
      ['Tokens', formatInt(usage.tokensTotal)],
      ['Costo aprox.', formatUsd(usage.estimatedCostUsd)],
    ];
    usageStats.innerHTML = stats
      .map(([label, value]) => `<div class="usage-stat"><span class="usage-stat__value">${escapeHtml(value)}</span><span class="usage-stat__label">${escapeHtml(label)}</span></div>`)
      .join('');
    usageHint.textContent = usage.images || usage.videos || usage.tokensTotal
      ? `Tokens: los que reporta el proveedor. Costo aproximado: ${formatInt(usage.imagesNoTokens)} ${usage.imagesNoTokens === 1 ? 'imagen' : 'imágenes'} sin tokens reportados × ${formatUsd(usage.imagePriceUsd)}.`
      : 'Sin generación registrada en este mes.';
    planPanel.hidden = false;
  }

  usageMonth.addEventListener('change', loadPlan);

  const FORMATS = ['horizontal', 'vertical', 'cuadrado', 'horizontal43', 'vertical34'];
  const normFormat = (f) => (FORMATS.includes(f) ? f : 'horizontal');

  // Tamaño del póster = formato + resolución (lado corto). Misma tabla que posterSize en
  // api/_utils.js y tamanoPoster en n8n/formato.js.
  const RESOLUTIONS = ['hd', 'fullhd', '2k', '4k'];
  const RESOLUTION_SHORT_SIDE = { hd: 720, fullhd: 1080, '2k': 1440, '4k': 2160 };
  const FORMAT_RATIO = { horizontal: [16, 9], vertical: [9, 16], cuadrado: [1, 1], horizontal43: [4, 3], vertical34: [3, 4] };
  const normResolution = (r) => (RESOLUTIONS.includes(r) ? r : 'fullhd');
  function posterSize(format, resolution) {
    const [rw, rh] = FORMAT_RATIO[normFormat(format)];
    const unit = RESOLUTION_SHORT_SIDE[normResolution(resolution)] / Math.min(rw, rh);
    return { width: Math.round(rw * unit), height: Math.round(rh * unit) };
  }
  function renderSizeHint() {
    if (!formatSizeHint) return;
    const { width, height } = posterSize(genOrientation, genResolution);
    formatSizeHint.textContent = `Tamaño del póster: ${width} × ${height} px`;
  }

  // Duración escrita en un <input type="number">: vacío -> null (usa la del carrusel).
  const MIN_DURATION = 2;
  const MAX_DURATION = 3600;
  const DURATION_ERROR = `La duración debe ser un número entero entre ${MIN_DURATION} y ${MAX_DURATION} segundos`;
  function readDuration(input) {
    const raw = input.value.trim();
    if (raw === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < MIN_DURATION || n > MAX_DURATION) throw new Error(DURATION_ERROR);
    return n;
  }

  // Aviso de novedades: una sola vez por navegador al entrar al panel.
  const NEWS_KEY = 'carrusel:novedad';
  const NEWS_ID = 'duracion-v1';
  function announceNews() {
    try {
      if (localStorage.getItem(NEWS_KEY) === NEWS_ID) return;
      localStorage.setItem(NEWS_KEY, NEWS_ID);
    } catch { return; /* sin storage no se puede recordar: mejor no repetir el aviso */ }
    alert('Nueva actualización: ahora puedes modificar el tiempo de cada imagen.');
  }

  // ===== Estado de una imagen: suspendida, programada, difuminado =====
  const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  // "2026-10-17" -> "17 oct" (con el año si no es el actual)
  function dayLabel(ymd) {
    const [y, m, d] = String(ymd).split('-').map(Number);
    return `${d} ${MONTH_NAMES[m - 1]}${y === new Date().getFullYear() ? '' : ` ${y}`}`;
  }
  // Textos cortos de una programación: ["Solo vie", "17 oct – 23 nov"]
  function scheduleLabels(schedule) {
    if (!schedule) return [];
    const out = [];
    if (Array.isArray(schedule.days) && schedule.days.length) {
      // De lunes a domingo, como en el formulario
      const days = schedule.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      out.push(`Solo ${days.map((d) => DAY_NAMES[d]).join(', ')}`);
    }
    if (schedule.from && schedule.to) out.push(`${dayLabel(schedule.from)} – ${dayLabel(schedule.to)}`);
    else if (schedule.from) out.push(`Desde ${dayLabel(schedule.from)}`);
    else if (schedule.to) out.push(`Hasta ${dayLabel(schedule.to)}`);
    return out;
  }
  function imageTags(img) {
    const tags = [];
    if (img.suspended) tags.push(['Suspendida', true]);
    scheduleLabels(img.schedule).forEach((t) => tags.push([t, false]));
    // El servidor dice si hoy sale (cuenta el día en la zona del negocio)
    if (!img.suspended && img.schedule && img.visibleNow === false) tags.push(['Hoy no se muestra', true]);
    if (img.blur) tags.push(['Difuminado', false]);
    if (!tags.length) return '';
    return `<div class="image-card__tags">${tags.map(([t, off]) => `<span class="tag${off ? ' tag--off' : ''}">${escapeHtml(t)}</span>`).join('')}</div>`;
  }

  function viewLabel(v) {
    return { horizontal: '▭ Horizontal', vertical: '▯ Vertical', rotate: '↻ Girar 90°' }[v] || 'Auto';
  }

  // ===== Auth =====
  async function checkAuth() {
    try {
      const res = await API.me();
      if (res.authenticated) {
        session = { role: res.role, userId: res.userId, name: res.name, email: res.email };
        if (res.role === 'super-admin') showSuperAdmin();
        else if (res.role === 'user') {
          currentUserId = res.userId;
          managingAsSuperAdmin = false;
          showUserDashboard();
        }
        // Tras pintar el panel, para que el aviso no tape una página en blanco.
        setTimeout(announceNews, 400);
        return;
      }
    } catch { /* ignore */ }
    showLogin();
  }

  function showLogin() {
    loginView.hidden = false;
    superAdminDashboard.hidden = true;
    userDashboard.hidden = true;
    session = null;
    currentUserId = null;
    managingAsSuperAdmin = false;
  }

  function showSuperAdmin() {
    loginView.hidden = true;
    superAdminDashboard.hidden = false;
    userDashboard.hidden = true;
    managingAsSuperAdmin = false;
    currentUserId = null;
    loadSuperAdminUsers();
  }

  function showUserDashboard() {
    loginView.hidden = true;
    superAdminDashboard.hidden = true;
    userDashboard.hidden = false;
    const id = activeUserId();
    const name = managingAsSuperAdmin
      ? (superAdminUsers.find((u) => u.userId === id)?.name || id)
      : (session?.name || id);
    userDashboardTitle.textContent = managingAsSuperAdmin ? `${name} (${id})` : (name || id);
    userPublicLink.href = `/carrusel/${encodeURIComponent(id)}`;
    backToUsersBtn.hidden = !managingAsSuperAdmin;
    userSettingsBtn.hidden = managingAsSuperAdmin;
    planPanel.hidden = true;
    usageMonth.value = recentMonths(1)[0];
    loadUserImages();
  }

  // ===== Login tabs =====
  loginTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      loginTabs.forEach(t => { t.classList.toggle('is-active', t === tab); t.setAttribute('aria-selected', t === tab); });
      loginPanels.forEach(p => p.classList.toggle('is-active', p.id === 'panel' + (mode === 'admin' ? 'Admin' : 'User')));
    });
  });

  // ===== Super-Admin login =====
  adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    adminLoginError.textContent = '';
    adminLoginBtn.disabled = true;
    adminLoginBtn.textContent = 'Entrando…';
    try {
      await API.loginAdmin(adminPassword.value);
      adminPassword.value = '';
      session = { role: 'super-admin' };
      showSuperAdmin();
      toast('Sesión de Super-Admin iniciada');
      setTimeout(announceNews, 400);
    } catch (err) {
      adminLoginError.textContent = err.message || 'Error de acceso';
    } finally {
      adminLoginBtn.disabled = false;
      adminLoginBtn.textContent = 'Entrar como Super-Admin';
    }
  });

  // ===== User login =====
  userLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    userLoginError.textContent = '';
    userLoginBtn.disabled = true;
    userLoginBtn.textContent = 'Entrando…';
    try {
      const res = await API.loginUser(userEmail.value.trim().toLowerCase(), userPassword.value);
      session = {
        role: res.data?.role || 'user',
        userId: res.data?.userId,
        name: res.data?.name,
        email: res.data?.email,
      };
      userEmail.value = '';
      userPassword.value = '';
      currentUserId = session.userId;
      managingAsSuperAdmin = false;
      showUserDashboard();
      toast('Sesión de usuario iniciada');
      setTimeout(announceNews, 400);
    } catch (err) {
      userLoginError.textContent = err.message || 'Error de acceso';
    } finally {
      userLoginBtn.disabled = false;
      userLoginBtn.textContent = 'Entrar como Usuario';
    }
  });

  superAdminLogoutBtn.addEventListener('click', async () => {
    try { await API.logout(); } catch { /* ignore */ }
    session = null;
    showLogin();
    toast('Sesión cerrada');
  });

  userLogoutBtn.addEventListener('click', async () => {
    try { await API.logout(); } catch { /* ignore */ }
    showLogin();
    toast('Sesión cerrada');
  });

  // Cierra la sesión en todos los dispositivos (también deja sin efecto una cookie copiada).
  async function logoutEverywhere() {
    if (!confirm('¿Cerrar la sesión en todos los dispositivos? Tendrás que volver a entrar.')) return;
    try {
      await API.logoutAll();
      session = null;
      closeSettingsModal();
      showLogin();
      toast('Todas las sesiones cerradas');
    } catch (err) { toast(err.message, 'error'); }
  }
  superAdminLogoutAllBtn.addEventListener('click', logoutEverywhere);
  selfLogoutAllBtn.addEventListener('click', logoutEverywhere);

  // Precio aproximado por imagen (configuración global del super-admin)
  async function loadConfig() {
    try {
      const res = await API.getConfig();
      priceInput.value = res?.data?.imagePriceUsd ?? '';
    } catch { /* se queda vacío */ }
  }

  priceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = Number(priceInput.value);
    if (priceInput.value.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) {
      toast('El precio debe ser un número entre 0 y 100', 'error');
      return;
    }
    priceSaveBtn.disabled = true;
    try {
      const res = await API.updateConfig({ imagePriceUsd: value });
      priceInput.value = res?.data?.imagePriceUsd ?? value;
      toast('Precio por imagen guardado');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      priceSaveBtn.disabled = false;
    }
  });

  backToUsersBtn.addEventListener('click', () => {
    showSuperAdmin();
  });

  // ===== Super-Admin: User Management =====
  async function loadSuperAdminUsers() {
    superAdminGrid.innerHTML = Array.from({ length: 4 }).map(() => '<div class="skeleton"></div>').join('');
    loadConfig();
    try {
      const res = await API.getUsers();
      superAdminUsers = Array.isArray(res?.data?.users) ? res.data.users : [];
      renderSuperAdminGrid();
    } catch (err) {
      toast(err.message, 'error');
      superAdminGrid.innerHTML = '';
    }
  }

  function renderSuperAdminGrid() {
    superAdminCount.textContent = `${superAdminUsers.length} usuario${superAdminUsers.length === 1 ? '' : 's'}`;
    if (superAdminUsers.length === 0) {
      superAdminGrid.innerHTML = '';
      superAdminEmpty.hidden = false;
      return;
    }
    superAdminEmpty.hidden = true;
    superAdminGrid.innerHTML = superAdminUsers
      .map((user) => {
        const thumbs = (user.preview || []).map((url) => `
          <a class="user-card__thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
            <img src="${escapeHtml(url)}" alt="" loading="lazy" />
          </a>`).join('');
        const level = storageLevel(user.usedBytes, user.limitBytes);
        return `
      <article class="image-card user-card" data-userid="${escapeHtml(user.userId)}">
        <div class="user-card__preview">${thumbs || '<span class="user-card__nophoto">Sin imágenes</span>'}</div>
        <div class="image-card__body" style="padding: 1.2rem;">
          <div class="user-card__name" style="font-size: 1.1rem;">${escapeHtml(user.name || user.userId)}</div>
          <div class="user-card__email" style="font-size: 0.85rem; color: var(--ink-dim);">${escapeHtml(user.email || '')}</div>
          <div class="user-card__id" style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent);">
            ${escapeHtml(user.userId)} · ${user.imageCount ?? 0} ${(user.imageCount ?? 0) === 1 ? 'imagen' : 'imágenes'}
          </div>
          <div class="user-card__storage">
            <div class="meter ${level.cls}"><div class="meter__fill" style="width:${level.pct}%"></div></div>
            <span>${escapeHtml(formatBytes(user.usedBytes))} de ${escapeHtml(formatBytes(user.limitBytes))} · ${user.hasToken ? 'con token' : 'sin token'}</span>
          </div>
          <div class="user-card__meta" style="font-size: 0.8rem; color: var(--ink-dim);">
            Creado: ${user.createdAt ? new Date(user.createdAt).toLocaleString() : '—'}
            ${user.updatedAt ? ' · Actualizado: ' + new Date(user.updatedAt).toLocaleString() : ''}
          </div>
          <div style="display:flex; gap:.4rem; margin-top:.8rem; flex-wrap:wrap;">
            <button class="icon-btn" data-action="manage" data-userid="${escapeHtml(user.userId)}" aria-label="Ver y gestionar carrusel" title="Ver y gestionar carrusel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <a class="icon-btn" href="/carrusel/${escapeHtml(user.userId)}" target="_blank" rel="noopener" aria-label="Ver carrusel público" title="Ver carrusel público">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>
            </a>
            <button class="icon-btn" data-action="settings" data-userid="${escapeHtml(user.userId)}" aria-label="Ajustes: cuenta, espacio, token y webhook" title="Ajustes: cuenta, espacio, token y webhook">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button class="icon-btn icon-btn--danger" data-action="delete" data-userid="${escapeHtml(user.userId)}" aria-label="Eliminar usuario" title="Eliminar usuario">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </div>
      </article>`;
      })
      .join('');
  }

  // Super-Admin grid actions
  superAdminGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, userid } = btn.dataset;
    if (action === 'manage') {
      currentUserId = userid;
      managingAsSuperAdmin = true;
      showUserDashboard();
      toast(`Viendo el carrusel de ${userid}`);
    } else if (action === 'settings') {
      const user = superAdminUsers.find((u) => u.userId === userid);
      openSettingsModal(user || { userId: userid });
    } else if (action === 'delete') {
      if (!confirm(`¿Eliminar al usuario ${userid} y todo su carrusel? Esta acción no se puede deshacer.`)) return;
      try {
        await API.deleteUser(userid);
        toast(`Usuario ${userid} eliminado`);
        await loadSuperAdminUsers();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  // Add / Edit User
  addUserBtn.addEventListener('click', () => openUserModal());

  function generatePassword(length = 12) {
    const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
    const buf = new Uint32Array(length);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => chars[n % chars.length]).join('');
  }

  function openUserModal() {
    userModalTitle.textContent = 'Nuevo usuario';
    newUserName.value = '';
    newUserEmail.value = '';
    newUserPassword.value = '';
    newUserPassword.type = 'password';
    userSaveBtn.textContent = 'Crear usuario';
    userFormError.textContent = '';
    userModalBackdrop.classList.add('is-open');
    setTimeout(() => newUserName.focus(), 60);
  }

  function closeUserModal() {
    userModalBackdrop.classList.remove('is-open');
  }

  newUserPwdToggle.addEventListener('click', () => {
    newUserPassword.type = newUserPassword.type === 'password' ? 'text' : 'password';
  });

  newUserPwdGen.addEventListener('click', () => {
    newUserPassword.value = generatePassword();
    newUserPassword.type = 'text';
  });

  userCancelBtn.addEventListener('click', closeUserModal);
  userModalBackdrop.addEventListener('click', (e) => { if (e.target === userModalBackdrop) closeUserModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && userModalBackdrop.classList.contains('is-open')) closeUserModal(); });

  userModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    userFormError.textContent = '';
    const name = newUserName.value.trim();
    const email = newUserEmail.value.trim().toLowerCase();
    if (!name) { userFormError.textContent = 'El nombre es obligatorio'; return; }
    if (!email) { userFormError.textContent = 'El correo es obligatorio'; return; }
    userSaveBtn.disabled = true;
    try {
      const pwd = newUserPassword.value;
      if (pwd.length < MIN_PASSWORD) { userFormError.textContent = PASSWORD_ERROR; return; }
      userSaveBtn.textContent = 'Creando…';
      const res = await API.addUser({ name, email, password: pwd });
      closeUserModal();
      await loadSuperAdminUsers();
      openPwdReveal(res.data.userId, res.data.password);
    } catch (err) {
      userFormError.textContent = err.message;
    } finally {
      userSaveBtn.disabled = false;
      userSaveBtn.textContent = 'Crear usuario';
    }
  });

  // Password or token shown once (on create / change / generate)
  let revealNoun = 'Contraseña';
  function openSecretReveal({ title, hint, label, value }) {
    revealNoun = label;
    pwdRevealTitle.textContent = title;
    pwdRevealHint.textContent = hint;
    pwdRevealLabel.textContent = label;
    pwdRevealText.value = value;
    pwdRevealBackdrop.classList.add('is-open');
  }

  function openPwdReveal(userId, password) {
    openSecretReveal({
      title: `Contraseña de ${userId}`,
      hint: 'Guárdala ahora: no se podrá volver a ver.',
      label: 'Contraseña',
      value: password,
    });
  }

  function closePwdReveal() {
    pwdRevealBackdrop.classList.remove('is-open');
    pwdRevealText.value = '';
  }

  pwdRevealCopyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pwdRevealText.value);
    } catch {
      pwdRevealText.select();
      document.execCommand('copy');
    }
    toast(revealNoun === 'Token' ? 'Token copiado' : 'Contraseña copiada');
  });

  pwdRevealCloseBtn.addEventListener('click', closePwdReveal);
  pwdRevealBackdrop.addEventListener('click', (e) => { if (e.target === pwdRevealBackdrop) closePwdReveal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pwdRevealBackdrop.classList.contains('is-open')) closePwdReveal(); });

  // ===== Color Palette Helpers =====
  function renderColorPalette() {
    colorPaletteRow.innerHTML = colorSwatches
      .map((swatch, idx) => `
        <div class="color-swatch" data-idx="${idx}">
          <input type="color" class="color-swatch__native" value="${escapeHtml(swatch.hex)}" data-idx="${idx}" />
          <input type="text" class="color-swatch__hex" value="${escapeHtml(swatch.hex)}"
                 maxlength="9" placeholder="#RRGGBB" data-idx="${idx}" />
          <button class="icon-btn icon-btn--danger color-swatch__remove"
                  type="button" data-idx="${idx}" aria-label="Quitar color">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>`)
      .join('');
    addColorBtn.hidden = colorSwatches.length >= 5;
  }

  // Al editar la configuración se oculta el aviso de "guardado" para no confundir.
  function clearGenOk() { if (genFormOk) genFormOk.hidden = true; }
  genDriveUrl.addEventListener('input', clearGenOk);
  addColorBtn.addEventListener('click', clearGenOk);

  colorPaletteRow.addEventListener('input', (e) => {
    clearGenOk();
    const idx = parseInt(e.target.dataset.idx, 10);
    if (isNaN(idx)) return;
    const hex = e.target.value.trim();
    colorSwatches[idx] = { hex };
    const swatch = colorPaletteRow.querySelectorAll('.color-swatch')[idx];
    if (swatch) {
      swatch.querySelector('.color-swatch__native').value = hex;
      swatch.querySelector('.color-swatch__hex').value = hex;
    }
  });

  colorPaletteRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch__remove');
    if (!btn) return;
    clearGenOk();
    const idx = parseInt(btn.dataset.idx, 10);
    if (!isNaN(idx)) {
      colorSwatches.splice(idx, 1);
      renderColorPalette();
    }
  });

  addColorBtn.addEventListener('click', () => {
    if (colorSwatches.length >= 5) return;
    colorSwatches.push({ hex: '#e8b04b' });
    renderColorPalette();
  });

  // ===== Controles segmentados (orientación) =====
  function markSeg(segEl, value) {
    if (!segEl) return;
    segEl.querySelectorAll('.seg__btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.value === value);
    });
  }
  if (orientSeg) {
    orientSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg__btn');
      if (!b) return;
      genOrientation = normFormat(b.dataset.value);
      markSeg(orientSeg, genOrientation);
      renderSizeHint();
      clearGenOk();
    });
  }
  if (resSeg) {
    resSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg__btn');
      if (!b) return;
      genResolution = normResolution(b.dataset.value);
      markSeg(resSeg, genResolution);
      renderSizeHint();
      clearGenOk();
    });
  }
  if (viewSeg) {
    viewSeg.addEventListener('click', (e) => {
      const b = e.target.closest('.seg__btn');
      if (!b) return;
      imgView = b.dataset.value || 'auto';
      markSeg(viewSeg, imgView);
    });
  }

  // ===== User Settings Button (regular user) =====
  userSettingsBtn.addEventListener('click', () => {
    openSettingsModal({ userId: session.userId, name: session.name, email: session.email });
  });

  // ===== Settings Modal (account + n8n webhook)
  function webhookInfo(userId, images = []) {
    const origin = window.location.origin;
    const imgList = images.length
      ? images.map((i) => ({ url: i.url, alt: i.alt || '' }))
      : [{ url: 'https://ejemplo.com/imagen1.jpg', alt: 'Texto de la imagen' }];
    const payload = { images: imgList, mode: 'append' };
    const body = JSON.stringify(payload, null, 2);
    const block = [
      `URL: ${origin}/api/webhook/${userId}`,
      'Method: POST',
      'Header: Content-Type: application/json',
      'Header: X-Webhook-Timestamp: {{ $json.timestamp }}',
      'Header: X-Webhook-Secret: {{ $json.signature }}',
      'Body:',
      body,
    ].join('\n');
    return {
      url: `${origin}/api/webhook/${userId}`,
      headers: 'Content-Type: application/json\nX-Webhook-Timestamp: <segundos Unix>\nX-Webhook-Secret: <HMAC-SHA256 hex de "timestamp.cuerpo" con el token del carrusel>',
      body,
      upload: `${origin}/api/upload/${userId}   ·   { "url": "<URL temporal>", "alt": "..." }`,
      block,
    };
  }

  async function openSettingsModal(user) {
    settingsUserId = user.userId;
    const isSelfService = session?.role === 'user';
    settingsModalTitle.textContent = isSelfService
      ? `Configuración — ${user.name || user.userId}`
      : `Ajustes de ${user.name || user.userId} (${user.userId})`;

    // Show/hide sections depending on role
    const accountFields = [setName.closest('.field'), setEmail.closest('.field'), setPassword.closest('.field')];
    accountSection.hidden = isSelfService;
    accountFields.forEach((f) => { if (f) f.hidden = isSelfService; });
    settingsFormError.hidden = isSelfService;
    webhookDocs.hidden = isSelfService;
    planSection.hidden = isSelfService;
    selfLogoutAllBtn.hidden = !isSelfService;
    settingsSaveBtn.hidden = isSelfService;
    settingsSaveGenBtn.hidden = !isSelfService;

    if (!isSelfService) {
      setName.value = user.name || '';
      setEmail.value = user.email || '';
      setPassword.value = '';
      setPassword.type = 'password';
      settingsFormError.textContent = '';
      setStorageLimit.value = user.storageLimitMb ?? '';
      setStorageLimit.placeholder = String(user.defaultLimitMb ?? 500);
      setStorageHint.textContent = user.limitBytes
        ? `Usado: ${formatBytes(user.usedBytes)} de ${formatBytes(user.limitBytes)}. Déjalo vacío para usar el límite por defecto (${user.defaultLimitMb ?? 500} MB).`
        : 'Déjalo vacío para usar el límite por defecto.';
      renderTokenStatus(user);
      const wh = webhookInfo(user.userId, []);
      whUrl.textContent = wh.url;
      whHeaders.textContent = wh.headers;
      whBody.textContent = wh.body;
      whUpload.textContent = wh.upload;
      n8nBlock.textContent = wh.block;
    }

    // Reset generation fields
    genDriveUrl.value = '';
    genSlideDuration.value = '';
    colorSwatches = [];
    genFormError.textContent = '';
    genFormOk.hidden = true;
    genFormOk.textContent = '';
    genOrientation = 'horizontal';
    genResolution = 'fullhd';
    markSeg(orientSeg, genOrientation);
    markSeg(resSeg, genResolution);
    renderSizeHint();
    renderColorPalette();

    settingsModalBackdrop.classList.add('is-open');
    if (!isSelfService) setTimeout(() => setName.focus(), 60);

    // Load real images for n8n block (super-admin only)
    if (!isSelfService) {
      try {
        const res = await API.getImages(user.userId);
        const images = (res?.data?.images || []).slice().sort((a, b) => a.order - b.order);
        const full = webhookInfo(user.userId, images);
        n8nBlock.textContent = full.block;
        whBody.textContent = full.body;
      } catch { /* keep example */ }
    }

    // Load generation settings async
    const genUserId = isSelfService ? null : user.userId;
    try {
      const res = await API.getSettings(genUserId);
      const s = res?.data || {};
      genDriveUrl.value = s.googleDriveFolder || '';
      genSlideDuration.value = s.slideDuration || '';
      colorSwatches = Array.isArray(s.colorPalette) ? s.colorPalette.map((hex) => ({ hex })) : [];
      genOrientation = normFormat(s.defaultOrientation);
      genResolution = normResolution(s.posterResolution);
      markSeg(orientSeg, genOrientation);
      markSeg(resSeg, genResolution);
      renderSizeHint();
      renderColorPalette();
    } catch { /* leave fields empty */ }
  }

  function renderTokenStatus(user) {
    if (user.hasToken) {
      const when = user.tokenCreatedAt ? ` · creado el ${new Date(user.tokenCreatedAt).toLocaleString()}` : '';
      tokenStatus.textContent = `••••${user.tokenHint || ''}${when}`;
      tokenGenBtn.textContent = 'Regenerar token';
    } else {
      tokenStatus.textContent = 'Sin token (se acepta la firma global antigua)';
      tokenGenBtn.textContent = 'Generar token';
    }
  }

  tokenGenBtn.addEventListener('click', async () => {
    const userId = settingsUserId;
    if (!userId) return;
    const user = superAdminUsers.find((u) => u.userId === userId) || { userId };
    const question = user.hasToken
      ? `¿Regenerar el token de ${userId}? El token actual dejará de funcionar y habrá que pegar el nuevo en n8n.`
      : `¿Generar el token de ${userId}? Desde ese momento n8n tendrá que firmar con él las peticiones de este carrusel.`;
    if (!confirm(question)) return;
    tokenGenBtn.disabled = true;
    try {
      const res = await API.generateToken(userId);
      Object.assign(user, { hasToken: true, tokenHint: res.data.hint, tokenCreatedAt: res.data.createdAt });
      renderTokenStatus(user);
      openSecretReveal({
        title: `Token de ${userId}`,
        hint: 'Cópialo ahora y pégalo en la fila de este cliente en n8n. No se podrá volver a ver: si lo pierdes, regenera uno nuevo.',
        label: 'Token',
        value: res.data.token,
      });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      tokenGenBtn.disabled = false;
    }
  });

  function closeSettingsModal() {
    settingsModalBackdrop.classList.remove('is-open');
    settingsUserId = null;
    setPassword.value = '';
    colorSwatches = [];
    genFormError.textContent = '';
    genFormOk.hidden = true;
    genFormOk.textContent = '';
  }

  generateImagesBtn.addEventListener('click', async () => {
    genFormError.textContent = '';
    const isSelfService = session?.role === 'user';
    const targetUserId = isSelfService ? null : settingsUserId;
    generateImagesBtn.disabled = true;
    generateImagesBtn.textContent = 'Generando…';
    try {
      await API.generateImages(targetUserId);
      toast('Generación iniciada — las imágenes llegarán pronto al carrusel.');
      closeSettingsModal();
    } catch (err) {
      genFormError.textContent = err.message;
    } finally {
      generateImagesBtn.disabled = false;
      generateImagesBtn.textContent = '⚡ Generar imágenes';
    }
  });

  setPwdToggle.addEventListener('click', () => {
    setPassword.type = setPassword.type === 'password' ? 'text' : 'password';
  });

  setPwdGen.addEventListener('click', () => {
    setPassword.value = generatePassword();
    setPassword.type = 'text';
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Copiado');
  }

  settingsModalForm.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-copy]');
    if (!btn) return;
    const el = document.getElementById(btn.dataset.copy);
    if (el) copyText(el.textContent);
  });

  settingsCancelBtn.addEventListener('click', closeSettingsModal);
  settingsModalBackdrop.addEventListener('click', (e) => { if (e.target === settingsModalBackdrop) closeSettingsModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && settingsModalBackdrop.classList.contains('is-open')) closeSettingsModal(); });

  settingsModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = settingsUserId;
    const isSelfService = session?.role === 'user';

    const palette = colorSwatches.map((s) => s.hex).filter((h) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h));
    const genPayload = {
      googleDriveFolder: genDriveUrl.value.trim() || null,
      colorPalette: palette.length ? palette : null,
      defaultOrientation: genOrientation,
      posterResolution: genResolution,
    };
    try {
      genPayload.slideDuration = readDuration(genSlideDuration);
    } catch (err) {
      genFormError.textContent = err.message;
      return;
    }

    if (isSelfService) {
      genFormError.textContent = '';
      genFormOk.hidden = true;
      settingsSaveGenBtn.disabled = true;
      settingsSaveGenBtn.textContent = 'Guardando…';
      try {
        const res = await API.updateSettings(null, genPayload);
        // Reflejar lo que quedó guardado en el servidor (por si normaliza datos).
        const saved = res?.data || genPayload;
        genDriveUrl.value = saved.googleDriveFolder || '';
        genSlideDuration.value = saved.slideDuration || '';
        colorSwatches = Array.isArray(saved.colorPalette) ? saved.colorPalette.map((hex) => ({ hex })) : [];
        renderColorPalette();
        genFormOk.textContent = '✓ Guardado correctamente';
        genFormOk.hidden = false;
        toast('Configuración guardada');
      } catch (err) {
        genFormError.textContent = err.message || 'No se pudo guardar';
        toast('No se pudo guardar la configuración', 'error');
      } finally {
        settingsSaveGenBtn.disabled = false;
        settingsSaveGenBtn.textContent = 'Guardar configuración';
      }
      return;
    }

    // Super-admin: save account fields
    settingsFormError.textContent = '';
    const name = setName.value.trim();
    const email = setEmail.value.trim().toLowerCase();
    const pwd = setPassword.value;
    if (!name) { settingsFormError.textContent = 'El nombre es obligatorio'; return; }
    if (!email) { settingsFormError.textContent = 'El correo es obligatorio'; return; }
    if (pwd && pwd.length < MIN_PASSWORD) { settingsFormError.textContent = PASSWORD_ERROR; return; }
    const limitRaw = setStorageLimit.value.trim();
    const storageLimitMb = limitRaw === '' ? null : Number(limitRaw);
    if (storageLimitMb !== null && (!Number.isInteger(storageLimitMb) || storageLimitMb < 1)) {
      settingsFormError.textContent = 'El límite de almacenamiento debe ser un número entero de MB (1 o más)';
      return;
    }
    settingsSaveBtn.disabled = true; settingsSaveBtn.textContent = 'Guardando…';
    try {
      await API.updateUser(userId, { name, email, storageLimitMb });
      let newPassword = null;
      if (pwd) {
        const res = await API.changeUserPassword(userId, pwd);
        newPassword = res?.data?.password || pwd;
      }
      // Also save generation settings (non-fatal)
      try {
        await API.updateSettings(userId, genPayload);
      } catch (genErr) {
        toast(`Configuración de generación: ${genErr.message}`, 'error');
      }
      closeSettingsModal();
      await loadSuperAdminUsers();
      if (newPassword) openPwdReveal(userId, newPassword);
      else toast(`Usuario ${userId} actualizado`);
    } catch (err) {
      settingsFormError.textContent = err.message;
    } finally {
      settingsSaveBtn.disabled = false; settingsSaveBtn.textContent = 'Guardar cambios';
    }
  });

  // ===== User Dashboard: Image Management =====
  async function loadUserImages() {
    if (!activeUserId()) return;
    userGrid.innerHTML = Array.from({ length: 4 }).map(() => '<div class="skeleton"></div>').join('');
    try {
      const res = await API.getImages(activeUserId());
      userImages = (res?.data?.images || res?.images || []).slice().sort((a, b) => a.order - b.order);
      renderUserGrid();
      loadPlan(); // el espacio cambia al subir o borrar
    } catch (err) {
      toast(err.message, 'error');
      userGrid.innerHTML = '';
    }
  }

  function renderUserGrid() {
    userCountHint.textContent = `${userImages.length} imagen${userImages.length === 1 ? '' : 'es'}`;
    if (userImages.length === 0) {
      userGrid.innerHTML = '';
      userGridEmpty.hidden = false;
      return;
    }
    userGridEmpty.hidden = true;
    userGrid.innerHTML = userImages
      .map((img, idx) => `
      <article class="image-card${img.suspended ? ' is-suspended' : ''}" draggable="true" data-id="${escapeHtml(img.id)}">
        <a class="image-card__thumb-link" href="${escapeHtml(img.url)}" target="_blank" rel="noopener noreferrer" draggable="false" title="Abrir en una pestaña nueva">
          <img class="image-card__thumb" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || '')}" loading="lazy" draggable="false" />
          <span class="image-card__open">Abrir ↗</span>
        </a>
        <div class="image-card__body">
          <div class="image-card__alt">${escapeHtml(img.alt || 'Sin título')}</div>
          <a class="image-card__url" href="${escapeHtml(img.url)}" target="_blank" rel="noopener noreferrer" draggable="false" title="Abrir: ${escapeHtml(img.url)}">${escapeHtml(img.url)}</a>
          ${imageTags(img)}
          <div class="image-card__foot">
            <span class="image-card__order">#${img.order} · ${viewLabel(img.view)}${img.duration ? ` · ${Number(img.duration)} s` : ''}</span>
            <div style="display:flex; gap:.4rem;">
              <button class="icon-btn touch-only" data-action="up" data-id="${escapeHtml(img.id)}" aria-label="Mover antes" title="Mover antes"${idx === 0 ? ' disabled' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
              </button>
              <button class="icon-btn touch-only" data-action="down" data-id="${escapeHtml(img.id)}" aria-label="Mover después" title="Mover después"${idx === userImages.length - 1 ? ' disabled' : ''}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
              </button>
              <button class="icon-btn" data-action="suspend" data-id="${escapeHtml(img.id)}" aria-label="${img.suspended ? 'Reactivar' : 'Suspender'}" title="${img.suspended ? 'Reactivar: volver a mostrarla' : 'Suspender: dejar de mostrarla sin borrarla'}">
                ${img.suspended
                  ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 5l12 7-12 7z"/></svg>'
                  : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 5v14"/><path d="M16 5v14"/></svg>'}
              </button>
              <button class="icon-btn" data-action="edit" data-id="${escapeHtml(img.id)}" aria-label="Editar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button class="icon-btn icon-btn--danger" data-action="delete" data-id="${escapeHtml(img.id)}" aria-label="Eliminar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>
          </div>
        </div>
        <!-- Responsive previews -->
        <div class="image-card__previews" aria-hidden="true">
          <div class="preview-item" data-size="mobile" title="Móvil (375px)">
            <img src="${escapeHtml(img.url)}" alt="" loading="lazy" />
            <span class="preview-label">Móvil</span>
          </div>
          <div class="preview-item" data-size="tablet" title="Tablet (768px)">
            <img src="${escapeHtml(img.url)}" alt="" loading="lazy" />
            <span class="preview-label">Tablet</span>
          </div>
          <div class="preview-item" data-size="tv" title="TV (1920px)">
            <img src="${escapeHtml(img.url)}" alt="" loading="lazy" />
            <span class="preview-label">TV</span>
          </div>
        </div>
      </article>`)
      .join('');
  }

  // Mover una tarjeta un lugar (botones ↑ ↓: en pantallas táctiles no hay arrastre).
  async function moveImage(id, step) {
    const from = userImages.findIndex((i) => i.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= userImages.length) return;
    const [moved] = userImages.splice(from, 1);
    userImages.splice(to, 0, moved);
    const orders = userImages.map((img, idx) => ({ id: img.id, order: idx }));
    userImages.forEach((img, idx) => (img.order = idx));
    renderUserGrid();
    try {
      await API.reorderImages(activeUserId(), orders);
      toast('Orden actualizado');
    } catch (err) {
      toast(err.message, 'error');
      await loadUserImages();
    }
  }

  // Image Modal
  function openImgModal(image = null) {
    editingImgId = image ? image.id : null;
    imgModalTitle.textContent = image ? 'Editar imagen' : 'Añadir imagen';
    imgUrl.value = image ? image.url : '';
    imgAlt.value = image ? image.alt : '';
    imgView = (image && image.view) ? image.view : 'auto';
    markSeg(viewSeg, imgView);
    imgDuration.value = (image && image.duration) ? image.duration : '';
    const schedule = (image && image.schedule) || {};
    markDays(Array.isArray(schedule.days) ? schedule.days : []);
    imgFrom.value = schedule.from || '';
    imgTo.value = schedule.to || '';
    imgBlur.checked = Boolean(image && image.blur);
    imgSuspended.checked = Boolean(image && image.suspended);
    imgFormError.textContent = '';
    imgModalBackdrop.classList.add('is-open');
    setTimeout(() => imgUrl.focus(), 60);
  }

  function closeImgModal() {
    imgModalBackdrop.classList.remove('is-open');
    editingImgId = null;
  }

  // Días de la semana: varios a la vez (0 = domingo … 6 = sábado)
  function markDays(days) {
    imgDaysSeg.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', days.includes(Number(b.dataset.day))));
  }
  const selectedDays = () => [...imgDaysSeg.querySelectorAll('.seg__btn.is-active')].map((b) => Number(b.dataset.day));
  imgDaysSeg.addEventListener('click', (e) => {
    const b = e.target.closest('.seg__btn');
    if (b) b.classList.toggle('is-active');
  });
  imgScheduleClear.addEventListener('click', () => {
    markDays([]);
    imgFrom.value = '';
    imgTo.value = '';
  });

  addImgBtn.addEventListener('click', () => openImgModal());
  imgCancelBtn.addEventListener('click', closeImgModal);
  imgModalBackdrop.addEventListener('click', (e) => { if (e.target === imgModalBackdrop) closeImgModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && imgModalBackdrop.classList.contains('is-open')) closeImgModal(); });

  imgModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    imgFormError.textContent = '';
    const payload = { url: imgUrl.value.trim(), alt: imgAlt.value.trim(), view: imgView || 'auto' };
    if (!payload.url) { imgFormError.textContent = 'La URL es obligatoria'; return; }
    try {
      payload.duration = readDuration(imgDuration);
    } catch (err) {
      imgFormError.textContent = err.message;
      return;
    }
    const days = selectedDays();
    const from = imgFrom.value || null;
    const to = imgTo.value || null;
    if (from && to && to < from) { imgFormError.textContent = '«Hasta» no puede ser anterior a «Desde»'; return; }
    payload.schedule = (days.length || from || to) ? { days: days.length ? days : null, from, to } : null;
    payload.blur = imgBlur.checked;
    payload.suspended = imgSuspended.checked;
    imgSaveBtn.disabled = true; imgSaveBtn.textContent = 'Guardando…';
    try {
      if (editingImgId) {
        await API.updateImage(activeUserId(), editingImgId, payload);
        toast('Imagen actualizada');
      } else {
        await API.addImage(activeUserId(), payload);
        toast('Imagen añadida');
      }
      closeImgModal();
      await loadUserImages();
    } catch (err) {
      imgFormError.textContent = Array.isArray(err.details) ? err.details.join(', ') : err.message;
    } finally {
      imgSaveBtn.disabled = false; imgSaveBtn.textContent = 'Guardar';
    }
  });

  // User Grid actions
  userGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    const image = userImages.find((i) => i.id === id);
    if (!image) return;
    if (action === 'edit') openImgModal(image);
    else if (action === 'suspend') {
      try {
        await API.updateImage(activeUserId(), id, { suspended: !image.suspended });
        toast(image.suspended ? 'Imagen reactivada: vuelve a mostrarse' : 'Imagen suspendida: ya no se muestra');
        await loadUserImages();
      } catch (err) { toast(err.message, 'error'); }
    }
    else if (action === 'up') moveImage(id, -1);
    else if (action === 'down') moveImage(id, 1);
    else if (action === 'delete') {
      if (!confirm('¿Eliminar esta imagen?')) return;
      try {
        await API.deleteImage(activeUserId(), id);
        toast('Imagen eliminada');
        await loadUserImages();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  // Drag & drop reorder
  userGrid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.image-card');
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  userGrid.addEventListener('dragend', (e) => {
    const card = e.target.closest('.image-card');
    if (card) card.classList.remove('is-dragging');
    userGrid.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    dragId = null;
  });

  userGrid.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (hasFiles(e)) return;
    const card = e.target.closest('.image-card');
    if (!card || card.dataset.id === dragId) return;
    userGrid.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    card.classList.add('is-drop-target');
  });

  userGrid.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (hasFiles(e)) return; // files are handled by the dashboard drop zone below
    const target = e.target.closest('.image-card');
    if (!target || !dragId || target.dataset.id === dragId) return;

    const fromIdx = userImages.findIndex((i) => i.id === dragId);
    const toIdx = userImages.findIndex((i) => i.id === target.dataset.id);
    if (fromIdx < 0 || toIdx < 0) return;

    const [moved] = userImages.splice(fromIdx, 1);
    userImages.splice(toIdx, 0, moved);

    const orders = userImages.map((img, idx) => ({ id: img.id, order: idx }));
    userImages.forEach((img, idx) => (img.order = idx));
    renderUserGrid();

    try {
      await API.reorderImages(activeUserId(), orders);
      toast('Orden actualizado');
    } catch (err) {
      toast(err.message, 'error');
      await loadUserImages();
    }
  });

  // ===== Manual upload (PC / phone) =====
  const MAX_SIDE = 1920;
  const JPEG_QUALITY = 0.85;
  let uploading = false;

  function hasFiles(e) {
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  function baseName(name) {
    return String(name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 300);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), type, quality);
    });
  }

  // Resize to max 1920px on the longest side and re-encode. Keeps PNG (transparency);
  // everything else becomes JPEG. GIFs are sent as-is to keep animation.
  async function prepareImage(file) {
    if (file.type === 'image/gif') return { blob: file, name: file.name };

    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fallback for browsers without createImageBitmap options (older Safari)
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Formato de imagen no compatible'));
        img.src = URL.createObjectURL(file);
      });
    }

    const w = bitmap.width;
    const h = bitmap.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    const keepPng = file.type === 'image/png';
    if (!keepPng) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (typeof bitmap.close === 'function') bitmap.close();
    if (bitmap.src) URL.revokeObjectURL(bitmap.src);

    const type = keepPng ? 'image/png' : 'image/jpeg';
    let blob = await canvasToBlob(canvas, type, JPEG_QUALITY);
    // Very large PNGs (e.g. screenshots/photos saved as PNG) -> fall back to JPEG
    if (keepPng && blob.size > 3.5 * 1024 * 1024) {
      blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    }
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    return { blob, name: `${baseName(file.name) || 'imagen'}.${ext}` };
  }

  function setUploadStatus(text, fraction) {
    uploadStatus.hidden = false;
    uploadStatusText.textContent = text;
    uploadStatusFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) { toast('No se seleccionó ninguna imagen', 'error'); return; }
    if (uploading) { toast('Ya hay una subida en curso', 'error'); return; }
    const userId = activeUserId();
    if (!userId) return;

    uploading = true;
    uploadImgBtn.disabled = true;
    cameraBtn.disabled = true;
    const failures = [];
    let ok = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadStatus(`Subiendo ${i + 1} / ${files.length} · ${file.name}`, i / files.length);
      try {
        const { blob } = await prepareImage(file);
        await API.uploadImageFile(userId, blob, baseName(file.name));
        ok++;
      } catch (err) {
        failures.push(`${file.name}: ${err.message}`);
      }
    }

    setUploadStatus(`Listo: ${ok} de ${files.length} subida${files.length === 1 ? '' : 's'}`, 1);
    setTimeout(() => { uploadStatus.hidden = true; }, 2500);
    uploading = false;
    uploadImgBtn.disabled = false;
    cameraBtn.disabled = false;

    if (ok > 0) toast(`${ok} archivo${ok === 1 ? '' : 's'} subido${ok === 1 ? '' : 's'}`);
    if (failures.length) toast(`Fallaron ${failures.length}: ${failures.join(' · ')}`, 'error');
    await loadUserImages();
  }

  uploadImgBtn.addEventListener('click', () => uploadImgInput.click());

  uploadImgInput.addEventListener('change', async () => {
    const files = uploadImgInput.files;
    await uploadFiles(files);
    uploadImgInput.value = ''; // allow selecting the same files again
  });

  // Celular: abre la cámara y sube la foto en cuanto se toma.
  cameraBtn.addEventListener('click', () => cameraInput.click());

  cameraInput.addEventListener('change', async () => {
    await uploadFiles(cameraInput.files);
    cameraInput.value = '';
  });

  // Drop files anywhere on the image dashboard
  userDashboard.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    userDashboard.classList.add('is-file-over');
  });

  userDashboard.addEventListener('dragleave', (e) => {
    if (e.target === userDashboard || !userDashboard.contains(e.relatedTarget)) {
      userDashboard.classList.remove('is-file-over');
    }
  });

  userDashboard.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    userDashboard.classList.remove('is-file-over');
    uploadFiles(e.dataTransfer.files);
  });

  checkAuth();
})();