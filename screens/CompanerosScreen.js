import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Image, Alert, TextInput
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { db } from '../config/firebase';
import { ref, onValue } from 'firebase/database';
import { equipoBase, mesesArr, diasSemanaArr, getDiasLibres, leerDia } from '../config/datos';
import { textoPerfil } from '../components/PerfilConductorForm';
import { useTheme } from '../context/ThemeContext';

function esLibreHoy(grupo, turno, mIdx, d, cambios) {
    const anio = new Date().getFullYear();
    const diasLibres = getDiasLibres(anio, grupo, turno);
    let esLibre = diasLibres && (diasLibres[mIdx] || []).includes(d);
    const cambio = leerDia(cambios, anio, mIdx, d);
    if (cambio) {
        if (cambio.clase === 'b-cambio-libre' || cambio.clase === 'b-vac') esLibre = true;
        else if (cambio.clase === 'b-inter') esLibre = false;
    }
    return esLibre;
}

export default function CompanerosScreen({ navigation }) {
    const { theme } = useTheme();
    const [sesion, setSesion] = useState(null);
    const [cambiosTodos, setCambiosTodos] = useState({});
    const [presencias, setPresencias] = useState({});
    const [miembrosGrupo, setMiembrosGrupo] = useState(null); // null = cargando/no modo grupo

    // Fotos personalizadas: solo se guardan en este móvil (AsyncStorage), nunca en Firebase.
    // Cada persona ve las fotos que ella misma ha puesto, no las que hayan puesto los demás.
    const [fotos, setFotos] = useState({});
    const [busqueda, setBusqueda] = useState('');
    // Foto de perfil propia, la misma que se pone en Ajustes
    const [fotoPerfil, setFotoPerfil] = useState(null);

    useEffect(() => {
        let unsubCambiosTodos, unsubPresencias, unsubMiembros;
        async function cargar() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (raw) {
                const s = JSON.parse(raw);
                setSesion(s);
                unsubCambiosTodos = onValue(ref(db, 'cambios'), snap => setCambiosTodos(snap.val() || {}));
                if (s.modoGrupo && s.grupoActual) {
                    unsubPresencias = onValue(ref(db, 'presencia/' + s.grupoActual), snap => setPresencias(snap.val() || {}));
                    unsubMiembros = onValue(ref(db, 'grupos/' + s.grupoActual + '/miembros'), snap => {
                        const data = snap.val() || {};
                        // Los miembros pueden estar como objeto {id: {...}} o array
                        const lista = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
                        setMiembrosGrupo(lista);
                    });
                }
            }
            const fotosRaw = await AsyncStorage.getItem('fotosCompaneros');
            if (fotosRaw) setFotos(JSON.parse(fotosRaw));
            const fotoPerfilRaw = await AsyncStorage.getItem('fotoPerfil');
            if (fotoPerfilRaw) setFotoPerfil(fotoPerfilRaw);
        }
        cargar();
        return () => {
            if (unsubCambiosTodos) unsubCambiosTodos();
            if (unsubPresencias) unsubPresencias();
            if (unsubMiembros) unsubMiembros();
        };
    }, []);

    // Si el perfil se cambia en Ajustes o en Grupos, recargar la sesión al volver a esta pantalla
    useFocusEffect(
        useCallback(() => {
            (async () => {
                try {
                    const sRaw = await AsyncStorage.getItem('sesion2026');
                    if (!sRaw) return;
                    const nueva = JSON.parse(sRaw);
                    setSesion(prev => (
                        prev &&
                        prev.miGrupoSesion === nueva.miGrupoSesion &&
                        prev.miTipoSesion === nueva.miTipoSesion &&
                        JSON.stringify(prev.miPerfil) === JSON.stringify(nueva.miPerfil)
                    ) ? prev : { ...prev, ...nueva });
                } catch (e) { /* se mantiene la sesión actual */ }
            })();
        }, [])
    );

    async function elegirFoto(id) {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permiso denegado', 'Necesitamos acceso a tu galería para poner la foto.'); return; }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 1,
        });
        if (result.canceled) return;

        const comprimida = await ImageManipulator.manipulateAsync(
            result.assets[0].uri,
            [{ resize: { width: 150 } }],
            { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        const base64 = 'data:image/jpeg;base64,' + comprimida.base64;
        const nuevasFotos = { ...fotos, [id]: base64 };
        setFotos(nuevasFotos);
        await AsyncStorage.setItem('fotosCompaneros', JSON.stringify(nuevasFotos));
    }

    async function quitarFoto(id) {
        const nuevasFotos = { ...fotos };
        delete nuevasFotos[id];
        setFotos(nuevasFotos);
        await AsyncStorage.setItem('fotosCompaneros', JSON.stringify(nuevasFotos));
    }

    function opcionesFoto(p) {
        if (p.id === sesion.miID) return; // la foto propia se cambia desde Ajustes, no aquí
        const opciones = fotos[p.id]
            ? [
                { text: 'Cambiar foto', onPress: () => elegirFoto(p.id) },
                { text: 'Quitar foto', style: 'destructive', onPress: () => quitarFoto(p.id) },
                { text: 'Cancelar', style: 'cancel' }
              ]
            : [
                { text: 'Poner foto', onPress: () => elegirFoto(p.id) },
                { text: 'Cancelar', style: 'cancel' }
              ];
        Alert.alert(p.n, 'Esta foto solo la verás tú, en tu propio móvil.', opciones);
    }

    const hoy = new Date();
    const mIdx = hoy.getMonth();
    const d = hoy.getDate();

    const equipoActual = useMemo(() => {
        if (!sesion) return [];
        if (sesion.modoGrupo) return miembrosGrupo || [];
        return equipoBase;
    }, [sesion, miembrosGrupo]);

    const listaCompaneros = useMemo(() => {
        if (!sesion) return [];
        const esCT = sesion.modoGrupo && sesion.grupoActual === 'CT';
        let base = equipoActual;
        if (esCT) {
            const q = busqueda.trim();
            if (q) base = base.filter(p => String(p.id || '').indexOf(q) >= 0);
            const num = (x) => /^[0-9]+$/.test(String(x || '')) ? parseInt(x, 10) : 1e9;
            base = [...base].sort((a, b) => num(a.e) - num(b.e));
        }
        return base.map(p => {
            const esMio = p.id === sesion.miID;
            const cambios = cambiosTodos[p.id] || {};
            const esLibre = esLibreHoy(p.g, p.t, mIdx, d, cambios);
            const conectado = presencias[p.id] && (Date.now() - presencias[p.id].ts) < 120000;
            return { p, esMio, esLibre, conectado };
        });
    }, [cambiosTodos, presencias, sesion, mIdx, d, equipoActual, busqueda]);

    const s = getStyles(theme);

    if (!sesion) return <ActivityIndicator style={{ flex: 1 }} color="#a78bfa" />;

    return (
        <View style={s.container}>
            <View style={s.header}>
                <View style={s.headerTopRow}>
                    <View>
                        <Text style={s.titulo}>👥 Compañeros</Text>
                        <Text style={s.sub}>Hoy es {diasSemanaArr[hoy.getDay()]}, {d} de {mesesArr[mIdx]}</Text>
                    </View>
                    <View style={{ flexDirection: 'row' }}>
                        <TouchableOpacity style={[s.btnGrupos, { marginRight: 8 }]} onPress={() => navigation.navigate('Estadisticas')}>
                            <Text style={s.btnGruposTexto}>📊 Stats</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.btnGrupos} onPress={() => navigation.navigate('Grupos')}>
                            <Text style={s.btnGruposTexto}>👥 Grupos</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
            {sesion.modoGrupo && sesion.grupoActual === 'CT' && (
                <TextInput
                    style={{ backgroundColor: theme.card, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 16, marginBottom: 8, color: theme.texto, fontSize: 15 }}
                    placeholder="🔎 Buscar por número de empleado"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    value={busqueda}
                    onChangeText={setBusqueda}
                />
            )}
            <ScrollView showsVerticalScrollIndicator={false}>
                {listaCompaneros.map(({ p, esMio, esLibre, conectado }) => {
                    const foto = esMio ? fotoPerfil : fotos[p.id];
                    return (
                        <View key={p.id} style={[s.fila, esMio && s.filaMia]}>
                            <TouchableOpacity
                                style={s.badgeWrap}
                                onPress={() => opcionesFoto(p)}
                                activeOpacity={esMio ? 1 : 0.6}
                            >
                                <View style={[s.badge, { backgroundColor: esLibre ? theme.celdaLibre : theme.primarioClaro }]}>
                                    {foto
                                        ? <Image source={{ uri: foto }} style={s.badgeFoto} />
                                        : <Text style={{ fontSize: 18 }}>{esLibre ? '🏠' : '🚌'}</Text>
                                    }
                                </View>
                            </TouchableOpacity>
                            <View style={s.info}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={[s.nombre, esMio && { color: '#7c3aed' }]}>
                                        {p.n} {esMio ? '(yo)' : ''}
                                    </Text>
                                    {conectado && <View style={s.puntito} />}
                                </View>
                                <Text style={s.detalle}>
                                    🚌 {sesion.grupoActual === 'CT' && sesion.modoGrupo
                                        ? `Emp. ${p.id} · Esc. ${p.e || '—'} · ${p.g ? 'Grupo ' + p.g + (p.t ? ' ' + p.t : '') : 'sin grupo'}`
                                        : textoPerfil(p)} · {esLibre ? 'Libra' : 'Trabaja'}
                                </Text>
                            </View>
                            <View style={[s.estadoIcono, { backgroundColor: esLibre ? theme.celdaLibre : theme.primarioClaro }]}>
                                <Text style={{ fontSize: 18 }}>{esLibre ? '🏠' : '🚌'}</Text>
                            </View>
                            <TouchableOpacity
                                style={s.btnCal}
                                onPress={() => esMio
                                    ? navigation.navigate('Turnos')
                                    : navigation.navigate('CalendarioCompanero', { uid: p.id })}
                            >
                                <Text style={s.btnCalTexto}>📅</Text>
                            </TouchableOpacity>
                        </View>
                    );
                })}
            </ScrollView>
        </View>
    );
}

