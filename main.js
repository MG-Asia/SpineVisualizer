// UI Elements
const canvasContainer = document.getElementById('canvasContainer');
const canvasWrapper = document.getElementById('canvasWrapper');
const canvasPlaceholderEl = document.getElementById('canvasPlaceholder');
const jsonInput = document.getElementById('jsonInput');
const atlasInput = document.getElementById('atlasInput');
const pngInput = document.getElementById('pngInput');
const loadButton = document.getElementById('loadButton');
const animationModal = document.getElementById('animationModal');
const validationStatus = document.getElementById('validationStatus');
const animationStatsCount = document.getElementById('animationStatsCount');
const animationStatsSkins = document.getElementById('animationStatsSkins');
const missingAttachments = document.getElementById('missingAttachments');
const animationStats = document.getElementById('animationStats');
const skinSelector = document.getElementById('skinSelector');
const animSelector = document.getElementById('animSelector');
const revalidateButton = document.getElementById('revalidateButton');
const clearFilesButton = document.getElementById('clearFilesButton');
const terminalBox = document.getElementById('terminalBox');
const logCount = document.getElementById('logCount');
const themeToggle = document.getElementById('themeToggle');
const warnBox = document.getElementById('warnBox');

// Get file input display elements (we created explicit display divs in the markup)
const jsonDisplay = document.getElementById('jsonDisplay') || (jsonInput && jsonInput.nextElementSibling);
const atlasDisplay = document.getElementById('atlasDisplay') || (atlasInput && atlasInput.nextElementSibling);
const pngDisplay = document.getElementById('pngDisplay') || (pngInput && pngInput.nextElementSibling);

// PIXI Application
let app = null;
let files = { json: null, atlases: [], images: [] };
let spineObj = null;
let skeletonData = null;
let validationResults = null;
let currentSkin = null;
let isPlaying = false;
let isLooping = true;
let logs = [];
let currentTheme = 'dark';

// Initialize PIXI
function initPixi() {
  // If app exists, destroy it first
  if (app) {
    try { app.destroy(true, { children: true, texture: true, baseTexture: true }); } catch (e) {}
    app = null;
  }

  const w = Math.max(300, canvasContainer.clientWidth || 800);
  const h = Math.max(200, canvasContainer.clientHeight || 600);

  app = new PIXI.Application({
    width: w,
    height: h,
    backgroundColor: 0x2a2a2a,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1
  });

  app.view.style.width = '100%';
  app.view.style.height = '100%';
  app.view.style.display = 'block';

  // Remove any existing canvas but keep placeholder
  const existing = canvasContainer.querySelector('canvas');
  if (existing) existing.remove();
  canvasContainer.appendChild(app.view);

  // Show placeholder only if no spineObj
  if (canvasPlaceholderEl) canvasPlaceholderEl.style.display = spineObj ? 'none' : 'flex';
}

// Logging
function log(message) {
  const timestamp = new Date().toLocaleTimeString();
  const logMsg = `[${timestamp}] ${message}`;
  console.log('[SPINE]', message);
  logs.push(logMsg);
  terminalBox.textContent = logs.join('\n');
  terminalBox.scrollTop = terminalBox.scrollHeight;
  logCount.textContent = logs.length;
}

function clearLogs() {
  logs = [];
  terminalBox.textContent = '';
  logCount.textContent = '0';
}

// File handling
function updateFileDisplays() {
  if (jsonDisplay) {
    jsonDisplay.textContent = files.json ? files.json.name : 'No file selected';
    jsonDisplay.className = files.json ? 'p-2 text-xs text-green-400 pointer-events-none' : 'p-2 text-xs text-gray-400 pointer-events-none';
  }

  if (atlasDisplay) {
    atlasDisplay.textContent = files.atlases.length > 0 ? `${files.atlases.length} file(s) selected` : 'No files selected';
    atlasDisplay.className = files.atlases.length > 0 ? 'p-2 text-xs text-green-400 pointer-events-none' : 'p-2 text-xs text-gray-400 pointer-events-none';
  }

  if (pngDisplay) {
    pngDisplay.textContent = files.images.length > 0 ? `${files.images.length} file(s) selected` : 'No files selected';
    pngDisplay.className = files.images.length > 0 ? 'p-2 text-xs text-green-400 pointer-events-none' : 'p-2 text-xs text-gray-400 pointer-events-none';
  }

  updateLoadButton();
}

