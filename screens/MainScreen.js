import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { etiquetaGrupo } from '../config/libresConductores';

export default function MainScreen({ navigation, route }) {
    const sesion = route.params;

    async function cerrarSesion() {
        await AsyncStorage.removeItem('sesion2026');
        navigation.replace('Login');
    }

    return (
        <View style={s.container}>
            <Text style={s.titulo}>👤 {sesion.miNombreCompleto}</Text>
            <Text style={s.sub}>{etiquetaGrupo(sesion.miGrupoSesion, sesion.miTipoSesion)}</Text>
            <Text style={s.sub}>{sesion.modoGrupo ? '👥 Modo grupo' : '👤 Modo individual'}</Text>
            <TouchableOpacity style={s.btn} onPress={cerrarSesion}>
                <Text style={s.btnTexto}>Cerrar sesión</Text>
            </TouchableOpacity>
        </View>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f5f3ff', alignItems: 'center', justifyContent: 'center', padding: 24 },
    titulo: { fontSize: 24, fontWeight: '900', color: '#7c3aed', marginBottom: 8 },
    sub: { fontSize: 14, color: '#64748b', marginBottom: 4 },
    btn: { marginTop: 32, backgroundColor: '#ef4444', borderRadius: 12, padding: 14, paddingHorizontal: 32 },
    btnTexto: { color: 'white', fontWeight: '800', fontSize: 16 }
});