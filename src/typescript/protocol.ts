/**
 * Protocol for communication between VS Code extension and Groovy REPL.
 * Uses ASCII control characters for message framing:
 * - ACK (\\u0006): Sent by Groovy to signal ready state after startup
 * - ETX (\\u0003): Used as delimiter - sent by VS Code to mark end of code input,
 *                  sent by Groovy to mark end of output response
 */

export const SIGNAL_READY = '\u0006'; // ASCII ACK (Acknowledge) - Groovy signals it's ready
export const SIGNAL_END_OF_MESSAGE = '\u0003'; // ASCII ETX (End of Text) - message delimiter
