import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAfBkjqPbuuM7V2A5xoNSHePEMDHKdRPIA",
  authDomain: "mylist-e2202.firebaseapp.com",
  projectId: "mylist-e2202",
  storageBucket: "mylist-e2202.firebasestorage.app",
  messagingSenderId: "1003468030717",
  appId: "1:1003468030717:web:12dc9372fdbbb4af1bb494"
};

// Only this shared account is allowed to use the ledger.
const ALLOWED_EMAIL = "mianusama3882423@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

const loginView = $("loginView");
const appView = $("appView");
const loginForm = $("loginForm");
const loginBtn = $("loginBtn");
const loginError = $("loginError");
const logoutBtn = $("logoutBtn");
const itemForm = $("itemForm");
const saveBtn = $("saveBtn");
const formMessage = $("formMessage");
const syncStatus = $("syncStatus");
const connectionLabel = $("connectionLabel");

let stopListening = null;
let allRecords = [];
let currentUser = null;
let saving = false;
let returningIds = new Set();

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

$("givenDate").value = localDateString();

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showLoginError(message = "") {
  loginError.textContent = message;
}

function setSyncStatus(message) {
  syncStatus.textContent = message;
  connectionLabel.textContent = message;
}

function friendlyError(error) {
  const messages = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/invalid-login-credentials": "Incorrect email or password.",
    "auth/user-not-found": "No account was found for this email.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/network-request-failed": "Network error. Check your internet connection.",
    "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase.",
    "auth/weak-password": "The password does not meet the requirements.",
    "permission-denied": "Access denied. Check your Firestore security rules.",
    "unavailable": "The service is temporarily unavailable. Please try again."
  };

  return messages[error?.code] ||
    error?.message ||
    "Something went wrong. Please try again.";
}

function showSignedInUI(user) {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  $("activeList").innerHTML = '<p class="empty-state">Loading records...</p>';
  $("historyList").innerHTML = '<p class="empty-state">Loading history...</p>';
  setSyncStatus("Connecting...");
}

function showSignedOutUI() {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  allRecords = [];
  renderRecords();
  setSyncStatus("Signed out");
}

async function startListening() {
  if (stopListening) {
    stopListening();
    stopListening = null;
  }

  // Every device uses the same Firebase account and shared collection.
  const recordsQuery = query(
    collection(db, "sharedItems"),
    orderBy("createdAt", "desc")
  );

  stopListening = onSnapshot(
    recordsQuery,
    (snapshot) => {
      allRecords = snapshot.docs.map((record) => ({
        id: record.id,
        ...record.data()
      }));

      setSyncStatus("Synced");
      renderRecords();
    },
    (error) => {
      console.error("Firestore sync error:", error);
      setSyncStatus("Sync error");
      $("activeList").innerHTML =
        `<p class="empty-state">${escapeHTML(friendlyError(error))}</p>`;
      $("historyList").innerHTML =
        '<p class="empty-state">History could not be loaded.</p>';
    }
  );
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showLoginError("");

  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value;

  if (email !== ALLOWED_EMAIL.toLowerCase()) {
    showLoginError("This email is not authorized for the shared ledger.");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing In...";

  try {
    await setPersistence(auth, browserLocalPersistence);
    const result = await signInWithEmailAndPassword(auth, email, password);

    if (result.user.email?.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
      await signOut(auth);
      throw new Error("This account is not authorized for the shared ledger.");
    }
  } catch (error) {
    console.error("Login error:", error);
    showLoginError(friendlyError(error));
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In";
  }
});

$("resetPasswordBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim().toLowerCase();

  if (!email) {
    showLoginError("Enter your account email first.");
    $("loginEmail").focus();
    return;
  }

  if (email !== ALLOWED_EMAIL.toLowerCase()) {
    showLoginError("This email is not authorized for the shared ledger.");
    return;
  }

  const resetButton = $("resetPasswordBtn");
  resetButton.disabled = true;
  resetButton.textContent = "Sending...";

  try {
    await sendPasswordResetEmail(auth, email);
    showLoginError("If a matching account exists, a password reset email has been sent.");
  } catch (error) {
    showLoginError(friendlyError(error));
  } finally {
    resetButton.disabled = false;
    resetButton.textContent = "Forgot Password?";
  }
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;

  try {
    await signOut(auth);
  } catch (error) {
    alert(friendlyError(error));
  } finally {
    logoutBtn.disabled = false;
  }
});

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || saving) return;

  const form = new FormData(itemForm);
  const itemName = String(form.get("itemName") || "").trim();
  const personName = String(form.get("personName") || "").trim();
  const quantity = Number(form.get("quantity"));
  const givenDate = String(form.get("givenDate") || "");
  const dueDate = String(form.get("dueDate") || "");
  const notes = String(form.get("notes") || "").trim();

  if (!itemName || !personName || !givenDate ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 99999) {
    formMessage.textContent = "Please check all required fields.";
    formMessage.className = "message error";
    return;
  }

  if (dueDate && dueDate < givenDate) {
    formMessage.textContent = "The expected return date cannot be before the given date.";
    formMessage.className = "message error";
    return;
  }

  saving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  formMessage.textContent = "";

  try {
    await addDoc(collection(db, "sharedItems"), {
      itemName,
      personName,
      quantity,
      givenDate,
      dueDate,
      notes,
      status: "active",
      returnedAt: null,
      returnedDate: null,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    itemForm.reset();
    $("quantity").value = "1";
    $("givenDate").value = localDateString();

    formMessage.textContent = "Record saved and syncing across devices.";
    formMessage.className = "message";
  } catch (error) {
    console.error("Save error:", error);
    formMessage.textContent = friendlyError(error);
    formMessage.className = "message error";
  } finally {
    saving = false;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Record";
  }
});

