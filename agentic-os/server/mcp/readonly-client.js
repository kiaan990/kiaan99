// OPTIONAL, OFF BY DEFAULT: read-only connector to your personal server's MCP endpoint.
// Enabled only when MCP_SERVER_URL is set in .env. If unset or unreachable, everything else works
// and the dashboard shows "not connected".
//
// Read-only is enforced here: only tools on the read allowlist can be called, and any tool whose
// name looks like a write (add/create/delete/update/...) is refused even if listed.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_READ_TOOLS = ['calendar_events', 'calendar_list_calendars', 'tasks_list', 'brief_list', 'brief_get', 'server_status'];
const WRITE_WORDS = /(^|[_\-.])(add|create|delete|remove|update|complete|save|set|write|send|post|put|patch|edit|move|rename|upload|cancel|clear|reset|log|note)($|[_\-.])/i;

export function isReadOnlyToolName(name) {
  return typeof name === 'string' && !WRITE_WORDS.test(name);
}

export function createMcpReader({ config, log }) {
  const allow = new Set((config.mcp.readTools.length ? config.mcp.readTools : DEFAULT_READ_TOOLS).filter(isReadOnlyToolName));
  let client = null;
  let connecting = null;
  let state = { configured: !!config.mcp.url, connected: false, error: null, tools: [], checkedAt: null };

  async function connect() {
    if (!config.mcp.url) return null;
    if (client) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        const headers = config.mcp.authToken ? { Authorization: `Bearer ${config.mcp.authToken}` } : {};
        const transport = new StreamableHTTPClientTransport(new URL(config.mcp.url), { requestInit: { headers } });
        const c = new Client({ name: 'agentic-os', version: '1.0.0' });
        await withTimeout(c.connect(transport), 8000);
        const { tools } = await withTimeout(c.listTools(), 8000);
        state = { ...state, connected: true, error: null, tools: tools.map((t) => t.name).filter((n) => allow.has(n)), checkedAt: new Date().toISOString() };
        client = c;
        return c;
      } catch (err) {
        state = { ...state, connected: false, error: log.redact(String(err.message || err)).slice(0, 200), tools: [], checkedAt: new Date().toISOString() };
        return null;
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  }

  async function callRead(name, args = {}) {
    if (!allow.has(name) || !isReadOnlyToolName(name)) throw Object.assign(new Error(`Tool "${name}" is not on the read-only allowlist`), { status: 403 });
    const c = await connect();
    if (!c) return null;
    if (!state.tools.includes(name)) return null;
    try {
      const res = await withTimeout(c.callTool({ name, arguments: args }), 10000);
      return (res.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('\n').slice(0, 8000);
    } catch (err) {
      // Drop the connection so the next call reconnects.
      client = null;
      state = { ...state, connected: false, error: log.redact(String(err.message || err)).slice(0, 200) };
      return null;
    }
  }

  async function today() {
    if (!config.mcp.url) return { configured: false, connected: false };
    const read = (name) => (allow.has(name) ? callRead(name).catch(() => null) : Promise.resolve(null));
    const [calendar, tasks] = await Promise.all([read('calendar_events'), read('tasks_list')]);
    return { configured: true, connected: state.connected, calendar, tasks, error: state.error };
  }

  async function status() {
    if (config.mcp.url && !client) await connect();
    return { ...state, allowlist: [...allow] };
  }

  async function close() {
    try { await client?.close(); } catch { /* ignore */ }
    client = null;
  }

  return { status, today, callRead, close };
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(t));
}
