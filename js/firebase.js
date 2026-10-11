
import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "আপনার_আসল_Firebase_API_KEY",
  authDomain: "taskearn-bd-fa040.firebaseapp.com",
  projectId: "taskearn-bd-fa040",
  storageBucket: "taskearn-bd-fa040.firebasestorage.app",
  messagingSenderId: "177026495081",
  appId: "1:177026495081:web:48bfaaf8e2e7688e3e68f8",
  measurementId: "G-RDSLSLBP0Q"
};

const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
