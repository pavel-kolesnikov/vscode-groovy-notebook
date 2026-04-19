import org.junit.Test
import org.junit.Before
import static groovy.test.GroovyAssert.shouldFail

class MacroHelperTest extends GroovyTestBase {

    private MacroHelper helper
    private ByteArrayOutputStream captured

    @Before
    void setUp() {
        captured = new ByteArrayOutputStream()
        def out = new PrintWriter(captured, true)
        def binding = new Binding(out: out)
        def shell = new GroovyShell(binding)
        helper = new MacroHelper(shell)
    }

    private String getOutput() {
        helper.out.flush()
        return captured.toString()
    }

    @Test
    void testPSingleArg() {
        helper.p("test")
        assert output.contains("test")
    }

    @Test
    void testPMultipleArgs() {
        helper.p("hello", "world", 123)
        assert output.contains("hello world 123")
    }

    @Test
    void testPWithNull() {
        helper.p(null)
        assert output.contains("null") || output.trim().isEmpty()
    }

    @Test
    void testPPSingleObject() {
        helper.pp([a: 1, b: 2])
        assert output.contains("a:") && output.contains("b:")
    }

    @Test
    void testPPMultipleObjects() {
        helper.pp([1, 2])
        assert output.contains("1") && output.contains("2")
    }

    @Test
    void testPPWithList() {
        helper.pp([1, 2, 3])
        assert output.contains("1") && output.contains("2") && output.contains("3")
    }

    @Test
    void testRenderTableWithMaps() {
        def data = [
            [name: "Alice", age: 30],
            [name: "Bob", age: 25]
        ]
        def result = MacroHelper.renderTable(data, "name age")
        assert result.contains("Alice") && result.contains("Bob")
        assert result.contains("30") && result.contains("25")
    }

    @Test
    void testRenderTableEmptyData() {
        def result = MacroHelper.renderTable([])
        assert result == ""
    }

    @Test
    void testRenderTableWithNullValues() {
        def data = [[name: "Test", value: null]]
        def result = MacroHelper.renderTable(data, "name value")
        assert result.contains("Test")
    }

    @Test
    void testRenderTableWithMultilineContent() {
        def data = [[text: "line1\nline2"]]
        def result = MacroHelper.renderTable(data, "text")
        assert result.contains("line1") && result.contains("line2")
    }

    @Test
    void testRenderTableWithCustomColumns() {
        def data = [[a: 1, b: 2, c: 3]]
        def result = MacroHelper.renderTable(data, "a c")
        assert result.contains("1") && result.contains("3")
        assert !result.contains("2")
    }

    @Test
    void testConvertToMapListWithMaps() {
        def data = [[a: 1], [b: 2]]
        def result = MacroHelper.convertToMapList(data)
        assert result == data
    }

    @Test
    void testConvertToMapListWithObjects() {
        def obj = new TestPerson(name: "John", age: 30)
        def result = MacroHelper.convertToMapList([obj])
        assert result[0].name == "John"
        assert result[0].age == 30
    }

    @Test
    void testConvertToMapListWithCollection() {
        def result = MacroHelper.convertToMapList([[1, 2, 3]])
        assert result[0].value == [1, 2, 3]
    }

    @Test
    void testFormatMethodSignatureSimple() {
        def method = String.class.getMethod("substring", int)
        def result = MacroHelper.formatMethodSignature(method)
        assert result.contains("substring")
        assert result.contains("int")
    }

    @Test
    void testFormatMethodSignatureWithParams() {
        def method = String.class.getMethod("lastIndexOf", String.class, int)
        def result = MacroHelper.formatMethodSignature(method)
        assert result.contains("lastIndexOf")
        assert result.contains("String")
        assert result.contains("int")
    }

    @Test
    void testDirForObject() {
        helper.dir(new TestPerson(name: "Test", age: 25))
        assert output.contains("TestPerson")
        assert output.contains("name") || output.contains("age")
    }

    @Test
    void testDirForString() {
        helper.dir("test string")
        assert output.contains("String")
    }

    @Test
    void testAddClasspathInvalid() {
        shouldFail(AssertionError) {
            helper.addClasspath("/nonexistent/path")
        }
    }

    @Test
    void testFindClassReturnsList() {
        def result = helper.findClass("String")
        assert result instanceof List
    }

    @Test
    void testHelpOverview() {
        helper.printHelpOverview()
        def text = output
        assert text.contains("Output:")
        assert text.contains("Exploration:")
        assert text.contains("Dependencies:")
        assert text.contains("Meta:")
        assert text.contains("p ")
        assert text.contains("pp ")
        assert text.contains("tt ")
        assert text.contains("dir ")
        assert text.contains("grab ")
        assert text.contains("addClasspath ")
        assert text.contains("findClass ")
    }

    @Test
    void testHelpDetail() {
        helper.printHelpDetail("pp")
        def text = output
        assert text.contains("pp")
        assert text.contains("Pretty-print")
        assert text.contains("Example:")
    }

    @Test
    void testHelpDetailUnknownCommand() {
        helper.printHelpDetail("nonexistent")
        assert output.contains("Unknown command")
    }
}
