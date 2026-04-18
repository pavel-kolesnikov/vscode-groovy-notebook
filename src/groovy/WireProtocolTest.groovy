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
