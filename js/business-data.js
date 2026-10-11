
import { auth, db } from "./firebase.js";

import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const ALLOWED = [
  "products",
  "sales",
  "purchases",
  "expenses",
  "income",
  "customers",
  "orders",
  "tasks"
];

function getUser() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("আগে লগইন করুন।");
  }

  return user;
}

function checkType(type) {
  if (!ALLOWED.includes(type)) {
    throw new Error("এই রেকর্ডের বিভাগ অনুমোদিত নয়।");
  }
}

// নতুন রেকর্ড
export async function saveBusinessRecord(type, data) {
  const user = getUser();
  checkType(type);

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("সঠিক রেকর্ডের তথ্য দিন।");
  }

  const result = await addDoc(
    collection(db, "users", user.uid, type),
    {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }
  );

  return result.id;
}

// রেকর্ড পড়া
export async function getBusinessRecords(type) {
  const user = getUser();
  checkType(type);

  const snapshot = await getDocs(
    collection(db, "users", user.uid, type)
  );

  return snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data()
  }));
}

// রেকর্ড সম্পাদনা
export async function editBusinessRecord(type, id, changes) {
  const user = getUser();
  checkType(type);

  if (!id || !changes || typeof changes !== "object" ||
      Array.isArray(changes)) {
    throw new Error("রেকর্ড আইডি ও পরিবর্তিত তথ্য দিন।");
  }

  await updateDoc(
    doc(db, "users", user.uid, type, id),
    {
      ...changes,
      updatedAt: serverTimestamp()
    }
  );
}

// রেকর্ড মুছে ফেলা
export async function deleteBusinessRecord(type, id) {
  const user = getUser();
  checkType(type);

  if (!id) {
    throw new Error("মুছে ফেলার রেকর্ড নির্বাচন করুন।");
  }

  await deleteDoc(
    doc(db, "users", user.uid, type, id)
  );
}
