import React, { useState, useEffect } from 'react';
import {
    View, Text, TextInput, TouchableOpacity,
    StyleSheet, ScrollView, Alert, Keyboard
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { ref, get, set, update } from 'firebase/database';
import PerfilConductorForm, { PERFIL_VACIO, PERFIL_PERSONALES, PERFIL_CORRETURNOS, CODIGO_CORRETURNOS, escalafonValido, validarPerfil, perfilAMiembro, textoPerfil } from '../components/PerfilConductorForm';
import { etiquetaGrupo } from '../config/libresConductores';
import { CODIGO_PERSONALES } from '../config/personales';
import { withFirebaseErrorHandling } from '../utils/firebaseErrorHandler';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export default function LoginScreen({ navigation }) {
    const isConnected = useNetworkStatus(); // true/false en tiempo real

    const [modo, setModo] = useState(null);
    const [gruposGuardados, setGruposGuardados] = useState([]);

    // Modo individual (solo para mí, sin grupo)
    const [indNombre, setIndNombre] = useState('');
    const [indID, setIndID] = useState('');
    const [perfilInd, setPerfilInd] = useState(PERFIL_VACIO);

    // Correturnos (grupo abierto, ordenado por escalafón)
    const [ctNombre, setCtNombre] = useState('');
    const [ctID, setCtID] = useState('');
    const [perfilCT, setPerfilCT] = useState(PERFIL_CORRETURNOS);

    // Personales (grupo abierto: autobuses que llevan y traen a los compañeros, por cochera)
    const [peNombre, setPeNombre] = useState('');
    const [peID, setPeID] = useState('');
    const [perfilPE, setPerfilPE] = useState(PERFIL_PERSONALES);

    // Unirse a un grupo existente
    const [grupoCodigo, setGrupoCodigo] = useState('');
    const [grupoPassword, setGrupoPassword] = useState('');
    const [grupoMiID, setGrupoMiID] = useState('');
    const [grupoMiNombre, setGrupoMiNombre] = useState('');
    const [perfilExistente, setPerfilExistente] = useState(PERFIL_VACIO);

    // Crear un grupo nuevo
    const [nuevoGrupoNombre, setNuevoGrupoNombre] = useState('');
    const [nuevoGrupoPass, setNuevoGrupoPass] = useState('');
    const [nuevoGrupoPass2, setNuevoGrupoPass2] = useState('');
    const [nuevoMiNombre, setNuevoMiNombre] = useState('');
    const [nuevoMiID, setNuevoMiID] = useState('');
    const [perfilNuevo, setPerfilNuevo] = useState(PERFIL_VACIO);

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
            miTipoSesion: g.tipo,
            miPerfil: g.perfil || null
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        navigation.replace('Main', sesion);
    }

    async function entrarIndividual() {
        const nombre = indNombre.trim();
        const id = indID.trim();
        if (!nombre || !id) { Alert.alert('Error', 'Escribe tu nombre y tu número de empleado'); return; }
        const errPerfil = validarPerfil(perfilInd);
        if (errPerfil) { Alert.alert('Error', errPerfil); return; }
        const m = perfilAMiembro(perfilInd);
        const sesion = {
            miID: id,
            miNombreCompleto: nombre,
            modoGrupo: false,
            grupoActual: null,
            miGrupoSesion: m.g,
            miTipoSesion: m.t,
            miPerfil: m
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
        if (!codigo || !pass || !miID || !miNombre) {
            Alert.alert('Error', 'Rellena todos los campos'); return;
        }
        const errPerfil = validarPerfil(perfilExistente);
        if (errPerfil) { Alert.alert('Error', errPerfil); return; }
        const miembroPerfil = perfilAMiembro(perfilExistente);

        let result;
        try {
            result = await withFirebaseErrorHandling(async () => {
                const snap = await get(ref(db, `grupos/${codigo}`));
                const grupo = snap.val();
                if (!grupo) { Alert.alert('Error', 'Grupo no encontrado. Revisa que el código esté bien escrito.'); return null; }
                if (grupo.pass !== pass) { Alert.alert('Error', 'Contraseña incorrecta'); return null; }

                await set(ref(db, `grupos/${codigo}/miembros/${miID}`), {
                    n: miNombre, id: miID, ...miembroPerfil
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
            miGrupoSesion: miembroPerfil.g, miTipoSesion: miembroPerfil.t, miPerfil: miembroPerfil
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        await guardarGrupoEnLista({ codigo, id: miID, nombre: miNombre, tipo: miembroPerfil.t, grupoLibres: miembroPerfil.g, perfil: miembroPerfil });
        navigation.replace('Main', sesion);
    }

    async function entrarCorreturnos() {
        if (!isConnected) { Alert.alert('Sin conexión', 'Necesitas internet para entrar en Correturnos.'); return; }
        const nombre = ctNombre.trim();
        const id = ctID.trim();
        if (!nombre || !id) { Alert.alert('Error', 'Escribe tu nombre y tu número de empleado'); return; }
        const errPerfil = validarPerfil(perfilCT);
        if (errPerfil) { Alert.alert('Error', errPerfil); return; }
        if (!escalafonValido(perfilCT.e)) { Alert.alert('Error', 'Escribe tu escalafón en la empresa (solo el número)'); return; }
        const m = { ...perfilAMiembro({ ...perfilCT, c: true }), c: true };

        const result = await withFirebaseErrorHandling(async () => {
            const snap = await get(ref(db, `grupos/${CODIGO_CORRETURNOS}`));
            const g = snap.val();
            // El grupo se crea la primera vez que alguien entra (sin contraseña, es abierto).
            if (!g || !g.nombre) {
                await update(ref(db, `grupos/${CODIGO_CORRETURNOS}`), { nombre: 'Correturnos', pass: '', creador: id });
            }
            await set(ref(db, `grupos/${CODIGO_CORRETURNOS}/miembros/${id}`), { n: nombre, id, ...m });
            return true;
        });
        if (!result) return;

        const sesion = {
            miID: id, miNombreCompleto: nombre,
            modoGrupo: true, grupoActual: CODIGO_CORRETURNOS,
            miGrupoSesion: m.g, miTipoSesion: m.t, miPerfil: m
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        await guardarGrupoEnLista({ codigo: CODIGO_CORRETURNOS, id, nombre, tipo: m.t, grupoLibres: m.g, perfil: m });
        navigation.replace('Main', sesion);
    }

    async function entrarPersonales() {
        if (!isConnected) { Alert.alert('Sin conexión', 'Necesitas internet para entrar en Personales.'); return; }
        const nombre = peNombre.trim();
        const id = peID.trim();
        if (!nombre || !id) { Alert.alert('Error', 'Escribe tu nombre y tu número de empleado'); return; }
        const errPerfil = validarPerfil(perfilPE);
        if (errPerfil) { Alert.alert('Error', errPerfil); return; }
        if (!perfilPE.pe) { Alert.alert('Error', 'Elige tu cochera y tu personal'); return; }
        const m = perfilAMiembro({ ...perfilPE, c: false });

        const result = await withFirebaseErrorHandling(async () => {
            const snap = await get(ref(db, `grupos/${CODIGO_PERSONALES}`));
            const g = snap.val();
            // El grupo se crea la primera vez que alguien entra (sin contraseña, es abierto).
            if (!g || !g.nombre) {
                await update(ref(db, `grupos/${CODIGO_PERSONALES}`), { nombre: 'Personales', pass: '', creador: id });
            }
            await set(ref(db, `grupos/${CODIGO_PERSONALES}/miembros/${id}`), { n: nombre, id, ...m });
            return true;
        });
        if (!result) return;

        const sesion = {
            miID: id, miNombreCompleto: nombre,
            modoGrupo: true, grupoActual: CODIGO_PERSONALES,
            miGrupoSesion: m.g, miTipoSesion: m.t, miPerfil: m
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        await guardarGrupoEnLista({ codigo: CODIGO_PERSONALES, id, nombre, tipo: m.t, grupoLibres: m.g, perfil: m });
        navigation.replace('Main', sesion);
    }

    async function crearGrupo() {
        if (!isConnected) { Alert.alert('Sin conexión', 'Necesitas internet para crear un grupo.'); return; }

        const nombre = nuevoGrupoNombre.trim();
        const pass = nuevoGrupoPass.trim();
        const pass2 = nuevoGrupoPass2.trim();
        const miNom = nuevoMiNombre.trim();
        const miId = nuevoMiID.trim();
        if (!nombre || !pass || !miNom || !miId) {
            Alert.alert('Error', 'Rellena todos los campos'); return;
        }
        const errPerfil = validarPerfil(perfilNuevo);
        if (errPerfil) { Alert.alert('Error', errPerfil); return; }
        const miembroPerfil = perfilAMiembro(perfilNuevo);
        if (pass !== pass2) { Alert.alert('Error', 'Las contraseñas no coinciden'); return; }

        const base = nombre.toLowerCase()
            .replace(/[^a-z0-9áéíóúüñ]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
        const codigo = base + '_' + Date.now().toString(36);

        const result = await withFirebaseErrorHandling(async () => {
            const primerMiembro = { n: miNom, id: miId, ...miembroPerfil };
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
            miGrupoSesion: miembroPerfil.g, miTipoSesion: miembroPerfil.t, miPerfil: miembroPerfil
        };
        await AsyncStorage.setItem('sesion2026', JSON.stringify(sesion));
        await guardarGrupoEnLista({ codigo, id: miId, nombre: miNom, tipo: miembroPerfil.t, grupoLibres: miembroPerfil.g, perfil: miembroPerfil });
        navigation.replace('Main', sesion);
    }

    return (
        <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
            <Text style={s.titulo}>🚌 Libres Conductores</Text>
            <Text style={s.subtitulo}>EMT · Planificación 2027</Text>

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
                                <Text style={s.grupoBtnSub}>{g.nombre} · {g.perfil ? textoPerfil(g.perfil) : etiquetaGrupo(g.grupoLibres, g.tipo)}</Text>
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
                    <TouchableOpacity style={[s.btnGrande, { marginTop: 8 }]} onPress={() => setModo('correturnos')}>
                        <Text style={s.btnGrandeTexto}>🔁 Correturnos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.btnGrande, { marginTop: 8 }]} onPress={() => setModo('personales')}>
                        <Text style={s.btnGrandeTexto}>🚐 Personales</Text>
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
                    <TouchableOpacity style={[s.btnGrande, { marginTop: 12 }]} onPress={() => setModo('correturnos')}>
                        <Text style={s.btnGrandeTexto}>🔁 Correturnos</Text>
                        <Text style={s.btnGrandeSubtexto}>Todos los correturnos, por escalafón</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.btnGrande, { marginTop: 12 }]} onPress={() => setModo('personales')}>
                        <Text style={s.btnGrandeTexto}>🚐 Personales</Text>
                        <Text style={s.btnGrandeSubtexto}>Los autobuses de personal, por cocheras</Text>
                    </TouchableOpacity>
                </View>
            )}

            {modo === 'individual' && (
                <View style={s.card}>
                    <Text style={s.label}>Tu nombre</Text>
                    <TextInput style={s.input} placeholder="Ej: Curro" value={indNombre} onChangeText={setIndNombre} />
                    <Text style={s.label}>Tu número de empleado</Text>
                    <TextInput style={s.input} placeholder="Ej: 1234" keyboardType="numeric" value={indID} onChangeText={setIndID} />
                    <PerfilConductorForm value={perfilInd} onChange={setPerfilInd} />
                    <TouchableOpacity style={s.btnPrimario} onPress={entrarIndividual}>
                        <Text style={s.btnPrimarioTexto}>Entrar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModo(gruposGuardados.length > 0 ? 'selector' : null)} style={s.btnVolver}>
                        <Text style={s.btnVolverTexto}>← Volver</Text>
                    </TouchableOpacity>
                </View>
            )}

            {modo === 'correturnos' && (
                <View style={s.card}>
                    <Text style={s.cardTitulo}>🔁 Correturnos</Text>
                    <Text style={s.label}>Tu nombre</Text>
                    <TextInput style={s.input} placeholder="Ej: Curro" value={ctNombre} onChangeText={setCtNombre} />
                    <Text style={s.label}>Tu número de empleado</Text>
                    <TextInput style={s.input} placeholder="Ej: 1234" keyboardType="numeric" value={ctID} onChangeText={setCtID} />
                    <PerfilConductorForm value={perfilCT} onChange={setPerfilCT} soloCorreturnos />
                    <TouchableOpacity style={s.btnPrimario} onPress={entrarCorreturnos}>
                        <Text style={s.btnPrimarioTexto}>Entrar en Correturnos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModo(gruposGuardados.length > 0 ? 'selector' : null)} style={s.btnVolver}>
                        <Text style={s.btnVolverTexto}>← Volver</Text>
                    </TouchableOpacity>
                </View>
            )}

            {modo === 'personales' && (
                <View style={s.card}>
                    <Text style={s.cardTitulo}>🚐 Personales</Text>
                    <Text style={s.label}>Tu nombre</Text>
                    <TextInput style={s.input} placeholder="Ej: Curro" value={peNombre} onChangeText={setPeNombre} />
                    <Text style={s.label}>Tu número de empleado</Text>
                    <TextInput style={s.input} placeholder="Ej: 1234" keyboardType="numeric" value={peID} onChangeText={setPeID} />
                    <PerfilConductorForm value={perfilPE} onChange={setPerfilPE} soloPersonales />
                    <TouchableOpacity style={s.btnPrimario} onPress={entrarPersonales}>
                        <Text style={s.btnPrimarioTexto}>Entrar en Personales</Text>
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
                    <TextInput style={s.input} placeholder="Ej: 1234" keyboardType="numeric" value={grupoMiID} onChangeText={setGrupoMiID} />

                    <PerfilConductorForm value={perfilExistente} onChange={setPerfilExistente} />

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

                    <PerfilConductorForm value={perfilNuevo} onChange={setPerfilNuevo} />

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