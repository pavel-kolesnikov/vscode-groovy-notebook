# Design: Help Command + README Update

## Goal

Make notebook commands discoverable inside the notebook via a `help` macro, and update the README to accurately reflect the current state of the extension.

## A. Help Command

### `@Help` annotation

```groovy
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface Help {
    String category()       // "Output", "Exploration", "Dependencies"
    String desc()           // one-line description
    String example()        // usage example
    String output() default ""  // expected output shown in help("cmd")
}
```

### Annotated methods

| Method | Category | desc | example | output |
|--------|----------|------|---------|--------|
| `p` | Output | Print arguments space-separated | `p "x =", 42` | `x = 42` |
| `pp` | Output | Pretty-print as YAML (strips transient/static fields) | `pp [a: 1, b: [c: 2]]` | multi-line YAML |
| `tt` | Output | Render ASCII table from list of maps | `tt data, 'name age'` | ASCII table |
| `dir` | Exploration | Inspect object members (fields, properties, methods) sorted by inheritance depth | `dir "hello"` | table with type/name/from/signature |
| `findClass` | Exploration | Find fully-qualified class name by short name (searches classpath JARs) | `findClass "List"` | `[java.util.List]` |
| `grab` | Dependencies | Grab Maven dependencies via Grape (cached in ~/.groovy/grapes) | `grab "org.apache.commons:commons-lang3:3.17.0"` | (empty, loads to classpath) |
| `addClasspath` | Dependencies | Add directory to classpath (relative to .groovynb file) | `addClasspath "lib"` | (empty) |

### `help()` behavior

Prints a grouped summary:

```
Output:
  p <args...>         Print arguments space-separated
  pp <args...>        Pretty-print as YAML (strips transient/static fields)
  tt <data> [cols]    Render ASCII table from list of maps

Exploration:
  dir <obj>                Inspect object members (fields, properties, methods)
  findClass <name>         Find fully-qualified class name by short name

Dependencies:
  grab <coords...>         Grab Maven dependencies via Grape (cached in ~/.groovy/grapes)
  addClasspath <dir>       Add directory to classpath (relative to .groovynb file)

Meta:
  help [cmd]               Show this help, or detailed help for a command
```

### `help("pp")` behavior

Prints detailed info with expected output:

```
pp <args...>
  Pretty-print as YAML (strips transient/static fields)

  Example:
    pp [a: 1, b: [c: 2]]

  Output:
    a: 1
    b:
      c: 2
```

### Implementation

- Add `@Help` annotation class (in `MacroHelper.groovy` or a separate `Help.groovy` compiled into the JAR)
- Annotate all 7 macro methods
- Add `help` as a closure in `MacroHelper.injectMacroses()` that:
  - Reflects on `MacroHelper.declaredMethods` filtered by `@Help` annotation
  - Groups by `category`
  - For overview: prints grouped table
  - For detail: prints desc, example, and output (if non-empty)

## B. README Update

### Requirements: Groovy 5+, Java 21+

### Structure

1. **Title + tagline** — "Interactive Groovy notebook kernel for VS Code"
2. **Quick start** — 3-cell example demonstrating basic eval, `pp`/`grab`, and `tt`
3. **Commands** — table of all 8 commands (including `help`) with signatures and one-line descriptions
4. **Notes** — classpath resolution (relative to `.groovynb`), `groovysh.rc` auto-loaded, `compressOutputs` setting, cell interruption
5. **Development** — `npm install && npm run compile && npm test`, link to AGENTS.md
6. **Contributing** — link to AGENTS.md

### Removed

- "very simple wrapper to GroovyShell" — inaccurate
- `cd src/groovy && groovy KernelTest.groovy` — replaced by `npm run test:groovy`
