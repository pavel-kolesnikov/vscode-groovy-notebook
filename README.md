# Groovy Notebook

This is a very simple extension that provides basic Groovy Notebook experience.

- A notebook is activated for files matching `*.groovynb`.
- A notebook cells are executed by a simple wrapper to GroovyShell.

# Requirements

A `groovy` binary must be in the `PATH`.

# Utilities

Some utility methods are injected into the binding of the shell:

- `p <anything>` --- shortcut to `println <anything>`
- `pp <anything>` --- shortcut to YAML serialize `<anything>`
- `tt < a List<Map<String, Object>> >` --- will try to render ASCII table from the list.
- `grab <group1:module1:1.0.0>(, <more artifacts>)` --- will grab given artifacts from default provider, usually Maven Central.
- `addClasspath <local path>` --- add given path to the Shell context, making all `*.groovy` & `*.java` files there available for the Notebook.
- `findClass <className>` --- will try find import path for a given class.

# Limitations

See [GitHub Issues](https://github.com/pavel-kolesnikov/vscode-groovy-notebook/issues) for known issues and planned improvements.

# Contributing

See [AGENTS.md](./AGENTS.md) for development setup and architecture overview.

## Development

```bash
npm install
npm run compile
npm test
```

Press F5 in VS Code to launch Extension Development Host.

## Running Groovy Tests

```bash
cd src/groovy && groovy KernelTest.groovy
```

