# Streaming Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cell output stream in real-time to VS Code's notebook UI as it's produced, by making Kernel a pure black box with injected streams.

**Architecture:** Kernel accepts `InputStream`/`OutputStream` in constructor, wires Binding output to the injected stream, and exposes `interrupt()`/`shutdown()` for external lifecycle control. No `System.setOut`/`System.setErr`, no `ByteArrayOutputStream`, no signal handler inside Kernel. Output flows directly to the pipe. TypeScript side adds an `onOutput` callback to surface streaming chunks via `replaceOutput()`.

**Tech Stack:** Groovy (Kernel backend), TypeScript / VS Code Notebook API (extension)

---

## File Structure

| File                               | Action         | Purpose                                                          |
| ---------------------------------- | -------------- | ---------------------------------------------------------------- |
| `src/groovy/Kernel.groovy`           | Major refactor | Injected streams, no ByteArrayOutputStream, externalized signals |
| `src/groovy/KernelPipeTest.groovy`   | Create         | Black-box pipe-based tests                                       |
| `src/groovy/KernelTest.groovy`       | Modify         | Simplify to preprocessCommand only                               |
| `src/groovy/WireProtocolTest.groovy` | Modify         | Remove internal-state tests, keep constant/scanner tests         |
| `src/typescript/types.ts`            | Modify         | Add `onOutput` callback to `Executable`                              |
| `src/typescript/process.ts`          | Modify         | Fire callback per stdout chunk                                   |
| `src/typescript/session.ts`          | Modify         | Thread callback through                                          |
| `src/typescript/kernel.ts`           | Modify         | Streaming UI with `replaceOutput`, skip re-display                 |
| `HACKING.md`                         | Modify         | Update wire protocol and architecture docs                       |
| `AGENTS.md`                          | Modify         | Update key files table and known issues                          |

---

### Task 1: Write black-box pipe test (fails to compile)

**Files:**
- Create: `src/groovy/KernelPipeTest.groovy`

- [ ] **Step 1: Create test file with harness and basic test**

```groovy
import org.junit.Test
import org.junit.Before
import org.junit.After

class KernelPipeTest {
    private static final String SIGNAL_END_OF_MESSAGE = '\3'

    private PipedOutputStream testWrite
    private PipedInputStream kernelRead
    private PipedOutputStream kernelWrite
    private PipedInputStream testRead
    private Kernel kernel
    private Thread kernelThread
    private PrintStream savedOut

    @Before
    void setUp() {
        testWrite = new PipedOutputStream()
        kernelRead = new PipedInputStream(testWrite)
        kernelWrite = new PipedOutputStream()
        testRead = new PipedInputStream(kernelWrite)

        savedOut = System.out
        System.setOut(new PrintStream(kernelWrite, true))

        kernel = new Kernel(kernelRead, kernelWrite)
        kernelThread = Thread.start { kernel.run() }

        int ack = testRead.read()
        assert ack == 6 : "Expected ACK (0x06), got: ${ack}"
    }

    @After
    void tearDown() {
        kernel.shutdown()
        testWrite.close()
        kernelThread?.join(5000)
        System.setOut(savedOut)
    }

    private String send(String code) {
        testWrite.write((code + SIGNAL_END_OF_MESSAGE).bytes)
        testWrite.flush()

        def buf = new ByteArrayOutputStream()
        def readBuf = new byte[4096]
        while (true) {
            int n = testRead.read(readBuf)
            if (n == -1) throw new IllegalStateException("Stream closed before ETX")
            buf.write(readBuf, 0, n)
            String str = buf.toString("UTF-8")
            if (str.contains(SIGNAL_END_OF_MESSAGE)) {
                return str.replace(SIGNAL_END_OF_MESSAGE, "").strip()
            }
        }
    }

    @Test
    void testSimpleOutput() {
        def result = send("println 'Hello, World!'")
        assert result.contains("Hello, World!")
    }
}
```

- [ ] **Step 2: Verify test fails to compile**

Run: `cd src/groovy && groovy KernelPipeTest.groovy`
Expected: Compilation error — `Kernel` has no `(InputStream, OutputStream)` constructor

---

### Task 2: Refactor Kernel to injected streams + externalized signals

**Files:**
- Modify: `src/groovy/Kernel.groovy`

- [ ] **Step 1: Replace fields and constructor**

Remove `scriptOutputBuf` and `originalStdout`. Add `stdin` and `out`:

```groovy
private final InputStream stdin
private final PrintStream out
private GroovyShell shell
private final ExecutorService executor = Executors.newSingleThreadExecutor()
private Future currentFuture = null
private volatile boolean shutdownRequested = false

Kernel(InputStream in, OutputStream out) {
    this.stdin = in
    this.out = new PrintStream(out, true)
    this.shell = createShell()
    warmUpJsonService()
}
```

