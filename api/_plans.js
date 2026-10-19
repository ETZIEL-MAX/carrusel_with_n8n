// Planes de suscripción: tabla, validación y la regla única del estado de un usuario.
// Sin acceso a datos: _utils.js lee la configuración y los usuarios y llama aquí.
//
// Estado de un usuario:
//   legacy  -> cuenta anterior a los planes (sin `plan`): sin límite de pantallas ni bloqueo.
//   trial   -> prueba gratis hasta `trialEndsAt`.
//   active  -> plan asignado; `planEndsAt` null = sin fecha de fin.
//   expired -> la prueba o el plan terminó: todo bloqueado hasta que se asigne un plan.

export const TRIAL_DAYS = 7;
export const TRIAL_PLAN = 'basico';
export const PLAN_IDS = ['basico', 'pro', 'empresa', 'custom'];
export const PLAN_PROVIDERS = ['manual', 'stripe'];
export const MAX_PLAN_DEVICES = 10000;
const DAY_MS = 86400000;

// Valores de ejemplo; el super-admin los cambia en carousel:config.plans.
// null = sin tope en ese campo.
export const DEFAULT_PLANS = {
  basico: { name: 'Básico', devices: 3, monthlyImageLimit: 30, storageLimitMb: 500, priceMxn: 299 },
  pro: { name: 'Pro', devices: 10, monthlyImageLimit: 100, storageLimitMb: 2048, priceMxn: 799 },
  empresa: { name: 'Empresa', devices: 50, monthlyImageLimit: 300, storageLimitMb: 10240, priceMxn: 2499 },
  custom: { name: 'A medida', devices: 100, monthlyImageLimit: null, storageLimitMb: null, priceMxn: null },
};

const isIntIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Une lo guardado con los valores por defecto, campo por campo.
export function resolvePlans(saved) {
  const out = {};
  for (const id of PLAN_IDS) {
    const s = saved && typeof saved[id] === 'object' && saved[id] ? saved[id] : {};
    out[id] = { ...DEFAULT_PLANS[id], ...s };
  }
  return out;
}

// Valida un cambio de la tabla de planes. Devuelve { plans } normalizado o { error }.
export function validatePlansPatch(patch, { maxImages, maxStorageMb }) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'plans debe ser un objeto' };
  const plans = {};
  for (const [id, p] of Object.entries(patch)) {
    if (!PLAN_IDS.includes(id)) return { error: `Plan desconocido: ${id}` };
    if (!p || typeof p !== 'object') return { error: `Plan ${id} inválido` };
    const clean = {};
    if (p.name !== undefined) {
      const name = String(p.name).trim();
      if (!name || name.length > 40) return { error: `Nombre del plan ${id} inválido` };
      clean.name = name;
    }
    if (p.devices !== undefined) {
      if (!isIntIn(p.devices, 1, MAX_PLAN_DEVICES)) return { error: `Pantallas del plan ${id}: entero entre 1 y ${MAX_PLAN_DEVICES}` };
      clean.devices = p.devices;
    }
    if (p.monthlyImageLimit !== undefined) {
      if (p.monthlyImageLimit !== null && !isIntIn(p.monthlyImageLimit, 0, maxImages)) {
        return { error: `Imágenes del plan ${id}: null o entero entre 0 y ${maxImages}` };
      }
      clean.monthlyImageLimit = p.monthlyImageLimit;
    }
    if (p.storageLimitMb !== undefined) {
      if (p.storageLimitMb !== null && !isIntIn(p.storageLimitMb, 1, maxStorageMb)) {
        return { error: `Almacenamiento del plan ${id}: null o entero entre 1 y ${maxStorageMb} MB` };
      }
      clean.storageLimitMb = p.storageLimitMb;
    }
    if (p.priceMxn !== undefined) {
      if (p.priceMxn !== null && !(typeof p.priceMxn === 'number' && Number.isFinite(p.priceMxn) && p.priceMxn >= 0 && p.priceMxn <= 1e6)) {
        return { error: `Precio del plan ${id} inválido` };
      }
      clean.priceMxn = p.priceMxn;
    }
    plans[id] = clean;
  }
  return { plans };
}

const toMs = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

// Campos que se guardan en una cuenta nueva.
export function trialFields(now = Date.now()) {
  return {
    plan: TRIAL_PLAN,
    planStatus: 'trial',
    trialEndsAt: new Date(now + TRIAL_DAYS * DAY_MS).toISOString(),
  };
}

// La regla única: qué plan tiene un usuario ahora y qué le toca.
export function planState(user, plans, now = Date.now()) {
  const table = plans || resolvePlans(null);
  if (!user || !user.plan || !table[user.plan]) {
    return {
      planId: null, planName: null, status: 'legacy', endsAt: null, daysLeft: null,
      devices: null, monthlyImageLimit: undefined, storageLimitMb: undefined, blocked: false,
    };
  }
  const plan = table[user.plan];
  const trial = user.planStatus === 'trial';
  const endsAt = trial ? user.trialEndsAt || null : user.planEndsAt || null;
  const endMs = endsAt ? toMs(endsAt) : null;
  const expired = endMs !== null && now >= endMs;
  return {
    planId: user.plan,
    planName: plan.name,
    status: expired ? 'expired' : trial ? 'trial' : 'active',
    endsAt,
    daysLeft: endMs === null ? null : Math.max(0, Math.ceil((endMs - now) / DAY_MS)),
    devices: plan.devices,
    monthlyImageLimit: plan.monthlyImageLimit,
    storageLimitMb: plan.storageLimitMb,
    blocked: expired,
    priceMxn: plan.priceMxn ?? null,
    provider: user.billing?.provider || (trial ? null : 'manual'),
  };
}
