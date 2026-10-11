
import { auth } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// নতুন অ্যাকাউন্ট তৈরি
export async function registerUser(name, email, password) {
  name = String(name || "").trim();
  email = String(email || "").trim();

  if (!name || !email || !password) {
    throw new Error("নাম, ইমেইল ও পাসওয়ার্ড পূরণ করুন।");
  }

  if (password.length < 6) {
    throw new Error("পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে।");
  }

  const result = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  await updateProfile(result.user, {
    displayName: name
  });

  return result.user;
}

// লগইন
export async function loginUser(email, password) {
  email = String(email || "").trim();

  if (!email || !password) {
    throw new Error("ইমেইল ও পাসওয়ার্ড দিন।");
  }

  const result = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  return result.user;
}

// লগআউট
export async function logoutUser() {
  await signOut(auth);
}

// পাসওয়ার্ড রিসেট
export async function resetPassword(email) {
  email = String(email || "").trim();

  if (!email) {
    throw new Error("আপনার ইমেইল ঠিকানা লিখুন।");
  }

  await sendPasswordResetEmail(auth, email);
}

// লগইন অবস্থা পর্যবেক্ষণ
export function watchLoginState(callback) {
  return onAuthStateChanged(auth, callback);
}

export { auth };