function getStyles(theme) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.fondo },
        header: { backgroundColor: theme.headerFondo, padding: 16, paddingTop: 50 },
        headerTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        btnGrupos: { backgroundColor: theme.primario, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
        btnGruposTexto: { color: '#fff', fontWeight: '800', fontSize: 13 },
        titulo: { fontSize: 20, fontWeight: '900', color: theme.headerTexto },
        sub: { fontSize: 12, color: theme.headerSub, marginTop: 2 },
        fila: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, marginHorizontal: 12, marginTop: 8, borderRadius: 14, padding: 12, elevation: 1 },
        filaMia: { borderWidth: 2, borderColor: '#a78bfa' },
        badgeWrap: { width: 44, height: 44, marginRight: 12 },
        badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
        badgeFoto: { width: 44, height: 44, borderRadius: 22 },
        estadoIcono: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
        info: { flex: 1 },
        nombre: { fontSize: 14, fontWeight: '700', color: theme.texto },
        detalle: { fontSize: 12, color: theme.textoSecundario, marginTop: 2 },
        puntito: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e', marginLeft: 6 },
        btnCal: { backgroundColor: theme.isDark ? '#1e3a5f' : '#f5f3ff', borderRadius: 10, padding: 8 },
        btnCalTexto: { fontSize: 20 },
    });
}