# Interrupt Cell Execution with Context Preservation

**Date:** 2026-03-23
**Status:** Draft
**Branch:** feature/interrupt-cell

## Problem

Currently, interrupting a cell execution sends SIGINT to the Groovy process, which kills it. All context (variables, imports, class definitions) is lost. Users must re-run all cells from the beginning.

## Goal

Allow users to interrupt cell execution while preserving the GroovyShell context, so subsequent cells can continue using existing variables and definitions.

## Design

### Architecture

```
VS Code --[SIGINT]--> Groovy Process
                           |
                           v
                    Signal Handler
                           |
            +--------------+--------------+
            |                             |
      Future exists?                 No Future?
            |                             |
            v                             v
    Future.cancel(true)            Process exits
    Thread.interrupt()             (current behavior)
            |
            v
    Cell throws InterruptedException
    Shell alive, context preserved
```

### Components

#### 1. Kernel.groovy - Signal Handler + ExecutorService

```groovy
import sun.misc.Signal
import java.util.concurrent.*

class Kernel {
    private ExecutorService executor = Executors.newSingleThreadExecutor()
    private Future<?> currentFuture = null
    private volatile boolean shutdownRequested = false

    Kernel() {
        // Install SIGINT handler
        Signal.handle(new Signal("INT")) { sig ->
            if (currentFuture != null && !currentFuture.done) {
                currentFuture.cancel(true)
            } else {
                shutdownRequested = true
            }
        }
        // ... rest of init
    }

    private String process(String code) {
        currentFuture = executor.submit {
            shell.parse(code).run()
        }
        try {
            currentFuture.get()
        } catch (InterruptedException e) {
            println "Cell execution interrupted"
        } catch (CancellationException e) {
            println "Cell execution cancelled"
        } finally {
            currentFuture = null
        }
    }
}
```

#### 2. Kernel.groovy - @ThreadInterrupt for CPU-bound loops

Apply `@ThreadInterrupt` AST transformation to all user code via CompilerConfiguration:

```groovy
import org.codehaus.groovy.control.CompilerConfiguration
import org.codehaus.groovy.control.customizers.ASTTransformationCustomizer
import groovy.transform.ThreadInterrupt

private GroovyShell resetShell() {
    def config = new CompilerConfiguration()
    config.addCompilationCustomizers(
        new ASTTransformationCustomizer(ThreadInterrupt)
    )

    def shell = new GroovyShell(
        shellBinding,
        new GroovyClassLoader(),
        config
    )
    MacroHelper.injectMacroses(shell)
    return shell
}
```

This injects `Thread.currentThread().isInterrupted()` checks into:
- `for` loops
- `while` loops
- Start of closures
- Start of methods

#### 3. TypeScript - Interrupt Tracking

**session.ts:**
```typescript
private interrupted = false;

interrupt(): void {
    this.interrupted = true;
    this.process?.interrupt();
}

wasInterrupted(): boolean {
    return this.interrupted;
}

async run(code): Promise<ProcessResult> {
    this.interrupted = false;
    // ... existing code
}
```

**kernel.ts:**
```typescript
private handleOutputs(execution, result, error) {
    if (!this.isCurrentExecution(execution)) return;

    if (error) {
        const wasInterrupted = this.currentSession?.wasInterrupted();
        if (wasInterrupted) {
            this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr('Execution interrupted'));
            execution.end(false, Date.now());
        } else {
            this.handleError(execution, error);
        }
    } else if (result) {
        this.handleSuccess(execution, result);
    }
}
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Cell has `while(true){}` | `@ThreadInterrupt` injects interrupt checks; loop throws `InterruptedException` |
| Cell doing blocking I/O | Java I/O is interruptible; thread receives `InterruptedException` |
| User interrupts twice | First: cancels Future; Second: no Future, process exits |
| Cell throws exception | Normal error flow; context preserved |
| Kernel idle, user terminates | SIGINT with no Future -> process exits |

### Limitations

- Native code (JNI) cannot be interrupted
- Some blocking operations may not respond to interrupt (e.g., `Socket` I/O without timeout)

## Files Changed

| File | Change |
|------|--------|
| `src/groovy/Kernel.groovy` | Add ExecutorService, Signal handler, @ThreadInterrupt |
| `src/typescript/session.ts` | Add interrupt tracking |
| `src/typescript/kernel.ts` | Handle interrupted state in output handler |

## Testing

1. **Unit tests** for interrupt tracking in session/kernel
2. **Integration tests** in KernelTest.groovy:
   - Interrupt during infinite loop
   - Interrupt during Thread.sleep
   - Verify context preserved after interrupt
   - Double-interrupt kills process

## Dependencies

- `sun.misc.Signal` - Available in HotSpot JVM (OpenJDK, Oracle JDK)
- `groovy.transform.ThreadInterrupt` - Standard Groovy since 1.8.0
