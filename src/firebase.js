import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Verificar si se configuró Firebase (mínimo apiKey y projectId)
const isFirebaseConfigured = !!(
  firebaseConfig.apiKey && 
  firebaseConfig.projectId && 
  firebaseConfig.apiKey.trim() !== "" && 
  firebaseConfig.projectId.trim() !== ""
);

let app;
let auth;
let db;
let googleProvider;

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    googleProvider = new GoogleAuthProvider();
    // Forzar la selección de cuenta cada vez que se loguea
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    // Forzar el idioma en español para Google Auth
    auth.useDeviceLanguage();
  } catch (error) {
    console.error("Error al inicializar Firebase:", error);
  }
} else {
  console.warn("La configuración de Firebase está ausente o incompleta en el archivo .env. La aplicación funcionará en modo Demo / LocalStorage.");
}

export { auth, db, googleProvider, isFirebaseConfigured };
