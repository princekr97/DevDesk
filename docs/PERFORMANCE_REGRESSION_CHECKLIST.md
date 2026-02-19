# DevDesk Performance Regression Checklist

Use this checklist before release and after major UI/data-flow changes.

## 1) JSON Viewer
- Load small JSON (`< 500KB`) and confirm parse under 1s on local machine.
- Load large JSON (`> 5MB`) and confirm:
  - UI stays interactive while parsing.
  - `Cancel` stops processing quickly.
  - No browser “Page Unresponsive” dialog.
- Run search rapidly (type/delete fast) and confirm:
  - No stale results flashing.
  - No freeze while worker search is debounced.
- Expand/collapse deep nodes and confirm smooth scrolling.

## 2) Diff Checker
- Compare medium text payloads (~3k lines) and confirm result under 2s.
- Compare JSON mode payloads with nested objects and confirm:
  - Pane scrolling remains responsive.
  - No lockups when toggling mode/options.
- Trigger cancel/reset during heavy compare and verify UI returns to idle.

## 3) Converters (JSON/CSV/Excel/Word-PDF)
- Import representative real files (small/medium/large).
- Confirm preview loads without blocking the main thread.
- Validate export/download completes and output opens correctly.
- Confirm cancel/reset works mid-processing.
- Measure converter preview and export latency:
  - First preview chunk should appear quickly (`< 500ms` small files, `< 1.5s` medium files).
  - No single long task in preview path should exceed ~100ms on reference machine.
  - Export path should emit start/end perf marks and remain cancelable.
- Validate chunked preview behavior:
  - First chunk ~100 rows, then additional chunks ~200 rows.
  - Preview render is capped at 1,000 rows while total row count remains accurate.

## 4) Stability and Logging
- Confirm no runtime console errors in production build flow.
- Confirm all processing tasks update status correctly (`running`, `done`, `cancelled`, `error`).
- Confirm no memory leak symptoms after repeated parse/convert/reset cycles (10+ cycles).

## 5) Quick Technical Gate
- `npm run build` passes.
- Run core paths manually:
  - `/app/json-viewer`
  - `/app/diff-checker`
  - `/app/json-excel`
  - `/app/json-csv`
- Validate layout responsiveness at mobile and desktop breakpoints.
