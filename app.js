
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  addDoc,
  doc,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAfBkjqPbuuM7V2A5xoNSHePEMDHKdRPIA",
  authDomain: "mylist-e2202.firebaseapp.com",
  projectId: "mylist-e2202",
  storageBucket: "mylist-e2202.firebasestorage.app",
  messagingSenderId: "1003468030717",
  appId: "1:1003468030717:web:12dc9372fdbbb4af1bb494"
};

const ALLOWED_EMAIL = "mianusama3882423@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

const $ = id => document.getElementById(id);
const form = $("itemForm");
const loginForm = $("loginForm");

let currentUser = null;
let records = [];
let stopListening = null;
let saving = false;
let returning = new Set();
let verificationFlow = false;

const pad = n => String(n).padStart(2, "0");

function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

form.elements.givenDate.value = localDate();

function status(message) {
  $("syncStatus").textContent = message;
}

function connection() {
  const online = navigator.onLine;

  $("connectionLabel").textContent = online
    ? "Online · Sync available"
    : "Offline · Changes queued";

  $("connectionLabel").style.background =
    online ? "#e1f5ee" : "#fff0d6";

  $("connectionLabel").style.color =
    online ? "#126a56" : "#875600";
}

function loginError(message) {
  $("loginError").textContent = message || "";
}

function showSignedIn() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  loginError("");
  connection();
}

function showSignedOut() {
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");

  currentUser = null;
  records = [];
  render();
  status("Signed out");
}

function itemCollection() {
  return collection(db, "users", currentUser.uid, "items");
}

// Email/password login with persistent browser session.
loginForm.addEventListener("submit", async event => {
  event.preventDefault();

  if (!navigator.onLine) {
    loginError("Login ke liye internet connection zaroori hai.");
    return;
  }

  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value;
  const button = $("loginBtn");

  if (email !== ALLOWED_EMAIL) {
    loginError("Sirf assigned email se login allowed hai.");
    return;
  }

  button.disabled = true;
  button.textContent = "Logging in...";
  loginError("");

  try {
    await setPersistence(auth, browserLocalPersistence);

    verificationFlow = true;

    const credential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    if (credential.user.email?.toLowerCase() !== ALLOWED_EMAIL) {
      await signOut(auth);
      loginError("Yeh email authorized nahi hai.");
      return;
    }

    if (!credential.user.emailVerified) {
      try {
        await sendEmailVerification(credential.user);
        loginError(
          "Verification email bhej di gayi hai. Email verify karo, " +
          "phir dobara login karo."
        );
      } catch (verificationError) {
        console.error(verificationError);
        loginError(
          "Email verify nahi hui. Internet aur Firebase settings check karo."
        );
      }

      await signOut(auth);
      return;
    }

    $("loginPassword").value = "";
  } catch (error) {
    console.error("Login error:", error);

    if (
      error.code === "auth/invalid-credential" ||
      error.code === "auth/wrong-password" ||
      error.code === "auth/user-not-found"
    ) {
      loginError("Email ya password ghalat hai.");
    } else if (error.code === "auth/too-many-requests") {
      loginError("Bohat zyada attempts hue hain. Kuch dair baad try karo.");
    } else if (error.code === "auth/network-request-failed") {
      loginError("Internet connection check karo.");
    } else if (error.code === "auth/operation-not-allowed") {
      loginError(
        "Firebase Console mein Email/Password sign-in enable karo."
      );
    } else {
      loginError(error.message || "Login nahi ho saka. Dobara try karo.");
    }
  } finally {
    verificationFlow = false;
    button.disabled = false;
    button.textContent = "Login";
  }
});

