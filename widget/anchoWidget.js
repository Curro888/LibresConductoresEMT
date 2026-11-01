// Ancho del widget en dp. La librería puede darlo en dp o en píxeles según el móvil:
// si es mayor que el ancho de la pantalla en dp, está en píxeles y se divide por la densidad.
export function anchoWidgetDp(info) {
  try {
    if (!info || !info.width) return 0;
    const sc = info.screenInfo || {};
    let w = info.width;
    if (sc.screenWidthDp && sc.density && w > sc.screenWidthDp + 1) w = w / sc.density;
    return w > 0 ? w : 0;
  } catch (e) { return 0; }
}
