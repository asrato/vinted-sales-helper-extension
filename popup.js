/*
 * Vinted Seller Assistant — Popup Script
 * No ES modules — plain script. All API calls go through the service worker.
 */

(function () {
  // ─── Version from manifest ───
  var manifest = chrome.runtime.getManifest();
  var $version = document.getElementById("ext-version");
  if ($version) $version.textContent = "v" + manifest.version;

  // ─── DOM ───
  var $loading = document.getElementById("v-loading");
  var $login = document.getElementById("v-login");
  var $connected = document.getElementById("v-connected");

  var $btnLogin = document.getElementById("btn-login");
  var $loginError = document.getElementById("login-error");
  var $btnLogout = document.getElementById("btn-logout");

  var $avatar = document.getElementById("user-avatar");
  var $name = document.getElementById("user-name");
  var $email = document.getElementById("user-email");
  var $statItems = document.getElementById("stat-items");
  var $statSchedules = document.getElementById("stat-schedules");

  // ─── View switching ───
  function show(viewEl) {
    $loading.classList.remove("active");
    $login.classList.remove("active");
    $connected.classList.remove("active");
    viewEl.classList.add("active");
  }

  function showError(msg) {
    $loginError.textContent = msg;
    $loginError.classList.add("show");
  }

  function hideError() {
    $loginError.classList.remove("show");
  }

  // ─── Helper: send message to service worker ───
  function send(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (response) {
        resolve(response);
      });
    });
  }

  // ─── Init: check if already logged in ───
  async function init() {
    show($loading);

    var auth = await send({ type: "GET_AUTH" });

    if (auth && auth.token) {
      // Verify token is still valid
      var res = await send({ type: "API_GET", path: "/api/auth/me" });
      if (res && res.ok) {
        showConnected(res.data.user);
        loadStats();
        return;
      }
    }

    show($login);
  }

  function showConnected(user) {
    $name.textContent = user.name || "";
    $email.textContent = user.email || "";
    if (user.picture) {
      $avatar.src = user.picture;
      $avatar.style.display = "";
    } else {
      $avatar.style.display = "none";
    }
    show($connected);
  }

  async function loadStats() {
    try {
      var r1 = await send({ type: "API_GET", path: "/api/items/summary" });
      var r2 = await send({
        type: "API_GET",
        path: "/api/schedules/today-count",
      });
      if (r1 && r1.ok)
        $statItems.textContent =
          r1.data.inStock != null ? r1.data.inStock : "—";
      if (r2 && r2.ok)
        $statSchedules.textContent =
          r2.data.count != null ? r2.data.count : "—";
    } catch (_) {
      // non-critical
    }
  }

  // ─── Login ───
  $btnLogin.addEventListener("click", function () {
    hideError();
    $btnLogin.disabled = true;

    // Send login to service worker — this survives the popup closing
    chrome.runtime.sendMessage({ type: "GOOGLE_LOGIN" }, function (response) {
      // If popup is still open, handle the response
      if (chrome.runtime.lastError) {
        // Popup may have closed and reopened — init will handle it
        return;
      }
      if (response && response.ok) {
        showConnected(response.data.user);
        loadStats();
      } else {
        var errMsg = response ? response.error : "Login failed.";
        if (
          errMsg &&
          errMsg.indexOf("canceled") === -1 &&
          errMsg.indexOf("closed") === -1
        ) {
          showError(errMsg);
        }
      }
      $btnLogin.disabled = false;
    });
  });

  // ─── Logout ───
  $btnLogout.addEventListener("click", function () {
    send({ type: "LOGOUT" }).then(function () {
      show($login);
    });
  });

  // ─── Start ───
  init();

  // ─── Version check ───
  (function checkForUpdate() {
    var currentVersion = manifest.version;
    fetch(
      "https://api.github.com/repos/asrato/vinted-sales-helper-extension/releases/latest",
    )
      .then(function (res) {
        return res.json();
      })
      .then(function (release) {
        if (!release || !release.tag_name) return;
        var latest = release.tag_name.replace(/^v/, "");
        if (latest !== currentVersion && isNewer(latest, currentVersion)) {
          var $banner = document.getElementById("update-banner");
          var $newVersion = document.getElementById("update-version");
          if ($banner && $newVersion) {
            $newVersion.textContent = "v" + latest;
            $banner.style.display = "flex";
          }
        }
      })
      .catch(function () {
        /* silent */
      });

    function isNewer(a, b) {
      var pa = a.split(".").map(Number);
      var pb = b.split(".").map(Number);
      for (var i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return true;
        if ((pa[i] || 0) < (pb[i] || 0)) return false;
      }
      return false;
    }
  })();
})();