function updateLoadButton() {
  const hasAllFiles = files.json && files.atlases.length > 0 && files.images.length > 0;
  loadButton.disabled = !hasAllFiles;
  loadButton.textContent = hasAllFiles ? 'Load & Validate' : 'Missing Files';

  if (hasAllFiles) {
    loadButton.className = 'w-full py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors';
  } else {
    loadButton.className = 'w-full py-2 bg-gray-700 opacity-60 cursor-not-allowed rounded text-sm font-medium';
  }
}

// File input listeners
jsonInput.addEventListener('change', e => {
  files.json = e.target.files[0] || null;
  updateFileDisplays();
});

atlasInput.addEventListener('change', e => {
  files.atlases = Array.from(e.target.files);
  updateFileDisplays();
});

pngInput.addEventListener('change', e => {
  files.images = Array.from(e.target.files);
  updateFileDisplays();
});

// Theme toggle
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    if (currentTheme === 'dark') {
      currentTheme = 'light';
      if (app && app.renderer) {
        app.renderer.backgroundColor = 0xf5f5f5;
      }
      themeToggle.innerHTML = '<span>☀️</span> Light Theme';
      // canvasWrapper.style.background = '#f5f5f5';
      // canvasContainer.style.background = '#ffffff';
    } else {
      currentTheme = 'dark';
      if (app && app.renderer) {
        app.renderer.backgroundColor = 0x2a2a2a;
      }
      themeToggle.innerHTML = '<span>🌙</span> Dark Theme';
      canvasWrapper.style.background = '#1a1a1a';
      canvasContainer.style.background = '#2a2a2a';
    }
  });
}

// Utility: Read file as text
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('No file provided'));
      return;
    }
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file: ' + file.name));
    reader.readAsText(file);
  });
}

// Show warning
function showWarn(msg) {
  if (warnBox) {
    warnBox.style.display = 'block';
    warnBox.textContent = msg;
    warnBox.className = 'absolute top-4 left-4 right-4 p-3 rounded-lg text-sm bg-yellow-900/80 border border-yellow-500/50 text-yellow-200';
  }
}

function showError(msg) {
  if (warnBox) {
    warnBox.style.display = 'block';
    warnBox.textContent = msg;
    warnBox.className = 'absolute top-4 left-4 right-4 p-3 rounded-lg text-sm bg-red-900/80 border border-red-500/50 text-red-200';
  }
}

function clearWarn() {
  if (warnBox) {
    warnBox.style.display = 'none';
    warnBox.textContent = '';
  }
}

// Normalize Spine data structure
function normalizeSpineData(spineData) {
  log(`JSON keys: ${Object.keys(spineData).join(', ')}`);

  if (spineData.skeleton && spineData.animations && Array.isArray(spineData.animations)) {
    return { ...spineData, type: 'standard' };
  } else if (spineData.bones && spineData.slots && spineData.skins) {
    return { ...spineData, type: 'legacy' };
  } else if (spineData.animations && !Array.isArray(spineData.animations)) {
    return {
      ...spineData,
      type: 'object-animations',
      animations: convertAnimationsToArray(spineData.animations)
    };
  } else {
    const hasSkins = spineData.skins && (Array.isArray(spineData.skins) || typeof spineData.skins === 'object');
    const hasAnimations = spineData.animations && (Array.isArray(spineData.animations) || typeof spineData.animations === 'object');
    return {
      ...spineData,
      type: hasSkins && hasAnimations ? 'complex' : 'unknown',
      animations: Array.isArray(spineData.animations) ? spineData.animations : []
    };
  }
}

