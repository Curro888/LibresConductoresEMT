import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, StyleSheet, Alert, BackHandler, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import { useTheme } from '../context/ThemeContext';

const URL_EMT = 'https://miestacion.emtmadrid.es/';
const K_USER = 'emt_user';
const K_PASS = 'emt_pass';

// Rellena usuario y contraseña en el login de la web de la empresa y pulsa Entrar.
function scriptRelleno(u, p) {
    return `(function(){
        try {
            var pw = document.querySelector('input[type=password]');
            if (!pw) return;
            var us = null;
            var all = Array.prototype.slice.call(document.querySelectorAll('input'));
            for (var i = all.indexOf(pw) - 1; i >= 0; i--) {
                var t = (all[i].type || 'text').toLowerCase();
                if (t === 'text' || t === 'email' || t === 'tel' || t === 'number') { us = all[i]; break; }
            }
            function poner(el, v) {
                el.focus(); el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (us) poner(us, ${JSON.stringify(u)});
            poner(pw, ${JSON.stringify(p)});
            var f = pw.form;
            var b = (f && f.querySelector('input[type=submit],button[type=submit],button,input[type=button]')) ||
                    document.querySelector('input[type=submit],button[type=submit]');
            if (b) { b.click(); } else if (f) { f.submit(); }
        } catch (e) {}
    })(); true;`;
}

export default function WebEMTScreen({ navigation }) {
    const { theme } = useTheme();
    const web = useRef(null);
    const intentos = useRef(0);
    const [creds, setCreds] = useState(null);      // {u, p} o null
    const [cargado, setCargado] = useState(false);
    const [modal, setModal] = useState(false);
    const [u, setU] = useState('');
    const [p, setP] = useState('');
    const [puedeAtras, setPuedeAtras] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const cu = await SecureStore.getItemAsync(K_USER);
                const cp = await SecureStore.getItemAsync(K_PASS);
                if (cu && cp) setCreds({ u: cu, p: cp });
            } catch (e) {}
            setCargado(true);
        })();
    }, []);

    useEffect(() => {
        const h = BackHandler.addEventListener('hardwareBackPress', () => {
            if (puedeAtras && web.current) { web.current.goBack(); return true; }
            return false;
        });
        return () => h.remove();
    }, [puedeAtras]);

    async function guardar() {
        if (!u.trim() || !p) { Alert.alert('Faltan datos', 'Escribe tu usuario y tu contraseña.'); return; }
        try {
            await SecureStore.setItemAsync(K_USER, u.trim());
            await SecureStore.setItemAsync(K_PASS, p);
            setCreds({ u: u.trim(), p });
            intentos.current = 0;
            setModal(false); setU(''); setP('');
            if (web.current) web.current.reload();
        } catch (e) {
            Alert.alert('No se pudo guardar', 'Tu móvil no permite el almacén seguro.');
        }
    }

    function borrar() {
        Alert.alert('Borrar datos guardados', '¿Quitar tu usuario y contraseña de este móvil?', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Borrar', style: 'destructive', onPress: async () => {
                try { await SecureStore.deleteItemAsync(K_USER); await SecureStore.deleteItemAsync(K_PASS); } catch (e) {}
                setCreds(null);
            } }
        ]);
    }

    function alCargar(ev) {
        const url = (ev && ev.nativeEvent && ev.nativeEvent.url) || '';
        if (creds && /logon/i.test(url) && intentos.current < 1 && web.current) {
            intentos.current += 1;
            web.current.injectJavaScript(scriptRelleno(creds.u, creds.p));
        }
        if (!/logon/i.test(url)) intentos.current = 0;
    }

    const s = getStyles(theme);
    if (!cargado) return <ActivityIndicator style={{ flex: 1 }} color="#a78bfa" />;

    return (
        <View style={s.container}>
            <View style={s.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={s.btn}><Text style={s.btnT}>← Salir</Text></TouchableOpacity>
                <Text style={s.titulo}>🌐 Web EMT</Text>
                <TouchableOpacity onPress={() => setModal(true)} style={s.btn}><Text style={s.btnT}>🔑</Text></TouchableOpacity>
            </View>
            <WebView
                ref={web}
                source={{ uri: URL_EMT }}
                onLoadEnd={alCargar}
                onNavigationStateChange={(n) => setPuedeAtras(!!n.canGoBack)}
                startInLoadingState
                renderLoading={() => <ActivityIndicator style={StyleSheet.absoluteFill} color="#a78bfa" />}
                javaScriptEnabled
                domStorageEnabled
                sharedCookiesEnabled
                setSupportMultipleWindows={false}
            />
            <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
                <View style={s.overlay}>
                    <View style={s.card}>
                        <Text style={s.cardT}>🔑 Acceso a la web EMT</Text>
                        <Text style={s.nota}>
                            {creds ? 'Ya hay un usuario guardado en este móvil. Puedes cambiarlo o borrarlo.'
                                   : 'Guarda tu usuario y contraseña para entrar automáticamente.'}
                            {'\n'}Se guardan cifrados solo en este móvil. No se envían a ningún sitio salvo a la web de la empresa.
                        </Text>
                        <TextInput style={s.input} placeholder="Usuario" placeholderTextColor="#94a3b8" autoCapitalize="none" value={u} onChangeText={setU} />
                        <TextInput style={s.input} placeholder="Contraseña" placeholderTextColor="#94a3b8" secureTextEntry autoCapitalize="none" value={p} onChangeText={setP} />
                        <TouchableOpacity style={s.btnOk} onPress={guardar}><Text style={s.btnOkT}>Guardar y entrar</Text></TouchableOpacity>
                        {creds && <TouchableOpacity style={s.btnBorrar} onPress={borrar}><Text style={s.btnBorrarT}>🗑️ Borrar datos guardados</Text></TouchableOpacity>}
                        <TouchableOpacity onPress={() => setModal(false)} style={{ marginTop: 10, alignItems: 'center' }}><Text style={{ color: theme.primario }}>Cerrar</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function getStyles(theme) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.fondo },
        header: { backgroundColor: theme.headerFondo, paddingTop: 44, paddingBottom: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        titulo: { fontSize: 17, fontWeight: '900', color: theme.headerTexto },
        btn: { paddingVertical: 6, paddingHorizontal: 10 },
        btnT: { color: theme.headerTexto, fontWeight: '800', fontSize: 15 },
        overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
        card: { backgroundColor: theme.card, borderRadius: 16, padding: 18 },
        cardT: { fontSize: 17, fontWeight: '900', color: theme.texto, marginBottom: 8 },
        nota: { fontSize: 12, color: theme.textoTenue, marginBottom: 12 },
        input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 10, marginBottom: 10, color: theme.texto, backgroundColor: theme.fondo },
        btnOk: { backgroundColor: '#8b5cf6', borderRadius: 12, padding: 12, alignItems: 'center' },
        btnOkT: { color: '#fff', fontWeight: '900' },
        btnBorrar: { marginTop: 10, alignItems: 'center', padding: 8 },
        btnBorrarT: { color: '#ef4444', fontWeight: '800' },
    });
}
