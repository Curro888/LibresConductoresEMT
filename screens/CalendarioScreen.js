import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Modal, Animated, Dimensions, BackHandler, Alert, FlatList, TextInput,
    KeyboardAvoidingView, Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../config/firebase';
import { ref, onValue, set, remove, update, push, get } from 'firebase/database';
import { equipoBase, mesesArr, getDiasLibres, esFestivo, getGruposLibres, MAX_LIBRES_VAC, claveDia, leerDia, partesDia, claveDiaActual, esDiaLibre } from '../config/datos';
import { useTheme } from '../context/ThemeContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus'; // añadido: aviso de sin conexión
import { enviarPushA } from '../services/notifications';

const { width: SW } = Dimensions.get('window');
const PANEL_W = SW * 0.75;

function getDiasEnMes(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getPrimerDia(y, m) { let d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }

// Calcula de antemano el alto exacto (en píxeles) de la tarjeta de un mes, sin tener que
// pintarlo primero. Así la lista de meses sabe dónde está cada uno desde el principio, y
// puede saltar directamente al mes actual al abrir la app sin trucos que puedan fallar.
function alturaMes(anio, mIdx) {
    const anchoContenido = SW - 48; // ancho de pantalla menos el margen (12) y el padding (12) de cada lado
    const anchoCelda = anchoContenido * 0.142857; // 14.28% = 1/7 de columnas
    const altoCelda = anchoCelda + 2; // aspectRatio 1 + marginVertical (1 arriba y 1 abajo)

    const dias = getDiasEnMes(anio, mIdx);
    const inicio = getPrimerDia(anio, mIdx);
    const filas = Math.ceil((inicio + dias) / 7);

    const margenYPadding = 12 + 12 + 12 + 12; // margin arriba/abajo + padding arriba/abajo de la tarjeta
    const altoNombreMes = 24 + 8;   // texto del nombre del mes + su marginBottom
    const altoCabeceraDias = 15 + 4; // fila de L M X J V S D + su marginBottom

    return margenYPadding + altoNombreMes + altoCabeceraDias + (filas * altoCelda);
}

function getEstadoPersona(uid, year, mIdx, d, cambiosTodos, equipo) {
    const p = (equipo || []).find(x => x.id === uid);
    if (!p) return false;
    const diasLibresBase = getDiasLibres(year, p.g, p.t);
    const libreBase = diasLibresBase && (diasLibresBase[mIdx] || []).includes(d);
    const cambio = leerDia(cambiosTodos[uid], year, mIdx, d);
    let esLibre = libreBase;
    if (cambio) {
        if (cambio.clase === 'b-cambio-libre' || cambio.clase === 'b-vac') esLibre = true;
        else if (cambio.clase === 'b-inter' || cambio.clase === 'b-pend' || cambio.clase === 'b-generado' || cambio.clase === 'b-l26') esLibre = false;
    }
    return esLibre;
}

export default function CalendarioScreen({ navigation, route }) {
    const { theme } = useTheme();
    const isConnected = useNetworkStatus(); // añadido: estado de red en tiempo real
    const [sesion, setSesion] = useState(null);
    const [cambios, setCambios] = useState({});
    const [cambiosTodos, setCambiosTodos] = useState({});
    const [panelDia, setPanelDia] = useState(null);
    const [menuDia, setMenuDia] = useState(null);
    const [modoSeleccion, setModoSeleccion] = useState(null);
    const [modalCompaneros, setModalCompaneros] = useState(null);
    const [anio, setAnio] = useState(new Date().getFullYear());
    const [notas, setNotas] = useState({});
    const [modalNota, setModalNota] = useState(null); // {d, mIdx, texto}
    const [modalGenerarManual, setModalGenerarManual] = useState(null); // {d, mIdx, texto}
    const [modalVacaciones, setModalVacaciones] = useState(null); // {diaIni, mIdxIni, diaFin, mIdxFin}
    const [modoGenerado, setModoGenerado] = useState(null);
    const [equipoActual, setEquipoActual] = useState(equipoBase);
    const [solicitudPendiente, setSolicitudPendiente] = useState(null); // { solKey, compNom } — mi solicitud enviada, esperando respuesta
    const panelAnim = useRef(new Animated.Value(SW)).current;
    const longPressTimer = useRef(null);
    const longPressed = useRef(false);
    const solicitudesVistas = useRef(new Set());
    const scrollRef = useRef(null);

    useEffect(() => {
        let unsubCambios, unsubNotas, unsubCambiosTodos, unsubSolicitudes, unsubEquipo;
        async function cargar() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (raw) {
                const s = JSON.parse(raw);
                setSesion(s);
                unsubCambios = onValue(ref(db, 'cambios/' + s.miID), snap => setCambios(snap.val() || {}));
                unsubNotas = onValue(ref(db, 'notas/' + s.miID), snap => setNotas(snap.val() || {}));
                unsubCambiosTodos = onValue(ref(db, 'cambios'), snap => setCambiosTodos(snap.val() || {}));
                // Cargar modoGenerado si viene del historial
                const mgRaw = await AsyncStorage.getItem('modoGenerado');
                if (mgRaw) {
                    setModoGenerado(JSON.parse(mgRaw));
                    await AsyncStorage.removeItem('modoGenerado');
                }
                if (s.modoGrupo) {
                    unsubSolicitudes = onValue(ref(db, 'solicitudes'), snap => {
                        const todas = snap.val() || {};
                        Object.entries(todas).forEach(([key, sol]) => {
                            if (String(sol.para) === String(s.miID) && sol.estado === 'pendiente' && !solicitudesVistas.current.has(key)) {
                                solicitudesVistas.current.add(key);
                                mostrarSolicitudEntrante(key, sol, s);
                            }
                        });
                    });
                    if (s.grupoActual) {
                        unsubEquipo = onValue(ref(db, 'grupos/' + s.grupoActual + '/miembros'), snap => {
                            const data = snap.val() || {};
                            const lista = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
                            setEquipoActual(lista);
                        });
                    }
                } else {
                    setEquipoActual(equipoBase);
                }
            }
        }
        cargar();
        return () => {
            if (unsubCambios) unsubCambios();
            if (unsubNotas) unsubNotas();
            if (unsubCambiosTodos) unsubCambiosTodos();
            if (unsubSolicitudes) unsubSolicitudes();
            if (unsubEquipo) unsubEquipo();
        };
    }, []);

    // Mientras haya una solicitud propia pendiente, escucha en tiempo real la respuesta
    // y cierra el aviso automáticamente en cuanto el compañero acepte o rechace.
    useEffect(() => {
        if (!solicitudPendiente) return;
        const { solKey, compNom } = solicitudPendiente;
        const unsub = onValue(ref(db, 'solicitudes/' + solKey), snap => {
            const sol = snap.val();
            if (!sol) { setSolicitudPendiente(null); return; }
            if (sol.estado === 'aceptada') {
                setSolicitudPendiente(null);
                remove(ref(db, 'solicitudes/' + solKey));
                Alert.alert('✅ Aceptado', `${compNom} aceptó el cambio.`);
            } else if (sol.estado === 'rechazada') {
                setSolicitudPendiente(null);
                remove(ref(db, 'solicitudes/' + solKey));
                Alert.alert('❌ Rechazado', `${compNom} rechazó el cambio.`);
            }
        });
        return () => unsub();
    }, [solicitudPendiente?.solKey]);

    function mostrarSolicitudEntrante(key, sol, s) {
        const remitente = (equipoActual || []).find(x => x.id === sol.de)?.n || sol.miNom || sol.de;
        Alert.alert(
            '🤝 Solicitud de cambio',
            `${remitente} quiere hacer un cambio contigo:\n\nTú libras el ${sol.f1} y trabajas el ${sol.f2}\n\n¿Aceptas?`,
            [
                { text: 'Rechazar', style: 'destructive', onPress: async () => {
                    await update(ref(db, 'solicitudes/' + key), { estado: 'rechazada' });
                    solicitudesVistas.current.delete(key);
                    enviarPushA(sol.de, '❌ Cambio rechazado', `${sol.compNom || 'Tu compañero'} rechazó tu solicitud de cambio.`, { tipo: 'solicitud' });
                }},
                { text: 'Aceptar', onPress: async () => {
                    const { de: u1, para: u2, d1, m1, d2, m2, miNom, compNom, f1, f2 } = sol;
                    const anioSol = sol.anio || 2026; // solicitudes antiguas no llevaban año: eran siempre de 2026
                    const ts = Date.now();
                    const key1 = claveDia(anioSol, m1, d1);
                    const key2 = claveDia(anioSol, m2, d2);
                    const updates = {
                        [`cambios/${u1}/${key1}`]: { texto: `Haces (x ${compNom} ${f2})`, clase: 'b-inter', linkedUid: u2, linkedKey: key2 },
                        [`cambios/${u1}/${key2}`]: { texto: `Libras (x ${compNom} ${f1})`, clase: 'b-cambio-libre', linkedUid: u2, linkedKey: key1 },
                        [`cambios/${u2}/${key1}`]: { texto: `Libras (x ${miNom} ${f2})`, clase: 'b-cambio-libre', linkedUid: u1, linkedKey: key2 },
                        [`cambios/${u2}/${key2}`]: { texto: `Haces (x ${miNom} ${f1})`, clase: 'b-inter', linkedUid: u1, linkedKey: key1 },
                        // Una sola "tarjeta" de historial por persona representando el intercambio completo
                        [`historial2/${u1}/${ts}`]: { cat: 'comp', ts, con: compNom, otroUid: u2, diaTrabaja: f1, diaLibra: f2, anio: anioSol, nota: '' },
                        [`historial2/${u2}/${ts}`]: { cat: 'comp', ts, con: miNom, otroUid: u1, diaTrabaja: f2, diaLibra: f1, anio: anioSol, nota: '' },
                        [`solicitudes/${key}/estado`]: 'aceptada'
                    };
                    await update(ref(db), updates);
                    Alert.alert('✅ Cambio aceptado', 'El cambio se ha aplicado en ambos calendarios.');
                    enviarPushA(u1, '✅ Cambio aceptado', `${compNom} aceptó tu solicitud de cambio.`, { tipo: 'solicitud' });
                }}
            ]
        );
    }

    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (modalCompaneros) { setModalCompaneros(null); return true; }
            if (modoSeleccion) { setModoSeleccion(null); return true; }
            if (panelDia) { cerrarPanel(); return true; }
            if (menuDia) { setMenuDia(null); return true; }
            if (anio !== new Date().getFullYear()) { setAnio(new Date().getFullYear()); return true; } // volver al año actual
            return false;
        });
        return () => handler.remove();
    }, [panelDia, menuDia, modoSeleccion, modalCompaneros, anio]);

    // Detectar modoGenerado cuando la pantalla recibe foco
    useFocusEffect(
        useCallback(() => {
            async function checkModoGenerado() {
                const mgRaw = await AsyncStorage.getItem('modoGenerado');
                if (mgRaw) {
                    setModoGenerado(JSON.parse(mgRaw));
                    await AsyncStorage.removeItem('modoGenerado');
                }
                // Recoger una solicitud de cambio con compañero enviada desde su calendario
                const spRaw = await AsyncStorage.getItem('solicitudPendienteTemp');
                if (spRaw) {
                    setSolicitudPendiente(JSON.parse(spRaw));
                    await AsyncStorage.removeItem('solicitudPendienteTemp');
                }
            }
            checkModoGenerado();
        }, [])
    );

    function abrirPanel(d, mIdx) {
        setPanelDia({ d, mIdx });
        Animated.spring(panelAnim, { toValue: SW - PANEL_W, useNativeDriver: true }).start();
    }

    function cerrarPanel() {
        Animated.timing(panelAnim, { toValue: SW, duration: 200, useNativeDriver: true }).start(() => setPanelDia(null));
    }

    function onPressIn(d, mIdx) {
        longPressed.current = false;
        longPressTimer.current = setTimeout(() => {
            longPressed.current = true;
            setMenuDia({ d, mIdx });
        }, 500);
    }
    function onPressOut() { clearTimeout(longPressTimer.current); }

    function onPress(d, mIdx) {
        if (longPressed.current) return;
        clearTimeout(longPressTimer.current);

        // Modo generado/convenio/pendiente desde historial
        if (modoGenerado) {
            const tipo = modoGenerado.tipo;
            const labels = {
                generado: '✨ Usar día generado',
                convenio: '📋 Usar día de convenio',
                pendiente: '⏳ Usar día pendiente',
                l26: '🟡 Usar día L-26'
            };
            Alert.alert(
                labels[tipo] || '📅 Confirmar día',
                `¿Librar el ${d}/${mIdx + 1}?`,
                [
                    { text: 'Cancelar', style: 'cancel', onPress: () => setModoGenerado(null) },
                    { text: 'Confirmar', onPress: async () => {
                        const keyLibre = claveDia(anio, mIdx, d);
                        await set(ref(db, 'cambios/' + modoGenerado.miID + '/' + keyLibre), {
                            clase: 'b-cambio-libre',
                            texto: `Librado por ${tipo}`,
                            histKey: modoGenerado.histKey
                        });
                        await update(ref(db, 'historial2/' + modoGenerado.miID + '/' + modoGenerado.histKey), {
                            usado: true, accion: 'librar', diaAsignado: keyLibre
                        });
                        setModoGenerado(null);
                        Alert.alert('✅ Listo', `El ${d}/${mIdx + 1} queda marcado.`);
                    }}
                ]
            );
            return;
        }

        if (modoSeleccion) {
            if (modoSeleccion.tipo === 'propio') confirmarCambioPropio(modoSeleccion.diaA, modoSeleccion.mIdxA, d, mIdx);
            else if (modoSeleccion.tipo === 'companero') confirmarCambioCompanero(modoSeleccion.diaA, modoSeleccion.mIdxA, d, mIdx, modoSeleccion.companeroID);
            return;
        }
        abrirPanel(d, mIdx);
    }

    async function confirmarCambioPropio(dA, mIdxA, dB, mIdxB) {
        setModoSeleccion(null);
        const p = (equipoActual || []).find(x => x.id === sesion.miID);
        const grupo = p ? p.g : sesion.miGrupoSesion;
        const turno = p ? p.t : sesion.miTipoSesion;
        const diasLibres = getDiasLibres(anio, grupo, turno);
        const libreA = diasLibres && (diasLibres[mIdxA] || []).includes(dA);
        const libreB = diasLibres && (diasLibres[mIdxB] || []).includes(dB);
        const updates = {};
        updates['cambios/' + sesion.miID + '/' + claveDia(anio, mIdxA, dA)] = libreA
            ? { clase: 'b-inter', texto: `Haces (x ${dB}/${mIdxB + 1})` }
            : { clase: 'b-cambio-libre', texto: `Libras (x ${dB}/${mIdxB + 1})` };
        updates['cambios/' + sesion.miID + '/' + claveDia(anio, mIdxB, dB)] = libreB
            ? { clase: 'b-inter', texto: `Haces (x ${dA}/${mIdxA + 1})` }
            : { clase: 'b-cambio-libre', texto: `Libras (x ${dA}/${mIdxA + 1})` };
        await update(ref(db), updates);
        Alert.alert('✅ Cambio propio guardado', `${dA}/${mIdxA + 1} ↔ ${dB}/${mIdxB + 1}`);
    }

    async function confirmarCambioCompanero(dA, mIdxA, dB, mIdxB, companeroID) {
        setModoSeleccion(null);
        const miNom = sesion.miNombreCompleto.split(' ')[0];
        const compNom = (equipoActual || []).find(x => x.id === companeroID)?.n.split(' ')[0] || companeroID;
        const f1 = `${dA}/${mIdxA + 1}`;
        const f2 = `${dB}/${mIdxB + 1}`;
        Alert.alert(
            '🤝 Confirmar cambio',
            `Tu día ${f1}: trabajarás\nTu día ${f2}: librarás\n\n${compNom}:\nEl ${f1} librará\nEl ${f2} trabajará\n\n¿Enviar solicitud?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Enviar', onPress: async () => {
                    const solRef = push(ref(db, 'solicitudes'));
                    const solKey = solRef.key;
                    await set(solRef, {
                        de: sesion.miID, para: companeroID,
                        d1: dA, m1: mIdxA, d2: dB, m2: mIdxB, anio,
                        f1, f2, miNom, compNom,
                        estado: 'pendiente', ts: Date.now()
                    });
                    setSolicitudPendiente({ solKey, compNom });
                    enviarPushA(companeroID, '🤝 Nueva solicitud de cambio', `${miNom} quiere cambiar el ${f1} por el ${f2} contigo.`, { tipo: 'solicitud' });
                }}
            ]
        );
    }

    async function checkVacacionesGenerados(keyOverride, vacOverride, cambiosOverride, fechaFinTexto) {
        // Cuenta días libres-base dentro de todos los periodos de vacaciones del año (excluyendo festivos)
        const p = (equipoActual || []).find(x => x.id === sesion.miID);
        const grupo = p ? p.g : sesion.miGrupoSesion;
        const turno = p ? p.t : sesion.miTipoSesion;
        const diasLibresBase = getDiasLibres(anio, grupo, turno) || {};

        const cambiosSim = cambiosOverride ? { ...cambiosOverride } : { ...cambios };
        if (keyOverride) {
            if (vacOverride) cambiosSim[keyOverride] = { clase: 'b-vac' };
            else delete cambiosSim[keyOverride];
        }

        let totalLibresEnVac = 0;
        Object.entries(cambiosSim).forEach(([key, c]) => {
            if (c && c.clase === 'b-vac') {
                const { anio: anioClave, mIdx, dia: d } = partesDia(key);
                if (anioClave !== anio) return; // solo contamos los días del año que se está mirando
                if (esFestivo(anio, mIdx, d)) return; // festivos se generan aparte
                if ((diasLibresBase[mIdx] || []).includes(d)) totalLibresEnVac++;
            }
        });

        const exceso = Math.max(0, totalLibresEnVac - MAX_LIBRES_VAC);

        // Buscar generados ya creados por exceso de vacaciones este año
        const hRef = ref(db, 'historial2/' + sesion.miID);
        const snap = await new Promise(res => onValue(hRef, s => res(s), { onlyOnce: true }));
        const historial = snap.val() || {};
        const yaGenerados = Object.entries(historial).filter(([, h]) => h.subtipo === 'exceso_vac' && h.anio === anio);

        if (exceso > yaGenerados.length) {
            // Crear los que falten
            const faltan = exceso - yaGenerados.length;
            for (let i = 0; i < faltan; i++) {
                const nuevoRef = push(hRef);
                await set(nuevoRef, {
                    cat: 'generado', subtipo: 'exceso_vac', anio,
                    ts: Date.now(), fecha: fechaFinTexto || '',
                    nota: 'Exceso de libres en vacaciones', usado: false
                });
            }
        } else if (exceso < yaGenerados.length) {
            // Borrar los sobrantes (los no usados primero)
            const sobran = yaGenerados.length - exceso;
            const noUsados = yaGenerados.filter(([, h]) => !h.usado);
            for (let i = 0; i < Math.min(sobran, noUsados.length); i++) {
                await remove(ref(db, 'historial2/' + sesion.miID + '/' + noUsados[i][0]));
            }
        }
    }

    async function generarFestivosDeRango(diaIni, mIdxIni, diaFin, mIdxFin) {
        // Genera un día por cada festivo dentro del rango de vacaciones, evitando duplicados
        const fechaIni = new Date(anio, mIdxIni, diaIni);
        const fechaFin = new Date(anio, mIdxFin, diaFin);
        const hRef = ref(db, 'historial2/' + sesion.miID);
        const snap = await new Promise(res => onValue(hRef, s => res(s), { onlyOnce: true }));
        const historial = snap.val() || {};

        let f = new Date(fechaIni);
        while (f <= fechaFin) {
            const mIdx = f.getMonth(), dia = f.getDate();
            if (esFestivo(anio, mIdx, dia)) {
                const fechaTxt = `${dia}/${mIdx + 1}/${anio}`;
                const yaExiste = Object.values(historial).some(h => h.subtipo === 'festivo_auto' && h.fecha === fechaTxt);
                if (!yaExiste) {
                    const nuevoRef = push(hRef);
                    await set(nuevoRef, {
                        cat: 'generado', subtipo: 'festivo_auto',
                        ts: Date.now(), fecha: fechaTxt,
                        nota: 'Festivo trabajado/librado', usado: false
                    });
                }
            }
            f.setDate(f.getDate() + 1);
        }
    }

    // Borra en tiempo real, para los dos usuarios, un cambio con compañero completo
    // (los 4 días del calendario + las 2 tarjetas de historial), a partir de un día ya conocido.
    async function borrarCambioCompDesdeCalendario(key, data) {
        const linkedUid = data.linkedUid;
        const misOtroKey = data.linkedKey;

        const updates = {};
        updates[`cambios/${sesion.miID}/${key}`] = null;
        if (misOtroKey) updates[`cambios/${sesion.miID}/${misOtroKey}`] = null;
        updates[`cambios/${linkedUid}/${key}`] = null;
        if (misOtroKey) updates[`cambios/${linkedUid}/${misOtroKey}`] = null;
        await update(ref(db), updates);

        // Calcular las dos fechas del intercambio para localizar las tarjetas de historial
        const { mIdx: mA, dia: dA } = partesDia(key);
        const fechaA = `${dA}/${mA + 1}`;
        let fechaB = null;
        if (misOtroKey) {
            const { mIdx: mB, dia: dB } = partesDia(misOtroKey);
            fechaB = `${dB}/${mB + 1}`;
        }

        for (const usuario of [sesion.miID, linkedUid]) {
            const snap = await get(ref(db, 'historial2/' + usuario));
            const historialUsuario = snap.val() || {};
            const updatesHist = {};
            Object.entries(historialUsuario).forEach(([hKey, h]) => {
                if (h && h.cat === 'comp' && (
                    h.diaTrabaja === fechaA || h.diaLibra === fechaA ||
                    (fechaB && (h.diaTrabaja === fechaB || h.diaLibra === fechaB))
                )) {
                    updatesHist[`historial2/${usuario}/${hKey}`] = null;
                }
            });
            if (Object.keys(updatesHist).length > 0) await update(ref(db), updatesHist);
        }
    }

    async function aplicarCambio(tipo, d, mIdx) {
        setMenuDia(null);
        const key = claveDiaActual(cambios, anio, mIdx, d);
        const r = ref(db, 'cambios/' + sesion.miID + '/' + key);

        if (tipo === 'borrar') {
            const snapCambio = cambios[key];
            const eraVacacion = snapCambio && snapCambio.clase === 'b-vac';
            const esCambioComp = snapCambio && snapCambio.linkedUid;

            if (esCambioComp) {
                const compNombre = (equipoActual || []).find(x => x.id === snapCambio.linkedUid)?.n || snapCambio.linkedUid;
                Alert.alert(
                    'Cambio con compañero',
                    `Este día es un cambio con ${compNombre}.\n¿Borrar el cambio para los dos?`,
                    [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Borrar', style: 'destructive', onPress: async () => {
                            await borrarCambioCompDesdeCalendario(key, snapCambio);
                        }}
                    ]
                );
                return;
            }

            if (eraVacacion) {
                // Borrar todo el tramo consecutivo de vacaciones (cruzando meses si hace falta)
                const fechaIni = new Date(anio, mIdx, d);
                const keysABorrar = [key];

                // Hacia atrás (funciona igual aunque el tramo cruce de un año a otro)
                let f = new Date(fechaIni);
                while (true) {
                    f.setDate(f.getDate() - 1);
                    const k = claveDiaActual(cambios, f.getFullYear(), f.getMonth(), f.getDate());
                    const c = cambios[k];
                    if (c && c.clase === 'b-vac') keysABorrar.push(k);
                    else break;
                }
                // Hacia adelante
                f = new Date(fechaIni);
                while (true) {
                    f.setDate(f.getDate() + 1);
                    const k = claveDiaActual(cambios, f.getFullYear(), f.getMonth(), f.getDate());
                    const c = cambios[k];
                    if (c && c.clase === 'b-vac') keysABorrar.push(k);
                    else break;
                }

                Alert.alert(
                    '🗑️ Borrar vacaciones',
                    `¿Borrar todo el periodo de vacaciones (${keysABorrar.length} días)?`,
                    [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Borrar', style: 'destructive', onPress: async () => {
                            for (const k of keysABorrar) {
                                await remove(ref(db, 'cambios/' + sesion.miID + '/' + k));
                            }
                            const hRef = ref(db, 'historial2/' + sesion.miID);
                            const snap = await new Promise(res => onValue(hRef, s => res(s), { onlyOnce: true }));
                            const historial = snap.val() || {};
                            const fechasTramo = keysABorrar.map(k => {
                                const { anio: aK, mIdx: mI, dia: dI } = partesDia(k);
                                return `${dI}/${mI + 1}/${aK}`;
                            });
                            for (const [hKey, h] of Object.entries(historial)) {
                                if (h.subtipo === 'festivo_auto' && fechasTramo.includes(h.fecha) && !h.usado) {
                                    await remove(ref(db, 'historial2/' + sesion.miID + '/' + hKey));
                                }
                            }
                            const cambiosSinTramo = { ...cambios };
                            for (const k of keysABorrar) delete cambiosSinTramo[k];
                            await checkVacacionesGenerados(null, null, cambiosSinTramo);
                        }}
                    ]
                );
                return;
            }

            await remove(r);
            if (snapCambio && snapCambio.histKey && snapCambio.texto === 'Libre sin compensación') {
                await remove(ref(db, 'historial2/' + sesion.miID + '/' + snapCambio.histKey));
            } else if (snapCambio && snapCambio.histKey && snapCambio.clase === 'b-l26') {
                await remove(ref(db, 'historial2/' + sesion.miID + '/' + snapCambio.histKey));
            } else if (snapCambio && snapCambio.histKey && snapCambio.texto === 'Trabajado (genera pendiente)') {
                // Esta tarjeta nació junto con este día: al borrar el día, se borra la tarjeta entera
                await remove(ref(db, 'historial2/' + sesion.miID + '/' + snapCambio.histKey));
            } else if (snapCambio && snapCambio.histKey && snapCambio.clase === 'b-generado') {
                // Igual que el caso anterior: el "Generar" manual nace junto con este día
                await remove(ref(db, 'historial2/' + sesion.miID + '/' + snapCambio.histKey));
            } else if (snapCambio && snapCambio.histKey) {
                await update(ref(db, 'historial2/' + sesion.miID + '/' + snapCambio.histKey), {
                    usado: false, accion: null, diaAsignado: null
                });
            }
            return;
        }
        if (tipo === 'propio') { setModoSeleccion({ tipo: 'propio', diaA: d, mIdxA: mIdx }); return; }
        if (tipo === 'companero') { setModalCompaneros({ diaA: d, mIdxA: mIdx }); return; }
        if (tipo === 'vacaciones') {
            setModalVacaciones({ diaIni: d, mIdxIni: mIdx, diaFin: d, mIdxFin: mIdx });
            return;
        }

        if (tipo === 'libreGracioso') {
            const hRef = push(ref(db, 'historial2/' + sesion.miID));
            const fechaTxt = `${d}/${mIdx + 1}/${anio}`;
            await set(hRef, {
                cat: 'libreGracioso',
                fecha: fechaTxt,
                ts: Date.now(),
                nota: 'Libre sin compensación',
                usado: false,
                diaKey: key
            });
            await set(r, { clase: 'b-cambio-libre', texto: 'Libre sin compensación', histKey: hRef.key });
            return;
        }

        if (tipo === 'generado') {
            Alert.alert(
                '✨ Generado',
                `¿Qué quieres hacer con el ${d}/${mIdx + 1}?`,
                [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Usar', onPress: () => {
                        navigation.navigate('Historial', { tabInicial: 'generados', diaOrigen: { d, mIdx, anio, miID: sesion.miID } });
                    }},
                    { text: 'Generar', onPress: () => {
                        setModalGenerarManual({ d, mIdx, texto: '' });
                    }}
                ]
            );
            return;
        }

        if (tipo === 'l26') {
            const fechaTxt = `${d}/${mIdx + 1}/${anio}`;
            const hRef = push(ref(db, 'historial2/' + sesion.miID));
            await set(hRef, {
                cat: 'l26', subtipo: 'manual',
                ts: Date.now(), fecha: fechaTxt,
                nota: 'L-26', usado: false,
                diaKey: key
            });
            await set(r, { clase: 'b-l26', texto: 'L-26', histKey: hRef.key });
            return;
        }

        if (tipo === 'convenio') {
            navigation.navigate('Historial', { tabInicial: 'convenio', diaOrigen: { d, mIdx, anio, miID: sesion.miID } });
            return;
        }

        if (tipo === 'nota') {
            const notaActual = leerDia(notas, anio, mIdx, d)?.texto || '';
            setModalNota({ d, mIdx, texto: notaActual });
            return;
        }

        if (tipo === 'pendiente') {
            const p = (equipoActual || []).find(x => x.id === sesion.miID);
            const grupo = p ? p.g : sesion.miGrupoSesion;
            const turno = p ? p.t : sesion.miTipoSesion;
            const diasLibresBase = getDiasLibres(anio, grupo, turno) || {};
            const esLibrePorTurno = (diasLibresBase[mIdx] || []).includes(d);
            const cambioActual = leerDia(cambios, anio, mIdx, d);
            const esLibre = esDiaLibre(esLibrePorTurno, cambioActual);

            if (esLibre) {
                // Día libre que vas a trabajar: se genera un pendiente nuevo y el día
                // queda marcado como trabajado en el calendario, todo en un solo paso.
                const fechaTxt = `${d}/${mIdx + 1}/${anio}`;
                const hRef = push(ref(db, 'historial2/' + sesion.miID));
                await set(hRef, {
                    cat: 'pendiente', subtipo: 'generado_trabajo',
                    ts: Date.now(), fecha: fechaTxt,
                    nota: `Generado por trabajar el ${fechaTxt}`, usado: false,
                    diaKey: key
                });
                await set(r, { clase: 'b-inter', texto: 'Trabajado (genera pendiente)', histKey: hRef.key });
                Alert.alert('✅ Pendiente generado', `Has trabajado el ${d}/${mIdx + 1} y se ha añadido un día pendiente para usar cuando quieras.`);
                return;
            }

            // Día laborable que vas a librar: eliges qué pendiente ya generado gastar.
            navigation.navigate('Historial', { tabInicial: 'pendientes', diaOrigen: { d, mIdx, anio, miID: sesion.miID } });
            return;
        }
    }

    // Dónde empieza cada mes dentro de la lista larga, calculado de antemano según su alto real.
    const layoutsMeses = useMemo(() => {
        let offset = 0;
        const layouts = [];
        for (let m = 0; m < 12; m++) {
            const length = alturaMes(anio, m);
            layouts.push({ length, offset, index: m });
            offset += length;
        }
        return layouts;
    }, [anio]);

    const panelData = useMemo(() => {
        if (!panelDia) return null;
        const { d, mIdx } = panelDia;
        const libran = (equipoActual || []).filter(p => getEstadoPersona(p.id, anio, mIdx, d, cambiosTodos, equipoActual));
        const trabajan = (equipoActual || []).filter(p => !getEstadoPersona(p.id, anio, mIdx, d, cambiosTodos, equipoActual));
        return { libran, trabajan };
    }, [panelDia, anio, cambiosTodos]);

    const s = getStyles(theme);

    if (!sesion) return <ActivityIndicator style={{ flex: 1 }} color="#a78bfa" />;

    const p = (equipoActual || []).find(x => x.id === sesion.miID);
    const grupo = p ? p.g : sesion.miGrupoSesion;
    const turno = p ? p.t : sesion.miTipoSesion;
    const diasLibresBase = getDiasLibres(anio, grupo, turno) || {};

    function renderMes(mIdx) {
        const dias = getDiasEnMes(anio, mIdx);
        const start = getPrimerDia(anio, mIdx);
        const libresBase = diasLibresBase[mIdx] || [];
        const hoy = new Date();
        const esHoy = (d) => hoy.getFullYear() === anio && hoy.getMonth() === mIdx && hoy.getDate() === d;
        const esDiaA = (d) => modoSeleccion && modoSeleccion.diaA === d && modoSeleccion.mIdxA === mIdx;

        let celdas = [];
        for (let i = 0; i < start; i++) celdas.push(<View key={'e' + i} style={s.celda} />);

        for (let d = 1; d <= dias; d++) {
            const cambio = leerDia(cambios, anio, mIdx, d);
            const esLibre = libresBase.includes(d);
            const festivo = esFestivo(anio, mIdx, d);

            let borderColor = 'transparent';
            let esLibreReal = esLibre;
            if (cambio) {
                if (cambio.clase === 'b-inter') esLibreReal = false;
                if (cambio.clase === 'b-cambio-libre') esLibreReal = true;
            }
            let bgColor = esLibreReal ? theme.celdaLibre : theme.celdaTrabajo;
            let textColor = esLibreReal ? theme.celdaLibreTexto : theme.celdaTrabajoTexto;

            if (festivo) { bgColor = '#ef4444'; textColor = esLibreReal ? '#ffffff' : '#000000'; }
            if (cambio) {
                if (cambio.clase === 'b-vac') { bgColor = '#dcfce7'; textColor = '#166534'; borderColor = '#16a34a'; }
                if (cambio.clase === 'b-pend') { bgColor = '#f3e8ff'; textColor = '#6b21a8'; borderColor = '#9333ea'; }
                if (cambio.clase === 'b-inter') { bgColor = '#fef08a'; textColor = '#713f12'; borderColor = '#eab308'; }
                if (cambio.clase === 'b-cambio-libre') { bgColor = '#fee2e2'; textColor = '#991b1b'; borderColor = '#ef4444'; }
                if (cambio.clase === 'b-generado') { bgColor = '#fdf2f8'; textColor = '#be185d'; borderColor = '#f472b6'; }
                if (cambio.clase === 'b-l26') { bgColor = '#fefce8'; textColor = '#b45309'; borderColor = '#f59e0b'; }
            }
            if (esDiaA(d)) { bgColor = '#7c3aed'; textColor = '#ffffff'; borderColor = '#4c1d95'; }

            const dd = d; const mm = mIdx;
            const tieneNota = leerDia(notas, anio, mIdx, d);
            celdas.push(
                <TouchableOpacity
                    key={d}
                    style={[s.celda, { backgroundColor: bgColor, borderColor, borderWidth: borderColor !== 'transparent' ? 2 : 0 }]}
                    onPressIn={() => onPressIn(dd, mm)}
                    onPressOut={onPressOut}
                    onPress={() => onPress(dd, mm)}
                    activeOpacity={0.7}
                >
                    <Text style={[s.diaNum, { color: textColor, fontWeight: esHoy(d) ? '900' : '600' }]}>{d}</Text>
                    {esHoy(d) && <View style={s.hoyDot} />}
                    {tieneNota && <View style={s.notaDot} />}
                </TouchableOpacity>
            );
        }

        return (
            <View key={mIdx} style={s.mesCard}>
                <Text style={s.mesNombre}>{mesesArr[mIdx]}</Text>
                <View style={s.diasHeader}>
                    {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => <Text key={d} style={s.diaLetra}>{d}</Text>)}
                </View>
                <View style={s.grid}>{celdas}</View>
            </View>
        );
    }

    const renderPanel = () => {
        if (!panelDia || !panelData) return null;
        const { d, mIdx } = panelDia;
        const { libran, trabajan } = panelData;
        return (
            <Animated.View style={[s.panel, { transform: [{ translateX: panelAnim }] }]}>
                <View style={s.panelHeader}>
                    <Text style={s.panelTitulo}>{d} {mesesArr[mIdx]} {anio}</Text>
                    <TouchableOpacity onPress={cerrarPanel}><Text style={s.panelCerrar}>✕</Text></TouchableOpacity>
                </View>
                <ScrollView>
                    <Text style={[s.panelSeccion, { color: '#ef4444' }]}>🏠 LIBRAN ({libran.length})</Text>
                    {libran.length ? libran.map(p => (
                        <View key={p.id} style={s.panelFila}>
                            <Text style={s.panelNombre}>{p.n}</Text>
                            <Text style={s.panelSub}>G{p.g} · {p.t}</Text>
                        </View>
                    )) : <Text style={s.panelVacio}>Ninguno</Text>}
                    <Text style={[s.panelSeccion, { color: '#3b82f6', marginTop: 12 }]}>🚌 TRABAJAN ({trabajan.length})</Text>
                    {trabajan.length ? trabajan.map(p => (
                        <View key={p.id} style={s.panelFila}>
                            <Text style={s.panelNombre}>{p.n}</Text>
                            <Text style={s.panelSub}>G{p.g} · {p.t}</Text>
                        </View>
                    )) : <Text style={s.panelVacio}>Ninguno</Text>}
                </ScrollView>
            </Animated.View>
        );
    };

    const renderMenu = () => {
        if (!menuDia) return null;
        const { d, mIdx } = menuDia;
        const opciones = [
            { label: '✨ Generado', tipo: 'generado', color: '#be185d' },
            { label: '📋 Convenio', tipo: 'convenio', color: '#1d4ed8' },
            { label: '⏳ Pendiente', tipo: 'pendiente', color: '#6b21a8' },
            { label: '🟡 L-26', tipo: 'l26', color: '#b45309' },
            { label: '🌴 Vacaciones', tipo: 'vacaciones', color: '#166534' },
            { label: '🎁 Libre sin compensación', tipo: 'libreGracioso', color: '#0891b2' },
            { label: '🔄 Cambio propio', tipo: 'propio', color: '#1d4ed8' },
            ...(sesion.modoGrupo ? [{ label: '👥 Cambio con compañero', tipo: 'companero', color: '#7c3aed' }] : []),
            { label: '📝 Mis notas', tipo: 'nota', color: '#0891b2' },
            { label: '🗑️ Borrar cambio', tipo: 'borrar', color: '#94a3b8' },
        ];
        return (
            <Modal transparent animationType="fade" onRequestClose={() => setMenuDia(null)}>
                <TouchableOpacity style={s.overlay} onPress={() => setMenuDia(null)} activeOpacity={1}>
                    <View style={s.menu}>
                        <Text style={s.menuTitulo}>📅 {d} de {mesesArr[mIdx]} {anio}</Text>
                        {opciones.map(op => (
                            <TouchableOpacity key={op.tipo} style={s.menuItem} onPress={() => aplicarCambio(op.tipo, d, mIdx)}>
                                <Text style={[s.menuItemTexto, { color: op.color }]}>{op.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            </Modal>
        );
    };

    const renderModalCompaneros = () => {
        if (!modalCompaneros) return null;
        const companeros = (equipoActual || []).filter(c => c.id !== sesion.miID);
        return (
            <Modal transparent animationType="slide" onRequestClose={() => setModalCompaneros(null)}>
                <View style={s.overlay}>
                    <View style={[s.menu, { maxHeight: '70%' }]}>
                        <Text style={s.menuTitulo}>👥 Elige compañero</Text>
                        <Text style={s.menuSubTitulo}>Día A: {modalCompaneros.diaA}/{modalCompaneros.mIdxA + 1}/{anio}</Text>
                        <FlatList
                            data={companeros}
                            keyExtractor={item => item.id}
                            renderItem={({ item }) => (
                                <TouchableOpacity style={s.menuItem} onPress={() => {
                                    setModalCompaneros(null);
                                    navigation.navigate('CalendarioCompanero', { 
                                        uid: item.id,
                                        modoCambio: {
                                            diaA: modalCompaneros.diaA,
                                            mIdxA: modalCompaneros.mIdxA,
                                            miID: sesion.miID,
                                            miNom: sesion.miNombreCompleto.split(' ')[0]
                                        }
                                    });
                                }}>
                                    <Text style={[s.menuItemTexto, { color: '#1e1b4b' }]}>{item.n}</Text>
                                    <Text style={{ fontSize: 12, color: '#94a3b8' }}>G{item.g} · {item.t}</Text>
                                </TouchableOpacity>
                            )}
                        />
                        <TouchableOpacity style={[s.menuItem, { marginTop: 8 }]} onPress={() => setModalCompaneros(null)}>
                            <Text style={[s.menuItemTexto, { color: '#94a3b8' }]}>Cancelar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        );
    };

    // Marca el día como "generado" en el calendario y crea la tarjeta correspondiente en
    // Historial, con el motivo que escriba la persona. Para usarlo más tarde en otro día, se
    // hace igual que con cualquier generado: tocando ese otro día y eligiendo "Usar".
    async function confirmarGenerarManual() {
        if (!modalGenerarManual) return;
        const { d, mIdx, texto } = modalGenerarManual;
        const fechaTxt = `${d}/${mIdx + 1}/${anio}`;
        const keyDia = claveDia(anio, mIdx, d);
        const hRef = push(ref(db, 'historial2/' + sesion.miID));
        await set(hRef, {
            cat: 'generado', subtipo: 'manual',
            ts: Date.now(), fecha: fechaTxt,
            nota: texto.trim() || 'Generado manual', usado: false,
            diaKey: keyDia
        });
        await set(ref(db, 'cambios/' + sesion.miID + '/' + keyDia), {
            clase: 'b-generado', texto: texto.trim() || 'Generado', histKey: hRef.key
        });
        setModalGenerarManual(null);
        Alert.alert('✅ Generado', `Se ha creado el día generado del ${d}/${mIdx + 1}. Podrás usarlo cuando quieras desde Historial.`);
    }

    async function guardarNota() {
        if (!modalNota) return;
        const { d, mIdx, texto } = modalNota;
        const key = claveDiaActual(notas, anio, mIdx, d);
        if (texto.trim() === '') {
            await remove(ref(db, 'notas/' + sesion.miID + '/' + key));
        } else {
            await set(ref(db, 'notas/' + sesion.miID + '/' + claveDia(anio, mIdx, d)), {
                texto: texto.trim(), fecha: `${d}/${mIdx + 1}`, ts: Date.now()
            });
            // Si la nota estaba guardada con la clave vieja, la borramos para no dejar un duplicado
            if (key !== claveDia(anio, mIdx, d)) {
                await remove(ref(db, 'notas/' + sesion.miID + '/' + key));
            }
        }
        setModalNota(null);
    }

    async function borrarNota() {
        if (!modalNota) return;
        const { d, mIdx } = modalNota;
        const key = claveDiaActual(notas, anio, mIdx, d);
        await remove(ref(db, 'notas/' + sesion.miID + '/' + key));
        setModalNota(null);
    }

    const renderModalGenerarManual = () => {
        if (!modalGenerarManual) return null;
        return (
            <Modal transparent animationType="fade" onRequestClose={() => setModalGenerarManual(null)}>
                <View style={s.overlay}>
                    <View style={s.menu}>
                        <Text style={s.menuTitulo}>✨ Generar — {modalGenerarManual.d}/{modalGenerarManual.mIdx + 1}</Text>
                        <TextInput
                            style={s.notaInput}
                            multiline
                            maxLength={250}
                            placeholder="Motivo (por ejemplo: me lo debe Fulanito, trabajé un día que no era mío...)"
                            value={modalGenerarManual.texto}
                            onChangeText={(t) => setModalGenerarManual({ ...modalGenerarManual, texto: t })}
                        />
                        <Text style={s.notaContador}>{modalGenerarManual.texto.length}/250</Text>
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                            <TouchableOpacity style={s.btnCancelarNota} onPress={() => setModalGenerarManual(null)}>
                                <Text style={s.btnCancelarNotaTexto}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnGuardarNota} onPress={confirmarGenerarManual}>
                                <Text style={s.btnGuardarNotaTexto}>Generar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        );
    };

    const renderModalNota = () => {
        if (!modalNota) return null;
        return (
            <Modal transparent animationType="fade" onRequestClose={() => setModalNota(null)}>
                <View style={s.overlay}>
                    <View style={s.menu}>
                        <Text style={s.menuTitulo}>📝 Nota — {modalNota.d}/{modalNota.mIdx + 1}</Text>
                        <TextInput
                            style={s.notaInput}
                            multiline
                            maxLength={250}
                            placeholder="Escribe tu nota aquí..."
                            value={modalNota.texto}
                            onChangeText={(t) => setModalNota({ ...modalNota, texto: t })}
                        />
                        <Text style={s.notaContador}>{modalNota.texto.length}/250</Text>
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                            <TouchableOpacity style={s.btnCancelarNota} onPress={() => setModalNota(null)}>
                                <Text style={s.btnCancelarNotaTexto}>Cancelar</Text>
                            </TouchableOpacity>
                            {modalNota.texto.length > 0 && (
                                <TouchableOpacity style={s.btnBorrarNota} onPress={borrarNota}>
                                    <Text style={s.btnBorrarNotaTexto}>🗑️</Text>
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity style={s.btnGuardarNota} onPress={guardarNota}>
                                <Text style={s.btnGuardarNotaTexto}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        );
    };

    function getDiasEnMesLocal(mIdx) {
        return new Date(anio, mIdx + 1, 0).getDate();
    }

    async function confirmarVacaciones() {
        if (!modalVacaciones) return;
        const { diaIni, mIdxIni, diaFin, mIdxFin } = modalVacaciones;

        if (diaIni === '' || diaFin === '') {
            Alert.alert('⚠️ Falta un día', 'Rellena el día de inicio y el día de fin.');
            return;
        }

        const fechaIni = new Date(anio, mIdxIni, diaIni);
        const fechaFin = new Date(anio, mIdxFin, diaFin);

        if (fechaFin < fechaIni) {
            Alert.alert('⚠️ Fecha incorrecta', 'La fecha fin debe ser posterior o igual a la fecha de inicio.');
            return;
        }

        const dias = [];
        let f = new Date(fechaIni);
        while (f <= fechaFin) {
            dias.push({ d: f.getDate(), mIdx: f.getMonth(), anio: f.getFullYear() });
            f.setDate(f.getDate() + 1);
        }

        setModalVacaciones(null);

        for (const dia of dias) {
            await set(ref(db, 'cambios/' + sesion.miID + '/' + claveDia(dia.anio, dia.mIdx, dia.d)), {
                clase: 'b-vac', texto: 'Vacaciones'
            });
        }

        await generarFestivosDeRango(diaIni, mIdxIni, diaFin, mIdxFin);

        const hoy = new Date();
        hoy.setHours(0,0,0,0);
        if (hoy >= fechaFin) {
            const cambiosConNuevos = { ...cambios };
            for (const dia of dias) {
                cambiosConNuevos[claveDia(dia.anio, dia.mIdx, dia.d)] = { clase: 'b-vac' };
            }
            const fechaFinTexto = `${diaFin}/${mIdxFin + 1}/${anio}`;
            await checkVacacionesGenerados(null, null, cambiosConNuevos, fechaFinTexto);
        }
        Alert.alert('✅ Listo', `${dias.length} días marcados como vacaciones.`);
    }

    const renderModalVacaciones = () => {
        if (!modalVacaciones) return null;
        const { diaIni, mIdxIni, diaFin, mIdxFin } = modalVacaciones;
        return (
            <Modal transparent animationType="fade" onRequestClose={() => setModalVacaciones(null)}>
                <KeyboardAvoidingView
                    style={s.overlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} keyboardShouldPersistTaps="handled">
                    <View style={s.menu}>
                        <Text style={s.menuTitulo}>🌴 Periodo de vacaciones</Text>

                        <Text style={s.vacLabel}>Fecha inicio</Text>
                        <View style={s.vacRow}>
                            <TextInput
                                style={s.vacDiaInput}
                                keyboardType="numeric"
                                maxLength={2}
                                value={String(diaIni)}
                                onChangeText={(t) => {
                                    const digitos = t.replace(/[^0-9]/g, '');
                                    if (digitos === '') {
                                        setModalVacaciones({ ...modalVacaciones, diaIni: '' });
                                        return;
                                    }
                                    const n = parseInt(digitos);
                                    const max = getDiasEnMesLocal(mIdxIni);
                                    setModalVacaciones({ ...modalVacaciones, diaIni: Math.min(Math.max(n, 1), max) });
                                }}
                            />
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.vacMesesScroll}>
                                {mesesArr.map((m, i) => (
                                    <TouchableOpacity key={i} style={[s.vacMesBtn, mIdxIni === i && s.vacMesBtnActive]} onPress={() => {
                                        const max = new Date(anio, i + 1, 0).getDate();
                                        setModalVacaciones({ ...modalVacaciones, mIdxIni: i, diaIni: Math.min(diaIni || 1, max) });
                                    }}>
                                        <Text style={[s.vacMesTexto, mIdxIni === i && s.vacMesTextoActive]}>{m.slice(0,3)}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        <Text style={s.vacLabel}>Fecha fin</Text>
                        <View style={s.vacRow}>
                            <TextInput
                                style={s.vacDiaInput}
                                keyboardType="numeric"
                                maxLength={2}
                                value={String(diaFin)}
                                onChangeText={(t) => {
                                    const digitos = t.replace(/[^0-9]/g, '');
                                    if (digitos === '') {
                                        setModalVacaciones({ ...modalVacaciones, diaFin: '' });
                                        return;
                                    }
                                    const n = parseInt(digitos);
                                    const max = getDiasEnMesLocal(mIdxFin);
                                    setModalVacaciones({ ...modalVacaciones, diaFin: Math.min(Math.max(n, 1), max) });
                                }}
                            />
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.vacMesesScroll}>
                                {mesesArr.map((m, i) => (
                                    <TouchableOpacity key={i} style={[s.vacMesBtn, mIdxFin === i && s.vacMesBtnActive]} onPress={() => {
                                        const max = new Date(anio, i + 1, 0).getDate();
                                        setModalVacaciones({ ...modalVacaciones, mIdxFin: i, diaFin: Math.min(diaFin || 1, max) });
                                    }}>
                                        <Text style={[s.vacMesTexto, mIdxFin === i && s.vacMesTextoActive]}>{m.slice(0,3)}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                            <TouchableOpacity style={s.btnCancelarNota} onPress={() => setModalVacaciones(null)}>
                                <Text style={s.btnCancelarNotaTexto}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[s.btnGuardarNota, { backgroundColor: '#16a34a' }]} onPress={confirmarVacaciones}>
                                <Text style={s.btnGuardarNotaTexto}>Confirmar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </Modal>
        );
    };

    return (
        <View style={s.container}>
            {!isConnected && (
                <View style={s.bannerSinConexion}>
                    <Text style={s.bannerSinConexionTexto}>⚠️ Sin conexión a internet</Text>
                </View>
            )}
            {solicitudPendiente && (
                <View style={s.bannerSeleccion}>
                    <Text style={s.bannerTexto}>📤 Esperando respuesta de {solicitudPendiente.compNom}...</Text>
                    <TouchableOpacity onPress={() => {
                        remove(ref(db, 'solicitudes/' + solicitudPendiente.solKey));
                        setSolicitudPendiente(null);
                    }}>
                        <Text style={s.bannerCancelar}>Cancelar</Text>
                    </TouchableOpacity>
                </View>
            )}
            {modoGenerado && (
                <View style={s.bannerSeleccion}>
                    <Text style={s.bannerTexto}>
                        {modoGenerado.tipo === 'convenio' ? '📋' : modoGenerado.tipo === 'pendiente' ? '⏳' : modoGenerado.tipo === 'l26' ? '🟡' : '✨'} Pulsa el día que quieres librar
                    </Text>
                    <TouchableOpacity onPress={() => setModoGenerado(null)}>
                        <Text style={s.bannerCancelar}>Cancelar</Text>
                    </TouchableOpacity>
                </View>
            )}
            {modoSeleccion && (
                <View style={s.bannerSeleccion}>
                    <Text style={s.bannerTexto}>
                        {modoSeleccion.tipo === 'propio'
                            ? `🔄 Día A: ${modoSeleccion.diaA}/${modoSeleccion.mIdxA + 1} — Pulsa el día B`
                            : `👥 Día A: ${modoSeleccion.diaA}/${modoSeleccion.mIdxA + 1} — Pulsa el día del compañero`}
                    </Text>
                    <TouchableOpacity onPress={() => setModoSeleccion(null)}>
                        <Text style={s.bannerCancelar}>Cancelar</Text>
                    </TouchableOpacity>
                </View>
            )}
            <View style={s.header}>
                <Text style={s.titulo}>📅 Turnos</Text>
                <Text style={s.sub}>{sesion.miNombreCompleto} · Grupo {grupo}</Text>
                <View style={s.anioNav}>
                    <TouchableOpacity onPress={() => { setAnio(anio - 1); scrollRef.current?.scrollToOffset({ offset: 0, animated: false }); }} style={s.anioBtn}>
                        <Text style={s.anioBtnTexto}>◀</Text>
                    </TouchableOpacity>
                    <Text style={s.anioTexto}>{anio}</Text>
                    <TouchableOpacity onPress={() => { setAnio(anio + 1); scrollRef.current?.scrollToOffset({ offset: 0, animated: false }); }} style={s.anioBtn}>
                        <Text style={s.anioBtnTexto}>▶</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <FlatList
                ref={scrollRef}
                data={mesesArr}
                keyExtractor={(_, i) => 'mes_' + i}
                renderItem={({ index }) => renderMes(index)}
                showsVerticalScrollIndicator={false}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={5}
                removeClippedSubviews={true}
                getItemLayout={(data, index) => layoutsMeses[index]}
                initialScrollIndex={new Date().getMonth()}
            />
            {panelDia && (
                <TouchableOpacity style={s.overlay2} onPress={cerrarPanel} activeOpacity={1} />
            )}
            {renderPanel()}
            {renderMenu()}
            {renderModalCompaneros()}
            {renderModalNota()}
            {renderModalGenerarManual()}
            {renderModalVacaciones()}
        </View>
    );
}

function getStyles(theme) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.fondo },
        bannerSinConexion: { backgroundColor: '#ef4444', paddingVertical: 8, alignItems: 'center' }, // añadido
        bannerSinConexionTexto: { color: '#fff', fontWeight: '700', fontSize: 13 }, // añadido
        header: { backgroundColor: theme.headerFondo, padding: 16, paddingTop: 50 },
        titulo: { fontSize: 20, fontWeight: '900', color: theme.headerTexto },
        sub: { fontSize: 12, color: theme.headerSub, marginTop: 2 },
        anioNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
        anioBtn: { backgroundColor: theme.isDark ? '#2e2a4a' : '#312e81', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6 },
        anioBtnTexto: { color: theme.headerTexto, fontSize: 16, fontWeight: '900' },
        anioTexto: { color: '#ffffff', fontSize: 18, fontWeight: '900', marginHorizontal: 20 },
        mesCard: { backgroundColor: theme.card, margin: 12, borderRadius: 16, padding: 12, elevation: 2 },
        mesNombre: { fontSize: 16, fontWeight: '800', color: theme.texto, marginBottom: 8, textAlign: 'center' },
        diasHeader: { flexDirection: 'row', marginBottom: 4 },
        diaLetra: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: theme.textoTenue },
        grid: { flexDirection: 'row', flexWrap: 'wrap' },
        celda: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 6, marginVertical: 1 },
        diaNum: { fontSize: 13 },
        hoyDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#7c3aed', marginTop: 1 },
        bannerSeleccion: { backgroundColor: '#7c3aed', padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        bannerTexto: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
        bannerCancelar: { color: '#fbbf24', fontSize: 12, fontWeight: '900', marginLeft: 8 },
        panel: { position: 'absolute', top: 0, bottom: 0, width: PANEL_W, backgroundColor: theme.card, elevation: 10, padding: 16, paddingTop: 50 },
        panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
        panelTitulo: { fontSize: 16, fontWeight: '900', color: theme.texto },
        panelCerrar: { fontSize: 20, color: theme.textoTenue, fontWeight: '700' },
        panelSeccion: { fontSize: 12, fontWeight: '800', marginBottom: 6 },
        panelFila: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.borde },
        panelNombre: { fontSize: 13, color: theme.texto, fontWeight: '600' },
        panelSub: { fontSize: 12, color: theme.textoTenue },
        panelVacio: { fontSize: 12, color: theme.textoTenue, fontStyle: 'italic' },
        overlay2: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' },
        overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
        menu: { backgroundColor: theme.card, borderRadius: 20, padding: 20, width: SW * 0.85 },
        menuTitulo: { fontSize: 16, fontWeight: '900', color: theme.texto, marginBottom: 4, textAlign: 'center' },
        menuSubTitulo: { fontSize: 12, color: theme.textoTenue, textAlign: 'center', marginBottom: 12 },
        menuItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.borde },
        menuItemTexto: { fontSize: 15, fontWeight: '700' },
        notaInput: { borderWidth: 2, borderColor: '#bae6fd', borderRadius: 12, padding: 12, fontSize: 14, color: theme.texto, minHeight: 100, textAlignVertical: 'top' },
        notaContador: { textAlign: 'right', fontSize: 11, color: theme.textoTenue, marginTop: 4 },
        btnCancelarNota: { flex: 1, backgroundColor: theme.isDark ? '#2e2a4a' : '#f1f5f9', borderRadius: 10, padding: 12, alignItems: 'center' },
        btnCancelarNotaTexto: { color: theme.textoSecundario, fontWeight: '700' },
        btnBorrarNota: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 12, paddingHorizontal: 16, alignItems: 'center' },
        btnBorrarNotaTexto: { fontSize: 16 },
        btnGuardarNota: { flex: 1, backgroundColor: '#0891b2', borderRadius: 10, padding: 12, alignItems: 'center' },
        btnGuardarNotaTexto: { color: '#fff', fontWeight: '700' },
        notaDot: { position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: '#7dd3fc' },
        vacLabel: { fontSize: 12, fontWeight: '700', color: theme.textoSecundario, marginTop: 12, marginBottom: 6 },
        vacSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.isDark ? '#16331f' : '#f0fdf4', borderRadius: 12, padding: 10 },
        vacBtn: { backgroundColor: '#16a34a', borderRadius: 8, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
        vacBtnTexto: { color: '#fff', fontWeight: '900', fontSize: 16 },
        vacFechaTexto: { fontSize: 15, fontWeight: '800', color: theme.isDark ? '#4ade80' : '#166534' },
        vacRow: { gap: 8 },
        vacDiaInput: { width: 50, height: 44, borderWidth: 2, borderColor: '#16a34a', borderRadius: 10, textAlign: 'center', fontSize: 16, fontWeight: '800', color: theme.isDark ? '#4ade80' : '#166534' },
        vacMesesScroll: { flexGrow: 0 },
        vacMesBtn: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8, backgroundColor: theme.isDark ? '#16331f' : '#f0fdf4', marginRight: 4 },
        vacMesBtnActive: { backgroundColor: '#16a34a' },
        vacMesTexto: { fontSize: 12, fontWeight: '700', color: theme.isDark ? '#4ade80' : '#166534' },
        vacMesTextoActive: { color: '#fff' },
    });
}