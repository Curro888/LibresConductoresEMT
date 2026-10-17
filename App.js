import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, ActivityIndicator, Alert, Platform, Linking, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import LoginScreen from './screens/LoginScreen';
import CalendarioScreen from './screens/CalendarioScreen';
import CompanerosScreen from './screens/CompanerosScreen';
import HistorialScreen from './screens/HistorialScreen';
import AjustesScreen from './screens/AjustesScreen';
import CalendarioCompaneroScreen from './screens/CalendarioCompaneroScreen';
import GruposScreen from './screens/GruposScreen';
import AdminScreen from './screens/AdminScreen';
import EstadisticasScreen from './screens/EstadisticasScreen';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { db, auth } from './config/firebase';
import { ref, onValue } from 'firebase/database';
import { signInAnonymously } from 'firebase/auth';
import { registerForPushNotificationsAsync, addNotificationListeners } from './services/notifications'; // push
import { APP_VERSION } from './config/version';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ emoji, focused, badge }) {
    return (
        <View>
            <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
            {badge > 0 && (
                <View style={{
                    position: 'absolute', top: -4, right: -8,
                    backgroundColor: '#ef4444', borderRadius: 8,
                    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3
                }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>{badge > 99 ? '99+' : badge}</Text>
                </View>
            )}
        </View>
    );
}

// Aviso — se muestra una sola vez por instalación — para pedir que se excluya la app
// del ahorro de batería, ya que en Xiaomi/Redmi/POCO (MIUI) esto bloquea los avisos
// del chat y de los cambios cuando el móvil está bloqueado.
async function mostrarAvisoBateriaSiProcede() {
    if (Platform.OS !== 'android') return;
    try {
        const yaVisto = await AsyncStorage.getItem('avisoBateriaMostrado');
        if (yaVisto) return;
        await AsyncStorage.setItem('avisoBateriaMostrado', 'true');

        Alert.alert(
            '🔋 Un paso más para los avisos',
            'Para que te lleguen bien los avisos de cambios y solicitudes (sobre todo con el móvil bloqueado), este teléfono necesita que excluyas "Libres EMT" del ahorro de batería.\n\n¿Quieres abrir esos ajustes ahora?',
            [
                { text: 'Más tarde', style: 'cancel' },
                { text: 'Abrir ajustes', onPress: () => {
                    try {
                        Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
                    } catch (e) {
                        Linking.openSettings();
                    }
                }}
            ]
        );
    } catch (e) {
        // Si algo falla al mostrar el aviso, no interrumpimos el uso de la app
    }
}

function MainTabs({ route }) {
    const sesion = route.params;
    const { theme } = useTheme();
    const [versionDisponible, setVersionDisponible] = useState(null);

    // Comprueba en Firebase si hay una versión más reciente que la instalada
    useEffect(() => {
        const unsub = onValue(ref(db, 'appConfig/ultimaVersion'), snap => {
            const ultima = snap.val();
            if (ultima && ultima !== APP_VERSION) setVersionDisponible(ultima);
            else setVersionDisponible(null);
        });
        return () => unsub();
    }, []);

    // Registro de push token al entrar en Main con sesión activa
    useEffect(() => {
        if (!sesion?.miID) return;
        registerForPushNotificationsAsync(sesion.miID);
        const unsubscribe = addNotificationListeners(
            () => {}, // notificación recibida en foreground
            () => {}  // usuario pulsó la notificación
        );
        return unsubscribe;
    }, [sesion?.miID]);

    // Aviso de batería — una sola vez por instalación
    useEffect(() => {
        mostrarAvisoBateriaSiProcede();
    }, []);

    // Quita los avisos de la barra de notificaciones cada vez que se abre o se vuelve a la app
    useEffect(() => {
        Notifications.dismissAllNotificationsAsync().catch(() => {});
        const listener = AppState.addEventListener('change', (estado) => {
            if (estado === 'active') {
                Notifications.dismissAllNotificationsAsync().catch(() => {});
            }
        });
        return () => listener.remove();
    }, []);

    return (
        <View style={{ flex: 1 }}>
            {versionDisponible && (
                <View style={{ backgroundColor: '#7c3aed', paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', paddingTop: 44 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center' }}>
                        🔄 Hay una versión nueva ({versionDisponible}). Pide el APK actualizado.
                    </Text>
                </View>
            )}
            <Tab.Navigator
                screenOptions={{
                    headerShown: false,
                    tabBarStyle: {
                        backgroundColor: theme.headerFondo,
                        borderTopColor: theme.isDark ? '#2e2a4a' : '#4c1d95',
                        height: 95,
                        paddingBottom: 40
                    },
                    tabBarActiveTintColor: theme.headerTexto,
                    tabBarInactiveTintColor: '#6b7280',
                    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' }
                }}
            >
                <Tab.Screen name="Turnos" component={CalendarioScreen}
                    options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="📅" focused={focused} /> }} />
                <Tab.Screen name="Compañeros" component={CompanerosScreen}
                    options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="👥" focused={focused} /> }} />
                <Tab.Screen name="Historial" component={HistorialScreen}
                    options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} /> }} />
                <Tab.Screen name="Ajustes" component={AjustesScreen}
                    initialParams={sesion}
                    options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" focused={focused} /> }} />
            </Tab.Navigator>
        </View>
    );
}

function AppContent() {
    const [loading, setLoading] = useState(true);
    const [sesionInicial, setSesionInicial] = useState(null);
    const { theme } = useTheme();

    useEffect(() => {
        async function cargarSesion() {
            try {
                // Login "silencioso" ante Firebase: no pide nada nuevo a la persona, solo
                // identifica el aparato para que las reglas de seguridad puedan exigirlo.
                try { await signInAnonymously(auth); } catch (e) {}

                const raw = await AsyncStorage.getItem('sesion2026');
                if (raw) {
                    const s = JSON.parse(raw);
                    if (s && s.miID) setSesionInicial(s);
                }
            } catch(e) {}
            setLoading(false);
        }
        cargarSesion();
    }, []);

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.headerFondo }}>
                <ActivityIndicator size="large" color="#a78bfa" />
            </View>
        );
    }

    return (
        <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={sesionInicial ? 'Main' : 'Login'}>
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="CalendarioCompanero" component={CalendarioCompaneroScreen} />
                <Stack.Screen name="Main" component={MainTabs} initialParams={sesionInicial} />
                <Stack.Screen name="Grupos" component={GruposScreen} />
                <Stack.Screen name="Admin" component={AdminScreen} />
                <Stack.Screen name="Estadisticas" component={EstadisticasScreen} />
            </Stack.Navigator>
        </NavigationContainer>
    );
}

export default function App() {
    return (
        <ThemeProvider>
            <AppContent />
        </ThemeProvider>
    );
}