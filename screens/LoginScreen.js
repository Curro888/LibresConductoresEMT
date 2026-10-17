import React, { useState, useEffect } from 'react';
import {
    View, Text, TextInput, TouchableOpacity,
    StyleSheet, ScrollView, Alert, Keyboard
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { ref, get, set } from 'firebase/database';
import { equipoBase, TURNOS_DISPONIBLES } from '../config/datos';
import { withFirebaseErrorHandling } from '../utils/firebaseErrorHandler';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export default function LoginScreen({ navigation }) {
    const isConnected = useNetworkStatus(); // true/false en tiempo real

    const [modo, setModo] = useState(null);
    const [gruposGuardados, setGruposGuardados] = useState([]);

    const [userID, setUserID] = useState('');
    const [userPass, setUserPass] = useState('');

    const [grupoCodigo, setGrupoCodigo] = useState('');
    const [grupoPassword, setGrupoPassword] = useState('');
    const [grupoMiID, setGrupoMiID] = useState('');
    const [grupoMiNombre, setGrupoMiNombre] = useState('');
    const [grupoMiTipo, setGrupoMiTipo] = useState('');
    const [grupoMiGrupo, setGrupoMiGrupo] = useState('');

    const [nuevoGrupoNombre, setNuevoGrupoNombre] = useState('');
    const [nuevoGrupoPass, setNuevoGrupoPass] = useState('');
    const [nuevoGrupoPass2, setNuevoGrupoPass2] = useState('');
    const [nuevoMiNombre, setNuevoMiNombre] = useState('');
    const [nuevoMiID, setNuevoMiID] = useState('');
    const [nuevoMiTipo, setNuevoMiTipo] = useState('');
    const [nuevoMiGrupo, setNuevoMiGrupo] = useState('');

    useEffect(() => {
        async function cargar() {
            const raw = await AsyncStorage.getItem('misGrupos2026');
            const lista = raw ? JSON.parse(raw) : [];
            if (lista.length > 0) {
                setGruposGuardados(lista);
                setModo('selector');
            }
        }
        cargar();
    }, []);

    async function guardarGrupoEnLista(entrada) {
        const raw = await AsyncStorage.getItem('misGrupos2026');
        const lista = raw ? JSON.parse(raw) : [];
        const idx = lista.findIndex(g => g.codigo === entrada.codigo);
        if (idx >= 0) lista[idx] = entrada;
        else lista.push(entrada);
        await AsyncStorage.setItem('misGrupos2026', JSON.stringify(lista));
    }

    async function eliminarGrupoGuardado(codigo) {
        const raw = await AsyncStorage.getItem('misGrupos2026');
        const lista = (raw ? JSON.parse(raw) : []).filter(g => g.codigo !== codigo);
        await AsyncStorage.setItem('misGrupos2026', JSON.stringify(lista));
        setGruposGuardados(lista);
        if (lista.length === 0) setModo(null);
    }

    async function entrarDesdeSelector(g) {
        // Comprobamos que el grupo siga existiendo antes de entrar — si alguien lo ha
        // borrado (por ejemplo, desde el panel de administrador), lo quitamos del acceso
        // rápido en vez de dejar que la app se quede "atascada" en un grupo fantasma.
        const snap = await get(ref(db, `grupos/${g.codigo}`));
        if (!snap.exists()) {
            const raw = await AsyncStorage.getItem('misGrupos2026');
            const lista = (raw ? JSON.parse(raw) : []).filter(x => x.codigo !== g.codigo);
            await AsyncStorage.setItem('misGrupos2026', JSON.stringify(lista));
            setGruposGuardados(lista);
            if (lista.length === 0) setModo(null);
            Alert.alert('Grupo no disponible', 'Este grupo ya no existe (puede que se haya eliminado). Se ha quitado del acceso rápido.');
            return;
        }

        const sesion = {
            miID: g.id,
            miNombreCompleto: g.nombre,
            modoGrupo: true,
            grupoActual: g.codigo,
            miGrupoSesion: g.grupoLibres,
            miTipoSesion: g.tipo
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        navigation.replace('Main', sesion);
    }

    async function entrarIndividual() {
        const id = userID.trim();
        const pass = userPass.trim();
        const p = equipoBase.find(x => x.id === id);
        if (!p) { Alert.alert('Error', 'ID de empleado no encontrado'); return; }
        if (!pass) { Alert.alert('Error', 'Introduce una contraseña'); return; }
        const sesion = {
            miID: id,
            miNombreCompleto: p.n,
            modoGrupo: false,
            grupoActual: null,
            miGrupoSesion: p.g,
            miTipoSesion: p.t
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        navigation.replace('Main', sesion);
    }

    async function unirseGrupo() {
        if (!isConnected) { Alert.alert('Sin conexión', 'Necesitas internet para unirte a un grupo.'); return; }

        const codigo = grupoCodigo.trim();
        const pass = grupoPassword.trim();
        const miID = grupoMiID.trim();
        const miNombre = grupoMiNombre.trim();
        if (!codigo || !pass || !miID || !miNombre || !grupoMiTipo || !grupoMiGrupo) {
            Alert.alert('Error', 'Rellena todos los campos'); return;
        }

        let result;
        try {
            result = await withFirebaseErrorHandling(async () => {
                const snap = await get(ref(db, `grupos/${codigo}`));
                const grupo = snap.val();
                if (!grupo) { Alert.alert('Error', 'Grupo no encontrado. Revisa que el código esté bien escrito.'); return null; }
                if (grupo.pass !== pass) { Alert.alert('Error', 'Contraseña incorrecta'); return null; }

                await set(ref(db, `grupos/${codigo}/miembros/${miID}`), {
                    n: miNombre, id: miID, g: grupoMiGrupo, t: grupoMiTipo
                });
                return true;
            });
        } catch (e) {
            // Aviso temporal, solo para ver el motivo real si algo falla sin avisar — se quitará después
            Alert.alert('⚠️ Fallo al unirse', String(e?.code || e?.message || e));
            return;
        }

        if (!result) return; // error ya mostrado dentro del handler o validaciones internas

        const sesion = {
            miID, miNombreCompleto: miNombre,
            modoGrupo: true, grupoActual: codigo,
            miGrupoSesion: grupoMiGrupo, miTipoSesion: grupoMiTipo
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        await guardarGrupoEnLista({ codigo, id: miID, nombre: miNombre, tipo: grupoMiTipo, grupoLibres: grupoMiGrupo });
        navigation.replace('Main', sesion);
    }

    async function crearGrupo() {
        if (!isConnected) { Alert.alert('Sin conexión', 'Necesitas internet para crear un grupo.'); return; }

        const nombre = nuevoGrupoNombre.trim();
        const pass = nuevoGrupoPass.trim();
        const pass2 = nuevoGrupoPass2.trim();
        const miNom = nuevoMiNombre.trim();
        const miId = nuevoMiID.trim();
        if (!nombre || !pass || !miNom || !miId || !nuevoMiTipo || !nuevoMiGrupo) {
            Alert.alert('Error', 'Rellena todos los campos'); return;
        }
        if (pass !== pass2) { Alert.alert('Error', 'Las contraseñas no coinciden'); return; }

        const base = nombre.toLowerCase()
            .replace(/[^a-z0-9áéíóúüñ]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        const codigo = base + '_' + Date.now().toString(36);

        const result = await withFirebaseErrorHandling(async () => {
            const primerMiembro = { n: miNom, id: miId, g: nuevoMiGrupo, t: nuevoMiTipo };
            // Guardamos quién crea el grupo (creador), para poder permitir borrarlo más adelante
            // solo a esa persona (o al administrador de la app).
            await set(ref(db, `grupos/${codigo}`), {
                nombre, pass, creador: miId, miembros: { [miId]: primerMiembro }
            });
            return true;
        });

        if (!result) return;

        Alert.alert('✅ Grupo creado', `Código del grupo: ${codigo}\n\nGuárdalo para compartirlo con tus compañeros.`);

        const sesion = {
            miID: miId, miNombreCompleto: miNom,
            modoGrupo: true, grupoActual: codigo,
            miGrupoSesion: nuevoMiGrupo, miTipoSesion: nuevoMiTipo
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        await guardarGrupoEnLista({ codigo, id: miId, nombre: miNom, tipo: nuevoMiTipo, grupoLibres: nuevoMiGrupo });
        navigation.replace('Main', sesion);
    }

    return (
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
            <Text style={s.titulo}>📅 Libres EMT</Text>
            <Text style={s.subtitulo}>Planificación 2026</Text>

            {!isConnected && (
                <View style={s.bannerSinConexion}>
                    <Text style={s.bannerSinConexionTexto}>⚠️ Sin conexión a internet</Text>
                </View>
            )}

            {modo === 'selector' && (
                <View style={s.card}>
                    <Text style={s.cardTitulo}>Acceso rápido</Text>
                    {gruposGuardados.map(g => (
                        <View key={g.codigo} style={s.grupoFila}>
                            <TouchableOpacity style={s.grupoBtn} onPress={() => entrarDesdeSelector(g)}>
                                <Text style={s.grupoBtnTexto}>👥 {g.codigo}</Text>
                                <Text style={s.grupoBtnSub}>{g.nombre} · G{g.grupoLibres} · {g.tipo}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.grupoEliminar} onPress={() => Alert.alert('Eliminar', `¿Quitar "${g.codigo}" de la lista?`, [
                                { text: 'Cancelar', style: 'cancel' },
                                { text: 'Eliminar', style: 'destructive', onPress: () => eliminarGrupoGuardado(g.codigo) }
                            ])}>
                                <Text style={s.grupoEliminarTexto}>🗑️</Text>
                            </TouchableOpacity>
                        </View>
                    ))}
                    <View style={s.separador} />
                    <TouchableOpacity style={[s.btnGrande, { marginTop: 8 }]} onPress={() => setModo('grupoTipo')}>
                        <Text style={s.btnGrandeTexto}>➕ Otro grupo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.btnGrande, { marginTop: 8, borderColor: '#94a3b8' }]} onPress={() => setModo('individual')}>
                        <Text style={[s.btnGrandeTexto, { color: '#64748b' }]}>👤 Individual</Text>
                    </TouchableOpacity>
                </View>
            )}

            {!modo && (
                <View style={s.card}>
                    <TouchableOpacity style={s.btnGrande} onPress={() => setModo('individual')}>
                        <Text style={s.btnGrandeTexto}>👤 Individual</Text>
                        <Text style={s.btnGrandeSubtexto}>Solo para mí</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.btnGrande, { marginTop: 12 }]} onPress={() => setModo('grupoTipo')}>
                        <Text style={s.btnGrandeTexto}>👥 Grupo</Text>
                        <Text style={s.btnGrandeSubtexto}>Con compañeros</Text>
                    </TouchableOpacity>
                </View>
            )}

            {modo === 'individual' && (
                <View style={s.card}>
                    <Text style={s.label}>Tu número de empleado</Text>
                    <TextInput style={s.input} placeholder="Ej: 2669" keyboardType="numeric" value={userID} onChangeText={setUserID} />
                    <Text style={s.label}>Contraseña</Text>
                    <TextInput style={s.input} placeholder="Contraseña" secureTextEntry value={userPass} onChangeText={setUserPass} />
                    <TouchableOpacity style={s.btnPrimario} onPress={entrarIndividual}>
                        <Text style={s.btnPrimarioTexto}>Entrar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModo(gruposGuardados.length > 0 ? 'selector' : null)} style={s.btnVolver}>
                        <Text style={s.btnVolverTexto}>← Volver</Text>
                    </TouchableOpacity>
                </View>
            )}

            {modo === 'grupoTipo' && (
                <View style={s.card}>
                    <Text style={s.cardTitulo}>¿Qué quieres hacer?</Text>
                    <TouchableOpacity style={s.btnGrande} onPress={() => setModo('grupoExistente')}>
                        <Text style={s.btnGrandeTexto}>🔑 Unirme a un grupo existente</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.btnGrande, { marginTop: 12 }]} onPress={() => setModo('grupoNuevo')}>
                        <Text style={s.btnGrandeTexto}>✨ Crear un grupo nuevo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModo(gruposGuardados.length > 0 ? 'selector' : null)} style={s.btnVolver}>
                        <Text style={s.btnVolverTexto}>← Volver</Text>
                    </TouchableOpacity>
                </View>
            )}

            {modo === 'grupoExistente' && (
                <View style={s.card}>
                    <Text style={s.label}>Código del grupo</Text>
                    <TextInput style={s.input} placeholder="Ej: noche_abc123" value={grupoCodigo} onChangeText={setGrupoCodigo} autoCapitalize="none" />
                    <Text style={s.label}>Contraseña del grupo</Text>
                    <TextInput style={s.input} placeholder="Contraseña" secureTextEntry value={grupoPassword} onChangeText={setGrupoPassword} />

                    <Text style={[s.label, { marginTop: 16 }]}>Tus datos</Text>
                    <Text style={s.label}>Tu nombre</Text>
                    <TextInput style={s.input} placeholder="Ej: Curro" value={grupoMiNombre} onChangeText={setGrupoMiNombre} />
                    <Text style={s.label}>Tu número de empleado</Text>
                    <TextInput style={s.input} placeholder="Ej: 2669" keyboardType="numeric" value={grupoMiID} onChangeText={setGrupoMiID} />

                    <Text style={s.label}>Tu turno</Text>
                    <View style={s.opcionesGrid}>
                        {TURNOS_DISPONIBLES.map(t => (
                            <TouchableOpacity key={t} style={[s.opcionBtn, grupoMiTipo === t && s.opcionBtnActiva]} onPress={() => { Keyboard.dismiss(); setGrupoMiTipo(t); }}>
                                <Text style={[s.opcionBtnTexto, grupoMiTipo === t && s.opcionBtnTextoActiva]}>{t}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <Text style={s.label}>Tu grupo de libres</Text>
                    <View style={s.opcionesGrid}>
                        {Array.from({ length: 15 }, (_, i) => String(i + 1)).map(g => (
                            <TouchableOpacity key={g} style={[s.opcionBtnSmall, grupoMiGrupo === g && s.opcionBtnActiva]} onPress={() => { Keyboard.dismiss(); setGrupoMiGrupo(g); }}>
                                <Text style={[s.opcionBtnTexto, grupoMiGrupo === g && s.opcionBtnTextoActiva]}>{g}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <TouchableOpacity style={s.btnPrimario} onPress={unirseGrupo}>
                        <Text style={s.btnPrimarioTexto}>Entrar al grupo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModo('grupoTipo')} style={s.btnVolver}>
                        <Text style={s.btnVolverTexto}>← Volver</Text>
                    </TouchableOpacity>
                </View>
            )}

            {modo === 'grupoNuevo' && (
                <View style={s.card}>
                    <Text style={s.label}>Nombre del grupo</Text>
                    <TextInput style={s.input} placeholder="Ej: Noche grupo 4" value={nuevoGrupoNombre} onChangeText={setNuevoGrupoNombre} />
                    <Text style={s.label}>Contraseña del grupo</Text>
                    <TextInput style={s.input} placeholder="Contraseña" secureTextEntry value={nuevoGrupoPass} onChangeText={setNuevoGrupoPass} />
                    <Text style={s.label}>Repite la contraseña</Text>
                    <TextInput style={s.input} placeholder="Repite la contraseña" secureTextEntry value={nuevoGrupoPass2} onChangeText={setNuevoGrupoPass2} />

                    <Text style={[s.label, { marginTop: 16 }]}>Tus datos (primer miembro)</Text>
                    <Text style={s.label}>Tu nombre</Text>
                    <TextInput style={s.input} placeholder="Tu nombre" value={nuevoMiNombre} onChangeText={setNuevoMiNombre} />
                    <Text style={s.label}>Tu ID de empleado</Text>
                    <TextInput style={s.input} placeholder="Tu ID de empleado" keyboardType="numeric" value={nuevoMiID} onChangeText={setNuevoMiID} />

                    <Text style={s.label}>Tu turno</Text>
                    <View style={s.opcionesGrid}>
                        {TURNOS_DISPONIBLES.map(t => (
                            <TouchableOpacity key={t} style={[s.opcionBtn, nuevoMiTipo === t && s.opcionBtnActiva]} onPress={() => { Keyboard.dismiss(); setNuevoMiTipo(t); }}>
                                <Text style={[s.opcionBtnTexto, nuevoMiTipo === t && s.opcionBtnTextoActiva]}>{t}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <Text style={s.label}>Tu grupo de libres</Text>
                    <View style={s.opcionesGrid}>
                        {Array.from({ length: 15 }, (_, i) => String(i + 1)).map(g => (
                            <TouchableOpacity key={g} style={[s.opcionBtnSmall, nuevoMiGrupo === g && s.opcionBtnActiva]} onPress={() => { Keyboard.dismiss(); setNuevoMiGrupo(g); }}>
                                <Text style={[s.opcionBtnTexto, nuevoMiGrupo === g && s.opcionBtnTextoActiva]}>{g}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <TouchableOpacity style={s.btnPrimario} onPress={crearGrupo}>
                        <Text style={s.btnPrimarioTexto}>Crear grupo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModo('grupoTipo')} style={s.btnVolver}>
                        <Text style={s.btnVolverTexto}>← Volver</Text>
                    </TouchableOpacity>
                </View>
            )}
        </ScrollView>
    );
}

const s = StyleSheet.create({
    container: { flexGrow: 1, backgroundColor: '#1e1b4b', alignItems: 'center', justifyContent: 'center', padding: 24, paddingVertical: 50 },
    titulo: { fontSize: 32, fontWeight: '900', color: '#a78bfa', marginBottom: 4 },
    subtitulo: { fontSize: 14, color: '#c4b5fd', marginBottom: 32 },
    bannerSinConexion: { backgroundColor: '#ef4444', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, marginBottom: 16 },
    bannerSinConexionTexto: { color: '#fff', fontWeight: '700', fontSize: 13 },
    card: { backgroundColor: '#ffffff', borderRadius: 20, padding: 24, width: '100%', maxWidth: 380 },
    cardTitulo: { fontSize: 16, fontWeight: '900', color: '#1e1b4b', marginBottom: 12, textAlign: 'center' },
    grupoFila: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
    grupoBtn: { flex: 1, borderWidth: 2, borderColor: '#8b5cf6', borderRadius: 12, padding: 12 },
    grupoBtnTexto: { fontSize: 14, fontWeight: '800', color: '#7c3aed' },
    grupoBtnSub: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
    grupoEliminar: { padding: 8 },
    grupoEliminarTexto: { fontSize: 20 },
    separador: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 12 },
    label: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 6, marginTop: 12 },
    input: { borderWidth: 2, borderColor: '#ddd6fe', borderRadius: 12, padding: 14, fontSize: 16, color: '#1e1b4b', backgroundColor: '#faf9ff' },
    btnGrande: { borderWidth: 2, borderColor: '#8b5cf6', borderRadius: 14, padding: 16, alignItems: 'center' },
    btnGrandeTexto: { fontSize: 18, fontWeight: '800', color: '#7c3aed' },
    btnGrandeSubtexto: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
    btnPrimario: { backgroundColor: '#8b5cf6', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
    btnPrimarioTexto: { color: 'white', fontWeight: '800', fontSize: 16 },
    btnVolver: { alignItems: 'center', marginTop: 14 },
    btnVolverTexto: { color: '#8b5cf6', fontWeight: '700', fontSize: 14 },
    opcionesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
    opcionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
    opcionBtnSmall: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
    opcionBtnActiva: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
    opcionBtnTexto: { fontSize: 12, fontWeight: '700', color: '#64748b' },
    opcionBtnTextoActiva: { color: '#fff' },
});