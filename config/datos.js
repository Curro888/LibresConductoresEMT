import { getLibresConductor, FESTIVOS_CONDUCTORES, SUBGRUPOS_CONDUCTORES, ANIOS_CONDUCTORES } from './libresConductores';

// Año con el que se abren los calendarios: el año actual si hay libres de ese año;
// si todavía no hay (p. ej. estamos en 2026 y solo hay datos de 2027), el primer año con datos.
export function anioInicial() {
    const hoy = new Date().getFullYear();
    if (ANIOS_CONDUCTORES.includes(hoy)) return hoy;
    const futuros = ANIOS_CONDUCTORES.filter(a => a > hoy);
    return futuros.length ? Math.min(...futuros) : Math.max(...ANIOS_CONDUCTORES);
}

// En Libres Conductores no hay lista cerrada de compañeros: cada conductor/a
// introduce sus propios datos al registrarse (ver components/PerfilConductorForm.js).
// Se deja el array vacío para que el resto de la app (que lo usa) siga funcionando.
export const equipoBase = [];

export const mesesArr = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
// Empieza en domingo porque así es como Date.getDay() numera los días (0 = domingo)
export const diasSemanaArr = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

export const FESTIVOS = {
    2025: [
        { fecha: '1/1',   nombre: 'Año Nuevo' },
        { fecha: '6/1',   nombre: 'Epifanía del Señor' },
        { fecha: '17/4',  nombre: 'Jueves Santo' },
        { fecha: '18/4',  nombre: 'Viernes Santo' },
        { fecha: '1/5',   nombre: 'Fiesta del Trabajo' },
        { fecha: '2/5',   nombre: 'Fiesta de la Comunidad de Madrid' },
        { fecha: '15/8',  nombre: 'Asunción de la Virgen' },
        { fecha: '12/10', nombre: 'Fiesta Nacional de España' },
        { fecha: '1/11',  nombre: 'Todos los Santos' },
        { fecha: '8/12',  nombre: 'Inmaculada Concepción' },
        { fecha: '25/12', nombre: 'Natividad del Señor' }
    ],
    2026: [
        { fecha: '1/1',   nombre: 'Año Nuevo' },
        { fecha: '6/1',   nombre: 'Epifanía del Señor' },
        { fecha: '2/4',   nombre: 'Jueves Santo' },
        { fecha: '3/4',   nombre: 'Viernes Santo' },
        { fecha: '1/5',   nombre: 'Fiesta del Trabajo' },
        { fecha: '2/5',   nombre: 'Fiesta de la Comunidad de Madrid' },
        { fecha: '15/5',  nombre: 'San Isidro' },
        { fecha: '15/8',  nombre: 'Asunción de la Virgen' },
        { fecha: '12/10', nombre: 'Fiesta Nacional de España' },
        { fecha: '2/11',  nombre: 'Traslado de Todos los Santos' },
        { fecha: '7/12',  nombre: 'Traslado del Día de la Constitución' },
        { fecha: '8/12',  nombre: 'Inmaculada Concepción' },
        { fecha: '25/12', nombre: 'Natividad del Señor' }
    ],
    2027: [
        { fecha: '1/1',   nombre: 'Año Nuevo' },
        { fecha: '6/1',   nombre: 'Epifanía del Señor' },
        { fecha: '25/3',  nombre: 'Jueves Santo' },
        { fecha: '26/3',  nombre: 'Viernes Santo' },
        { fecha: '1/5',   nombre: 'Fiesta del Trabajo' },
        { fecha: '3/5',   nombre: 'Fiesta de la Comunidad de Madrid' },
        { fecha: '15/5',  nombre: 'San Isidro' },
        { fecha: '15/8',  nombre: 'Asunción de la Virgen' },
        { fecha: '12/10', nombre: 'Fiesta Nacional de España' },
        { fecha: '1/11',  nombre: 'Todos los Santos' },
        { fecha: '6/12',  nombre: 'Día de la Constitución' },
        { fecha: '8/12',  nombre: 'Inmaculada Concepción' },
        { fecha: '25/12', nombre: 'Natividad del Señor' }
    ]
};

// Los festivos 2026 de conductores salen del PDF oficial (libresConductores.js).
FESTIVOS[2026] = FESTIVOS_CONDUCTORES[2026];

