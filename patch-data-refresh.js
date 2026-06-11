/* AZ-01-family dashboards — data refresh layer.
 *
 * The six "Pages" district builds (AZ-06, IA-01, IA-03, PA-07, PA-08, PA-10)
 * have their data compiled into the JS bundle, so they cannot be refreshed
 * by editing data alone. This patch makes them read an external snapshot.json
 * (same schema as AZ-01) and re-render the lightweight bits a publisher
 * typically wants to refresh weekly:
 *
 *   - "Data as of YYYY-MM-DD" stamps (top-left subheader + the
 *     "Static snapshot · data as of …" strip)
 *   - The four status-strip counters (sources checked, updates pending,
 *     conflicts open, human review needed)
 *
 * It does NOT touch the React-rendered Update cards (those stay as they
 * are in the bundle). It does NOT touch the Updates panel header count
 * "N active · M dismissed" — that is owned by patch-updates-panel.js,
 * which already reads snapshot.json and merges in Conflicts and News.
 *
 * Together with patch-updates-panel.js, a publisher's weekly refresh
 * becomes: edit snapshot.json, commit, push.
 *
 * If snapshot.json is missing or doesn't parse, this script silently
 * does nothing — the dashboard renders exactly as before.
 */
(function () {
  "use strict";

  function loadSnapshot() {
    return fetch("./snapshot.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  // Replace the "Data as of YYYY-MM-DD" text wherever it appears.
  // We do this with a TreeWalker so we only touch text nodes — never DOM
  // structure — and we run it after each React re-render via observer.
  function refreshDataAsOfText(newDate) {
    if (!newDate) return;
    var rx = /Data as of\s*\d{4}-\d{2}-\d{2}/g;
    var rx2 = /data as of\s*\d{4}-\d{2}-\d{2}/g;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (rx.test(n.nodeValue) || rx2.test(n.nodeValue)) {
        rx.lastIndex = 0; rx2.lastIndex = 0;
        n.nodeValue = n.nodeValue
          .replace(rx,  "Data as of " + newDate)
          .replace(rx2, "data as of " + newDate);
      }
    }
  }

  // Update the four counters in the small status strip.
  // The bundle renders them as: <icon> <label> <number>. We locate by
  // searching for the exact label text, then walk to the adjacent number node.
  function refreshStripCounters(snap) {
    var data = (snap && snap.data) || {};
    // Derive counts from snapshot if present, otherwise leave alone.
    var sourcesChecked = data.LAST_REFRESH && typeof data.LAST_REFRESH.sourcesChecked === "number"
      ? data.LAST_REFRESH.sourcesChecked : null;
    var updatesPending = Array.isArray(data.UPDATES)
      ? data.UPDATES.filter(function (u) { return u.reviewState !== "dismissed" && u.reviewState !== "resolved"; }).length
      : null;
    var conflictsOpen = Array.isArray(data.CONFLICTS)
      ? data.CONFLICTS.filter(function (c) { return c.status === "open" || c.status === "unresolved"; }).length
      : null;
    var humanReviewNeeded =
      (Array.isArray(data.UPDATES) ? data.UPDATES.filter(function (u) { return u.reviewState === "new"; }).length : 0) +
      (Array.isArray(data.CONFLICTS) ? data.CONFLICTS.filter(function (c) { return c.status !== "resolved"; }).length : 0) +
      (Array.isArray(data.NEWS) ? data.NEWS.filter(function (n) { return n.reviewState === "new"; }).length : 0);

    var targets = {
      "Official sources checked": sourcesChecked,
      "Updates pending":           updatesPending,
      "Conflicts open":            conflictsOpen,
      "Human review needed":       humanReviewNeeded
    };

    Object.keys(targets).forEach(function (label) {
      var value = targets[label];
      if (value == null) return;
      // Find a label-bearing element near a number element
      var labelNodes = Array.from(document.querySelectorAll("*")).filter(function (n) {
        return n.children.length === 0 && (n.textContent || "").trim() === label;
      });
      labelNodes.forEach(function (labelEl) {
        // The number is typically the next sibling (or parent's last child)
        var p = labelEl.parentElement;
        if (!p) return;
        var candidates = Array.from(p.children);
        // Find a numeric text node sibling
        candidates.forEach(function (c) {
          var t = (c.textContent || "").trim();
          if (c !== labelEl && /^\d{1,4}$/.test(t)) {
            if (t !== String(value)) c.textContent = String(value);
          }
        });
      });
    });
  }

  function apply(snap) {
    if (!snap) return;
    var newDate = snap.dataAsOf;
    refreshDataAsOfText(newDate);
    refreshStripCounters(snap);
  }

  function start() {
    loadSnapshot().then(function (snap) {
      if (!snap) return;
      // Initial apply + re-apply on React re-renders
      var tries = 0;
      var iv = setInterval(function () {
        apply(snap);
        if (++tries > 20) clearInterval(iv);
      }, 300);

      var root = document.getElementById("root") || document.body;
      var pending = false;
      var observer = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; apply(snap); });
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
