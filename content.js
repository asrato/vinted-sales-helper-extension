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
        var cf = parseCustomFields(s);
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

        // Show custom fields if any
        if (cf.length > 0) {
          html += '<div class="vsh-custom-fields">';
          for (var k = 0; k < cf.length; k++) {
            html +=
              '<span class="vsh-cf-tag">' +
              escHtml(cf[k].name) +
              ": " +
              escHtml(cf[k].value) +
              "</span>";
          }
          html += "</div>";
        }

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

  function parseCustomFields(schedule) {
    if (!schedule.custom_fields) return [];
    try {
      var fields =
        typeof schedule.custom_fields === "string"
          ? JSON.parse(schedule.custom_fields)
          : schedule.custom_fields;
      return Array.isArray(fields) ? fields : [];
    } catch (_) {
      return [];
    }
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

    // Custom fields — fill sequentially (each picker needs time to open/close)
    var customFields = parseCustomFields(schedule);
    fillCustomFieldsSequentially(customFields, 0);
  }

  function fillCustomFieldsSequentially(fields, index) {
    if (index >= fields.length) return;
    var cf = fields[index];
    if (!cf.name || !cf.value) {
      fillCustomFieldsSequentially(fields, index + 1);
      return;
    }

    // Check if this field matches a known picker field (brand, condition, size, etc.)
    var isKnownPicker = false;
    var norm = cf.name.toLowerCase().trim();
    for (var key in FIELD_SYNONYMS) {
      var synonyms = FIELD_SYNONYMS[key];
      for (var si = 0; si < synonyms.length; si++) {
        if (
          norm === synonyms[si] ||
          norm.indexOf(synonyms[si]) !== -1 ||
          synonyms[si].indexOf(norm) !== -1
        ) {
          isKnownPicker = true;
          break;
        }
      }
      if (isKnownPicker) break;
    }

    if (isKnownPicker) {
      // Always use Vinted picker for known picker fields
      fillVintedPicker(cf.name, cf.value, function () {
        fillCustomFieldsSequentially(fields, index + 1);
      });
      return;
    }

    // For unknown fields, try standard form elements first
    var el = findFormFieldByLabel(cf.name);
    if (el && isEditableFormElement(el)) {
      if (el.tagName === "SELECT") {
        setSelectValue(el, cf.value);
      } else {
        setInputValue(el, cf.value);
      }
      fillCustomFieldsSequentially(fields, index + 1);
    } else {
      // Fallback to Vinted-specific picker
      fillVintedPicker(cf.name, cf.value, function () {
        fillCustomFieldsSequentially(fields, index + 1);
      });
    }
  }

  /**
   * Check if an element is a genuinely editable form element
   * (not a hidden React internal input, not readonly, etc.)
   */
  function isEditableFormElement(el) {
    if (!el) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.type === "hidden") return false;
    // Check it's actually visible and has dimensions
    var rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return false;
    // Check computed visibility
    var style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return false;
    // Must be a writable input type (not just an element with name/id matching)
    var tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return false;
    // For inputs, check it's a text-like type
    if (tag === "input") {
      var textTypes = [
        "text",
        "search",
        "url",
        "tel",
        "email",
        "number",
        "password",
        "",
      ];
      if (textTypes.indexOf(el.type) === -1) return false;
      // Reject click-to-open picker inputs (Vinted uses cursor-pointer on these)
      var cls = el.className || "";
      if (
        cls.indexOf("cursor-pointer") !== -1 ||
        cls.indexOf("u-cursor-pointer") !== -1
      )
        return false;
      // Reject inputs that look like picker triggers (readonly behavior via cursor style)
      if (style.cursor === "pointer") return false;
    }
    return true;
  }

  /**
   * Handle Vinted's custom picker components (brand, condition, category, etc.)
   * These are not standard form elements — they use clickable containers that open
   * search dropdowns or radio-like option lists.
   */

  // Multi-language synonyms for common field names
  var FIELD_SYNONYMS = {
    brand: ["brand", "marca", "marque", "marke", "merk", "marka"],
    condition: [
      "condition",
      "estado",
      "état",
      "zustand",
      "stato",
      "conditie",
      "stan",
      "stav",
    ],
    size: ["size", "tamanho", "taille", "größe", "taglia", "maat", "rozmiar"],
    color: [
      "color",
      "colour",
      "cor",
      "couleur",
      "farbe",
      "colore",
      "kleur",
      "kolor",
    ],
    category: [
      "category",
      "categoria",
      "catégorie",
      "kategorie",
      "categorie",
      "kategoria",
    ],
    material: [
      "material",
      "matéria",
      "matière",
      "stoff",
      "materiale",
      "materiaal",
      "materiał",
    ],
  };

  function getFieldSynonyms(fieldName) {
    var norm = fieldName.toLowerCase().trim();
    // Check if this field name matches any synonym group
    for (var key in FIELD_SYNONYMS) {
      var synonyms = FIELD_SYNONYMS[key];
      for (var i = 0; i < synonyms.length; i++) {
        if (
          norm === synonyms[i] ||
          norm.indexOf(synonyms[i]) !== -1 ||
          synonyms[i].indexOf(norm) !== -1
        ) {
          return synonyms;
        }
      }
    }
    // Return just the original name
    return [norm];
  }

  function fillVintedPicker(fieldName, value, onDone) {
    var norm = fieldName.toLowerCase().trim();
    var valueNorm = value.toLowerCase().trim();
    var synonyms = getFieldSynonyms(norm);

    // Find the section containing this field — try all synonyms
    var section = null;
    for (var s = 0; s < synonyms.length; s++) {
      section = findSectionByLabel(synonyms[s]);
      if (section) {
        break;
      }
    }
    if (!section) {
      if (onDone) onDone();
      return;
    }

    // Strategy 1: Look for already-visible clickable options (condition-style inline radio/buttons)
    var allClickables = section.querySelectorAll("*");
    for (var i = 0; i < allClickables.length; i++) {
      var node = allClickables[i];
      // Skip containers — only look at leaf-ish elements
      if (node.children.length > 3) continue;
      var nodeText = (node.textContent || "").toLowerCase().trim();
      // Must be a reasonably short text to be a button/option label
      if (nodeText.length > 50) continue;
      if (nodeText === valueNorm || nodeText.indexOf(valueNorm) !== -1) {
        // Check if this element or a close ancestor looks clickable
        var clickableNode = null;
        var check = node;
        for (var up = 0; up < 4 && check && check !== section; up++) {
          var ctag = check.tagName.toLowerCase();
          var crole = check.getAttribute("role") || "";
          var hasClick =
            ctag === "button" ||
            ctag === "label" ||
            ctag === "a" ||
            crole === "radio" ||
            crole === "option" ||
            crole === "button" ||
            crole === "checkbox" ||
            check.style.cursor === "pointer" ||
            check.classList
              .toString()
              .match(
                /option|radio|chip|pill|btn|button|select|choice|clickable/i,
              );
          if (hasClick) {
            clickableNode = check;
            break;
          }
          check = check.parentElement;
        }
        if (clickableNode) {
          simulateClick(clickableNode);
          if (onDone) setTimeout(onDone, 300);
          return;
        }
      }
    }

    // Strategy 2: Click into the section to open a picker/dropdown/modal
    // Try to find the most interactive element
    var clickTarget =
      section.querySelector("input[readonly]") ||
      section.querySelector('input[class*="cursor-pointer"]') ||
      section.querySelector('[role="button"]') ||
      section.querySelector('[role="combobox"]') ||
      section.querySelector('button:not([class*="close"])') ||
      section.querySelector(
        '[class*="click"], [class*="select"], [class*="trigger"]',
      ) ||
      section.querySelector("input") ||
      section.querySelector("a") ||
      section;

    clickTarget.click();

    // Wait for a picker/dropdown/modal to appear
    waitForPicker(valueNorm, onDone, 0);
  }

  /**
   * After clicking to open a picker, wait for the UI to appear and select the value.
   * Retries a few times since Vinted's React rendering may be delayed.
   */
  function waitForPicker(valueNorm, onDone, attempt) {
    if (attempt > 5) {
      if (onDone) onDone();
      return;
    }

    setTimeout(function () {
      // Look for any search input that appeared anywhere on page (modals, overlays, etc.)
      var searchInput = findVisibleElement([
        'input[type="search"]',
        'input[type="text"][class*="search"]',
        'input[type="text"][placeholder*="search" i]',
        'input[type="text"][placeholder*="buscar" i]',
        'input[type="text"][placeholder*="pesquisar" i]',
        'input[type="text"][placeholder*="chercher" i]',
        'input[type="text"][placeholder*="suchen" i]',
        'input[type="text"][placeholder*="cerca" i]',
        '[role="combobox"]',
        '[role="searchbox"]',
      ]);

      if (searchInput) {
        setInputValue(searchInput, valueNorm);

        // Wait for results to load
        setTimeout(function () {
          selectFromVisibleList(valueNorm, onDone);
        }, 1200);
        return;
      }

      // No search input — look for a visible list of options
      var found = selectFromVisibleList(valueNorm, onDone);
      if (!found) {
        // Retry — the picker might not have rendered yet
        waitForPicker(valueNorm, onDone, attempt + 1);
      }
    }, 400);
  }

  /**
   * Look for a visible list of selectable options and click the matching one.
   * Searches broadly across the whole page for overlays, modals, dropdowns.
   */
  function selectFromVisibleList(valueNorm, onDone) {
    // Broad selectors for any kind of option list
    var containers = document.querySelectorAll(
      '[role="dialog"], [role="listbox"], [role="menu"], ' +
        '[class*="modal"], [class*="overlay"], [class*="dropdown"], ' +
        '[class*="popup"], [class*="popover"], [class*="drawer"], ' +
        '[class*="picker"], [class*="flyout"]',
    );

    // Also check the document body for absolutely positioned lists
    var allLists = [];
    containers.forEach(function (c) {
      if (isVisible(c)) allLists.push(c);
    });

    // If no explicit container found, search the whole body
    if (allLists.length === 0) {
      allLists.push(document.body);
    }

    for (var c = 0; c < allLists.length; c++) {
      var container = allLists[c];
      // Find all items that could be selectable options
      var items = container.querySelectorAll(
        '[role="option"], [role="menuitem"], [role="radio"], [role="button"], ' +
          'li, [class*="option"], [class*="item"], [class*="result"], ' +
          '[class*="suggestion"], [class*="entry"]',
      );

      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        if (!isVisible(item)) continue;
        var itemText = (item.textContent || "").toLowerCase().trim();

        // For items with long text (e.g. title + description), check child title elements
        if (itemText.length > 100) {
          var titleEl = item.querySelector(
            '[class*="title"], [class*="heading"], [class*="label"]',
          );
          if (titleEl) {
            var titleText = (titleEl.textContent || "").toLowerCase().trim();
            if (
              titleText.length <= 100 &&
              (titleText === valueNorm ||
                titleText.indexOf(valueNorm) !== -1 ||
                valueNorm.indexOf(titleText) !== -1)
            ) {
              // Click the most specific interactive element, not the outer container
              var bestTarget =
                item.querySelector('[role="button"], [role="option"]') || item;
              simulateClick(bestTarget);
              if (onDone) setTimeout(onDone, 500);
              return true;
            }
          }
          continue;
        }

        if (
          itemText === valueNorm ||
          itemText.indexOf(valueNorm) !== -1 ||
          valueNorm.indexOf(itemText) !== -1
        ) {
          // If item is a container (li, div), prefer clicking a [role="button"] child
          var bestTarget = item;
          if (
            item.tagName.toLowerCase() === "li" ||
            !item.getAttribute("role")
          ) {
            var btn = item.querySelector('[role="button"], [role="option"]');
            if (btn) bestTarget = btn;
          }
          simulateClick(bestTarget);
          if (onDone) setTimeout(onDone, 500);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Simulate a real click with mouse events so React picks it up.
   */
  function simulateClick(el) {
    el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  }

  function findVisibleElement(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        if (isVisible(els[j])) return els[j];
      }
    }
    return null;
  }

  /**
   * Find a form section/container by its label or heading text.
   * Vinted groups each field in a section with a label/heading.
   */
  function findSectionByLabel(labelNorm) {
    // Search ALL elements for matching text — Vinted uses many different elements for labels
    var allElements = document.querySelectorAll("*");
    var bestMatch = null;
    var bestScore = -1;

    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      // Skip script, style, svg, hidden elements
      var tag = el.tagName.toLowerCase();
      if (
        tag === "script" ||
        tag === "style" ||
        tag === "svg" ||
        tag === "path" ||
        tag === "noscript"
      )
        continue;
      if (!isVisible(el)) continue;

      // Check direct text content
      var directText = getDirectText(el).toLowerCase().trim();
      if (!directText) continue;
      if (directText.length > 60) continue;

      if (directText === labelNorm || directText.indexOf(labelNorm) !== -1) {
        // Walk up to find the tightest container that wraps this field
        var candidate = el.parentElement;
        for (var d = 0; d < 5 && candidate; d++) {
          var cTag = candidate.tagName.toLowerCase();
          var cCls = (candidate.className || "").toLowerCase();
          var score = 0;

          // Strong preference for <li> — Vinted wraps each form field in an <li>
          if (cTag === "li") score += 100;
          // Also good: fieldset, section-like containers
          if (cTag === "fieldset") score += 80;
          if (
            cCls.indexOf("field") !== -1 ||
            cCls.indexOf("form-item") !== -1 ||
            cCls.indexOf("form_item") !== -1
          )
            score += 70;
          // Must have at least 2 children (label + input area) and some height
          if (candidate.children.length >= 2 && candidate.offsetHeight > 30)
            score += 20;
          // Penalise containers that are too big (likely the whole form)
          if (candidate.children.length > 10) score -= 50;
          if (cTag === "ul" || cTag === "ol" || cTag === "form") score -= 30;

          if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
          }

          // If we found an <li>, stop — it's the best container
          if (cTag === "li") break;

          candidate = candidate.parentElement;
        }
      }
    }

    if (bestMatch) {
    }
    return bestMatch;
  }

  /**
   * Get direct text content of an element, excluding nested elements.
   */
  function getDirectText(el) {
    var text = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
        text += el.childNodes[i].textContent;
      }
    }
    return text || el.textContent || "";
  }

  /**
   * Find a form field by its label text. Searches for labels, placeholders,
   * and nearby text that matches the custom field name.
   */
  function findFormFieldByLabel(labelText) {
    var norm = labelText.toLowerCase().trim();

    // Strategy 1: <label> with matching text that has a 'for' attribute
    var labels = document.querySelectorAll("label");
    for (var i = 0; i < labels.length; i++) {
      var lbl = labels[i];
      var lblText = (lbl.textContent || "").toLowerCase().trim();
      if (lblText === norm || lblText.indexOf(norm) !== -1) {
        // Check 'for' attribute
        if (lbl.htmlFor) {
          var target = document.getElementById(lbl.htmlFor);
          if (target && isVisible(target)) return target;
        }
        // Check for input/select/textarea inside the label
        var inner = lbl.querySelector("input, select, textarea");
        if (inner && isVisible(inner)) return inner;
        // Check next sibling or parent's next input
        var container =
          lbl.closest("div, fieldset, section") || lbl.parentElement;
        if (container) {
          var inp = container.querySelector("input, select, textarea");
          if (inp && isVisible(inp)) return inp;
        }
      }
    }

    // Strategy 2: input/textarea with matching placeholder
    var inputs = document.querySelectorAll("input, textarea");
    for (var j = 0; j < inputs.length; j++) {
      var ph = (inputs[j].placeholder || "").toLowerCase();
      if (ph === norm || ph.indexOf(norm) !== -1) {
        if (isVisible(inputs[j])) return inputs[j];
      }
    }

    // Strategy 3: input/textarea/select with matching name or id attribute
    var nameSelectors = [
      'input[name*="' + CSS.escape(norm) + '" i]',
      'select[name*="' + CSS.escape(norm) + '" i]',
      'textarea[name*="' + CSS.escape(norm) + '" i]',
      'input[id*="' + CSS.escape(norm) + '" i]',
      'select[id*="' + CSS.escape(norm) + '" i]',
    ];
    for (var k = 0; k < nameSelectors.length; k++) {
      try {
        var el = document.querySelector(nameSelectors[k]);
        if (el && isVisible(el)) return el;
      } catch (_) {
        /* invalid selector */
      }
    }

    return null;
  }

  /**
   * Set a value on a <select> element by matching option text or value.
   */
  function setSelectValue(selectEl, value) {
    var norm = value.toLowerCase().trim();
    var options = selectEl.options;
    for (var i = 0; i < options.length; i++) {
      var optText = (options[i].text || "").toLowerCase().trim();
      var optVal = (options[i].value || "").toLowerCase().trim();
      if (
        optText === norm ||
        optVal === norm ||
        optText.indexOf(norm) !== -1 ||
        norm.indexOf(optText) !== -1
      ) {
        selectEl.value = options[i].value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
    }
    // Fallback: try setting value directly
    var nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    ).set;
    nativeSetter.call(selectEl, value);
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
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

    // Pick the best candidate: prefer document.title, then specific selectors, then h1
    // Skip very short values (likely brand names)
    for (var j = 0; j < candidates.length; j++) {
      var val = candidates[j].val;
      // Skip single-word values (likely brand), require at least 3 words or 15 chars
      var wordCount = val.split(/\s+/).length;
      if (wordCount >= 3 || val.length >= 15) {
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
        return;
      }
      if (schedules.length === 0) {
        return;
      }

      // Wait a bit for Vinted's SPA to render the page content
      setTimeout(function () {
        var pageMemberId = getPageSellerMemberId();

        if (!isMyItem(pageMemberId)) {
          removeListedPanel();
          return;
        }

        var pageTitle = getPageItemTitle();

        matchedSchedule = findMatchingSchedule(pageTitle);
        if (matchedSchedule) {
          renderListedPanel();
        } else {
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

    send({ type: "API_GET", path: "/api/schedules/today" })
      .then(function (res) {
        if (res && res.ok && res.data && Array.isArray(res.data.schedules)) {
          schedules = res.data.schedules;
        } else if (res && res.ok && Array.isArray(res.data)) {
          schedules = res.data;
        } else {
          schedules = [];
          console.warn("[VSH] Failed to load schedules:", res);
        }
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