function convertAnimationsToArray(animationsObj) {
  if (Array.isArray(animationsObj)) return animationsObj;
  if (typeof animationsObj === 'object' && animationsObj !== null) {
    return Object.keys(animationsObj).map(key => ({
      name: key,
      ...animationsObj[key]
    })).filter(anim => anim && anim.name);
  }
  return [];
}

// Extract Spine attachment requirements
function extractSpineAttachmentRequirements(spineData) {
  const textureNames = new Set();

  const resolveRegionName = (attachmentName, attachment) => {
    if (!attachment || typeof attachment !== 'object') return null;
    const candidates = [attachment.name, attachment.path, attachment.region, attachment.parent];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c;
    }
    const type = attachment.type;
    if (!type || ['region', 'mesh', 'weightedmesh', 'linkedmesh'].includes(type)) {
      return attachmentName;
    }
    return null;
  };

  if (spineData && spineData.skins) {
    for (const skinName of Object.keys(spineData.skins)) {
      const skin = spineData.skins[skinName];
      for (const slotName of Object.keys(skin)) {
        const attachments = skin[slotName];
        for (const attachmentName of Object.keys(attachments)) {
          const attachment = attachments[attachmentName];
          const resolved = resolveRegionName(attachmentName, attachment);
          if (resolved) textureNames.add(resolved);
        }
      }
    }
  }

  return {
    atlasRequirements: Array.from(textureNames).sort(),
    definedAttachments: Array.from(textureNames).sort(),
    totalAttachments: textureNames.size,
    totalSkins: spineData.skins ? Object.keys(spineData.skins).length : 0
  };
}

// Collect animations
function collectAnimations(normalizedData) {
  const animations = new Set();

  if (normalizedData.animations) {
    if (Array.isArray(normalizedData.animations)) {
      normalizedData.animations.forEach(anim => {
        if (anim && (anim.name || typeof anim === 'string')) {
          const animName = typeof anim === 'string' ? anim : anim.name;
          animations.add(animName);
        }
      });
    } else if (typeof normalizedData.animations === 'object') {
      Object.keys(normalizedData.animations).forEach(key => {
        animations.add(key);
      });
    }
  }

  return animations;
}

// Validation
async function validateSpineAssets() {
  clearLogs();
  log('Starting validation...');
  validationStatus.textContent = 'Validating...';
  revalidateButton.style.display = 'none';

  try {
    const jsonContent = await readFileAsText(files.json);
    let spineData;
    try {
      spineData = JSON.parse(jsonContent);
      log('JSON parsed successfully');
    } catch (e) {
      throw new Error('Invalid JSON file: ' + e.message);
    }

    const normalizedData = normalizeSpineData(spineData);
    log(`Detected Spine format: ${normalizedData.type}`);

    // Load atlas contents
    log('Loading atlas files...');
    const atlasContents = await Promise.all(
      files.atlases.map((atlasFile, index) =>
        readFileAsText(atlasFile).then(content => ({ content, index }))
      )
    );

    // Create texture map
    const imageMap = {};
    files.images.forEach(imgFile => {
      imageMap[imgFile.name] = URL.createObjectURL(imgFile);
    });

    // Parse atlas and collect regions
    const allRegions = new Set();
    const textureLoader = (line, callback) => {
      const url = imageMap[line.trim()];
      if (!url) {
        callback(null);
        return;
      }
      try {
        const baseTexture = PIXI.BaseTexture.from(url);
        callback(baseTexture);
      } catch (e) {
        log(`Warning: Failed to load texture ${line}: ${e.message}`);
        callback(null);
      }
    };

    for (let { content: atlasContent } of atlasContents) {
      try {
        const atlas = new PIXI.spine.core.TextureAtlas(atlasContent, textureLoader);
        if (atlas.regions) {
          atlas.regions.forEach(region => {
            if (region && region.name) {
              allRegions.add(region.name.toLowerCase());
            }
          });
        }
        log(`Atlas loaded with ${atlas.regions ? atlas.regions.length : 0} regions`);
      } catch (atlasError) {
        log(`Warning: Could not parse atlas - ${atlasError.message}`);
      }
    }

    log(`Total texture regions found: ${allRegions.size}`);

    // Extract requirements
    const report = extractSpineAttachmentRequirements(spineData);

    // Find missing attachments
    const missingAttachmentsList = report.atlasRequirements.filter(att =>
      !allRegions.has(String(att).toLowerCase())
    );

    // Extract animations
    const animations = collectAnimations(normalizedData);

    log(`Found ${animations.size} animations, ${report.totalSkins} skins`);
    log(`Missing attachments: ${missingAttachmentsList.length}`);

    validationResults = {
      totalAttachments: report.totalAttachments,
      totalSkins: report.totalSkins,
      totalAnimations: animations.size,
      missingAttachments: missingAttachmentsList,
      animations: animations
    };

    return validationResults;
  } catch (error) {
    log(`Validation error: ${error.message}`);
    throw error;
  }
}

