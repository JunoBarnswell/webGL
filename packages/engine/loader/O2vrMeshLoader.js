import * as THREE from 'three';
import { BaseMeshLoader } from './BaseMeshLoader.js';

/**
 * O2vrMeshLoader: Native 16-bit quantized binary decompressor for .mesh files
 * Reconstructed from MVP Meta / O2VR engine specifications
 */
export class O2vrMeshLoader extends BaseMeshLoader {
  constructor() {
    super();
    this.cache = new Map();
  }

  /**
   * Decode binary .mesh ArrayBuffer into a THREE.BufferGeometry
   * @param {ArrayBuffer} buffer
   * @returns {THREE.BufferGeometry}
   */
  decode(buffer) {
    // 1. Header (5 x uint32 = 20 bytes)
    const header = new Uint32Array(buffer, 0, 5);
    let triCount = header[0];
    const vertCount = header[1];
    const normalCount = header[2];
    const uvCount = header[3];
    const uv2Count = header[4];

    // 2. Quantization bounding values (20 x float32 = 80 bytes)
    const bounds = new Float32Array(buffer, 20, 20);
    const posMin = [bounds[0], bounds[1], bounds[2]];
    const posMax = [bounds[3], bounds[4], bounds[5]];
    const posStep = [
      (posMax[0] - posMin[0]) / 65535,
      (posMax[1] - posMin[1]) / 65535,
      (posMax[2] - posMin[2]) / 65535
    ];

    const normMin = [bounds[6], bounds[7], bounds[8]];
    const normMax = [bounds[9], bounds[10], bounds[11]];
    const normStep = [
      (normMax[0] - normMin[0]) / 65535,
      (normMax[1] - normMin[1]) / 65535,
      (normMax[2] - normMin[2]) / 65535
    ];

    const uvMin = [bounds[12], bounds[13]];
    const uvMax = [bounds[14], bounds[15]];
    const uvStep = [
      (uvMax[0] - uvMin[0]) / 65535,
      (uvMax[1] - uvMin[1]) / 65535
    ];

    const uv2Min = [bounds[16], bounds[17]];
    const uv2Max = [bounds[18], bounds[19]];
    const uv2Step = [
      (uv2Max[0] - uv2Min[0]) / 65535,
      (uv2Max[1] - uv2Min[1]) / 65535
    ];

    // 3. 16-bit Quantized arrays starting at byte offset 100
    const qPos = new Uint16Array(buffer, 100, 3 * vertCount);
    const qNorm = new Uint16Array(buffer, 100 + 6 * vertCount, 3 * normalCount);
    const qUv = new Uint16Array(buffer, 100 + 6 * vertCount + 6 * normalCount, 2 * uvCount);
    const qUv2 = new Uint16Array(buffer, 100 + 6 * vertCount + 6 * normalCount + 4 * uvCount, 2 * uv2Count);

    // 4. Triangle Indices
    const indexOffset = 100 + 6 * vertCount + 6 * normalCount + 4 * uvCount + 4 * uv2Count;
    let indices;
    if (triCount > 1e7) {
      triCount -= 1e7;
      indices = new Uint32Array(buffer, indexOffset, 3 * triCount);
    } else {
      indices = new Uint16Array(buffer, indexOffset, 3 * triCount);
    }

    // 5. Dequantize positions
    const positions = new Float32Array(3 * vertCount);
    for (let i = 0; i < qPos.length; i++) {
      const axis = i % 3;
      positions[i] = posMin[axis] + qPos[i] * posStep[axis];
    }

    // 6. Dequantize normals
    const normals = new Float32Array(3 * vertCount);
    for (let i = 0; i < qNorm.length; i++) {
      const axis = i % 3;
      normals[i] = normMin[axis] + qNorm[i] * normStep[axis];
    }

    // 7. Dequantize UV
    const uvs = new Float32Array(2 * vertCount);
    for (let i = 0; i < qUv.length; i++) {
      const axis = i % 2;
      uvs[i] = uvMin[axis] + qUv[i] * uvStep[axis];
    }
    // Vertical UV compensation
    for (let i = 0; i < uvs.length; i += 2) {
      uvs[i + 1] += 1;
    }

    // 8. Dequantize Lightmap UV2
    const uv2s = new Float32Array(2 * vertCount);
    for (let i = 0; i < qUv2.length; i++) {
      const axis = i % 2;
      uv2s[i] = uv2Min[axis] + qUv2[i] * uv2Step[axis];
    }

    // 9. Assemble THREE.BufferGeometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (normalCount > 0) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    } else {
      geometry.computeVertexNormals();
    }

    // Channel 0: 'uv'
    if (uvCount > 0) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    } else if (uv2Count > 0) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv2s.slice(), 2));
    } else {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(2 * vertCount), 2));
    }

    // Channel 1: 'uv1' & 'uv2' (Three.js r152+ maps channel 1 to attribute 'uv1')
    if (uv2Count > 0) {
      geometry.setAttribute('uv1', new THREE.BufferAttribute(uv2s, 2));
      geometry.setAttribute('uv2', new THREE.BufferAttribute(uv2s, 2));
    } else if (uvCount > 0) {
      geometry.setAttribute('uv1', new THREE.BufferAttribute(uvs.slice(), 2));
      geometry.setAttribute('uv2', new THREE.BufferAttribute(uvs.slice(), 2));
    } else {
      geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(2 * vertCount), 2));
      geometry.setAttribute('uv2', new THREE.BufferAttribute(new Float32Array(2 * vertCount), 2));
    }

    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  /**
   * Cached load from URL
   */
  async load(url) {
    if (this.cache.has(url)) {
      return this.cache.get(url).clone();
    }
    const geometry = await super.load(url);
    this.cache.set(url, geometry);
    return geometry.clone();
  }
}
