import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';

/**
 * Notebook serializer for Groovy notebooks.
 * Supports saving and restoring output cells.
 */

interface RawNotebookData {
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
}

const TEXT_MIME_TYPES = ['text/plain', 'text/html', 'text/markdown', 'application/json'];

function deserializeCellOutputs(outputs: SerializedCellOutput[]): vscode.NotebookCellOutput[] {
	return outputs.map(output => {
		const outputItems = output.outputs.map(item => {
			if (item.mime === 'text/plain' && typeof item.value === 'string') {
				return vscode.NotebookCellOutputItem.text(item.value);
			}
			if (item.encoding === 'base64') {
				const decoded = Buffer.from(String(item.value), 'base64');
				return new vscode.NotebookCellOutputItem(decoded, item.mime);
			}
			const encodedValue: Uint8Array = new TextEncoder().encode(String(item.value));
			return new vscode.NotebookCellOutputItem(encodedValue, item.mime);
		});
		return new vscode.NotebookCellOutput(outputItems, output.metadata);
	});
}

function serializeCellOutputs(outputs: vscode.NotebookCellOutput[]): SerializedCellOutput[] {
	return outputs.map(output => ({
		outputs: output.items.map(item => {
			if (TEXT_MIME_TYPES.includes(item.mime)) {
				return {
					mime: item.mime,
					value: new TextDecoder().decode(item.data),
					encoding: 'text'
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
		} catch {
			raw = { cells: [] };
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
		const contents: RawNotebookData = { cells: [] };

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
