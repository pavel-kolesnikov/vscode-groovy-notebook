import assert from 'assert';

interface ExecutionRecord {
    cellIndex: number;
    startTime: number;
    endTime: number | null;
    output: string;
}

describe('Kernel execution flow', () => {
    describe('sequential cell execution', () => {
        it('should complete each cell execution properly', async () => {
            const executionRecords: ExecutionRecord[] = [];
            let queue: Promise<void> = Promise.resolve();

            const executeCells = (cellCodes: string[], sessionDelay: number) => {
                for (let i = 0; i < cellCodes.length; i++) {
                    const cellIndex = i;
                    const cellCode = cellCodes[i];

                    queue = queue.then(async () => {
                        const startTime = Date.now();
                        await new Promise(resolve => setTimeout(resolve, sessionDelay));
                        const endTime = Date.now();

                        executionRecords.push({
                            cellIndex,
                            startTime,
                            endTime,
                            output: `result-${cellCode}`
                        });
                    });
                }

                return queue;
            };

            await executeCells(['cell1', 'cell2', 'cell3'], 10);

            assert.strictEqual(executionRecords.length, 3);

            for (let i = 0; i < executionRecords.length; i++) {
                const record = executionRecords[i];
                assert.ok(record.startTime > 0, `Cell ${i} should have start time`);
                assert.ok(record.endTime !== null, `Cell ${i} should have end time`);
                assert.ok(record.endTime! >= record.startTime, `Cell ${i} end should be after start`);
                assert.strictEqual(record.output, `result-cell${i + 1}`, `Cell ${i} should have correct output`);
            }
        });

        it('should ensure cells execute sequentially with proper timing', async () => {
            const executionRecords: ExecutionRecord[] = [];
            let queue: Promise<void> = Promise.resolve();
            const delay = 30;

            const executeCells = (cellCodes: string[]) => {
                for (let i = 0; i < cellCodes.length; i++) {
                    const cellIndex = i;
                    const cellCode = cellCodes[i];

                    queue = queue.then(async () => {
                        const startTime = Date.now();
                        await new Promise(resolve => setTimeout(resolve, delay));
                        const endTime = Date.now();

                        executionRecords.push({
                            cellIndex,
                            startTime,
                            endTime,
                            output: cellCode
                        });
                    });
                }

                return queue;
            };

            const overallStart = Date.now();
            await executeCells(['a', 'b', 'c']);
            const overallEnd = Date.now();

            const totalTime = overallEnd - overallStart;
            assert.ok(totalTime >= delay * 3, `Total execution time should be at least 3x delay (sequential), got ${totalTime}ms`);
            
            for (let i = 0; i < executionRecords.length; i++) {
                assert.ok(executionRecords[i].endTime! >= executionRecords[i].startTime);
            }
        });

        it('should NOT allow two cells to run in parallel (REGRESSION TEST)', async () => {
            const activeExecutions: number[] = [];
            const executionRecords: ExecutionRecord[] = [];
            let queue: Promise<void> = Promise.resolve();
            const delay = 50;

            const executeCellsWithConcurrencyCheck = (cellCodes: string[]) => {
                for (let i = 0; i < cellCodes.length; i++) {
                    const cellIndex = i;
                    const cellCode = cellCodes[i];

                    queue = queue.then(async () => {
                        activeExecutions.push(cellIndex);
                        assert.strictEqual(
                            activeExecutions.length,
                            1,
                            `Cell ${cellIndex} started while cell(s) ${activeExecutions.filter(e => e !== cellIndex)} were still running - CELLS RUN IN PARALLEL!`
                        );

                        const startTime = Date.now();
                        await new Promise(resolve => setTimeout(resolve, delay));
                        const endTime = Date.now();

                        const execIdx = activeExecutions.indexOf(cellIndex);
                        if (execIdx >= 0) activeExecutions.splice(execIdx, 1);

                        executionRecords.push({
                            cellIndex,
                            startTime,
                            endTime,
                            output: cellCode
                        });
                    });
                }

                return queue;
            };

            await executeCellsWithConcurrencyCheck(['cell1', 'cell2', 'cell3']);

            assert.strictEqual(activeExecutions.length, 0, 'All executions should have completed');
            assert.strictEqual(executionRecords.length, 3, 'All cells should have executed');
        });
    });
});
