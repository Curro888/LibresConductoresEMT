import React, { useState, useEffect, useMemo } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../config/firebase';
import { ref, onValue } from 'firebase/database';
import { anioInicial, mesesArr, getDiasLibres, esDiaLibre, leerDia } from '../config/datos';
import { useTheme } from '../context/ThemeContext';

export default function EstadisticasScreen({ navigation }) {
    const { theme } = useTheme();
    const [sesion, setSesion] = useState(null);
    const [cambios, setCambios] = useState({});
    const [anio, setAnio] = useState(anioInicial());

    useEffect(() => {
        let unsubCambios;
        async function cargar() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (raw) {
                const s = JSON.parse(raw);
                setSesion(s);
                unsubCambios = onValue(ref(db, 'cambios/' + s.miID), snap => setCambios(snap.val() || {}));
            }
        }
        cargar();
        return () => { if (unsubCambios) unsubCambios(); };
    }, []);

    // Calcula, mes a mes, cuántos días se trabajan de cada tipo (laborable, sábado, domingo).
    // Recorre cada día del año mirando primero el patrón de turno, y luego si hay algún
    // cambio guardado ese día (vacaciones, cambio con compañero, generado, L-26...) que
    // cambie si se trabaja o no. Así, cualquier cosa que se marque en el calendario de
    // ese mes se ve reflejada aquí automáticamente.
    const filas = useMemo(() => {
        if (!sesion) return [];
        const grupo = sesion.miGrupoSesion;
        const turno = sesion.miTipoSesion;
        const diasLibresBase = getDiasLibres(anio, grupo, turno) || {};

        return mesesArr.map((nombreMes, mIdx) => {
            const diasEnMes = new Date(anio, mIdx + 1, 0).getDate();
            let laborables = 0, sabados = 0, domingos = 0;

            for (let d = 1; d <= diasEnMes; d++) {
                const esLibrePorTurno = (diasLibresBase[mIdx] || []).includes(d);
                const cambio = leerDia(cambios, anio, mIdx, d);
                const libre = esDiaLibre(esLibrePorTurno, cambio);
                if (libre) continue; // ese día no se trabaja, no cuenta

                const diaSemana = new Date(anio, mIdx, d).getDay(); // 0 = domingo, 6 = sábado
                if (diaSemana === 0) domingos++;
                else if (diaSemana === 6) sabados++;
                else laborables++;
            }
            return { mes: nombreMes, laborables, sabados, domingos, total: laborables + sabados + domingos };
        });
    }, [sesion, cambios, anio]);

    const totales = useMemo(() => filas.reduce((acc, f) => ({
        laborables: acc.laborables + f.laborables,
        sabados: acc.sabados + f.sabados,
        domingos: acc.domingos + f.domingos,
        total: acc.total + f.total
    }), { laborables: 0, sabados: 0, domingos: 0, total: 0 }), [filas]);

    const s = getStyles(theme);

    if (!sesion) return <ActivityIndicator style={{ flex: 1 }} color="#a78bfa" />;

    return (
        <View style={s.container}>
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.btnVolver}>
                    <Text style={s.btnVolverTexto}>← Volver</Text>
                </TouchableOpacity>
                <Text style={s.titulo}>📊 Días trabajados por mes</Text>
                <View style={s.selectorAnio}>
                    <TouchableOpacity onPress={() => setAnio(a => a - 1)} style={s.btnAnio}>
                        <Text style={s.btnAnioTexto}>◀</Text>
                    </TouchableOpacity>
                    <Text style={s.anioTexto}>{anio}</Text>
                    <TouchableOpacity onPress={() => setAnio(a => a + 1)} style={s.btnAnio}>
                        <Text style={s.btnAnioTexto}>▶</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 60 }}>
                <View style={s.filaCabecera}>
                    <Text style={[s.celda, s.celdaMes, s.textoCabecera]}>Mes</Text>
                    <Text style={[s.celda, s.textoCabecera]}>Laborab.</Text>
                    <Text style={[s.celda, s.textoCabecera]}>Sáb.</Text>
                    <Text style={[s.celda, s.textoCabecera]}>Dom.</Text>
                    <Text style={[s.celda, s.textoCabecera]}>Total</Text>
                </View>

                {filas.map((f, i) => (
                    <View key={i} style={s.fila}>
                        <Text style={[s.celda, s.celdaMes]}>{f.mes}</Text>
                        <Text style={s.celda}>{f.laborables}</Text>
                        <Text style={s.celda}>{f.sabados}</Text>
                        <Text style={s.celda}>{f.domingos}</Text>
                        <Text style={[s.celda, s.celdaTotal]}>{f.total}</Text>
                    </View>
                ))}

                <View style={[s.fila, s.filaTotales]}>
                    <Text style={[s.celda, s.celdaMes, s.textoTotales]}>Total año</Text>
                    <Text style={[s.celda, s.textoTotales]}>{totales.laborables}</Text>
                    <Text style={[s.celda, s.textoTotales]}>{totales.sabados}</Text>
                    <Text style={[s.celda, s.textoTotales]}>{totales.domingos}</Text>
                    <Text style={[s.celda, s.celdaTotal, s.textoTotales]}>{totales.total}</Text>
                </View>
            </ScrollView>
        </View>
    );
}

function getStyles(theme) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.fondo },
        header: { backgroundColor: theme.headerFondo, padding: 16, paddingTop: 50 },
        btnVolver: { marginBottom: 6 },
        btnVolverTexto: { color: theme.headerTexto, fontWeight: '700', fontSize: 14 },
        titulo: { fontSize: 19, fontWeight: '900', color: theme.headerTexto },
        selectorAnio: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
        btnAnio: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: theme.isDark ? '#2e2a4a' : '#6d28d9', borderRadius: 8 },
        btnAnioTexto: { color: '#fff', fontWeight: '900', fontSize: 14 },
        anioTexto: { color: theme.headerTexto, fontWeight: '900', fontSize: 16, marginHorizontal: 16 },
        filaCabecera: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: theme.isDark ? '#2e2a4a' : '#c4b5fd' },
        fila: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.isDark ? '#2e2a4a' : '#e5e7eb' },
        filaTotales: { borderTopWidth: 2, borderTopColor: theme.isDark ? '#2e2a4a' : '#c4b5fd', marginTop: 4 },
        celda: { flex: 1, textAlign: 'center', fontSize: 13, color: theme.texto },
        celdaMes: { flex: 1.3, textAlign: 'left', fontWeight: '700' },
        celdaTotal: { fontWeight: '900', color: '#7c3aed' },
        textoCabecera: { fontWeight: '900', color: theme.textoSecundario, fontSize: 11, textTransform: 'uppercase' },
        textoTotales: { fontWeight: '900', color: theme.texto },
    });
}