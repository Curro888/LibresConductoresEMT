// services/notifications.js
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref, set, get } from 'firebase/database';
import { db } from '../config/firebase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ID del proyecto de Expo (EAS) de ESTA app. Hasta que se cree el proyecto EAS de
// Libres Conductores EMT (y se configure Firebase Cloud Messaging) se deja en null:
// así la app NO registra avisos push (y tampoco usa por error el proyecto de TurnosEMT).
// Cuando exista, se pone aquí el ID (el mismo que extra.eas.projectId de app.json).
const EXPO_PROJECT_ID = null;

export async function registerForPushNotificationsAsync(userId) {
  if (!EXPO_PROJECT_ID) return null; // push desactivado hasta configurar el proyecto
  if (!Device.isDevice) return null; // push no funciona en emulador

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: EXPO_PROJECT_ID,
  });
  const token = tokenData.data;

  if (userId) await set(ref(db, `pushTokens/${userId}`), token); // guarda token para envío posterior

  return token;
}

export function addNotificationListeners(onReceive, onTap) {
  const sub1 = Notifications.addNotificationReceivedListener(onReceive);
  const sub2 = Notifications.addNotificationResponseReceivedListener(onTap);
  return () => { sub1.remove(); sub2.remove(); };
}

// Envía un aviso push a una persona concreta (por su ID), buscando su token guardado.
// Si algo falla (sin token, sin conexión, etc.) no lanza error: simplemente no se envía.
export async function enviarPushA(userId, titulo, cuerpo, data = {}) {
  try {
    if (!userId) return;
    const snap = await get(ref(db, `pushTokens/${userId}`));
    const token = snap.val();
    if (!token) return;

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: token,
        sound: 'default',
        title: titulo,
        body: cuerpo,
        priority: 'high',
        channelId: 'default',
        ttl: 3600, // insiste hasta 1 hora si el móvil no está disponible en el momento
        data,
      }),
    });
  } catch (e) {
    console.log('Error enviando notificación push:', e?.message || e);
  }
}

// Recordatorio local de peticiones de cambio sin contestar.
// Si hay peticiones pendientes, programa UN aviso para las 18:00 (hoy, o mañana si ya pasó).
// Si no hay ninguna, cancela el aviso. Se recalcula cada vez que se abre la app.
// No usa internet ni el proyecto push: es un aviso del propio móvil.
const ID_RECORDATORIO_SOL = 'recordatorio-solicitudes';
export async function programarRecordatorioSolicitudes(pendientes) {
  try {
    if (Platform.OS === 'web') return;
    await Notifications.cancelScheduledNotificationAsync(ID_RECORDATORIO_SOL).catch(() => {});
    if (!pendientes || pendientes < 1) return;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const r = await Notifications.requestPermissionsAsync();
      status = r.status;
    }
    if (status !== 'granted') return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const cuando = new Date();
    cuando.setHours(18, 0, 0, 0);
    if (cuando.getTime() <= Date.now() + 60 * 1000) cuando.setDate(cuando.getDate() + 1);
    await Notifications.scheduleNotificationAsync({
      identifier: ID_RECORDATORIO_SOL,
      content: {
        title: '🤝 Petición de cambio pendiente',
        body: pendientes === 1
          ? 'Tienes 1 petición de cambio sin contestar.'
          : 'Tienes ' + pendientes + ' peticiones de cambio sin contestar.',
        sound: 'default',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: cuando },
    });
  } catch (e) {
    console.log('Recordatorio de peticiones:', e?.message || e);
  }
}

// Alerta mensual: el día 14 a las 22:00, último día para pedir el cobro de días (hasta el 15 a las 23:59).
// Se programan los próximos 12 meses en el propio móvil (sin internet) y se recalculan cada vez que se abre la app.
// Se puede desactivar en Ajustes (se guarda en 'alerta14').
const ALERTA14_IDS = Array.from({ length: 12 }, (_, i) => 'alerta14-' + i);
export async function alerta14Activada() {
  try { return (await AsyncStorage.getItem('alerta14')) !== '0'; } catch (e) { return true; }
}
export async function activarAlerta14(activa) {
  try { await AsyncStorage.setItem('alerta14', activa ? '1' : '0'); } catch (e) {}
  return programarAlerta14();
}
export async function programarAlerta14() {
  try {
    if (Platform.OS === 'web') return false;
    for (const id of ALERTA14_IDS) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    if (!(await alerta14Activada())) return false;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const r = await Notifications.requestPermissionsAsync();
      status = r.status;
    }
    if (status !== 'granted') return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
    const ahora = new Date();
    let n = 0;
    for (let i = 0; i < 14 && n < ALERTA14_IDS.length; i++) {
      const cuando = new Date(ahora.getFullYear(), ahora.getMonth() + i, 14, 22, 0, 0, 0);
      if (cuando.getTime() <= Date.now() + 60 * 1000) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: ALERTA14_IDS[n++],
        content: {
          title: '📅 Último día para pedir cobro de días',
          body: 'Hoy es 14: tienes hasta mañana 15 a las 23:59 para pedir días para cobrar.',
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: cuando },
      });
    }
    return true;
  } catch (e) {
    console.log('Alerta día 14:', e?.message || e);
    return false;
  }
}
