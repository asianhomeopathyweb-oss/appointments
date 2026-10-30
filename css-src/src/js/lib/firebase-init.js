import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCXoDorK7mEeuKSffMRkRxuYkMOfqsbDEM",
  authDomain: "billbook-e8c96.firebaseapp.com",
  projectId: "billbook-e8c96",
  storageBucket: "billbook-e8c96.firebasestorage.app",
  messagingSenderId: "25565299280",
  appId: "1:25565299280:web:71f809d40c874745c84755",
  measurementId: "G-97X2619XPD"
};

export const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);