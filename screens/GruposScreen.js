import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Modal, TextInput, Alert, Dimensions
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { ref, onValue, update, set, remove } from 'firebase/database';
import { anioInicial, equipoBase, mesesArr, getDiasLibres, getDiasEspeciales, esFestivo } from '../config/datos';
import { SISTEMAS_CONDUCTORES, sistemaDe, subgruposDe, nombreGrupo } from '../config/libresConductores';
import PerfilConductorForm, { PERFIL_VACIO, validarPerfil, perfilAMiembro, textoPerfil } from '../components/PerfilConductorForm';
import { useTheme } from '../context/ThemeContext';

const { width: SW } = Dimensions.get('window');
// Tamaño exacto de cada casilla del calendario (7 columnas dentro de la tarjeta del mes: margen 10 + relleno 10 por lado).
const CELDA = Math.floor((SW - 40) / 7);

function getDiasEnMes(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getPrimerDia(y, m) { let d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; }

// En Libres Conductores hay tres sistemas (convencional, búhos y R.S.N), cada uno con sus grupos y subgrupos.
// El subgrupo se guarda en el campo "t" de cada persona y el grupo en "g" (el código del grupo indica el sistema).

function emojiTurno() {
    return '🚌';
}

export default function GruposScreen({ navigation }) {
    const { theme } = useTheme();
    const [sesion, setSesion] = useState(null);
    const [tab, setTab] = useState('grupos'); // grupos | info
    const [turnoTab, setTurnoTab] = useState('A'); // subgrupo seleccionado
    const [sistemaTab, setSistemaTab] = useState('C'); // C = convencional, B = búhos, R = R.S.N
    const sistemaActual = SISTEMAS_CONDUCTORES.find(x => x.id === sistemaTab) || SISTEMAS_CONDUCTORES[0];
    const [grupoSeleccionado, setGrupoSeleccionado] = useState(null);
    const [anio, setAnio] = useState(anioInicial());
    const [infoGrupo, setInfoGrupo] = useState([]);
    const [creadorGrupo, setCreadorGrupo] = useState(null);
    const [administradores, setAdministradores] = useState({});
    const [modalEditar, setModalEditar] = useState(null); // {idx, persona}
    const [editNombre, setEditNombre] = useState('');
    const [editID, setEditID] = useState('');
    const [editPerfil, setEditPerfil] = useState(PERFIL_VACIO);

    useEffect(() => {
        let unsubInfoGrupo, unsubCreador, unsubAdmins;
        async function cargar() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (raw) {
                const s = JSON.parse(raw);
                setSesion(s);
                setSistemaTab(sistemaDe(s.miGrupoSesion));
                if (s.grupoActual) {
                    unsubInfoGrupo = onValue(ref(db, 'grupos/' + s.grupoActual + '/miembros'), snap => {
                        const data = snap.val() || [];
                        setInfoGrupo(Array.isArray(data) ? data.filter(Boolean) : Object.values(data));
                    });
                    unsubCreador = onValue(ref(db, 'grupos/' + s.grupoActual + '/creador'), snap => {
                        setCreadorGrupo(snap.val() || null);
                    });
                }
                // Lista de administradores del proyecto, gestionable desde Firebase
                // (appConfig/administradores) sin tener que tocar el código de la app.
                unsubAdmins = onValue(ref(db, 'appConfig/administradores'), snap => {
                    setAdministradores(snap.val() || {});
                });
            }
        }
        cargar();
        return () => {
            if (unsubInfoGrupo) unsubInfoGrupo();
            if (unsubCreador) unsubCreador();
            if (unsubAdmins) unsubAdmins();
        };
    }, []);

    function renderMiniCal(grupo, turno, mIdx) {
        const diasLibres = getDiasLibres(anio, grupo, turno) || {};
        const libres = diasLibres[mIdx] || [];
        const esp = getDiasEspeciales(anio, grupo, turno);
        const subgrupoMes = esp.subgrupo[mIdx] || [];
        const lrjMes = esp.lrj[mIdx] || [];
        const dias = getDiasEnMes(anio, mIdx);
        const start = getPrimerDia(anio, mIdx);
        const hoy = new Date();

        let celdas = [];
        for (let i = 0; i < start; i++) celdas.push(<View key={'e'+i} style={sc.celda} />);
        // (las casillas vacías del principio ocupan su hueco para que el día 1 caiga en su columna)
        for (let d = 1; d <= dias; d++) {
            const esLibre = libres.includes(d);
            const festivo = esFestivo(anio, mIdx, d);
            const esHoy = hoy.getFullYear() === anio && hoy.getMonth() === mIdx && hoy.getDate() === d;
            let bg = esLibre ? theme.celdaLibre : theme.celdaTrabajo;
            let tc = esLibre ? theme.celdaLibreTexto : theme.celdaTrabajoTexto;
            if (esLibre) {
                if (lrjMes.includes(d)) { bg = theme.celdaLrj; tc = theme.celdaLrjTexto; }
                else if (subgrupoMes.includes(d)) { bg = theme.celdaSubgrupo; tc = theme.celdaSubgrupoTexto; }
            }
            if (festivo) { bg = '#ef4444'; tc = esLibre ? '#fff' : '#000'; }
            celdas.push(
                <View key={d} style={sc.celda}>
                    <View style={[sc.celdaInterior, { backgroundColor: bg }, esHoy && sc.celdaHoy]}>
                        <Text style={[sc.celdaNum, { color: tc }, esHoy && { fontWeight: '900' }]}>{d}</Text>
                    </View>
                </View>
            );
        }
        return (
            <View key={mIdx} style={sc.mesCard}>
                <Text style={sc.mesNombre}>{mesesArr[mIdx]}</Text>
                <View style={sc.diasHeader}>
                    {['L','M','X','J','V','S','D'].map(d => <Text key={d} style={sc.diaLetra}>{d}</Text>)}
                </View>
                <View style={sc.grid}>{celdas}</View>
            </View>
        );
    }

    async function guardarEdicion() {
        if (!editNombre.trim()) { Alert.alert('Error', 'El nombre no puede estar vacío'); return; }
        const idTrim = editID.trim();
        if (!idTrim) { Alert.alert('Error', 'El ID no puede estar vacío'); return; }
        const errPerfil = validarPerfil(editPerfil);
        if (errPerfil) { Alert.alert('Error', errPerfil); return; }
        const miembroPerfil = perfilAMiembro(editPerfil);

        // Construir el objeto completo de miembros, indexado por ID, sin duplicados
        const miembrosObj = {};
        infoGrupo.forEach(p => { if (p && p.id) miembrosObj[p.id] = p; });

        // Si estamos editando un miembro existente y cambió de ID, eliminar el ID antiguo
        if (modalEditar.idx !== -1) {
            const original = infoGrupo[modalEditar.idx];
            if (original && original.id && original.id !== idTrim) {
                delete miembrosObj[original.id];
            }
        }

        miembrosObj[idTrim] = { n: editNombre.trim(), id: idTrim, ...miembroPerfil };

        await set(ref(db, 'grupos/' + sesion.grupoActual + '/miembros'), miembrosObj);

        // Si la persona editada soy yo, actualizo también mi sesión guardada en el móvil
        // (para que el calendario use enseguida el nuevo grupo/subgrupo).
        if (idTrim === sesion.miID) {
            const nuevaSesion = { ...sesion, miNombreCompleto: editNombre.trim(), miGrupoSesion: miembroPerfil.g, miTipoSesion: miembroPerfil.t, miPerfil: miembroPerfil };
            await AsyncStorage.setItem('sesion2026', JSON.stringify(nuevaSesion));
            setSesion(nuevaSesion);
            const raw = await AsyncStorage.getItem('misGrupos2026');
            const lista = raw ? JSON.parse(raw) : [];
            const i = lista.findIndex(g => g.codigo === sesion.grupoActual);
            if (i >= 0) {
                lista[i] = { ...lista[i], nombre: editNombre.trim(), tipo: miembroPerfil.t, grupoLibres: miembroPerfil.g, perfil: miembroPerfil };
                await AsyncStorage.setItem('misGrupos2026', JSON.stringify(lista));
            }
        }
        setModalEditar(null);
    }

    async function borrarMiembro(idx) {
        Alert.alert('🗑️ Borrar', '¿Eliminar este compañero del grupo?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Borrar', style: 'destructive', onPress: async () => {
                const miembrosObj = {};
                infoGrupo.forEach((p, i) => { if (p && p.id && i !== idx) miembrosObj[p.id] = p; });
                await set(ref(db, 'grupos/' + sesion.grupoActual + '/miembros'), miembrosObj);
            }}
        ]);
    }

    // Solo puede borrar el grupo quien lo creó, o alguien de la lista de administradores del proyecto.
    // Si el grupo es antiguo y no tiene "creador" guardado, solo un administrador puede borrarlo.
    const puedeBorrarGrupo = sesion && (
        !!administradores[sesion.miID] ||
        (creadorGrupo && sesion.miID === creadorGrupo)
    );

    function confirmarEliminarGrupo() {
        Alert.alert(
            '⚠️ Eliminar grupo',
            'Esto borrará el grupo para TODOS sus miembros: la lista de compañeros y el historial del chat. No se puede deshacer.\n\n¿Seguro que quieres continuar?',
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sí, borrar el grupo', style: 'destructive', onPress: () => {
                    // Segunda confirmación, por si acaso, al ser una acción irreversible para todos.
                    Alert.alert(
                        '¿Estás completamente seguro?',
                        'Esta acción es definitiva.',
                        [
                            { text: 'Cancelar', style: 'cancel' },
                            { text: 'Borrar definitivamente', style: 'destructive', onPress: eliminarGrupoDeVerdad }
                        ]
                    );
                }}
            ]
        );
    }

    async function eliminarGrupoDeVerdad() {
        const codigo = sesion.grupoActual;
        try {
            await remove(ref(db, 'grupos/' + codigo));
            await remove(ref(db, 'chats/' + codigo));
            await remove(ref(db, 'chatLeidos/' + codigo));
            await remove(ref(db, 'presencia/' + codigo));

            // Quitar el grupo de la lista de accesos rápidos guardada en este móvil
            const raw = await AsyncStorage.getItem('misGrupos2026');
            const lista = (raw ? JSON.parse(raw) : []).filter(g => g.codigo !== codigo);
            await AsyncStorage.setItem('misGrupos2026', JSON.stringify(lista));
            await AsyncStorage.removeItem('sesion2026');

            Alert.alert('✅ Grupo eliminado', 'El grupo se ha borrado correctamente.');
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        } catch (e) {
            Alert.alert('Error', 'No se ha podido borrar el grupo: ' + (e?.message || e));
        }
    }

    const sc = getStyles(theme);

    if (!sesion) return <ActivityIndicator style={{ flex: 1 }} color="#a78bfa" />;

    return (
        <View style={sc.container}>
            <View style={sc.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={sc.btnVolver}>
                    <Text style={sc.btnVolverTexto}>← Volver</Text>
                </TouchableOpacity>
                <Text style={sc.titulo}>📊 Grupos</Text>
                {/* Pestañas principales */}
                <View style={sc.mainTabs}>
                    <TouchableOpacity style={[sc.mainTab, tab === 'grupos' && sc.mainTabActive]} onPress={() => setTab('grupos')}>
                        <Text style={[sc.mainTabTexto, tab === 'grupos' && sc.mainTabTextoActive]}>📅 Calendarios</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[sc.mainTab, tab === 'info' && sc.mainTabActive]} onPress={() => setTab('info')}>
                        <Text style={[sc.mainTabTexto, tab === 'info' && sc.mainTabTextoActive]}>👥 Info grupo</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {tab === 'grupos' && (
                <View style={{ flex: 1 }}>
                    {/* Selector turno y año */}
                    <View style={sc.controlesCol}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sc.turnoTabsScroll}>
                            {SISTEMAS_CONDUCTORES.map(x => (
                                <TouchableOpacity key={x.id} style={[sc.turnoTab, sistemaTab === x.id && sc.turnoTabActive]} onPress={() => { setSistemaTab(x.id); setTurnoTab('A'); setGrupoSeleccionado(null); }}>
                                    <Text style={[sc.turnoTabTexto, sistemaTab === x.id && sc.turnoTabTextoActive]}>{x.nombre}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={sc.turnoTabsScroll}>
                            {subgruposDe(sistemaActual.grupos[0]).map(t => (
                                <TouchableOpacity key={t} style={[sc.turnoTab, turnoTab === t && sc.turnoTabActive]} onPress={() => { setTurnoTab(t); setGrupoSeleccionado(null); }}>
                                    <Text style={[sc.turnoTabTexto, turnoTab === t && sc.turnoTabTextoActive]}>{emojiTurno(t)} {t}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        <View style={sc.anioNav}>
                            <TouchableOpacity onPress={() => setAnio(anio - 1)} style={sc.anioBtn}>
                                <Text style={sc.anioBtnTexto}>◀</Text>
                            </TouchableOpacity>
                            <Text style={sc.anioTexto}>{anio}</Text>
                            <TouchableOpacity onPress={() => setAnio(anio + 1)} style={sc.anioBtn}>
                                <Text style={sc.anioBtnTexto}>▶</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Lista de grupos o calendario del grupo seleccionado */}
                    {!grupoSeleccionado ? (
                        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                            <View style={sc.gruposGrid}>
                                {sistemaActual.grupos.map(g => {
                                    const equipoParaContar = (sesion.modoGrupo ? infoGrupo : equipoBase) || [];
                                    const miembros = equipoParaContar.filter(p => p.g === g && p.t === turnoTab);
                                    return (
                                        <TouchableOpacity key={g} style={sc.grupoBtn} onPress={() => setGrupoSeleccionado(g)}>
                                            <Text style={sc.grupoBtnNum}>{nombreGrupo(g)}</Text>
                                            <Text style={sc.grupoBtnMiembros}>{miembros.length > 0 ? miembros.map(p => p.n.split(' ')[0]).join(', ') : 'Sin asignar'}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </ScrollView>
                    ) : (
                        <View style={{ flex: 1 }}>
                            <View style={sc.calHeader}>
                                <TouchableOpacity onPress={() => setGrupoSeleccionado(null)} style={sc.btnVolverCal}>
                                    <Text style={sc.btnVolverTexto}>← Grupos</Text>
                                </TouchableOpacity>
                                <Text style={sc.calTitulo}>{nombreGrupo(grupoSeleccionado)} · {sistemaTab === 'R' ? 'Código ' + grupoSeleccionado.slice(1) + turnoTab : 'Subgrupo ' + turnoTab}</Text>
                            </View>
                            <ScrollView showsVerticalScrollIndicator={false}>
                                {mesesArr.map((_, i) => renderMiniCal(grupoSeleccionado, turnoTab, i))}
                            </ScrollView>
                        </View>
                    )}
                </View>
            )}

            {tab === 'info' && (
                <View style={{ flex: 1 }}>
                    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, padding: 12 }} contentContainerStyle={{ paddingBottom: 100 }}>
                        <View style={sc.infoHeader}>
                            <Text style={sc.infoTitulo}>👥 Compañeros del grupo</Text>
                            <TouchableOpacity style={sc.btnAdd} onPress={() => {
                                setEditNombre(''); setEditID(''); setEditPerfil(PERFIL_VACIO);
                                setModalEditar({ idx: -1 });
                            }}>
                                <Text style={sc.btnAddTexto}>+ Añadir</Text>
                            </TouchableOpacity>
                        </View>
                        {sesion.grupoActual && (
                            <View style={sc.codigoCard}>
                                <Text style={sc.codigoLabel}>🔑 Código del grupo</Text>
                                <Text style={sc.codigoTexto}>{sesion.grupoActual}</Text>
                            </View>
                        )}
                        {infoGrupo.map((p, idx) => (
                            <View key={p.id} style={sc.miembroFila}>
                                <View style={sc.miembroInfo}>
                                    <Text style={sc.miembroNombre}>{p.n}</Text>
                                    <Text style={sc.miembroDetalle}>ID: {p.id} · {textoPerfil(p)}</Text>
                                </View>
                                <TouchableOpacity style={sc.btnEditar} onPress={() => {
                                    setEditNombre(p.n); setEditID(p.id);
                                    setEditPerfil({ g: String(p.g || ''), t: p.t || '', c: !!p.c, l: p.l || '', tu: p.tu || '', e: p.e || '' });
                                    setModalEditar({ idx });
                                }}>
                                    <Text style={sc.btnEditarTexto}>✏️</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={sc.btnEliminarRapido} onPress={() => borrarMiembro(idx)}>
                                    <Text style={sc.btnEditarTexto}>🗑️</Text>
                                </TouchableOpacity>
                            </View>
                        ))}

                        {puedeBorrarGrupo && (
                            <View style={sc.zonaPeligro}>
                                <Text style={sc.zonaPeligroTitulo}>⚠️ Zona de riesgo</Text>
                                <Text style={sc.zonaPeligroTexto}>
                                    Esto borra el grupo entero para todos sus miembros (compañeros y chat). No se puede deshacer.
                                </Text>
                                <TouchableOpacity style={sc.btnEliminarGrupo} onPress={confirmarEliminarGrupo}>
                                    <Text style={sc.btnEliminarGrupoTexto}>🗑️ Eliminar este grupo</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </ScrollView>
                </View>
            )}

            {/* Modal editar/añadir miembro */}
            <Modal transparent animationType="slide" visible={!!modalEditar} onRequestClose={() => setModalEditar(null)}>
                <View style={sc.overlay}>
                    <View style={[sc.modalCard, { maxHeight: '92%' }]}>
                      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                        <Text style={sc.modalTitulo}>{modalEditar?.idx === -1 ? '➕ Añadir compañero' : '✏️ Editar compañero'}</Text>
                        <Text style={sc.modalLabel}>Nombre</Text>
                        <TextInput style={sc.input} value={editNombre} onChangeText={setEditNombre} placeholder="Nombre completo" />
                        <Text style={sc.modalLabel}>Número de empleado</Text>
                        <TextInput style={sc.input} value={editID} onChangeText={setEditID} placeholder="Ej: 1234" keyboardType="numeric" />
                        <PerfilConductorForm value={editPerfil} onChange={setEditPerfil} />
                        <View style={sc.modalBtns}>
                            <TouchableOpacity style={sc.btnCancelar} onPress={() => setModalEditar(null)}>
                                <Text style={sc.btnCancelarTexto}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={sc.btnGuardar} onPress={guardarEdicion}>
                                <Text style={sc.btnGuardarTexto}>Guardar</Text>
                            </TouchableOpacity>
                        </View>
                        {modalEditar?.idx >= 0 && (
                            <TouchableOpacity style={sc.btnBorrar} onPress={() => { setModalEditar(null); borrarMiembro(modalEditar.idx); }}>
                                <Text style={sc.btnBorrarTexto}>🗑️ Eliminar del grupo</Text>
                            </TouchableOpacity>
                        )}
                      </ScrollView>
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
        btnVolver: { marginBottom: 6 },
        btnVolverTexto: { color: theme.headerTexto, fontWeight: '700', fontSize: 14 },
        titulo: { fontSize: 20, fontWeight: '900', color: theme.headerTexto, marginBottom: 10 },
        mainTabs: { flexDirection: 'row', gap: 8 },
        mainTab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: theme.isDark ? '#1e3a5f' : '#312e81' },
        mainTabActive: { backgroundColor: theme.primario },
        mainTabTexto: { color: theme.headerSub, fontWeight: '700', fontSize: 13 },
        mainTabTextoActive: { color: '#fff' },
        controles: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, backgroundColor: theme.card, borderBottomWidth: 1, borderBottomColor: theme.borde },
        controlesCol: { padding: 12, backgroundColor: theme.card, borderBottomWidth: 1, borderBottomColor: theme.borde },
        turnoTabs: { flexDirection: 'row', gap: 6 },
        turnoTabsScroll: { flexGrow: 0, marginBottom: 10 },
        turnoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
        turnoTabGrid: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9' },
        turnoTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9', marginRight: 6 },
        turnoTabActive: { backgroundColor: theme.primario },
        turnoTabTexto: { color: theme.textoSecundario, fontWeight: '700', fontSize: 12 },
        turnoTabTextoActive: { color: '#fff' },
        anioNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
        anioBtn: { backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
        anioBtnTexto: { color: theme.primario, fontSize: 14, fontWeight: '900' },
        anioTexto: { color: theme.texto, fontSize: 14, fontWeight: '900', marginHorizontal: 10 },
        gruposGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8 },
        grupoBtn: { width: (SW - 32) / 3, backgroundColor: theme.card, borderRadius: 12, padding: 10, elevation: 1, borderLeftWidth: 3, borderLeftColor: theme.primario },
        grupoBtnNum: { fontSize: 14, fontWeight: '900', color: theme.primario },
        grupoBtnMiembros: { fontSize: 11, color: theme.textoSecundario, marginTop: 2 },
        calHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: theme.card, borderBottomWidth: 1, borderBottomColor: theme.borde },
        btnVolverCal: { marginRight: 12 },
        calTitulo: { fontSize: 16, fontWeight: '800', color: theme.texto },
        mesCard: { backgroundColor: theme.card, margin: 10, borderRadius: 14, padding: 10, elevation: 1 },
        mesNombre: { fontSize: 14, fontWeight: '800', color: theme.texto, marginBottom: 6, textAlign: 'center' },
        diasHeader: { flexDirection: 'row', marginBottom: 2, width: CELDA * 7, alignSelf: 'center' },
        diaLetra: { width: CELDA, textAlign: 'center', fontSize: 10, fontWeight: '700', color: theme.textoTenue },
        grid: { flexDirection: 'row', flexWrap: 'wrap', width: CELDA * 7, alignSelf: 'center' },
        celda: { width: CELDA, height: CELDA, padding: 1.5 },
        celdaInterior: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
        celdaHoy: { borderWidth: 2, borderColor: theme.primario },
        celdaNum: { fontSize: 12, textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
        infoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
        infoTitulo: { fontSize: 16, fontWeight: '800', color: theme.texto },
        btnAdd: { backgroundColor: theme.primario, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
        btnAddTexto: { color: '#fff', fontWeight: '700', fontSize: 13 },
        miembroFila: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 12, padding: 12, marginBottom: 8, elevation: 1 },
        codigoCard: { backgroundColor: theme.isDark ? '#1e3a5f' : '#312e81', borderRadius: 12, padding: 14, marginBottom: 12 },
        codigoLabel: { color: '#a78bfa', fontSize: 12, fontWeight: '700', marginBottom: 4 },
        codigoTexto: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
        btnEliminarRapido: { padding: 6, marginLeft: 4 },
        miembroInfo: { flex: 1 },
        miembroNombre: { fontSize: 14, fontWeight: '700', color: theme.texto },
        miembroDetalle: { fontSize: 12, color: theme.textoSecundario, marginTop: 2 },
        btnEditar: { padding: 6 },
        btnEditarTexto: { fontSize: 18 },
        overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
        modalCard: { backgroundColor: theme.card, borderRadius: 20, padding: 20, width: '100%' },
        modalTitulo: { fontSize: 16, fontWeight: '900', color: theme.texto, marginBottom: 12, textAlign: 'center' },
        modalLabel: { fontSize: 12, fontWeight: '700', color: theme.textoSecundario, marginTop: 10, marginBottom: 4 },
        input: { borderWidth: 2, borderColor: theme.borde, borderRadius: 10, padding: 10, fontSize: 14, color: theme.texto },
        modalBtns: { flexDirection: 'row', gap: 8, marginTop: 16 },
        btnCancelar: { flex: 1, backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9', borderRadius: 10, padding: 12, alignItems: 'center' },
        btnCancelarTexto: { color: theme.textoSecundario, fontWeight: '700' },
        btnGuardar: { flex: 1, backgroundColor: theme.primario, borderRadius: 10, padding: 12, alignItems: 'center' },
        btnGuardarTexto: { color: '#fff', fontWeight: '700' },
        btnBorrar: { marginTop: 10, padding: 10, alignItems: 'center' },
        btnBorrarTexto: { color: '#ef4444', fontWeight: '700' },
        zonaPeligro: { marginTop: 24, padding: 16, borderRadius: 14, borderWidth: 2, borderColor: '#ef4444', backgroundColor: theme.isDark ? '#3b1414' : '#fef2f2' },
        zonaPeligroTitulo: { fontSize: 14, fontWeight: '900', color: '#ef4444', marginBottom: 6 },
        zonaPeligroTexto: { fontSize: 12, color: theme.textoSecundario, marginBottom: 12 },
        btnEliminarGrupo: { backgroundColor: '#ef4444', borderRadius: 12, padding: 14, alignItems: 'center' },
        btnEliminarGrupoTexto: { color: '#fff', fontWeight: '800', fontSize: 14 },
    });
}
