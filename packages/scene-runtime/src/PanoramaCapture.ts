import * as THREE from 'three';

export function capturePanorama(renderer: THREE.WebGLRenderer, scene: THREE.Scene, position: THREE.Vector3, width: number, height: number): Promise<Blob> {
  const cube = new THREE.WebGLCubeRenderTarget(Math.min(2048, width / 4));
  const camera = new THREE.CubeCamera(10, 100000, cube); camera.position.copy(position);
  const output = new THREE.WebGLRenderTarget(width, height); output.texture.colorSpace=THREE.SRGBColorSpace;
  const material = new THREE.ShaderMaterial({
    uniforms: { panorama: { value: cube.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }',
    fragmentShader: 'uniform samplerCube panorama; varying vec2 vUv; void main(){float lon=(vUv.x-.5)*6.2831853;float lat=(vUv.y-.5)*3.1415926;vec3 direction=vec3(sin(lon)*cos(lat),sin(lat),-cos(lon)*cos(lat));gl_FragColor=textureCube(panorama,direction);\n#include <colorspace_fragment>\n}'
  });
  const geometry = new THREE.PlaneGeometry(2,2); const screen = new THREE.Scene(); screen.add(new THREE.Mesh(geometry, material));
  const previous = renderer.getRenderTarget();
  try {
    camera.update(renderer, scene); renderer.setRenderTarget(output); renderer.render(screen, new THREE.Camera());
    const pixels = new Uint8Array(width * height * 4); renderer.readRenderTargetPixels(output,0,0,width,height,pixels);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    const flipped = new Uint8ClampedArray(pixels.length);
    for (let y=0;y<height;y++) flipped.set(pixels.subarray(y*width*4,(y+1)*width*4),(height-y-1)*width*4);
    context.putImageData(new ImageData(flipped,width,height),0,0);
    return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('全景导出失败')), 'image/png'));
  } finally { renderer.setRenderTarget(previous); cube.dispose(); output.dispose(); material.dispose(); geometry.dispose(); }
}
