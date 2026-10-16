export const cameraPriorities = {
  navigation: 0,
  configuration: 20,
  tour: 40,
  storyboard: 60,
  virtualTour: 70,
  review: 80,
  flight: 100,
  manual: 110,
} as const;
export type CameraRole = keyof typeof cameraPriorities;
interface CameraLease {
  id: number;
  owner: string;
  role: CameraRole;
  cancel: () => void;
}
/** One preemptible camera lease. Release never revives previously cancelled automation. */
export class CameraOwnership {
  private serial = 0;
  private lease: CameraLease | null = null;
  get owner(): string {
    return this.lease?.owner ?? "navigation";
  }
  get role(): CameraRole {
    return this.lease?.role ?? "navigation";
  }
  canAcquire(role: CameraRole): boolean {
    return (
      !this.lease || cameraPriorities[role] >= cameraPriorities[this.lease.role]
    );
  }
  describe(): {
    owner: string;
    role: CameraRole;
    priority: number;
    leaseId: number;
  } {
    return {
      owner: this.owner,
      role: this.role,
      priority: cameraPriorities[this.role],
      leaseId: this.lease?.id ?? 0,
    };
  }
  acquire(owner: string, role: CameraRole, cancel: () => void): number {
    if (!owner) throw Error("相机租约必须声明 owner");
    if (!this.canAcquire(role)) return 0;
    this.reset();
    const id = ++this.serial;
    this.lease = { id, owner, role, cancel };
    return id;
  }
  isCurrent(id: number): boolean {
    return this.lease?.id === id;
  }
  release(id: number): void {
    if (this.isCurrent(id)) this.lease = null;
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
