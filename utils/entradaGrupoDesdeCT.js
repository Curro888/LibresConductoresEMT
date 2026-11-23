// Piezas pequeñas para «pasar de Correturnos a línea fija y entrar directamente en el grupo de la línea».
// Están aparte (sin Firebase ni pantallas) para poder probarlas solas.

// Los códigos de grupo nunca llevan espacios; si el teclado del móvil mete uno, se quita.
export function limpiarCodigoGrupo(codigo) {
    return String(codigo || '').replace(/\s+/g, '');
}

const CODIGOS_NO_VALIDOS = ['CT', 'PE']; // Correturnos y Personales no son grupos de línea

// Comprueba lo que ha escrito la persona, antes de tocar nada.
// Devuelve un texto de error, o null si está bien (o si no ha rellenado nada: entonces no se entra a ningún grupo).
export function comprobarDatosGrupo(codigo, pass) {
    const c = limpiarCodigoGrupo(codigo);
    const p = String(pass || '').trim();
    if (!c && !p) return null;
    if (!c || !p) return 'Para entrar en el grupo de tu línea rellena el código y la contraseña, o deja las dos casillas vacías.';
    if (CODIGOS_NO_VALIDOS.includes(c.toUpperCase())) return 'Ese código no es de un grupo de línea. Escribe el código del grupo de tu línea.';
    return null;
}

// ¿Quiere entrar en un grupo? (las dos casillas rellenas)
export function quiereEntrarEnGrupo(codigo, pass) {
    return !!(limpiarCodigoGrupo(codigo) && String(pass || '').trim());
}

// Comprueba el grupo que viene de Firebase. Devuelve un texto de error o null.
export function comprobarGrupoRemoto(grupo, pass) {
    if (!grupo) return 'Grupo no encontrado. Revisa que el código esté bien escrito.';
    if (grupo.pass !== String(pass || '').trim()) return 'Contraseña incorrecta';
    return null;
}

// Ficha de la persona dentro del grupo (igual que al unirse desde la pantalla de inicio).
export function fichaMiembro(nombre, id, m) {
    return { n: String(nombre || '').trim(), id: String(id), ...m };
}

// Lista de grupos guardados en el móvil: quita Correturnos y añade (o actualiza) el grupo nuevo.
export function nuevaListaGrupos(lista, entrada) {
    const sinCT = (Array.isArray(lista) ? lista : []).filter(g => g && g.codigo !== 'CT');
    const i = sinCT.findIndex(g => g.codigo === entrada.codigo);
    if (i >= 0) sinCT[i] = entrada; else sinCT.push(entrada);
    return sinCT;
}
