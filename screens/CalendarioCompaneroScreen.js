import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    View, Text, StyleSheet, ScrollView,
    TouchableOpacity, Dimensions, Alert, FlatList, Animated, BackHandler, ActivityIndicator
} from 'react-native';
import { db } from '../config/firebase';
import { ref, set, push, onValue } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { equipoBase, mesesArr, getDiasLibres, getDiasEspeciales, esFestivo, leerDia, claveDia } from '../config/datos';
import { textoPerfil } from '../components/PerfilConductorForm';
import { enviarPushA } from '../services/notifications';
import { useTheme } from '../context/ThemeContext';

const { width: SW } = Dimensions.get('window');
const PANEL_W = SW * 0.75;

function getDiasEnMes(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getPrimerDia(y, m) { let d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }

function getEstadoPersona(uid, year, mIdx, d, cambiosTodos, equipo) {
    const p = (equipo || []).find(x => x.id === uid);
    if (!p) return false;
    const diasLibresBase = getDiasLibres(year, p.g, p.t);
    const libreBase = diasLibresBase && (diasLibresBase[mIdx] || []).includes(d);
    const cambio = leerDia(cambiosTodos[uid], year, mIdx, d);
    let esLibre = libreBase;
    if (cambio) {
        if (cambio.clase === 'b-cambio-libre' || cambio.clase === 'b-vac') esLibre = true;
        else if (cambio.clase === 'b-inter' || cambio.clase === 'b-pend' || cambio.clase === 'b-generado') esLibre = false;
    }
    return esLibre;
}

export default function CalendarioCompaneroScreen({ route, navigation }) {
    const { theme } = useTheme();
    const { uid, modoCambio } = route.params || {};
    const [equipoActual, setEquipoActual] = useState(equipoBase);
    const persona = (equipoActual || []).find(x => x.id === uid);
    const [anio, setAnio] = useState(new Date().getFullYear());
    const [cambiosTodos, setCambiosTodos] = useState({});
    const [panelDia, setPanelDia] = useState(null); // {d, mIdx}
    const panelAnim = useRef(new Animated.Value(SW)).current;

    useEffect(() => {
        const unsub = onValue(ref(db, 'cambios'), snap => setCambiosTodos(snap.val() || {}));
        return () => unsub();
    }, []);

    useEffect(() => {
        let unsubEquipo;
        async function cargarEquipo() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (raw) {
                const s = JSON.parse(raw);
                if (s.modoGrupo && s.grupoActual) {
                    unsubEquipo = onValue(ref(db, 'grupos/' + s.grupoActual + '/miembros'), snap => {
                        const data = snap.val() || {};
                        const lista = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
                        setEquipoActual(lista);
                    });
                }
            }
        }
        cargarEquipo();
        return () => { if (unsubEquipo) unsubEquipo(); };
    }, []);

    const panelData = useMemo(() => {
        if (!panelDia) return null;
        const { d, mIdx } = panelDia;
        const libran = (equipoActual || []).filter(p => getEstadoPersona(p.id, anio, mIdx, d, cambiosTodos, equipoActual));
        const trabajan = (equipoActual || []).filter(p => !getEstadoPersona(p.id, anio, mIdx, d, cambiosTodos, equipoActual));
        return { libran, trabajan };
    }, [panelDia, anio, cambiosTodos]);

    function cerrarPanel() {
        Animated.timing(panelAnim, { toValue: SW, duration: 200, useNativeDriver: true }).start(() => setPanelDia(null));
    }

    // Este aviso del botón "Atrás" tiene que ejecutarse siempre, aunque todavía no
    // hayan llegado los datos del compañero (si no, la app se cierra con compañeros nuevos).
    useEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            if (panelDia) { cerrarPanel(); return true; }
            return false;
        });
        return () => handler.remove();
    }, [panelDia]);

    const s = getStyles(theme);

    if (!persona) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.fondo, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color="#a78bfa" />
            </View>
        );
    }

    const diasLibresBase = getDiasLibres(anio, persona.g, persona.t) || {};
    const hoy = new Date();

    function abrirPanel(d, mIdx) {
        setPanelDia({ d, mIdx });
        Animated.spring(panelAnim, { toValue: SW - PANEL_W, useNativeDriver: true }).start();
    }

    async function onPressDia(d, mIdx) {
        if (!modoCambio) {
            abrirPanel(d, mIdx);
            return;
        }

        const { diaA, mIdxA, miID, miNom } = modoCambio;
        const compNom = persona.n.split(' ')[0];
        const f1 = `${diaA}/${mIdxA + 1}`;
        const f2 = `${d}/${mIdx + 1}`;

        Alert.alert(
            '🤝 Confirmar cambio',
            `Tú trabajas el ${f1} y libras el ${f2}\n${compNom} libra el ${f1} y trabaja el ${f2}\n\n¿Enviar solicitud?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Enviar', onPress: async () => {
                    const solRef = push(ref(db, 'solicitudes'));
                    await set(solRef, {
                        de: miID,
                        para: uid,
                        d1: diaA, m1: mIdxA,
                        d2: d, m2: mIdx, anio,
                        f1, f2,
                        miNom,
                        compNom,
                        estado: 'pendiente',
                        ts: Date.now()
                    });
                    // Guardamos la solicitud pendiente para que la pantalla de Turnos
                    // muestre el aviso y lo cierre sola en cuanto haya respuesta.
                    await AsyncStorage.setItem('solicitudPendienteTemp', JSON.stringify({ solKey: solRef.key, compNom }));
                    enviarPushA(uid, '🤝 Nueva solicitud de cambio', `${miNom} quiere cambiar el ${f1} por el ${f2} contigo.`, { tipo: 'solicitud' });
                    navigation.goBack();
                }}
            ]
        );
    }

    function renderMes(mIdx) {
        const dias = getDiasEnMes(anio, mIdx);
        const start = getPrimerDia(anio, mIdx);
        const libres = diasLibresBase[mIdx] || [];
        const esp = getDiasEspeciales(anio, persona.g, persona.t);
        const subgrupoMes = esp.subgrupo[mIdx] || [];
        const lrjMes = esp.lrj[mIdx] || [];
        const esHoy = (d) => hoy.getFullYear() === anio && hoy.getMonth() === mIdx && hoy.getDate() === d;
        const cambiosPersona = cambiosTodos[uid] || {};

        let celdas = [];
        for (let i = 0; i < start; i++) celdas.push(<View key={'e' + i} style={s.celda} />);

        for (let d = 1; d <= dias; d++) {
            const cambio = leerDia(cambiosPersona, anio, mIdx, d);
            const esLibre = libres.includes(d);
            const festivo = esFestivo(anio, mIdx, d);

            let borderColor = 'transparent';
            let esLibreReal = esLibre;
            if (cambio) {
                if (cambio.clase === 'b-inter') esLibreReal = false;
                if (cambio.clase === 'b-cambio-libre') esLibreReal = true;
            }
            let bgColor = esLibreReal ? theme.celdaLibre : theme.celdaTrabajo;
            let textColor = esLibreReal ? theme.celdaLibreTexto : theme.celdaTrabajoTexto;
            if (esLibre && esLibreReal) {
                if (lrjMes.includes(d)) { bgColor = theme.celdaLrj; textColor = theme.celdaLrjTexto; }
                else if (subgrupoMes.includes(d)) { bgColor = theme.celdaSubgrupo; textColor = theme.celdaSubgrupoTexto; }
            }

            if (festivo) { bgColor = '#ef4444'; textColor = esLibreReal ? '#ffffff' : '#000000'; }
            if (cambio) {
                if (cambio.clase === 'b-vac') { bgColor = '#dcfce7'; textColor = '#166534'; borderColor = '#16a34a'; }
                if (cambio.clase === 'b-pend') { bgColor = '#f3e8ff'; textColor = '#6b21a8'; borderColor = '#9333ea'; }
                if (cambio.clase === 'b-inter') { bgColor = '#fef08a'; textColor = '#713f12'; borderColor = '#eab308'; }
                if (cambio.clase === 'b-cambio-libre') { bgColor = '#fee2e2'; textColor = '#991b1b'; borderColor = '#ef4444'; }
                if (cambio.clase === 'b-generado') { bgColor = '#fdf2f8'; textColor = '#be185d'; borderColor = '#f472b6'; }
                if (cambio.clase === 'b-l26') { bgColor = '#fefce8'; textColor = '#b45309'; borderColor = '#f59e0b'; }
            }
            if (esHoy(d)) { bgColor = '#7c3aed'; textColor = '#ffffff'; }

            const dd = d; const mm = mIdx;
            celdas.push(
                <TouchableOpacity
                    key={d}
                    style={[s.celda, { backgroundColor: bgColor, borderColor, borderWidth: borderColor !== 'transparent' ? 2 : 0 }]}
                    onPress={() => onPressDia(dd, mm)}
                    activeOpacity={modoCambio ? 0.6 : 1}
                >
                    <Text style={[s.diaNum, { color: textColor, fontWeight: esHoy(d) ? '900' : '600' }]}>{d}</Text>
                    {esHoy(d) && <View style={s.hoyDot} />}
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
                            <Text style={s.panelSub}>{textoPerfil(p)}</Text>
                        </View>
                    )) : <Text style={s.panelVacio}>Ninguno</Text>}
                    <Text style={[s.panelSeccion, { color: '#3b82f6', marginTop: 12 }]}>🚌 TRABAJAN ({trabajan.length})</Text>
                    {trabajan.length ? trabajan.map(p => (
                        <View key={p.id} style={s.panelFila}>
                            <Text style={s.panelNombre}>{p.n}</Text>
                            <Text style={s.panelSub}>{textoPerfil(p)}</Text>
                        </View>
                    )) : <Text style={s.panelVacio}>Ninguno</Text>}
                </ScrollView>
            </Animated.View>
        );
    };

    return (
        <View style={s.container}>
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.btnVolver}>
                    <Text style={s.btnVolverTexto}>← Volver</Text>
                </TouchableOpacity>
                <Text style={s.titulo}>{persona.n}</Text>
                <Text style={s.sub}>{textoPerfil(persona)}</Text>
                {modoCambio && (
                    <View style={s.bannerCambio}>
                        <Text style={s.bannerTexto}>🔄 Pulsa el día que {persona.n.split(' ')[0]} te dará a cambio del {modoCambio.diaA}/{modoCambio.mIdxA + 1}</Text>
                    </View>
                )}
                <View style={s.anioNav}>
                    <TouchableOpacity onPress={() => setAnio(anio - 1)} style={s.anioBtn}>
                        <Text style={s.anioBtnTexto}>◀</Text>
                    </TouchableOpacity>
                    <Text style={s.anioTexto}>{anio}</Text>
                    <TouchableOpacity onPress={() => setAnio(anio + 1)} style={s.anioBtn}>
                        <Text style={s.anioBtnTexto}>▶</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <FlatList
                data={mesesArr}
                keyExtractor={(_, i) => 'mes_' + i}
                renderItem={({ index }) => renderMes(index)}
                showsVerticalScrollIndicator={false}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={5}
                removeClippedSubviews={true}
            />
            {panelDia && (
                <TouchableOpacity style={s.overlay2} onPress={cerrarPanel} activeOpacity={1} />
            )}
            {renderPanel()}
        </View>
    );
}

function getStyles(theme) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.fondo },
        header: { backgroundColor: theme.headerFondo, padding: 16, paddingTop: 50 },
        btnVolver: { marginBottom: 8 },
        btnVolverTexto: { color: theme.headerTexto, fontWeight: '700', fontSize: 14 },
        titulo: { fontSize: 20, fontWeight: '900', color: '#ffffff' },
        sub: { fontSize: 12, color: theme.headerSub, marginTop: 2 },
        bannerCambio: { backgroundColor: theme.primario, borderRadius: 10, padding: 8, marginTop: 8 },
        bannerTexto: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
        anioNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
        anioBtn: { backgroundColor: theme.isDark ? '#1e3a5f' : '#312e81', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6 },
        anioBtnTexto: { color: theme.headerTexto, fontSize: 16, fontWeight: '900' },
        anioTexto: { color: '#ffffff', fontSize: 18, fontWeight: '900', marginHorizontal: 20 },
        mesCard: { backgroundColor: theme.card, margin: 12, borderRadius: 16, padding: 12, elevation: 2 },
        mesNombre: { fontSize: 16, fontWeight: '800', color: theme.texto, marginBottom: 8, textAlign: 'center' },
        diasHeader: { flexDirection: 'row', marginBottom: 4 },
        diaLetra: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: theme.textoTenue },
        grid: { flexDirection: 'row', flexWrap: 'wrap' },
        celda: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 6, marginVertical: 1 },
        diaNum: { fontSize: 13 },
        hoyDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#ffffff', marginTop: 1 },
        overlay2: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)' },
        panel: { position: 'absolute', top: 0, bottom: 0, width: PANEL_W, backgroundColor: theme.card, elevation: 10, padding: 16, paddingTop: 50 },
        panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
        panelTitulo: { fontSize: 16, fontWeight: '900', color: theme.texto },
        panelCerrar: { fontSize: 20, color: theme.textoTenue, fontWeight: '700' },
        panelSeccion: { fontSize: 12, fontWeight: '800', marginBottom: 6 },
        panelFila: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.borde },
        panelNombre: { fontSize: 13, color: theme.texto, fontWeight: '600' },
        panelSub: { fontSize: 12, color: theme.textoTenue },
        panelVacio: { fontSize: 12, color: theme.textoTenue, fontStyle: 'italic' },
    });
}