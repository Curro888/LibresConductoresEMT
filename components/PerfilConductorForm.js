import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { SISTEMAS_CONDUCTORES, sistemaDe, subgruposDe, etiquetaGrupo } from '../config/libresConductores';
import { COCHERAS_PERSONALES, cocheraDe, textoPersonal } from '../config/personales';

// Perfil de un conductor/a:
//   g  = grupo de libres ('1'..'5')
//   t  = subgrupo ('A'..'J')   (se guarda en "t" para reutilizar el resto de la app)
//   c  = true si es correturnos (sin línea ni turno fijos)
//   l  = línea (número interno, ej. '402' para la E2)  — solo si c es false
//   tu = turno (número)                                  — solo si c es false
//   cl = correturnos de línea ('M' o 'T'); su número va en 'tu'
//   e  = escalafón (en la línea si tiene línea; en la empresa si es correturnos)
export const PERFIL_VACIO = { g: '', t: '', c: false, l: '', tu: '', cl: '', e: '', pe: '' };
// pe = personal (autobús que lleva y trae a los compañeros), ej. 'P18'. Solo en el grupo Personales.
export const PERFIL_PERSONALES = { g: '', t: '', c: false, l: '', tu: '', cl: '', e: '', pe: '' };
// cl = correturnos de línea: 'M' (mañana) o 'T' (tarde). El número de correturnos (ej. 023) va en tu.
export const PERFIL_CORRETURNOS = { g: '', t: '', c: true, l: '', tu: '', e: '' };
// Código fijo del grupo abierto de correturnos (el mismo que usa la versión web).
export const CODIGO_CORRETURNOS = 'CT';
export const escalafonValido = (e) => /^[0-9]+$/.test(String(e || '').trim());

export function validarPerfil(p) {
    if (!p.g || !p.t) return 'Elige tu grupo y tu subgrupo';
    // Línea, turno y escalafón son opcionales (pueden cambiar en cualquier momento).
    return null;
}

// Datos del perfil tal como se guardan en Firebase / en la sesión (sin campos vacíos innecesarios).
export function perfilAMiembro(p) {
    const m = { g: String(p.g), t: String(p.t), c: !!p.c };
    if (!p.c) {
        if (String(p.l || '').trim()) m.l = String(p.l).trim();
        if (/^[MT]$/.test(String(p.cl || ''))) m.cl = String(p.cl);
        if (String(p.tu || '').trim()) m.tu = String(p.tu).trim();
    }
    if (String(p.e || '').trim()) m.e = String(p.e).trim();
    if (String(p.pe || '').trim()) m.pe = String(p.pe).trim();
    return m;
}

// Texto corto para mostrar el perfil en listas.
export function textoPerfil(m) {
    if (!m) return '';
    const partes = [etiquetaGrupo(m.g, m.t)];
    if (m.pe) { partes.push('Personal ' + textoPersonal(m.pe)); return partes.join(' · '); }
    if (m.c) partes.push('Correturnos');
    else {
        if (m.l) partes.push('Línea ' + m.l);
        if (m.cl) partes.push('Corre. Línea ' + (m.cl === 'M' ? 'mañana' : 'tarde') + (m.tu ? ' ' + m.tu : ''));
        else if (m.tu) partes.push('Turno ' + m.tu);
    }
    if (m.e) partes.push('Esc. ' + m.e);
    return partes.join(' · ');
}

const soloNumeros = (txt) => String(txt).replace(/[^0-9]/g, '');

