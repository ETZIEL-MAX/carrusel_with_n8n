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
    // Manual upload (multipart). No manual Content-Type: the browser sets the boundary.
    uploadImageFile: async (userId, blob, fileName, alt) => {
      const fd = new FormData();
      fd.append('file', blob, fileName);
      if (alt) fd.append('alt', alt);
      const res = await fetch(withUserId('/api/images-upload', userId), {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      let data = null;
      try { data = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        const err = new Error(data?.error || `Request failed (${res.status})`);
        err.status = res.status;
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
    me: () => request('/api/auth'),

    // User management (super-admin)
    getUsers: () => request('/api/users'),
    addUser: ({ name, email, password }) =>
      request('/api/users', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
    updateUser: (userId, { name, email }) =>
      request(`/api/users?userId=${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, email }),
      }),
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