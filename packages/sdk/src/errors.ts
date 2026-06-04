import type { P402ErrorCode } from './types.js';

export class P402Error extends Error {
    constructor(
        public code: P402ErrorCode,
        message: string,
        public details?: unknown,
    ) {
        super(message);
        this.name = 'P402Error';
    }
}
