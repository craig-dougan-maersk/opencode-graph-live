# opencode-graph-live

Live file-activity graph for the opencode TUI sidebar. Shows which files the agent is reading and editing, under the MCP block.

```
● files · live
▸ main.rs ×3 · edit
! lib.rs · 12s
○ index.ts ×2 · 2m
3 files · 2 edits · 1 running
```

- `○` read · `●` edited · `▸` running (with tool name) · `!` failed · `?` awaiting permission
- `×3` is total touches per file, `· 12s` is recency

![sidebar preview](https://github.com/user-attachments/assets/0c9ec4c9-43e8-4228-b7fe-c40eb70f82e1)

## Install

Requires a recent opencode build with TUI plugin support.

**From npm:**

```sh
opencode plugin add opencode-graph-live@latest
```

### Collapsed by default

The panel starts collapsed so the sidebar stays quiet; click the header arrow to expand it. Pass the option as `false` to start expanded:

```jsonc title="opencode.jsonc"
{
  "plugins": [
    { "package": "opencode-graph-live", "options": { "collapsedByDefault": true } }
  ]
}
```


## Usage

Ctrl+P commands (all under the `graph-live` group):

| Command | What it does |
| --- | --- |
| Toggle File Graph | Enable/disable the sidebar panel (persisted) |
| File Graph: cycle filter | Cycle `all → edits → reads` |
| File Graph: show edits / reads / all | Filter the list |
| File Graph Detail (`/files`, `/file-graph`) | Full per-file timeline in a session panel (`f` fullscreen, `esc` close) |
| File Graph: show full paths | Picker with touched files → toast reveals the absolute path |

Edit failures also fire a one-time error toast + notification per file.

## License

MIT
