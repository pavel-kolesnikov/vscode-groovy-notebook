export class ExecutionQueue<T> {
    private readonly pending: T[] = [];
    private running = false;
    private readonly idleResolvers: (() => void)[] = [];

    constructor(
        private readonly run: (item: T) => Promise<void>,
        private readonly onDiscard: (item: T, reason?: string) => void,
    ) {}

    public enqueue(...items: T[]): void {
        this.pending.push(...items);
        void this.drain();
    }

    public discardPending(reason?: string): void {
        for (const item of this.pending.splice(0)) {
            this.onDiscard(item, reason);
        }
    }

    public clearPending(): void {
        this.pending.splice(0);
    }

    public get isRunning(): boolean {
        return this.running;
    }

    public whenIdle(): Promise<void> {
        if (!this.running && this.pending.length === 0) {
            return Promise.resolve();
        }
        return new Promise((resolve) => this.idleResolvers.push(resolve));
    }

    private async drain(): Promise<void> {
        if (this.running) return;

        this.running = true;
        try {
            while (this.pending.length > 0) {
                const item = this.pending.shift();
                if (item === undefined) break;
                try {
                    await this.run(item);
                } catch (error) {
                    console.error('Execution queue item failed', error);
                    this.discardPending();
                    break;
                }
            }
        } finally {
            this.running = false;
            for (const resolve of this.idleResolvers.splice(0)) {
                resolve();
            }
        }
    }
}