async function markReturned(record) {
  if (!currentUser || record.status !== "active" ||
      returningIds.has(record.id)) return;

  const confirmed = window.confirm(
    `Mark "${record.itemName}" as returned by ${record.personName}?`
  );

  if (!confirmed) return;

  returningIds.add(record.id);
  renderRecords();

  try {
    await updateDoc(doc(db, "sharedItems", record.id), {
      status: "returned",
      returnedAt: serverTimestamp(),
      returnedDate: localDateString()
    });
  } catch (error) {
    console.error("Return update error:", error);
    alert(friendlyError(error));
  } finally {
    returningIds.delete(record.id);
    renderRecords();
  }
}

function recordMatches(record, search) {
  if (!search) return true;

  const text = [
    record.itemName,
    record.personName,
    record.notes,
    record.givenDate,
    record.dueDate,
    record.returnedDate,
    record.quantity,
    record.status
  ].join(" ").toLowerCase();

  return text.includes(search.toLowerCase());
}

function isOverdue(record) {
  return record.status === "active" &&
    Boolean(record.dueDate) &&
    record.dueDate < localDateString();
}

function formatDate(dateValue) {
  if (!dateValue) return "Not set";

  const parts = String(dateValue).split("-");
  if (parts.length !== 3) return escapeHTML(dateValue);

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function renderRecord(record) {
  const overdue = isOverdue(record);
  const status = record.status === "returned" ? "Returned" :
    overdue ? "Overdue" : "Active";

  const statusClass = record.status === "returned"
    ? "returned-pill"
    : overdue ? "overdue" : "";

  const action = record.status === "active"
    ? `<button class="return-btn" type="button" data-return-id="${escapeHTML(record.id)}" ${returningIds.has(record.id) ? "disabled" : ""}>${returningIds.has(record.id) ? "Updating..." : "Mark Returned"}</button>`
    : `<span class="status-pill returned-pill">Returned</span>`;

  return `
    <article class="record-card">
      <div class="record-main">
        <div class="record-title">${escapeHTML(record.itemName)}</div>
        <div class="record-meta">
          <span>Given to: <strong>${escapeHTML(record.personName)}</strong></span>
          <span>Quantity: <strong>${escapeHTML(record.quantity)}</strong></span>
          <span>Given: ${escapeHTML(formatDate(record.givenDate))}</span>
          <span>Due: ${escapeHTML(formatDate(record.dueDate))}</span>
          ${record.status === "returned" ? `<span>Returned: ${escapeHTML(formatDate(record.returnedDate))}</span>` : ""}
          <span class="status-pill ${statusClass}">${status}</span>
        </div>
        ${record.notes ? `<p class="record-notes">${escapeHTML(record.notes)}</p>` : ""}
      </div>
      <div class="record-actions">${action}</div>
    </article>`;
}

function renderRecords() {
  const activeSearch = $("activeSearch").value || "";
  const historySearch = $("historySearch").value || "";

  const active = allRecords.filter((record) =>
    record.status === "active" && recordMatches(record, activeSearch)
  );

  const history = allRecords.filter((record) =>
    record.status === "returned" && recordMatches(record, historySearch)
  );

  const totalActive = allRecords.filter((record) => record.status === "active");
  const totalReturned = allRecords.filter((record) => record.status === "returned");
  const overdue = totalActive.filter(isOverdue);

  $("activeCount").textContent = totalActive.length;
  $("returnedCount").textContent = totalReturned.length;
  $("totalCount").textContent = allRecords.length;
  $("overdueCount").textContent = overdue.length;

  $("activeList").innerHTML = active.length
    ? active.map(renderRecord).join("")
    : '<p class="empty-state">No active items match your search.</p>';

  $("historyList").innerHTML = history.length
    ? history.map(renderRecord).join("")
    : '<p class="empty-state">No returned items match your search.</p>';
}

$("activeSearch").addEventListener("input", renderRecords);
$("historySearch").addEventListener("input", renderRecords);

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-return-id]");
  if (!button) return;

  const record = allRecords.find((item) => item.id === button.dataset.returnId);
  if (record) markReturned(record);
});

onAuthStateChanged(auth, async (user) => {
  if (user && user.email?.toLowerCase() === ALLOWED_EMAIL.toLowerCase()) {
    currentUser = user;
    showSignedInUI(user);
    await startListening();
  } else {
    currentUser = null;

    if (stopListening) {
      stopListening();
      stopListening = null;
    }

    if (user) {
      await signOut(auth);
    }

    showSignedOutUI();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
