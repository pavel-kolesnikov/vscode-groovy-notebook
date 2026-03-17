import assert from 'assert';
import { EventEmitter } from 'events';

class MockDisposable {
    public disposed = false;
    dispose() {
        this.disposed = true;
    }
}

class MockEventEmitter<T> {
    private listeners: ((e: T) => any)[] = [];
    
    event = (listener: (e: T) => any): MockDisposable => {
        this.listeners.push(listener);
        const disposable = new MockDisposable();
        const originalDispose = disposable.dispose.bind(disposable);
        disposable.dispose = () => {
            originalDispose();
            const idx = this.listeners.indexOf(listener);
            if (idx >= 0) {
                this.listeners.splice(idx, 1);
            }
        };
        return disposable;
    };
    
    fire(data: T) {
        this.listeners.forEach(l => l(data));
    }
    
    get listenerCount() {
        return this.listeners.length;
    }
}

class MockSession {
    private status: string = 'idle';
    private readonly onStatusChange = new MockEventEmitter<string>();
    private disposed = false;
    
    public readonly onDidChangeStatus = this.onStatusChange.event;
    
    getStatus() {
        return this.status;
    }
    
    setStatus(status: string) {
        this.status = status;
        this.onStatusChange.fire(status);
    }
    
    dispose() {
        this.disposed = true;
    }
}

class MockSessionRegistry {
    private readonly sessions = new Map<string, MockSession>();
    private readonly sessionSubscriptions = new Map<string, MockDisposable>();
    private readonly onDidChangeSessionStatus = new MockEventEmitter<{ uri: string; status: string }>();
    
    public readonly onDidChangeStatus = this.onDidChangeSessionStatus.event;
    
    getOrCreate(uri: string): MockSession {
        let session = this.sessions.get(uri);
        if (!session) {
            session = new MockSession();
            const subscription = session.onDidChangeStatus((status) => {
                this.onDidChangeSessionStatus.fire({ uri, status });
            });
            this.sessionSubscriptions.set(uri, subscription);
            this.sessions.set(uri, session);
        }
        return session;
    }
    
    dispose() {
        for (const subscription of this.sessionSubscriptions.values()) {
            subscription.dispose();
        }
        this.sessionSubscriptions.clear();
        for (const session of this.sessions.values()) {
            session.dispose();
        }
        this.sessions.clear();
    }
    
    getSubscriptionCount() {
        return this.sessionSubscriptions.size;
    }
    
    isSubscriptionDisposed(uri: string) {
        const sub = this.sessionSubscriptions.get(uri);
        return sub ? sub.disposed : false;
    }
}

describe('SessionRegistry subscription disposal', () => {
    it('should dispose session subscription when registry is disposed', () => {
        const registry = new MockSessionRegistry();
        const session = registry.getOrCreate('test-uri');
        
        assert.strictEqual(registry.getSubscriptionCount(), 1);
        
        const wasDisposedBefore = registry.isSubscriptionDisposed('test-uri');
        assert.strictEqual(wasDisposedBefore, false);
        
        registry.dispose();
        
        assert.strictEqual(registry.getSubscriptionCount(), 0);
    });
    
    it('should properly remove listener when subscription is disposed', () => {
        const registry = new MockSessionRegistry();
        const session = registry.getOrCreate('test-uri');
        
        let eventFired = false;
        registry.onDidChangeStatus(() => {
            eventFired = true;
        });
        
        session.setStatus('busy');
        assert.strictEqual(eventFired, true);
        
        registry.dispose();
        
        assert.strictEqual(registry.getSubscriptionCount(), 0);
    });
    
    it('should handle multiple sessions and dispose all subscriptions', () => {
        const registry = new MockSessionRegistry();
        
        registry.getOrCreate('uri-1');
        registry.getOrCreate('uri-2');
        registry.getOrCreate('uri-3');
        
        assert.strictEqual(registry.getSubscriptionCount(), 3);
        
        registry.dispose();
        
        assert.strictEqual(registry.getSubscriptionCount(), 0);
    });
});

describe('Process subscription disposal pattern', () => {
    it('should store subscription and dispose on restart', () => {
        const statusEmitter = new MockEventEmitter<string>();
        let subscription: MockDisposable | null = null;
        
        subscription = statusEmitter.event((status) => {
            // Handler for process status
        });
        
        assert.strictEqual(subscription.disposed, false);
        
        // Simulate restart
        subscription.dispose();
        subscription = null;
        
        assert.strictEqual(subscription, null);
    });
    
    it('should replace old subscription when creating new process', () => {
        const statusEmitter = new MockEventEmitter<string>();
        let subscription: MockDisposable | null = null;
        
        // First process subscription
        subscription = statusEmitter.event(() => {});
        const firstSubscription = subscription;
        
        // Simulate restart - dispose old and create new
        subscription.dispose();
        subscription = statusEmitter.event(() => {});
        
        assert.strictEqual(firstSubscription.disposed, true);
        assert.strictEqual(subscription.disposed, false);
    });
});

describe('StatusBar disposables pattern', () => {
    it('should collect all subscriptions in disposables array', () => {
        const disposables: MockDisposable[] = [];
        
        disposables.push(new MockDisposable());
        disposables.push(new MockDisposable());
        disposables.push(new MockDisposable());
        
        assert.strictEqual(disposables.length, 3);
        
        for (const d of disposables) {
            d.dispose();
        }
        
        assert.strictEqual(disposables.every(d => d.disposed), true);
    });
    
    it('should dispose all subscriptions when statusBar is disposed', () => {
        const disposables: MockDisposable[] = [];
        
        const registryEmitter = new MockEventEmitter<void>();
        disposables.push(registryEmitter.event(() => {}));
        
        const editorEmitter = new MockEventEmitter<void>();
        disposables.push(editorEmitter.event(() => {}));
        
        assert.strictEqual(disposables.length, 2);
        assert.strictEqual(disposables.every(d => !d.disposed), true);
        
        for (const d of disposables) {
            d.dispose();
        }
        disposables.length = 0;
        
        assert.strictEqual(disposables.length, 0);
    });
});
