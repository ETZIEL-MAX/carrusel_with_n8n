const API = (() => {
  const base = '';

  async function request(path, options = {}) {
    const res = await fetch(`${base}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!res.ok) {
      const message = data?.error || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.details = data?.details;
      throw err;
    }

    return data;
  }

  function withUserId(path, userId) {
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}userId=${encodeURIComponent(userId)}`;
  }

  return {
    // Public carousel
    getCarousel: (userId) => request(`/api/carrusel?userId=${encodeURIComponent(userId)}`),
    
    // Admin images (scoped by userId)
    getImages: (userId) => request(withUserId('/api/images', userId)),
    addImage: (userId, image) =>
      request(withUserId('/api/images', userId), { method: 'POST', body: JSON.stringify(image) }),
    updateImage: (userId, id, updates) =>
      request(withUserId('/api/images', userId), {
        method: 'PATCH',
        body: JSON.stringify({ id, ...updates }),
      }),
    reorderImages: (userId, orders) =>
      request(withUserId('/api/images', userId), { method: 'PATCH', body: JSON.stringify(orders) }),
    deleteImage: (userId, id) =>
      request(withUserId(`/api/images?id=${encodeURIComponent(id)}`, userId), { method: 'DELETE' }),
    // Subida de imagen: el archivo va tal cual como cuerpo (el servidor lo escribe a disco
    // mientras llega, sin multipart).
    uploadImageFile: async (userId, blob, alt) => {
      const params = new URLSearchParams();
      if (alt) params.set('alt', alt);
      const query = params.toString() ? `/api/images-upload?${params.toString()}` : '/api/images-upload';
      const res = await fetch(withUserId(query, userId), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': blob.type || 'image/webp' },
        body: blob,
      });
      let data = null;
      try { data = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        const err = new Error(data?.error || `Request failed (${res.status})`);
        err.status = res.status;
        err.details = data?.details;
        throw err;
      }
      return data;
    },

    // Auth
    loginAdmin: (password) =>
      request('/api/auth', { method: 'POST', body: JSON.stringify({ password }) }),
    loginUser: (email, password) =>
      request('/api/auth', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => request('/api/auth', { method: 'DELETE' }),
    logoutAll: () => request('/api/auth?all=1', { method: 'DELETE' }),
    me: () => request('/api/auth'),

    // User management (super-admin)
    getUsers: () => request('/api/users'),
    addUser: ({ name, email, password }) =>
      request('/api/users', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
    updateUser: (userId, { name, email, storageLimitMb }) =>
      request(`/api/users?userId=${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, email, storageLimitMb }),
      }),
    // Genera o regenera el token de webhook. La respuesta es la única vez que se ve.
    generateToken: (userId) =>
      request(`/api/users/token?userId=${encodeURIComponent(userId)}`, { method: 'POST' }),

    // Espacio usado y consumo de generación (usuario: lo suyo; super-admin: pasa userId)
    getUsage: (userId, month) => {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (month) params.set('month', month);
      const qs = params.toString();
      return request(`/api/usage${qs ? `?${qs}` : ''}`);
    },
    getConfig: () => request('/api/usage'),
    updateConfig: (data) => request('/api/usage', { method: 'PATCH', body: JSON.stringify(data) }),
    deleteUser: (userId) =>
      request(`/api/users?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    changeUserPassword: (userId, password) =>
      request(`/api/users/password?userId=${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ password }) }),

    // Generation settings (user or super-admin)
    getSettings: (userId) =>
      request(userId ? `/api/settings?userId=${encodeURIComponent(userId)}` : '/api/settings'),
    updateSettings: (userId, data) =>
      request(userId ? `/api/settings?userId=${encodeURIComponent(userId)}` : '/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    generateImages: (userId) =>
      request(userId ? `/api/generate?userId=${encodeURIComponent(userId)}` : '/api/generate', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  };
})();