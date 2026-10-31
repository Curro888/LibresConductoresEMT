// Puente entre el widget y la pantalla de calendario: guarda el día tocado en el widget
// hasta que la pantalla lo recoge y abre su panel (quién libra y quién trabaja).
let pendiente = null;
const oyentes = new Set();

export function pedirDia(dia) {
  pendiente = dia;
  oyentes.forEach(f => { try { f(dia); } catch (e) {} });
}
export function tomarDiaPendiente() {
  const p = pendiente;
  pendiente = null;
  return p;
}
export function oirDia(f) {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}
// Convierte "esquema://dia/2026/9/31" en { anio, mIdx, d }
export function leerEnlaceDia(url) {
  const m = /\/\/dia\/(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(url || '');
  if (!m) return null;
  return { anio: parseInt(m[1], 10), mIdx: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}