// Password reset email.
$("resetPasswordBtn").addEventListener("click", async () => {
  const email = $("loginEmail").value.trim().toLowerCase();

  if (email !== ALLOWED_EMAIL) {
    loginError("Pehle assigned email address enter karo.");
    $("loginEmail").focus();
    return;
  }

  if (!navigator.onLine) {
    loginError("Password reset ke liye internet zaroori hai.");
    return;
  }

  const button = $("resetPasswordBtn");
  button.disabled = true;
  button.textContent = "Sending reset email...";

  try {
    await sendPasswordResetEmail(auth, email);
    loginError("Agar account maujood hai, password reset email bhej di gayi hai.");
  } catch (error) {
    console.error(error);

    if (error.code === "auth/operation-not-allowed") {
      loginError("Firebase mein Email/Password sign-in enable karo.");
    } else {
      loginError("Reset email nahi bheji ja saki. Email aur settings check karo.");
    }
  } finally {
    button.disabled = false;
    button.textContent = "Forgot password?";
  }
});

// Logout only when the user chooses Logout.
$("logoutBtn").addEventListener("click", async () => {
  if (!confirm("Logout karna hai? Pehle pending sync status check kar lo.")) {
    return;
  }

  if (stopListening) stopListening();
  stopListening = null;

  try {
    await signOut(auth);
    showSignedOut();
  } catch (error) {
    console.error(error);
    status("Logout failed");
    alert("Logout nahi ho saka. Dobara try karo.");
  }
});

// Restore the saved Firebase session when the app is reopened.
onAuthStateChanged(auth, async user => {
  if (stopListening) stopListening();
  stopListening = null;
  currentUser = null;
  records = [];

  if (!user) {
    showSignedOut();
    return;
  }

  const email = user.email?.toLowerCase();

  if (email !== ALLOWED_EMAIL) {
    await signOut(auth);
    showSignedOut();
    loginError("Sirf assigned email se login allowed hai.");
    return;
  }

  // During login, the submit handler sends the verification email.
  if (!user.emailVerified) {
    if (verificationFlow) return;

    await signOut(auth);
    showSignedOut();
    loginError("Apni email verify karo, phir dobara login karo.");
    return;
  }

  currentUser = user;
  showSignedIn();
  status(navigator.onLine ? "Loading records..." : "Offline · Loading cache");
  listen();
});

function listen() {
  if (!currentUser) return;

  stopListening = onSnapshot(
    itemCollection(),
    { includeMetadataChanges: true },
    snapshot => {
      records = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
        pendingSync: d.metadata.hasPendingWrites
      }));

      render();

      const pending = records.some(r => r.pendingSync);

      status(
        !navigator.onLine
          ? "Offline · Waiting for internet"
          : pending
            ? "Syncing changes..."
            : snapshot.metadata.fromCache
              ? "Showing cached records"
              : "All changes synced"
      );

      connection();
    },
    error => {
      console.error("Firestore error:", error);
      status("Database error");

      if (error.code === "permission-denied") {
        $("formMessage").textContent =
          "Access denied. Firestore Rules, assigned email aur verification check karo.";
      }
    }
  );
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser || saving) return;

  const f = new FormData(form);
  const itemName = String(f.get("itemName") || "").trim();
  const personName = String(f.get("personName") || "").trim();
  const quantity = Number(f.get("quantity"));
  const givenDate = String(f.get("givenDate") || "");
  const dueDate = String(f.get("dueDate") || "");
  const notes = String(f.get("notes") || "").trim();

  if (
    !itemName ||
    !personName ||
    !givenDate ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 99999 ||
    itemName.length > 100 ||
    personName.length > 100 ||
    notes.length > 500
  ) {
    $("formMessage").textContent =
      "Details check karo. Required fields sahi bharo.";
    return;
  }

  if (dueDate && dueDate < givenDate) {
    $("formMessage").textContent =
      "Return date, given date se pehle nahi ho sakti.";
    return;
  }

  saving = true;
  $("saveBtn").disabled = true;
  $("saveBtn").textContent = "Saving...";
  $("formMessage").textContent = "";

  try {
    await addDoc(itemCollection(), {
      itemName,
      personName,
      quantity,
      givenDate,
      dueDate,
      notes,
      status: "active",
      createdAt: Date.now(),
      returnedAt: null
    });

    form.reset();
    form.elements.quantity.value = "1";
    form.elements.givenDate.value = localDate();

    $("formMessage").textContent = navigator.onLine
      ? "Record added. Check sync status for server confirmation."
      : "Record queued locally. Internet aane par sync hoga.";
  } catch (error) {
    console.error(error);
    $("formMessage").textContent =
      "Save nahi hua. Internet, login aur Firestore Rules check karo.";
  } finally {
    saving = false;
    $("saveBtn").disabled = false;
    $("saveBtn").textContent = "Save Record";
  }
});