- [ ] **Step 2: Replace `resetShell()` with `createShell()`**

Removes ByteArrayOutputStream and System.setOut/setErr. Uses `out` directly:

```groovy
private GroovyShell createShell() {
    Binding shellBinding = new Binding(out: new PrintWriter(out, true))
    def config = new CompilerConfiguration()
    config.addCompilationCustomizers(
        new ASTTransformationCustomizer(ThreadInterrupt)
    )
    def shell = new GroovyShell(
        this.class.classLoader,
        shellBinding,
        config
    )
    MacroHelper.injectMacroses(shell)
    return shell
}
```

- [ ] **Step 3: Refactor `run()` — no args, uses `out` for everything**

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
                    out.println "Evaluation failed:\n${e.getClass().name}: ${e.message}\n${compactStackTrace(e)}"
                } catch (java.lang.AssertionError e) {
                    out.println "Assertion failed: \n${e.message}"
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

- [ ] **Step 4: Refactor `process()` to void, use `out.println`**

```groovy
private void process(String code) {
    assert code, "Code is empty"
    assert !code.isEmpty(), "Code is empty"
    assert !code.contains("System.exit"), "Refusing to call `System.exit`"

    code = preprocessCommand(code)

    currentFuture = executor.submit {
        shell.parse(code).run()
    }

    try {
        currentFuture.get()
    } catch (InterruptedException e) {
        out.println "Execution interrupted"
    } catch (CancellationException e) {
        out.println "Execution cancelled"
    } catch (ExecutionException e) {
        throw e.cause ?: e
    } finally {
        currentFuture = null
    }
}
```

- [ ] **Step 5: Add `interrupt()` / `shutdown()`, externalize signal handler, make `preprocessCommand` static**

```groovy
boolean interrupt() {
    if (currentFuture != null && !currentFuture.done) {
        currentFuture.cancel(true)
        return true
    }
    return false
}

void shutdown() {
    shutdownRequested = true
}

static String preprocessCommand(String code) {
    if (code == '/help' || code == 'help') return 'help()'
    if (code.startsWith('/help ')) return "help('${code.substring(6).strip()}')"
    return code
}

static void main(args) {
    System.setErr(System.out)
    def kernel = new Kernel(System.in, System.out)
    installSignalHandler(kernel)
    kernel.run()
}

private static void installSignalHandler(Kernel kernel) {
    try {
        def signalClass = Class.forName('sun.misc.Signal')
        def signalHandlerClass = Class.forName('sun.misc.SignalHandler')
        def signalConstructor = signalClass.getConstructor(String)
        def signal = signalConstructor.newInstance('INT')
        def handler = signalHandlerClass.cast(
            Proxy.newProxyInstance(
                Kernel.classLoader,
                [signalHandlerClass] as Class[],
                { proxy, method, args ->
                    if (method.name == 'handle') {
                        if (!kernel.interrupt()) {
                            kernel.shutdown()
                        }
                    }
                    null
                } as InvocationHandler
            )
        )
        def handleMethod = signalClass.getMethod('handle', signalClass, signalHandlerClass)
        handleMethod.invoke(null, signal, handler)
    } catch (ClassNotFoundException | Exception e) {
        // Signal handling not available
    }
}
```

- [ ] **Step 6: Delete `cleanupOutput()` and `cancelCurrent()`**

Remove these methods entirely.

- [ ] **Step 7: Run black-box test**

Run: `cd src/groovy && groovy KernelPipeTest.groovy`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/groovy/Kernel.groovy src/groovy/KernelPipeTest.groovy
git commit -m "refactor: Kernel as black box with injected streams, streaming output"
```

---

### Task 3: Expand black-box tests

**Files:**
- Modify: `src/groovy/KernelPipeTest.groovy`

- [ ] **Step 1: Add comprehensive tests**

```groovy
@Test
void testArithmetic() {
    def result = send("println 2 + 2")
    assert result.contains("4")
}

@Test
void testVariableStatePreserved() {
    send("x = 42")
    def result = send("println x * 2")
    assert result.contains("84")
}

@Test
void testMultiLineCode() {
    def result = send("""
        def greet(name) { "Hello, \${name}!" }
        println greet('Groovy')
    """)
    assert result.contains("Hello, Groovy!")
}

@Test
void testExceptionInUserCode() {
    def result = send("throw new RuntimeException('test error')")
    assert result.contains("test error")
}

@Test
void testSystemExitBlocked() {
    def result = send("System.exit(0)")
    assert result.contains("System.exit")
}

@Test
void testEmptyCodeReturnsEmpty() {
    def result = send("")
    assert result != null
}

@Test
void testMultipleSequentialCalls() {
    assert send("println 'first'").contains("first")
    assert send("println 'second'").contains("second")
    assert send("println 'third'").contains("third")
}

@Test
void testHelpCommand() {
    def result = send("help")
    assert result.size() > 0
}

@Test
void testClosureAndCollection() {
    def result = send("""
        def list = [1, 2, 3]
        println list.collect { it * 2 }
    """)
    assert result.contains("[2, 4, 6]")
}
```

- [ ] **Step 2: Run tests**

Run: `cd src/groovy && groovy KernelPipeTest.groovy`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/groovy/KernelPipeTest.groovy
git commit -m "test: add comprehensive black-box pipe tests for Kernel"
```

---

### Task 4: Update existing Groovy tests

**Files:**
- Modify: `src/groovy/KernelTest.groovy`
- Modify: `src/groovy/WireProtocolTest.groovy`

- [ ] **Step 1: Simplify KernelTest.groovy to preprocessCommand only**

```groovy
import org.junit.Test

class KernelTest {
    @Test
    void testPreprocessHelp() {
        assert Kernel.preprocessCommand('help') == 'help()'
        assert Kernel.preprocessCommand('/help') == 'help()'
        assert Kernel.preprocessCommand('/help pp') == "help('pp')"
        assert Kernel.preprocessCommand('/help  pp  ') == "help('pp')"
        assert Kernel.preprocessCommand('println help') == 'println help'
    }
}
```

- [ ] **Step 2: Simplify WireProtocolTest.groovy**

```groovy
import org.junit.Test

class WireProtocolTest {
    private static final String SIGNAL_READY = '\6'
    private static final String SIGNAL_END_OF_MESSAGE = '\3'

    @Test
    void testSignalConstants() {
        assert SIGNAL_READY.charAt(0) == 6
        assert SIGNAL_END_OF_MESSAGE.charAt(0) == 3
    }

    @Test
    void testScannerDelimiterIsEndOfMessage() {
        def testInput = "code1${SIGNAL_END_OF_MESSAGE}code2${SIGNAL_END_OF_MESSAGE}"
        def scanner = new Scanner(new ByteArrayInputStream(testInput.bytes))
        scanner.useDelimiter(SIGNAL_END_OF_MESSAGE)

        assert scanner.hasNext()
        assert scanner.next() == "code1"
        assert scanner.hasNext()
        assert scanner.next() == "code2"
    }
}
```

- [ ] **Step 3: Run all Groovy tests**

Run: `npm run test:groovy`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/groovy/KernelTest.groovy src/groovy/WireProtocolTest.groovy
git commit -m "test: simplify Groovy tests for black-box Kernel API"
```

---

### Task 5: Add streaming callback to TypeScript side

**Files:**
- Modify: `src/typescript/types.ts`
- Modify: `src/typescript/process.ts`
- Modify: `src/typescript/session.ts`
- Modify: `src/typescript/kernel.ts`

- [ ] **Step 1: Update `Executable` interface in types.ts**

```typescript
export interface Executable {
    run(code: string, onOutput?: (chunk: string) => void): Promise<ExecutionResult>;
    interrupt(): void;
}
```

- [ ] **Step 2: Update `process.ts` — `run()` and `executeCode()`**

Update `run()` signature and pass callback:
```typescript
public async run(code: string, onOutput?: (chunk: string) => void): Promise<ProcessResult> {
    // ... existing body, change executeCode call to:
    const result = await this.executeCode(code, onOutput);
    // ...
}
```

Update `executeCode()` signature:
```typescript
private executeCode(code: string, onOutput?: (chunk: string) => void): Promise<ProcessResult> {
```

Update `onStdout` handler to fire callback per chunk:
```typescript
const onStdout = (chunk: Buffer) => {
    log('Process', 'executeCode: stdout chunk:', formatBuffer(chunk, CONFIG.LOG_PREVIEW_LONG_LENGTH));
    stdoutChunks.push(chunk);
    if (checkBufferLimit(chunk)) {
        if (settled) return;
        cleanup();
        reject(this.createError(
            `Output buffer size exceeded limit of ${GroovyProcess.MAX_BUFFER_SIZE} bytes`,
            Buffer.concat(stdoutChunks).toString(),
            Buffer.concat(stderrChunks).toString()
        ));
        return;
    }
    if (chunk.includes(SIGNAL_END_OF_MESSAGE)) {
        if (settled) return;
        const text = chunk.toString().replace(SIGNAL_END_OF_MESSAGE, '');
        if (text && onOutput) onOutput(text);
        cleanup();
        log('Process', 'executeCode: SIGNAL_END_OF_MESSAGE received, resolving');
        const stdout = Buffer.concat(stdoutChunks)
            .toString()
            .replace(SIGNAL_END_OF_MESSAGE, '')
            .trim();
        const stderr = Buffer.concat(stderrChunks).toString();
        resolve({ stdout, stderr, exitCode });
    } else {
        if (onOutput) onOutput(chunk.toString());
    }
};
```

- [ ] **Step 3: Update `session.ts` — thread callback through**

```typescript
public async run(code: string, onOutput?: (chunk: string) => void): Promise<ProcessResult> {
    // ... existing code unchanged until the process.run call:
    const result = await this.process!.run(code, onOutput);
    // ... rest unchanged
}
```

- [ ] **Step 4: Update `kernel.ts` — streaming UI**

Update `executeCell()`:
```typescript
private async executeCell(cell: vscode.NotebookCell): Promise<void> {
    let execution: vscode.NotebookCellExecution | null = null;

    try {
        const setup = await this.setupExecution(cell);
        execution = setup.execution;
        const session = setup.session;

        let streamedOutput = '';
        let streamed = false;

        const onOutput = (chunk: string) => {
            streamed = true;
            streamedOutput += chunk;
            execution!.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stdout(streamedOutput)
                ])
            ]);
        };

        const result = await session.run(cell.document.getText(), onOutput);
        this.handleOutputs(execution, result, streamed);
    } catch (error) {
        if (execution) {
            this.handleOutputs(execution, null, false, error);
        }
    } finally {
        if (execution) {
            this.cleanupExecution(execution);
        }
    }
}
```

Remove `runAndGetResult` method (inlined above).

Update `handleOutputs()`:
```typescript
private handleOutputs(execution: vscode.NotebookCellExecution, result: ExecutionResult | null, streamed: boolean, error?: unknown): void {
    if (!this.isCurrentExecution(execution)) return;

    if (error) {
        const session = this.currentSession as GroovySession | undefined;
        if (session?.wasInterrupted()) {
            this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr('Execution interrupted'));
            execution.end(false, Date.now());
        } else {
            this.handleError(execution, error, streamed);
        }
    } else if (result) {
        this.handleSuccess(execution, result, streamed);
    }
}
```

Update `handleSuccess()` — skip stdout re-display when already streamed:
```typescript
private handleSuccess(execution: vscode.NotebookCellExecution, result: ExecutionResult, streamed: boolean): void {
    if (result.stderr?.trim()) {
        this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr(result.stderr));
    }
    if (!streamed && result.stdout?.trim()) {
        this.appendOutput(execution, vscode.NotebookCellOutputItem.stdout(result.stdout));
    }
    execution.end(true, Date.now());
}
```

Update `handleError()` — skip stdout re-display when already streamed:
```typescript
private handleError(execution: vscode.NotebookCellExecution, error: unknown, streamed: boolean): void {
    const processError = error as ProcessError;
    const message = processError.message || 'Unknown error';

    if (!streamed && processError.stdout?.trim()) {
        this.appendOutput(execution, vscode.NotebookCellOutputItem.stdout(processError.stdout));
    }

    this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr(processError.stderr || message));
    execution.end(false, Date.now());
}
```

- [ ] **Step 5: Run TypeScript tests and compile**

Run: `npm run test:ts && npm run compile && npm run lint`
Expected: All pass, clean build

- [ ] **Step 6: Commit**

```bash
git add src/typescript/types.ts src/typescript/process.ts src/typescript/session.ts src/typescript/kernel.ts
git commit -m "feat: add streaming output callback for real-time cell output"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All TS and Groovy tests PASS