// Para compatibilidad con código existente que usa FESTIVOS_2026
export const FESTIVOS_2026 = FESTIVOS[2026];

// Los festivos 2027 de conductores salen del PDF oficial (único origen: libresConductores.js).
FESTIVOS[2027] = FESTIVOS_CONDUCTORES[2027];

export const MAX_LIBRES_VAC = 8;

// ===== CÁLCULO DINÁMICO DE DÍAS LIBRES =====
// Patrón 73/27 NOCHE (ciclo de 15 semanas)
const _P7327 = [
    [6,0],[5,6],[6,0],[1,2,3,4],[5,6],
    [6,0],[5,6],[3,4],[6,0],[4,5,6],
    [6,0],[4,5],[5,6],[6,0],[4,5]
];

// Patrón 80/20 NOCHE (ciclo de 15 semanas)
const _P8020 = [
    [5,6],[6,0],[5,6],[6,0],[1,2,3,4],
    [5,6],[6,0],[5,6],[6,0],[3,4],
    [4,5,6],[6,0],[5,6],[6,0],[4,5]
];

// Patrón 73/27 MAÑANA-TARDE (ciclo de 15 semanas)
const _P7327MT = [
    [6,0],[6,0],[6,0],[1,2,3,4],[6,0],
    [6,0],[6,0],[3,4],[5,6,0],[6,0],
    [6,0],[4,5],[6,0],[6,0],[4,5]
];

// Patrón 80/20 MAÑANA-TARDE (ciclo de 15 semanas)
const _P8020MT = [
    [6,0],[6,0],[6,0],[6,0],[1,2,3,4],
    [6,0],[6,0],[6,0],[6,0],[3,4],
    [5,6,0],[6,0],[6,0],[6,0],[4,5]
];

const _ANIO_BASE = 2026;
const _OFF_BASE = 2;

function _isoWeekMonday(year, w) {
    const j4 = new Date(year, 0, 4), dow = j4.getDay() || 7;
    const mon = new Date(j4);
    mon.setDate(j4.getDate() - (dow - 1) + (w - 1) * 7);
    return mon;
}

function _semanasISO(y) {
    return (new Date(y,0,1).getDay()===4 || new Date(y,11,31).getDay()===4) ? 53 : 52;
}

function _calcGrupos(year, patron) {
    let off = _OFF_BASE;
    if (year > _ANIO_BASE) {
        for (let y = _ANIO_BASE; y < year; y++)
            off = ((off - 1 + _semanasISO(y)) % 15) + 1;
    } else if (year < _ANIO_BASE) {
        for (let y = _ANIO_BASE; y > year; y--)
            off = ((off - 1 - (_semanasISO(y-1) % 15) + 150) % 15) + 1;
    }
    const grupos = {};
    for (let g = 1; g <= 15; g++) {
        const base = ((off - 1 + (g - 1)) % 15);
        const L = {};
        for (let m = 0; m < 12; m++) L[m] = [];
        const dow1 = new Date(year, 0, 1).getDay() || 7;
        if (dow1 > 1) {
            const pAnt = patron[((base - 1 + 150) % 15)];
            for (let d = 1; d < dow1; d++) {
                const f = new Date(year, 0, d);
                if (f.getFullYear() !== year) continue;
                if (pAnt.includes(f.getDay()) && !L[0].includes(d)) L[0].push(d);
            }
        }
        for (let w = 1; w <= 53; w++) {
            const pSem = patron[((base + (w-1)) % 15)];
            const lun = _isoWeekMonday(year, w);
            for (let d = 0; d < 7; d++) {
                const f = new Date(lun); f.setDate(lun.getDate() + d);
                if (f.getFullYear() !== year) continue;
                const dow = f.getDay(), mes = f.getMonth(), dia = f.getDate();
                if (pSem.includes(dow) && !L[mes].includes(dia)) L[mes].push(dia);
            }
        }
        for (let m = 0; m < 12; m++) L[m].sort((a,b)=>a-b);
        if (year === 2025) { L[0] = L[0].filter(d => d !== 2); }
        grupos[String(g)] = L;
    }
    return grupos;
}

// Cache para no recalcular cada vez
const _cache = {};