// Display validation results
function displayValidationResults(validation) {
  animationModal.style.display = 'block';

  if (animationStatsCount) animationStatsCount.textContent = validation.totalAnimations;
  if (animationStatsSkins) animationStatsSkins.textContent = validation.totalSkins;

  if (animationStats) {
    animationStats.innerHTML = `Animations: ${validation.totalAnimations} | Skins: ${validation.totalSkins}`;
  }

  if (validation.missingAttachments.length === 0) {
    if (missingAttachments) {
      missingAttachments.innerHTML = '✅ All attachments found';
      missingAttachments.className = 'text-xs p-2 rounded mb-3 bg-green-900/20 border border-green-500/30 text-green-400';
    }
    if (validationStatus) {
      validationStatus.textContent = '';
      validationStatus.className = 'text-xs p-2 rounded bg-green-900/20 border border-green-500/30 text-green-400';
    }
    loadButton.textContent = 'Load Animation';
    loadButton.className = 'w-full py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors';
  } else {
    if (missingAttachments) {
      missingAttachments.innerHTML = `⚠️ ${validation.missingAttachments.length} missing attachments`;
      missingAttachments.className = 'text-xs p-2 rounded mb-3 cursor-pointer bg-yellow-900/20 border border-yellow-500/30 text-yellow-400';
      missingAttachments.onclick = () => {
        alert(`Missing attachments:\n${validation.missingAttachments.join('\n')}`);
      };
    }
    if (validationStatus) {
      validationStatus.textContent = '';
      validationStatus.className = 'text-xs p-2 rounded bg-yellow-900/20 border border-yellow-500/30 text-yellow-400';
    }
    loadButton.textContent = `Load (${validation.missingAttachments.length} warnings)`;
    loadButton.className = 'w-full py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm font-medium transition-colors';
  }

  revalidateButton.style.display = 'inline-block';
  log(`Validation complete: ${validation.missingAttachments.length} missing`);
}

// Strip deform timelines (fallback for problematic JSON)
function stripDeformTimelines(spineJson) {
  if (!spineJson || !spineJson.animations) return 0;
  let removed = 0;
  const animations = spineJson.animations;

  if (Array.isArray(animations)) {
    animations.forEach(anim => {
      if (anim && typeof anim === 'object' && anim.deform) {
        delete anim.deform;
        removed++;
      }
    });
  } else if (typeof animations === 'object') {
    Object.keys(animations).forEach(key => {
      const anim = animations[key];
      if (anim && typeof anim === 'object' && anim.deform) {
        delete anim.deform;
        removed++;
      }
    });
  }

  return removed;
}

