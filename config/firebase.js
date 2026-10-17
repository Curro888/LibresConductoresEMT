// config/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCy-Bple2Z3pEFz5jRd1m_f6l0mXIHzWbM",
  authDomain: "libresconductoresemt.firebaseapp.com",
  databaseURL: "https://libresconductoresemt-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "libresconductoresemt",
  storageBucket: "libresconductoresemt.firebasestorage.app",
  messagingSenderId: "97914022948",
  appId: "1:97914022948:web:9e222cb5b39bdc17a53cb1"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);