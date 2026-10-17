import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Paletas de color: claro y oscuro
const LIGHT = {
    fondo: '#f5f3ff',
    headerFondo: '#1e1b4b',
    headerTexto: '#a78bfa',
    headerSub: '#c4b5fd',
    card: '#ffffff',
    texto: '#1e1b4b',
    textoSecundario: '#64748b',
    textoTenue: '#94a3b8',
    borde: '#e2e8f0',
    primario: '#7c3aed',
    primarioClaro: '#ede9fe',
    celdaLibre: '#fee2e2',
    celdaLibreTexto: '#991b1b',
    celdaTrabajo: '#f1f5f9',
    celdaTrabajoTexto: '#334155',
    isDark: false,
};

const DARK = {
    fondo: '#0f0f1a',
    headerFondo: '#1a1a2e',
    headerTexto: '#a78bfa',
    headerSub: '#9994cc',
    card: '#2e3250',
    texto: '#e2e0ff',
    textoSecundario: '#9994cc',
    textoTenue: '#9994cc',
    borde: '#3b3460',
    primario: '#a78bfa',
    primarioClaro: '#1e3a5f',
    celdaLibre: '#4a2828',
    celdaLibreTexto: '#fca5a5',
    celdaTrabajo: '#2a3245',
    celdaTrabajoTexto: '#a8b8cc',
    isDark: true,
};

const ThemeContext = createContext({ theme: LIGHT, modoOscuro: false, toggleModoOscuro: () => {} });

export function ThemeProvider({ children }) {
    const [modoOscuro, setModoOscuro] = useState(false);
    const [cargado, setCargado] = useState(false);

    useEffect(() => {
        async function cargar() {
            const raw = await AsyncStorage.getItem('modoOscuro');
            setModoOscuro(raw === 'true');
            setCargado(true);
        }
        cargar();
    }, []);

    async function toggleModoOscuro(valor) {
        setModoOscuro(valor);
        await AsyncStorage.setItem('modoOscuro', valor ? 'true' : 'false');
    }

    const theme = modoOscuro ? DARK : LIGHT;

    if (!cargado) return null; // Evita parpadeo claro->oscuro al abrir

    return (
        <ThemeContext.Provider value={{ theme, modoOscuro, toggleModoOscuro }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
