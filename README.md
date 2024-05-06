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
- `grab <group1:module1:1.0.0>(, <more artifacts>)` --- will grab given artifacts from default provider, usually Maven Central.
- `addClasspath <local path>` --- add given path to the Shell context, making all *.groovy & *.java there available for the Notebook.

# Limitations, a. k. a. FIXME

- No way to terminate groovy via GUI.
- Not properly detect groovy process exited in many cases.
- In some cases errors are not propagated to UI & the kernel seems hang forever.