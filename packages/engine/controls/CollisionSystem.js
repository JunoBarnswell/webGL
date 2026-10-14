import * as THREE from 'three';

/**
 * CollisionSystem: Handles horizontal wall obstruction raycasting and vertical floor height detection
 */
export class CollisionSystem {
  constructor() {
    this.enabled = true;
    this.colliObjects = [];
    this.groundObjects = [];
    this.raycaster = new THREE.Raycaster();
    this.playerRadius = 300; // Collision buffer distance
    this.playerHeight = 2000; // Eye level height
  }

  setColliObjects(objects) {
    this.colliObjects = objects || [];
  }

  setGroundObjects(objects) {
    this.groundObjects = objects || [];
  }

  /**
   * Validate movement and prevent wall penetration
   * @param {THREE.Vector3} currentPos
   * @param {THREE.Vector3} moveDelta
   * @returns {THREE.Vector3} Allowed delta vector
   */
  validateMovement(currentPos, moveDelta) {
    if (!this.enabled || this.colliObjects.length === 0 || moveDelta.lengthSq() === 0) {
      return moveDelta.clone();
    }

    const testDistance = moveDelta.length() + this.playerRadius;
    const direction = moveDelta.clone().normalize();

    // Cast ray at waist height
    const rayOrigin = currentPos.clone();
    rayOrigin.y += 1000; // Mid-body height

    this.raycaster.set(rayOrigin, direction);
    this.raycaster.near = 1;
    this.raycaster.far = testDistance;

    const intersections = this.raycaster.intersectObjects(this.colliObjects, true);

    if (intersections.length > 0) {
      const hit = intersections[0];
      if (hit.distance < this.playerRadius) {
        // Block movement directly into wall
        return new THREE.Vector3(0, 0, 0);
      }
      // Allow partial movement up to wall buffer
      const safeDistance = Math.max(0, hit.distance - this.playerRadius);
      return direction.multiplyScalar(safeDistance);
    }

    return moveDelta.clone();
  }

  /**
   * Clamp player height to floor plane
   * @param {THREE.Vector3} pos
   * @returns {number} target Y
   */
  getFloorHeight(pos) {
    if (this.groundObjects.length === 0) return this.playerHeight;

    const rayOrigin = pos.clone();
    rayOrigin.y += 5000; // Cast from above
    const down = new THREE.Vector3(0, -1, 0);

    this.raycaster.set(rayOrigin, down);
    this.raycaster.near = 1;
    this.raycaster.far = 10000;

    const hits = this.raycaster.intersectObjects(this.groundObjects, true);
    if (hits.length > 0) {
      return hits[0].point.y + this.playerHeight;
    }
    return this.playerHeight;
  }
}
