import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, FlatList, TextInput,
    TouchableOpacity, KeyboardAvoidingView, Platform,
    ActivityIndicator, Image, Modal, Alert
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from '@react-navigation/native';
import { db } from '../config/firebase';
import { ref, onValue, push, set, update, get } from 'firebase/database';
import { useTheme } from '../context/ThemeContext';

export default function ChatScreen() {
    const { theme } = useTheme();
    const [sesion, setSesion] = useState(null);
    const [mensajes, setMensajes] = useState([]);
    const [texto, setTexto] = useState('');
    const [imagenPendiente, setImagenPendiente] = useState(null); // base64
    const [imagenFullscreen, setImagenFullscreen] = useState(null);
    const [silenciado, setSilenciado] = useState(false);
    const silenciadoRef = useRef(false);
    const flatListRef = useRef(null);
    const soundRef = useRef(null);
    const ultimoTsRef = useRef(Date.now());
    const keysNotificadasRef = useRef(new Set());
    const sesionRef = useRef(null);

    // Actualizar chatLeidos cada vez que el usuario entra al chat, y quitar los avisos
    // de la barra de notificaciones de Android (si no, se quedan puestos aunque ya lo hayas leído)
    useFocusEffect(
        React.useCallback(() => {
            if (sesionRef.current?.grupoActual && sesionRef.current?.miID) {
                set(ref(db, `chatLeidos/${sesionRef.current.grupoActual}/${sesionRef.current.miID}`), Date.now());
            }
            Notifications.dismissAllNotificationsAsync().catch(() => {});
        }, [])
    );

    useEffect(() => {
        async function cargarSonido() {
            const { sound } = await Audio.Sound.createAsync(
                require('../assets/notif.mp3'),
                { shouldPlay: false }
            );
            soundRef.current = sound;
        }
        cargarSonido();
        return () => { if (soundRef.current) soundRef.current.unloadAsync(); };
    }, []);

    useEffect(() => {
        let unsubMsgs;
        async function cargar() {
            const raw = await AsyncStorage.getItem('sesion2026');
            if (!raw) return;
            const s = JSON.parse(raw);
            setSesion(s);
            const silRaw = await AsyncStorage.getItem('chatSilenciado');
            const silVal = silRaw === 'true';
            setSilenciado(silVal);
            silenciadoRef.current = silVal;
            sesionRef.current = s;
            if (!s.grupoActual) return;

            // Marcar leídos al cargar
            set(ref(db, `chatLeidos/${s.grupoActual}/${s.miID}`), Date.now());

            unsubMsgs = onValue(ref(db, 'chats/' + s.grupoActual), snap => {
                const data = snap.val() || {};
                const lista = Object.entries(data)
                    .map(([key, m]) => ({ key, ...m }))
                    .sort((a, b) => a.ts - b.ts)
                    .slice(-50);
                setMensajes(lista);

                // Reproducir sonido si hay mensajes nuevos de otros desde la última vez
                const nuevosAjenos = lista.filter(m =>
                    m.uid !== s.miID &&
                    m.ts > ultimoTsRef.current &&
                    !keysNotificadasRef.current.has(m.key)
                );
                if (nuevosAjenos.length > 0 && soundRef.current && !silenciadoRef.current) {
                    nuevosAjenos.forEach(m => keysNotificadasRef.current.add(m.key));
                    soundRef.current.replayAsync();
                }
                if (lista.length > 0) ultimoTsRef.current = lista[lista.length - 1].ts;

                const updates = {};
                lista.forEach(m => {
                    if (m.uid !== s.miID && !m.leido) {
                        updates[`chats/${s.grupoActual}/${m.key}/leido`] = true;
                    }
                });
                if (Object.keys(updates).length > 0) update(ref(db), updates);
            });
        }
        cargar();
        return () => { if (unsubMsgs) unsubMsgs(); };
    }, []);

    async function seleccionarImagen() {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permiso denegado', 'Necesitamos acceso a tu galería para enviar imágenes.');
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 1,
        });
        if (result.canceled) return;

        const uri = result.assets[0].uri;
        const { width, height } = result.assets[0];

        // Comprimir igual que el HTML: máx 800px, calidad 0.7
        const MAX = 800;
        let resize = {};
        if (width > height && width > MAX) resize = { width: MAX };
        else if (height > width && height > MAX) resize = { height: MAX };
        else if (width > MAX) resize = { width: MAX };

        const actions = Object.keys(resize).length > 0 ? [{ resize }] : [];
        const comprimida = await ImageManipulator.manipulateAsync(uri, actions, {
            compress: 0.7,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
        });
        setImagenPendiente('data:image/jpeg;base64,' + comprimida.base64);
    }

    async function toggleSilencio() {
        const nuevo = !silenciado;
        setSilenciado(nuevo);
        silenciadoRef.current = nuevo;
        await AsyncStorage.setItem('chatSilenciado', nuevo ? 'true' : 'false');
    }

    async function compartirImagen() {
        if (!imagenFullscreen) return;
        try {
            const base64 = imagenFullscreen.replace('data:image/jpeg;base64,', '');
            const fileUri = FileSystem.cacheDirectory + 'chat_imagen_' + Date.now() + '.jpg';
            await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: 'base64' });
            await Sharing.shareAsync(fileUri, { mimeType: 'image/jpeg', dialogTitle: 'Guardar o compartir imagen' });
        } catch (e) {
            Alert.alert('Error', 'Detalle: ' + (e.message || JSON.stringify(e)));
        }
    }

    // Avisa por notificación push a los demás miembros del grupo (no a quien envía)
    async function enviarPushGrupo(nombreRemitente, textoMensaje, esImagen) {
        try {
            const miembrosSnap = await get(ref(db, `grupos/${sesion.grupoActual}/miembros`));
            const data = miembrosSnap.val() || {};
            const lista = Array.isArray(data) ? data.filter(Boolean) : Object.values(data);
            const otros = lista.filter(m => m && m.id && m.id !== sesion.miID);
            if (otros.length === 0) return;

            const tokens = [];
            for (const miembro of otros) {
                const tokenSnap = await get(ref(db, `pushTokens/${miembro.id}`));
                const token = tokenSnap.val();
                if (token) tokens.push(token);
            }
            if (tokens.length === 0) return;

            const cuerpo = esImagen ? '📷 Imagen' : textoMensaje;
            const mensajesPush = tokens.map(token => ({
                to: token,
                sound: 'default',
                title: `💬 ${nombreRemitente}`,
                body: cuerpo,
                priority: 'high',
                channelId: 'default',
                ttl: 3600,
                data: { tipo: 'chat', grupoId: sesion.grupoActual },
            }));

            await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(mensajesPush),
            });
        } catch (e) {
            // Si falla el envío de notificaciones, no interrumpimos el chat
            console.log('Error enviando notificación push:', e?.message || e);
        }
    }

    async function enviarMensaje() {
        const txt = texto.trim();
        if (!txt && !imagenPendiente) return;
        if (!sesion || !sesion.grupoActual) return;
        const nombre = sesion.miNombreCompleto ? sesion.miNombreCompleto.split(' ')[0] : ('ID ' + sesion.miID);
        const msg = {
            uid: sesion.miID, nom: nombre,
            texto: txt || '',
            imagen: imagenPendiente || null,
            ts: Date.now(), leido: false
        };
        setTexto('');
        setImagenPendiente(null);
        const nuevoRef = push(ref(db, 'chats/' + sesion.grupoActual));
        await set(nuevoRef, msg);

        // Avisar a los demás miembros del grupo (no bloquea el envío si falla)
        enviarPushGrupo(nombre, txt, !!msg.imagen);
    }

    const s = getStyles(theme);

    if (!sesion) return <ActivityIndicator style={{ flex: 1 }} color="#a78bfa" />;

    if (!sesion.grupoActual) {
        return (
            <View style={s.container}>
                <View style={s.header}><Text style={s.titulo}>💬 Chat</Text></View>
                <View style={s.vacioWrap}><Text style={s.vacioTexto}>No perteneces a ningún grupo todavía.</Text></View>
            </View>
        );
    }

    function renderMensaje({ item }) {
        const esMio = item.uid === sesion.miID;
        const hora = new Date(item.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        return (
            <View style={[s.msgWrap, esMio ? s.msgWrapMio : s.msgWrapOtro]}>
                {!esMio && <Text style={s.msgNombre}>{item.nom}</Text>}
                <View style={[s.burbuja, esMio ? s.burbujaMia : s.burbujaOtro]}>
                    {item.imagen && (
                        <TouchableOpacity onPress={() => setImagenFullscreen(item.imagen)}>
                            <Image source={{ uri: item.imagen }} style={s.msgImagen} resizeMode="cover" />
                        </TouchableOpacity>
                    )}
                    {item.texto ? <Text style={esMio ? s.msgTextoMio : s.msgTextoOtro}>{item.texto}</Text> : null}
                </View>
                <View style={s.msgFooter}>
                    <Text style={s.msgHora}>{hora}</Text>
                    {esMio && <Text style={[s.ticks, item.leido && s.ticksLeido]}>{item.leido ? '✓✓' : '✓'}</Text>}
                </View>
            </View>
        );
    }

    return (
        <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}>
            <View style={s.header}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                        <Text style={s.titulo}>💬 Chat</Text>
                        <Text style={s.sub}>Grupo {sesion.grupoActual}</Text>
                    </View>
                    <TouchableOpacity onPress={toggleSilencio} style={s.btnSilencio}>
                        <Text style={s.btnSilencioTexto}>{silenciado ? '🔕' : '🔔'}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <FlatList
                ref={flatListRef}
                data={mensajes}
                keyExtractor={item => item.key}
                renderItem={renderMensaje}
                contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
                ListEmptyComponent={<Text style={s.vacioTexto}>Aún no hay mensajes. ¡Escribe el primero!</Text>}
            />

            {/* Previsualización de imagen antes de enviar */}
            {imagenPendiente && (
                <View style={s.previewBar}>
                    <Image source={{ uri: imagenPendiente }} style={s.previewImg} resizeMode="cover" />
                    <TouchableOpacity style={s.previewBorrar} onPress={() => setImagenPendiente(null)}>
                        <Text style={s.previewBorrarTexto}>✕</Text>
                    </TouchableOpacity>
                </View>
            )}

            <View style={s.inputBar}>
                <TouchableOpacity style={s.btnFoto} onPress={seleccionarImagen}>
                    <Text style={s.btnFotoTexto}>📷</Text>
                </TouchableOpacity>
                <TextInput
                    style={s.input}
                    value={texto}
                    onChangeText={setTexto}
                    placeholder="Escribe un mensaje..."
                    placeholderTextColor={theme.textoTenue}
                    multiline
                    maxLength={500}
                />
                <TouchableOpacity
                    style={[s.btnEnviar, (!texto.trim() && !imagenPendiente) && s.btnEnviarDisabled]}
                    onPress={enviarMensaje}
                    disabled={!texto.trim() && !imagenPendiente}
                >
                    <Text style={s.btnEnviarTexto}>➤</Text>
                </TouchableOpacity>
            </View>

            {/* Imagen a pantalla completa */}
            <Modal visible={!!imagenFullscreen} transparent animationType="fade" onRequestClose={() => setImagenFullscreen(null)}>
                <View style={s.fullscreenOverlay}>
                    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setImagenFullscreen(null)} />
                    {imagenFullscreen && (
                        <Image source={{ uri: imagenFullscreen }} style={s.fullscreenImg} resizeMode="contain" />
                    )}
                    <View style={s.fullscreenBtns}>
                        <TouchableOpacity style={s.btnGuardar} onPress={compartirImagen}>
                            <Text style={s.btnGuardarTexto}>📤 Compartir</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.btnCerrarFullscreen} onPress={() => setImagenFullscreen(null)}>
                            <Text style={s.btnCerrarFullscreenTexto}>✕ Cerrar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </KeyboardAvoidingView>
    );
}

