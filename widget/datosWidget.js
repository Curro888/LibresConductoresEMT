import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDiasLibres, getDiasEspeciales, esFestivo, leerDia } from '../config/datos';

const N_MESES = 6;

function estiloDia(cambio, esLibre, lrj, sub, festivo) {
  let libreReal = esLibre;
  if (cambio) {
    if (cambio.clase === 'b-inter') libreReal = false;
    if (cambio.clase === 'b-cambio-libre') libreReal = true;
  }
  let bg = libreReal ? '#fee2e2' : '#f1f5f9';
  let fg = libreReal ? '#991b1b' : '#334155';
  if (esLibre && libreReal) {
    if (lrj) { bg = '#a7f3d0'; fg = '#065f46'; }
    else if (sub) { bg = '#bfdbfe'; fg = '#1e3a8a'; }
  }
  if (festivo) { bg = '#ef4444'; fg = libreReal ? '#ffffff' : '#000000'; }
  if (cambio) {
    if (cambio.clase === 'b-vac') { bg = '#dcfce7'; fg = '#166534'; }
    if (cambio.clase === 'b-pend') { bg = '#f3e8ff'; fg = '#6b21a8'; }
    if (cambio.clase === 'b-inter') { bg = '#fef08a'; fg = '#713f12'; }
    if (cambio.clase === 'b-cambio-libre') { bg = '#fee2e2'; fg = '#991b1b'; }
    if (cambio.clase === 'b-generado') { bg = '#fdf2f8'; fg = '#be185d'; }
    if (cambio.clase === 'b-l26') { bg = '#fefce8'; fg = '#b45309'; }
  }
  return { bg, fg };
}

// 12 meses seguidos empezando por el mes actual. Mismos colores que el calendario de la app (tema claro).
export async function calcularDatosWidget() {
  const raw = await AsyncStorage.getItem('sesion2026');
  const ahora = new Date();
  let s = null;
  try { s = raw ? JSON.parse(raw) : null; } catch (e) {}
  let cambios = {};
  try { cambios = JSON.parse((await AsyncStorage.getItem('widgetCambios')) || '{}') || {}; } catch (e) {}

  const meses = [];
  for (let i = 0; i < N_MESES; i++) {
    const f = new Date(ahora.getFullYear(), ahora.getMonth() + i, 1);
    const anio = f.getFullYear();
    const mIdx = f.getMonth();
    const dias = new Date(anio, mIdx + 1, 0).getDate();
    const primerDia = (f.getDay() + 6) % 7;
    const mes = { anio, mIdx, dias, primerDia, hoy: i === 0 ? ahora.getDate() : 0, estilos: {} };
    try {
      if (s) {
        const libresMes = (getDiasLibres(anio, s.miGrupoSesion, s.miTipoSesion) || {})[mIdx] || [];
        const esp = getDiasEspeciales(anio, s.miGrupoSesion, s.miTipoSesion) || {};
        const subMes = (esp.subgrupo || {})[mIdx] || [];
        const lrjMes = (esp.lrj || {})[mIdx] || [];
        for (let d = 1; d <= dias; d++) {
          mes.estilos[d] = estiloDia(leerDia(cambios, anio, mIdx, d), libresMes.includes(d), lrjMes.includes(d), subMes.includes(d), esFestivo(anio, mIdx, d));
        }
      }
    } catch (e) {}
    meses.push(mes);
  }
  return { meses };
}