// Datos EXACTOS extraídos del HTML para 2026 (turnos mañana-tarde)
const _G7327MT_2026 = {
    "1": {0:[3,4,10,11,12,13,14,15,24,25,31],1:[1,7,8,11,12,20,21,22,28],2:[1,7,8,12,13,21,22,28,29],3:[2,3,11,12,18,19,25,26,27,28,29,30],4:[9,10,16,17,23,24,27,28],5:[5,6,7,13,14,20,21,25,26],6:[4,5,11,12,16,17,25,26],7:[1,2,8,9,10,11,12,13,22,23,29,30],8:[5,6,9,10,18,19,20,26,27],9:[3,4,8,9,17,18,24,25,29,30],10:[7,8,14,15,21,22,23,24,25,26],11:[5,6,12,13,19,20,23,24]},
    "2": {0:[3,4,5,6,7,8,17,18,24,25,31],1:[1,4,5,13,14,15,21,22,28],2:[1,5,6,14,15,21,22,26,27],3:[4,5,11,12,18,19,20,21,22,23],4:[2,3,9,10,16,17,20,21,29,30,31],5:[6,7,13,14,18,19,27,28],6:[4,5,9,10,18,19,25,26],7:[1,2,3,4,5,6,15,16,22,23,29,30],8:[2,3,11,12,13,19,20,26,27],9:[1,2,10,11,17,18,22,23,31],10:[1,7,8,14,15,16,17,18,19,28,29],11:[5,6,12,13,16,17,25,26,27]},
    "3": {0:[1,10,11,17,18,24,25,28,29],1:[6,7,8,14,15,21,22,26,27],2:[7,8,14,15,19,20,28,29],3:[4,5,11,12,13,14,15,16,25,26],4:[2,3,9,10,13,14,22,23,24,30,31],5:[6,7,11,12,20,21,27,28],6:[2,3,11,12,18,19,25,26,27,28,29,30],7:[8,9,15,16,22,23,26,27],8:[4,5,6,12,13,19,20,24,25],9:[3,4,10,11,15,16,24,25,31],10:[1,7,8,9,10,11,12,21,22,28,29],11:[5,6,9,10,18,19,20,26,27]},
    "4": {0:[3,4,10,11,17,18,21,22,30,31],1:[1,7,8,14,15,19,20,28],2:[1,7,8,12,13,21,22,28,29],3:[4,5,6,7,8,9,18,19,25,26],4:[2,3,6,7,15,16,17,23,24,30,31],5:[4,5,13,14,20,21,25,26],6:[4,5,11,12,18,19,20,21,22,23],7:[1,2,8,9,15,16,19,20,28,29,30],8:[5,6,12,13,17,18,26,27],9:[3,4,8,9,17,18,24,25,31],10:[1,2,3,4,5,14,15,21,22,28,29],11:[2,3,11,12,13,19,20,26,27,31]},
    "5": {0:[3,4,10,11,14,15,23,24,25,31],1:[1,7,8,12,13,21,22,28],2:[1,5,6,14,15,18,19,21,22,30,31],3:[1,2,11,12,18,19,25,26,29,30],4:[8,9,10,16,17,23,24,28,29],5:[6,7,13,14,18,19,27,28],6:[4,5,11,12,13,14,15,16,25,26],7:[1,2,8,9,12,13,21,22,23,29,30],8:[5,6,10,11,19,20,26,27],9:[1,2,10,11,17,18,24,25,26,27,28,29],10:[7,8,14,15,21,22,25,26],11:[4,5,6,12,13,19,20,24,25]},
    "6": {0:[3,4,7,8,16,17,18,24,25,31],1:[1,5,6,14,15,21,22,26,27],2:[7,8,14,15,21,22,23,24,25,26],3:[4,5,11,12,18,19,22,23],4:[1,2,3,9,10,16,17,21,22,30,31],5:[6,7,11,12,20,21,27,28],6:[4,5,6,7,8,19,25,26],7:[1,2,5,6,14,15,16,22,23,29,30],8:[3,4,12,13,19,20,24,25],9:[3,4,10,11,17,18,19,20,21,22,31],10:[1,7,8,14,15,18,19,27,28,29],11:[5,6,12,13,17,18,26,27]},
    "7": {0:[1,9,10,11,17,18,24,25,29,30],1:[7,8,14,15,19,20,28],2:[1,7,8,14,15,16,17,18,19,28,29],3:[4,5,11,12,15,16,24,25,26],4:[2,3,9,10,14,15,23,24,30,31],5:[4,5,13,14,20,21,27,28,29,30],6:[1,2,11,12,18,19,25,26,29,30],7:[7,8,9,15,16,22,23,27,28],8:[5,6,13,14,17,18,26,27],9:[3,4,10,11,12,13,14,15,24,25,31],10:[1,7,8,11,12,20,21,22,28,29],11:[5,6,10,11,19,20,26,27,31]},
    "8": {0:[2,3,4,10,11,17,18,22,23,31],1:[1,7,8,12,13,21,22,28],2:[1,7,8,9,10,11,12,21,22,28,29],3:[4,5,8,9,17,18,19,25,26],4:[2,3,7,8,16,17,23,24,28,29],5:[6,7,13,14,20,21,22,23,24,25],6:[4,5,11,12,18,19,22,23,31],7:[1,2,8,9,15,16,20,21,29,30],8:[5,6,10,11,19,20,26,27],9:[3,4,5,6,7,8,17,18,24,25,31],10:[1,4,5,13,14,15,21,22,28,29],11:[3,4,12,13,19,20,24,25]},
    "9": {0:[3,4,10,11,15,16,24,25,31],1:[1,5,6,14,15,21,22,28],2:[1,2,3,4,5,22,28,29],3:[1,2,10,11,12,18,19,25,26,30],4:[1,9,10,16,17,21,22,30,31],5:[6,7,13,14,15,16,17,18,27,28],6:[4,5,11,12,15,16,24,25,26],7:[1,2,8,9,13,14,22,23,29,30],8:[3,4,12,13,19,20,26,27,28,29,30],9:[1,10,11,17,18,24,25,28,29],10:[6,7,8,14,15,21,22,26,27],11:[5,6,12,13,17,18,26,27]},
    "10": {0:[3,4,8,9,17,18,24,25,29,30],1:[7,8,14,15,21,22,23,24,25,26],2:[7,8,14,15,21,22,25,26],3:[3,4,5,11,12,18,19,23,24],4:[2,3,9,10,14,15,23,24,30,31],5:[6,7,8,9,10,11,20,21,27,28],6:[4,5,8,9,17,18,19,25,26],7:[1,2,6,7,15,16,22,23,27,28],8:[5,6,12,13,19,20,21,22,23,24],9:[3,4,10,11,17,18,21,22,30,31],10:[1,7,8,14,15,19,20,28,29],11:[5,6,10,11,19,20,26,27]},
    "11": {0:[1,2,10,11,17,18,22,23,31],1:[1,7,8,14,15,16,17,18,19,28],2:[1,7,8,14,15,18,19,27,28,29],3:[4,5,11,12,16,17,25,26],4:[2,3,7,8,16,17,23,24,30,31],5:[1,2,3,4,13,14,20,21,27,28],6:[1,2,10,11,12,18,19,25,26,30,31],7:[8,9,15,16,20,21,29,30],8:[5,6,12,13,14,15,16,17,26,27],9:[3,7,10,11,14,15,23,24,25,31],10:[1,7,8,12,13,21,22,28,29],11:[3,4,12,13,19,20,26,27,28,29,30,31]},
    "12": {0:[3,4,10,11,15,16,24,25,31],1:[1,7,8,9,10,11,12,21,22,28],2:[1,7,8,11,12,20,21,22,28,29],3:[4,5,9,10,18,19,25,26,30],4:[1,9,10,16,17,23,24,25,26,27,28],5:[6,7,13,14,20,21,24,25],6:[3,4,5,11,12,18,19,23,24],7:[1,2,8,9,13,14,22,23,29,30],8:[5,6,7,8,9,10,19,20,26,27],9:[3,4,7,8,16,17,18,24,25,31],10:[1,5,6,14,15,21,22,26,27],11:[5,6,12,13,19,20,21,22,23,24]},
    "13": {0:[3,4,8,9,17,18,24,25,31],1:[1,2,3,4,5,14,15,21,22,28],2:[1,4,5,13,14,15,21,22,28,29],3:[2,3,11,12,18,19,23,24],4:[2,3,9,10,16,17,18,19,20,21,30,31],5:[6,7,13,14,17,18,26,27,28],6:[4,5,11,12,16,17,25,26],7:[1,2,6,7,15,16,22,23,29,30],8:[1,2,3,12,13,19,20,26,27,30],9:[1,9,10,11,17,18,24,25,29,30],10:[7,8,14,15,19,20,28,29],11:[5,6,12,13,14,15,16,17,26,27]},
    "14": {0:[1,2,10,11,17,18,24,25,26,27,28,29],1:[7,8,14,15,21,22,25,26],2:[6,7,8,14,15,21,22,26,27],3:[4,5,11,12,16,17,25,26],4:[2,3,9,10,11,12,13,14,23,24,30,31],5:[6,7,10,11,19,20,21,27,28],6:[4,5,9,10,18,19,25,26,30,31],7:[8,9,15,16,22,23,24,25,26,27],8:[5,6,12,13,19,20,23,24],9:[2,3,4,10,11,17,18,22,23,31],10:[1,7,8,12,13,21,22,28,29],11:[5,6,7,8,9,10,19,20,26,27]},
    "15": {0:[3,4,10,11,17,18,19,20,21,22,31],1:[1,7,8,14,15,18,19,27,28],2:[1,7,8,14,15,19,20,28,29],3:[4,5,9,10,18,19,25,26],4:[2,3,4,5,6,17,23,24,30,31],5:[3,7,12,13,14,20,21,27,28],6:[2,3,11,12,18,19,23,24],7:[1,2,8,9,15,16,17,18,19,20,29,30],8:[5,6,12,13,16,17,25,26,27],9:[3,4,10,11,15,16,24,25,31],10:[1,5,6,14,15,21,22,28,29,30],11:[1,2,3,12,13,19,20,26,27,30,31]}
};

