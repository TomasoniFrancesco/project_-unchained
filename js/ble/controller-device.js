/**
 * ControllerDevice — thin wrapper around one existing controller slot.
 * Phase 2 keeps the slot array but gives each physical BLE connection
 * an explicit device object boundary.
 */

export class ControllerDevice {
    constructor(slot, record) {
        this.slot = slot;
        this.record = record;
    }

    get device() { return this.record.device; }
    get server() { return this.record.server; }
    get id() { return this.record.id || ''; }
    get name() { return this.record.name || ''; }
    get status() { return this.record.status; }
    get inputReady() { return !!this.record.inputReady; }
    get issue() { return this.record.issue || ''; }
    get heartbeatId() { return this.record.heartbeatId; }
    get gattConnected() { return !!(this.record.server && this.record.server.connected); }

    setStatus(status, issue = this.record.issue || '') {
        this.record.status = status;
        this.record.issue = issue;
    }

    hydrate(device, fallbackName) {
        this.record.device = device;
        this.record.id = device.id || '';
        this.record.name = device.name || fallbackName;
    }

    attachServer(server) {
        this.record.server = server;
    }

    setHeartbeat(id) {
        this.record.heartbeatId = id;
    }

    clearHeartbeat() {
        this.record.heartbeatId = null;
    }

    setInputReady(issue) {
        this.record.inputReady = true;
        this.record.issue = issue;
    }

    setInputReadyState(ready) {
        this.record.inputReady = !!ready;
    }

    clearRuntime(reportStates) {
        for (const sub of this.record.subscriptions) {
            try {
                sub.characteristic.removeEventListener('characteristicvaluechanged', sub.listener);
            } catch (_) { /* noop */ }
        }

        this.record.subscriptions = [];
        this.record.writableChannels = [];
        this.record.inputReady = false;

        for (const key of Array.from(reportStates.keys())) {
            if (key.startsWith(`${this.slot}|`)) reportStates.delete(key);
        }
    }

    reset(reportStates) {
        this.clearRuntime(reportStates);

        try {
            if (this.record.server && this.record.server.connected) this.record.server.disconnect();
        } catch (_) { /* noop */ }

        this.record.server = null;
        this.record.device = null;
        this.record.id = '';
        this.record.name = '';
        this.record.status = 'disconnected';
        this.record.issue = '';
        this.record.heartbeatId = null;
    }

    toInfo(assignment = 'standalone') {
        return {
            name: this.name,
            id: this.id,
            status: this.status,
            connected: this.gattConnected && this.status !== 'disconnected',
            gattConnected: this.gattConnected,
            inputReady: this.inputReady,
            issue: this.issue,
            assignment,
            slot: this.slot,
        };
    }
}
