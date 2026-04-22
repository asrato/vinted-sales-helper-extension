/*
 * Vinted Seller Assistant — Background Service Worker
 * Handles: Google OAuth, API proxying, message passing.
 * No ES module imports — everything is self-contained.
 */

// ─── Config ───
importScripts("config.js");
const API_URL = CONFIG.API_URL;
const GOOGLE_CLIENT_ID = CONFIG.GOOGLE_CLIENT_ID;
const TOKEN_KEY = CONFIG.TOKEN_KEY;

// ─── Message router ───

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case "GOOGLE_LOGIN":
      handleGoogleLogin()
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "LOGOUT":
      chrome.storage.local.remove(TOKEN_KEY).then(() => {
        broadcastToVintedTabs({ type: "AUTH_CHANGED", loggedIn: false });
        sendResponse({ ok: true });
      });
      return true;

    case "GET_AUTH":
      chrome.storage.local.get(TOKEN_KEY).then((data) => {
        sendResponse({ token: data[TOKEN_KEY] || null, apiUrl: API_URL });
      });
      return true;

    case "API_GET":
      apiFetch("GET", msg.path)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "API_POST":
      apiFetch("POST", msg.path, msg.body)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "API_PATCH":
      apiFetch("PATCH", msg.path, msg.body)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;

    case "API_PUT":
      apiFetch("PUT", msg.path, msg.body)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
  }
});

// ─── Google OAuth ───

async function handleGoogleLogin() {
  const redirectUri = chrome.identity.getRedirectURL();
  const nonce = Math.random().toString(36).substring(2);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: "id_token",
    redirect_uri: redirectUri,
    scope: "openid email profile",
    nonce: nonce,
    prompt: "select_account",
  });

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  // Extract id_token from the redirect URL hash
  const hashStr = responseUrl.split("#")[1];
  if (!hashStr) throw new Error("No response from Google.");

  const hashParams = new URLSearchParams(hashStr);
  const idToken = hashParams.get("id_token");
  if (!idToken) throw new Error("No ID token received from Google.");

  // Exchange the Google ID token for a backend JWT
  const res = await fetch(API_URL + "/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: idToken }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(
      errData?.error || "Authentication failed (" + res.status + ")",
    );
  }

  const data = await res.json();

  // Store the JWT
  await chrome.storage.local.set({ [TOKEN_KEY]: data.token });

  // Notify all Vinted tabs
  broadcastToVintedTabs({ type: "AUTH_CHANGED", loggedIn: true });

  return data;
}

// ─── API fetch helper ───

async function apiFetch(method, path, body) {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  const token = stored[TOKEN_KEY];
  if (!token) throw new Error("Not logged in.");

  const opts = {
    method: method,
    headers: { Authorization: "Bearer " + token },
  };

  if (body && method !== "GET") {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(API_URL + path, opts);
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.error || "Request failed (" + res.status + ")");
  }
  return res.json();
}

// ─── Broadcast to Vinted tabs ───

async function broadcastToVintedTabs(message) {
  const tabs = await chrome.tabs.query({ url: "https://*.vinted.*/*" });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (_) {
      // Content script may not be loaded yet
    }
  }
}
