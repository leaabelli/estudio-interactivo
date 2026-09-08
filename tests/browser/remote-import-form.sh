#!/usr/bin/env bash
# Run on an isolated QA tab at the entry or Module screen. No module is loaded
# or replaced: submit is observed and prevented before any network request.
set -euo pipefail
: "${BROWSE_BIN:?Set BROWSE_BIN to the gstack browse executable}"
: "${BROWSE_TAB:?Set BROWSE_TAB to an isolated study-app QA tab}"
export BROWSE_TAB

"$BROWSE_BIN" click '[data-action="import-url"]'
"$BROWSE_BIN" fill 'dialog input' 'https://example.com/questions.study.json'
"$BROWSE_BIN" js 'window.qaRemoteSubmitter = null; document.querySelector("dialog form").addEventListener("submit", e => { e.preventDefault(); window.qaRemoteSubmitter = e.submitter?.value; }); "Watching native form submission"'
"$BROWSE_BIN" press Enter
"$BROWSE_BIN" js 'if (window.qaRemoteSubmitter !== "load") throw new Error("Enter must submit the load action, not cancel"); "PASS: Enter selects load"'

"$BROWSE_BIN" js 'document.querySelector("dialog input").value = ""; document.querySelector("dialog input").focus(); "Cleared input"'
"$BROWSE_BIN" js 'window.qaRemoteSubmitter = null'
"$BROWSE_BIN" press Enter
"$BROWSE_BIN" js 'if (window.qaRemoteSubmitter !== null || !document.querySelector("dialog[open]")) throw new Error("Empty input must keep the form open without submitting"); "PASS: required input validation"'
"$BROWSE_BIN" fill 'dialog input' 'not a URL'
"$BROWSE_BIN" press Enter
"$BROWSE_BIN" js 'if (window.qaRemoteSubmitter !== null || !document.querySelector("dialog[open]")) throw new Error("Invalid URL must keep the form open without submitting"); "PASS: URL validation"'

"$BROWSE_BIN" click 'dialog button[value="cancel"]'
"$BROWSE_BIN" js 'if (document.querySelector("dialog[open]")) throw new Error("Cancel must dismiss even with invalid input"); "PASS: Cancel dismisses"'
"$BROWSE_BIN" click '[data-action="import-url"]'
"$BROWSE_BIN" press Escape
"$BROWSE_BIN" js 'if (document.querySelector("dialog[open]")) throw new Error("Escape must dismiss"); delete window.qaRemoteSubmitter; "PASS: Escape dismisses"'