// Load Spine assets
// Load Spine assets
async function loadSpineAssets() {
  if (!files.json || files.atlases.length === 0 || files.images.length === 0) {
    return;
  }

  try {
    clearWarn();
    log('Reading files...');

    // CRITICAL FIX: Ensure PIXI app is initialized
    if (!app || !app.stage) {
      log('Reinitializing PIXI application...');
      initPixi();
    }

    const jsonContent = await readFileAsText(files.json);
    const atlasContents = await Promise.all(
      files.atlases.map(atlasFile => readFileAsText(atlasFile))
    );

    log('Creating texture map...');
    const imageMap = {};
    files.images.forEach(imgFile => {
      imageMap[imgFile.name] = URL.createObjectURL(imgFile);
    });
    log(`Created texture map for ${files.images.length} images`);

    // Texture loader
    function textureLoader(line, callback) {
      const url = imageMap[line.trim()];
      if (!url) {
        callback(null);
        return;
      }
      try {
        const baseTexture = PIXI.BaseTexture.from(url);
        callback(baseTexture);
      } catch (e) {
        log(`Failed to load texture: ${line}`);
        callback(null);
      }
    }

    // Merge atlases
    log('Processing atlas files...');
    let allRegions = [];
    let allPages = [];
    let lastAtlas = null;

    log(`Processing ${atlasContents.length} atlas files...`);
    for (let atlasContent of atlasContents) {
      try {
        const atlas = new PIXI.spine.core.TextureAtlas(atlasContent, textureLoader);
        allRegions = allRegions.concat(atlas.regions || []);
        allPages = allPages.concat(atlas.pages || []);
        lastAtlas = atlas;
        log(`Atlas processed: ${atlas.regions ? atlas.regions.length : 0} regions`);
      } catch (atlasError) {
        log(`Warning: Failed to process atlas - ${atlasError.message}`);
      }
    }

    if (lastAtlas) {
      lastAtlas.regions = allRegions;
      lastAtlas.pages = allPages;
      log(`Merged atlas: ${allRegions.length} total regions`);
    } else {
      throw new Error('No valid atlas files could be processed');
    }

    // Parse JSON
    log('Parsing Spine JSON...');
    const spineData = JSON.parse(jsonContent);
    const spineAtlasLoader = new PIXI.spine.core.AtlasAttachmentLoader(lastAtlas);
    const spineJsonParser = new PIXI.spine.core.SkeletonJson(spineAtlasLoader);

    // Install missing region fallback
    installMissingRegionFallback();

    log('Creating skeleton data...');
    try {
      skeletonData = spineJsonParser.readSkeletonData(spineData);
    } catch (err) {
      if (err && err.message && err.message.includes('Deform attachment not found')) {
        log('⚠️ Parser failed due to deform attachment references. Stripping deform timelines and retrying...');
        const removed = stripDeformTimelines(spineData);
        log(`Removed deform entries from ${removed} animation(s). Retrying parse...`);
        skeletonData = spineJsonParser.readSkeletonData(spineData);
      } else {
        throw err;
      }
    }
    log('Skeleton data created successfully');

    // Create Spine object
    log('Creating Spine object...');
    if (spineObj) {
      app.stage.removeChild(spineObj);
      spineObj.destroy({ children: true, texture: true, baseTexture: true });
    }

    spineObj = new PIXI.spine.Spine(skeletonData);

    // Center and scale
    spineObj.x = 400;
    spineObj.y = 300;

    await new Promise(resolve => requestAnimationFrame(resolve));

    const bounds = spineObj.getBounds();
    const scaleX = (800 * 0.8) / bounds.width;
    const scaleY = (600 * 0.8) / bounds.height;
    spineObj.scale.set(Math.min(scaleX, scaleY, 0.8));

    log(`Bounds: ${Math.round(bounds.width)}x${Math.round(bounds.height)}, Scale: ${spineObj.scale.x.toFixed(2)}`);

  app.stage.addChild(spineObj);
  log('Spine object added to stage');
  if (canvasPlaceholderEl) canvasPlaceholderEl.style.display = 'none';

    // Populate selectors
    populateSelectors();

    // Set defaults
    const skins = getSkins(skeletonData);
    const animations = getAnimations(skeletonData);

    if (skins.length > 0) {
      setSkin(skins[0]);
    }

    if (animations.length > 0) {
      playAnimation(animations[0]);
    }

    log(`✅ Successfully loaded! ${animations.length} animations, ${skins.length} skins`);

    showAnimationModal();

  // Ensure placeholder hidden
  if (canvasPlaceholderEl) canvasPlaceholderEl.style.display = 'none';

  } catch (error) {
    log(`✗✗✗ ERROR: ${error.message}`);
    console.error('Load error:', error);
    showError('Loading failed: ' + error.message);
  }
}

