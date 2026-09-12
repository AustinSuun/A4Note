# Agent Board

`apps/agent-board` is a standalone task-board console for the T3 environment connector described by `TASK-BOARD-2`.

## Run

```powershell
cd D:\WorkSpace\Aster\apps\agent-board
npm test
npm start
```

Open `http://127.0.0.1:4174`. The app does not persist endpoint credentials, does not call `thread.turn.start`, and does not inspect the T3 desktop process or local database.

The server binds to loopback by default. Its pairing proxy accepts `http://127.0.0.1:3773`, `http://localhost:3773`, and the known LAN address `http://192.168.56.1:3773`; set `AGENT_BOARD_T3_ENDPOINT` before startup only when an explicitly authorized T3 environment uses a different origin.

For a browser-only smoke test, start the static server with the redacted fixture route enabled:

```powershell
$env:AGENT_BOARD_MOCK = '1'
npm start
```

That opt-in route serves only `GET /api/orchestration/snapshot` with synthetic IDs and statuses; it is disabled by default.

For a T3 pairing link, choose `T3 配对链接` and paste the complete `/pair#token=...` URL (a copied `/pair#token=...` path is also accepted when the endpoint is filled). The console also accepts the raw code shown by T3's “Show code” dialog. It parses the fragment locally and uses the local Agent Board proxy for `/oauth/token` and snapshot requests, avoiding browser CORS failures between ports. The browser receives only a short-lived connection handle; the access token remains in the Agent Board process memory. The pairing token is cleared after a successful exchange and is never logged, persisted, put in a URL, or shown in status output. Without an endpoint, the fallback creates a copyable task package for user-confirmed paste into the target T3 conversation.
