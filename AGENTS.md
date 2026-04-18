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
|  Kernel(InputStream in, OutputStream out)                        |
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
- Kernel takes `InputStream`/`OutputStream` — pure black box, no `System.out` hijacking

## Key Files

| File | Purpose | Lines |
|------|---------|-------|
| extension.ts | Entry point, DI wiring | 95 |
| kernel.ts | Notebook controller, cell execution | 172 |
| session.ts | Per-notebook session management | 205 |
| process.ts | Subprocess lifecycle, wire protocol | 351 |
| types.ts | Shared type definitions | 26 |
| protocol.ts | Protocol constants (ACK, ETX) | 10 |
| config.ts | Configuration and timeouts | 53 |
| logger.ts | Output channel logging | 22 |
| commands.ts | VS Code command handlers | 52 |
| statusBar.ts | Kernel status display | 70 |
| serializer.ts | Notebook file serialization | 173 |
| Kernel.groovy | Groovy REPL loop | 212 |
| MacroHelper.groovy | p/pp/tt/dir macros | 339 |
| PrettyPrintHelper.groovy | YAML serialization | 35 |

## Classpath Resolution

**Important**: The Groovy process runs in the notebook file's directory.

- Relative paths in notebook cells resolve from `.groovynb` file location
- `addClasspath 'lib'` adds `./lib` relative to the notebook file
- If notebook is moved, relative paths may break
- Use `addClasspath '/absolute/path'` for portable scripts

## Running Tests

All tests run through `npm test` (TypeScript + Groovy, sequential):

```bash
npm test            # TS mocha tests, then Groovy tests (if groovy is on PATH)
npm run test:ts     # TypeScript tests only (Mocha)
npm run test:groovy # Groovy tests only (skips gracefully if groovy not installed)
```

Uses Mocha with ts-node for TS tests (`src/test/*.test.ts`).
Groovy tests use JUnit 4 (`@Test`), one class per file in `src/groovy/*Test.groovy`.

### Groovy Test Details

Individual test files (JUnit 4 style, auto-compiled by Groovy):
- `KernelTest.groovy` - Kernel.process() and cancellation (11 tests)
- `MacroHelperTest.groovy` - p/pp/tt/dir/renderTable helpers (20 tests)
- `PrettyPrintHelperTest.groovy` - YAML serialization (8 tests)
- `CompactStackTraceTest.groovy` - Stack trace filtering (1 test)
- `WireProtocolTest.groovy` - ACK/ETX protocol constants and behavior (16 tests)

Run a single suite: `cd src/groovy && groovy KernelTest.groovy`
Run all via npm: `npm run test:groovy`

## Making Changes

### Before Committing

```bash
npm run compile   # Build TypeScript
npm run lint      # Check code style
npm test          # Run tests
```

### Debug Logging

Logs are written to VS Code's Output panel under "Groovy Notebook" channel.

- View: `View → Output → Select "Groovy Notebook" from dropdown`
- Implementation: `logger.ts` uses `vscode.window.createOutputChannel()`

## Known Issues

1. **Process exit detection**: Groovy process abnormal exit not always detected
2. **Error propagation**: Some errors may not reach UI, kernel appears hung
3. **Partial-line buffering**: `print()` without newline may not flush immediately (line-buffered via PrintStream autoFlush)

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