// Install missing region fallback
function installMissingRegionFallback() {
  try {
    const AtlasAttachmentLoader = PIXI.spine.core.AtlasAttachmentLoader;
    if (!AtlasAttachmentLoader.__missingRegionPatched) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 1, 1);
      const dummyBase = PIXI.BaseTexture.from(canvas);

      const orig = AtlasAttachmentLoader.prototype.newRegionAttachment;
      AtlasAttachmentLoader.prototype.newRegionAttachment = function (skin, name, path) {
        try {
          return orig.call(this, skin, name, path);
        } catch (err) {
          const msg = (err && err.message) ? err.message : String(err);
          if (!/Region not found/i.test(msg)) throw err;
          log(`⚠️ Missing region "${name}" — using dummy texture`);

          const fakeRegion = {
            name: name,
            x: 0, y: 0,
            width: 1, height: 1,
            u: 0, v: 0, u2: 1, v2: 1,
            offset: [0, 0, 1, 1],
            originalWidth: 1,
            originalHeight: 1,
            rotate: false,
            page: { rendererObject: dummyBase }
          };

          const RegionAttachment = PIXI.spine.core.RegionAttachment;
          const attachment = new RegionAttachment(name);
          if (typeof attachment.setRegion === 'function') {
            attachment.setRegion(fakeRegion);
          } else {
            attachment.region = fakeRegion;
          }
          return attachment;
        }
      };

      AtlasAttachmentLoader.__missingRegionPatched = true;
    }
  } catch (e) {
    log('Warning: could not install missing-region fallback: ' + (e.message || e));
  }
}

// Get skins from skeleton data
function getSkins(skeletonData) {
  if (skeletonData.skins && Array.isArray(skeletonData.skins)) {
    return skeletonData.skins.map(s => s.name).filter(Boolean);
  } else if (skeletonData.skins && typeof skeletonData.skins === 'object') {
    return Object.keys(skeletonData.skins).filter(k => skeletonData.skins[k] && skeletonData.skins[k].name);
  }
  return ['default'];
}

// Get animations from skeleton data
function getAnimations(skeletonData) {
  if (skeletonData.animations && Array.isArray(skeletonData.animations)) {
    return skeletonData.animations.map(a => a.name).filter(Boolean);
  } else if (skeletonData.animations && typeof skeletonData.animations === 'object') {
    return Object.keys(skeletonData.animations);
  }
  return [];
}

// Populate selectors
function populateSelectors() {
  skinSelector.innerHTML = '<option value="">Select Skin</option>';
  animSelector.innerHTML = '<option value="">Select Animation</option>';

  const skins = getSkins(skeletonData);
  const animations = getAnimations(skeletonData);

  skins.forEach(skin => {
    const opt = document.createElement('option');
    opt.value = skin;
    opt.textContent = skin;
    skinSelector.appendChild(opt);
  });

  animations.forEach(anim => {
    const opt = document.createElement('option');
    opt.value = anim;
    opt.textContent = anim;
    animSelector.appendChild(opt);
  });

  if (skins.length > 0) skinSelector.value = skins[0];
  if (animations.length > 0) animSelector.value = animations[0];

  log(`Populated selectors: ${skins.length} skins, ${animations.length} animations`);
}

// Set skin
function setSkin(skinName) {
  if (spineObj && spineObj.skeleton && skeletonData) {
    try {
      const skin = skinName ? skeletonData.findSkin(skinName) : null;
      if (skin) {
        spineObj.skeleton.setSkin(skin);
        spineObj.skeleton.setSlotsToSetupPose();
        currentSkin = skinName;
        log(`🎨 Applied skin: ${skinName}`);
      }
    } catch (error) {
      log(`Error applying skin ${skinName}: ${error.message}`);
    }
  }
}

