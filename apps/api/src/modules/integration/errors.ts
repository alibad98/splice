/** No such store, or it has no tokens. */
export class StoreNotConnectedError extends Error {
  constructor() {
    super('store is not connected');
    this.name = 'StoreNotConnectedError';
  }
}

/** The store is not `active` (disconnected by a definitive refresh failure, or past uninstall). */
export class StoreDisconnectedError extends Error {
  constructor() {
    super('store is disconnected from the platform');
    this.name = 'StoreDisconnectedError';
  }
}

/** The platform asked to install a store whose lifecycle state this story does not restore (Story 1.10 does). */
export class StoreLifecycleConflictError extends Error {
  constructor() {
    super('store is in a lifecycle state that install does not restore');
    this.name = 'StoreLifecycleConflictError';
  }
}