- [ ] **Step 2: Build extension**

Run: `npm run compile && npm run lint`
Expected: Clean build, no lint errors

- [ ] **Step 3: Manual smoke test**

1. F5 to launch Extension Development Host
2. Open `.groovynb` file
3. Run `println 'hello'` — output appears
4. Run `Thread.sleep(2000); println 'done'` — output after 2s
5. Run long loop with `println` — output streams incrementally
6. Test interrupt (long-running cell + stop button)
7. Test restart kernel

---

### Task 7: Update documentation

**Files:**
- Modify: `HACKING.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update HACKING.md**

- Remove "No Streaming Output" from Gotchas (section 13)
- Update Kernel constructor description (section 7) — injected streams, no ByteArrayOutputStream
- Update wire protocol section (section 5) — note output now streams to pipe directly
- Add note: `System.out.println()` in user code goes to pipe (no redirection by Kernel)

- [ ] **Step 2: Update AGENTS.md**

- Update Key Files table — Kernel.groovy line count changes
- Update Architecture diagram — remove ByteArrayOutputStream
- Update Known Issues — remove streaming limitation
- Add note about Kernel's injected stream constructor

- [ ] **Step 3: Commit**

```bash
git add HACKING.md AGENTS.md
git commit -m "docs: update for streaming output and black-box Kernel"
```
