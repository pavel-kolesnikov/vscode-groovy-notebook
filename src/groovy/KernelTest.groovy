import org.junit.Test

class KernelTest extends GroovyTestBase {

    @Test
    void testPreprocessHelp() {
        assert Kernel.preprocessCommand('help') == 'help()'
        assert Kernel.preprocessCommand('/help') == 'help()'
        assert Kernel.preprocessCommand('/help pp') == "help('pp')"
        assert Kernel.preprocessCommand('/help  pp  ') == "help('pp')"
        assert Kernel.preprocessCommand('println help') == 'println help'
    }
}
