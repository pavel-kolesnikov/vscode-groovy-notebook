import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import * as zlib from 'zlib';
import { shouldCompressOutputs } from './config.js';

const SCHEMA_VERSION = '1.1.0';
const TEXT_MIME_TYPES = ['text/plain', 'text/html', 'text/markdown', 'application/json'];
const COMPRESSION_THRESHOLD = 1024;

interface RawNotebookData {
	schemaVersion?: string;
	cells: RawNotebookCell[]
}

interface RawNotebookCell {
	id?: string;
	language: string;
	value: string;
	kind: vscode.NotebookCellKind;
	editable?: boolean;
	outputs?: SerializedCellOutput[];
}

function generateCellId(): string {
	return Math.random().toString(36).substring(2, 10);
}

interface SerializedCellOutput {
	outputs: SerializedOutputItem[];
	metadata?: Record<string, unknown>;
}

interface SerializedOutputItem {
	mime: string;
	value: unknown;
	encoding?: 'base64' | 'text';
	compression?: 'gzip';
}

function deserializeCellOutputs(outputs: SerializedCellOutput[]): vscode.NotebookCellOutput[] {
	if (!outputs || outputs.length === 0) {
		return [];
	}
	return outputs.map(output => {
		const outputItems = output.outputs?.map(item => {
			if (item.compression === 'gzip') {
				const decompressed = zlib.gunzipSync(Buffer.from(String(item.value), 'base64'));
				const mime = item.mime;
				return new vscode.NotebookCellOutputItem(decompressed, mime);
			}
			if (item.mime === 'text/plain' && typeof item.value === 'string') {
				return vscode.NotebookCellOutputItem.text(item.value);
			}
			if (item.encoding === 'base64') {
				const decoded = Buffer.from(String(item.value), 'base64');
				return new vscode.NotebookCellOutputItem(new Uint8Array(decoded), item.mime);
			}
			const encodedValue: Uint8Array = new TextEncoder().encode(String(item.value));
			return new vscode.NotebookCellOutputItem(encodedValue, item.mime);
		}) ?? [];
		return new vscode.NotebookCellOutput(outputItems, output.metadata);
	});
}

function serializeCellOutputs(outputs: vscode.NotebookCellOutput[], compress: boolean): SerializedCellOutput[] {
	return outputs.map(output => ({
		outputs: output.items.map(item => {
			if (TEXT_MIME_TYPES.includes(item.mime)) {
				const text = new TextDecoder().decode(item.data);
				if (compress && text.length > COMPRESSION_THRESHOLD) {
					const compressed = zlib.gzipSync(Buffer.from(text));
					return {
						mime: item.mime,
						value: compressed.toString('base64'),
						encoding: 'base64',
						compression: 'gzip'
					};
				}
				return {
					mime: item.mime,
					value: text,
					encoding: 'text'
				};
			}
			if (compress && item.data.length > COMPRESSION_THRESHOLD) {
				const compressed = zlib.gzipSync(item.data);
				return {
					mime: item.mime,
					value: compressed.toString('base64'),
					encoding: 'base64',
					compression: 'gzip'
				};
			}
			return {
				mime: item.mime,
				value: Buffer.from(item.data).toString('base64'),
				encoding: 'base64'
			};
		}),
		metadata: output.metadata
	}));
}

/**
 * Serializes and deserializes Groovy notebook documents (.groovynb files).
 * Handles conversion between JSON file format and VS Code's NotebookData.
 */
export class GroovyContentSerializer implements vscode.NotebookSerializer {
    public readonly label: string = 'Groovy Content Serializer';

	public async deserializeNotebook(data: Uint8Array, token: vscode.CancellationToken): Promise<vscode.NotebookData> {
		const contents = new TextDecoder().decode(data);

		let raw: RawNotebookData;
		try {
			raw = <RawNotebookData>JSON.parse(contents);
		} catch (e) {
			console.error('[GroovyContentSerializer] Failed to parse notebook:', e);
			raw = { cells: [] };
		}

		const schemaVersion = raw.schemaVersion;
		if (schemaVersion && schemaVersion !== SCHEMA_VERSION) {
			console.warn(`[GroovyContentSerializer] Schema version mismatch: expected ${SCHEMA_VERSION}, got ${schemaVersion}`);
		}

		const cells = raw.cells.map(item => {
			const cellId = item.id || generateCellId();
			const cellData = new vscode.NotebookCellData(
				item.kind,
				item.value,
				item.language
			);

			cellData.metadata = { _cellId: cellId };

			if (item.outputs && item.kind === vscode.NotebookCellKind.Code) {
				cellData.outputs = deserializeCellOutputs(item.outputs);
			}

			return cellData;
		});

		return new vscode.NotebookData(cells);
	}

	public async serializeNotebook(data: vscode.NotebookData, token: vscode.CancellationToken): Promise<Uint8Array> {
		const compress = shouldCompressOutputs();
		const contents: RawNotebookData = { 
			schemaVersion: SCHEMA_VERSION,
			cells: [] 
		};

		for (const cell of data.cells) {
			const cellId = (cell.metadata as Record<string, string>)?.['_cellId'] || generateCellId();
			const cellData: RawNotebookCell = {
				id: cellId,
				kind: cell.kind,
				language: cell.languageId,
				value: cell.value
			};

			if (cell.outputs && cell.outputs.length > 0) {
				cellData.outputs = serializeCellOutputs(cell.outputs, compress);
			}

			contents.cells.push(cellData);
		}

		const jsonString = JSON.stringify(contents, null, 2);
		return new TextEncoder().encode(jsonString);
	}
}
