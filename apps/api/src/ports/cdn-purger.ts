/** Publishing alone invalidates public manifest paths. Source media stays private. */
export interface CdnPurger {
  purge(path: string): Promise<void>;
}

export const CDN_PURGER = Symbol('CdnPurger');
export const unconfiguredCdnPurger: CdnPurger = {
  async purge() { throw new Error('CDN purge bridge is not configured'); },
};
