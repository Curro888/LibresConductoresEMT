import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Modal, Alert, Dimensions, TextInput, BackHandler
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../config/firebase';
import { ref, onValue, push, set, remove, update, get } from 'firebase/database';
import { mesesArr, equipoBase, getDiasLibres, MAX_LIBRES_VAC, esFestivo, claveDia, claveDiaVieja, leerDia, partesDia, claveDiaActual } from '../config/datos';
import { useTheme } from '../context/ThemeContext';

const { width: SW } = Dimensions.get('window');

export default function HistorialScreen({ navigation, route }) {
    const { theme } = useTheme();
    const [sesion, setSesion] = useState(null);
    const [cambios, setCambios] = useState({});
    const [historial, setHistorial] = useState({});
    const [notas, setNotas] = useState({});
    const [modalAdd, setModalAdd] = useState(false);
    const [modalUsar, setModalUsar] = useState(null);
       const [modalEditarNota, setModalEditarNota] = useState(null); // {key, texto}
    const [modalForm, setModalForm] = useState(null); // {tipo, fecha, esLibre, nota}
    const [tab, setTab] = useState(route?.params?.tabInicial || null); // null = portada
    const [enPortada, setEnPortada] = useState(!route?.params?.tabInicial);
    const procesandoFestivos = useRef(false);

    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (!enPortada) { setEnPortada(true); return true; }
            return false;
        });
        return () => handler.remove();
    }, [enPortada]);

    useEffect(() => {
        if (route?.params?.tabInicial) {
            setTab(route.params.tabInicial);
            setEnPortada(false);
        } else {
            setTab(null);
            setEnPortada(true);
        }
    }, [route?.params?.tabInicial, route?.params?.diaOrigen]);

    const diaOrigen = route?.params?.diaOrigen || null;

    useFocusEffect(
        useCallback(() => {
            return () => {
                // Al salir de Historial, limpiar diaOrigen para que no se quede pegado
                navigation.setParams({ diaOrigen: null });
            };
        }, [])
    );

    useEffect(() => {
        let unsubCambios, unsubHistorial, unsubNotas;
        async function cargar() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (raw) {
                const s = JSON.parse(raw);
                setSesion(s);
                unsubCambios = onValue(ref(db, 'cambios/' + s.miID), snap => setCambios(snap.val() || {}));
                unsubHistorial = onValue(ref(db, 'historial2/' + s.miID), snap => setHistorial(snap.val() || {}));
                unsubNotas = onValue(ref(db, 'notas/' + s.miID), snap => setNotas(snap.val() || {}));
            }
        }
        cargar();
        return () => {
            if (unsubCambios) unsubCambios();
            if (unsubHistorial) unsubHistorial();
            if (unsubNotas) unsubNotas();
        };
    }, []);

    // Comprobar si hoy es el último día de un tramo de vacaciones y generar el exceso
    useEffect(() => {
        if (!sesion || Object.keys(cambios).length === 0) return;
        checkVacacionesGenerados();
        checkFestivosPendientes();
    }, [sesion, cambios, historial]);

    // Recorre todos los festivos del año hasta hoy y genera los que todavía falten. Así, si
    // un día no se ha podido abrir la app (sin cobertura, ocupado, etc.), el festivo se genera
    // igualmente en cuanto se vuelva a entrar, sin perder nada — igual que con las vacaciones.
    async function checkFestivosPendientes() {
        if (procesandoFestivos.current) return; // ya se está ejecutando, no lo dupliques
        procesandoFestivos.current = true;
        try {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const anioHoy = hoy.getFullYear();

            // Leemos el historial DIRECTAMENTE de Firebase (no el que tenemos en memoria, que
            // podía quedarse desactualizado a mitad de proceso y provocar duplicados) y
            // escribimos todos los festivos que falten en un único paso, no uno a uno.
            const snap = await get(ref(db, 'historial2/' + sesion.miID));
            const historialActual = snap.val() || {};
            const fechasExistentes = new Set(
                Object.values(historialActual)
                    .filter(h => h && (h.subtipo === 'festivo_auto' || h.subtipo === 'festivo'))
                    .map(h => {
                        // Normalizamos a "d/m", tenga año la fecha guardada o no
                        const partes = String(h.fecha).split('/');
                        return partes[0] + '/' + partes[1];
                    })
            );

            // Festivos que la persona ya borró a propósito alguna vez: no se vuelven a generar.
            const snapDescartados = await get(ref(db, 'festivosDescartados/' + sesion.miID));
            const descartados = new Set(Object.keys(snapDescartados.val() || {}));

            const updates = {};
            let f = new Date(anioHoy, 0, 1);
            while (f <= hoy) {
                const mIdx = f.getMonth(), d = f.getDate();
                if (esFestivo(anioHoy, mIdx, d)) {
                    // Si ese día ya estabas de vacaciones, no generamos aquí un día "trabajado" de
                    // más: el festivo dentro de vacaciones ya lo cubre generarFestivosDeRango.
                    const cambioDia = leerDia(cambios, anioHoy, mIdx, d);
                    if (cambioDia && cambioDia.clase === 'b-vac') {
                        f.setDate(f.getDate() + 1);
                        continue;
                    }

                    // Si esta fecha la borraste tú a propósito antes, la respetamos y no la recreamos.
                    if (descartados.has(`${anioHoy}_${mIdx + 1}_${d}`)) {
                        f.setDate(f.getDate() + 1);
                        continue;
                    }

                    const dm = d + '/' + (mIdx + 1);
                    if (!fechasExistentes.has(dm)) {
                        const fechaTxt = `${d}/${mIdx + 1}/${anioHoy}`;
                        const nuevaKey = push(ref(db, 'historial2/' + sesion.miID)).key;
                        updates[nuevaKey] = {
                            cat: 'generado', subtipo: 'festivo_auto',
                            ts: Date.now(), fecha: fechaTxt,
                            nota: 'Festivo trabajado/librado', usado: false
                        };
                        fechasExistentes.add(dm); // no añadir el mismo día dos veces en este repaso
                    }
                }
                f.setDate(f.getDate() + 1);
            }

            if (Object.keys(updates).length > 0) {
                await update(ref(db, 'historial2/' + sesion.miID), updates);
            }
        } finally {
            procesandoFestivos.current = false;
        }
    }

    async function checkVacacionesGenerados() {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const anioHoy = hoy.getFullYear();

        // En vez de exigir que hoy sea EXACTAMENTE el último día de vacaciones (lo cual se
        // perdía si no abrías la app justo ese día), comprobamos algo más robusto: si hay
        // algún día de vacaciones ya pasado. Así, aunque no hayas abierto la app el día exacto,
        // se calcula en cuanto vuelvas a entrar — no se pierde nada.
        const hayVacacionYaPasada = Object.entries(cambios).some(([key, c]) => {
            if (!c || c.clase !== 'b-vac') return false;
            const { anio: anioClave, mIdx, dia: d } = partesDia(key);
            if (anioClave !== anioHoy) return false; // solo nos interesan las vacaciones de este año
            const fecha = new Date(anioHoy, mIdx, d);
            fecha.setHours(0, 0, 0, 0);
            return fecha < hoy;
        });
        if (!hayVacacionYaPasada) return;

        // Calculamos el exceso de TODO el año, contando todos los días de vacaciones marcados
        const p = (equipoBase || []).find(x => x.id === sesion.miID);
        const grupo = p ? p.g : sesion.miGrupoSesion;
        const turno = p ? p.t : sesion.miTipoSesion;
        const diasLibresBase = getDiasLibres(anioHoy, grupo, turno) || {};

        let totalLibresEnVac = 0;
        Object.entries(cambios).forEach(([key, c]) => {
            if (c && c.clase === 'b-vac') {
                const { anio: anioClave, mIdx, dia: d } = partesDia(key);
                if (anioClave !== anioHoy) return; // solo el año en curso
                if (esFestivo(anioHoy, mIdx, d)) return; // festivos no cuentan aquí, se generan aparte
                if ((diasLibresBase[mIdx] || []).includes(d)) totalLibresEnVac++;
            }
        });
        const exceso = Math.max(0, totalLibresEnVac - MAX_LIBRES_VAC);

        const yaGenerados = Object.entries(historial).filter(([, h]) => h.subtipo === 'exceso_vac' && h.anio === anioHoy);

        if (exceso > yaGenerados.length) {
            const faltan = exceso - yaGenerados.length;
            for (let i = 0; i < faltan; i++) {
                const nuevoRef = push(ref(db, 'historial2/' + sesion.miID));
                               await set(nuevoRef, {
                    cat: 'generado', subtipo: 'exceso_vac', anio: anioHoy,
                    ts: Date.now(), fecha: `${hoy.getDate()}/${hoy.getMonth() + 1}/${anioHoy}`,
                    nota: 'Exceso de libres en vacaciones', usado: false
                });
            }
        } else if (exceso < yaGenerados.length) {
            const sobran = yaGenerados.length - exceso;
            const noUsados = yaGenerados.filter(([, h]) => !h.usado);
            for (let i = 0; i < Math.min(sobran, noUsados.length); i++) {
                await remove(ref(db, 'historial2/' + sesion.miID + '/' + noUsados[i][0]));
            }
        }
    }

    function añadirManual(tipo) {
        setModalAdd(false);
        setModalForm({ tipo, fecha: '', esLibre: true, nota: '' });
    }

    function añadirPendiente() {
        setModalForm({ tipo: 'pendiente', fecha: '', nota: '' });
    }

    async function guardarDesdeFormulario() {
        if (!modalForm) return;
        const fecha = (modalForm.fecha || '').trim();
        if (!fecha) { Alert.alert('Falta la fecha', 'Introduce una fecha, por ejemplo 15/3/2027'); return; }
        try {
            const nuevoRef = push(ref(db, 'historial2/' + sesion.miID));
            if (modalForm.tipo === 'l26') {
                await set(nuevoRef, {
                    cat: 'l26', subtipo: 'manual',
                    ts: Date.now(), fecha,
                    nota: modalForm.nota?.trim() || 'L-26', usado: false
                });
            } else if (modalForm.tipo === 'pendiente') {
                await set(nuevoRef, {
                    cat: 'pendiente', subtipo: 'manual',
                    ts: Date.now(), fecha,
                    nota: modalForm.nota?.trim() || 'Día pendiente', usado: false
                });
            } else {
                const datosGuardar = {
                    cat: 'generado',
                    subtipo: modalForm.tipo === 'convenio' ? 'convenio' : 'manual',
                    ts: Date.now(), fecha,
                    nota: modalForm.nota?.trim() || (modalForm.tipo === 'convenio' ? 'Convenio' : 'Generado manual'),
                    usado: false
                };
                if (modalForm.tipo !== 'convenio') {
                    datosGuardar.esLibre = !!modalForm.esLibre;
                }
                await set(nuevoRef, datosGuardar);
            }
            setModalForm(null);
        } catch (err) {
            Alert.alert('Error al guardar', err.message);
        }
    }

    const [modalConfirmar, setModalConfirmar] = useState(null);

    async function usarDirectoEnDia(key, item) {
        if (!diaOrigen) return;
        setModalConfirmar({ key, diaOrigen });
    }

    async function confirmarUsoDirecto() {
        if (!modalConfirmar) return;
        const { key, diaOrigen: dO } = modalConfirmar;
        const { d, mIdx, miID } = dO;
        const anioOrigen = dO.anio || 2026; // por si viene de una versión antigua sin año
        const diaKey = claveDia(anioOrigen, mIdx, d);
        setModalConfirmar(null);
        await set(ref(db, 'cambios/' + miID + '/' + diaKey), {
            clase: 'b-cambio-libre', texto: 'Librado', histKey: key
        });
        await update(ref(db, 'historial2/' + miID + '/' + key), {
            usado: true, accion: 'librar', diaAsignado: diaKey
        });
        navigation.setParams({ diaOrigen: null, tabInicial: null });
        navigation.navigate('Turnos');
    }

    async function accionUsar(accion) {
        if (!modalUsar) return;
        const { key, item } = modalUsar;
        setModalUsar(null);
        if (accion === 'cobrar') {
            await update(ref(db, 'historial2/' + sesion.miID + '/' + key), { usado: true, accion: 'cobrado' });
        } else if (accion === 'librar' || accion === 'usar') {
            const tipo = item.subtipo === 'convenio' ? 'convenio' : (item.cat === 'pendiente' ? 'pendiente' : item.cat === 'l26' ? 'l26' : 'generado');
            await AsyncStorage.setItem('modoGenerado', JSON.stringify({ histKey: key, tipo, miID: sesion.miID }));
            navigation.navigate('Turnos');
        }
    }

    async function guardarNotaEditada() {
        if (!modalEditarNota) return;
        const { key, texto } = modalEditarNota;
        await update(ref(db, 'historial2/' + sesion.miID + '/' + key), { nota: texto.trim() });
        setModalEditarNota(null);
    }

    async function borrarItem(key, item) {
        const esAutomatico = item.subtipo === 'festivo_auto' || item.subtipo === 'exceso_vac';
        const esL26 = item.cat === 'l26';

        if (esL26) {
            Alert.alert('🟡 L-26', '¿Qué quieres hacer?', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Borrar solo el cambio', onPress: async () => {
                    // Borra el día del calendario pero la tarjeta queda disponible
                    if (item.diaAsignado) {
                        await remove(ref(db, 'cambios/' + sesion.miID + '/' + item.diaAsignado));
                    }
                    await update(ref(db, 'historial2/' + sesion.miID + '/' + key), {
                        usado: false, accion: null, diaAsignado: null
                    });
                }},
                { text: 'Borrar día L-26', style: 'destructive', onPress: async () => {
                    // Borra el día del calendario Y la tarjeta del historial
                    if (item.diaAsignado) {
                        await remove(ref(db, 'cambios/' + sesion.miID + '/' + item.diaAsignado));
                    }
                    if (item.diaKey) {
                        await remove(ref(db, 'cambios/' + sesion.miID + '/' + item.diaKey));
                    }
                    await remove(ref(db, 'historial2/' + sesion.miID + '/' + key));
                }},
            ]);
            return;
        }

        Alert.alert('🗑️ Borrar', '¿Seguro? Si tiene un día asignado, se deshará el cambio en el calendario.', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Borrar', style: 'destructive', onPress: async () => {
                if (item.diaAsignado) {
                    await remove(ref(db, 'cambios/' + sesion.miID + '/' + item.diaAsignado));
                }
                if (item.diaKey) {
                    await remove(ref(db, 'cambios/' + sesion.miID + '/' + item.diaKey));
                }
                await remove(ref(db, 'historial2/' + sesion.miID + '/' + key));

                // Si era un festivo generado automáticamente, recordamos que se borró a propósito,
                // para que la comprobación automática no lo vuelva a crear la próxima vez.
                if (item.subtipo === 'festivo_auto' || item.subtipo === 'festivo') {
                    const claveFecha = normalizarFechaFestivo(item.fecha);
                    if (claveFecha) {
                        await set(ref(db, 'festivosDescartados/' + sesion.miID + '/' + claveFecha), true);
                    }
                }
            }}
        ]);
    }

    // Convierte una fecha guardada ("d/m/año" o "d/m") en una clave estable tipo "anio_mes_dia",
    // para poder recordar de forma fiable qué festivos ha borrado la persona a propósito.
    function normalizarFechaFestivo(fecha) {
        const partes = String(fecha).split('/');
        const dia = parseInt(partes[0]);
        const mes = parseInt(partes[1]);
        const anio = parseInt(partes[2]) || 2026;
        if (isNaN(dia) || isNaN(mes)) return null;
        return `${anio}_${mes}_${dia}`;
    }

    // Convierte una fecha "d/m" a la clave de calendario. Si se le pasa el año (tarjetas
    // nuevas), usa la clave con año. Si no (tarjetas antiguas, de antes de esta actualización),
    // usa la clave vieja, que es la que se guardó en su momento para esos días.
    function fechaAKey(fecha, anio) {
        if (!fecha) return null;
        const partes = fecha.split('/');
        if (partes.length < 2) return null;
        const d = parseInt(partes[0]);
        const m = parseInt(partes[1]);
        if (isNaN(d) || isNaN(m)) return null;
        return anio ? claveDia(anio, m - 1, d) : claveDiaVieja(m - 1, d);
    }

    // Borra un cambio con compañero completo: las 2 tarjetas de historial (mía y la suya)
    // y los 4 días del calendario, en tiempo real para los dos.
    async function borrarCambioComp(key, item) {
        Alert.alert(
            '🗑️ Borrar cambio',
            `¿Borrar este cambio con ${item.con || 'tu compañero'} para los dos?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Borrar', style: 'destructive', onPress: async () => {
                    const updates = {};
                    updates[`historial2/${sesion.miID}/${key}`] = null;

                    const keyTrabaja = fechaAKey(item.diaTrabaja, item.anio);
                    const keyLibra = fechaAKey(item.diaLibra, item.anio);
                    if (keyTrabaja) updates[`cambios/${sesion.miID}/${keyTrabaja}`] = null;
                    if (keyLibra) updates[`cambios/${sesion.miID}/${keyLibra}`] = null;

                    if (item.otroUid) {
                        if (keyTrabaja) updates[`cambios/${item.otroUid}/${keyTrabaja}`] = null;
                        if (keyLibra) updates[`cambios/${item.otroUid}/${keyLibra}`] = null;

                        const snap = await get(ref(db, 'historial2/' + item.otroUid));
                        const historialOtro = snap.val() || {};
                        Object.entries(historialOtro).forEach(([hKey, h]) => {
                            if (h && h.cat === 'comp' && (
                                h.diaTrabaja === item.diaTrabaja || h.diaLibra === item.diaTrabaja ||
                                h.diaTrabaja === item.diaLibra || h.diaLibra === item.diaLibra
                            )) {
                                updates[`historial2/${item.otroUid}/${hKey}`] = null;
                            }
                        });
                    }
                    await update(ref(db), updates);
                }}
            ]
        );
    }

    const s = getStyles(theme);

    if (!sesion) return <ActivityIndicator style={{ flex: 1 }} color="#a78bfa" />;

    const generados = Object.entries(historial).filter(([, h]) => h.cat === 'generado' && h.subtipo !== 'convenio');
    const convenio = Object.entries(historial).filter(([, h]) => h.cat === 'generado' && h.subtipo === 'convenio');
    const pendientes = Object.entries(historial).filter(([, h]) => h.cat === 'pendiente');
    const libresGraciosos = Object.entries(historial).filter(([, h]) => h.cat === 'libreGracioso');
    const l26 = Object.entries(historial).filter(([, h]) => h.cat === 'l26');
    const vacaciones = Object.entries(cambios).filter(([, c]) => c && c.clase === 'b-vac');

    // Cambios con compañero: se leen de historial2 (una sola tarjeta por intercambio)
    const cambiosComp = Object.entries(historial)
        .filter(([, h]) => h.cat === 'comp')
        .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));

    // Cambios propios (sin compañero): se derivan del calendario, excluyendo los que ya son "comp"
    const cambiosList = Object.entries(cambios).filter(([, c]) => c && (c.clase === 'b-inter' || c.clase === 'b-cambio-libre') && !c.linkedUid);

    const cambiosPares = [];
    const procesados = new Set();
    cambiosList.forEach(([key, cambio]) => {
        if (procesados.has(key)) return;
        const { anio: aK, mIdx: m, dia: d } = partesDia(key);
        const fechaCorta = `${d}/${m + 1}`; // sin año: así están escritos los textos "Haces (x ...)" antiguos
        const fecha = `${d}/${m + 1}/${aK}`;
        if (cambio.linkedKey) {
            const otraKey = cambio.linkedKey;
            const otroCambio = cambios[otraKey];
            if (otroCambio && !procesados.has(otraKey)) {
                procesados.add(key); procesados.add(otraKey);
                const { anio: aK2, mIdx: m2, dia: d2 } = partesDia(otraKey);
                const fecha2 = `${d2}/${m2 + 1}/${aK2}`;
                const trabaja = cambio.clase === 'b-inter' ? fecha : fecha2;
                const libra = cambio.clase === 'b-cambio-libre' ? fecha : fecha2;
                cambiosPares.push({ tipo: 'propio', key, otraKey, trabaja, libra });
            } else { procesados.add(key); cambiosPares.push({ tipo: 'simple', key, fecha, cambio }); }
        } else if (cambio.clase === 'b-inter' && cambio.texto?.startsWith('Haces (x ')) {
            const otraEntrada = cambiosList.find(([k, c]) => !procesados.has(k) && k !== key && c.clase === 'b-cambio-libre' && c.texto?.includes(`(x ${fechaCorta})`));
            if (otraEntrada) {
                const [otraKey] = otraEntrada; const { mIdx: m2, dia: d2 } = partesDia(otraKey);
                procesados.add(key); procesados.add(otraKey);
                cambiosPares.push({ tipo: 'propio', key, otraKey, trabaja: fecha, libra: `${d2}/${m2+1}` });
            } else { procesados.add(key); cambiosPares.push({ tipo: 'simple', key, fecha, cambio }); }
        } else if (cambio.clase === 'b-cambio-libre' && cambio.texto?.startsWith('Libras (x ')) {
            const otraEntrada = cambiosList.find(([k, c]) => !procesados.has(k) && k !== key && c.clase === 'b-inter' && c.texto?.includes(`(x ${fechaCorta})`));
            if (otraEntrada) {
                const [otraKey] = otraEntrada; const { mIdx: m2, dia: d2 } = partesDia(otraKey);
                procesados.add(key); procesados.add(otraKey);
                cambiosPares.push({ tipo: 'propio', key: otraKey, otraKey: key, trabaja: `${d2}/${parseInt(m2)+1}`, libra: fecha });
            } else { procesados.add(key); cambiosPares.push({ tipo: 'simple', key, fecha, cambio }); }
        } else { procesados.add(key); cambiosPares.push({ tipo: 'simple', key, fecha, cambio }); }
    });

    const totalCambios = cambiosComp.length + cambiosPares.length;

    const tabs = [
        { key: 'generados', label: '✨', nombre: 'Generados', count: generados.filter(([,h]) => !h.usado).length },
        { key: 'convenio', label: '📋', nombre: 'Convenio', count: convenio.filter(([,h]) => !h.usado).length },
        { key: 'vacaciones', label: '🌴', nombre: 'Vacaciones', count: vacaciones.length },
        { key: 'pendientes', label: '⏳', nombre: 'Pendientes', count: pendientes.filter(([,h]) => !h.usado).length },
        { key: 'cambios', label: '🔄', nombre: 'Cambios', count: totalCambios },
        { key: 'notas', label: '📝', nombre: 'Notas', count: Object.keys(notas).length },
        { key: 'libresGraciosos', label: '🎁', nombre: 'Sin comp.', count: libresGraciosos.length },
        { key: 'l26', label: '🟡', nombre: 'L-26', count: l26.filter(([,h]) => !h.usado).length },
    ];

    function renderItem(key, item, tipo) {
        const usado = item.usado;
        const colores = { generado: '#f472b6', convenio: '#60a5fa', pendiente: '#a78bfa', l26: '#f59e0b' };
        const color = colores[tipo] || '#e2e8f0';
        return (
            <View key={key} style={[s.item, usado && s.itemUsado, { borderLeftColor: color }]}>
                <View style={s.itemInfo}>
                    <Text style={s.itemFecha}>{item.fecha || '—'}</Text>
                    <Text style={s.itemNota}>{item.nota || ''}</Text>
                    {item.accion && (
                        <View style={[s.itemTag, { backgroundColor: item.accion === 'cobrado' ? '#fef08a' : '#dcfce7' }]}>
                            <Text style={{ fontSize: 11 }}>{item.accion === 'cobrado' ? '💶 Cobrado' : '📅 Librado'}</Text>
                        </View>
                    )}
                    {item.diaAsignado && (
                        <Text style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            📅 {partesDia(item.diaAsignado).dia}/{partesDia(item.diaAsignado).mIdx + 1}
                        </Text>
                    )}
                </View>
                <View style={s.itemBtns}>
                    {!usado && (
                        <TouchableOpacity style={s.btnUsar} onPress={() => {
                            if (diaOrigen) {
                                // Viene del calendario — librar directamente en ese día
                                usarDirectoEnDia(key, item);
                            } else {
                                setModalUsar({ key, item: { ...item, cat: tipo } });
                            }
                        }}>
                            <Text style={s.btnUsarTexto}>Usar</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.btnEditarNota} onPress={() => setModalEditarNota({ key, texto: item.nota || '' })}>
                        <Text style={s.btnBorrarTexto}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.btnBorrar} onPress={() => borrarItem(key, item)}>
                        <Text style={s.btnBorrarTexto}>🗑️</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    function renderCambioComp(key, item) {
        return (
            <View key={'comp_' + key} style={[s.item, { borderLeftColor: '#fbbf24' }]}>
                <View style={s.itemInfo}>
                    <Text style={s.itemFecha}>🤝 {item.con || 'Compañero'}</Text>
                    <Text style={s.itemNota}>🚌 Trabajas {item.diaTrabaja || '—'} · 🏠 Libras {item.diaLibra || '—'}</Text>
                    {item.nota ? <Text style={s.itemNota}>📝 {item.nota}</Text> : null}
                </View>
                <TouchableOpacity style={s.btnBorrar} onPress={() => borrarCambioComp(key, item)}>
                    <Text style={s.btnBorrarTexto}>🗑️</Text>
                </TouchableOpacity>
            </View>
        );
    }

    function renderCambio(par) {
        if (par.tipo === 'propio') {
            return (
                <View key={par.key} style={[s.item, { borderLeftColor: '#fbbf24' }]}>
                    <View style={s.itemInfo}>
                        <Text style={s.itemFecha}>🔄 Cambio propio</Text>
                        <Text style={s.itemNota}>📅 {par.trabaja} Trabajas · 🏠 {par.libra} Libras</Text>
                    </View>
                    <TouchableOpacity style={s.btnBorrar} onPress={() => {
                        Alert.alert('🗑️ Borrar', '¿Borrar este cambio propio?', [
                            { text: 'Cancelar', style: 'cancel' },
                            { text: 'Borrar', style: 'destructive', onPress: async () => {
                                await remove(ref(db, 'cambios/' + sesion.miID + '/' + par.key));
                                if (par.otraKey) await remove(ref(db, 'cambios/' + sesion.miID + '/' + par.otraKey));
                            }}
                        ]);
                    }}><Text style={s.btnBorrarTexto}>🗑️</Text></TouchableOpacity>
                </View>
            );
        }
        return (
            <View key={par.key} style={[s.item, { borderLeftColor: '#fbbf24' }]}>
                <View style={s.itemInfo}>
                    <Text style={s.itemFecha}>{par.fecha}</Text>
                    <Text style={s.itemNota}>{par.cambio?.texto || ''}</Text>
                    <View style={[s.itemTag, { backgroundColor: par.cambio?.clase === 'b-inter' ? '#fef08a' : '#fee2e2' }]}>
                        <Text style={{ fontSize: 11 }}>{par.cambio?.clase === 'b-inter' ? 'Trabajas' : 'Libras'}</Text>
                    </View>
                </View>
                <TouchableOpacity style={s.btnBorrar} onPress={() => {
                    Alert.alert('🗑️ Borrar', '¿Borrar este cambio?', [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Borrar', style: 'destructive', onPress: async () => {
                            await remove(ref(db, 'cambios/' + sesion.miID + '/' + par.key));
                        }}
                    ]);
                }}><Text style={s.btnBorrarTexto}>🗑️</Text></TouchableOpacity>
            </View>
        );
    }

    function renderVacacion(key, cambio) {
        const { anio, mIdx: m, dia: d } = partesDia(key);
        return (
            <View key={key} style={[s.item, { borderLeftColor: '#34d399' }]}>
                <View style={s.itemInfo}>
                    <Text style={s.itemFecha}>{d}/{m+1}/{anio}</Text>
                    <Text style={s.itemNota}>{cambio.texto || 'Vacaciones'}</Text>
                </View>
                <TouchableOpacity style={s.btnBorrar} onPress={() => {
                    Alert.alert('🗑️ Borrar', '¿Borrar este día de vacaciones?', [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Borrar', style: 'destructive', onPress: async () => await remove(ref(db, 'cambios/' + sesion.miID + '/' + key)) }
                    ]);
                }}><Text style={s.btnBorrarTexto}>🗑️</Text></TouchableOpacity>
            </View>
        );
    }

    const esConvenio = modalUsar?.item?.subtipo === 'convenio';
    const esPendiente = modalUsar?.item?.cat === 'pendiente';

    return (
        <View style={s.container}>
            <View style={s.header}>
                <Text style={s.titulo}>📋 Historial</Text>
                <Text style={s.sub}>{sesion.miNombreCompleto}</Text>
            </View>
            {/* PORTADA */}
            {enPortada ? (
                <ScrollView style={s.content} showsVerticalScrollIndicator={false}>
                    <View style={s.portadaGrid}>
                        {[
                            { key: 'generados', emoji: '✨', nombre: 'Generados', sub: 'Días asignados', color: '#be185d', bg: '#fdf2f8', border: '#f472b6', count: generados.filter(([,h]) => !h.usado).length },
                            { key: 'convenio', emoji: '📋', nombre: 'Convenio', sub: 'Días convenio', color: '#1d4ed8', bg: '#eff6ff', border: '#60a5fa', count: convenio.filter(([,h]) => !h.usado).length },
                            { key: 'vacaciones', emoji: '🌴', nombre: 'Vacaciones', sub: 'Mis vacaciones', color: '#166534', bg: '#f0fdf4', border: '#4ade80', count: vacaciones.length },
                            { key: 'pendientes', emoji: '⏳', nombre: 'Pendientes', sub: 'Por resolver', color: '#6b21a8', bg: '#f5f3ff', border: '#a78bfa', count: pendientes.filter(([,h]) => !h.usado).length },
                            { key: 'cambios', emoji: '🔄', nombre: 'Cambios', sub: 'Permutas', color: '#1d4ed8', bg: '#eff6ff', border: '#60a5fa', count: totalCambios },
                            { key: 'notas', emoji: '📝', nombre: 'Notas', sub: 'Anotaciones', color: '#0e7490', bg: '#ecfeff', border: '#06b6d4', count: Object.keys(notas).length },
                            { key: 'libresGraciosos', emoji: '🎁', nombre: 'Sin comp.', sub: 'Sin cobrar', color: '#0891b2', bg: '#f0f9ff', border: '#38bdf8', count: libresGraciosos.length },
                            { key: 'l26', emoji: '🟡', nombre: 'L-26', sub: 'Días L-26', color: '#b45309', bg: '#fefce8', border: '#f59e0b', count: l26.filter(([,h]) => !h.usado).length },
                        ].map(t => (
                            <TouchableOpacity key={t.key} style={[s.portadaCard, { backgroundColor: t.bg, borderColor: t.border }]} onPress={() => { setTab(t.key); setEnPortada(false); }}>
                                <Text style={s.portadaEmoji}>{t.emoji}</Text>
                                <Text style={[s.portadaNombre, { color: t.color }]}>{t.nombre}</Text>
                                <Text style={[s.portadaSub, { color: t.color }]}>{t.sub}</Text>
                                {t.count > 0 && (
                                    <View style={[s.portadaBadge, { backgroundColor: t.border }]}>
                                        <Text style={s.portadaBadgeTexto}>{t.count}</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        ))}
                    </View>
                </ScrollView>
            ) : (
                <>
                <View style={s.detalleHeader}>
                    <TouchableOpacity style={s.btnAtras} onPress={() => setEnPortada(true)}>
                        <Text style={s.btnAtrasTexto}>← Atrás</Text>
                    </TouchableOpacity>
                    <Text style={s.detalleTitulo}>
                        {tabs.find(t => t.key === tab)?.emoji} {tabs.find(t => t.key === tab)?.nombre}
                    </Text>
                </View>
            <ScrollView style={s.content} showsVerticalScrollIndicator={false}>
                {tab === 'generados' && (
                    <View>
                        <View style={s.seccionHeader}>
                            <Text style={s.seccionTitulo}>✨ Días Generados</Text>
                            <TouchableOpacity style={s.btnAdd} onPress={() => setModalAdd(true)}>
                                <Text style={s.btnAddTexto}>+ Añadir</Text>
                            </TouchableOpacity>
                        </View>
                        {generados.length === 0 && <Text style={s.vacio}>No hay días generados</Text>}
                        {generados.map(([key, item]) => renderItem(key, item, 'generado'))}
                    </View>
                )}
                {tab === 'convenio' && (
                    <View>
                        <View style={s.seccionHeader}>
                            <Text style={s.seccionTitulo}>📋 Días de Convenio</Text>
                            <TouchableOpacity style={s.btnAdd} onPress={() => añadirManual('convenio')}>
                                <Text style={s.btnAddTexto}>+ Añadir</Text>
                            </TouchableOpacity>
                        </View>
                        {convenio.length === 0 && <Text style={s.vacio}>No hay días de convenio</Text>}
                        {convenio.map(([key, item]) => renderItem(key, item, 'convenio'))}
                    </View>
                )}
                {tab === 'vacaciones' && (
                    <View>
                        <Text style={s.seccionTitulo}>🌴 Vacaciones marcadas</Text>
                        {vacaciones.length === 0 && <Text style={s.vacio}>No hay vacaciones marcadas</Text>}
                        {vacaciones.map(([key, cambio]) => renderVacacion(key, cambio))}
                    </View>
                )}
                {tab === 'pendientes' && (
                    <View>
                        <View style={s.seccionHeader}>
                            <Text style={s.seccionTitulo}>⏳ Días Pendientes</Text>
                            <TouchableOpacity style={s.btnAdd} onPress={añadirPendiente}>
                                <Text style={s.btnAddTexto}>+ Añadir</Text>
                            </TouchableOpacity>
                        </View>
                        {pendientes.length === 0 && <Text style={s.vacio}>No hay días pendientes</Text>}
                        {pendientes.map(([key, item]) => renderItem(key, item, 'pendiente'))}
                    </View>
                )}
                {tab === 'cambios' && (
                    <View>
                        <Text style={s.seccionTitulo}>🔄 Cambios realizados</Text>
                        {totalCambios === 0 && <Text style={s.vacio}>No hay cambios realizados</Text>}
                        {cambiosComp.map(([key, item]) => renderCambioComp(key, item))}
                        {cambiosPares.map(par => renderCambio(par))}
                    </View>
                )}
                {tab === 'notas' && (
                    <View>
                        <Text style={s.seccionTitulo}>📝 Mis notas</Text>
                        {Object.keys(notas).length === 0 && <Text style={s.vacio}>No hay notas guardadas</Text>}
                        {Object.entries(notas)
                            .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
                            .map(([key, nota]) => (
                                <View key={key} style={[s.item, { borderLeftColor: '#7dd3fc' }]}>
                                    <View style={s.itemInfo}>
                                        <Text style={s.itemFecha}>{nota.fecha}</Text>
                                        <Text style={s.itemNota}>{nota.texto}</Text>
                                    </View>
                                    <TouchableOpacity style={s.btnBorrar} onPress={() => {
                                        Alert.alert('🗑️ Borrar nota', '¿Borrar esta nota?', [
                                            { text: 'Cancelar', style: 'cancel' },
                                            { text: 'Borrar', style: 'destructive', onPress: async () => {
                                                await remove(ref(db, 'notas/' + sesion.miID + '/' + key));
                                            }}
                                        ]);
                                    }}>
                                        <Text style={s.btnBorrarTexto}>🗑️</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                    </View>
                )}

                {tab === 'libresGraciosos' && (
                    <View>
                        <Text style={s.seccionTitulo}>🎁 Libres sin compensación</Text>
                        <Text style={[s.vacio, { fontStyle: 'normal', color: theme.textoSecundario, marginBottom: 12 }]}>
                            Días que libraste sin cobrar ni debes nada a cambio.
                        </Text>
                        {libresGraciosos.length === 0 && <Text style={s.vacio}>No hay libres sin compensación</Text>}
                        {libresGraciosos
                            .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
                            .map(([key, item]) => (
                                <View key={key} style={[s.item, { borderLeftColor: '#0891b2' }]}>
                                    <View style={s.itemInfo}>
                                        <Text style={s.itemFecha}>{item.fecha}</Text>
                                        <Text style={s.itemNota}>{item.nota || 'Libre sin compensación'}</Text>
                                    </View>
                                    <View style={s.itemBtns}>
                                        <TouchableOpacity style={s.btnEditarNota} onPress={() => setModalEditarNota({ key, texto: item.nota || '' })}>
                                            <Text style={s.btnBorrarTexto}>✏️</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={s.btnBorrar} onPress={() => {
                                            Alert.alert('🗑️ Borrar', '¿Borrar este registro? También se borrará del calendario.', [
                                                { text: 'Cancelar', style: 'cancel' },
                                                { text: 'Borrar', style: 'destructive', onPress: async () => {
                                                    await remove(ref(db, 'historial2/' + sesion.miID + '/' + key));
                                                    if (item.diaKey) {
                                                        await remove(ref(db, 'cambios/' + sesion.miID + '/' + item.diaKey));
                                                    }
                                                }}
                                            ]);
                                        }}>
                                            <Text style={s.btnBorrarTexto}>🗑️</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                    </View>
                )}
                {tab === 'l26' && (
                    <View>
                        <View style={s.seccionHeader}>
                            <Text style={s.seccionTitulo}>🟡 L-26</Text>
                            <TouchableOpacity style={s.btnAdd} onPress={() => añadirManual('l26')}>
                                <Text style={s.btnAddTexto}>+ Añadir</Text>
                            </TouchableOpacity>
                        </View>
                        {l26.length === 0 && <Text style={s.vacio}>No hay días L-26</Text>}
                        {l26.map(([key, item]) => renderItem(key, item, 'l26'))}
                    </View>
                )}
            </ScrollView>

            {/* Modal añadir generado */}
            <Modal transparent animationType="fade" visible={modalAdd} onRequestClose={() => setModalAdd(false)}>
                <TouchableOpacity style={s.overlay} onPress={() => setModalAdd(false)} activeOpacity={1}>
                    <View style={s.menu}>
                        <Text style={s.menuTitulo}>➕ Añadir día generado</Text>
                        <TouchableOpacity style={s.menuItem} onPress={() => añadirManual('generado')}>
                            <Text style={[s.menuItemTexto, { color: '#be185d' }]}>✨ Generado (cobrable/librable)</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.menuItem} onPress={() => añadirManual('convenio')}>
                            <Text style={[s.menuItemTexto, { color: '#1d4ed8' }]}>📋 Convenio (solo librable)</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.menuItem} onPress={() => añadirManual('l26')}>
                            <Text style={[s.menuItemTexto, { color: '#b45309' }]}>🟡 L-26 (cobrable/librable)</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.menuItem} onPress={() => setModalAdd(false)}>
                            <Text style={[s.menuItemTexto, { color: '#94a3b8' }]}>Cancelar</Text>
                        </TouchableOpacity>
                                     </View>
                </TouchableOpacity>
            </Modal>

            {/* Modal formulario: fecha + nota */}
            <Modal transparent animationType="fade" visible={!!modalForm} onRequestClose={() => setModalForm(null)}>
                <View style={s.overlay}>
                    <View style={s.menu}>
                        <Text style={s.menuTitulo}>
                            {modalForm?.tipo === 'l26' ? '🟡 L-26' : modalForm?.tipo === 'convenio' ? '📋 Día de convenio' : modalForm?.tipo === 'pendiente' ? '⏳ Día pendiente' : '✨ Día generado'}
                        </Text>
                        <TextInput
                            style={[s.editarNotaInput, { marginTop: 12 }]}
                            value={modalForm?.fecha || ''}
                            onChangeText={(t) => setModalForm({ ...modalForm, fecha: t })}
                            placeholder="Fecha (ej: 15/3/2027)"
                        />
                        {(modalForm?.tipo === 'generado' || modalForm?.tipo === 'l26') && (
                            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                                <TouchableOpacity
                                    style={[s.btnCancelar, modalForm?.esLibre !== false && { backgroundColor: '#f472b6' }]}
                                    onPress={() => setModalForm({ ...modalForm, esLibre: true })}
                                >
                                    <Text style={{ color: modalForm?.esLibre !== false ? '#fff' : theme.textoSecundario, fontWeight: '700' }}>⬜ Libre</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[s.btnCancelar, modalForm?.esLibre === false && { backgroundColor: '#f472b6' }]}
                                    onPress={() => setModalForm({ ...modalForm, esLibre: false })}
                                >
                                    <Text style={{ color: modalForm?.esLibre === false ? '#fff' : theme.textoSecundario, fontWeight: '700' }}>⭕ Trabajo</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                        <TextInput
                            style={[s.editarNotaInput, { marginTop: 10, minHeight: 60 }]}
                            value={modalForm?.nota || ''}
                            onChangeText={(t) => setModalForm({ ...modalForm, nota: t })}
                            placeholder="Nota (opcional)"
                            multiline
                        />
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                            <TouchableOpacity style={s.btnCancelar} onPress={() => setModalForm(null)}>
                                <Text style={s.btnCancelarTextoModal}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnConfirmar} onPress={guardarDesdeFormulario}>
                                <Text style={s.btnConfirmarTexto}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modal usar día */}
            <Modal transparent animationType="slide" visible={!!modalUsar} onRequestClose={() => setModalUsar(null)}>
                <View style={s.overlayBottom}>
                    <View style={s.menuBottom}>
                        <View style={s.menuHandle} />
                        <Text style={s.menuTitulo}>
                            {esConvenio ? '📋 Usar día de convenio' : esPendiente ? '⏳ Usar día pendiente' : modalUsar?.item?.cat === 'l26' ? '🟡 Usar día L-26' : '✨ Usar día generado'}
                        </Text>
                        <Text style={{ color: '#64748b', textAlign: 'center', marginBottom: 16, fontSize: 13 }}>
                            {modalUsar?.item?.nota || ''}
                        </Text>
                        {!esConvenio && !esPendiente && (
                            <TouchableOpacity style={s.btnAccion} onPress={() => accionUsar('cobrar')}>
                                <Text style={s.btnAccionEmoji}>💶</Text>
                                <View>
                                    <Text style={s.btnAccionTitulo}>Cobrar</Text>
                                    <Text style={s.btnAccionSub}>Registrar como cobrado</Text>
                                </View>
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity style={[s.btnAccion, { backgroundColor: '#f0fdf4' }]} onPress={() => accionUsar('librar')}>
                            <Text style={s.btnAccionEmoji}>📅</Text>
                            <View>
                                <Text style={[s.btnAccionTitulo, { color: '#166534' }]}>Librar un día</Text>
                                <Text style={s.btnAccionSub}>Elegir día en el calendario</Text>
                            </View>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.btnCancelarBottom} onPress={() => setModalUsar(null)}>
                            <Text style={s.btnCancelarTexto}>Cancelar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Modal editar nota/código */}
            <Modal transparent animationType="fade" visible={!!modalEditarNota} onRequestClose={() => setModalEditarNota(null)}>
                <View style={s.overlay}>
                    <View style={s.menu}>
                        <Text style={s.menuTitulo}>✏️ Editar apunte</Text>
                        <TextInput
                            style={s.editarNotaInput}
                            value={modalEditarNota?.texto || ''}
                            onChangeText={(t) => setModalEditarNota({ ...modalEditarNota, texto: t })}
                            placeholder="Ej: L15, código, nota..."
                            maxLength={100}
                        />
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                            <TouchableOpacity style={s.btnCancelar} onPress={() => setModalEditarNota(null)}>
                                <Text style={s.btnCancelarTextoModal}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnConfirmar} onPress={guardarNotaEditada}>
                                <Text style={s.btnConfirmarTexto}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
            </>
            )}

            {/* Modal confirmación uso directo desde calendario */}
            <Modal transparent animationType="fade" visible={!!modalConfirmar} onRequestClose={() => setModalConfirmar(null)}>
                <View style={s.overlay}>
                    <View style={s.menu}>
                        <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>✅</Text>
                        <Text style={s.menuTitulo}>Confirmar día</Text>
                        <Text style={{ color: '#64748b', textAlign: 'center', marginBottom: 20, fontSize: 14 }}>
                            {modalConfirmar && `¿Librar el ${modalConfirmar.diaOrigen.d}/${modalConfirmar.diaOrigen.mIdx + 1} con este día?`}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <TouchableOpacity style={s.btnCancelar} onPress={() => setModalConfirmar(null)}>
                                <Text style={s.btnCancelarTextoModal}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnConfirmar} onPress={confirmarUsoDirecto}>
                                <Text style={s.btnConfirmarTexto}>Confirmar</Text>
                            </TouchableOpacity>
                        </View>
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
        sub: { fontSize: 12, color: theme.headerSub, marginTop: 2 },
        tabs: { flexGrow: 0, height: 72, backgroundColor: theme.headerFondo, paddingVertical: 8 },
        tabBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.isDark ? '#1e1b2e' : '#312e81', minWidth: 64, position: 'relative' },
        tabBtnActive: { backgroundColor: theme.primario },
        tabEmoji: { fontSize: 18 },
        tabNombre: { fontSize: 10, fontWeight: '700', color: theme.headerSub, marginTop: 2 },
        tabNombreActive: { color: '#fff' },
        portadaGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
        portadaCard: { width: '47%', borderWidth: 2, borderRadius: 16, padding: 16, alignItems: 'center', position: 'relative' },
        portadaEmoji: { fontSize: 32, marginBottom: 6 },
        portadaNombre: { fontSize: 14, fontWeight: '900' },
        portadaSub: { fontSize: 11, opacity: 0.7, marginTop: 2 },
        portadaBadge: { position: 'absolute', top: 8, right: 8, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
        portadaBadgeTexto: { color: '#fff', fontSize: 10, fontWeight: '900' },
        detalleHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.headerFondo, paddingHorizontal: 12, paddingVertical: 8, gap: 12 },
        btnAtras: { backgroundColor: theme.isDark ? '#312e81' : '#312e81', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
        btnAtrasTexto: { color: '#a78bfa', fontWeight: '800', fontSize: 13 },
        detalleTitulo: { fontSize: 15, fontWeight: '900', color: '#fff' },
        tabBadge: { position: 'absolute', top: 2, right: 8, backgroundColor: '#a78bfa', borderRadius: 8, paddingHorizontal: 4, minWidth: 16, alignItems: 'center' },
        tabBadgeTexto: { color: '#fff', fontSize: 10, fontWeight: '900' },
        content: { flex: 1, padding: 12 },
        seccionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
        seccionTitulo: { fontSize: 16, fontWeight: '800', color: theme.texto, marginBottom: 8 },
        btnAdd: { backgroundColor: theme.primario, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
        btnAddTexto: { color: '#fff', fontWeight: '700', fontSize: 13 },
        vacio: { color: theme.textoTenue, fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
        item: { backgroundColor: theme.card, borderRadius: 14, padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center', elevation: 1, borderLeftWidth: 4 },
        itemUsado: { opacity: 0.6 },
        itemInfo: { flex: 1 },
        itemFecha: { fontSize: 14, fontWeight: '800', color: theme.texto },
        itemNota: { fontSize: 12, color: theme.textoSecundario, marginTop: 2 },
        itemTag: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4, alignSelf: 'flex-start' },
        itemBtns: { flexDirection: 'row', gap: 8 },
        btnUsar: { backgroundColor: theme.primario, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
        btnUsarTexto: { color: '#fff', fontWeight: '700', fontSize: 12 },
        btnBorrar: { padding: 6 },
        btnEditarNota: { padding: 6 },
        editarNotaInput: { borderWidth: 2, borderColor: theme.borde, borderRadius: 10, padding: 10, fontSize: 14, color: theme.texto },
        btnBorrarTexto: { fontSize: 18 },
        overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
        overlayBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
        menuBottom: { backgroundColor: theme.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
        menuHandle: { width: 40, height: 4, backgroundColor: theme.borde, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
        menu: { backgroundColor: theme.card, borderRadius: 20, padding: 20, width: SW * 0.85 },
        menuTitulo: { fontSize: 16, fontWeight: '900', color: theme.texto, marginBottom: 4, textAlign: 'center' },
        menuItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.borde },
        menuItemTexto: { fontSize: 15, fontWeight: '700' },
        btnAccion: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.isDark ? '#3b2a3a' : '#fdf2f8', borderRadius: 14, padding: 16, marginBottom: 10, gap: 14 },
        btnAccionEmoji: { fontSize: 28 },
        btnAccionTitulo: { fontSize: 15, fontWeight: '800', color: '#be185d' },
        btnAccionSub: { fontSize: 12, color: theme.textoSecundario, marginTop: 2 },
        btnCancelarBottom: { alignItems: 'center', marginTop: 8, padding: 12 },
        btnCancelarTexto: { color: theme.textoTenue, fontWeight: '700', fontSize: 15 },
        btnCancelar: { flex: 1, backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9', borderRadius: 12, padding: 14, alignItems: 'center' },
        btnCancelarTextoModal: { color: theme.textoSecundario, fontWeight: '700' },
        btnConfirmar: { flex: 1, backgroundColor: theme.primario, borderRadius: 12, padding: 14, alignItems: 'center' },
        btnConfirmarTexto: { color: '#fff', fontWeight: '700' },
    });
}