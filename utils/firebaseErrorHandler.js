// utils/firebaseErrorHandler.js
// Envuelve cualquier llamada a Firebase para capturar errores sin que la app se rompa.
// Uso en una pantalla:
//   const result = await withFirebaseErrorHandling(() => set(ref(db, 'turnos/x'), data));
//   if (result !== null) { /* éxito */ }

export async function withFirebaseErrorHandling(firebaseCall) {
  try {
    const result = await firebaseCall();
    return result === undefined ? true : result;
  } catch (error) {
    console.log('Error de Firebase:', error?.message || error);
    return null;
  }
}