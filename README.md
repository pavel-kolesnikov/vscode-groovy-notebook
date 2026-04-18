# Groovy Notebook

Interactive Groovy notebook kernel for VS Code.

- Opens `.groovynb` files as interactive notebooks
- Cells execute via a Groovy REPL process
- Built-in helpers for output formatting, exploration, and dependency management

## Requirements

- **Groovy 5+** (`groovy` must be in `PATH`, or set `groovyNotebook.groovyPath`)
- **Java 21+**

## Quick Start

1. Install the extension
2. Create a `notebook.groovynb` file and open it in VS Code
3. Try these cells:

**Cell 1 — Basic evaluation:**
```groovy
1 + 1
```

**Cell 2 — Pretty-print and dependencies:**
```groovy
grab "org.apache.commons:commons-lang3:3.17.0"
pp org.apache.commons.lang3.StringUtils.class.methods.take(3)
```

**Cell 3 — Tabular output:**
```groovy
def data = (1..5).collect { [n: it, sq: it * it] }
tt data
```

**Cell 4 — Built-in help:**
```groovy
help()
```

## Commands

| Command | Description |
|---------|-------------|
| `p <args...>` | Print arguments space-separated |
| `pp <args...>` | Pretty-print as YAML (strips transient/static fields) |
| `tt <data> [columns]` | Render ASCII table from list of maps; optional column filter e.g. `tt data, 'name age'` |
| `dir <obj>` | Inspect object members — fields, properties, methods — sorted by inheritance depth |
| `findClass <name>` | Find fully-qualified class name by short name (searches classpath JARs) |
| `grab <coords...>` | Grab Maven dependencies via Grape (`group:artifact:version`, cached in `~/.groovy/grapes`) |
| `addClasspath <dir>` | Add directory to classpath (relative to `.groovynb` file location) |
| `help [cmd]` | Show command overview, or detailed help for a specific command |

## Notes

- **Classpath resolution:** `addClasspath 'lib'` resolves `./lib` relative to the `.groovynb` file, not the workspace root
- **Auto-configuration:** `~/.groovy/groovysh.rc` is loaded on kernel startup
- **Cell interruption:** Long-running cells can be cancelled with the stop button
- **Output compression:** Set `groovyNotebook.compressOutputs` to `false` for human-readable `.groovynb` files (useful with external tools or AI agents)

## Contributing

See [AGENTS.md](./AGENTS.md) for architecture, development setup, and testing instructions.

## Development

```bash
npm install
npm run compile
npm test
```

Press F5 in VS Code to launch Extension Development Host, then open a `.groovynb` file.
