# Groovy Notebook - Maintenance Guide

This guide is for AI assistants and human maintainers working on the Groovy Notebook extension.

## Quick Start

```bash
npm install
npm run compile
```

Press F5 in VS Code to launch Extension Development Host, then open a `.groovynb` file.

## Architecture

```
+-----------------------------------------------------------------+
|  VS Code Extension (TypeScript)                                  |
+-----------------------------------------------------------------+
|  extension.ts --> kernel.ts --> session.ts --> process.ts       |
|       |              |              |              |             |
|       v              v              v              v             |
|  commands.ts    NotebookCell   GroovySession  spawn/run/kill    |
|  statusBar.ts   Execution      (1 per notebook)                 |
|  serializer.ts                                                    |
+-----------------------------------------------------------------+
|                      Wire Protocol (stdin/stdout)                |
|   ACK (0x06) = ready signal    ETX (0x03) = message delimiter   |
+-----------------------------------------------------------------+
|  Groovy Backend (Kernel.groovy)                                  |
|  +-------------+  +-------------+  +----------------+           |
|  |   Kernel    |  | MacroHelper |  |PrettyPrintHelp|           |
|  | (REPL loop) |  | (p/pp/tt/...)|  |(YAML serialize)|           |
|  +-------------+  +-------------+  +----------------+           |
+-----------------------------------------------------------------+
```

### Key Invariants

- One GroovyProcess per notebook (via SessionRegistry)
- Cells execute sequentially (queue in kernel.ts)
- Protocol: VS Code sends `code + ETX`, Groovy responds with `output + ETX`

## Key Files

| File | Purpose | Lines |
|------|---------|-------|
| extension.ts | Entry point, DI wiring | 88 |
| kernel.ts | Notebook controller, cell execution | 142 |
| session.ts | Per-notebook session management | 200 |
| process.ts | Subprocess lifecycle, wire protocol | 339 |
| types.ts | Shared type definitions | 25 |
| protocol.ts | Protocol constants (ACK, ETX) | 10 |
| config.ts | Configuration and timeouts | 46 |
| commands.ts | VS Code command handlers | 52 |
| statusBar.ts | Kernel status display | 70 |
| serializer.ts | Notebook file serialization | 161 |
| Kernel.groovy | Groovy REPL loop + macros | 433 |

## Classpath Resolution

**Important**: The Groovy process runs in the notebook file's directory.

- Relative paths in notebook cells resolve from `.groovynb` file location
- `addClasspath 'lib'` adds `./lib` relative to the notebook file
- If notebook is moved, relative paths may break
- Use `addClasspath '/absolute/path'` for portable scripts

## Running Tests

### TypeScript Tests

```bash
npm test
```

Uses Mocha with ts-node. Tests are in `src/test/*.test.ts`.

### Groovy Tests

**Critical**: Run from `src/groovy/` directory or use explicit classpath:

```bash
# Correct - run from src/groovy directory
cd src/groovy && groovy KernelTest.groovy

# Alternative - use explicit classpath
groovy -cp src/groovy src/groovy/KernelTest.groovy

# WRONG - will fail to find classes
groovy src/groovy/KernelTest.groovy  # ✗
```

## Making Changes

### Before Committing

```bash
npm run compile   # Build TypeScript
npm run lint      # Check code style
npm test          # Run tests
```

### Debug Logging

Debug logging is controlled by `LOG_ENABLED` constant in:
- `process.ts` - process lifecycle logging
- `session.ts` - session management logging

Set to `true` for debugging, keep `false` in production.

## Known Issues

1. **Process exit detection**: Groovy process abnormal exit not always detected
2. **Error propagation**: Some errors may not reach UI, kernel appears hung

## Release Process

1. Update version in `package.json`
2. `npm run compile`
3. `npm run pack` - creates `.vsix` file
4. Install and test the `.vsix` locally
5. Publish to VS Code Marketplace

## Wire Protocol

Communication between VS Code and Groovy uses ASCII control characters:

| Signal | ASCII | Code | Purpose |
|--------|-------|------|---------|
| ACK | `\u0006` | 0x06 | Groovy signals ready after startup |
| ETX | `\u0003` | 0x03 | Message delimiter (end of code/output) |

Flow:
1. VS Code spawns Groovy process
2. Groovy sends ACK when ready
3. VS Code sends `code + ETX`
4. Groovy executes, sends `output + ETX`
5. Repeat step 3-4 for each cell