const _G8020MT_2026 = {
    "1": {0:[1,3,4,9,10,11,17,18,20,21,22,31],1:[1,7,8,14,15,21,22,25,26],2:[6,7,8,14,15,21,22,28,29],3:[2,3,11,12,18,19,25,26],4:[2,3,4,5,6,7,16,17,23,24,30,31],5:[6,7,10,11,19,20,21,27,28],6:[4,5,11,12,16,17,25,26],7:[1,2,8,9,15,16,17,18,19,20,29,30],8:[5,6,12,13,19,20,23,24],9:[2,3,4,10,11,17,18,24,25,29,30],10:[7,8,14,15,21,22,28,29,30],11:[1,2,3,12,13,19,20,26,27]},
    "2": {0:[3,4,10,11,12,13,14,15,24,25,31],1:[1,7,8,14,15,18,19,27,28],2:[1,7,8,14,15,21,22,26,27],3:[4,5,11,12,18,19,25,26,27,28,29,30],4:[9,10,16,17,23,24,30,31],5:[3,4,12,13,14,20,21,27,28],6:[4,5,9,10,18,19,25,26],7:[1,2,8,9,10,11,12,13,22,23,29,30],8:[5,6,12,13,16,17,25,26,27],9:[3,4,10,11,17,18,22,23,31],10:[1,7,8,14,15,21,22,23,24,25,26],11:[5,6,12,13,19,20,26,27,30,31]},
    "3": {0:[3,4,5,6,7,8,17,18,24,25,31],1:[1,7,8,11,12,20,21,22,28],2:[1,7,8,14,15,19,20,28,29],3:[4,5,11,12,18,19,20,21,22,23],4:[2,3,9,10,16,17,23,24,27,28],5:[5,6,7,13,14,20,21,27,28],6:[2,3,11,12,18,19,25,26],7:[1,2,3,4,5,6,15,16,22,23,29,30],8:[5,6,9,10,18,19,20,26,27],9:[3,4,10,11,15,16,24,25,31],10:[1,7,8,14,15,16,17,18,19,28,29],11:[5,6,12,13,19,20,23,24]},
    "4": {0:[1,10,11,17,18,24,25,31],1:[1,4,5,13,14,15,21,22,28],2:[1,7,8,12,13,21,22,28,29],3:[4,5,11,12,13,14,15,16,25,26],4:[2,3,9,10,16,17,20,21,29,30,31],5:[6,7,13,14,20,21,25,26],6:[4,5,11,12,18,19,25,26,27,28,29,30],7:[8,9,15,16,22,23,29,30],8:[2,3,11,12,13,19,20,26,27],9:[3,4,8,9,17,18,24,25,31],10:[1,7,8,9,10,11,12,21,22,28,29],11:[5,6,12,13,16,17,25,26,27]},
    "5": {0:[3,4,10,11,17,18,24,25,28,29],1:[6,7,8,14,15,21,22,28],2:[1,5,6,14,15,21,22,28,29],3:[4,5,6,7,8,9,18,19,25,26],4:[2,3,9,10,13,14,22,23,24,30,31],5:[6,7,13,14,18,19,27,28],6:[4,5,11,12,18,19,20,21,22,23],7:[1,2,8,9,15,16,22,23,26,27],8:[4,5,6,12,13,19,20,26,27],9:[1,2,10,11,17,18,24,25,31],10:[1,2,3,4,5,14,15,21,22,28,29],11:[5,6,9,10,18,19,20,26,27]},
    "6": {0:[3,4,10,11,17,18,21,22,30,31],1:[1,7,8,14,15,21,22,26,27],2:[7,8,14,15,21,22,28,29,30,31],3:[1,2,11,12,18,19,25,26],4:[2,3,6,7,15,16,17,23,24,30,31],5:[6,7,11,12,20,21,27,28],6:[4,5,11,12,13,14,15,16,25,26],7:[1,2,8,9,15,16,19,20,28,29,30],8:[5,6,12,13,19,20,24,25],9:[3,4,10,11,17,18,24,25,26,27,28,29],10:[7,8,14,15,21,22,28,29],11:[2,3,11,12,13,19,20,26,27]},
    "7": {0:[3,4,10,11,14,15,23,24,25,31],1:[1,7,8,14,15,19,20,28],2:[1,7,8,14,15,21,22,23,24,25,26],3:[4,5,11,12,18,19,25,26,29,30],4:[8,9,10,16,17,23,24,30,31],5:[4,5,13,14,20,21,27,28],6:[4,5,6,7,8,9,18,19,25,26],7:[1,2,8,9,12,13,21,22,23,29,30],8:[5,6,12,13,17,18,26,27],9:[3,4,10,11,17,18,19,20,21,22,31],10:[1,7,8,14,15,21,22,25,26],11:[4,5,6,12,13,19,20,26,27,31]},
    "8": {0:[3,4,7,8,16,17,18,24,25,31],1:[1,7,8,12,13,21,22,28],2:[1,7,8,14,15,16,17,18,19,28,29],3:[4,5,11,12,18,19,22,23],4:[1,2,3,9,10,16,17,23,24,28,29],5:[6,7,13,14,20,21,27,28,29,30],6:[1,2,11,12,18,19,25,26],7:[1,2,5,6,14,15,16,22,23,29,30],8:[5,6,10,11,19,20,26,27],9:[3,4,10,11,12,13,14,15,24,25,31],10:[1,7,8,14,15,18,19,27,28,29],11:[5,6,12,13,19,20,24,25]},
    "9": {0:[1,9,10,11,17,18,24,25,31],1:[1,5,6,14,15,21,22,28],2:[1,7,8,9,10,11,12,21,22,28,29],3:[4,5,11,12,15,16,24,25,26],4:[2,3,9,10,16,17,21,22,30,31],5:[6,7,13,14,20,21,22,23,24,25],6:[4,5,11,12,18,19,25,26,29,30],7:[7,8,9,15,16,22,23,29,30],8:[3,4,12,13,19,20,26,27],9:[3,4,5,6,7,8,17,18,24,25,31],10:[1,7,8,11,12,20,21,22,28,29],11:[5,6,12,13,17,18,26,27]},
    "10": {0:[2,3,4,10,11,17,18,24,25,29,30],1:[7,8,14,15,21,22,28],2:[1,2,3,4,5,14,15,21,22,28,29],3:[4,5,8,9,17,18,19,25,26],4:[2,3,9,10,14,15,23,24,30,31],5:[6,7,13,14,15,16,17,18,27,28],6:[4,5,11,12,18,19,22,23,31],7:[1,2,8,9,15,16,22,23,27,28],8:[5,6,12,13,19,20,26,27,28,29,30],9:[1,10,11,17,18,24,25,31],10:[1,4,5,13,14,15,21,22,28,29],11:[5,6,10,11,19,20,26,27]},
    "11": {0:[3,4,10,11,17,18,22,23,31],1:[1,7,8,14,15,21,22,23,24,25,26],2:[7,8,14,15,21,22,28,29],3:[1,2,10,11,12,18,19,25,26],4:[2,3,7,8,16,17,23,24,30,31],5:[6,7,8,9,10,11,20,21,27,28],6:[4,5,11,12,15,16,24,25,26],7:[1,2,8,9,15,16,20,21,29,30],8:[5,6,12,13,19,20,21,22,23,24],9:[3,4,10,11,17,18,24,25,28,29],10:[6,7,8,14,15,21,22,28,29],11:[3,4,12,13,19,20,26,27]},
    "12": {0:[3,4,10,11,15,16,24,25,31],1:[1,7,8,14,15,16,17,18,19,28],2:[1,7,8,14,15,21,22,25,26],3:[3,4,5,11,12,18,19,25,26,30],4:[1,9,10,16,17,23,24,30,31],5:[1,2,3,4,13,14,20,21,27,28],6:[4,5,8,9,17,18,19,25,26],7:[1,2,8,9,13,14,22,23,29,30],8:[5,6,12,13,14,15,16,17,26,27],9:[3,4,10,11,17,18,21,22,30,31],10:[1,7,8,14,15,21,22,26,27],11:[5,6,12,13,19,20,26,27,28,29,30,31]},
    "13": {0:[3,4,8,9,17,18,24,25,31],1:[1,7,8,9,10,11,12,21,22,28],2:[1,7,8,14,15,18,19,27,28,29],3:[3,4,5,11,12,18,19,24],4:[2,3,9,10,16,17,23,24,25,26,27,28],5:[6,7,13,14,20,21,27,28],6:[1,2,10,11,12,18,19,25,26],7:[1,2,6,7,15,16,22,23,29,30],8:[5,6,7,8,9,10,19,20,26,27],9:[3,4,10,11,14,15,23,24,25,31],10:[1,7,8,14,15,19,20,28,29],11:[5,6,12,13,19,20,21,22,23,24]},
    "14": {0:[1,2,10,11,17,18,24,25,31],1:[1,2,3,4,5,14,15,21,22,28],2:[1,7,8,11,12,20,21,22,28,29],3:[4,5,11,12,16,17,25,26],4:[2,3,9,10,16,17,18,19,20,21,30,31],5:[6,7,13,14,20,21,24,25],6:[3,4,5,11,12,18,19,25,26,30,31],7:[8,9,15,16,22,23,29,30,31],8:[1,2,3,12,13,19,20,26,27],9:[3,4,7,8,16,17,18,24,25,31],10:[1,7,8,12,13,21,22,28,29],11:[5,6,12,13,14,15,16,17,26,27]},
    "15": {0:[3,4,10,11,17,18,24,25,26,27,28,29],1:[7,8,14,15,21,22,28],2:[1,4,5,13,14,15,21,22,28,29],3:[4,5,9,10,18,19,25,26],4:[2,3,9,10,11,12,13,14,23,24,30,31],5:[6,7,13,14,17,18,26,27,28],6:[4,5,11,12,18,19,23,24],7:[1,2,8,9,15,16,22,23,24,25,26,27],8:[5,6,12,13,19,20,26,27,30],9:[1,9,10,11,17,18,24,25,31],10:[1,5,6,14,15,21,22,28,29],11:[5,6,7,8,9,10,19,20,26,27]}
};

