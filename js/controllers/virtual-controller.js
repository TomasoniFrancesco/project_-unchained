/**
 * VirtualController — groups physical controller devices into one logical
 * controller shape without changing the current two-slot connection model.
 */

const ASSIGNMENT_KEY = 'fz_controller_assignments';
const VALID_ASSIGNMENTS = new Set(['left', 'right', 'standalone']);

function normalizeUuid(uuid) {
    return String(uuid || '').toLowerCase();
}

function arraysEqual(a = [], b = []) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function loadAssignments() {
    try {
        return JSON.parse(localStorage.getItem(ASSIGNMENT_KEY)) || {};
    } catch {
        return {};
    }
}

function saveAssignments(assignments) {
    localStorage.setItem(ASSIGNMENT_KEY, JSON.stringify(assignments));
}

function inferAssignmentFromName(name) {
    const normalized = String(name || '').toLowerCase();
    if (/\bleft\b|\bl\b|[-_\s]l(?:eft)?\b/.test(normalized)) return 'left';
    if (/\bright\b|\br\b|[-_\s]r(?:ight)?\b/.test(normalized)) return 'right';
    return 'standalone';
}

function mappingMatchesReport(mapping, report) {
    if (!mapping) return false;

    if (mapping.deviceId) {
        if (mapping.deviceId !== report.deviceId) return false;
    } else if (mapping.assignment && mapping.assignment !== report.assignment) {
        return false;
    }

    if (mapping.bytes && !arraysEqual(mapping.bytes, report.data || [])) {
        return false;
    }
    if (mapping.serviceUuid && normalizeUuid(mapping.serviceUuid) !== normalizeUuid(report.serviceUuid)) {
        return false;
    }
    if (mapping.charUuid && normalizeUuid(mapping.charUuid) !== normalizeUuid(report.charUuid)) {
        return false;
    }

    if (mapping.b0 !== undefined) {
        return mapping.b0 === report.data?.[0] && mapping.b1 === (report.data?.[1] || 0);
    }

    return !!mapping.bytes;
}

export class VirtualController {
    constructor() {
        this.assignments = loadAssignments();
    }

    getAssignment(deviceId, name = '') {
        if (deviceId && this.assignments[deviceId]) return this.assignments[deviceId];
        return inferAssignmentFromName(name);
    }

    setAssignment(deviceId, assignment) {
        if (!deviceId || !VALID_ASSIGNMENTS.has(assignment)) return false;

        if (assignment !== 'standalone') {
            for (const [otherId, otherAssignment] of Object.entries(this.assignments)) {
                if (otherId !== deviceId && otherAssignment === assignment) {
                    delete this.assignments[otherId];
                }
            }
        }

        this.assignments[deviceId] = assignment;
        saveAssignments(this.assignments);
        return true;
    }

    clearDevice(deviceId) {
        if (!deviceId || !this.assignments[deviceId]) return;
        delete this.assignments[deviceId];
        saveAssignments(this.assignments);
    }

    getSnapshot(devices) {
        const physical = devices
            .map((device) => ({
                slot: device.slot,
                id: device.id,
                name: device.name,
                status: device.status,
                connected: device.gattConnected && device.status !== 'disconnected',
                inputReady: device.inputReady,
                assignment: this.getAssignment(device.id, device.name),
            }))
            .filter((device) => device.status !== 'disconnected');

        const left = physical.find((device) => device.assignment === 'left') || null;
        const right = physical.find((device) => device.assignment === 'right') || null;

        let status = 'disconnected';
        if (left && right) status = left.inputReady && right.inputReady ? 'ready' : 'partial';
        else if (physical.length) status = 'partial';

        return {
            id: 'virtual-controller-1',
            type: physical.some((device) => /zwift|play|click/i.test(device.name)) ? 'zwift-like' : 'generic',
            status,
            left,
            right,
            standalone: physical.filter((device) => device.assignment === 'standalone'),
            devices: physical,
        };
    }

    resolveAction(report, mappings = {}) {
        const matchedActions = [];

        for (const [action, mapping] of Object.entries(mappings)) {
            if (mappingMatchesReport(mapping, report)) {
                matchedActions.push(action);
            }
        }

        if (matchedActions.length > 1) {
            return { kind: 'ambiguous', actions: matchedActions };
        }

        if (matchedActions.length === 1) {
            return { kind: 'mapped', action: matchedActions[0] };
        }

        if (report.parsed?.kind === 'zwift' && report.parsed.actions?.length) {
            return { kind: 'parsed', action: report.parsed.actions[0] };
        }

        return { kind: 'none' };
    }
}

export const virtualController = new VirtualController();
