// Personales: los autobuses que llevan y traen a los compañeros, repartidos por cocheras.
// Fuente: datos de Mariano y Roberto (MadridEnRuta, versión 2026-10-06).
// Ahora mismo La Elipa está en Fuencarral por las obras de su cochera, así que el P18 va dentro de Fuencarral.
// Cuando La Elipa vuelva a ser cochera propia basta con mover 'P18' a una cochera nueva de esta lista.
// Cada conductor guarda solo su personal (ej. 'P18'); su cochera se deduce de esta lista.
export const CODIGO_PERSONALES = 'PE';

export const COCHERAS_PERSONALES = [
    { id: 'Fuencarral', nombre: 'Fuencarral / La Elipa', personales: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P18', 'P26'] },
    { id: 'Carabanchel', nombre: 'Carabanchel', personales: ['P13', 'P14', 'P15', 'P16', 'P17', 'P25'] },
    { id: 'Entrevias', nombre: 'Entrevías', personales: ['P19', 'P20', 'P21', 'P22'] },
    { id: 'Sanchinarro', nombre: 'Sanchinarro', personales: ['889 MR1', 'P23', 'P24'] },
];

// Cochera (objeto) a la que pertenece un personal, o null si no está en la lista.
export function cocheraDe(pe) {
    const p = String(pe || '');
    return COCHERAS_PERSONALES.find(c => c.personales.includes(p)) || null;
}
// Texto corto: "P18 · Fuencarral / La Elipa"
export function textoPersonal(pe) {
    if (!pe) return '';
    const c = cocheraDe(pe);
    return String(pe) + (c ? ' · ' + c.nombre : '');
}
// Posición de un personal en la lista (para ordenar).
export function ordenPersonal(pe) {
    let i = 0;
    for (const c of COCHERAS_PERSONALES) for (const p of c.personales) { if (p === String(pe)) return i; i++; }
    return 1e9;
}
