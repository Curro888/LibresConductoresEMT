import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Switch, TextInput, Image, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { db } from '../config/firebase';
import { ref, onValue, update, get } from 'firebase/database';
import { equipoBase, mesesArr, getDiasLibres, esFestivo } from '../config/datos';
import PerfilConductorForm, { PERFIL_VACIO, escalafonValido, validarPerfil, perfilAMiembro, textoPerfil } from '../components/PerfilConductorForm';
import { useTheme } from '../context/ThemeContext';
import CopiaSeguridad from '../components/CopiaSeguridad';
import { APP_VERSION } from '../config/version';
import { alerta14Activada, activarAlerta14 } from '../services/notifications';

const HORAS_POR_DIA = 7.5; // Ajustar si el convenio cambia

export default function AjustesScreen({ navigation }) {
    const { theme, modoOscuro, toggleModoOscuro } = useTheme();
    const [sesion, setSesion] = useState(null);
    const [cambios, setCambios] = useState({});
    const [mostrarStats, setMostrarStats] = useState(false);
    const [modalPerfil, setModalPerfil] = useState(false);
    const [modalAcercaDe, setModalAcercaDe] = useState(false);
    const [esAdmin, setEsAdmin] = useState(false);
    const [editNombre, setEditNombre] = useState('');
    const [editPerfil, setEditPerfil] = useState(PERFIL_VACIO);
    const [fotoPerfil, setFotoPerfil] = useState(null);
    const [alerta14, setAlerta14] = useState(true);
    const [modalPE, setModalPE] = useState(false);
    const [pePerfil, setPePerfil] = useState(PERFIL_VACIO);
    useEffect(() => { alerta14Activada().then(setAlerta14); }, []);

    useEffect(() => {
        let unsubCambios, unsubAdmin;
        async function cargar() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (raw) {
                const s = JSON.parse(raw);
                setSesion(s);
                setEditNombre(s.miNombreCompleto || '');
                const mp = s.miPerfil || {};
                setEditPerfil({
                    g: String(mp.g || s.miGrupoSesion || ''),
                    t: mp.t || s.miTipoSesion || '',
                    c: !!mp.c, l: mp.l || '', tu: mp.tu || '', cl: mp.cl || '', e: mp.e || '', pe: mp.pe || ''
                });
                const foto = await AsyncStorage.getItem('fotoPerfil');
                if (foto) setFotoPerfil(foto);
                unsubCambios = onValue(ref(db, 'cambios/' + s.miID), snap => setCambios(snap.val() || {}));
                // Solo muestra el acceso al panel de administrador a quien esté en la lista de Firebase
                unsubAdmin = onValue(ref(db, 'appConfig/administradores/' + s.miID), snap => setEsAdmin(!!snap.val()));
            }
        }
        cargar();
        return () => { if (unsubCambios) unsubCambios(); if (unsubAdmin) unsubAdmin(); };
    }, []);

    async function seleccionarFoto() {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permiso denegado'); return; }
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 1 });
        if (result.canceled) return;
        const comprimida = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 200 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true });
        const base64 = 'data:image/jpeg;base64,' + comprimida.base64;
        setFotoPerfil(base64);
        await AsyncStorage.setItem('fotoPerfil', base64);
    }

    // Entrar en Personales desde la app ya iniciada (p. ej. un correturnos que coge plaza de personal).
    async function entrarEnPersonales() {
        if (!sesion || !sesion.miID) return;
        const err = validarPerfil(pePerfil);
        if (err) { Alert.alert('⚠️', err); return; }
        if (!pePerfil.pe) { Alert.alert('⚠️', 'Elige tu cochera y tu personal'); return; }
        const m = perfilAMiembro({ ...pePerfil, c: false });
        const nombre = (editNombre || sesion.miNombreCompleto || '').trim();
        if (!nombre) { Alert.alert('⚠️', 'El nombre no puede estar vacío.'); return; }
        try {
            const cambios = {};
            const snapPE = await get(ref(db, 'grupos/PE'));
            if (!(snapPE.val() || {}).nombre) {
                cambios['grupos/PE/nombre'] = 'Personales';
                cambios['grupos/PE/pass'] = '';
                cambios['grupos/PE/creador'] = sesion.miID;
            }
            cambios['grupos/PE/miembros/' + sesion.miID] = { n: nombre, id: sesion.miID, ...m };
            // Si estaba en Correturnos, sale de la lista y los que iban detrás suben un puesto.
            const enCT = !!(sesion.modoGrupo && sesion.grupoActual === 'CT');
            if (enCT) {
                const snap = await get(ref(db, 'grupos/CT/miembros'));
                const todos = snap.val() || {};
                const miE = parseInt((todos[sesion.miID] || {}).e, 10);
                cambios['grupos/CT/miembros/' + sesion.miID] = null;
                cambios['presencia/CT/' + sesion.miID] = null;
                if (!isNaN(miE)) {
                    Object.keys(todos).forEach(k => {
                        if (k === sesion.miID) return;
                        const e = parseInt((todos[k] || {}).e, 10);
                        if (!isNaN(e) && e > miE) cambios['grupos/CT/miembros/' + k + '/e'] = String(e - 1);
                    });
                }
            }
            await update(ref(db), cambios);
            const raw = await AsyncStorage.getItem('misGrupos2026');
            let lista = raw ? JSON.parse(raw) : [];
            if (enCT) lista = lista.filter(g => g.codigo !== 'CT');
            const entrada = { codigo: 'PE', id: sesion.miID, nombre, tipo: m.t, grupoLibres: m.g, perfil: m };
            const i = lista.findIndex(g => g.codigo === 'PE');
            if (i >= 0) lista[i] = entrada; else lista.push(entrada);
            await AsyncStorage.setItem('misGrupos2026', JSON.stringify(lista));
            const nueva = { miID: sesion.miID, miNombreCompleto: nombre, modoGrupo: true, grupoActual: 'PE', miGrupoSesion: m.g, miTipoSesion: m.t, miPerfil: m };
            await AsyncStorage.setItem('sesion2026', JSON.stringify(nueva));
            setModalPE(false);
            Alert.alert('✅ Ya estás en Personales', 'Puedes volver a tu otro grupo desde la pantalla de entrada (Cerrar sesión).');
            navigation.replace('Main', nueva);
        } catch (e) {
            Alert.alert('⚠️', 'No se pudo entrar en Personales (¿sin conexión?). Inténtalo de nuevo con internet.');
        }
    }

    async function guardarPerfil() {
        if (!editNombre.trim()) { Alert.alert('⚠️', 'El nombre no puede estar vacío.'); return; }
        const errPerfil = validarPerfil(editPerfil);
        if (errPerfil) { Alert.alert('⚠️', errPerfil); return; }
        const m = perfilAMiembro(editPerfil);
        const enCT = !!(sesion.modoGrupo && sesion.grupoActual === 'CT' && sesion.miID);
        const enPE = !!(sesion.modoGrupo && sesion.grupoActual === 'PE' && sesion.miID);
        if (enPE && !m.pe) { Alert.alert('⚠️', 'En Personales tienes que elegir tu cochera y tu personal.'); return; }

        if (enCT && m.c && !escalafonValido(m.e)) {
            Alert.alert('⚠️', 'En Correturnos el escalafón es obligatorio (solo el número).');
            return;
        }

        // Pasa a línea fija: sale de Correturnos y los que van detrás suben un puesto.
        if (enCT && !m.c) {
            try {
                const snap = await get(ref(db, 'grupos/CT/miembros'));
                const todos = snap.val() || {};
                const miE = parseInt((todos[sesion.miID] || {}).e, 10);
                const cambios = {};
                cambios['grupos/CT/miembros/' + sesion.miID] = null;
                cambios['presencia/CT/' + sesion.miID] = null;
                if (!isNaN(miE)) {
                    Object.keys(todos).forEach(k => {
                        if (k === sesion.miID) return;
                        const e = parseInt((todos[k] || {}).e, 10);
                        if (!isNaN(e) && e > miE) cambios['grupos/CT/miembros/' + k + '/e'] = String(e - 1);
                    });
                }
                await update(ref(db), cambios);
                const raw = await AsyncStorage.getItem('misGrupos2026');
                const lista = (raw ? JSON.parse(raw) : []).filter(g => g.codigo !== 'CT');
                await AsyncStorage.setItem('misGrupos2026', JSON.stringify(lista));
                const sinCT = { ...sesion, miNombreCompleto: editNombre.trim(), miGrupoSesion: m.g, miTipoSesion: m.t, miPerfil: m, modoGrupo: false, grupoActual: null };
                await AsyncStorage.setItem('sesion2026', JSON.stringify(sinCT));
                setModalPerfil(false);
                Alert.alert('✅ Has salido de Correturnos', 'Tu perfil se ha guardado con línea fija y los correturnos que iban detrás han subido un puesto.');
                navigation.replace('Main', sinCT);
            } catch (e) {
                Alert.alert('⚠️', 'No se pudo salir de Correturnos (¿sin conexión?). Inténtalo de nuevo con internet.');
            }
            return;
        }

        const nuevaSesion = { ...sesion, miNombreCompleto: editNombre.trim(), miGrupoSesion: m.g, miTipoSesion: m.t, miPerfil: m };
        setSesion(nuevaSesion);
        await AsyncStorage.setItem('sesion2026', JSON.stringify(nuevaSesion));

        // Actualizar también en Firebase si está en modo grupo (mi ficha dentro del grupo).
        // Los campos que ya no aplican (p. ej. línea y turno al pasar a correturnos) se borran con null.
        if (sesion.modoGrupo && sesion.grupoActual && sesion.miID) {
            try {
                await update(ref(db, 'grupos/' + sesion.grupoActual + '/miembros/' + sesion.miID), {
                    n: editNombre.trim(),
                    id: sesion.miID,
                    g: m.g, t: m.t, c: m.c,
                    l: m.l ?? null, tu: m.tu ?? null, cl: m.cl ?? null, e: m.e ?? null, pe: m.pe ?? null
                });
                // Mantener también el acceso rápido guardado en el móvil
                const raw = await AsyncStorage.getItem('misGrupos2026');
                const lista = raw ? JSON.parse(raw) : [];
                const i = lista.findIndex(g => g.codigo === sesion.grupoActual);
                if (i >= 0) {
                    lista[i] = { ...lista[i], nombre: editNombre.trim(), tipo: m.t, grupoLibres: m.g, perfil: m };
                    await AsyncStorage.setItem('misGrupos2026', JSON.stringify(lista));
                }
            } catch (e) {
                Alert.alert('⚠️ Guardado solo en este móvil', 'No se pudo actualizar tu ficha en el grupo (¿sin conexión?). Inténtalo de nuevo con internet para que tus compañeros vean el cambio.');
                setModalPerfil(false);
                return;
            }
        }
        setModalPerfil(false);
        Alert.alert('✅ Perfil actualizado');
    }

    async function cerrarSesion() {
        Alert.alert('Cerrar sesión', '¿Seguro que quieres cerrar sesión?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Cerrar sesión', style: 'destructive', onPress: async () => {
                await AsyncStorage.removeItem('sesion2026');
                navigation.replace('Login');
            }}
        ]);
    }

    const stats = useMemo(() => {
        if (!sesion) return null;
        const anio = new Date().getFullYear();
        const p = (equipoBase || []).find(x => x.id === sesion.miID);
        const grupo = p ? p.g : sesion.miGrupoSesion;
        const turno = p ? p.t : sesion.miTipoSesion;
        if (!grupo || !turno) return null;

        const diasLibresBase = getDiasLibres(anio, grupo, turno) || {};
        const hoy = new Date();
        const mHoy = hoy.getMonth(), dHoy = hoy.getDate();

        let totalLibres = 0, finesLibres = 0, festivosLibres = 0;
        let diasTrabajadosAnio = 0, diasTrabajadosMes = 0, diasRestantesMes = 0;
        const detalleMeses = [];

        for (let mIdx = 0; mIdx < 12; mIdx++) {
            const diasMes = diasLibresBase[mIdx] || [];
            const diasEnMes = new Date(anio, mIdx + 1, 0).getDate();
            let fdsEsMes = 0, festEsMes = 0;

            diasMes.forEach(d => {
                const dow = new Date(anio, mIdx, d).getDay();
                if (dow === 0 || dow === 6) fdsEsMes++;
                if (esFestivo(anio, mIdx, d)) festEsMes++;
            });
            totalLibres += diasMes.length;
            finesLibres += fdsEsMes;
            festivosLibres += festEsMes;

            // Contar tipos de cambios de ese mes
            const keysDelMes = Object.keys(cambios).filter(k => k.startsWith(mIdx + '_'));
            let nComp = 0, nPropio = 0, nPend = 0, nGen = 0;
            keysDelMes.forEach(k => {
                const c = cambios[k];
                if (!c) return;
                if (c.clase === 'b-inter' || c.clase === 'b-cambio-libre') nComp++;
                else if (c.clase === 'b-propio' || c.clase === 'b-cambio') nPropio++;
                else if (c.clase === 'b-pend') nPend++;
                else if (c.clase === 'b-generado') nGen++;
            });

            detalleMeses.push({ mIdx, totalDia: diasMes.length, fds: fdsEsMes, fest: festEsMes, nComp, nPropio, nPend, nGen });

            // Días trabajados (sólo hasta hoy)
            const limDia = (mIdx < mHoy) ? diasEnMes : (mIdx === mHoy ? dHoy : 0);
            for (let d = 1; d <= limDia; d++) {
                const esLibreBase = diasMes.includes(d);
                const cambio = cambios[mIdx + '_' + d];
                let esLibre = esLibreBase;
                if (cambio) {
                    if (cambio.clase === 'b-cambio-libre' || cambio.clase === 'b-vac') esLibre = true;
                    else if (cambio.clase === 'b-inter' || cambio.clase === 'b-generado') esLibre = false;
                }
                if (!esLibre) {
                    diasTrabajadosAnio++;
                    if (mIdx === mHoy) diasTrabajadosMes++;
                }
            }
            if (mIdx === mHoy) {
                for (let d = dHoy + 1; d <= diasEnMes; d++) {
                    const esLibreBase = diasMes.includes(d);
                    const cambio = cambios[mIdx + '_' + d];
                    let esLibre = esLibreBase;
                    if (cambio) {
                        if (cambio.clase === 'b-cambio-libre' || cambio.clase === 'b-vac') esLibre = true;
                        else if (cambio.clase === 'b-inter' || cambio.clase === 'b-generado') esLibre = false;
                    }
                    if (!esLibre) diasRestantesMes++;
                }
            }
        }

        return {
            totalLibres, finesLibres, festivosLibres,
            horasAnio: diasTrabajadosAnio * HORAS_POR_DIA,
            horasMes: diasTrabajadosMes * HORAS_POR_DIA,
            horasRestantesMes: diasRestantesMes * HORAS_POR_DIA,
            mesActual: mHoy,
            detalleMeses
        };
    }, [sesion, cambios]);

    const s = getStyles(theme);

    return (
        <View style={s.container}>
            <View style={s.header}>
                <Text style={s.titulo}>⚙️ Ajustes</Text>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>

                {/* Perfil */}
                <TouchableOpacity style={s.card} onPress={() => setModalPerfil(true)}>
                    <View style={s.filaSwitch}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                            {fotoPerfil
                                ? <Image source={{ uri: fotoPerfil }} style={s.avatarSmall} />
                                : <View style={[s.avatarSmall, { backgroundColor: theme.primario, alignItems: 'center', justifyContent: 'center' }]}>
                                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18 }}>{sesion?.miNombreCompleto?.[0] || '?'}</Text>
                                  </View>
                            }
                            <View>
                                <Text style={s.cardTitulo}>👤 Mi perfil</Text>
                                <Text style={s.cardSub}>{sesion?.miNombreCompleto || ''} · {textoPerfil(sesion?.miPerfil || { g: sesion?.miGrupoSesion, t: sesion?.miTipoSesion })}</Text>
                            </View>
                        </View>
                        <Text style={s.flecha}>▶</Text>
                    </View>
                </TouchableOpacity>

                {/* Modo oscuro */}
                <View style={s.card}>
                    <View style={s.filaSwitch}>
                        <View>
                            <Text style={s.cardTitulo}>🌙 Modo oscuro</Text>
                            <Text style={s.cardSub}>Cambia la apariencia de la app</Text>
                        </View>
                        <Switch
                            value={modoOscuro}
                            onValueChange={toggleModoOscuro}
                            trackColor={{ false: '#cbd5e1', true: '#7c3aed' }}
                            thumbColor="#fff"
                        />
                    </View>
                </View>

                {/* Alerta del día 14 */}
                <View style={s.card}>
                    <View style={s.filaSwitch}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                            <Text style={s.cardTitulo}>📅 Aviso del día 14</Text>
                            <Text style={s.cardSub}>Cada día 14 a las 22:00: último día para pedir cobro de días</Text>
                        </View>
                        <Switch
                            value={alerta14}
                            onValueChange={async (v) => { setAlerta14(v); await activarAlerta14(v); }}
                            trackColor={{ false: '#cbd5e1', true: '#7c3aed' }}
                            thumbColor="#fff"
                        />
                    </View>
                </View>

                {/* Entrar en Personales */}
                {sesion && sesion.miID && !(sesion.modoGrupo && sesion.grupoActual === 'PE') && (
                    <TouchableOpacity style={s.card} onPress={() => { setPePerfil({ ...editPerfil, c: false, pe: '' }); setModalPE(true); }}>
                        <View style={s.filaSwitch}>
                            <View style={{ flex: 1, paddingRight: 12 }}>
                                <Text style={s.cardTitulo}>🚐 Entrar en Personales</Text>
                                <Text style={s.cardSub}>Si has cogido plaza en un personal, entra directamente desde aquí</Text>
                            </View>
                            <Text style={s.flecha}>▶</Text>
                        </View>
                    </TouchableOpacity>
                )}

                {/* Estadísticas */}
                <TouchableOpacity style={s.card} onPress={() => setMostrarStats(!mostrarStats)}>
                    <View style={s.filaSwitch}>
                        <View>
                            <Text style={s.cardTitulo}>📊 Estadísticas</Text>
                            <Text style={s.cardSub}>Tus días libres y horas trabajadas</Text>
                        </View>
                        <Text style={s.flecha}>{mostrarStats ? '▲' : '▼'}</Text>
                    </View>
                </TouchableOpacity>

                {mostrarStats && (
                    !stats ? (
                        <View style={s.card}>
                            <Text style={s.vacioTexto}>No hay datos de libres para tu grupo todavía.</Text>
                        </View>
                    ) : (
                        <View style={s.statsBlock}>
                            <View style={s.statsRow3}>
                                <View style={[s.statCard, { backgroundColor: '#f5f3ff' }]}>
                                    <Text style={[s.statNum, { color: '#7c3aed' }]}>{stats.totalLibres}</Text>
                                    <Text style={s.statLabel}>TOTAL LIBRES</Text>
                                </View>
                                <View style={[s.statCard, { backgroundColor: '#f0fdf4' }]}>
                                    <Text style={[s.statNum, { color: '#16a34a' }]}>{stats.finesLibres}</Text>
                                    <Text style={s.statLabel}>FIN DE SEMANA</Text>
                                </View>
                                <View style={[s.statCard, { backgroundColor: '#fef2f2' }]}>
                                    <Text style={[s.statNum, { color: '#dc2626' }]}>{stats.festivosLibres}</Text>
                                    <Text style={s.statLabel}>FESTIVOS</Text>
                                </View>
                            </View>

                            <Text style={s.seccionTitulo}>⏱️ Horas trabajadas</Text>
                            <View style={s.statsRow2}>
                                <View style={[s.statCardBig, { backgroundColor: '#f0f9ff' }]}>
                                    <Text style={[s.statNumBig, { color: '#0369a1' }]}>{stats.horasMes.toFixed(1)}h</Text>
                                    <Text style={s.statLabel}>{mesesArr[stats.mesActual].toUpperCase()} (HASTA HOY)</Text>
                                </View>
                                <View style={[s.statCardBig, { backgroundColor: '#f0fdf4' }]}>
                                    <Text style={[s.statNumBig, { color: '#16a34a' }]}>{stats.horasRestantesMes.toFixed(1)}h</Text>
                                    <Text style={s.statLabel}>QUEDAN EN EL MES</Text>
                                </View>
                            </View>
                            <View style={[s.statCardBig, { backgroundColor: '#faf5ff', marginTop: 8 }]}>
                                <Text style={[s.statNumBig, { color: '#7c3aed' }]}>{stats.horasAnio.toFixed(1)}h</Text>
                                <Text style={s.statLabel}>TOTAL AÑO HASTA HOY</Text>
                            </View>

                            <Text style={s.seccionTitulo}>Detalle por mes</Text>
                            <View style={s.leyendaFila}>
                                <View style={s.leyendaHueco} />
                                <Text style={s.leyendaTexto}>LIBRES</Text>
                                <Text style={[s.leyendaTexto, { color: '#16a34a' }]}>FDS</Text>
                                <Text style={[s.leyendaTexto, { color: '#dc2626' }]}>FEST</Text>
                            </View>
                            {stats.detalleMeses.map(m => (
                                <View key={m.mIdx} style={s.mesFila}>
                                    <View style={s.mesFilaTop}>
                                        <Text style={s.mesNombre}>{mesesArr[m.mIdx].slice(0, 3)}</Text>
                                        <Text style={s.mesDato}>{m.totalDia} libres</Text>
                                        <Text style={[s.mesDato, { color: '#16a34a' }]}>{m.fds} fds</Text>
                                        <Text style={[s.mesDato, { color: '#dc2626' }]}>{m.fest} fest</Text>
                                    </View>
                                    {(m.nComp + m.nPropio + m.nPend + m.nGen) > 0 && (
                                        <View style={s.etiquetasFila}>
                                            {m.nComp > 0 && <Text style={[s.etiqueta, { backgroundColor: '#ede9fe', color: '#7c3aed' }]}>🤝{m.nComp}</Text>}
                                            {m.nPropio > 0 && <Text style={[s.etiqueta, { backgroundColor: '#e0f2fe', color: '#0369a1' }]}>🔄{m.nPropio}</Text>}
                                            {m.nPend > 0 && <Text style={[s.etiqueta, { backgroundColor: '#fef3c7', color: '#b45309' }]}>⏳{m.nPend}</Text>}
                                            {m.nGen > 0 && <Text style={[s.etiqueta, { backgroundColor: '#fce7f3', color: '#be185d' }]}>✨{m.nGen}</Text>}
                                        </View>
                                    )}
                                </View>
                            ))}
                        </View>
                    )
                )}

                {/* Acerca de */}
                <TouchableOpacity style={s.card} onPress={() => setModalAcercaDe(true)}>
                    <View style={s.filaSwitch}>
                        <View>
                            <Text style={s.cardTitulo}>ℹ️ Acerca de</Text>
                            <Text style={s.cardSub}>Versión de la app y más información</Text>
                        </View>
                        <Text style={s.flecha}>▶</Text>
                    </View>
                </TouchableOpacity>

                {esAdmin && (
                    <TouchableOpacity style={s.card} onPress={() => navigation.navigate('Admin')}>
                        <View style={s.filaSwitch}>
                            <View>
                                <Text style={s.cardTitulo}>🛠️ Panel de administrador</Text>
                                <Text style={s.cardSub}>Ver y gestionar todos los grupos</Text>
                            </View>
                            <Text style={s.flecha}>▶</Text>
                        </View>
                    </TouchableOpacity>
                )}

                <CopiaSeguridad />

                <TouchableOpacity style={s.btn} onPress={cerrarSesion}>
                    <Text style={s.btnTexto}>🚪 Cerrar sesión</Text>
                </TouchableOpacity>
            </ScrollView>

            {/* Modal editar perfil */}
            <Modal visible={modalPerfil} transparent animationType="slide" onRequestClose={() => setModalPerfil(false)}>
                <View style={s.overlayBottom}>
                    <View style={[s.modalCard, { maxHeight: '92%' }]}>
                      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                        <Text style={s.modalTitulo}>👤 Editar perfil</Text>

                        {/* Foto */}
                        <TouchableOpacity style={s.avatarWrap} onPress={seleccionarFoto}>
                            {fotoPerfil
                                ? <Image source={{ uri: fotoPerfil }} style={s.avatarGrande} />
                                : <View style={[s.avatarGrande, { backgroundColor: theme.primario, alignItems: 'center', justifyContent: 'center' }]}>
                                    <Text style={{ color: '#fff', fontSize: 36, fontWeight: '900' }}>{editNombre[0] || '?'}</Text>
                                  </View>
                            }
                            <Text style={s.avatarCambiar}>📷 Cambiar foto</Text>
                        </TouchableOpacity>

                        <Text style={s.modalLabel}>Nombre completo</Text>
                        <TextInput style={s.modalInput} value={editNombre} onChangeText={setEditNombre} placeholder="Tu nombre" placeholderTextColor={theme.textoTenue} maxLength={50} />

                        <PerfilConductorForm value={editPerfil} onChange={setEditPerfil} escalafonObligatorio={!!(sesion && sesion.modoGrupo && sesion.grupoActual === "CT")} avisoSalirCT={!!(sesion && sesion.modoGrupo && sesion.grupoActual === "CT")} soloPersonales={!!(sesion && sesion.modoGrupo && sesion.grupoActual === "PE")} />

                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
                            <TouchableOpacity style={s.btnCancelarModal} onPress={() => setModalPerfil(false)}>
                                <Text style={s.btnCancelarModalTexto}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnGuardarModal} onPress={guardarPerfil}>
                                <Text style={s.btnGuardarModalTexto}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                      </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Modal entrar en Personales */}
            <Modal visible={modalPE} transparent animationType="slide" onRequestClose={() => setModalPE(false)}>
                <View style={s.overlayBottom}>
                    <View style={[s.modalCard, { maxHeight: '92%' }]}>
                      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                        <Text style={s.modalTitulo}>🚐 Entrar en Personales</Text>
                        <PerfilConductorForm value={pePerfil} onChange={setPePerfil} soloPersonales />
                        {!!(sesion && sesion.modoGrupo && sesion.grupoActual === 'CT') && (
                            <Text style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>
                                Al entrar saldrás de la lista de Correturnos y los que van detrás subirán un puesto.
                            </Text>
                        )}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
                            <TouchableOpacity style={s.btnCancelarModal} onPress={() => setModalPE(false)}>
                                <Text style={s.btnCancelarModalTexto}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnGuardarModal} onPress={entrarEnPersonales}>
                                <Text style={s.btnGuardarModalTexto}>Entrar</Text>
                            </TouchableOpacity>
                        </View>
                      </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Modal Acerca de */}
            <Modal visible={modalAcercaDe} transparent animationType="fade" onRequestClose={() => setModalAcercaDe(false)}>
                <View style={s.overlay}>
                    <View style={s.acercaDeCard}>
                        <Text style={s.acercaDeEmoji}>📅</Text>
                        <Text style={s.acercaDeNombre}>Libres Conductores EMT</Text>
                        <Text style={s.acercaDeVersion}>Versión {APP_VERSION}</Text>
                        <Text style={s.acercaDeTexto}>
                            App para gestionar turnos, cambios y coordinación con el equipo.
                        </Text>
                        <TouchableOpacity style={s.btnCerrarAcercaDe} onPress={() => setModalAcercaDe(false)}>
                            <Text style={s.btnCerrarAcercaDeTexto}>Cerrar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function getStyles(theme) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.fondo },
        header: { backgroundColor: theme.headerFondo, padding: 16, paddingTop: 50 },
        titulo: { fontSize: 20, fontWeight: '900', color: theme.headerTexto },
        card: { backgroundColor: theme.card, borderRadius: 16, padding: 16, marginHorizontal: 16, marginTop: 16, elevation: 1 },
        filaSwitch: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        cardTitulo: { fontSize: 15, fontWeight: '800', color: theme.texto },
        cardSub: { fontSize: 12, color: theme.textoTenue, marginTop: 2 },
        flecha: { fontSize: 14, color: theme.primario, fontWeight: '900' },
        vacioTexto: { color: theme.textoTenue, fontSize: 13, textAlign: 'center', fontStyle: 'italic' },
        statsBlock: { marginHorizontal: 16, marginTop: 10 },
        statsRow3: { flexDirection: 'row', gap: 8, marginBottom: 8 },
        statCard: { flex: 1, borderRadius: 14, padding: 12, alignItems: 'center' },
        statNum: { fontSize: 24, fontWeight: '900' },
        statLabel: { fontSize: 10, color: theme.textoSecundario, fontWeight: '700', marginTop: 2, textAlign: 'center' },
        seccionTitulo: { fontSize: 13, fontWeight: '800', color: theme.texto, marginTop: 16, marginBottom: 8 },
        statsRow2: { flexDirection: 'row', gap: 8 },
        statCardBig: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
        statNumBig: { fontSize: 22, fontWeight: '900' },
        leyendaFila: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, paddingHorizontal: 10 },
        leyendaHueco: { width: 40 },
        leyendaTexto: { flex: 1, fontSize: 11, color: theme.textoTenue, fontWeight: '700', textAlign: 'center' },
        mesFila: { backgroundColor: theme.card, borderRadius: 12, padding: 10, marginBottom: 6 },
        mesFilaTop: { flexDirection: 'row', alignItems: 'center' },
        mesNombre: { fontSize: 13, fontWeight: '800', color: theme.texto, width: 40 },
        mesDato: { flex: 1, fontSize: 12, color: theme.textoSecundario, textAlign: 'center' },
        etiquetasFila: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
        etiqueta: { fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
        btn: { margin: 20, marginTop: 24, backgroundColor: '#ef4444', borderRadius: 14, padding: 16, alignItems: 'center' },
        btnTexto: { color: '#fff', fontWeight: '800', fontSize: 16 },
        avatarSmall: { width: 44, height: 44, borderRadius: 22 },
        overlayBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
        modalCard: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
        modalTitulo: { fontSize: 18, fontWeight: '900', color: theme.texto, textAlign: 'center', marginBottom: 16 },
        avatarWrap: { alignItems: 'center', marginBottom: 16 },
        avatarGrande: { width: 90, height: 90, borderRadius: 45 },
        avatarCambiar: { color: theme.primario, fontWeight: '700', marginTop: 8, fontSize: 13 },
        modalLabel: { fontSize: 12, fontWeight: '700', color: theme.textoSecundario, marginTop: 12, marginBottom: 4 },
        modalInput: { borderWidth: 2, borderColor: theme.borde, borderRadius: 10, padding: 10, fontSize: 14, color: theme.texto },
        turnoBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9' },
        turnoBtnActive: { backgroundColor: theme.primario },
        turnoBtnTexto: { fontSize: 12, fontWeight: '700', color: theme.textoSecundario },
        turnoBtnTextoActive: { color: '#fff' },
        btnCancelarModal: { flex: 1, backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9', borderRadius: 12, padding: 14, alignItems: 'center' },
        btnCancelarModalTexto: { color: theme.textoSecundario, fontWeight: '700' },
        btnGuardarModal: { flex: 1, backgroundColor: theme.primario, borderRadius: 12, padding: 14, alignItems: 'center' },
        btnGuardarModalTexto: { color: '#fff', fontWeight: '700' },
        overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
        acercaDeCard: { backgroundColor: theme.card, borderRadius: 20, padding: 28, width: '80%', alignItems: 'center' },
        acercaDeEmoji: { fontSize: 44, marginBottom: 8 },
        acercaDeNombre: { fontSize: 20, fontWeight: '900', color: theme.texto },
        acercaDeVersion: { fontSize: 13, color: theme.textoTenue, marginTop: 4, marginBottom: 14 },
        acercaDeTexto: { fontSize: 13, color: theme.textoSecundario, textAlign: 'center', lineHeight: 19 },
        btnCerrarAcercaDe: { marginTop: 20, backgroundColor: theme.primario, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 },
        btnCerrarAcercaDeTexto: { color: '#fff', fontWeight: '700' },
    });
}