function getStyles(theme) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: theme.fondo },
        header: { backgroundColor: theme.headerFondo, padding: 16, paddingTop: 50 },
        btnSilencio: { padding: 8 },
        btnSilencioTexto: { fontSize: 24 },
        titulo: { fontSize: 20, fontWeight: '900', color: theme.headerTexto },
        sub: { fontSize: 12, color: theme.headerSub, marginTop: 2 },
        vacioWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
        vacioTexto: { color: theme.textoTenue, fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
        msgWrap: { marginBottom: 10, maxWidth: '80%' },
        msgWrapMio: { alignSelf: 'flex-end', alignItems: 'flex-end' },
        msgWrapOtro: { alignSelf: 'flex-start', alignItems: 'flex-start' },
        msgNombre: { fontSize: 12, fontWeight: '800', color: theme.primario, marginBottom: 2 },
        burbuja: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16 },
        burbujaMia: { backgroundColor: theme.primario, borderBottomRightRadius: 4 },
        burbujaOtro: { backgroundColor: theme.isDark ? '#2a3245' : '#f1f5f9', borderBottomLeftRadius: 4 },
        msgTextoMio: { color: '#fff', fontSize: 14 },
        msgTextoOtro: { color: theme.isDark ? '#a8b8cc' : '#1e293b', fontSize: 14 },
        msgImagen: { width: 200, height: 150, borderRadius: 10, marginBottom: 4 },
        msgFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 4 },
        msgHora: { fontSize: 10, color: theme.textoTenue },
        ticks: { fontSize: 11, color: theme.textoTenue },
        ticksLeido: { color: theme.primario },
        previewBar: { backgroundColor: theme.card, padding: 8, borderTopWidth: 1, borderTopColor: theme.borde, flexDirection: 'row', alignItems: 'center' },
        previewImg: { width: 60, height: 60, borderRadius: 8 },
        previewBorrar: { marginLeft: 10, backgroundColor: '#ef4444', borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
        previewBorrarTexto: { color: '#fff', fontWeight: '900', fontSize: 14 },
        inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, backgroundColor: theme.card, borderTopWidth: 1, borderTopColor: theme.borde, gap: 8 },
        btnFoto: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
        btnFotoTexto: { fontSize: 22 },
        input: { flex: 1, backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: theme.texto, maxHeight: 100 },
        btnEnviar: { backgroundColor: theme.primario, borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
        btnEnviarDisabled: { opacity: 0.4 },
        btnEnviarTexto: { color: '#fff', fontSize: 18, fontWeight: '900' },
        fullscreenOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
        fullscreenImg: { width: '95%', height: '75%' },
        fullscreenBtns: { flexDirection: 'row', gap: 12, marginTop: 16 },
        btnGuardar: { backgroundColor: theme.primario, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
        btnGuardarTexto: { color: '#fff', fontWeight: '800', fontSize: 14 },
        btnCerrarFullscreen: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
        btnCerrarFullscreenTexto: { color: '#fff', fontWeight: '800', fontSize: 14 },
    });
}
