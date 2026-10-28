// @bun
// src/tui.tsx
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { jsxDEV } from "@opentui/solid/jsx-dev-runtime";
var MAX_FILES = 8;
var HISTORY_PER_FILE = 5;
var SYNC_DEBOUNCE_MS = 250;
var MAX_LINE_WIDTH = 24;
var MAX_TOOL_WIDTH = 12;
var MAX_PATH_WIDTH = 80;
var SETTINGS_KEY = "graph-live.settings";
var CLOCK_MS = 20000;
var MAX_NOTIFIED_PER_SESSION = 200;
var STATUS_RANK = { running: 0, error: 1, pending: 2, done: 3 };
var READ_TOKENS = new Set(["read", "reads", "reader", "reading"]);
var WRITE_TOKENS = new Set(["edit", "edits", "edited", "editing", "write", "writes", "writing", "written", "patch", "patches", "patched", "patching"]);
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function thenBump(result, bump, alive) {
  if (!result) {
    return;
  }
  result.then(() => {
    if (alive()) {
      bump();
    }
  }, () => {});
}
function toolNameOf(part) {
  const alt = part.tool;
  if (typeof alt === "string" && alt.trim()) {
    return alt;
  }
  return part.name;
}
function toolStatusOf(status) {
  if (status === "pending" || status === "running" || status === "completed" || status === "error" || status === "streaming") {
    return status;
  }
  return;
}
function partActivityTime(part) {
  const st = isRecord(part.state) ? part.state.time : undefined;
  if (isRecord(st)) {
    if (typeof st.end === "number" && st.end > 0) {
      return st.end;
    }
    if (typeof st.start === "number" && st.start > 0) {
      return st.start;
    }
  }
  return part.time.completed ?? part.time.ran ?? part.time.created ?? 0;
}
function tokenizeToolName(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}
function classifyTool(name) {
  const tokens = new Set(tokenizeToolName(name));
  for (const t of WRITE_TOKENS) {
    if (tokens.has(t)) {
      return "modified";
    }
  }
  for (const t of READ_TOKENS) {
    if (tokens.has(t)) {
      return "reading";
    }
  }
  return;
}
function pushPath(out, value) {
  if (typeof value === "string" && value.trim()) {
    out.push(value.trim());
  }
}
function pathsOf(input) {
  if (typeof input === "string") {
    const s = input.trim();
    return s && !s.includes(`
`) ? [s] : [];
  }
  if (!isRecord(input)) {
    return [];
  }
  const out = [];
  for (const key of ["filePath", "path", "file", "filename", "absolutePath"]) {
    pushPath(out, input[key]);
  }
  for (const key of ["files", "paths"]) {
    const v = input[key];
    if (!Array.isArray(v)) {
      continue;
    }
    for (const item of v) {
      if (typeof item === "string") {
        pushPath(out, item);
      } else if (isRecord(item)) {
        pushPath(out, item.path);
      }
    }
  }
  return out;
}
function truncateMiddle(s, n) {
  if (s.length <= n) {
    return s;
  }
  if (n <= 2) {
    return s.slice(0, n);
  }
  const head = Math.ceil((n - 1) / 2);
  const tail = Math.floor((n - 1) / 2);
  return `${s.slice(0, head)}\u2026${s.slice(s.length - tail)}`;
}
function timeAgo(at, now) {
  if (!at) {
    return "";
  }
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) {
    return "now";
  }
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  return `${Math.floor(m / 60)}h`;
}
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
function themeColor(ctx, path, fallback) {
  let cur = ctx.theme;
  for (const p of path) {
    if (!isRecord(cur)) {
      return fallback;
    }
    cur = cur[p];
  }
  if (typeof cur === "string" && cur) {
    return cur;
  }
  return fallback;
}
function resolvePalette(ctx) {
  return {
    run: themeColor(ctx, ["warning", "base"], "yellow"),
    err: themeColor(ctx, ["error", "base"], "red"),
    mod: themeColor(ctx, ["success", "base"], "green"),
    dim: themeColor(ctx, ["text", "muted"], "gray"),
    head: themeColor(ctx, ["text", "accent"], "cyan"),
    body: themeColor(ctx, ["text", "base"], "white")
  };
}
function isBusyStatus(status) {
  if (typeof status === "string") {
    return status === "running";
  }
  if (isRecord(status)) {
    return status.type === "busy" || status.type === "retry";
  }
  return false;
}
function statusMark(e) {
  if (e.status === "running") {
    return "\u25B8";
  }
  if (e.status === "error") {
    return "!";
  }
  if (e.status === "pending") {
    return "?";
  }
  return e.state === "modified" ? "\u25CF" : "\u25CB";
}
function statusColor(e, p) {
  if (e.status === "running" || e.status === "pending") {
    return p.run;
  }
  if (e.status === "error") {
    return p.err;
  }
  return e.state === "modified" ? p.mod : p.dim;
}
function toLine(e, p, now) {
  const touches = e.reads + e.writes;
  const count = touches > 1 ? ` \xD7${touches}` : "";
  const extra = e.status === "running" ? ` \xB7 ${truncateMiddle(e.tool, MAX_TOOL_WIDTH)}` : e.updatedAt ? ` \xB7 ${timeAgo(e.updatedAt, now)}` : "";
  return { text: `${statusMark(e)} ${truncateMiddle(e.rel, MAX_LINE_WIDTH)}${count}${extra}`, color: statusColor(e, p) };
}
function toSummary(list, filter) {
  if (list.length === 0) {
    return "";
  }
  const mod = list.filter((e) => e.state === "modified").length;
  const run = list.filter((e) => e.status === "running").length;
  const err = list.filter((e) => e.status === "error").length;
  const bits = [plural(list.length, "file", "files")];
  if (mod) {
    bits.push(plural(mod, "edit", "edits"));
  }
  if (run) {
    bits.push(plural(run, "running", "running"));
  }
  if (err) {
    bits.push(plural(err, "failed", "failed"));
  }
  if (filter !== "all") {
    bits.push(filter);
  }
  return bits.join(" \xB7 ");
}
function isRealPath(p) {
  return !p.includes("*") && !p.includes("?") && !/^[a-z]+:\/\//i.test(p) && !p.includes(`
`) && p.trim() !== "";
}
function splitDrive(path) {
  const m = /^([a-zA-Z]:)(\/|$)/.exec(path);
  if (m) {
    return { prefix: m[1], rest: path.slice(m[1].length) };
  }
  return { prefix: "", rest: path };
}
function normalizeKey(value) {
  let p = value.replace(/\\/g, "/").trim();
  const { prefix, rest } = splitDrive(p);
  const absolute = rest.startsWith("/");
  const parts = rest.split("/");
  const stack = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") {
      continue;
    }
    if (seg === "..") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(seg);
  }
  const joined = stack.join("/");
  if (prefix) {
    return `${prefix.toUpperCase()}/${joined}`;
  }
  return absolute ? `/${joined}` : joined;
}
function normalizeRoot(root) {
  if (!root) {
    return "";
  }
  const key = normalizeKey(root);
  return key.endsWith("/") && key.length > 1 ? key.slice(0, -1) : key;
}
function toKeyAndDisplay(raw, rootNorm) {
  const trimmed = raw.trim();
  if (!isRealPath(trimmed)) {
    return;
  }
  const withSlashes = trimmed.replace(/\\/g, "/");
  const hasDrive = /^[a-zA-Z]:(\/|$)/.test(withSlashes);
  const isAbs = withSlashes.startsWith("/") || hasDrive;
  const absLike = isAbs ? normalizeKey(withSlashes) : rootNorm ? normalizeKey(`${rootNorm}/${withSlashes.replace(/^\.\//, "")}`) : normalizeKey(withSlashes);
  if (!absLike || absLike === rootNorm) {
    return;
  }
  let rel = absLike;
  if (rootNorm && (absLike === rootNorm || absLike.startsWith(`${rootNorm}/`))) {
    rel = absLike.slice(rootNorm.length + 1).replace(/^\.\//, "");
  }
  if (!rel) {
    return;
  }
  return { key: absLike, rel, abs: absLike };
}
function resolveRoot(ctx, sessionID) {
  const session = ctx.data.session.get(sessionID);
  if (session?.location?.directory) {
    return normalizeRoot(session.location.directory);
  }
  return normalizeRoot(ctx.location?.directory ?? "");
}
function pendingKeys(ctx, sessionID, rootNorm) {
  const out = new Set;
  const reqs = ctx.data.session.permission.list(sessionID);
  if (!reqs) {
    return out;
  }
  for (const r of reqs) {
    for (const res of r.resources) {
      const trimmed = res.trim();
      if (!isRealPath(trimmed)) {
        continue;
      }
      const withSlashes = trimmed.replace(/\\/g, "/");
      const hasDrive = /^[a-zA-Z]:(\/|$)/.test(withSlashes);
      const isAbs = withSlashes.startsWith("/") || hasDrive;
      out.add(isAbs ? normalizeKey(withSlashes) : rootNorm ? normalizeKey(`${rootNorm}/${withSlashes.replace(/^\.\//, "")}`) : normalizeKey(withSlashes));
    }
  }
  return out;
}
function deriveEntries(ctx, sessionID) {
  if (!sessionID) {
    return [];
  }
  const messages = ctx.data.session.message.list(sessionID);
  if (!messages || messages.length === 0) {
    return [];
  }
  const root = resolveRoot(ctx, sessionID);
  const pending = pendingKeys(ctx, sessionID, root);
  const byKey = new Map;
  let order = 0;
  for (const msg of messages) {
    if (msg.type !== "assistant") {
      continue;
    }
    for (const part of msg.content) {
      if (part.type !== "tool") {
        continue;
      }
      const toolName = toolNameOf(part);
      const kind = classifyTool(toolName);
      if (!kind) {
        continue;
      }
      const status = toolStatusOf(part.state.status);
      if (!status) {
        continue;
      }
      const at = partActivityTime(part);
      const seen = new Set;
      for (const raw of pathsOf(part.state.input)) {
        const mapped = toKeyAndDisplay(raw, root);
        if (!mapped || seen.has(mapped.key)) {
          continue;
        }
        seen.add(mapped.key);
        order += 1;
        const prev = byKey.get(mapped.key);
        const history = [...prev?.history ?? [], { tool: toolName, kind, status, at, partID: part.id }].slice(-HISTORY_PER_FILE);
        byKey.set(mapped.key, {
          key: mapped.key,
          rel: mapped.rel,
          abs: mapped.abs,
          state: prev?.state === "modified" || kind === "modified" ? "modified" : "reading",
          status: "done",
          tool: toolName,
          reads: (prev?.reads ?? 0) + (kind === "reading" ? 1 : 0),
          writes: (prev?.writes ?? 0) + (kind === "modified" ? 1 : 0),
          order,
          updatedAt: at || prev?.updatedAt || 0,
          history
        });
      }
    }
  }
  for (const e of byKey.values()) {
    const last = e.history[e.history.length - 1];
    if (last?.status === "running" || last?.status === "streaming") {
      e.status = "running";
    } else if (last?.status === "pending") {
      e.status = "pending";
    } else if (last?.status === "error") {
      e.status = "error";
    } else if (pending.has(e.key)) {
      e.status = "pending";
    } else {
      e.status = "done";
    }
  }
  return [...byKey.values()].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.order - a.order);
}
var notifiedErrors = new Map;
function activeSessionID(ctx) {
  const route = ctx.ui.router.current();
  if (route.type === "session") {
    return route.sessionID;
  }
  return ctx.ui.tabs.list()?.find((t) => t.active)?.sessionID ?? "";
}
function extractEventSessionID(details) {
  if (!isRecord(details)) {
    return;
  }
  const data = details.data;
  if (isRecord(data) && typeof data.sessionID === "string") {
    return data.sessionID;
  }
  const props = details.properties;
  if (isRecord(props)) {
    if (typeof props.sessionID === "string") {
      return props.sessionID;
    }
    const part = props.part;
    if (isRecord(part) && typeof part.sessionID === "string") {
      return part.sessionID;
    }
  }
  return;
}
function classifyEvent(details) {
  if (!isRecord(details)) {
    return "bump";
  }
  const type = details.type;
  if (typeof type !== "string") {
    return "bump";
  }
  if (type === "permission.asked" || type === "permission.replied") {
    return "permission";
  }
  if (type.startsWith("session.tool.") || type.startsWith("session.message.") || type.startsWith("session.execution.") || type.startsWith("session.step.") || type.startsWith("session.text.") || type.startsWith("session.reasoning.") || type === "session.retry.scheduled" || type === "session.compaction.ended" || type === "session.status" || type === "session.idle") {
    return "message";
  }
  if (type.startsWith("session.")) {
    return "message";
  }
  return "bump";
}
function useSessionVersion(ctx, sessionID) {
  const [version, setVersion] = createSignal(0);
  const bump = () => setVersion((v) => v + 1);
  createEffect(() => {
    const sid = sessionID();
    if (!sid) {
      return;
    }
    let alive = true;
    let timer;
    let pendingKind = "both";
    const isAlive = () => alive;
    thenBump(ctx.data.session.message.sync(sid), bump, isAlive);
    thenBump(ctx.data.session.permission.sync(sid), bump, isAlive);
    const flush = () => {
      timer = undefined;
      if (!alive) {
        return;
      }
      const kind = pendingKind;
      pendingKind = "both";
      if (kind === "message" || kind === "both") {
        thenBump(ctx.data.session.message.sync(sid), bump, isAlive);
      }
      if (kind === "permission" || kind === "both") {
        thenBump(ctx.data.session.permission.sync(sid), bump, isAlive);
      }
    };
    const schedule = (kind) => {
      if (kind === "both") {
        pendingKind = "both";
      } else if (pendingKind !== "both" && pendingKind !== kind && (kind === "message" || kind === "permission")) {
        pendingKind = "both";
      } else if (pendingKind === "bump") {
        pendingKind = kind;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(flush, SYNC_DEBOUNCE_MS);
    };
    const stop = ctx.data.listen((event) => {
      if (!alive) {
        return;
      }
      const details = event?.details;
      if (extractEventSessionID(details) !== sid) {
        return;
      }
      bump();
      schedule(classifyEvent(details));
    });
    onCleanup(() => {
      alive = false;
      stop();
      if (timer) {
        clearTimeout(timer);
      }
    });
  });
  return version;
}
function useNow(intervalMs) {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), intervalMs);
  onCleanup(() => clearInterval(timer));
  return now;
}
function notifyFailures(ctx, sessionID, list) {
  if (!sessionID) {
    return;
  }
  let seen = notifiedErrors.get(sessionID);
  if (!seen) {
    seen = new Set;
    notifiedErrors.set(sessionID, seen);
  }
  for (const e of list) {
    if (e.status !== "error" || e.state !== "modified") {
      continue;
    }
    const lastError = [...e.history].reverse().find((h) => h.status === "error");
    const partID = lastError?.partID || `${e.order}`;
    if (seen.has(partID)) {
      continue;
    }
    seen.add(partID);
    while (seen.size > MAX_NOTIFIED_PER_SESSION) {
      const oldest = seen.values().next();
      if (oldest.done || oldest.value === undefined) {
        break;
      }
      seen.delete(oldest.value);
    }
    ctx.ui.toast.show({
      title: "File edit failed",
      message: `${e.rel} (${e.tool})`,
      variant: "error",
      sessionID
    });
    ctx.attention.notify({
      title: "Edit failed",
      message: e.rel,
      notification: { when: "blurred" },
      sound: { name: "error", when: "always" }
    }).catch(() => {});
  }
  if (notifiedErrors.size > 20) {
    const first = notifiedErrors.keys().next();
    if (!first.done && first.value !== undefined && first.value !== sessionID) {
      notifiedErrors.delete(first.value);
    }
  }
}
function GraphPanel(props) {
  const ctx = usePlugin();
  const palette = createMemo(() => resolvePalette(ctx));
  const version = useSessionVersion(ctx, () => props.sessionID);
  const now = useNow(CLOCK_MS);
  const all = createMemo(() => {
    version();
    return deriveEntries(ctx, props.sessionID);
  });
  const entries = createMemo(() => {
    const list = all();
    if (props.filter === "edits") {
      return list.filter((e) => e.writes > 0);
    }
    if (props.filter === "reads") {
      return list.filter((e) => e.reads > 0);
    }
    return list;
  });
  const busy = createMemo(() => {
    version();
    if (!props.sessionID) {
      return false;
    }
    return isBusyStatus(ctx.data.session.status(props.sessionID));
  });
  const lines = createMemo(() => entries().slice(0, MAX_FILES).map((e) => toLine(e, palette(), now())));
  const summary = createMemo(() => toSummary(entries(), props.filter));
  const header = createMemo(() => {
    const badge = props.filter === "all" ? "live" : `live \xB7 ${props.filter}`;
    return `${props.collapsed ? "\u25B6" : "\u25BC"} ${busy() ? "\u25CF" : "\u25C9"} files \xB7 ${badge}`;
  });
  createEffect(() => notifyFailures(ctx, props.sessionID, all()));
  return /* @__PURE__ */ jsxDEV(Show, {
    when: props.enabled,
    fallback: /* @__PURE__ */ jsxDEV("text", {
      fg: palette().dim,
      children: "files \xB7 off \u2014 Ctrl+P \u2192 Toggle File Graph"
    }, undefined, false, undefined, this),
    children: /* @__PURE__ */ jsxDEV("box", {
      flexDirection: "column",
      borderStyle: "rounded",
      paddingLeft: 1,
      paddingRight: 1,
      children: [
        /* @__PURE__ */ jsxDEV("box", {
          onMouseDown: (event) => {
            try {
              event?.stopPropagation?.();
            } catch {}
            props.onToggle();
          },
          children: /* @__PURE__ */ jsxDEV("text", {
            fg: palette().head,
            children: header()
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV(Show, {
          when: !props.collapsed,
          children: [
            /* @__PURE__ */ jsxDEV(Show, {
              when: lines().length > 0,
              fallback: /* @__PURE__ */ jsxDEV("text", {
                fg: palette().dim,
                children: "no files yet \u2014 reads/edits appear here"
              }, undefined, false, undefined, this),
              children: /* @__PURE__ */ jsxDEV(For, {
                each: lines(),
                children: (line) => /* @__PURE__ */ jsxDEV("text", {
                  fg: line.color,
                  children: line.text
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV(Show, {
              when: summary(),
              children: /* @__PURE__ */ jsxDEV("text", {
                fg: palette().dim,
                children: summary()
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV(Show, {
              when: entries().length > MAX_FILES,
              children: /* @__PURE__ */ jsxDEV("text", {
                fg: palette().dim,
                children: `+${entries().length - MAX_FILES} more \u2014 Ctrl+P \u2192 File Graph Detail`
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      ]
    }, undefined, true, undefined, this)
  }, undefined, false, undefined, this);
}
function DetailPanel(props) {
  const ctx = usePlugin();
  const palette = createMemo(() => resolvePalette(ctx));
  const getID = () => props.panel.sessionID ?? "";
  const version = useSessionVersion(ctx, getID);
  const now = useNow(CLOCK_MS);
  ctx.keymap.layer(() => ({
    commands: [
      {
        id: "graph-live.detail.fullscreen",
        title: "File Graph: toggle fullscreen",
        bind: "f",
        run: () => {
          props.panel.toggleFullscreen();
        }
      },
      {
        id: "graph-live.detail.close",
        title: "File Graph: close detail",
        bind: "escape",
        run: () => {
          props.panel.close();
        }
      }
    ]
  }));
  const entries = createMemo(() => {
    version();
    return deriveEntries(ctx, getID());
  });
  return /* @__PURE__ */ jsxDEV("box", {
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    children: [
      /* @__PURE__ */ jsxDEV("text", {
        fg: palette().body,
        children: `file activity \xB7 ${entries().length} file(s) \xB7 f fullscreen \xB7 esc close`
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV(Show, {
        when: entries().length > 0,
        fallback: /* @__PURE__ */ jsxDEV("text", {
          fg: palette().dim,
          children: "no file reads/edits in this session yet"
        }, undefined, false, undefined, this),
        children: /* @__PURE__ */ jsxDEV(For, {
          each: entries(),
          children: (e) => /* @__PURE__ */ jsxDEV("box", {
            flexDirection: "column",
            paddingTop: 1,
            children: [
              /* @__PURE__ */ jsxDEV("text", {
                fg: statusColor(e, palette()),
                children: `${statusMark(e)} ${e.rel} \xB7 r${e.reads} w${e.writes}`
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV("text", {
                fg: palette().dim,
                children: truncateMiddle(e.abs, MAX_PATH_WIDTH)
              }, undefined, false, undefined, this),
              /* @__PURE__ */ jsxDEV(For, {
                each: e.history.slice(-HISTORY_PER_FILE).reverse(),
                children: (h) => /* @__PURE__ */ jsxDEV("text", {
                  fg: h.status === "error" ? palette().err : palette().dim,
                  children: `  ${h.status === "error" ? "!" : h.status === "running" || h.status === "streaming" || h.status === "pending" ? "\u25B8" : "\xB7"} ${truncateMiddle(h.tool, 20)} ${h.kind === "modified" ? "edit" : "read"} \xB7 ${h.status} \xB7 ${timeAgo(h.at, now())}`
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this)
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
var tui_default = Plugin.define({
  id: "graph-live.cli",
  setup(context) {
    const ctx = context;
    const [store, setStore] = ctx.storage.store(SETTINGS_KEY, { initial: { enabled: true, filter: "all", collapsed: ctx.options?.collapsedByDefault !== false } });
    const setFilter = (filter) => {
      setStore((draft) => {
        draft.filter = filter;
      });
    };
    const toggleCollapsed = () => {
      setStore((draft) => {
        draft.collapsed = !draft.collapsed;
      });
    };
    const toggle = () => {
      setStore((draft) => {
        draft.enabled = !draft.enabled;
      });
    };
    const cycleFilter = () => {
      const next = store.filter === "all" ? "edits" : store.filter === "edits" ? "reads" : "all";
      setFilter(next);
      ctx.ui.toast.show({ message: `file graph: ${next}`, variant: "info" });
    };
    const openDetail = () => {
      const ok = ctx.ui.panel.open("graph-live.detail");
      if (!ok) {
        ctx.ui.toast.show({ message: "open a session first", variant: "warning" });
      }
    };
    const showPaths = async () => {
      const sid = activeSessionID(ctx);
      if (!sid) {
        ctx.ui.toast.show({ message: "open a session first", variant: "warning" });
        return;
      }
      const list = deriveEntries(ctx, sid);
      if (list.length === 0) {
        ctx.ui.toast.show({ message: "no files yet", variant: "info" });
        return;
      }
      const picked = await ctx.ui.dialog.select({
        title: "Touched files",
        options: list.map((e) => ({
          title: e.rel,
          value: e.abs,
          description: `${e.state === "modified" ? "edit" : "read"} \xB7 r${e.reads} w${e.writes} \xB7 ${e.status}`,
          footer: e.abs
        }))
      });
      if (picked) {
        ctx.ui.toast.show({ message: String(picked), variant: "info", sessionID: sid });
      }
    };
    const stopCommands = ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "graph-live.toggle",
              title: "Toggle File Graph",
              description: "Enable or disable the live file activity graph in the sidebar",
              group: "graph-live",
              palette: true,
              run: toggle
            },
            {
              id: "graph-live.filter.cycle",
              title: "File Graph: cycle filter (all \u2192 edits \u2192 reads)",
              group: "graph-live",
              palette: true,
              run: cycleFilter
            },
            {
              id: "graph-live.filter.edits",
              title: "File Graph: show edits only",
              group: "graph-live",
              palette: true,
              run: () => setFilter("edits")
            },
            {
              id: "graph-live.filter.reads",
              title: "File Graph: show reads only",
              group: "graph-live",
              palette: true,
              run: () => setFilter("reads")
            },
            {
              id: "graph-live.filter.all",
              title: "File Graph: show all files",
              group: "graph-live",
              palette: true,
              run: () => setFilter("all")
            },
            {
              id: "graph-live.detail",
              title: "File Graph Detail",
              description: "Open the full per-file timeline in a session panel",
              group: "graph-live",
              palette: true,
              slash: { name: "files", aliases: ["file-graph"] },
              run: openDetail
            },
            {
              id: "graph-live.paths",
              title: "File Graph: show full paths",
              description: "Pick a touched file to reveal its full path",
              group: "graph-live",
              palette: true,
              run: showPaths
            }
          ]
        }));
        return null;
      }
    });
    const stopDetail = ctx.ui.slot({
      append: "session.panel",
      render: (panel) => /* @__PURE__ */ jsxDEV(Show, {
        when: panel.name === "graph-live.detail",
        children: /* @__PURE__ */ jsxDEV(DetailPanel, {
          panel
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    });
    const stopPanel = ctx.ui.slot({
      append: "sidebar.content",
      render: (input) => {
        const sessionID = input.sessionID ?? "";
        return /* @__PURE__ */ jsxDEV(GraphPanel, {
          sessionID,
          enabled: store.enabled,
          filter: store.filter,
          collapsed: store.collapsed,
          onToggle: toggleCollapsed
        }, undefined, false, undefined, this);
      }
    });
    return () => {
      stopCommands();
      stopDetail();
      stopPanel();
    };
  }
});
export {
  tui_default as default
};
