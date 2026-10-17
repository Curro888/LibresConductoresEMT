import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    ActivityIndicator, Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { ref, onValue, remove, get, update } from 'firebase/database';
import { leerDia } from '../config/datos';
import { useTheme } from '../context/ThemeContext';

export default function AdminScreen({ navigation }) {
    const { theme } = useTheme();
    const [sesion, setSesion] = useState(null);
    const [grupos, setGrupos] = useState(null); // null = cargando
    const [migrando, setMigrando] = useState(false);

    useEffect(() => {
        let unsubGrupos;
        async function cargar() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (raw) setSesion(JSON.parse(raw));
            // Solo lectura de todos los grupos — no afecta ni modifica nada del resto de la app.
            unsubGrupos = onValue(ref(db, 'grupos'), snap => {
                const data = snap.val() || {};
                const lista = Object.entries(data).map(([codigo, g]) => ({
                    codigo,
                    nombre: g.nombre || codigo,
                    creador: g.creador || null,
                    numMiembros: g.miembros ? Object.keys(g.miembros).length : 0
                }));
                lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
                setGrupos(lista);
            });
        }
        cargar();
        return () => { if (unsubGrupos) unsubGrupos(); };
    }, []);

    function confirmarEliminar(grupo) {
        Alert.alert(
            '⚠️ Eliminar grupo',
            `Vas a borrar el grupo "${grupo.nombre}" (${grupo.numMiembros} miembros).\n\nEsto borra el grupo para TODOS sus miembros: la lista de compañeros y el historial del chat. No se puede deshacer.\n\n¿Seguro que quieres continuar?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sí, borrar el grupo', style: 'destructive', onPress: () => {
                    Alert.alert(
                        '¿Estás completamente seguro?',
                        `Vas a borrar "${grupo.nombre}" de forma definitiva.`,
                        [
                            { text: 'Cancelar', style: 'cancel' },
                            { text: 'Borrar definitivamente', style: 'destructive', onPress: () => eliminarGrupo(grupo) }
                        ]
                    );
                }}
            ]
        );
    }

    async function eliminarGrupo(grupo) {
        try {
            await remove(ref(db, 'grupos/' + grupo.codigo));
            await remove(ref(db, 'chats/' + grupo.codigo));
            await remove(ref(db, 'chatLeidos/' + grupo.codigo));
            await remove(ref(db, 'presencia/' + grupo.codigo));

            // Quitar siempre el acceso rápido de este grupo en este móvil, sea o no
            // la sesión que tienes abierta ahora mismo.
            const raw = await AsyncStorage.getItem('misGrupos2026');
            const listaSinGrupo = (raw ? JSON.parse(raw) : []).filter(g => g.codigo !== grupo.codigo);
            await AsyncStorage.setItem('misGrupos2026', JSON.stringify(listaSinGrupo));

            // Si el grupo borrado es en el que tienes la sesión abierta ahora mismo,
            // hay que cerrarla también aquí para no quedarte "dentro" de un grupo que ya no existe.
            if (sesion?.grupoActual === grupo.codigo) {
                await AsyncStorage.removeItem('sesion2026');
                Alert.alert('✅ Grupo eliminado', 'Era tu grupo actual, así que se ha cerrado tu sesión.');
                navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
                return;
            }

            Alert.alert('✅ Grupo eliminado', `"${grupo.nombre}" se ha borrado correctamente.`);
        } catch (e) {
            Alert.alert('Error', 'No se ha podido borrar el grupo: ' + (e?.message || e));
        }
    }

    function confirmarLimpieza() {
        Alert.alert(
            '🧹 Limpiar solicitudes resueltas',
            'Cada solicitud de cambio con compañero se borra sola en cuanto la persona que la pidió abre la app después de que se acepte o rechace. Si esa persona no ha vuelto a abrir la app, se queda huérfana en la base de datos sin que nadie la use.\n\nEsto borra todas las que ya estén aceptadas o rechazadas, sean de cuando sean. Las que sigan pendientes no se tocan.\n\n¿Continuar?',
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sí, limpiar', onPress: ejecutarLimpieza }
            ]
        );
    }

    async function ejecutarLimpieza() {
        setMigrando(true);
        try {
            const snap = await get(ref(db, 'solicitudes'));
            const datos = snap.val() || {};
            const updates = {};
            let total = 0;

            for (const key of Object.keys(datos)) {
                const sol = datos[key];
                if (sol && sol.estado !== 'pendiente') {
                    updates[`solicitudes/${key}`] = null;
                    total++;
                }
            }

            if (total > 0) {
                await update(ref(db), updates);
            }

            Alert.alert('✅ Limpieza completada', `Solicitudes huérfanas borradas: ${total}`);
        } catch (e) {
            Alert.alert('Error', 'No se ha podido completar la limpieza: ' + (e?.message || e));
        } finally {
            setMigrando(false);
        }
    }

    function confirmarLimpiezaFestivos() {
        Alert.alert(
            '🧹 Limpiar festivos duplicados',
            'Borra, para TODOS los usuarios: 1) las tarjetas de festivo antiguas con el nombre real de la fiesta (ya no se generan), y 2) las genéricas ("Festivo trabajado/librado") que caigan en un día que ya era de vacaciones — ese festivo ya lo cubre el generado por vacaciones, así que sobra la genérica. Las que ya estén usadas, o cualquier otra tarjeta que hayas añadido tú a mano, nunca se tocan.\n\n¿Continuar?',
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sí, limpiar', onPress: ejecutarLimpiezaFestivos }
            ]
        );
    }

    async function ejecutarLimpiezaFestivos() {
        setMigrando(true);
        try {
            const snapHistorial = await get(ref(db, 'historial2'));
            const datos = snapHistorial.val() || {};
            const snapCambios = await get(ref(db, 'cambios'));
            const cambiosTodos = snapCambios.val() || {};
            const updates = {};
            let total = 0;

            for (const uid of Object.keys(datos)) {
                const entradas = datos[uid] || {};
                const cambiosUsuario = cambiosTodos[uid] || {};

                for (const key of Object.keys(entradas)) {
                    const item = entradas[key];
                    if (!item) continue;
                    if (item.usado) continue; // por seguridad, nunca borramos una ya usada

                    // "festivo" = formato antiguo, con el nombre real de la fiesta (Año Nuevo, etc.)
                    // "festivo_auto" = formato nuevo, genérico ("Festivo trabajado/librado").
                    if (item.subtipo === 'festivo') {
                        updates[`historial2/${uid}/${key}`] = null;
                        total++;
                        continue;
                    }

                    // Además, si la genérica "festivo_auto" cayó en un día que ya era de
                    // vacaciones, sobra: ese festivo ya lo cubre el generado por vacaciones.
                    if (item.subtipo === 'festivo_auto') {
                        const partes = String(item.fecha).split('/');
                        const dia = parseInt(partes[0]), mIdx = parseInt(partes[1]) - 1, anio = parseInt(partes[2]) || 2026;
                        const cambioDia = leerDia(cambiosUsuario, anio, mIdx, dia);
                        if (cambioDia && cambioDia.clase === 'b-vac') {
                            updates[`historial2/${uid}/${key}`] = null;
                            total++;
                        }
                    }
                }
            }

            if (total > 0) {
                await update(ref(db), updates);
            }

            Alert.alert('✅ Limpieza completada', `Tarjetas de festivo duplicadas borradas: ${total}`);
        } catch (e) {
            Alert.alert('Error', 'No se ha podido completar la limpieza: ' + (e?.message || e));
        } finally {
            setMigrando(false);
        }
    }

    function confirmarRegenerarEneroMayo() {
        Alert.alert(
            '🧹 Regenerar festivos (ene-may)',
            'Borra, para TODOS los usuarios, los festivos generados (genéricos o con nombre) entre el 1 de enero y el 15 de mayo de 2026 que todavía no se hayan usado. Los que ya estén usados no se tocan.\n\nDespués, la próxima vez que cada persona abra Historial, se volverán a generar solos, ya correctamente (sin duplicar los que coincidan con vacaciones).\n\n¿Continuar?',
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sí, borrar', onPress: ejecutarRegenerarEneroMayo }
            ]
        );
    }

    async function ejecutarRegenerarEneroMayo() {
        setMigrando(true);
        try {
            const snap = await get(ref(db, 'historial2'));
            const datos = snap.val() || {};
            const updates = {};
            let total = 0;

            const limite = new Date(2026, 4, 15); // 15 de mayo de 2026
            limite.setHours(23, 59, 59, 999);

            for (const uid of Object.keys(datos)) {
                const entradas = datos[uid] || {};
                for (const key of Object.keys(entradas)) {
                    const item = entradas[key];
                    if (!item) continue;
                    if (item.subtipo !== 'festivo' && item.subtipo !== 'festivo_auto') continue;
                    if (item.usado) continue; // por seguridad, nunca borramos una ya usada

                    const partes = String(item.fecha).split('/');
                    const dia = parseInt(partes[0]);
                    const mIdx = parseInt(partes[1]) - 1;
                    const anio = parseInt(partes[2]) || 2026; // las antiguas sin año, asumimos 2026
                    const fecha = new Date(anio, mIdx, dia);

                    if (fecha <= limite) {
                        updates[`historial2/${uid}/${key}`] = null;
                        total++;
                    }
                }
            }

            if (total > 0) {
                await update(ref(db), updates);
            }

            Alert.alert('✅ Hecho', `Festivos sin usar borrados (se regenerarán solos): ${total}`);
        } catch (e) {
            Alert.alert('Error', 'No se ha podido completar: ' + (e?.message || e));
        } finally {
            setMigrando(false);
        }
    }

    function confirmarBorrarMisEneroMayo() {
        Alert.alert(
            '🧹 Borrar mis festivos (ene-15 may)',
            'Borra tus tarjetas "Festivo trabajado/librado" desde el 1 de enero hasta el 15 de mayo de 2026 que todavía NO estén usadas. Las que ya tengas usadas no se tocan. Solo afecta a tu propio usuario, no a tus compañeros.\n\n¿Continuar?',
            [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Sí, borrar', onPress: ejecutarBorrarMisEneroMayo }
            ]
        );
    }

    async function ejecutarBorrarMisEneroMayo() {
        if (!sesion?.miID) return;
        setMigrando(true);
        try {
            const snap = await get(ref(db, 'historial2/' + sesion.miID));
            const entradas = snap.val() || {};
            const updates = {};
            let total = 0;

            const limite = new Date(2026, 4, 15);
            limite.setHours(23, 59, 59, 999);

            for (const key of Object.keys(entradas)) {
                const item = entradas[key];
                if (!item || item.subtipo !== 'festivo_auto') continue;
                if (item.usado) continue; // no tocar las que ya estén usadas

                const partes = String(item.fecha).split('/');
                const dia = parseInt(partes[0]);
                const mIdx = parseInt(partes[1]) - 1;
                const anio = parseInt(partes[2]) || 2026;
                const fecha = new Date(anio, mIdx, dia);

                if (fecha <= limite) {
                    updates[`historial2/${sesion.miID}/${key}`] = null;
                    updates[`festivosDescartados/${sesion.miID}/${anio}_${mIdx + 1}_${dia}`] = true;
                    total++;
                }
            }

            if (total > 0) {
                await update(ref(db), updates);
            }

            Alert.alert('✅ Hecho', `Tus festivos de enero-15 mayo borrados: ${total}`);
        } catch (e) {
            Alert.alert('Error', 'No se ha podido completar: ' + (e?.message || e));
        } finally {
            setMigrando(false);
        }
    }

    const s = getStyles(theme);

    return (
        <View style={s.container}>
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.btnVolver}>
                    <Text style={s.btnVolverTexto}>← Volver</Text>
                </TouchableOpacity>
                <Text style={s.titulo}>🛠️ Panel de administrador</Text>
                <Text style={s.sub}>Todos los grupos de la app</Text>
                <TouchableOpacity
                    style={[s.btnMigrar, migrando && { opacity: 0.6 }]}
                    onPress={confirmarLimpieza}
                    disabled={migrando}
                >
                    {migrando
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={s.btnMigrarTexto}>🧹 Limpiar solicitudes resueltas</Text>
                    }
                </TouchableOpacity>
                <TouchableOpacity
                    style={[s.btnMigrar, { marginTop: 8 }, migrando && { opacity: 0.6 }]}
                    onPress={confirmarLimpiezaFestivos}
                    disabled={migrando}
                >
                    {migrando
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={s.btnMigrarTexto}>🧹 Limpiar festivos duplicados</Text>
                    }
                </TouchableOpacity>
                <TouchableOpacity
                    style={[s.btnMigrar, { marginTop: 8 }, migrando && { opacity: 0.6 }]}
                    onPress={confirmarRegenerarEneroMayo}
                    disabled={migrando}
                >
                    {migrando
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={s.btnMigrarTexto}>🧹 Regenerar festivos (ene-may)</Text>
                    }
                </TouchableOpacity>
                <TouchableOpacity
                    style={[s.btnMigrar, { marginTop: 8, backgroundColor: '#b91c1c' }, migrando && { opacity: 0.6 }]}
                    onPress={confirmarBorrarMisEneroMayo}
                    disabled={migrando}
                >
                    {migrando
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={s.btnMigrarTexto}>🧹 Borrar MIS festivos (ene-15 may)</Text>
                    }
                </TouchableOpacity>
            </View>

            {grupos === null ? (
                <ActivityIndicator style={{ flex: 1 }} color="#a78bfa" />
            ) : (
                <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 }}>
                    {grupos.length === 0 && <Text style={s.vacio}>No hay ningún grupo creado todavía.</Text>}
                    {grupos.map(g => (
                        <View key={g.codigo} style={s.grupoCard}>
                            <View style={s.grupoInfo}>
                                <Text style={s.grupoNombre}>{g.nombre}</Text>
                                <Text style={s.grupoDetalle}>Código: {g.codigo}</Text>
                                <Text style={s.grupoDetalle}>👥 {g.numMiembros} miembro{g.numMiembros === 1 ? '' : 's'}</Text>
                                {sesion?.grupoActual === g.codigo && (
                                    <Text style={s.grupoActualEtiqueta}>📍 Tu grupo actual</Text>
                                )}
                            </View>
                            <TouchableOpacity style={s.btnBorrar} onPress={() => confirmarEliminar(g)}>
                                <Text style={s.btnBorrarTexto}>🗑️</Text>
                            </TouchableOpacity>
                        </View>
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

function getStyles(theme) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.fondo },
        header: { backgroundColor: theme.headerFondo, padding: 16, paddingTop: 50 },
        btnVolver: { marginBottom: 6 },
        btnVolverTexto: { color: theme.headerTexto, fontWeight: '700', fontSize: 14 },
        titulo: { fontSize: 20, fontWeight: '900', color: theme.headerTexto },
        sub: { fontSize: 12, color: theme.headerSub, marginTop: 2 },
        btnMigrar: { backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginTop: 12, alignItems: 'center' },
        btnMigrarTexto: { color: '#fff', fontWeight: '800', fontSize: 13 },
        vacio: { color: theme.textoTenue, fontStyle: 'italic', textAlign: 'center', marginTop: 30 },
        grupoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.card, borderRadius: 14, padding: 14, marginBottom: 10, elevation: 1 },
        grupoInfo: { flex: 1 },
        grupoNombre: { fontSize: 15, fontWeight: '800', color: theme.texto },
        grupoDetalle: { fontSize: 12, color: theme.textoSecundario, marginTop: 2 },
        grupoActualEtiqueta: { fontSize: 12, color: '#7c3aed', fontWeight: '700', marginTop: 4 },
        btnBorrar: { backgroundColor: '#fee2e2', borderRadius: 10, padding: 10 },
        btnBorrarTexto: { fontSize: 18 },
    });
}