import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { SISTEMAS_CONDUCTORES, sistemaDe, subgruposDe, etiquetaGrupo } from '../config/libresConductores';

// Perfil de un conductor/a:
//   g  = grupo de libres ('1'..'5')
//   t  = subgrupo ('A'..'J')   (se guarda en "t" para reutilizar el resto de la app)
//   c  = true si es correturnos (sin línea ni turno fijos)
//   l  = línea (número interno, ej. '402' para la E2)  — solo si c es false
//   tu = turno (número)                                  — solo si c es false
//   e  = escalafón (en la línea si tiene línea; en la empresa si es correturnos)
export const PERFIL_VACIO = { g: '', t: '', c: false, l: '', tu: '', e: '' };

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
        if (String(p.tu || '').trim()) m.tu = String(p.tu).trim();
    }
    if (String(p.e || '').trim()) m.e = String(p.e).trim();
    return m;
}

// Texto corto para mostrar el perfil en listas.
export function textoPerfil(m) {
    if (!m) return '';
    const partes = [etiquetaGrupo(m.g, m.t)];
    if (m.c) partes.push('Correturnos');
    else {
        if (m.l) partes.push('Línea ' + m.l);
        if (m.tu) partes.push('Turno ' + m.tu);
    }
    if (m.e) partes.push('Esc. ' + m.e);
    return partes.join(' · ');
}

const soloNumeros = (txt) => String(txt).replace(/[^0-9]/g, '');

export default function PerfilConductorForm({ value, onChange }) {
    const v = { ...PERFIL_VACIO, ...(value || {}) };
    const set = (campo, dato) => onChange({ ...v, [campo]: dato });
    // Sistema de libres (convencional / búhos / R.S.N): sale del grupo guardado; si aún no hay grupo, de lo que elija.
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

            <Text style={s.label}>¿Tienes línea asignada?</Text>
            <View style={s.grid}>
                <TouchableOpacity style={[s.btnAncho, !v.c && s.btnActivo]} onPress={() => { Keyboard.dismiss(); set('c', false); }}>
                    <Text style={[s.btnTexto, !v.c && s.btnTextoActivo]}>Sí, línea fija</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btnAncho, v.c && s.btnActivo]} onPress={() => { Keyboard.dismiss(); onChange({ ...v, c: true, l: '', tu: '' }); }}>
                    <Text style={[s.btnTexto, v.c && s.btnTextoActivo]}>Correturnos</Text>
                </TouchableOpacity>
            </View>

            {!v.c && (
                <View>
                    <Text style={s.label}>Línea (opcional)</Text>
                    <TextInput style={s.input} placeholder="Ej: 402 (la E2) o N5 (búho)" autoCapitalize="characters" value={v.l} onChangeText={t => set('l', String(t).toUpperCase().replace(/[^0-9A-Z]/g, ''))} />
                    <Text style={s.label}>Turno (opcional)</Text>
                    <TextInput style={s.input} placeholder="Ej: 5" keyboardType="numeric" value={v.tu} onChangeText={t => set('tu', soloNumeros(t))} />
                </View>
            )}

            <Text style={s.label}>{(v.c ? 'Escalafón en la empresa' : 'Escalafón en la línea') + ' (opcional)'}</Text>
            <TextInput style={s.input} placeholder="Ej: 25 (puedes cambiarlo cuando quieras)" keyboardType="numeric" value={v.e} onChangeText={t => set('e', soloNumeros(t))} />
        </View>
    );
}

const s = StyleSheet.create({
    label: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 6, marginTop: 12 },
    input: { borderWidth: 2, borderColor: '#ddd6fe', borderRadius: 12, padding: 14, fontSize: 16, color: '#1e1b4b', backgroundColor: '#faf9ff' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
    btn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
    btnAncho: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
    btnActivo: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
    btnTexto: { fontSize: 13, fontWeight: '700', color: '#64748b' },
    btnTextoActivo: { color: '#fff' },
});