async function markReturned(item) {
  if (!currentUser || item.status !== "active" || returning.has(item.id)) {
    return;
  }

  if (
    !confirm(
      `${item.itemName} (${item.quantity}) ${item.personName} se wapas mil gaya?`
    )
  ) {
    return;
  }

  returning.add(item.id);
  render();

  try {
    await updateDoc(
      doc(db, "users", currentUser.uid, "items", item.id),
      {
        status: "returned",
        returnedAt: Date.now(),
        returnedDate: localDate()
      }
    );
  } catch (error) {
    console.error(error);
    alert("Return update nahi hua. Connection aur Rules check karo.");
  } finally {
    returning.delete(item.id);
    render();
  }
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value ?? "";
  return node;
}

function matches(item, query) {
  query = query.trim().toLowerCase();

  return !query || [
    item.itemName,
    item.personName,
    item.notes,
    item.givenDate,
    item.dueDate,
    item.returnedDate
  ].some(v => String(v || "").toLowerCase().includes(query));
}

function renderList(targetId, items, active) {
  const target = $(targetId);
  target.replaceChildren();

  if (!items.length) {
    target.appendChild(
      element(
        "div",
        "empty",
        active
          ? "Abhi koi active item nahi."
          : "Returned history abhi khali hai."
      )
    );
    return;
  }

  for (const item of items) {
    const card = element("article", "record");
    const details = element("div", "record-details", "");

    details.appendChild(
      element("h3", "", `${item.itemName} × ${item.quantity}`)
    );
    details.appendChild(element("p", "", `Kis ko: ${item.personName}`));
    details.appendChild(element("p", "", `Di gayi: ${item.givenDate}`));

    if (item.dueDate) {
      details.appendChild(
        element("p", "", `Expected return: ${item.dueDate}`)
      );
    }

    if (item.notes) {
      details.appendChild(element("p", "", `Notes: ${item.notes}`));
    }

    if (active && item.dueDate && item.dueDate < localDate()) {
      details.appendChild(
        element("p", "error", "Return date guzar chuki hai.")
      );
    }

    if (item.pendingSync) {
      details.appendChild(element("p", "muted small", "Sync pending"));
    }

    if (!active) {
      details.appendChild(element("p", "", "Status: Returned"));
      details.appendChild(
        element("p", "", `Wapas mili: ${item.returnedDate || "Unknown"}`)
      );
    }

    card.appendChild(details);

    if (active) {
      const button = element(
        "button",
        "btn btn-return",
        returning.has(item.id) ? "Updating..." : "Mark as Returned"
      );

      button.type = "button";
      button.disabled = returning.has(item.id);
      button.addEventListener("click", () => markReturned(item));
      card.appendChild(button);
    }

    target.appendChild(card);
  }
}

function render() {
  const active = records
    .filter(r => r.status === "active")
    .sort((a, b) =>
      String(b.givenDate).localeCompare(String(a.givenDate))
    );

  const returned = records
    .filter(r => r.status === "returned")
    .sort((a, b) => (b.returnedAt || 0) - (a.returnedAt || 0));

  $("activeCount").textContent = active.length;
  $("returnedCount").textContent = returned.length;
  $("totalCount").textContent = records.length;

  $("overdueCount").textContent = active.filter(
    r => r.dueDate && r.dueDate < localDate()
  ).length;

  renderList(
    "activeList",
    active.filter(r => matches(r, $("activeSearch").value)),
    true
  );

  renderList(
    "historyList",
    returned.filter(r => matches(r, $("historySearch").value)),
    false
  );
}

$("activeSearch").addEventListener("input", render);
$("historySearch").addEventListener("input", render);

window.addEventListener("online", () => {
  connection();
  status("Connection restored · Checking sync...");
});

window.addEventListener("offline", () => {
  connection();
  status("Offline · Changes queued");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}
