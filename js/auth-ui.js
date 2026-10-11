
import {
  registerUser,
  loginUser,
  logoutUser,
  resetPassword,
  watchLoginState
} from "./auth.js";

const $ = (id) => document.getElementById(id);

function show(id, text) {
  const element = $(id);
  if (element) element.textContent = text;
}

function friendlyError(error) {
  const messages = {
    "auth/email-already-in-use": "এই ইমেইলে অ্যাকাউন্ট আগে থেকেই আছে।",
    "auth/invalid-email": "ইমেইল ঠিকানা সঠিক নয়।",
    "auth/weak-password": "আরও শক্তিশালী পাসওয়ার্ড দিন।",
    "auth/invalid-credential": "ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।",
    "auth/network-request-failed": "ইন্টারনেট সংযোগ পরীক্ষা করুন।",
    "auth/operation-not-allowed": "Firebase-এ Email/Password লগইন চালু করুন।",
    "auth/too-many-requests": "অনেকবার চেষ্টা হয়েছে। পরে আবার চেষ্টা করুন।"
  };

  return messages[error?.code] || error?.message || "কাজটি সম্পন্ন হয়নি।";
}

const loginForm = $("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("loginMessage", "লগইন হচ্ছে...");

    try {
      await loginUser(
        $("loginEmail")?.value,
        $("loginPassword")?.value
      );

      loginForm.reset();
      show("loginMessage", "লগইন সফল হয়েছে।");
    } catch (error) {
      show("loginMessage", friendlyError(error));
    }
  });
}

const registerForm = $("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("registerMessage", "অ্যাকাউন্ট তৈরি হচ্ছে...");

    try {
      await registerUser(
        $("registerName")?.value,
        $("registerEmail")?.value,
        $("registerPassword")?.value
      );

      registerForm.reset();
      show("registerMessage", "অ্যাকাউন্ট তৈরি হয়েছে।");
    } catch (error) {
      show("registerMessage", friendlyError(error));
    }
  });
}

const logoutButton = $("logoutBtn");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await logoutUser();
      show("authStatus", "লগআউট সম্পন্ন হয়েছে।");
    } catch (error) {
      show("authStatus", friendlyError(error));
    }
  });
}

const resetButton = $("resetPasswordBtn");

if (resetButton) {
  resetButton.addEventListener("click", async () => {
    try {
      await resetPassword($("loginEmail")?.value);
      show("loginMessage", "পাসওয়ার্ড রিসেটের ইমেইল পাঠানো হয়েছে।");
    } catch (error) {
      show("loginMessage", friendlyError(error));
    }
  });
}

watchLoginState((user) => {
  show(
    "authStatus",
    user
      ? `লগইন করা আছে: ${user.email || user.displayName || "ব্যবহারকারী"}`
      : "আপনি লগইন করেননি।"
  );
});