// soloCorreturnos: en la entrada a Correturnos (no hay opción de línea fija y el escalafón es obligatorio).
// escalafonObligatorio / avisoSalirCT: al editar el perfil dentro de Correturnos.
export default function PerfilConductorForm({ value, onChange, soloCorreturnos = false, escalafonObligatorio = false, avisoSalirCT = false, soloPersonales = false, permitePersonales = false }) {
    const v = { ...PERFIL_VACIO, ...(value || {}) };
    const set = (campo, dato) => onChange({ ...v, [campo]: dato });
    // Sistema de libres (convencional / búhos / R.S.N): sale del grupo guardado; si aún no hay grupo, de lo que elija.
    // Altura del teclado: en ventanas emergentes Android no reduce la pantalla, así que dejamos
    // ese espacio libre debajo del formulario para poder subir los campos por encima del teclado.
    const [tecladoAlto, setTecladoAlto] = useState(0);
    useEffect(() => {
        const a = Keyboard.addListener('keyboardDidShow', e => setTecladoAlto(e?.endCoordinates?.height || 0));
        const b = Keyboard.addListener('keyboardDidHide', () => setTecladoAlto(0));
        return () => { a.remove(); b.remove(); };
    }, []);
    const [abreCL, setAbreCL] = useState(false);
    const [cocheraSel, setCocheraSel] = useState((cocheraDe(v.pe) || {}).id || '');
    const [abrePE, setAbrePE] = useState(!!v.pe);
    const mostrarPE = soloPersonales || (permitePersonales && abrePE);
    const cocheraAct = COCHERAS_PERSONALES.find(c => c.id === cocheraSel) || null;
    const [sisElegido, setSisElegido] = useState(sistemaDe(v.g));
    const sis = v.g ? sistemaDe(v.g) : sisElegido;
    const sistema = SISTEMAS_CONDUCTORES.find(x => x.id === sis) || SISTEMAS_CONDUCTORES[0];
    const esRsn = sis === 'R';
    const textoGrupo = (g) => (sis === 'C' ? g : g.slice(1));
    const cambiarSistema = (id) => {
        Keyboard.dismiss();
        if (id === sis) return;
        setSisElegido(id);
        onChange({ ...v, g: '', t: '' });
    };

    return (
        <View>
            <Text style={s.label}>Tu sistema de libres</Text>
            <View style={s.grid}>
                {SISTEMAS_CONDUCTORES.map(x => (
                    <TouchableOpacity key={x.id} style={[s.btnAncho, sis === x.id && s.btnActivo]} onPress={() => cambiarSistema(x.id)}>
                        <Text style={[s.btnTexto, sis === x.id && s.btnTextoActivo]}>{x.nombre}</Text>
                    </TouchableOpacity>
                ))}
                {permitePersonales && !soloPersonales && (
                    <TouchableOpacity style={[s.btnAncho, abrePE && s.btnActivo]} onPress={() => { Keyboard.dismiss(); if (abrePE) set('pe', ''); setAbrePE(!abrePE); }}>
                        <Text style={[s.btnTexto, abrePE && s.btnTextoActivo]}>Personales</Text>
                    </TouchableOpacity>
                )}
            </View>

            <Text style={s.label}>{esRsn ? 'Tu grupo R.S.N (primera letra de tu código)' : 'Tu grupo de libres'}</Text>
            <View style={s.grid}>
                {sistema.grupos.map(g => (
                    <TouchableOpacity key={g} style={[s.btn, v.g === g && s.btnActivo]} onPress={() => { Keyboard.dismiss(); onChange({ ...v, g, t: subgruposDe(g).includes(v.t) ? v.t : '' }); }}>
                        <Text style={[s.btnTexto, v.g === g && s.btnTextoActivo]}>{textoGrupo(g)}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            <Text style={s.label}>{esRsn ? 'Resto de tu código (ej. en A1 es el 1; en AB es la B)' : 'Tu subgrupo'}</Text>
            <View style={s.grid}>
                {subgruposDe(v.g || sistema.grupos[0]).map(sg => (
                    <TouchableOpacity key={sg} style={[s.btn, v.t === sg && s.btnActivo]} onPress={() => { Keyboard.dismiss(); set('t', sg); }}>
                        <Text style={[s.btnTexto, v.t === sg && s.btnTextoActivo]}>{sg}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {mostrarPE && (
                <View>
                    <Text style={s.label}>Tu cochera</Text>
                    <View style={s.grid}>
                        {COCHERAS_PERSONALES.map(c => (
                            <TouchableOpacity key={c.id} style={[s.btnAncho, cocheraSel === c.id && s.btnActivo]} onPress={() => { Keyboard.dismiss(); setCocheraSel(c.id); if (cocheraDe(v.pe) && cocheraDe(v.pe).id !== c.id) set('pe', ''); }}>
                                <Text style={[s.btnTexto, cocheraSel === c.id && s.btnTextoActivo]}>{c.nombre}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    {cocheraAct && <Text style={s.label}>Tu personal</Text>}
                    {cocheraAct && <View style={s.grid}>
                        {cocheraAct.personales.map(p => (
                            <TouchableOpacity key={p} style={[s.btnAncho, v.pe === p && s.btnActivo]} onPress={() => { Keyboard.dismiss(); set('pe', p); }}>
                                <Text style={[s.btnTexto, v.pe === p && s.btnTextoActivo]}>{p}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>}
                </View>
            )}
            {!soloCorreturnos && !soloPersonales && <Text style={s.label}>¿Tienes línea asignada?</Text>}
            {avisoSalirCT && !v.c && (
                <Text style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>
                    Al guardar con línea fija saldrás de la lista de Correturnos y los que van detrás subirán un puesto.
                </Text>
            )}
            {!soloCorreturnos && !soloPersonales && <View style={s.grid}>
                <TouchableOpacity style={[s.btnAncho, !v.c && s.btnActivo]} onPress={() => { Keyboard.dismiss(); set('c', false); }}>
                    <Text style={[s.btnTexto, !v.c && s.btnTextoActivo]}>Sí, línea fija</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnAncho, v.c && s.btnActivo]} onPress={() => { Keyboard.dismiss(); onChange({ ...v, c: true, l: '', tu: '', cl: '' }); }}>
                    <Text style={[s.btnTexto, v.c && s.btnTextoActivo]}>Correturnos</Text>
                </TouchableOpacity>
            </View>}

            {!v.c && !soloPersonales && (
                <View>
                    <Text style={s.label}>Línea (opcional)</Text>
                    <TextInput style={s.input} placeholder="Ej: 402 (la E2) o N5 (búho)" autoCapitalize="characters" value={v.l} onChangeText={t => set('l', String(t).toUpperCase().replace(/[^0-9A-Z]/g, ''))} />
                    <Text style={s.label}>Turno (opcional) · si eres correturnos de línea, escribe tu número y marca M o T</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput style={[s.input, { flex: 1 }]} placeholder="Ej: 5 o 023" keyboardType="numeric" value={v.tu} onChangeText={t => set('tu', soloNumeros(t))} />
                        <TouchableOpacity style={[s.btnCL, v.cl && s.btnActivo]} onPress={() => { Keyboard.dismiss(); setAbreCL(!abreCL); }}>
                            <Text style={[s.btnTexto, v.cl && s.btnTextoActivo]}>{v.cl ? 'Corre. Línea ' + v.cl : 'Corre. Línea'} ▾</Text>
                        </TouchableOpacity>
                    </View>
                    {abreCL && (
                        <View style={s.panelCL}>
                            {['M', 'T'].map((L, i) => (
                                <React.Fragment key={L}>
                                    {i === 1 && <View style={s.divisorCL} />}
                                    <TouchableOpacity style={[s.btnMT, v.cl === L && s.btnActivo]}
                                        onPress={() => { onChange({ ...v, cl: v.cl === L ? '' : L }); setAbreCL(false); }}>
                                        <Text style={[s.btnMTLetra, v.cl === L && s.btnTextoActivo]}>{L}</Text>
                                        <Text style={[s.btnMTSub, v.cl === L && s.btnTextoActivo]}>{L === 'M' ? 'Mañana' : 'Tarde'}</Text>
                                    </TouchableOpacity>
                                </React.Fragment>
                            ))}
                        </View>
                    )}
                </View>
            )}

            {!soloPersonales && <Text style={s.label}>{(v.c ? 'Escalafón en la empresa' : 'Escalafón en la línea') + ((soloCorreturnos || (escalafonObligatorio && v.c)) ? ' (obligatorio)' : ' (opcional)')}</Text>}
            {!soloPersonales && <TextInput style={s.input} placeholder="Ej: 25 (puedes cambiarlo cuando quieras)" keyboardType="numeric" value={v.e} onChangeText={t => set('e', soloNumeros(t))} />}
            {tecladoAlto > 0 && <View style={{ height: tecladoAlto }} />}
        </View>
    );
}

const s = StyleSheet.create({
    label: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 6, marginTop: 12 },
    input: { borderWidth: 2, borderColor: '#ddd6fe', borderRadius: 12, padding: 14, fontSize: 16, color: '#1e1b4b', backgroundColor: '#faf9ff' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
    btn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
    btnAncho: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
    btnCL: { paddingHorizontal: 12, justifyContent: 'center', borderRadius: 12, backgroundColor: '#f1f5f9', borderWidth: 2, borderColor: '#ddd6fe' },
    panelCL: { flexDirection: 'row', marginTop: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#ddd6fe', backgroundColor: '#faf9ff' },
    divisorCL: { width: 1, backgroundColor: '#ddd6fe', marginHorizontal: 8 },
    btnMT: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
    btnMTLetra: { fontSize: 20, fontWeight: '900', color: '#64748b' },
    btnMTSub: { fontSize: 11, fontWeight: '700', color: '#64748b' },
    btnActivo: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
    btnTexto: { fontSize: 13, fontWeight: '700', color: '#64748b' },
    btnTextoActivo: { color: '#fff' },
});
