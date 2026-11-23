import { Memory, MemoryStatus, VerificationStatus } from '@evolve-ai/shared-types';

/**
 * Valid transitions for Memory lifecycle:
 * Candidate -> Approved -> Active -> Updated / Archived / Deleted
 * Unverified <-> Verified
 * Candidate -> Rejected
 */
export class MemoryLifecycle {
  static canTransition(current: MemoryStatus, target: MemoryStatus): boolean {
    if (current === target) return true;
    if (current === 'deleted') return false; // terminal state

    const allowedTransitions: Record<MemoryStatus, MemoryStatus[]> = {
      candidate: ['approved', 'rejected', 'deleted'],
      approved: ['active', 'updated', 'archived', 'deleted'],
      active: ['updated', 'archived', 'deleted'],
      updated: ['active', 'archived', 'deleted'],
      unverified: ['approved', 'rejected', 'archived', 'deleted'],
      rejected: ['candidate', 'deleted'], // Can be reconsidered with new info
      expired: ['archived', 'deleted'],
      archived: ['approved', 'active', 'deleted'], // Can be restored
      deleted: [],
    };

    return allowedTransitions[current]?.includes(target) ?? false;
  }

  static approve(memory: Memory): Memory {
    if (!this.canTransition(memory.status, 'approved')) {
      throw new Error(`Cannot transition memory from status "${memory.status}" to "approved"`);
    }
    return {
      ...memory,
      status: 'approved',
      updatedAt: new Date().toISOString(),
    };
  }

  static reject(memory: Memory): Memory {
    if (!this.canTransition(memory.status, 'rejected')) {
      throw new Error(`Cannot transition memory from status "${memory.status}" to "rejected"`);
    }
    return {
      ...memory,
      status: 'rejected',
      updatedAt: new Date().toISOString(),
    };
  }

  static archive(memory: Memory): Memory {
    if (!this.canTransition(memory.status, 'archived')) {
      throw new Error(`Cannot transition memory from status "${memory.status}" to "archived"`);
    }
    return {
      ...memory,
      status: 'archived',
      updatedAt: new Date().toISOString(),
    };
  }

  static restore(memory: Memory): Memory {
    if (!this.canTransition(memory.status, 'approved')) {
      throw new Error(`Cannot restore memory from status "${memory.status}"`);
    }
    return {
      ...memory,
      status: 'approved',
      updatedAt: new Date().toISOString(),
    };
  }

  static setVerification(memory: Memory, status: VerificationStatus): Memory {
    return {
      ...memory,
      verificationStatus: status,
      updatedAt: new Date().toISOString(),
    };
  }
}
