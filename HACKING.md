# HACKING.md -- Groovy Notebook Developer's Guide

> A guided tour through the codebase, written for contributors who want to
> understand, extend, and debug the extension.

---

## Table of Contents

1. [What You Are Looking At](#1-what-you-are-looking-at)
2. [Prerequisites & First Build](#2-prerequisites--first-build)
3. [Architecture at a Glance](#3-architecture-at-a-glance)
4. [Project Layout](#4-project-layout)
5. [The Wire Protocol -- How the Two Halves Talk](#5-the-wire-protocol--how-the-two-halves-talk)
6. [TypeScript Side -- The VS Code Extension](#6-typescript-side--the-vs-code-extension)
7. [Groovy Side -- The REPL Backend](#7-groovy-side--the-repl-backend)
8. [Notebook File Format (.groovynb)](#8-notebook-file-format-groovynb)
9. [Testing](#9-testing)
10. [Debugging](#10-debugging)
11. [Building & Releasing](#11-building--releasing)
12. [Common Development Tasks](#12-common-development-tasks)
13. [Gotchas & Known Issues](#13-gotchas--known-issues)

---

## 1. What You Are Looking At

Groovy Notebook is a VS Code extension that turns `.groovynb` files into
interactive notebooks -- think Jupyter, but for Groovy.  Each notebook tab
gets its own long-lived Groovy process (a REPL).  You type code into cells,
the extension sends it to the process over stdin, and the process sends
results back over stdout.

The key architectural insight is the **split between host and backend**:

```
+-----------------------------------------------+
|  VS Code Extension  (TypeScript / Node.js)     |
|  Reads .groovynb, renders cells, manages UI    |
+-------+---------------------------------------+
        |  stdin / stdout (ASCII control chars)
+-------v---------------------------------------+
|  Groovy Process  (Kernel.groovy)               |
|  REPL loop, macros, pretty-printing            |
+-----------------------------------------------+
```

The two processes communicate through a deliberately simple **wire protocol**
built on two ASCII control characters -- easy to understand, easy to debug.
The trade-off: no rich messaging.

---

## 2. Prerequisites & First Build

### Requirements

| Dependency | Version | Why |
|---|---|---|
| Node.js | 18+ | Extension host runtime + build toolchain |
| Java JDK | 21+ | Groovy 5 requires Java 21+ |
| Groovy | 5+ | REPL backend; install via [SDKMAN](https://sdkman.io/): `sdk install groovy` |
| npm | bundled | Build scripts |

### Build & Run

```bash
git clone https://github.com/pavel-kolesnikov/vscode-groovy-notebook.git
cd vscode-groovy-notebook
npm install
npm run compile        # builds Groovy helpers + TypeScript
```

Press **F5** in VS Code to launch the Extension Development Host.  Open any
`.groovynb` file (or use the "Create Sample Groovy Notebook" command from the
Command Palette).

### Key npm Scripts

| Script | What It Does |
|---|---|
| `npm run compile` | Build Groovy helpers jar + TypeScript (`tsc -b`) |
| `npm run watch` | Watch-mode TypeScript compilation (used by F5 launch) |
| `npm run lint` | ESLint on `src/` |
| `npm test` | Run TypeScript tests (Mocha), then Groovy tests |
| `npm run test:ts` | TypeScript tests only |
| `npm run test:groovy` | Groovy tests only (skips gracefully if `groovy` not found) |
| `npm run pack` | Package `.vsix` extension file |
| `npm run dogfood` | Pack + install the extension into your local VS Code |

---

## 3. Architecture at a Glance

```
extension.ts            Entry point -- dependency injection
    |
    +-- kernel.ts       NotebookController -- cell execution queue
    |       |
    |       +-- session.ts  SessionRegistry (1 session per notebook)
    |               |
    |               +-- process.ts  GroovyProcess (child process lifecycle)
    |
    +-- serializer.ts    .groovynb <-> NotebookData (JSON + gzip)
    +-- commands.ts      Kernel restart / terminate commands
    +-- statusBar.ts     Status bar indicator ("Groovy" / "Groovy (Busy)")
    +-- config.ts        User settings (groovyPath, javaHome, compressOutputs)
    +-- logger.ts        OutputChannel logging
    +-- protocol.ts      ACK + ETX constants
    +-- types.ts         Shared TypeScript interfaces
    +-- pathUtils.ts     Windows/POSIX path normalization
    +-- configValidation.ts  Input validation for settings
```

On the Groovy side:

```
Kernel.groovy           REPL loop (stdin scanner -> evaluate -> stdout)
    |
    +-- MacroHelper.groovy      Built-in commands (p, pp, tt, dir, grab, ...)
    +-- PrettyPrintHelper.groovy  YAML serialization with transient stripping
```

### Core Invariants

Understanding these invariants will save you hours of debugging:

1. **One Groovy process per notebook.** The `SessionRegistry` maps
   `notebook URI -> GroovySession -> GroovyProcess`.  Closing the notebook
   terminates the process.

2. **Cells execute sequentially.** The kernel's `execute()` method chains
   cell executions onto a `Promise` queue.  There is no parallel cell
   execution within a notebook.

3. **The Groovy process runs in the notebook file's directory.** This means
   relative paths in cells (e.g., `addClasspath 'lib'`) resolve from where
   the `.groovynb` file lives, not from the workspace root.

4. **Streams are injected.** The `Kernel` constructor takes `(InputStream,
   OutputStream, OutputStream)` parameters — `in`, `out`, and `err`.  A pure
   black-box design.  Output streams directly to the pipe via `FlushingWriter`
   (which flushes on every write), enabling real-time streaming to the cell
   output in VS Code.

---

## 4. Project Layout

```
vscode-groovy-notebook/
├── src/
│   ├── typescript/           # VS Code extension (13 files)
│   │   ├── extension.ts      #   activate() -- wires everything together
│   │   ├── kernel.ts         #   NotebookController (cell execution)
│   │   ├── session.ts        #   SessionRegistry + GroovySession
│   │   ├── process.ts        #   GroovyProcess (spawn, run, kill)
│   │   ├── serializer.ts     #   .groovynb serialization/deserialization
│   │   ├── commands.ts       #   Restart/terminate commands
│   │   ├── statusBar.ts      #   Status bar UI element
│   │   ├── config.ts         #   Configuration access + defaults
│   │   ├── configValidation.ts  # Input validation
│   │   ├── logger.ts         #   OutputChannel logger
│   │   ├── protocol.ts       #   ACK (0x06) + ETX (0x03) constants
│   │   ├── types.ts          #   Shared interfaces
│   │   └── pathUtils.ts      #   Cross-platform path normalization
│   ├── groovy/               # REPL backend (3 main + tests)
│   │   ├── Kernel.groovy     #   Main REPL loop (3-arg constructor: in, out, err)
│   │   ├── MacroHelper.groovy#   Built-in commands (instance class)
│   │   ├── PrettyPrintHelper.groovy  # YAML output
│   │   ├── *Test.groovy      #   JUnit 4 test files (includes KernelPipeTest)
│   │   └── TestPerson.groovy #   Test fixture
│   └── test/                 # TypeScript tests (Mocha)
│       ├── process.test.ts   #   Subprocess protocol tests
│       ├── session.test.ts   #   Registry/disposal tests
│       ├── types.test.ts     #   Type contract tests
│       ├── configValidation.test.ts
│       └── pathUtils.test.ts
├── samples/                  # Example notebooks
│   ├── sample.groovynb       #   Full demo notebook
│   ├── sample-b.groovynb     #   Additional sample
│   ├── SameDir.groovy        #   Demo: relative classpath
│   └── other-path/Cow.groovy #   Demo: addClasspath target
├── scripts/
│   └── test-groovy.mjs       #   Groovy test runner (finds *Test.groovy)
├── .vscode/
│   ├── launch.json           #   F5 extension host launch config
│   ├── tasks.json            #   Build tasks (watch, compile)
│   ├── settings.json         #   Workspace settings
│   └── extensions.json       #   Recommended extensions
├── package.json              #   Extension manifest + npm scripts
├── tsconfig.json             #   TypeScript config (ES2022, NodeNext modules)
├── tsconfig.test.json        #   Test-specific TS config
├── .mocharc.json             #   Mocha configuration (ts-node loader)
├── eslint.config.js          #   ESLint flat config
├── AGENTS.md                 #   AI assistant maintenance guide
└── README.md                 #   User-facing documentation
```

---

## 5. The Wire Protocol -- How the Two Halves Talk

This is the single most important concept in the project.  Everything else
is scaffolding around this protocol.

### Signal Definitions

| Signal | ASCII Name | Code Point | Direction | Purpose |
|---|---|---|---|---|
| ACK | `\u0006` | 0x06 | Groovy -> VS Code | "I'm ready" |
| ETX | `\u0003` | 0x03 | Bidirectional | "End of message" |

Defined in `src/typescript/protocol.ts` and mirrored in `Kernel.groovy:38-39`.

### Startup Sequence

```
VS Code                              Groovy Process
  |                                      |
  |  spawn("groovy", ["-cp", jar,        |
  |           "Kernel.groovy"])          |
  |------------------------------------->|
  |                                      |  (GroovyShell initializes,
  |                                      |   macros injected,
  |                                      |   groovysh.rc loaded)
  |                                      |
  |        ACK (\u0006)                  |
  |<-------------------------------------|
  |                                      |
  |     [ready to accept cells]          |
```

The TypeScript side waits up to 10 seconds (`CONFIG.TIMEOUT_SPAWN_MS`) for
the ACK signal.  If it doesn't arrive, the process is killed and an error
is shown to the user.

### Cell Execution Sequence

```
VS Code                              Groovy Process
  |                                      |
  |  "println 'hello'" + ETX (\u0003)   |
  |------------------------------------->|
  |                                      |  Scanner splits on ETX,
  |                                      |  strips whitespace,
  |                                      |  calls process(code)
  |                                      |  shell.parse(code).run()
  |                                      |
  |    "hello\n" + ETX (\u0003)          |
  |<-------------------------------------|
  |                                      |
  |  [output displayed in cell]          |
```

Key implementation detail: `GroovyProcess.executeCode()` (process.ts:200)
attaches listeners to `proc.stdout` and streams each chunk to the cell
output in real time via an `onOutput` callback.  When the ETX marker is
seen in the output stream, it resolves the promise with the accumulated
stdout/stderr.  A `settled` flag prevents double-resolution from race
conditions (e.g., ETX and process exit arriving simultaneously).

### Interrupt Sequence

```
VS Code                              Groovy Process
  |                                      |
  |  SIGINT                              |
  |------------------------------------->|
  |                                      |  Signal handler cancels
  |                                      |  current executor Future
  |                                      |
  |    "Execution cancelled" + ETX       |
  |<-------------------------------------|
```

Signal handling is externalized: the `Kernel` exposes `interrupt()` and
`shutdown()` methods, and `static main` installs a `sun.misc.Signal`
handler for SIGINT (`Kernel.groovy:70-97`).  When SIGINT arrives, the
handler calls `interrupt()` to cancel the running `Future`; if no future
is active, it calls `shutdown()` to exit the REPL loop.  The
`@ThreadInterrupt` AST transform ensures that Groovy code checks for
interruption at statement boundaries.

---

## 6. TypeScript Side -- The VS Code Extension

### Extension Lifecycle (`extension.ts`)

The `activate()` function is the composition root -- it wires together all
dependencies and registers them for cleanup:

```typescript
activate(context) {
    initLogger()                        // OutputChannel for debug logs
    const groovyPath = getGroovyPath()  // from settings or "groovy"
    const baseConfig = { groovyPath, evalScriptPath, classpath }
    const registry = new SessionRegistry(baseConfig)
    const kernel = new GroovyKernelController(registry)
    const statusBar = new KernelStatusBar(registry)
    registerKernelCommands(context, registry)
    // register serializer, commands, disposables...
}
```

Notice the dependency flow: `kernel -> registry -> session -> process`.
Each layer only depends on the layer below it.

### Kernel Controller (`kernel.ts`)

`GroovyKernelController` implements VS Code's `NotebookController` API:

- **`executeHandler`**: Receives cells from VS Code when the user clicks "Run".
  Chains them onto a `Promise` queue for sequential execution.
- **`interruptHandler`**: Sends SIGINT via the session's `interrupt()` method.
- **Execution order**: Tracks per-notebook execution counters
  (`executionOrders` map) for the `[1]`, `[2]` labels in the UI.

The execution flow for a single cell:

1. `setupExecution()` -- creates `NotebookCellExecution`, sets execution order,
   starts timer, clears old output
2. `runAndGetResult()` -- delegates to `session.run(code)`
3. `handleOutputs()` -- appends stdout/stderr as `NotebookCellOutput` items
4. `cleanupExecution()` -- nulls out `currentExecution`

### Session Management (`session.ts`)

Two classes here:

**`GroovySession`** wraps a `GroovyProcess` for a single notebook:
- Lazy-initializes the process on first `run()` call
- Manages status transitions: `idle -> starting -> busy -> idle` (or `error`)
- Tracks whether the last execution was interrupted

**`SessionRegistry`** is the session factory:
- Maps `notebook URI -> GroovySession`
- `getOrCreate(uri, cwd)` lazily creates sessions
- `restart(uri)` kills the process but keeps the session
- `terminate(uri)` kills the process and marks session as terminated
- Forwards status change events from all sessions

### Process Management (`process.ts`)

`GroovyProcess` is the lowest level of the TypeScript stack -- it manages
the actual child process lifecycle:

**`spawn()`** (line 115):
- Spawns `groovy` with the classpath and `Kernel.groovy` script
- Waits for ACK signal on stdout (with 10s timeout)
- Uses a `settled` flag to prevent double-resolve/reject race conditions
- Sets `JAVA_HOME` from config or environment

**`executeCode()`** (line 200):
- Writes `code + ETX` to stdin
- Accumulates stdout/stderr chunks
- Resolves when ETX is seen in stdout
- Rejects on process exit, error, or buffer overflow (1 GB limit)
- The `cleanup()` function removes all listeners to prevent leaks

**`killProcess()`** (line 319):
- Sends SIGTERM first
- Waits up to 5 seconds (`TIMEOUT_THREAD_JOIN_MS`)
- Falls back to SIGKILL if the process doesn't exit

### Content Serializer (`serializer.ts`)

`GroovyContentSerializer` converts between `.groovynb` JSON files and VS
Code's `NotebookData`:

- **Schema version**: `1.1.0` -- checked on deserialization, warning on mismatch
- **Cell IDs**: Random 8-char strings, preserved across saves
- **Output compression**: Outputs >1 KB are gzip-compressed (base64-encoded)
  when `groovyNotebook.compressOutputs` is true (default)
- **MIME type handling**: Text MIME types are stored as strings, binary as base64

The serializer is registered as a `NotebookSerializer` with
`transientOutputs: false`, meaning outputs are persisted in the file.

### Configuration (`config.ts` + `configValidation.ts`)

Three user-configurable settings:

| Setting | Default | Purpose |
|---|---|---|
| `groovyNotebook.groovyPath` | `"groovy"` | Path to Groovy binary |
| `groovyNotebook.javaHome` | `""` | Override JAVA_HOME |
| `groovyNotebook.compressOutputs` | `true` | Gzip-compress cell outputs in .groovynb |

Validation is split into `configValidation.ts` -- pure functions with no
VS Code dependency, making them testable in isolation.

### Status Bar (`statusBar.ts`)

`KernelStatusBar` shows the kernel state in the status bar:
- Idle: `○ Groovy`
- Starting: `⟳ Groovy (Starting...)`
- Busy: `⟳ Groovy` (with spin animation)
- Error: `✕ Groovy (Error)`
- Terminated: `⊘ Groovy (Stopped)`

Clicking the status bar shows a quick-pick menu with restart/terminate options.

### Path Utilities (`pathUtils.ts`)

`normalizePath()` extracts the parent directory from a file URI path,
handling the Windows drive-letter quirk where VS Code URIs look like
`/C:/Users/project/file.groovynb`.

---

## 7. Groovy Side -- The REPL Backend

### Kernel.groovy -- The Main Loop

This is the heart of the backend.  Let's walk through it step by step.

#### Initialization (constructor)

```groovy
Kernel(InputStream in, OutputStream out, OutputStream err) {
    this.stdin = in
    this.out = new FlushingWriter(new PrintStream(out, true))
    this.errPrint = new PrintStream(err, true)
    this.shell = createShell()
}
```

**Why inject streams?** The Kernel is a pure black box: it reads code from
`stdin` and writes output to `out`.  By taking streams as constructor
parameters, the Kernel is testable without touching `System.out`.
Errors go to the separate `errPrint` stream (mapped to `System.err` in
production).  `static main` handles OS integration — it passes `System.in`,
`System.out`, and `System.err`, and installs the SIGINT handler.

**Why `warmUpJsonService()`?** Groovy's `FastStringService` (the JSON
backend) is loaded via `java.util.ServiceLoader`, which uses the current
thread's context classloader (TCCL).  The service is held in a `static final`
field inside `FastStringUtils$ServiceHolder`, initialized by the JVM's
`<clinit>` lock -- so it runs exactly once, on whichever thread triggers
class initialization first.

The problem: when user code calls `.stream().parallel()`, Groovy closures
run on ForkJoinPool (FJP) worker threads whose TCCL cannot resolve the
service files.  If the first `JsonSlurper` usage happens on an FJP thread,
`ServiceLoader.load()` fails.

The warmup forces `ServiceHolder` initialization on the main thread (which
has the correct TCCL) before ACK is sent and any user code runs.  After
that, all threads read the already-set `INSTANCE` field and never touch
`ServiceLoader` again.  (Added in commit `a40dda0`.)

#### The REPL Loop (`run()`, line 117)

```groovy
void run() {
    Scanner scanner = new Scanner(stdin)
    scanner.useDelimiter(SIGNAL_END_OF_MESSAGE)

    out.print(SIGNAL_READY)
    out.flush()

    try {
        while (!shutdownRequested) {
            if (scanner.hasNext()) {
                String code = scanner.next().strip()
                try {
                    process(code)
                } catch (Exception e) {
                    errPrint.println "Evaluation failed:\n${e.getClass().name}: ..."
                } catch (java.lang.AssertionError e) {
                    errPrint.println "Assertion failed: \n${e.message}"
                } finally {
                    out.print(SIGNAL_END_OF_MESSAGE)
                    out.flush()
                }
            }
        }
    } finally {
        scanner.close()
        executor.shutdown()
    }
}
```

The `finally` block guarantees that ETX is always sent, even on errors --
without it, the TypeScript side would hang forever waiting for the end-of-message
marker.  Output streams directly to `out` during execution via `FlushingWriter`
(every write flushes immediately).  Errors go to `errPrint` (stderr).

#### Code Execution (`process()`, line 171)

```groovy
private void process(String code) {
    assert code, "Code is empty"
    assert !code.contains("System.exit"), "Refusing to call System.exit"

    code = preprocessCommand(code)

    currentFuture = executor.submit {
        shell.parse(code).run()
    }

    try {
        currentFuture.get()
    } catch (CancellationException e) {
        out.println "Execution cancelled"
    }
}
```

Key design choices:

1. **`System.exit` is blocked.** The assertion prevents accidental kernel
   shutdown.  `Runtime.halt()` bypasses this -- see [Gotchas](#13-gotchas--known-issues).

2. **Code runs on a single-threaded executor.** This gives us cancellation
   via `Future.cancel(true)`.  The `@ThreadInterrupt` AST transformation
   (applied in `createShell()`) makes Groovy check for thread interruption
   at loop boundaries and statement boundaries.

3. **State is preserved between cells.** The `GroovyShell` instance is reused,
   so `x = 42` in one cell is available in the next.

#### Stack Trace Compaction (`compactStackTrace()`, line 146)

Groovy generates deep stack traces with many internal frames from
`org.codehaus.groovy.*` and `groovy.lang.*`.  The `compactStackTrace()`
method filters these out, leaving only frames from user code.  Internal
frames are suppressed entirely (not even shown as `...`) to keep error
messages readable.

### MacroHelper.groovy -- Built-in Commands

`MacroHelper` injects convenience functions into the shell's binding:
`p`, `pp`, `tt`, `dir`, `addClasspath`, `grab`, `findClass`, and `help`.

#### How Injection Works

```groovy
MacroHelper(GroovyShell shell) {
    this.shell = shell
    this.out = shell.context.out as PrintWriter
}

void inject() {
    def b = shell.context
    b.setVariable "p", this.&p              // Instance method reference
    b.setVariable "pp", this.&pp
    b.setVariable "tt", this.&tt
    b.setVariable "dir", this.&dir
    b.setVariable "addClasspath", this.&addClasspath
    b.setVariable "grab", this.&grab
    b.setVariable "findClass", this.&findClass
    // ...
}
```

`MacroHelper` is instantiated with a `GroovyShell` reference and wraps its
output writer.  Each command is an instance method, bound as a variable in
the shell's `Binding` via `this.&methodName`.  This means `p "hello"` in a
cell calls `macroHelper.p("hello")`, which writes to the shell's `out`.

#### The `@Help` Annotation System

```groovy
@Help(category="Output", desc="Pretty-print as YAML", example='pp [a: 1]')
void pp(Object... v) { ... }
```

The `@Help` annotation provides metadata for the `help` command.  The
`printHelpOverview()` and `printHelpDetail()` methods use reflection to
read annotations and generate formatted help text.

#### Command Reference

| Command | Category | What It Does |
|---|---|---|
| `p args...` | Output | Print arguments space-separated |
| `pp args...` | Output | Pretty-print as YAML (strips transient/static fields) |
| `tt data [, cols]` | Output | Render ASCII table from list of maps |
| `dir obj` | Exploration | Inspect object members, sorted by inheritance depth |
| `findClass name` | Exploration | Search classpath JARs for a class by short name |
| `addClasspath dir` | Dependencies | Add directory to classloader (relative to .groovynb) |
| `grab coords...` | Dependencies | Fetch Maven dependencies via Grape |
| `help [cmd]` | Meta | Show help overview or detail for a command |

#### Startup Hook: groovysh.rc

`MacroHelper.loadGroovyshRc()` (line 41) evaluates `~/.groovy/groovysh.rc`
if it exists.  This lets users define custom variables, imports, or macros
that are available in every notebook session.

### PrettyPrintHelper.groovy -- YAML Output

A small utility that converts objects to YAML via `groovy.yaml.YamlBuilder`.

`stripTransients()` (line 8) recursively converts objects to maps, stripping:
- `transient` fields (via `Modifier.isTransient`)
- `static` fields
- Synthetic fields (names containing `$`)
- JDK classes (package starts with `java.` or `javax.`)

This produces clean YAML output suitable for exploration and debugging.

---

## 8. Notebook File Format (.groovynb)

A `.groovynb` file is a JSON document with this schema:

```json
{
  "schemaVersion": "1.1.0",
  "cells": [
    {
      "id": "z9n0rrd5",
      "kind": 2,
      "language": "groovy",
      "value": "println 'hello'"
    },
    {
      "id": "abc12345",
      "kind": 1,
      "language": "markdown",
      "value": "# My Notebook"
    },
    {
      "id": "def67890",
      "kind": 2,
      "language": "groovy",
      "value": "pp [a: 1]",
      "outputs": [
        {
          "outputs": [
            {
              "mime": "application/vnd.code.notebook.stdout",
              "value": "a: 1\n",
              "encoding": "text"
            }
          ]
        }
      ]
    }
  ]
}
```

- `kind`: `1` = Markdown, `2` = Code
- `id`: Random 8-char string, stable across saves
- `outputs`: Only present for code cells with output
- When `groovyNotebook.compressOutputs` is true, outputs exceeding 1 KB are
  gzip-compressed and base64-encoded with `"compression": "gzip"`

---

## 9. Testing

The project has two independent test suites.

### TypeScript Tests (Mocha + ts-node)

```
src/test/
├── process.test.ts          # Subprocess spawn/execute race condition tests
├── session.test.ts          # Registry disposal and subscription tests
├── types.test.ts            # Type contract tests
├── configValidation.test.ts # Input validation tests
└── pathUtils.test.ts        # Cross-platform path normalization
```

Run with: `npm run test:ts`

The tests in `process.test.ts` verify the concurrency semantics of the wire
protocol using mock Node.js processes.  They confirm that promises resolve
exactly once even when ETX and exit events arrive simultaneously.

Configuration: `.mocharc.json` uses `ts-node/esm` loader for direct
TypeScript execution without a pre-compile step.

### Groovy Tests (JUnit 4)

```
src/groovy/
├── KernelPipeTest.groovy          # Black-box pipe tests: REPL loop, streaming, cancellation, stderr (13 tests)
├── KernelTest.groovy              # Kernel.preprocessCommand() for help/help aliases (1 test)
├── MacroHelperTest.groovy         # p/pp/tt/dir/renderTable helpers (23 tests)
├── PrettyPrintHelperTest.groovy   # YAML serialization (8 tests)
├── CompactStackTraceTest.groovy   # Stack trace filtering (1 test)
├── WireProtocolTest.groovy        # Protocol constants and behavior (2 tests)
└── TestPerson.groovy              # Test fixture class
```

Run with: `npm run test:groovy` (or `cd src/groovy && groovy KernelPipeTest.groovy`)

The test runner (`scripts/test-groovy.mjs`) discovers `*Test.groovy` files
and runs each one via `execFileSync("groovy", [file])`.  It skips gracefully
if `groovy` is not found on PATH.

**Note on Kernel instantiation**: Because `Kernel` takes three streams
(`InputStream`, `OutputStream`, `OutputStream`) as constructor parameters,
pipe tests provide `PipedInputStream`/`PipedOutputStream` pairs for full
duplex communication with the Kernel under test.

### Running Everything

```bash
npm test               # TS tests first, then Groovy tests
```

Both suites must pass.  The Groovy tests are skipped if `groovy` is not
installed (not an error).

---

## 10. Debugging

### Extension Logs

All extension activity is logged to VS Code's Output panel:

**View**: `View -> Output -> "Groovy Notebook" from dropdown`

The logger (`logger.ts`) timestamps every message and includes the component
name:

```
14:23:45.678 [Process] Spawning Groovy process: { groovyPath: "groovy", ... }
14:23:45.890 [Process] SIGNAL_READY received! Process is ready.
14:23:46.001 [Session] run: status set to busy, executing code
14:23:46.123 [Process] executeCode: SIGNAL_END_OF_MESSAGE received, resolving
```

### Debugging the Extension (TypeScript)

1. Open the project in VS Code
2. Set breakpoints in `src/typescript/*.ts`
3. Press **F5** to launch Extension Development Host
4. Open a `.groovynb` file in the new window
5. Breakpoints will hit in the original window

The launch config (`.vscode/launch.json`) uses `npm: watch` as a pre-launch
task for auto-recompilation.

### Debugging the Groovy Backend

There's no built-in debugger for the Groovy process.  Strategies:

1. **Add `println` statements** in `Kernel.groovy` -- they'll appear in the
   Output panel (since stdout is piped to the extension).

2. **Run Kernel.groovy directly** to test the REPL loop in isolation:
   ```bash
   cd src/groovy
   echo 'println 1+1' | groovy -cp kernel-helpers.jar Kernel.groovy
   ```

3. **Check stderr output** in the extension logs -- the process listener
   logs stderr chunks.

### Common Debugging Scenarios

| Symptom | Where to Look |
|---|---|
| Kernel won't start | Output panel, process.ts spawn(), check `groovy --version` |
| Cell hangs forever | process.ts executeCode(), check if ETX is sent by Groovy |
| "Process exited unexpectedly" | Kernel.groovy process(), check for unhandled exceptions |
| Output not shown | kernel.ts handleOutputs(), check if stdout is empty |
| Interrupt doesn't work | Kernel.groovy installSignalHandler(), check SIGINT handling |
| Classpath issues | Remember: cwd is the .groovynb file's directory |

---

## 11. Building & Releasing

### Build the Extension

```bash
npm run compile    # TypeScript + Groovy helpers
npm run lint       # Check code style
npm test           # Run all tests
```

### Package as .vsix

```bash
npm run pack       # Creates groovy-notebook-X.Y.Z.vsix
```

The `.vscodeignore` file controls what's included:
- Excludes: source maps, TypeScript sources, test files, .groovy files
  (except `Kernel.groovy` and `kernel-helpers.jar`), .vsix files
- Includes: compiled JS in `out/`, `Kernel.groovy`, `kernel-helpers.jar`

### Local Testing (Dogfooding)

```bash
npm run dogfood    # Pack + install into your VS Code
```

### Release Checklist

1. Update `version` in `package.json`
2. `npm run compile`
3. `npm test`
4. `npm run pack`
5. Install the `.vsix` locally and manually test:
   - Create a new notebook
   - Run cells with various code
   - Test interrupt (long-running cell)
   - Test restart and terminate
   - Test export as Groovy
6. Publish to VS Code Marketplace

---

## 12. Common Development Tasks

### Adding a New Built-in Command

1. Add an instance method to `MacroHelper.groovy` with the `@Help` annotation:

```groovy
@Help(category="Output", desc="My new command", example='myCmd "hello"')
void myCmd(String arg) {
    out.println "You said: $arg"
}
```

2. Bind it in `inject()`:

```groovy
b.setVariable "myCmd", this.&myCmd
```

3. Rebuild the helpers jar: `npm run build:groovy`

4. Add tests in `MacroHelperTest.groovy`.

### Adding a New VS Code Command

1. Register the command in `package.json` under `contributes.commands`.
2. Implement the handler in `commands.ts` (or `extension.ts` for
   notebook-creation commands).
3. Add a menu entry in `contributes.menus` if it should appear in the
   notebook toolbar.

### Modifying the Wire Protocol

**Think carefully before doing this.** The protocol's simplicity is a feature.
If you need richer messaging, consider:

1. Adding a JSON-based framing layer (keep ACK/ETX for compatibility)
2. Using a separate communication channel (e.g., a temp file for large data)

If you do change the protocol, update:
- `src/typescript/protocol.ts` (TypeScript constants)
- `Kernel.groovy` (Groovy constants: lines 38-39)
- `WireProtocolTest.groovy` (protocol tests)
- This document

### Adding Configuration Settings

1. Add the setting to `package.json` under `contributes.configuration.properties`.
2. Add a constant in `config.ts` for the setting key.
3. Add an accessor function in `config.ts`.
4. Add validation in `configValidation.ts` (if needed).
5. Add tests in the appropriate test file.

---

## 13. Gotchas & Known Issues

### `Runtime.halt()` Kills the Kernel

The assertion in `process()` blocks `System.exit()`.  `Runtime.halt(0)`
bypasses all assertions and shutdown hooks -- there is no defense against it
on the Groovy side.  The TypeScript side detects the process exit and shows
an error.

### Process Exit Detection Is Imperfect

If the Groovy process dies abnormally (OOM, segfault), the TypeScript side
may not detect it immediately.  The detection relies on the `exit` event
from `child_process`, which may not fire in all edge cases.  The health
check in `isProcessAlive()` (process.ts:96) uses `kill(pid, 0)` to probe
the process.

### Kernel Instantiation in Tests

Tests that instantiate `Kernel` directly pass in-memory streams and must
shut down the executor service to avoid thread leaks.

### Partial-Line Buffering (Resolved)

Output now streams to VS Code in real time via `FlushingWriter`, which
flushes on every `write()` call (not just on `println()`).  This was
previously a known issue where bare `print()` without a trailing newline
would not flush immediately.

### Classpath Is Relative to the Notebook

`addClasspath 'lib'` resolves `./lib` relative to the `.groovynb` file,
not the workspace root.  Moving the notebook file will break relative
classpath entries.  Use absolute paths for portable notebooks.

### Groovy Helper Classes Must Be Pre-compiled

`MacroHelper.groovy` and `PrettyPrintHelper.groovy` are compiled into
`kernel-helpers.jar` because `Kernel.groovy` needs them on the classpath
at startup.  The build script (`npm run build:groovy`) handles this.  If
you add new helper files, update the `build:groovy` script in `package.json`.

### Windows Path Quirks

VS Code gives file URIs with leading slashes on Windows
(`/C:/Users/project/file.groovynb`).  The `normalizePath()` function in
`pathUtils.ts` strips the leading slash before the drive letter.  Always
use `normalizePath()` when working with file paths in the TypeScript side.

---

## Appendix: Dependency Injection Flow

Understanding how objects are created and wired together is key to
navigating the codebase:

```
extension.ts::activate()
    |
    |-- initLogger() -> OutputChannel
    |
    |-- getGroovyPath() -> string (from settings)
    |
    |-- baseConfig = { groovyPath, evalScriptPath, classpath }
    |
    |-- new SessionRegistry(baseConfig)
    |       |
    |       |-- getOrCreate(uri, cwd)
    |       |       |
    |       |       |-- new GroovySession(uri, { ...baseConfig, cwd })
    |       |               |
    |       |               |-- ensureStarted()
    |       |               |       |
    |       |               |       |-- new GroovyProcess(config)
    |       |               |               |
    |       |               |               |-- start() -> spawn() -> ChildProcess
    |       |               |               |-- run(code) -> executeCode() -> result
    |       |               |               |-- interrupt() -> SIGINT
    |       |               |               |-- terminate() -> killProcess()
    |       |
    |       |-- restart(uri) -> session.restart() -> process.terminate()
    |       |-- terminate(uri) -> session.terminate()
    |
    |-- new GroovyKernelController(registry)
    |       |
    |       |-- execute(cells) -> queue -> executeCell(cell)
    |       |       |-- registry.getOrCreate(uri, cwd) -> session
    |       |       |-- session.run(code) -> result
    |       |       |-- handleOutputs(execution, result)
    |       |
    |       |-- interrupt() -> session.interrupt()
    |
    |-- new KernelStatusBar(registry)
    |       |-- onDidChangeStatus -> updateDisplay()
    |
    |-- registerKernelCommands(context, registry)
    |-- new GroovyContentSerializer()
```

All objects implement `vscode.Disposable` and are registered in
`context.subscriptions` for proper cleanup when the extension deactivates.
