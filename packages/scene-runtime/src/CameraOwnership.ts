/** A stale asynchronous completion can never release a newer camera owner. */
export class CameraOwnership {
  private serial = 0;
  private lease: { id: number; owner: string; cancel: () => void } | null =
    null;
  get owner(): string {
    return this.lease?.owner ?? "navigation";
  }
  acquire(owner: string, cancel: () => void): number {
    this.reset();
    const id = ++this.serial;
    this.lease = { id, owner, cancel };
    return id;
  }
  release(id: number): void {
    if (this.lease?.id === id) this.lease = null;
  }
  releaseOwner(owner: string): void {
    if (this.lease?.owner === owner) this.lease = null;
  }
  reset(): void {
    const previous = this.lease;
    this.lease = null;
    previous?.cancel();
  }
}
