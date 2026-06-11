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

  // Count the cards the bundle is actually rendering, so the counters
  // always match what the user sees — independent of whether the data
  // came from the JS bundle or the snapshot.
  function countRenderedCards() {
    function visible(el) {
      if (!el) return false;
      if (el.dataset && el.dataset.patchHidden === "1") return false;
      var s = el.getAttribute("style") || "";
      if (/display\s*:\s*none/i.test(s)) return false;
      return true;
    }
    var u = Array.from(document.querySelectorAll('[data-testid^="update-card"], [data-testid^="nrx-card-update"]')).filter(visible).length;
    var c = Array.from(document.querySelectorAll('[data-testid^="conflict-card"], [data-testid^="nrx-card-conflict"]')).filter(visible).length;
    var n = Array.from(document.querySelectorAll('[data-testid^="news-card"], [data-testid^="nrx-card-news"]')).filter(visible).length;
    return { updates: u, conflicts: c, news: n };
  }

  // Update the four counters in the small status strip.
  // The bundle renders them as: <icon> <label> <number>. We locate by
  // searching for the exact label text, then walk to the adjacent number node.
  function refreshStripCounters(snap) {
    var data = (snap && snap.data) || {};
    var counts = countRenderedCards();
    // Derive counts from snapshot if present, otherwise leave alone.
    var sourcesChecked = data.LAST_REFRESH && typeof data.LAST_REFRESH.sourcesChecked === "number"
      ? data.LAST_REFRESH.sourcesChecked : null;
    // Always use rendered card counts so the strip matches the Updates panel.
    var updatesPending = counts.updates;
    var conflictsOpen  = counts.conflicts;
    var humanReviewNeeded = counts.updates + counts.conflicts + counts.news;

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

  // Prefix the H1 (and document title) with the district code, e.g.
  // "Voting Procedures Dashboard" -> "PA-07 Voting Procedures Dashboard".
  // Idempotent: skips if the code is already present.
  function refreshDistrictTitle(snap) {
    var data = (snap && snap.data) || {};
    var code = snap.districtCode || data.districtNumber;
    if (!code) return;
    var h1 = document.querySelector('[data-testid="text-dashboard-title"]') || document.querySelector("h1");
    if (h1) {
      var t = (h1.textContent || "").trim();
      if (t.indexOf(code) === -1) {
        // strip any other AZ/PA/IA-NN prefix before adding ours
        t = t.replace(/^(AZ|PA|IA)-\d{2}\s+/, "");
        h1.textContent = code + " " + t;
      }
    }
    if (document.title && document.title.indexOf(code) === -1) {
      document.title = code + " " + document.title.replace(/^(AZ|PA|IA)-\d{2}\s+/, "");
    }
  }

  // Refresh the Review Queue tile (upper-left) so its three counters
  // match what's actually rendered in the Updates panel:
  //   - count-updates    -> # of update-card-* in DOM
  //   - count-conflicts  -> # of conflict-card-* in DOM
  //   - count-news       -> # of news-card-* in DOM
  function refreshReviewQueueTile() {
    var counts = countRenderedCards();
    function setVal(testid, value) {
      var el = document.querySelector('[data-testid="' + testid + '"]');
      if (el && el.textContent.trim() !== String(value)) {
        el.textContent = String(value);
      }
    }
    setVal("count-updates", counts.updates);
    setVal("count-conflicts", counts.conflicts);
    setVal("count-news", counts.news);
    // Also keep the "Needs review" badge in sync if present.
    var badge = document.querySelector('[data-testid="stat-needs-review"]');
    if (badge) {
      var total = counts.updates + counts.conflicts + counts.news;
      // Only rewrite if it looks like a plain number
      var txt = (badge.textContent || "").trim();
      if (/^\d+$/.test(txt) && txt !== String(total)) {
        badge.textContent = String(total);
      }
    }
  }

  function apply(snap) {
    if (!snap) return;
    var newDate = snap.dataAsOf;
    refreshDataAsOfText(newDate);
    refreshDistrictTitle(snap);
    // Counters must run AFTER patch-updates-panel.js has injected news cards,
    // so we re-apply via interval + MutationObserver in start().
    refreshReviewQueueTile();
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
