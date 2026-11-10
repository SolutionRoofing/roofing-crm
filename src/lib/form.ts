// Small helpers for reading Server Action form data safely.
export const text = (fd: FormData, key: string, max = 2000) => String(fd.get(key) ?? '').trim().slice(0, max);
export const optional = (fd: FormData, key: string) => text(fd, key) || null;
export const number = (fd: FormData, key: string) => {
  const n = Number(String(fd.get(key) ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
export const checked = (fd: FormData, key: string) => fd.get(key) === 'on';
export const isoDate = (fd: FormData, key: string) => {
  const v = text(fd, key, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
export const oneOf = <T extends string>(fd: FormData, key: string, allowed: readonly T[], fallback: T): T => {
  const v = text(fd, key) as T;
  return allowed.includes(v) ? v : fallback;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = (fd: FormData, key: string) => {
  const v = text(fd, key, 36);
  return UUID.test(v) ? v : null;
};
export const isUuid = (v: string) => UUID.test(v);