// Play animation
function playAnimation(name) {
  if (!spineObj || !spineObj.state) {
    log('Cannot play - spine state not available');
    return;
  }

  if (!spineObj.state.hasAnimation(name)) {
    log(`Animation not found: ${name}`);
    return;
  }

  try {
    spineObj.state.setAnimation(0, name, isLooping);
    isPlaying = true;
    log(`▶️ Playing: ${name}`);
  } catch (error) {
    log(`Error playing animation ${name}: ${error.message}`);
  }
}

// Show animation modal
function showAnimationModal() {
  if (animationModal) {
    animationModal.style.display = 'block';
  }
}

// Clear files and reset
function clearFiles() {
  files = { json: null, atlases: [], images: [] };
  jsonInput.value = '';
  atlasInput.value = '';
  pngInput.value = '';

  // Only remove and destroy the spine object, not the app
  if (spineObj && app && app.stage) {
    app.stage.removeChild(spineObj);
    spineObj.destroy({ children: true, texture: true, baseTexture: true });
    spineObj = null;
  }

  skinSelector.innerHTML = '<option value="">Select Skin</option>';
  animSelector.innerHTML = '<option value="">Select Animation</option>';

  validationResults = null;
  skeletonData = null;
  currentSkin = null;
  isPlaying = false;

  if (animationModal) animationModal.style.display = 'none';
  if (missingAttachments) missingAttachments.innerHTML = '';
  if (animationStats) animationStats.innerHTML = '';
  clearWarn();

  updateFileDisplays();
  clearLogs();
  log('Files cleared. Ready for new upload.');

  // Reset theme
  currentTheme = 'dark';
  if (app && app.renderer) {
    app.renderer.backgroundColor = 0x2a2a2a;
  }
  if (themeToggle) themeToggle.innerHTML = '<span>🌙</span> Dark Theme';
  canvasWrapper.style.background = '#1a1a1a';
  canvasContainer.style.background = '#2a2a2a';
}

// Event Listeners
loadButton.addEventListener('click', async () => {
  try {
    loadButton.disabled = true;

    clearLogs();
    log('Starting validation and loading process...');

    const validation = await validateSpineAssets();
    displayValidationResults(validation);

    if (validation.missingAttachments.length > 0) {
      log(`Found ${validation.missingAttachments.length} missing attachments.`);
      const proceed = confirm(
        `Found ${validation.missingAttachments.length} missing attachments.\n` +
        `Animation may not display correctly.\n\nContinue loading anyway?`
      );
      if (!proceed) {
        log('Load cancelled by user');
        return;
      }
    }

    log('Starting asset loading...');
    await loadSpineAssets();

  } catch (error) {
    log(`Process error: ${error.message}`);
    showError('Process failed: ' + error.message);
    console.error('Load error:', error);
  } finally {
    loadButton.disabled = false;
  }
});

// Skin selector
if (skinSelector) skinSelector.addEventListener('change', e => {
  const skinName = e.target.value;
  if (skinName) setSkin(skinName);
});

// Animation selector
if (animSelector) animSelector.addEventListener('change', e => {
  const animName = e.target.value;
  if (animName) playAnimation(animName);
});

// Re-validate button re-runs the validation step
if (revalidateButton) revalidateButton.addEventListener('click', async () => {
  try {
    clearLogs();
    log('Re-validating assets...');
    const validation = await validateSpineAssets();
    displayValidationResults(validation);
  } catch (e) {
    log('Re-validate failed: ' + (e.message || e));
  }
});

// Clear files
if (clearFilesButton) clearFilesButton.addEventListener('click', clearFiles);

// Initialize
initPixi();
updateFileDisplays();
if (canvasPlaceholderEl) canvasPlaceholderEl.style.display = 'flex';
log('Spine Preview Studio Ready');
log('Upload Spine files to get started');