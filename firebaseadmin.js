// ============================================================
// NIVORA ONE — Firebase Admin Service
// File: backend/services/firebaseAdmin.js
// ============================================================

"use strict";

const admin = require("firebase-admin");

// ------------------------------------------------------------
// Firebase Admin initialization
// ------------------------------------------------------------

let firebaseApp = null;

function initializeFirebaseAdmin() {
  if (firebaseApp) {
    return firebaseApp;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID || "";

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL || "";

  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY || "";

  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ||
    "https://taskearn-bd-fa040-default-rtdb.asia-southeast1.firebasedatabase.app";

  // ----------------------------------------------------------
  // Check configuration
  // ----------------------------------------------------------

  if (
    !projectId ||
    !clientEmail ||
    !privateKey
  ) {
    console.warn(
      "Firebase Admin is not configured yet. " +
      "Firebase tools will remain disabled."
    );

    return null;
  }

  try {
    const normalizedPrivateKey =
      privateKey.replace(/\\n/g, "\n");

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: normalizedPrivateKey
      }),

      databaseURL
    });

    console.log(
      "Firebase Admin initialized successfully."
    );

    return firebaseApp;

  } catch (error) {
    console.error(
      "Firebase Admin initialization failed:",
      error?.message || error
    );

    return null;
  }
}

// ------------------------------------------------------------
// Get Firebase App
// ------------------------------------------------------------

function getFirebaseApp() {
  return initializeFirebaseAdmin();
}

// ------------------------------------------------------------
// Get Realtime Database
// ------------------------------------------------------------

function getDatabase() {
  const app = initializeFirebaseAdmin();

  if (!app) {
    return null;
  }

  return admin.database(app);
}

// ------------------------------------------------------------
// Get Firestore
// ------------------------------------------------------------
//
// Kept for future compatibility.
// NIVORA currently uses Realtime Database.
//

function getFirestore() {
  const app = initializeFirebaseAdmin();

  if (!app) {
    return null;
  }

  return admin.firestore(app);
}

// ------------------------------------------------------------
// Get Firebase Auth
// ------------------------------------------------------------

function getAuth() {
  const app = initializeFirebaseAdmin();

  if (!app) {
    return null;
  }

  return admin.auth(app);
}

// ------------------------------------------------------------
// Firebase availability check
// ------------------------------------------------------------

function isFirebaseConfigured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}

// ------------------------------------------------------------
// Realtime Database availability check
// ------------------------------------------------------------

function isRealtimeDatabaseConfigured() {
  return Boolean(
    isFirebaseConfigured() &&
    (
      process.env.FIREBASE_DATABASE_URL ||
      true
    )
  );
}

// ------------------------------------------------------------
// Verify Firebase ID token
// ------------------------------------------------------------

async function verifyIdToken(idToken) {
  if (
    typeof idToken !== "string" ||
    !idToken.trim()
  ) {
    const error = new Error(
      "Firebase ID token is required."
    );

    error.statusCode = 401;
    throw error;
  }

  const auth = getAuth();

  if (!auth) {
    const error = new Error(
      "Firebase Admin authentication is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  try {
    return await auth.verifyIdToken(
      idToken.trim()
    );

  } catch (error) {
    const authError = new Error(
      "Invalid or expired Firebase ID token."
    );

    authError.statusCode = 401;
    authError.code =
      "INVALID_FIREBASE_TOKEN";

    throw authError;
  }
}

// ------------------------------------------------------------
// Read Realtime Database value
// ------------------------------------------------------------

async function readDatabase(path) {
  const db = getDatabase();

  if (!db) {
    const error = new Error(
      "Firebase Realtime Database is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  if (
    typeof path !== "string" ||
    !path.trim()
  ) {
    const error = new Error(
      "Realtime Database path is required."
    );

    error.statusCode = 400;
    throw error;
  }

  const snapshot = await db
    .ref(path.trim())
    .once("value");

  return snapshot.val();
}

// ------------------------------------------------------------
// Write Realtime Database value
// ------------------------------------------------------------

async function writeDatabase(
  path,
  data
) {
  const db = getDatabase();

  if (!db) {
    const error = new Error(
      "Firebase Realtime Database is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  if (
    typeof path !== "string" ||
    !path.trim()
  ) {
    const error = new Error(
      "Realtime Database path is required."
    );

    error.statusCode = 400;
    throw error;
  }

  await db
    .ref(path.trim())
    .set(data);

  return {
    success: true,
    path: path.trim()
  };
}

// ------------------------------------------------------------
// Update Realtime Database value
// ------------------------------------------------------------

async function updateDatabase(
  path,
  data
) {
  const db = getDatabase();

  if (!db) {
    const error = new Error(
      "Firebase Realtime Database is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  if (
    typeof path !== "string" ||
    !path.trim()
  ) {
    const error = new Error(
      "Realtime Database path is required."
    );

    error.statusCode = 400;
    throw error;
  }

  await db
    .ref(path.trim())
    .update(data);

  return {
    success: true,
    path: path.trim()
  };
}

// ------------------------------------------------------------
// Delete Realtime Database value
// ------------------------------------------------------------

async function deleteDatabase(path) {
  const db = getDatabase();

  if (!db) {
    const error = new Error(
      "Firebase Realtime Database is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  if (
    typeof path !== "string" ||
    !path.trim()
  ) {
    const error = new Error(
      "Realtime Database path is required."
    );

    error.statusCode = 400;
    throw error;
  }

  await db
    .ref(path.trim())
    .remove();

  return {
    success: true,
    path: path.trim()
  };
}

// ------------------------------------------------------------
// Exports
// ------------------------------------------------------------

module.exports = {
  initializeFirebaseAdmin,
  getFirebaseApp,

  // Realtime Database
  getDatabase,
  readDatabase,
  writeDatabase,
  updateDatabase,
  deleteDatabase,

  // Existing compatibility
  getFirestore,
  getAuth,

  // Status
  isFirebaseConfigured,
  isRealtimeDatabaseConfigured,

  // Authentication
  verifyIdToken
};