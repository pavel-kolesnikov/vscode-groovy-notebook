import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import * as zlib from 'zlib';

const SCHEMA_VERSION = '1.0.0';
const TEXT_MIME_TYPES = ['text/plain', 'text/html', 'text/markdown', 'application/json'];
const COMPRESSION_THRESHOLD = 1024;

interface RawNotebookData {
	schemaVersion?: string;
	cells: RawNotebookCell[]
}

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.NotebookCellKind;
	editable?: boolean;
	outputs?: SerializedCellOutput[];
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
				return new vscode.NotebookCellOutputItem(decoded, item.mime);
			}
			const encodedValue: Uint8Array = new TextEncoder().encode(String(item.value));
			return new vscode.NotebookCellOutputItem(encodedValue, item.mime);
		}) ?? [];
		return new vscode.NotebookCellOutput(outputItems, output.metadata);
	});
}

function serializeCellOutputs(outputs: vscode.NotebookCellOutput[]): SerializedCellOutput[] {
	return outputs.map(output => ({
		outputs: output.items.map(item => {
			if (TEXT_MIME_TYPES.includes(item.mime)) {
				const text = new TextDecoder().decode(item.data);
				if (text.length > COMPRESSION_THRESHOLD) {
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
			if (item.data.length > COMPRESSION_THRESHOLD) {
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
			const cellData = new vscode.NotebookCellData(
				item.kind,
				item.value,
				item.language
			);

			if (item.outputs && item.kind === vscode.NotebookCellKind.Code) {
				cellData.outputs = deserializeCellOutputs(item.outputs);
			}

			return cellData;
		});

		return new vscode.NotebookData(cells);
	}

	public async serializeNotebook(data: vscode.NotebookData, token: vscode.CancellationToken): Promise<Uint8Array> {
		const contents: RawNotebookData = { 
			schemaVersion: SCHEMA_VERSION,
			cells: [] 
		};

		for (const cell of data.cells) {
			const cellData: RawNotebookCell = {
				kind: cell.kind,
				language: cell.languageId,
				value: cell.value
			};

			if (cell.outputs && cell.outputs.length > 0) {
				cellData.outputs = serializeCellOutputs(cell.outputs);
			}

			contents.cells.push(cellData);
		}

		const jsonString = JSON.stringify(contents, null, 2);
		return new TextEncoder().encode(jsonString);
	}
}
