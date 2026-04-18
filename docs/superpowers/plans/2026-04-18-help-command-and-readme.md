# Help Command + README Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an annotation-based `help` macro to the notebook and rewrite the README to reflect the current extension state.

**Architecture:** A `@Help` annotation is added to `MacroHelper.groovy`. The `help` closure reflects on annotated methods, groups by category, and prints overview or detail. The README is rewritten in-place.

**Tech Stack:** Groovy (annotations, reflection), Markdown

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/groovy/MacroHelper.groovy` | Modify | Add `@Help` annotation, annotate 7 methods, add `help` closure |
| `README.md` | Rewrite | New structure per design spec |
| `src/groovy/MacroHelperTest.groovy` | Modify | Add tests for `help()` and `help("pp")` |

---

### Task 1: Add `@Help` annotation and annotate macro methods

**Files:**
- Modify: `src/groovy/MacroHelper.groovy`

- [ ] **Step 1: Add the `@Help` annotation inside MacroHelper.groovy**

Add this at the top of the file, before the imports (Groovy allows annotations in the same file):

```groovy
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface Help {
    String category()
    String desc()
    String example()
    String output() default ""
}
```

- [ ] **Step 2: Annotate all 7 macro methods**

Add `@Help` annotations to each method:

```groovy
@Help(category="Output", desc="Print arguments space-separated", example='p "x =", 42', output='x = 42')
private static void p(Object... v) {
```

```groovy
@Help(category="Output", desc="Pretty-print as YAML (strips transient/static fields)", example='pp [a: 1, b: [c: 2]]', output='a: 1\nb:\n  c: 2')
private static void pp(Object... v) {
```

```groovy
@Help(category="Output", desc="Render ASCII table from list of maps", example="tt data, 'name age'")
private static void tt(List<Object> data, String columnsToRender = null) {
```

```groovy
@Help(category="Exploration", desc="Inspect object members (fields, properties, methods) sorted by inheritance depth", example='dir "hello"')
static String dir(obj) {
```

```groovy
@Help(category="Exploration", desc="Find fully-qualified class name by short name (searches classpath JARs)", example='findClass "List"', output='[java.util.List]')
private static List<String> findClass(GroovyShell shell, String className) {
```

```groovy
@Help(category="Dependencies", desc="Grab Maven dependencies via Grape (cached in ~/.groovy/grapes)", example='grab "org.apache.commons:commons-lang3:3.17.0"')
private static void grab(GroovyShell shell, String... artifacts) {
```

```groovy
@Help(category="Dependencies", desc="Add directory to classpath (relative to .groovynb file)", example='addClasspath "lib"')
private static void addClasspath(GroovyShell shell, String path) {
```

- [ ] **Step 3: Commit**

```bash
git add src/groovy/MacroHelper.groovy
git commit -m "feat: add @Help annotation to macro methods"
```

---

### Task 2: Add the `help` closure to `injectMacroses`

**Files:**
- Modify: `src/groovy/MacroHelper.groovy`

- [ ] **Step 1: Add help closure and register in binding**

In `injectMacroses()`, add after the `b.setVariable "dir"` line:

```groovy
b.setVariable "help", { String cmd = null ->
    if (cmd) {
        printHelpDetail(cmd)
    } else {
        printHelpOverview()
    }
}
```

- [ ] **Step 2: Add `printHelpOverview` method**

```groovy
private static void printHelpOverview() {
    def methods = MacroHelper.class.declaredMethods.findAll { it.isAnnotationPresent(Help) }
    def grouped = methods.groupBy { it.getAnnotation(Help).category() }
    def categoryOrder = ['Output', 'Exploration', 'Dependencies']
    categoryOrder.each { cat ->
        if (grouped[cat]) {
            println "${cat}:"
            grouped[cat].sort { it.name }.each { m ->
                def ann = m.getAnnotation(Help)
                def name = m.name
                println "  ${name.padRight(20)}${ann.desc()}"
            }
            println ""
        }
    }
    println "Meta:"
    println "  ${'help [cmd]'.padRight(20)}Show this help, or detailed help for a command"
}
```

- [ ] **Step 3: Add `printHelpDetail` method**

```groovy
private static void printHelpDetail(String cmd) {
    def method = MacroHelper.class.declaredMethods.find {
        it.name == cmd && it.isAnnotationPresent(Help)
    }
    if (!method) {
        println "Unknown command: ${cmd}"
        println "Type help() to see available commands."
        return
    }
    def ann = method.getAnnotation(Help)
    def paramTypes = method.parameterTypes.collect {
        def name = it.simpleName
        name == 'GroovyShell' ? null : name
    }.grep().join(', ')
    println "${cmd} <${paramTypes}>"
    println "  ${ann.desc()}"
    println ""
    println "  Example:"
    println "    ${ann.example()}"
    if (ann.output()) {
        println ""
        println "  Output:"
        ann.output().split('\n').each { line ->
            println "    ${line}"
        }
    }
}
```

- [ ] **Step 4: Rebuild JAR and verify**

```bash
cd src/groovy && groovyc -d build *Helper.groovy && jar cf kernel-helpers.jar -C build . && rm -rf build
```

Expected: compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src/groovy/MacroHelper.groovy src/groovy/kernel-helpers.jar
git commit -m "feat: add help() macro with overview and per-command detail"
```

---

### Task 3: Add tests for help command

**Files:**
- Modify: `src/groovy/MacroHelperTest.groovy`

- [ ] **Step 1: Add test for `help()` overview**

```groovy
@Test
void testHelpOverview() {
    def output = captureOutput {
        MacroHelper.printHelpOverview()
    }
    assert output.contains("Output:")
    assert output.contains("Exploration:")
    assert output.contains("Dependencies:")
    assert output.contains("Meta:")
    assert output.contains("p ")
    assert output.contains("pp ")
    assert output.contains("tt ")
    assert output.contains("dir ")
    assert output.contains("grab ")
    assert output.contains("addClasspath ")
    assert output.contains("findClass ")
}
```

- [ ] **Step 2: Add test for `help("pp")` detail**

```groovy
@Test
void testHelpDetail() {
    def output = captureOutput {
        MacroHelper.printHelpDetail("pp")
    }
    assert output.contains("pp")
    assert output.contains("Pretty-print")
    assert output.contains("Example:")
}
```

- [ ] **Step 3: Add test for unknown command**

```groovy
@Test
void testHelpDetailUnknownCommand() {
    def output = captureOutput {
        MacroHelper.printHelpDetail("nonexistent")
    }
    assert output.contains("Unknown command")
}
```

- [ ] **Step 4: Run Groovy tests**

```bash
cd src/groovy && groovy MacroHelperTest.groovy
```

Expected: all tests pass including new ones.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all TS and Groovy tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/groovy/MacroHelperTest.groovy
git commit -m "test: add tests for help() overview and detail"
```

---

### Task 4: Rewrite README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README.md**

Replace entire content with:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README with quick start, command reference, and usage notes"
```
