import org.junit.BeforeClass
import org.junit.Rule
import org.junit.rules.TestRule
import org.junit.rules.TestWatcher

class GroovyTestBase {

    static boolean hadFailures = false

    @BeforeClass
    static void registerShutdownHook() {
        Runtime.runtime.addShutdownHook {
            if (hadFailures) Runtime.runtime.halt(1)
        }
    }

    @Rule
    public TestRule watchman = [
        failed: { e, d -> hadFailures = true }
    ] as TestWatcher
}
