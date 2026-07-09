// Configuración del proyecto Firebase "thebrickbeer-25c72"
// Este archivo conecta la app a tu base de datos. No necesitas tocar nada más acá.

const firebaseConfig = {
  apiKey: "AIzaSyB3rpYQnv_WKLkip6-wYGDHfAgaM2vSyh0",
  authDomain: "thebrickbeer-25c72.firebaseapp.com",
  projectId: "thebrickbeer-25c72",
  storageBucket: "thebrickbeer-25c72.firebasestorage.app",
  messagingSenderId: "929860739643",
  appId: "1:929860739643:web:5620554b96b67af9efb21e",
  measurementId: "G-367YPFPXVF"
};

// Inicializa Firebase (usando la versión "compat" que ya está cargada en index.html)
firebase.initializeApp(firebaseConfig);

// Estas dos variables globales son las que usa app.js
const db = firebase.firestore();
const auth = firebase.auth();