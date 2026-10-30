import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDiasLibres, getDiasEspeciales, esFestivo, leerDia } from '../config/datos';

// Misma lógica de colores que el calendario de la app (tema claro)
export async function calcularDatosWidget() {
  const raw = await AsyncStorage.getItem('sesion2026');
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mIdx = ahora.getMonth();
  const dias = new Date(anio, mIdx + 1, 0).getDate();
  const primerDia = (new Date(anio, mIdx, 1).getDay() + 6) % 7;
  const base = { anio, mIdx, hoy: ahora.getDate(), dias, primerDia, estilos: {} };
  if (!raw) return base;
  const s = JSON.parse(raw);
  let cambios = {};
  try { cambios = JSON.parse((await AsyncStorage.getItem('widgetCambios')) || '{}') || {}; } catch (e) {}
  const grupo = s.miGrupoSesion;
  const turno = s.miTipoSesion;
  const libresMes = (getDiasLibres(anio, grupo, turno) || {})[mIdx] || [];
  const esp = getDiasEspeciales(anio, grupo, turno);
  const subMes = esp.subgrupo[mIdx] || [];
  const lrjMes = esp.lrj[mIdx] || [];
  for (let d = 1; d <= dias; d++) {
    const cambio = leerDia(cambios, anio, mIdx, d);
    const esLibre = libresMes.includes(d);
    let libreReal = esLibre;
    if (cambio) {
      if (cambio.clase === 'b-inter') libreReal = false;
      if (cambio.clase === 'b-cambio-libre') libreReal = true;
    }
    let bg = libreReal ? '#fee2e2' : '#f1f5f9';
    let fg = libreReal ? '#991b1b' : '#334155';
    if (esLibre && libreReal) {
      if (lrjMes.includes(d)) { bg = '#a7f3d0'; fg = '#065f46'; }
      else if (subMes.includes(d)) { bg = '#bfdbfe'; fg = '#1e3a8a'; }
    }
    if (esFestivo(anio, mIdx, d)) { bg = '#ef4444'; fg = libreReal ? '#ffffff' : '#000000'; }
    if (cambio) {
      if (cambio.clase === 'b-vac') { bg = '#dcfce7'; fg = '#166534'; }
      if (cambio.clase === 'b-pend') { bg = '#f3e8ff'; fg = '#6b21a8'; }
      if (cambio.clase === 'b-inter') { bg = '#fef08a'; fg = '#713f12'; }
      if (cambio.clase === 'b-cambio-libre') { bg = '#fee2e2'; fg = '#991b1b'; }
      if (cambio.clase === 'b-generado') { bg = '#fdf2f8'; fg = '#be185d'; }
      if (cambio.clase === 'b-l26') { bg = '#fefce8'; fg = '#b45309'; }
    }
    base.estilos[d] = { bg, fg };
  }
  return base;
}
