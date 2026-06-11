/* AZ-01 dashboard — Updates panel enhancement
 *
 * Runs after the React app mounts. Merges CONFLICTS + UPDATES + NEWS into a
 * single prioritized review queue in the existing right-rail Updates panel.
 *
 * Strategy:
 *  - Find the panel via [data-testid="panel-updates"]
 *  - Decorate the real <Update> cards already in the DOM (type pill + stripe + reason)
 *  - Inject lightweight cards for CONFLICTS and NEWS, in priority order
 *  - Update the "N active · M dismissed" count
 *
 * Idempotent: safe to run multiple times (re-render-safe via MutationObserver).
 * Pure DOM — does not touch React state, so dismiss buttons on real Update
 * cards keep working.
 */
(function () {
  "use strict";

  // ---------- 1. Load the snapshot to know what conflicts/news to inject ----------
  function loadSnapshot() {
    return fetch("./snapshot.json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.data || {}; })
      .catch(function () { return {}; });
  }

  // ---------- 2. Helpers ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function typePill(type) {
    var label = { conflict: "Conflict", update: "Update", news: "News" }[type];
    return el("span", { class: "nrx-type-pill nrx-" + type }, [label]);
  }
  function reasonLine(text) {
    if (!text) return null;
    return el("div", { class: "nrx-reason" }, [text]);
  }
  function relTime(iso) {
    if (!iso) return "";
    var t = Date.parse(iso); if (!t) return "";
    var days = Math.round((Date.now() - t) / 86400000);
    if (days < 1) return "today";
    if (days === 1) return "1d ago";
    return days + "d ago";
  }
  function sevRank(s) {
    return { critical: 0, high: 1, medium: 2, low: 3 }[(s || "").toLowerCase()] ?? 4;
  }

  // ---------- 3. Decorate existing Update cards ----------
  function decorateRealUpdates(panel, updatesById) {
    var cards = panel.querySelectorAll('[data-testid^="update-card-"]');
    cards.forEach(function (card) {
      if (card.dataset.nrxDecorated === "1") return;
      var id = card.getAttribute("data-testid").replace("update-card-", "");
      var data = updatesById[id];
      card.dataset.nrxType = "update";
      card.dataset.nrxDecorated = "1";
      // Insert type pill at the start of the badge row
      var title = card.querySelector("h3");
      if (title && title.parentElement) {
        title.parentElement.insertBefore(typePill("update"), title);
      }
      // Reason line — use fieldChanged or first sentence of newValue
      var reason = data && (data.fieldChanged
        ? "Field changed: " + data.fieldChanged
        : "");
      if (reason) {
        // Place reason after the diff line (the existing mt-1.5 .text-xs block)
        var diff = card.querySelector(".text-xs.text-muted-foreground");
        var rl = reasonLine(reason);
        if (diff && diff.parentElement) {
          diff.parentElement.insertBefore(rl, diff);
        } else if (title) {
          title.parentElement.appendChild(rl);
        }
      }
    });
  }

  // ---------- 4. Inject Conflict + News cards ----------
  // Build a dismiss × button. Hides the card locally (panel only) and
  // refreshes the counts. Stores dismissed ids in sessionStorage so the
  // hide survives React re-renders within the same session.
  function dismissBtn(itemId, label) {
    var btn = el("button", {
      type: "button",
      class: "nrx-dismiss",
      "aria-label": "Dismiss: " + label,
      "data-testid": "button-dismiss-nrx-" + itemId,
      title: "Dismiss"
    }, ["×"]);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var card = btn.closest("[data-nrx-type]");
      if (!card) return;
      card.dataset.nrxDismissed = "1";
      card.style.display = "none";
      try {
        var key = "nrx_dismissed_v1";
        var arr = JSON.parse(sessionStorage.getItem(key) || "[]");
        if (arr.indexOf(itemId) < 0) arr.push(itemId);
        sessionStorage.setItem(key, JSON.stringify(arr));
      } catch (err) {}
      var panel = card.closest('[data-testid="panel-updates"]');
      if (panel) updateCount(panel);
    });
    return btn;
  }

  function buildConflictCard(c, sources) {
    var srcName = function (id) { return (sources && sources[id] && sources[id].name) || id; };
    var title = c.factInQuestion || "Source conflict";
    return el("div", {
      class: "nrx-injected",
      "data-nrx-type": "conflict",
      "data-testid": "nrx-card-" + c.id
    }, [
      el("div", { class: "nrx-row" }, [
        el("div", { class: "nrx-main" }, [
          el("div", { class: "nrx-badges" }, [
            typePill("conflict"),
            el("h3", null, [title]),
          ]),
          reasonLine(c.whyItMatters || c.suggestedReviewAction || ""),
          el("div", { class: "nrx-meta" }, [
            "Sources: " + srcName(c.sourceAId) + " vs. " + srcName(c.sourceBId),
            c.status ? " · status: " + c.status : "",
            c.severity ? " · " + c.severity : "",
          ]),
        ]),
        dismissBtn(c.id, title),
      ]),
    ]);
  }
  function buildNewsCard(n) {
    var title = n.headline || "News item";
    return el("div", {
      class: "nrx-injected",
      "data-nrx-type": "news",
      "data-testid": "nrx-card-" + n.id
    }, [
      el("div", { class: "nrx-row" }, [
        el("div", { class: "nrx-main" }, [
          el("div", { class: "nrx-badges" }, [
            typePill("news"),
            el("h3", null, [title]),
          ]),
          reasonLine(n.relevanceSummary || ""),
          el("div", { class: "nrx-meta" }, [
            (n.sourceName || "") + (n.publishedAt ? " · " + n.publishedAt : "")
              + (n.tag ? " · " + n.tag : ""),
          ]),
        ]),
        dismissBtn(n.id, title),
      ]),
    ]);
  }

  // ---------- 5. Reorder children by type priority ----------
  function reorderPanelBody(body) {
    var rank = { conflict: 0, update: 1, news: 2 };
    var children = Array.from(body.children).filter(function (n) {
      return n.dataset && n.dataset.nrxType;
    });
    children.sort(function (a, b) {
      var ra = rank[a.dataset.nrxType] ?? 9;
      var rb = rank[b.dataset.nrxType] ?? 9;
      return ra - rb;
    });
    children.forEach(function (n) { body.appendChild(n); });
  }

  // ---------- 6. Update the count: 'N updates · N conflicts · N news' ----------
  function updateCount(panel) {
    var el = panel.querySelector('[data-testid="text-updates-count"]');
    if (!el) return;
    var counts = { update: 0, conflict: 0, news: 0 };
    panel.querySelectorAll('[data-nrx-type]').forEach(function (c) {
      if (c.dataset.nrxDismissed === '1') return; // skip locally-dismissed
      counts[c.dataset.nrxType] = (counts[c.dataset.nrxType] || 0) + 1;
    });
    el.textContent =
      counts.update + ' update' + (counts.update === 1 ? '' : 's') +
      ' · ' + counts.conflict + ' conflict' + (counts.conflict === 1 ? '' : 's') +
      ' · ' + counts.news + ' news';
  }

  // ---------- 7. Main patch entrypoint ----------
  function applyPatch(data) {
    var panel = document.querySelector('[data-testid="panel-updates"]');
    if (!panel) return false;
    // The list container is the panel's last <div> with multiple card children
    var body = panel.querySelector(":scope > div:last-child");
    if (!body) return false;

    var updatesById = {};
    (data.UPDATES || []).forEach(function (u) { updatesById[u.id] = u; });

    // Decorate real Update cards already rendered by React
    decorateRealUpdates(panel, updatesById);

    // Read locally-dismissed ids (sessionStorage)
    var dismissed = {};
    try {
      JSON.parse(sessionStorage.getItem("nrx_dismissed_v1") || "[]")
        .forEach(function (id) { dismissed[id] = true; });
    } catch (e) {}

    // Inject Conflicts (prioritized by severity, unresolved first)
    var conflicts = (data.CONFLICTS || []).slice().sort(function (a, b) {
      var ao = a.status === "open" ? 0 : 1;
      var bo = b.status === "open" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return sevRank(a.severity) - sevRank(b.severity);
    });
    conflicts.forEach(function (c) {
      if (dismissed[c.id]) return;
      if (panel.querySelector('[data-testid="nrx-card-' + c.id + '"]')) return;
      body.appendChild(buildConflictCard(c, data.SOURCES));
    });

    // Inject News (newest first, only items with reviewState "new")
    var news = (data.NEWS || []).slice()
      .filter(function (n) { return n.reviewState !== "dismissed"; })
      .sort(function (a, b) { return (b.publishedAt || "").localeCompare(a.publishedAt || ""); });
    news.forEach(function (n) {
      if (dismissed[n.id]) return;
      if (panel.querySelector('[data-testid="nrx-card-' + n.id + '"]')) return;
      body.appendChild(buildNewsCard(n));
    });

    // Make sure real Update cards have a type marker for reordering
    panel.querySelectorAll('[data-testid^="update-card-"]').forEach(function (c) {
      c.dataset.nrxType = "update";
    });

    reorderPanelBody(body);
    updateCount(panel);
    return true;
  }

  // ---------- 8. Wait for panel + re-apply on React re-renders ----------
  function start(data) {
    var tries = 0;
    var iv = setInterval(function () {
      if (applyPatch(data) || ++tries > 40) clearInterval(iv);
    }, 250);

    // Re-apply when React re-renders the panel body
    var root = document.getElementById("root") || document.body;
    var observer = new MutationObserver(function () {
      var panel = document.querySelector('[data-testid="panel-updates"]');
      if (!panel) return;
      // If real Update cards lost their decoration after a re-render, re-apply
      var anyUndecorated = panel.querySelector('[data-testid^="update-card-"]:not([data-nrx-decorated="1"])');
      var anyMissingInjected = (data.CONFLICTS || []).some(function (c) {
        return !panel.querySelector('[data-testid="nrx-card-' + c.id + '"]');
      });
      if (anyUndecorated || anyMissingInjected) applyPatch(data);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { loadSnapshot().then(start); });
  } else {
    loadSnapshot().then(start);
  }
})();
