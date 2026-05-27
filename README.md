# NE-CLI

NE-CLI is a local coding agent for NoteExpress users. It runs in your terminal,
works inside the current project directory, and uses NoteExpress model services
through the `necli` command.

## Install

```powershell
npm install -g @noteexpress/cli
```

After installation, start an interactive session:

```powershell
necli
```

Run a one-off task:

```powershell
necli exec "Say exactly: ok"
```

## Login

NE-CLI uses a NoteExpress token.

```powershell
"<your-token>" | necli login --with-token
necli login status
```

You can also provide the token through `NE_CLI_API_KEY`.

## Defaults

By default, `necli` uses the NE provider and the `ne-scientific` model. To use a
different NE model:

```powershell
$env:NE_CLI_MODEL = "your-model-id"
necli
```

## Files And Commands

In an interactive session, NE-CLI can read files, search the workspace, edit
content, and run commands after the model requests the corresponding tool. It is
designed for project-level coding and documentation work rather than simple
chat-only usage.

## License

This project is licensed under the Apache-2.0 License.
