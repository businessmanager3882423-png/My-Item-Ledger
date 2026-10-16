
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, addDoc, doc, updateDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut
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
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

const $ = id => document.getElementById(id);
const form = $("itemForm");

let currentUser = null;
let records = [];
let stopListening = null;
let saving = false;
let returning = new Set();

const pad = n => String(n).padStart(2, "0");
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
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
  $("connectionLabel").style.background = online ? "#e1f5ee" : "#fff0d6";
  $("connectionLabel").style.color = online ? "#126a56" : "#875600";
}
function loginError(message) {
  $("loginError").textContent = message || "";
}
function showSignedIn() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  connection();
}
function showSignedOut() {
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
  records = [];
  render();
  status("Signed out");
}
function itemCollection() {
  return collection(db, "users", currentUser.uid, "items");
}

$("loginBtn").addEventListener("click", async () => {
  if (!navigator.onLine) {
    loginError("Google login ke liye internet connection zaroori hai.");
    return;
  }
  const button = $("loginBtn");
  button.disabled = true;
  button.textContent = "Opening Google...";
  loginError("");
  try {
    const result = await signInWithPopup(auth, provider);
    if (result.user.email?.toLowerCase() !== ALLOWED_EMAIL ||
        !result.user.emailVerified) {
      await signOut(auth);
      loginError("Sirf assigned Gmail se login allowed hai.");
    }
  } catch (error) {
    loginError(error.message || "Login nahi ho saka. Dobara koshish karo.");
  } finally {
    button.disabled = false;
    button.textContent = "Continue with Google";
  }
});

$("logoutBtn").addEventListener("click", async () => {
  if (!confirm("Logout karna hai? Unsynced records abhi doosre device par available nahi honge.")) return;
  if (stopListening) stopListening();
  stopListening = null;
  currentUser = null;
  records = [];
  await signOut(auth);
  showSignedOut();
});

onAuthStateChanged(auth, async user => {
  if (stopListening) stopListening();
  stopListening = null;
  currentUser = null;
  records = [];

  if (!user) {
    showSignedOut();
    return;
  }

  if (user.email?.toLowerCase() !== ALLOWED_EMAIL || !user.emailVerified) {
    await signOut(auth);
    showSignedOut();
    loginError("Yeh Gmail authorized nahi hai.");
    return;
  }

  currentUser = user;
  showSignedIn();
  status(navigator.onLine ? "Loading records..." : "Offline records");
  listen();
});

function listen() {
  if (!currentUser) return;

  stopListening = onSnapshot(
    itemCollection(),
    { includeMetadataChanges: true },
    snapshot => {
      records = snapshot.docs.map(d => ({
        id: d.id, ...d.data(),
        pendingSync: d.metadata.hasPendingWrites
      }));
      render();
      const pending = records.some(r => r.pendingSync);
      status(!navigator.onLine ? "Offline · Waiting for internet"
        : pending ? "Syncing changes..."
        : snapshot.metadata.fromCache ? "Showing cached records"
        : "All changes synced");
      connection();
    },
    error => {
      console.error("Firestore error:", error);
      status("Database error");
      if (error.code === "permission-denied") {
        $("formMessage").textContent =
          "Access denied. Firestore Rules aur assigned Gmail check karo.";
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

  if (!itemName || !personName || !givenDate ||
      !Number.isInteger(quantity) || quantity < 1 ||
      itemName.length > 100 || personName.length > 100 ||
      notes.length > 500) {
    $("formMessage").textContent = "Details check karo. Required fields sahi bharo.";
    return;
  }
  if (dueDate && dueDate < givenDate) {
    $("formMessage").textContent = "Return date, given date se pehle nahi ho sakti.";
    return;
  }

  saving = true;
  $("saveBtn").disabled = true;
  $("saveBtn").textContent = "Saving...";
  $("formMessage").textContent = "";

  try {
    await addDoc(itemCollection(), {
      itemName, personName, quantity, givenDate, dueDate, notes,
      status: "active",
      createdAt: Date.now(),
      returnedAt: null
    });

    form.reset();
    form.elements.quantity.value = "1";
    form.elements.givenDate.value = localDate();
    $("formMessage").textContent = navigator.onLine
      ? "Record saved locally; server sync confirmation is shown in the status."
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
  if (!currentUser || item.status !== "active" || returning.has(item.id)) return;
  if (!confirm(`${item.itemName} (${item.quantity}) ${item.personName} se wapas mil gaya?`)) return;

  returning.add(item.id);
  render();
  try {
    await updateDoc(doc(db, "users", currentUser.uid, "items", item.id), {
      status: "returned",
      returnedAt: Date.now(),
      returnedDate: localDate()
    });
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
    item.itemName, item.personName, item.notes, item.givenDate,
    item.dueDate, item.returnedDate
  ].some(v => String(v || "").toLowerCase().includes(query));
}
function renderList(targetId, items, active) {
  const target = $(targetId);
  target.replaceChildren();

  if (!items.length) {
    target.appendChild(element("div", "empty",
      active ? "Abhi koi active item nahi." : "Returned history abhi khali hai."));
    return;
  }

  for (const item of items) {
    const card = element("article", "record");
    const details = element("div", "record-details", "");
    details.appendChild(element("h3", "", `${item.itemName} × ${item.quantity}`));
    details.appendChild(element("p", "", `Kis ko: ${item.personName}`));
    details.appendChild(element("p", "", `Di gayi: ${item.givenDate}`));
    if (item.dueDate) details.appendChild(element("p", "", `Expected return: ${item.dueDate}`));
    if (item.notes) details.appendChild(element("p", "", `Notes: ${item.notes}`));

    if (active && item.dueDate && item.dueDate < localDate()) {
      details.appendChild(element("p", "error", "Return date guzar chuki hai."));
    }
    if (item.pendingSync) details.appendChild(element("p", "muted small", "Sync pending"));

    if (!active) {
      details.appendChild(element("p", "", `Status: Returned`));
      details.appendChild(element("p", "", `Wapas mili: ${item.returnedDate || "Unknown"}`));
    }
    card.appendChild(details);

    if (active) {
      const button = element("button", "btn btn-return",
        returning.has(item.id) ? "Updating..." : "Mark as Returned");
      button.type = "button";
      button.disabled = returning.has(item.id);
      button.addEventListener("click", () => markReturned(item));
      card.appendChild(button);
    }
    target.appendChild(card);
  }
}

function render() {
  const active = records.filter(r => r.status === "active")
    .sort((a,b) => String(b.givenDate).localeCompare(String(a.givenDate)));
  const returned = records.filter(r => r.status === "returned")
    .sort((a,b) => (b.returnedAt || 0) - (a.returnedAt || 0));

  $("activeCount").textContent = active.length;
  $("returnedCount").textContent = returned.length;
  $("totalCount").textContent = records.length;
  $("overdueCount").textContent =
    active.filter(r => r.dueDate && r.dueDate < localDate()).length;

  renderList("activeList",
    active.filter(r => matches(r, $("activeSearch").value)), true);
  renderList("historyList",
    returned.filter(r => matches(r, $("historySearch").value)), false);
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
