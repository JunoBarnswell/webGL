import * as THREE from 'three';

/**
 * ZoneGuideManager: Handles exhibition gallery zones and guided camera transitions
 */
export class ZoneGuideManager {
  constructor(cameraController, eventEmitter) {
    this.controller = cameraController;
    this.events = eventEmitter;
    this.zones = new Map();
    this.activeZone = null;

    this._initDefaultZones();
  }

  _initDefaultZones() {
    // Exact viewpoint coordinates from original exhibition edit_info.json
    this.addZone('entrance', {
      name: '展厅入口',
      position: new THREE.Vector3(-1846, 2000, 726),
      target: new THREE.Vector3(-1778, 2162, -1409)
    });

    this.addZone('A', {
      name: 'A区 - 经典写实油画',
      position: new THREE.Vector3(-11142, 2000, -20020),
      target: new THREE.Vector3(-13127, 2137, -20227)
    });

    this.addZone('B', {
      name: 'B区 - 印象派光影',
      position: new THREE.Vector3(-13619, 2000, -5834),
      target: new THREE.Vector3(-15596, 1912, -6126)
    });

    this.addZone('C', {
      name: 'C区 - 当代浪漫表现',
      position: new THREE.Vector3(4864, 2000, 25700),
      target: new THREE.Vector3(4858, 2249, 23715)
    });

    this.addZone('D', {
      name: 'D区 - 抽象意象空间',
      position: new THREE.Vector3(-10323, 2000, 29875),
      target: new THREE.Vector3(-10774, 2123, 27930)
    });
  }

  addZone(key, zoneData) {
    this.zones.set(key, zoneData);
  }

  getZone(key) {
    return this.zones.get(key);
  }

  getAllZones() {
    return Array.from(this.zones.entries()).map(([key, data]) => ({ key, ...data }));
  }

  /**
   * Fly camera to designated exhibition zone
   * @param {string} zoneKey
   * @param {number} duration
   */
  flyToZone(zoneKey, duration = 1.5) {
    const zone = this.zones.get(zoneKey);
    if (!zone) {
      console.warn(`[ZoneGuideManager] Zone "${zoneKey}" not found`);
      return;
    }

    this.activeZone = zoneKey;
    this.events.emit('zoneChange', { key: zoneKey, ...zone });

    this.controller.flyTo(zone.position, zone.target, duration, () => {
      this.events.emit('zoneArrived', { key: zoneKey, ...zone });
    });
  }
}