export function getGruposLibres(year) {
    if (!_cache[year]) {
        _cache[year] = {
            t7327: _calcGrupos(year, _P7327),
            t8020: _calcGrupos(year, _P8020),
            // 2026 usa los datos exactos del HTML; otros años se calculan dinámicamente
            t7327mt: year === 2026 ? _G7327MT_2026 : _calcGrupos(year, _P7327MT),
            t8020mt: year === 2026 ? _G8020MT_2026 : _calcGrupos(year, _P8020MT)
        };
    }
    return _cache[year];
}

// En esta app el parámetro "turno" es el SUBGRUPO ('A'..'J') y "grupo" es el grupo ('1'..'5').
// Devuelve un array de 12 meses con los días libres: normales (rojo) + propios del
// subgrupo (azul) + LRJ (verde). Todos son días libres. Si no hay datos de ese año, devuelve vacío.
export function getDiasLibres(year, grupo, turno) {
    const d = getLibresConductor(year, grupo, turno);
    return d.libres.map((_, m) =>
        [...new Set([...d.libres[m], ...d.subgrupo[m], ...d.lrj[m]])].sort((a, b) => a - b)
    );
}

// Días con color especial: { subgrupo: [12 meses], lrj: [12 meses] } (para pintarlos distinto).
export function getDiasEspeciales(year, grupo, turno) {
    const d = getLibresConductor(year, grupo, turno);
    return { subgrupo: d.subgrupo, lrj: d.lrj };
}

