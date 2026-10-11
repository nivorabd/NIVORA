
import { auth, storage } from "./firebase.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-storage.js";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);

const MAX_SIZE = 10 * 1024 * 1024;

export async function uploadNivoraFile(file) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("ফাইল আপলোডের আগে লগইন করুন।");
  }

  if (!file) {
    throw new Error("একটি ফাইল নির্বাচন করুন।");
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("JPG, PNG, WebP অথবা PDF ফাইল নির্বাচন করুন।");
  }

  if (file.size > MAX_SIZE) {
    throw new Error("ফাইলের আকার সর্বোচ্চ ১০ MB হতে পারবে।");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

  const filePath =
    `users/${user.uid}/files/${Date.now()}_${safeName}`;

  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, file, {
    contentType: file.type
  });

  const url = await getDownloadURL(fileRef);

  return {
    name: file.name,
    path: filePath,
    url,
    size: file.size,
    contentType: file.type
  };
}
