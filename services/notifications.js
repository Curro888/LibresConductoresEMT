// services/notifications.js
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { ref, set, get } from 'firebase/database';
import { db } from '../config/firebase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotificationsAsync(userId) {
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
    projectId: '97cb9556-4483-469f-9ca4-73bd417adea5', // extra.eas.projectId de app.json
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
