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

  return {
    getImages: () => request('/api/images'),
    addImage: (image) =>
      request('/api/images', { method: 'POST', body: JSON.stringify(image) }),
    updateImage: (id, updates) =>
      request('/api/images', {
        method: 'PATCH',
        body: JSON.stringify({ id, ...updates }),
      }),
    reorderImages: (orders) =>
      request('/api/images', { method: 'PATCH', body: JSON.stringify(orders) }),
    deleteImage: (id) =>
      request(`/api/images?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    login: (password) =>
      request('/api/auth', { method: 'POST', body: JSON.stringify({ password }) }),
    logout: () => request('/api/auth', { method: 'DELETE' }),
    me: () => request('/api/auth'),
  };
})();