export const TURNOS_DISPONIBLES = SUBGRUPOS_CONDUCTORES;

export function esFestivo(year, mIdx, d) {
    const festivos = FESTIVOS[year] || FESTIVOS[2026];
    const clave = d + '/' + (mIdx + 1);
    return festivos.some(f => f.fecha === clave);
}

// ===== CLAVES DE DÍA CON AÑO =====
// Antes, cada día se guardaba en Firebase con una clave tipo "5_15" (mes_día), sin año.
// Eso hacía que lo marcado en un día concreto se repitiera para siempre en todos los años.
// A partir de ahora, la clave incluye el año: "2026_5_15".

// Genera la clave NUEVA de un día (con año). Es la que se usa para GUARDAR a partir de ahora.
export function claveDia(anio, mIdx, dia) {
    return anio + '_' + mIdx + '_' + dia;
}

// Genera la clave VIEJA de un día (sin año), tal y como se guardaba antes de esta migración.
// Solo tiene sentido para datos guardados en el año 2026, que es el único año que existía
// cuando se usaba este formato.
export function claveDiaVieja(mIdx, dia) {
    return mIdx + '_' + dia;
}

// Busca el dato de un día (un cambio, una nota, etc.) dentro de un objeto ya descargado
// de Firebase (por ejemplo "cambios" o "notas"). Primero mira la clave nueva (con año).
// Si no la encuentra Y el año es 2026, mira también la clave vieja (sin año), para no
// perder nada de lo que ya estaba guardado antes de este cambio.
export function leerDia(datos, anio, mIdx, dia) {
    if (!datos) return undefined;
    const valorNuevo = datos[claveDia(anio, mIdx, dia)];
    if (valorNuevo !== undefined) return valorNuevo;
    if (anio === 2026) return datos[claveDiaVieja(mIdx, dia)];
    return undefined;
}

