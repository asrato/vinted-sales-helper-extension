/*
 * Vinted Sales Helper — Content Script
 * Injected on all Vinted pages.
 * - Shows a connection indicator on all pages
 * - On the sell page (/items/new), shows the auto-fill panel
 * - On item pages belonging to the user, shows mark-as-listed panel
 */

(function () {
  var INDICATOR_ID = "vs-indicator";
  var PANEL_ID = "vsh-panel";
  var TOGGLE_ID = "vsh-toggle";
  var LISTED_PANEL_ID = "vsh-listed-panel";
  var connected = false;
  var schedules = [];
  var panelOpen = false;
  var filledScheduleId = null;
  var vintedProfile = null;
  var matchedSchedule = null;
  var markingAsListed = false;

  // ─── Helpers ───

  function send(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (res) {
        resolve(res);
      });
    });
  }

  function isSellPage() {
    return /\/items\/new/.test(window.location.pathname);
  }

  function isItemPage() {
    // Matches /items/1234-some-slug but NOT /items/new
    return /\/items\/\d+/.test(window.location.pathname);
  }

  function formatTime(isoStr) {
    try {
      var d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (_) {
      return "";
    }
  }

  function formatPrice(cents) {
    if (!cents && cents !== 0) return "";
    return (cents / 100).toFixed(2) + " €";
  }

  // ─── Connection indicator (all pages) ───

  function renderIndicator() {
    var el = document.getElementById(INDICATOR_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = INDICATOR_ID;
      document.body.appendChild(el);
    }
    el.textContent = "V";
    el.title = connected
      ? "Vinted Sales Helper — Connected"
      : "Vinted Sales Helper — Not connected";
    el.className = connected ? "vs-on" : "vs-off";
  }

  // ─── Auto-fill panel (sell page only) ───

  function renderToggle() {
    console.log(
      "[VSH] renderToggle called. isSellPage:",
      isSellPage(),
      "connected:",
      connected,
    );
    if (!isSellPage() || !connected) {
      removePanel();
      return;
    }

    var btn = document.getElementById(TOGGLE_ID);
    if (!btn) {
      btn = document.createElement("button");
      btn.id = TOGGLE_ID;
      btn.addEventListener("click", togglePanel);
      document.body.appendChild(btn);
      console.log("[VSH] Toggle button created and appended to body");
    }

    var count = schedules.length;
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>' +
      '<line x1="16" y1="2" x2="16" y2="6"/>' +
      '<line x1="8" y1="2" x2="8" y2="6"/>' +
      '<line x1="3" y1="10" x2="21" y2="10"/>' +
      "</svg>" +
      (count > 0 ? '<span class="vsh-badge">' + count + "</span>" : "");
    btn.title =
      count + " pending schedule" + (count !== 1 ? "s" : "") + " for today";
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    if (panelOpen) {
      renderPanel();
    } else {
      var p = document.getElementById(PANEL_ID);
      if (p) p.remove();
    }
  }

  function renderPanel() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }

    var html =
      '<div class="vsh-panel-header">' +
      '<span class="vsh-panel-title">Today\'s Schedules</span>' +
      '<button class="vsh-close" id="vsh-close-btn">&times;</button>' +
      "</div>";

    if (schedules.length === 0) {
      html += '<div class="vsh-empty">No pending schedules for today.</div>';
    } else {
      html += '<div class="vsh-list">';
      for (var i = 0; i < schedules.length; i++) {
        var s = schedules[i];
        var isFilled = filledScheduleId === s.id;
        html +=
          '<div class="vsh-item' +
          (isFilled ? " vsh-filled" : "") +
          '" data-id="' +
          s.id +
          '">' +
          '<div class="vsh-item-row">' +
          '<div class="vsh-item-info">' +
          '<span class="vsh-item-title">' +
          escHtml(s.title) +
          "</span>" +
          '<span class="vsh-item-meta">' +
          (s.price ? formatPrice(s.price) : "") +
          (s.scheduled_at ? " · " + formatTime(s.scheduled_at) : "") +
          "</span>" +
          "</div>" +
          (isFilled
            ? '<span class="vsh-filled-badge">Filled</span>'
            : '<button class="vsh-fill-btn" data-id="' +
              s.id +
              '">Fill</button>') +
          "</div>";

        html += "</div>";
      }
      html += "</div>";
    }

    panel.innerHTML = html;

    // Bind events
    var closeBtn = document.getElementById("vsh-close-btn");
    if (closeBtn) closeBtn.addEventListener("click", togglePanel);

    var fillBtns = panel.querySelectorAll(".vsh-fill-btn");
    for (var j = 0; j < fillBtns.length; j++) {
      fillBtns[j].addEventListener("click", handleFill);
    }
  }

  function removePanel() {
    var p = document.getElementById(PANEL_ID);
    if (p) p.remove();
    var t = document.getElementById(TOGGLE_ID);
    if (t) t.remove();
    panelOpen = false;
  }

  function escHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // ─── Fill Vinted form ───

  function handleFill(e) {
    var id = Number(e.currentTarget.getAttribute("data-id"));
    var schedule = null;
    for (var i = 0; i < schedules.length; i++) {
      if (schedules[i].id === id) {
        schedule = schedules[i];
        break;
      }
    }
    if (!schedule) return;

    fillVintedForm(schedule);
    filledScheduleId = id;
    renderPanel();
  }

  function fillVintedForm(schedule) {
    // Title
    var titleEl = findFormField("title");
    if (titleEl) setInputValue(titleEl, schedule.title || "");

    // Description
    var descEl = findFormField("description");
    if (descEl) setInputValue(descEl, schedule.description || "");

    // Price — stored in cents, Vinted expects the decimal value
    if (schedule.price) {
      var priceEl = findFormField("price");
      if (priceEl) setInputValue(priceEl, (schedule.price / 100).toFixed(2));
    }
  }

  /**
   * Find a Vinted form field by trying multiple selector strategies.
   * Vinted's React app uses various patterns — we try them all.
   */
  function findFormField(fieldName) {
    var selectors;
    if (fieldName === "title") {
      selectors = [
        'input[name*="title" i]',
        'input[data-testid*="title" i]',
        'input[placeholder*="title" i]',
        'input[placeholder*="título" i]',
        'input[placeholder*="titre" i]',
        'input[placeholder*="Titel" i]',
        'input[placeholder*="titolo" i]',
        'input[id*="title" i]',
        // Fallback: first visible text input in the form area
      ];
    } else if (fieldName === "description") {
      selectors = [
        'textarea[name*="description" i]',
        'textarea[data-testid*="description" i]',
        'textarea[placeholder*="description" i]',
        'textarea[placeholder*="descrição" i]',
        'textarea[placeholder*="beschreibung" i]',
        'textarea[placeholder*="descrizione" i]',
        'textarea[id*="description" i]',
        // Also try contenteditable divs
        '[contenteditable="true"][data-testid*="description" i]',
      ];
    } else if (fieldName === "price") {
      selectors = [
        'input[name*="price" i]',
        'input[data-testid*="price" i]',
        'input[placeholder*="price" i]',
        'input[placeholder*="preço" i]',
        'input[placeholder*="prix" i]',
        'input[placeholder*="Preis" i]',
        'input[placeholder*="prezzo" i]',
        'input[id*="price" i]',
        'input[type="number"][name*="price" i]',
        // Price often has currency symbol nearby
        'input[inputmode="decimal"]',
      ];
    }

    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && isVisible(el)) return el;
    }

    return null;
  }

  function isVisible(el) {
    return (
      el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0
    );
  }

  /**
   * Set a value on an input/textarea in a React-compatible way.
   * React overrides the native value setter, so we need to call
   * the native setter and dispatch an input event.
   */
  function setInputValue(el, value) {
    // Handle contenteditable elements
    if (el.getAttribute("contenteditable") === "true") {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    el.focus();

    // Get the native value setter (React overrides .value)
    var nativeSetter = Object.getOwnPropertyDescriptor(
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    ).set;

    nativeSetter.call(el, value);

    // Dispatch events that React listens to
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ─── Item page: Mark as Listed ───

  function getPageItemTitle() {
    // Log all candidates for debugging
    var candidates = [];

    // Try the page's <title> tag first — usually "Item Title | Vinted"
    var pageTitle = document.title || "";
    var titleMatch = pageTitle.split("|")[0].trim();
    if (titleMatch) candidates.push({ src: "document.title", val: titleMatch });

    // Try specific selectors
    var specificSelectors = [
      '[data-testid*="item-title"]',
      '[itemprop="name"]',
      '[class*="ItemTitle"]',
      '[class*="item-title"]',
    ];
    for (var i = 0; i < specificSelectors.length; i++) {
      var el = document.querySelector(specificSelectors[i]);
      if (el && el.textContent.trim()) {
        candidates.push({
          src: specificSelectors[i],
          val: el.textContent.trim(),
        });
      }
    }

    // h1 — try last child (skip brand) or full text
    var h1 = document.querySelector("h1");
    if (h1) {
      var children = h1.children;
      if (children.length > 1) {
        var lastChild = children[children.length - 1];
        if (lastChild && lastChild.textContent.trim()) {
          candidates.push({
            src: "h1>lastChild",
            val: lastChild.textContent.trim(),
          });
        }
      }
      candidates.push({ src: "h1", val: h1.textContent.trim() });
    }

    console.log("[VSH] Title candidates:", JSON.stringify(candidates));

    // Pick the best candidate: prefer document.title, then specific selectors, then h1
    // Skip very short values (likely brand names)
    for (var j = 0; j < candidates.length; j++) {
      var val = candidates[j].val;
      // Skip single-word values (likely brand), require at least 3 words or 15 chars
      var wordCount = val.split(/\s+/).length;
      if (wordCount >= 3 || val.length >= 15) {
        console.log("[VSH] Selected title from", candidates[j].src, ":", val);
        return val;
      }
    }

    // If all are short, still return document.title if available
    if (titleMatch) return titleMatch;
    return candidates.length > 0 ? candidates[0].val : null;
  }

  function getPageSellerMemberId() {
    // Find the seller profile link and extract the numeric member ID
    var selectors = [
      'a[href*="/member/"]',
      '[data-testid*="owner"] a',
      '[class*="ItemOwner"] a',
      ".item-page-owner a",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var links = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < links.length; j++) {
        var href = links[j].getAttribute("href") || "";
        var match = href.match(/\/member\/(\d+)/);
        if (match) return match[1]; // numeric member ID
      }
    }
    return null;
  }

  function normalizeTitle(str) {
    return (str || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function findMatchingSchedule(pageTitle) {
    if (!pageTitle || schedules.length === 0) return null;
    var norm = normalizeTitle(pageTitle);
    // First pass: exact match
    for (var i = 0; i < schedules.length; i++) {
      var schedTitle = normalizeTitle(schedules[i].title);
      if (schedTitle === norm) return schedules[i];
    }
    // Second pass: contains — but only if the shorter string is at least
    // 50% the length of the longer one (prevents "pokémon" matching everything)
    for (var j = 0; j < schedules.length; j++) {
      var st = normalizeTitle(schedules[j].title);
      var shorter = norm.length <= st.length ? norm : st;
      var longer = norm.length <= st.length ? st : norm;
      if (
        shorter.length >= longer.length * 0.5 &&
        longer.indexOf(shorter) !== -1
      ) {
        return schedules[j];
      }
    }
    return null;
  }

  function isMyItem(pageMemberId) {
    if (!vintedProfile || !pageMemberId) return false;
    // Extract member ID from vintedProfile (could be a full URL or just an ID)
    var profileMatch = vintedProfile.match(/\/member\/(\d+)/);
    var profileId = profileMatch
      ? profileMatch[1]
      : vintedProfile.replace(/\D/g, "");
    return profileId === pageMemberId;
  }

  function checkItemPage() {
    if (!connected || !isItemPage()) return;

    console.log("[VSH] On item page, checking for schedule match...");

    // Need both schedules and vinted profile
    Promise.all([
      schedules.length > 0
        ? Promise.resolve()
        : send({ type: "API_GET", path: "/api/schedules/today" }).then(
            function (res) {
              if (
                res &&
                res.ok &&
                res.data &&
                Array.isArray(res.data.schedules)
              ) {
                schedules = res.data.schedules;
              } else if (res && res.ok && Array.isArray(res.data)) {
                schedules = res.data;
              } else {
                schedules = [];
              }
            },
          ),
      vintedProfile !== null
        ? Promise.resolve()
        : send({ type: "API_GET", path: "/api/settings/preferences" }).then(
            function (res) {
              if (res && res.ok && res.data) {
                vintedProfile = res.data.vintedProfile || "";
              }
            },
          ),
    ]).then(function () {
      if (!vintedProfile) {
        console.log("[VSH] No vinted profile configured in settings.");
        return;
      }
      if (schedules.length === 0) {
        console.log("[VSH] No pending schedules for today.");
        return;
      }

      // Wait a bit for Vinted's SPA to render the page content
      setTimeout(function () {
        var pageMemberId = getPageSellerMemberId();
        console.log(
          "[VSH] Page member ID:",
          pageMemberId,
          "| My profile:",
          vintedProfile,
        );

        if (!isMyItem(pageMemberId)) {
          console.log("[VSH] Not my item, skipping.");
          removeListedPanel();
          return;
        }

        var pageTitle = getPageItemTitle();
        console.log("[VSH] Page title:", pageTitle);

        matchedSchedule = findMatchingSchedule(pageTitle);
        if (matchedSchedule) {
          console.log(
            "[VSH] Matched schedule:",
            matchedSchedule.title,
            "(id:",
            matchedSchedule.id,
            ")",
          );
          renderListedPanel();
        } else {
          console.log("[VSH] No schedule matches this item title.");
          removeListedPanel();
        }
      }, 1500);
    });
  }

  function renderListedPanel() {
    var panel = document.getElementById(LISTED_PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = LISTED_PANEL_ID;
      document.body.appendChild(panel);
    }

    var s = matchedSchedule;
    panel.innerHTML =
      '<div class="vsh-listed-header">' +
      '<span class="vsh-listed-title">Schedule Match Found</span>' +
      '<button class="vsh-close" id="vsh-listed-close">&times;</button>' +
      "</div>" +
      '<div class="vsh-listed-body">' +
      '<div class="vsh-listed-info">' +
      '<span class="vsh-listed-name">' +
      escHtml(s.title) +
      "</span>" +
      '<span class="vsh-item-meta">' +
      (s.price ? formatPrice(s.price) : "") +
      (s.scheduled_at ? " · " + formatTime(s.scheduled_at) : "") +
      "</span>" +
      "</div>" +
      '<button class="vsh-mark-listed-btn" id="vsh-mark-listed-btn">' +
      (markingAsListed ? "Saving..." : "✓ Mark as Listed") +
      "</button>" +
      "</div>";

    // Bind events
    document
      .getElementById("vsh-listed-close")
      .addEventListener("click", function () {
        removeListedPanel();
      });

    var markBtn = document.getElementById("vsh-mark-listed-btn");
    if (!markingAsListed) {
      markBtn.addEventListener("click", handleMarkAsListed);
    }
  }

  function removeListedPanel() {
    var p = document.getElementById(LISTED_PANEL_ID);
    if (p) p.remove();
    matchedSchedule = null;
  }

  function handleMarkAsListed() {
    if (!matchedSchedule || markingAsListed) return;

    markingAsListed = true;
    renderListedPanel();

    send({
      type: "API_PUT",
      path: "/api/schedules/" + matchedSchedule.id,
      body: {
        status: "listed",
        vintedUrl: window.location.href,
      },
    })
      .then(function (res) {
        markingAsListed = false;
        if (res && res.ok) {
          // Remove from local list and show success
          var id = matchedSchedule.id;
          schedules = schedules.filter(function (s) {
            return s.id !== id;
          });

          var panel = document.getElementById(LISTED_PANEL_ID);
          if (panel) {
            panel.innerHTML =
              '<div class="vsh-listed-header">' +
              '<span class="vsh-listed-title">Done!</span>' +
              "</div>" +
              '<div class="vsh-listed-body">' +
              '<span class="vsh-listed-success">✓ Marked as listed successfully</span>' +
              "</div>";
            setTimeout(function () {
              removeListedPanel();
            }, 3000);
          }
          matchedSchedule = null;
        } else {
          console.error("[VSH] Failed to mark as listed:", res);
          renderListedPanel();
        }
      })
      .catch(function (err) {
        markingAsListed = false;
        console.error("[VSH] Error marking as listed:", err);
        renderListedPanel();
      });
  }

  // ─── Fetch today's schedules ───

  function loadSchedules() {
    if (!connected || !isSellPage()) return;

    // Show toggle immediately (with 0 count) while we load
    renderToggle();

    console.log("[VSH] Fetching schedules...");
    send({ type: "API_GET", path: "/api/schedules/today" })
      .then(function (res) {
        console.log("[VSH] Schedules API response:", JSON.stringify(res));
        if (res && res.ok && res.data && Array.isArray(res.data.schedules)) {
          schedules = res.data.schedules;
        } else if (res && res.ok && Array.isArray(res.data)) {
          schedules = res.data;
        } else {
          schedules = [];
          console.warn("[VSH] Failed to load schedules:", res);
        }
        console.log("[VSH] Loaded", schedules.length, "schedules");
        renderToggle();
      })
      .catch(function (err) {
        console.error("[VSH] Error loading schedules:", err);
        schedules = [];
        renderToggle();
      });
  }

  // ─── SPA navigation detection ───

  var lastUrl = window.location.href;
  function checkNavigation() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      panelOpen = false;
      filledScheduleId = null;
      matchedSchedule = null;
      removeListedPanel();
      if (isSellPage()) {
        loadSchedules();
      } else if (isItemPage()) {
        removePanel();
        checkItemPage();
      } else {
        removePanel();
      }
    }
  }

  // Poll for SPA navigation (Vinted uses client-side routing)
  setInterval(checkNavigation, 1000);

  // ─── Init ───

  chrome.runtime.sendMessage({ type: "GET_AUTH" }, function (res) {
    connected = !!(res && res.token);
    renderIndicator();
    console.log(
      "[VSH] Auth check:",
      connected ? "connected" : "not connected",
      "| Sell page:",
      isSellPage(),
      "| Item page:",
      isItemPage(),
      "| URL:",
      window.location.href,
    );
    if (connected && isSellPage()) {
      loadSchedules();
    } else if (connected && isItemPage()) {
      checkItemPage();
    }
  });

  // Listen for auth changes
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === "AUTH_CHANGED") {
      connected = msg.loggedIn;
      renderIndicator();
      if (connected && isSellPage()) {
        loadSchedules();
      } else if (connected && isItemPage()) {
        checkItemPage();
      } else if (!connected) {
        removePanel();
        removeListedPanel();
      }
    }
  });
})();
