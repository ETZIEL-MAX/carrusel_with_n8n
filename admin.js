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
  const imgFormError = document.getElementById('imgFormError');
  const imgCancelBtn = document.getElementById('imgCancelBtn');
  const imgSaveBtn = document.getElementById('imgSaveBtn');

  const toasts = document.getElementById('toasts');

  const userSettingsBtn = document.getElementById('userSettingsBtn');
  const genDriveUrl = document.getElementById('genDriveUrl');
  const colorPaletteRow = document.getElementById('colorPaletteRow');
  const addColorBtn = document.getElementById('addColorBtn');
  const genFormError = document.getElementById('genFormError');
  const generateImagesBtn = document.getElementById('generateImagesBtn');
  const settingsSaveGenBtn = document.getElementById('settingsSaveGenBtn');

  // ===== State =====
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
    '&': '&',
    '<': '<',
    '>': '>',
    '"': '"',
    "'": "'",
  }[c]));
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

  backToUsersBtn.addEventListener('click', () => {
    showSuperAdmin();
  });

  // ===== Super-Admin: User Management =====
  async function loadSuperAdminUsers() {
    superAdminGrid.innerHTML = Array.from({ length: 4 }).map(() => '<div class="skeleton"></div>').join('');
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
        return `
      <article class="image-card user-card" data-userid="${escapeHtml(user.userId)}">
        <div class="user-card__preview">${thumbs || '<span class="user-card__nophoto">Sin imágenes</span>'}</div>
        <div class="image-card__body" style="padding: 1.2rem;">
          <div class="user-card__name" style="font-size: 1.1rem;">${escapeHtml(user.name || user.userId)}</div>
          <div class="user-card__email" style="font-size: 0.85rem; color: var(--ink-dim);">${escapeHtml(user.email || '')}</div>
          <div class="user-card__id" style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--accent);">
            ${escapeHtml(user.userId)} · ${user.imageCount ?? 0} imagen${(user.imageCount ?? 0) === 1 ? '' : 'es'}
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
            <button class="icon-btn" data-action="settings" data-userid="${escapeHtml(user.userId)}" aria-label="Ajustes: correo, contraseña y webhook" title="Ajustes: correo, contraseña y webhook">
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
      if (pwd.length < 6) { userFormError.textContent = 'La contraseña debe tener al menos 6 caracteres'; return; }
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

  // Password shown once (on create / change)
  function openPwdReveal(userId, password) {
    pwdRevealTitle.textContent = `Contraseña de ${userId}`;
    pwdRevealText.value = password;
    pwdRevealBackdrop.classList.add('is-open');
  }

  function closePwdReveal() {
    pwdRevealBackdrop.classList.remove('is-open');
    pwdRevealText.value = '';
  }

  pwdRevealCopyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pwdRevealText.value);
      toast('Contraseña copiada');
    } catch {
      pwdRevealText.select();
      document.execCommand('copy');
      toast('Contraseña copiada');
    }
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

  colorPaletteRow.addEventListener('input', (e) => {
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
      'Header: X-Webhook-Secret: {{ $json.signature }}',
      'Body:',
      body,
    ].join('\n');
    return {
      url: `${origin}/api/webhook/${userId}`,
      headers: 'Content-Type: application/json\nX-Webhook-Secret: <HMAC-SHA256 hex del cuerpo con WEBHOOK_SECRET>',
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
    settingsSaveBtn.hidden = isSelfService;
    settingsSaveGenBtn.hidden = !isSelfService;

    if (!isSelfService) {
      setName.value = user.name || '';
      setEmail.value = user.email || '';
      setPassword.value = '';
      setPassword.type = 'password';
      settingsFormError.textContent = '';
      const wh = webhookInfo(user.userId, []);
      whUrl.textContent = wh.url;
      whHeaders.textContent = wh.headers;
      whBody.textContent = wh.body;
      whUpload.textContent = wh.upload;
      n8nBlock.textContent = wh.block;
    }

    // Reset generation fields
    genDriveUrl.value = '';
    colorSwatches = [];
    genFormError.textContent = '';
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
      colorSwatches = Array.isArray(s.colorPalette) ? s.colorPalette.map((hex) => ({ hex })) : [];
      renderColorPalette();
    } catch { /* leave fields empty */ }
  }

  function closeSettingsModal() {
    settingsModalBackdrop.classList.remove('is-open');
    settingsUserId = null;
    setPassword.value = '';
    colorSwatches = [];
    genFormError.textContent = '';
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
    };

    if (isSelfService) {
      genFormError.textContent = '';
      settingsSaveGenBtn.disabled = true;
      settingsSaveGenBtn.textContent = 'Guardando…';
      try {
        await API.updateSettings(null, genPayload);
        toast('Configuración guardada');
        closeSettingsModal();
      } catch (err) {
        genFormError.textContent = err.message;
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
    if (pwd && pwd.length < 6) { settingsFormError.textContent = 'La contraseña debe tener al menos 6 caracteres'; return; }
    settingsSaveBtn.disabled = true; settingsSaveBtn.textContent = 'Guardando…';
    try {
      await API.updateUser(userId, { name, email });
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

  // Image Modal
  function openImgModal(image = null) {
    editingImgId = image ? image.id : null;
    imgModalTitle.textContent = image ? 'Editar imagen' : 'Añadir imagen';
    imgUrl.value = image ? image.url : '';
    imgAlt.value = image ? image.alt : '';
    imgFormError.textContent = '';
    imgModalBackdrop.classList.add('is-open');
    setTimeout(() => imgUrl.focus(), 60);
  }

  function closeImgModal() {
    imgModalBackdrop.classList.remove('is-open');
    editingImgId = null;
  }

  addImgBtn.addEventListener('click', () => openImgModal());
  imgCancelBtn.addEventListener('click', closeImgModal);
  imgModalBackdrop.addEventListener('click', (e) => { if (e.target === imgModalBackdrop) closeImgModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && imgModalBackdrop.classList.contains('is-open')) closeImgModal(); });

  imgModalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    imgFormError.textContent = '';
    const payload = { url: imgUrl.value.trim(), alt: imgAlt.value.trim() };
    if (!payload.url) { imgFormError.textContent = 'La URL es obligatoria'; return; }
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
    const failures = [];
    let ok = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadStatus(`Subiendo ${i + 1} / ${files.length} · ${file.name}`, i / files.length);
      try {
        const { blob, name } = await prepareImage(file);
        await API.uploadImageFile(userId, blob, name, baseName(file.name));
        ok++;
      } catch (err) {
        failures.push(`${file.name}: ${err.message}`);
      }
    }

    setUploadStatus(`Listo: ${ok} de ${files.length} subida${files.length === 1 ? '' : 's'}`, 1);
    setTimeout(() => { uploadStatus.hidden = true; }, 2500);
    uploading = false;
    uploadImgBtn.disabled = false;

    if (ok > 0) toast(`${ok} imagen${ok === 1 ? '' : 'es'} subida${ok === 1 ? '' : 's'}`);
    if (failures.length) toast(`Fallaron ${failures.length}: ${failures.join(' · ')}`, 'error');
    await loadUserImages();
  }

  uploadImgBtn.addEventListener('click', () => uploadImgInput.click());

  uploadImgInput.addEventListener('change', async () => {
    const files = uploadImgInput.files;
    await uploadFiles(files);
    uploadImgInput.value = ''; // allow selecting the same files again
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