// Descompone una clave de día en sus partes {anio, mIdx, dia}. Entiende tanto la clave
// nueva ("2026_5_15") como la vieja ("5_15", que se entiende siempre como del año 2026).
export function partesDia(key) {
    const partes = String(key).split('_').map(Number);
    if (partes.length === 3) {
        const [anio, mIdx, dia] = partes;
        return { anio, mIdx, dia };
    }
    const [mIdx, dia] = partes;
    return { anio: 2026, mIdx, dia };
}

// Da la clave EXACTA que hay que usar para leer, borrar o modificar un día que puede
// existir ya guardado (con clave vieja o nueva). Si el día ya está guardado con la clave
// vieja, la devuelve (para no perder el dato ni duplicarlo). Si no existe todavía o ya
// está con la clave nueva, devuelve la clave nueva — así todo lo que se guarda o se
// vuelve a tocar a partir de ahora queda ya con el año incluido.
export function claveDiaActual(datos, anio, mIdx, dia) {
    const nueva = claveDia(anio, mIdx, dia);
    if (datos && datos[nueva] !== undefined) return nueva;
    if (anio === 2026 && datos && datos[claveDiaVieja(mIdx, dia)] !== undefined) {
        return claveDiaVieja(mIdx, dia);
    }
    return nueva;
}

// Dice si un día concreto es libre o se trabaja, mirando primero el patrón de turno base
// y luego si hay algún cambio que lo cambie. Es la MISMA regla que ya usa la app para
// pintar el icono de 🏠 o 🚌 en Compañeros, así que aquí se usa igual para que las
// estadísticas cuadren siempre con lo que se ve en el resto de la app.
export function esDiaLibre(esLibrePorTurno, cambio) {
    let libre = !!esLibrePorTurno;
    if (cambio) {
        if (cambio.clase === 'b-cambio-libre' || cambio.clase === 'b-vac') libre = true;
        else if (cambio.clase === 'b-inter' || cambio.clase === 'b-pend' || cambio.clase === 'b-generado' || cambio.clase === 'b-l26') libre = false;
    }
    return libre;
}