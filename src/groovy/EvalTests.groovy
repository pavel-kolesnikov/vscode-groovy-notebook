import groovy.test.GroovyTestCase
import Eval

class EvalTests extends GroovyTestCase {
    private Eval eval

    void setUp() {
        eval = new Eval()
    }

    void testProcessSimpleCode() {
        String result = eval.process("println 'Hello, World!'")
        assert result.contains("Hello, World!")
    }    
}
