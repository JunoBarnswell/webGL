import { ShowroomEngine } from '../packages/engine/index.js';
import { LoadingOverlay } from './components/LoadingOverlay.js';
import { NavigationBar } from './components/NavigationBar.js';
import { ShowboxModal } from './components/ShowboxModal.js';
import { AudioControl } from './components/AudioControl.js';
import { ViewModeSwitch } from './components/ViewModeSwitch.js';
import { CruiseControl } from './components/CruiseControl.js';
import { PanoramaToolbar } from './components/PanoramaToolbar.js';

window.addEventListener('DOMContentLoaded', async () => {
  const webglContainer = document.getElementById('webgl-container');
  const uiContainer = document.getElementById('ui-container');

  // 1. Initialize Showroom Engine (SDK Instance)
  const engine = new ShowroomEngine({
    container: webglContainer,
    fov: 60,
    maxDistance: 35000,
    collision: true,
    bgmUrl: '/audio/bgm.mp3'
  });

  // Expose to window for developer inspection / debugging
  window.showroomEngine = engine;

  // 2. Initialize UI Components
  const loadingOverlay = new LoadingOverlay(uiContainer);
  const showboxModal = new ShowboxModal(uiContainer);
  const navigationBar = new NavigationBar(uiContainer, engine);
  const audioControl = new AudioControl(uiContainer, engine);

  // Advanced features UI
  const viewModeSwitch = new ViewModeSwitch(uiContainer, engine);
  const cruiseControl = new CruiseControl(uiContainer, engine);
  const panoramaToolbar = new PanoramaToolbar(uiContainer, engine);

  // 3. Connect Engine Events with UI
  engine.on('progress', ({ percent, loaded, total }) => {
    loadingOverlay.update(percent, loaded, total);
  });

  engine.on('loadComplete', () => {
    loadingOverlay.hide();
    console.log('[Main] 3D Virtual Showroom Loaded Successfully!');
  });

  engine.on('artworkClick', (artwork) => {
    showboxModal.show(artwork);
  });

  // 4. Load Scene, Avatar and Artwork Manifest
  try {
    await engine.loadScene({
      sceneUrl: '/model/showroom/scene.json',
      baseUrl: '/model/showroom',
      manifestUrl: '/artworks/manifest.json',
      avatarUrl: '/model/avatar/character.glb'
    });
  } catch (err) {
    console.error('[Main] Failed to load showroom scene:', err);
    loadingOverlay.text.textContent = '场景加载失败，请检查网络或控制台日志';
  }
});
