// components/CopiaSeguridad.js
// Copia de seguridad personal: guarda en texto tus cambios, historial y notas (para guardarlo donde
// quieras: Notas, WhatsApp contigo mismo, correo...) y permite restaurarlo pegando ese texto.
// No se sube a ningún servidor: solo lee y escribe TUS datos en Firebase.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, get, update } from 'firebase/database';
import { db } from '../config/firebase';
import { useTheme } from '../context/ThemeContext';

const MARCA = 'LIBRESEMT-COPIA';
const MAX_CARACTERES = 3000000;

function esObjeto(x) {
    return x === null || x === undefined || (typeof x === 'object' && !Array.isArray(x));
}

export default function CopiaSeguridad() {
    const { theme } = useTheme();
    const s = estilos(theme);
    const [modal, setModal] = useState(false);
    const [texto, setTexto] = useState('');
    const [ocupado, setOcupado] = useState(false);

    async function leerSesion() {
        const raw = await AsyncStorage.getItem('sesion2026');
        return raw ? JSON.parse(raw) : null;
    }

    async function guardarCopia() {
        if (ocupado) return;
        setOcupado(true);
        try {
            const ses = await leerSesion();
            if (!ses || !ses.miID) { Alert.alert('Copia de seguridad', 'Primero tienes que iniciar sesión.'); return; }
            const id = String(ses.miID);
            const [c, h, n] = await Promise.all([
                get(ref(db, 'cambios/' + id)),
                get(ref(db, 'historial2/' + id)),
                get(ref(db, 'notas/' + id)),
            ]);
            const copia = {
                v: 1,
                id,
                fecha: new Date().toISOString(),
                cambios: c.val() || {},
                historial: h.val() || {},
                notas: n.val() || {},
            };
            await Share.share({
                title: 'Copia de seguridad Libres EMT',
                message: MARCA + '\n' + JSON.stringify(copia),
            });
        } catch (e) {
            Alert.alert('Copia de seguridad', 'No se ha podido guardar la copia. Comprueba la conexión e inténtalo de nuevo.');
        } finally {
            setOcupado(false);
        }
    }

    async function restaurar() {
        if (ocupado) return;
        try {
            const ses = await leerSesion();
            if (!ses || !ses.miID) { Alert.alert('Copia de seguridad', 'Primero tienes que iniciar sesión.'); return; }
            const bruto = String(texto || '');
            if (bruto.length > MAX_CARACTERES) { Alert.alert('Copia de seguridad', 'El texto es demasiado grande para ser una copia válida.'); return; }
            const ini = bruto.indexOf('{');
            const fin = bruto.lastIndexOf('}');
            if (ini < 0 || fin <= ini) { Alert.alert('Copia de seguridad', 'No encuentro una copia en ese texto. Pega el mensaje completo que guardaste.'); return; }
            let copia;
            try { copia = JSON.parse(bruto.slice(ini, fin + 1)); }
            catch (e) { Alert.alert('Copia de seguridad', 'El texto está incompleto o cortado. Pega la copia entera.'); return; }
            if (!copia || copia.v !== 1 || !copia.id || !esObjeto(copia.cambios) || !esObjeto(copia.historial) || !esObjeto(copia.notas)) {
                Alert.alert('Copia de seguridad', 'Ese texto no es una copia válida de esta app.');
                return;
            }
            const id = String(ses.miID);
            if (String(copia.id) !== id) {
                Alert.alert('Copia de seguridad', 'Esta copia es del empleado ' + copia.id + ' y tú has entrado como ' + id + '. No se puede restaurar.');
                return;
            }
            const nc = Object.keys(copia.cambios || {}).length;
            const nh = Object.keys(copia.historial || {}).length;
            const nn = Object.keys(copia.notas || {}).length;
            const cuando = copia.fecha ? new Date(copia.fecha).toLocaleDateString('es-ES') : '';
            Alert.alert(
                'Restaurar copia',
                'Copia del ' + cuando + ': ' + nc + ' cambios, ' + nh + ' registros de historial y ' + nn + ' notas.\n\nSustituirá lo que tienes ahora. ¿Continuar?',
                [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                        text: 'Restaurar', style: 'destructive', onPress: async () => {
                            setOcupado(true);
                            try {
                                await update(ref(db), {
                                    ['cambios/' + id]: nc ? copia.cambios : null,
                                    ['historial2/' + id]: nh ? copia.historial : null,
                                    ['notas/' + id]: nn ? copia.notas : null,
                                });
                                setModal(false);
                                setTexto('');
                                Alert.alert('Copia de seguridad', 'Copia restaurada correctamente.');
                            } catch (e) {
                                Alert.alert('Copia de seguridad', 'No se ha podido restaurar. Inténtalo de nuevo con conexión.');
                            } finally {
                                setOcupado(false);
                            }
                        }
                    },
                ]
            );
        } catch (e) {
            Alert.alert('Copia de seguridad', 'Ha ocurrido un error al leer la copia.');
        }
    }

    return (
        <View>
            <View style={s.card}>
                <Text style={s.titulo}>💾 Copia de seguridad</Text>
                <Text style={s.sub}>Guarda tus cambios, historial y notas donde quieras, y restáuralos cuando lo necesites.</Text>
                <View style={s.fila}>
                    <TouchableOpacity style={s.btn} onPress={guardarCopia} disabled={ocupado}>
                        <Text style={s.btnTexto}>Guardar copia</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.btn, s.btnSec]} onPress={() => setModal(true)} disabled={ocupado}>
                        <Text style={[s.btnTexto, s.btnSecTexto]}>Restaurar</Text>
                    </TouchableOpacity>
                </View>
            </View>
            <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
                <View style={s.fondo}>
                    <View style={s.caja}>
                        <Text style={s.titulo}>Restaurar copia</Text>
                        <Text style={s.sub}>Pega aquí el mensaje completo de tu copia (empieza por {MARCA}).</Text>
                        <TextInput
                            style={s.input}
                            multiline
                            value={texto}
                            onChangeText={setTexto}
                            placeholder="Pega aquí la copia"
                            placeholderTextColor={theme.textoSecundario}
                            autoCorrect={false}
                            autoCapitalize="none"
                        />
                        <View style={s.fila}>
                            <TouchableOpacity style={[s.btn, s.btnSec]} onPress={() => { setModal(false); setTexto(''); }}>
                                <Text style={[s.btnTexto, s.btnSecTexto]}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btn} onPress={restaurar} disabled={ocupado}>
                                <Text style={s.btnTexto}>Restaurar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

function estilos(theme) {
    return StyleSheet.create({
        card: { backgroundColor: theme.card, borderRadius: 16, padding: 16, marginHorizontal: 16, marginTop: 16, elevation: 1 },
        titulo: { fontSize: 15, fontWeight: '800', color: theme.texto },
        sub: { fontSize: 12, color: theme.textoSecundario, marginTop: 4 },
        fila: { flexDirection: 'row', gap: 10, marginTop: 12 },
        btn: { flex: 1, backgroundColor: theme.primario, borderRadius: 12, padding: 12, alignItems: 'center' },
        btnTexto: { color: '#fff', fontWeight: '700' },
        btnSec: { backgroundColor: theme.isDark ? '#3b3460' : '#f1f5f9' },
        btnSecTexto: { color: theme.textoSecundario },
        fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
        caja: { backgroundColor: theme.card, borderRadius: 16, padding: 16 },
        input: { marginTop: 12, minHeight: 120, maxHeight: 220, borderWidth: 1, borderColor: theme.isDark ? '#3b3460' : '#e2e8f0', borderRadius: 10, padding: 10, color: theme.texto, textAlignVertical: 'top' },
    });
}
