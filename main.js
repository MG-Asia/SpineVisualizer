const app = new PIXI.Application({ backgroundColor: 0x1e1e1e, resizeTo: window });
document.body.appendChild(app.view);

const dropZone = document.getElementById('dropZone');
const jsonInput = document.getElementById('jsonInput');
const atlasInput = document.getElementById('atlasInput');
const pngInput = document.getElementById('pngInput');
const animSelector = document.getElementById('animSelector');
const skinSelector = document.getElementById('skinSelector');
const loadButton = document.getElementById('loadButton');
const revalidateButton = document.getElementById('revalidateButton');
const validationStatus = document.getElementById('validationStatus');
const missingAttachments = document.getElementById('missingAttachments');
const animationStats = document.getElementById('animationStats');

let files = { json: null, atlases: [], images: [] };
let spineObj = null;
let skeletonData = null;
let validationResults = null;
let currentSkin = null;

// UI elements
const warnBox = document.getElementById('warnBox');
const terminalBox = document.getElementById('terminalBox');

// Drag & drop
dropZone.addEventListener("dragover", e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener("dragleave", e => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

// File selectors
jsonInput.addEventListener("change", e => {
  files.json = e.target.files[0] || null;
  updateLoadButton();
});
atlasInput.addEventListener("change", e => {
  files.atlases = Array.from(e.target.files);
  updateLoadButton();
});
pngInput.addEventListener("change", e => {
  files.images = Array.from(e.target.files);
  updateLoadButton();
});

function updateLoadButton() {
  const hasAllFiles = files.json && files.atlases.length > 0 && files.images.length > 0;
  loadButton.disabled = !hasAllFiles;
  loadButton.textContent = hasAllFiles ? 'Load & Validate' : 'Missing Files';
  loadButton.className = hasAllFiles ? '' : 'disabled';
}

function handleFiles(fileList) {
  files = { json: null, atlases: [], images: [] };
  for (let f of fileList) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (ext === "json") files.json = f;
    else if (ext === "atlas") files.atlases.push(f);
    else if (ext === "png") files.images.push(f);
  }
  updateLoadButton();
}

function showWarn(msg) {
  warnBox.style.display = 'block';
  warnBox.textContent = msg;
  warnBox.className = 'warning';
}

function showError(msg) {
  warnBox.style.display = 'block';
  warnBox.textContent = msg;
  warnBox.className = 'error';
}

function clearWarn() {
  warnBox.style.display = 'none';
  warnBox.textContent = '';
}

function showTerminal(msg) {
  terminalBox.style.display = 'block';
  const timestamp = new Date().toLocaleTimeString();
  terminalBox.textContent += `\n[${timestamp}] ${msg}`;
  terminalBox.scrollTop = terminalBox.scrollHeight;
}

function clearTerminal() {
  terminalBox.style.display = 'none';
  terminalBox.textContent = '';
}

// **FIXED: Robust validation system with proper error handling**
async function validateSpineAssets() {
  clearWarn();
  clearTerminal();
  validationStatus.textContent = 'Validating...';
  revalidateButton.style.display = 'none';
  
  try {
    // Step 1: Load and parse JSON
    const jsonContent = await readFileAsText(files.json);
    let spineData;
    try {
      spineData = JSON.parse(jsonContent);
      showTerminal('JSON parsed successfully');
    } catch (e) {
      throw new Error('Invalid JSON file: ' + e.message);
    }

    // **FIX: Normalize Spine data structure**
    const normalizedData = normalizeSpineData(spineData);
    showTerminal(`Detected Spine format: ${normalizedData.type}`);

    // Step 2: Load atlas contents
    showTerminal('Loading atlas files...');
    const atlasContents = await Promise.all(
      files.atlases.map((atlasFile, index) => 
        readFileAsText(atlasFile).then(content => ({ content, index }))
      )
    );

    // Step 3: Create texture map
    const imageMap = {};
    files.images.forEach(imgFile => {
      imageMap[imgFile.name] = URL.createObjectURL(imgFile);
    });

    // Step 4: Parse atlas and collect all regions
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
        showTerminal(`Warning: Failed to load texture ${line}: ${e.message}`);
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
        showTerminal(`Atlas loaded with ${atlas.regions ? atlas.regions.length : 0} regions`);
      } catch (atlasError) {
        showTerminal(`Warning: Could not parse atlas - ${atlasError.message}`);
        // Continue with other atlases
      }
    }

    showTerminal(`Total texture regions found: ${allRegions.size}`);

    // Step 5: Validate attachments against atlas regions
    const validation = {
      type: normalizedData.type,
      totalAttachments: 0,
      missingAttachments: [],
      skins: {},
      animations: new Set(),
      warnings: []
    };

    // **FIX: Collect animations safely**
    collectAnimations(normalizedData, validation);

    // **FIX: Collect skins and attachments safely**
    collectSkinsAndAttachments(normalizedData, allRegions, validation);

    validationResults = validation;
    return validation;
  } catch (error) {
    showTerminal(`Validation error: ${error.message}`);
    throw error;
  }
}

// **NEW: Normalize different Spine JSON structures**
function normalizeSpineData(spineData) {
  // Log the structure for debugging
  showTerminal(`JSON keys: ${Object.keys(spineData).join(', ')}`);
  
  if (spineData.skeleton && spineData.animations && Array.isArray(spineData.animations)) {
    // Standard Spine JSON format
    return { ...spineData, type: 'standard' };
  } else if (spineData.bones && spineData.slots && spineData.skins) {
    // Legacy or different export format
    return { ...spineData, type: 'legacy' };
  } else if (spineData.animations && !Array.isArray(spineData.animations)) {
    // Animations might be an object
    return { 
      ...spineData, 
      type: 'object-animations',
      animations: convertAnimationsToArray(spineData.animations)
    };
  } else {
    // Try to detect structure
    const hasSkins = spineData.skins && (Array.isArray(spineData.skins) || typeof spineData.skins === 'object');
    const hasAnimations = spineData.animations && (Array.isArray(spineData.animations) || typeof spineData.animations === 'object');
    
    return { 
      ...spineData, 
      type: hasSkins && hasAnimations ? 'complex' : 'unknown',
      animations: Array.isArray(spineData.animations) ? spineData.animations : []
    };
  }
}

// **NEW: Convert animations object to array**
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

// **NEW: Collect animations safely**
function collectAnimations(spineDataNormalized, validation) {
  const { type, animations } = spineDataNormalized;
  
  let animationCount = 0;
  
  switch (type) {
    case 'standard':
    case 'legacy':
      if (Array.isArray(animations)) {
        animations.forEach(anim => {
          if (anim && (anim.name || typeof anim === 'string')) {
            const animName = typeof anim === 'string' ? anim : anim.name;
            validation.animations.add(animName);
            animationCount++;
          }
        });
      }
      break;
      
    case 'object-animations':
      if (Array.isArray(animations)) {
        animations.forEach(anim => {
          if (anim && anim.name) {
            validation.animations.add(anim.name);
            animationCount++;
          }
        });
      }
      break;
      
    case 'complex':
      // Try multiple possible locations
      const possibleAnimationLocations = [
        spineDataNormalized.animations,
        spineDataNormalized.animation,
        spineDataNormalized.data?.animations,
        spineDataNormalized.skeleton?.animations
      ];
      
      possibleAnimationLocations.forEach(location => {
        if (Array.isArray(location)) {
          location.forEach(anim => {
            if (anim && (anim.name || typeof anim === 'string')) {
              const animName = typeof anim === 'string' ? anim : anim.name;
              if (!validation.animations.has(animName)) {
                validation.animations.add(animName);
                animationCount++;
              }
            }
          });
        } else if (location && typeof location === 'object') {
          Object.keys(location).forEach(key => {
            const anim = location[key];
            if (anim && (anim.name || key)) {
              const animName = anim.name || key;
              if (!validation.animations.has(animName)) {
                validation.animations.add(animName);
                animationCount++;
              }
            }
          });
        }
      });
      break;
      
    default:
      showTerminal(`Warning: Unknown Spine JSON format, trying fallback animation extraction`);
      animationCount += extractAnimationsFallback(spineDataNormalized, validation);
  }
  
  showTerminal(`Found ${animationCount} animations`);
}

// **NEW: Fallback animation extraction**
function extractAnimationsFallback(data, validation) {
  let count = 0;
  function findAnimations(obj, path = '') {
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        if (item && typeof item === 'object' && (item.name || item.animation)) {
          const animName = item.name || item.animation || `anim_${path}_${index}`;
          if (!validation.animations.has(animName)) {
            validation.animations.add(animName);
            count++;
          }
        } else if (item && typeof item === 'object') {
          findAnimations(item, `${path}[${index}]`);
        }
      });
    } else if (obj && typeof obj === 'object') {
      Object.entries(obj).forEach(([key, value]) => {
        if (value && typeof value === 'object' && (value.name || value.animation)) {
          const animName = value.name || value.animation || key;
          if (!validation.animations.has(animName)) {
            validation.animations.add(animName);
            count++;
          }
        } else if (value && typeof value === 'object') {
          findAnimations(value, `${path}.${key}`);
        }
      });
    }
  }
  
  findAnimations(data);
  return count;
}

// **NEW: Collect skins and attachments safely**
function collectSkinsAndAttachments(spineDataNormalized, allRegions, validation) {
  // Robust handling for both object-mapped skins (Spine JSON) and array-style skins
  const skinsRoot = spineDataNormalized.skins;
  if (!skinsRoot) {
    // fallback to default attachments check
    checkDefaultAttachments(spineDataNormalized, allRegions, validation);
    showTerminal('No skins found in JSON, checked default slot attachments');
    return;
  }

  function ensureSkinEntry(name) {
    if (!validation.skins[name]) {
      validation.skins[name] = { attachments: {}, missing: [], total: 0 };
    }
  }

  function addMissing(skinName, slotName, attachmentName) {
    const missingEntry = { skin: skinName, slot: slotName || 'unknown', attachment: attachmentName };
    const exists = validation.missingAttachments.some(m =>
      m.skin === missingEntry.skin && m.slot === missingEntry.slot && m.attachment === missingEntry.attachment
    );
    if (!exists) {
      validation.missingAttachments.push(missingEntry);
      validation.skins[skinName].missing.push(attachmentName);
    }
  }

  function markFound(skinName, attachmentName) {
    validation.skins[skinName].attachments[attachmentName] = true;
  }

  // Helper: determine if an attachment should be validated against atlas regions
  function isTextureAttachment(att) {
    if (typeof att === 'string') return true; // string name -> likely a region
    if (!att || typeof att !== 'object') return true;
    const type = (att.type || '').toLowerCase();
    // Only these attachment types reference textures/regions
    return type === '' || type === 'region' || type === 'mesh' || type === 'skinnedmesh' || type === 'linkedmesh';
  }

  // Helper: get the actual image/region name for an attachment object
  function getAttachmentImageName(attObj, fallbackKey) {
    if (typeof attObj === 'string') return attObj;
    if (!attObj || typeof attObj !== 'object') return fallbackKey || null;
    // common keys that identify which atlas region to use
    return attObj.path || attObj.name || attObj.image || fallbackKey || null;
  }

  function processSlotAttachments(skinName, slotName, slotAttachments) {
    if (slotAttachments == null) return;

    // array of attachments (legacy or alternative formats)
    if (Array.isArray(slotAttachments)) {
      slotAttachments.forEach(att => {
        let attName = null;
        if (typeof att === 'string') attName = att;
        else if (att && typeof att === 'object') attName = getAttachmentImageName(att, null);
        if (!attName) return;
        // skip non-texture attachments (e.g. clipping, boundingbox, path)
        if (att && typeof att === 'object' && !isTextureAttachment(att)) return;
        validation.skins[skinName].total++;
        validation.totalAttachments++;
        const region = attName.toLowerCase();
        if (!allRegions.has(region)) addMissing(skinName, slotName, attName);
        else markFound(skinName, attName);
      });
      return;
    }

    // object mapping: attachmentName -> attachmentData (this is the most common Spine JSON format)
    if (typeof slotAttachments === 'object') {
      const keys = Object.keys(slotAttachments);
      keys.forEach(k => {
        const attObj = slotAttachments[k];
        // Some attachment objects are metadata (clipping etc.). Determine image name and type.
        const attName = k || getAttachmentImageName(attObj, k) || null;
        if (!attName) return;
        // If attachment object exists and is non-texture, skip it (e.g. clipping mask)
        if (attObj && !isTextureAttachment(attObj)) {
          // skip validation for non-texture attachment types like clipping
          return;
        }
        validation.skins[skinName].total++;
        validation.totalAttachments++;
        const region = attName.toLowerCase();
        if (!allRegions.has(region)) addMissing(skinName, slotName, attName);
        else markFound(skinName, attName);
      });
      return;
    }

    // string (single attachment name)
    if (typeof slotAttachments === 'string') {
      const attName = slotAttachments;
      validation.skins[skinName].total++;
      validation.totalAttachments++;
      if (!allRegions.has(attName.toLowerCase())) addMissing(skinName, slotName, attName);
      else markFound(skinName, attName);
    }
  }

  // If skins is an array (rare) each skin might have its own shape
  if (Array.isArray(skinsRoot)) {
    Object.values(skinsRoot).forEach(skin => {
      const skinName = skin && (skin.name || skin.skin) ? (skin.name || skin.skin) : 'default';
      ensureSkinEntry(skinName);
      // root of attachments may be the skin object itself or skin.attachments / skin.slots
      const root = skin.attachments || skin.slots || skin;
      if (!root || typeof root !== 'object') return;
      Object.entries(root).forEach(([slotName, slotAttachments]) => {
        processSlotAttachments(skinName, slotName, slotAttachments);
      });
    });
  } else if (typeof skinsRoot === 'object') {
    // Common Spine JSON: skins is an object mapping skinName -> { slotName -> { attachmentName -> data } }
    Object.entries(skinsRoot).forEach(([skinName, skinContent]) => {
      const name = skinName || 'default';
      ensureSkinEntry(name);
      if (!skinContent || typeof skinContent !== 'object') return;
      // skinContent usually maps slotName -> { attachmentName -> data }
      const root = skinContent.attachments || skinContent.slots || skinContent;
      Object.entries(root).forEach(([slotName, slotAttachments]) => {
        processSlotAttachments(name, slotName, slotAttachments);
      });
    });
  }

  // If no skins discovered (defensive), check default attachments from slots
  if (Object.keys(validation.skins).length === 0) {
    checkDefaultAttachments(spineDataNormalized, allRegions, validation);
  }

  showTerminal(`Attachment validation complete: ${validation.totalAttachments} total, ${validation.missingAttachments.length} missing`);
}
// ...existing code...

function displayValidationResults(validation) {
  validationStatus.textContent = '';
  
  // Update missing attachments display
  if (validation.missingAttachments.length > 0) {
    missingAttachments.innerHTML = `⚠️ ${validation.missingAttachments.length} missing attachments`;
    missingAttachments.className = 'warning';
    missingAttachments.onclick = () => showMissingDetails(validation.missingAttachments);
    validationStatus.className = 'warning';
  } else {
    missingAttachments.innerHTML = '✅ All attachments found';
    missingAttachments.className = 'success';
    missingAttachments.onclick = null;
    validationStatus.className = 'success';
  }

  // Update animation stats
  const skinCount = Object.keys(validation.skins).length;
  animationStats.innerHTML = `Animations: ${validation.animations.size} | Skins: ${skinCount}`;
  
  // Update load button
  if (validation.missingAttachments.length === 0) {
    loadButton.textContent = 'Load Animation';
    loadButton.className = 'success';
  } else {
    loadButton.textContent = `Load (${validation.missingAttachments.length} warnings)`;
    loadButton.className = 'warning';
  }

  revalidateButton.style.display = 'inline-block';
  showTerminal(`Validation complete: ${validation.type} format, ${validation.totalAttachments} attachments checked, ${validation.missingAttachments.length} missing`);
}

function showMissingDetails(missing) {
  const details = missing.map(m => 
    `${m.skin}.${m.slot}: ${m.attachment}`
  ).join('\n');
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.8); z-index: 1000; display: flex;
    align-items: center; justify-content: center;
  `;
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: #333; color: #ff6666; padding: 20px; border-radius: 8px;
    max-width: 500px; max-height: 400px; overflow: auto;
    font-family: monospace; font-size: 12px;
  `;
  
  content.innerHTML = `
    <h3>Missing Attachments (${missing.length})</h3>
    <pre>${details}</pre>
    <button onclick="this.parentElement.parentElement.remove()" 
            style="margin-top: 10px; padding: 5px 10px; background: #555; color: white; border: none; border-radius: 3px; cursor: pointer;">
      Close
    </button>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
}

// **ENHANCED: Smart skin-specific animation selector**
function populateSelectorsWithSkinAwareness() {
  if (!skeletonData) return;

  // Clear selectors
  animSelector.innerHTML = '<option value="">Select Animation</option>';
  skinSelector.innerHTML = '<option value="">Select Skin</option>';

  // **FIX: Get skins properly from skeletonData**
  let skins = [];
  if (skeletonData.skins && Array.isArray(skeletonData.skins)) {
    skins = skeletonData.skins;
  } else if (skeletonData.skins && typeof skeletonData.skins === 'object') {
    // If skins is an object, convert to array
    skins = Object.values(skeletonData.skins).filter(s => s && s.name);
  }

  // Populate skins
  if (skins.length > 0) {
    skins.forEach(skin => {
      if (skin && skin.name) {
        const opt = document.createElement('option');
        opt.value = skin.name;
        opt.textContent = skin.name;
        skinSelector.appendChild(opt);
      }
    });
  } else {
    // Add default option
    const opt = document.createElement('option');
    opt.value = "default";
    opt.textContent = "Default";
    skinSelector.appendChild(opt);
  }

  // **FIX: Get animations properly**
  let animations = [];
  if (skeletonData.animations && Array.isArray(skeletonData.animations)) {
    animations = skeletonData.animations;
  } else if (skeletonData.animations && typeof skeletonData.animations === 'object') {
    animations = Object.values(skeletonData.animations).filter(a => a && a.name);
  }

  // Populate animations
  animations.forEach(anim => {
    if (anim && (anim.name || typeof anim === 'string')) {
      const animName = typeof anim === 'string' ? anim : anim.name;
      const opt = document.createElement('option');
      opt.value = animName;
      opt.textContent = animName;
      animSelector.appendChild(opt);
    }
  });

  // Set default selections
  if (skins.length > 0) {
    skinSelector.value = skins[0].name;
  }
  if (animations.length > 0) {
    animSelector.value = animations[0].name || animations[0];
  }

  // Update visual feedback if we have validation results
  if (validationResults) {
    updateSelectorVisuals();
  }

  showTerminal(`Populated selectors: ${skins.length} skins, ${animations.length} animations`);
}

function updateAnimationSelectorForSkin(skinName) {
  if (!skeletonData) return;

  // Clear and repopulate animations
  animSelector.innerHTML = '<option value="">Select Animation</option>';
  
  let animations = [];
  if (skeletonData.animations && Array.isArray(skeletonData.animations)) {
    animations = skeletonData.animations;
  } else if (skeletonData.animations && typeof skeletonData.animations === 'object') {
    animations = Object.values(skeletonData.animations).filter(a => a && a.name);
  }

  animations.forEach(anim => {
    if (anim && (anim.name || typeof anim === 'string')) {
      const animName = typeof anim === 'string' ? anim : anim.name;
      const opt = document.createElement('option');
      opt.value = animName;
      opt.textContent = animName;
      
      // Apply visual feedback based on validation
      if (validationResults && skinName && validationResults.skins[skinName]) {
        const hasMissing = validationResults.skins[skinName].missing.length > 0;
        if (hasMissing) {
          opt.className = 'has-missing';
          opt.title = `${skinName} has ${validationResults.skins[skinName].missing.length} missing attachments`;
        }
      }
      
      animSelector.appendChild(opt);
    }
  });

  updateSelectorVisuals();
}

function updateSelectorVisuals() {
  // Add CSS classes for visual feedback
  const currentSkin = skinSelector.value;
  const skinOptions = Array.from(skinSelector.options);
  const animOptions = Array.from(animSelector.options);
  
  skinOptions.forEach(opt => {
    if (opt.value === currentSkin) {
      opt.selected = true;
    }
    // Mark skins with missing attachments
    if (validationResults && validationResults.skins[opt.value] && 
        validationResults.skins[opt.value].missing.length > 0) {
      opt.className = 'has-missing';
    } else {
      opt.className = '';
    }
  });

  animOptions.forEach(opt => {
    if (opt.value && currentSkin && !canAnimationPlayWithSkin(opt.value, currentSkin)) {
      opt.className = 'unavailable';
    } else {
      opt.className = '';
    }
  });
}

function canAnimationPlayWithSkin(animName, skinName) {
  if (!validationResults || !validationResults.skins[skinName]) {
    return true; // Assume it's fine if no validation data
  }
  
  const skinData = validationResults.skins[skinName];
  // If skin has some valid attachments, assume animations can play
  return (skinData.attachments && Object.keys(skinData.attachments).length > 0) ||
         (skinData.total === 0); // If no attachments defined, assume it's okay
}

// **NEW: Load button handler**
loadButton.addEventListener('click', async () => {
  try {
    loadButton.disabled = true;
    loadButton.textContent = 'Loading...';
    loadButton.className = 'loading';
    
    clearTerminal();
    showTerminal('Starting validation and loading process...');
    
    // First validate
    const validation = await validateSpineAssets();
    displayValidationResults(validation);
    
    if (validation.missingAttachments.length > 0) {
      showTerminal(`Found ${validation.missingAttachments.length} missing attachments.`);
      const proceed = confirm(
        `Found ${validation.missingAttachments.length} missing attachments.\n` +
        `Animation may not display correctly.\n\nContinue loading anyway?`
      );
      if (!proceed) {
        showTerminal('Load cancelled by user');
        return;
      }
    }
    
    showTerminal('Starting asset loading...');
    // Then load
    await loadSpineAssets();
    
  } catch (error) {
    showError('Process failed: ' + error.message);
    showTerminal('Process error: ' + error.message);
    console.error('Load error:', error);
  } finally {
    loadButton.disabled = false;
    loadButton.textContent = validationResults && validationResults.missingAttachments.length > 0 
      ? `Reload (${validationResults.missingAttachments.length} warnings)` 
      : 'Reload';
    loadButton.className = validationResults && validationResults.missingAttachments.length > 0 
      ? 'warning' 
      : 'success';
  }
});

revalidateButton.addEventListener('click', async () => {
  try {
    revalidateButton.disabled = true;
    revalidateButton.textContent = 'Validating...';
    const validation = await validateSpineAssets();
    displayValidationResults(validation);
    if (skeletonData) {
      populateSelectorsWithSkinAwareness();
    }
  } catch (error) {
    showError('Re-validation failed: ' + error.message);
  } finally {
    revalidateButton.disabled = false;
    revalidateButton.textContent = 'Re-validate';
  }
});

// **ENHANCED: Actual loading after validation**
async function loadSpineAssets() {
  if (!files.json || files.atlases.length === 0 || files.images.length === 0) {
    showWarn('Please select all required files first.');
    return;
  }

  clearTerminal();
  showTerminal('Loading Spine assets...');

  try {
    const jsonContent = await readFileAsText(files.json);
    const atlasContents = await Promise.all(
      files.atlases.map(atlasFile => readFileAsText(atlasFile))
    );

    // Create image map
    const imageMap = {};
    files.images.forEach(imgFile => {
      imageMap[imgFile.name] = URL.createObjectURL(imgFile);
    });
    showTerminal(`Created texture map for ${files.images.length} images`);

    // Custom texture loader
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
        showTerminal(`Failed to load texture: ${line}`);
        callback(null);
      }
    }

    // Merge all atlas regions/pages
    let allRegions = [];
    let allPages = [];
    let lastAtlas = null;
    
    showTerminal(`Processing ${atlasContents.length} atlas files...`);
    for (let atlasContent of atlasContents) {
      try {
        const atlas = new PIXI.spine.core.TextureAtlas(atlasContent, textureLoader);
        allRegions = allRegions.concat(atlas.regions || []);
        allPages = allPages.concat(atlas.pages || []);
        lastAtlas = atlas;
        showTerminal(`Atlas processed: ${atlas.regions ? atlas.regions.length : 0} regions`);
      } catch (atlasError) {
        showTerminal(`Warning: Failed to process atlas - ${atlasError.message}`);
      }
    }

    if (lastAtlas) {
      lastAtlas.regions = allRegions;
      lastAtlas.pages = allPages;
      showTerminal(`Merged atlas: ${allRegions.length} total regions`);
    } else {
      throw new Error('No valid atlas files could be processed');
    }

    // Parse JSON
    showTerminal('Parsing Spine JSON...');
    const spineData = JSON.parse(jsonContent);
    const spineAtlasLoader = new PIXI.spine.core.AtlasAttachmentLoader(lastAtlas);
    const spineJsonParser = new PIXI.spine.core.SkeletonJson(spineAtlasLoader);

    // Enhanced error handling for missing attachments
    const originalReadAttachment = spineJsonParser.readAttachment.bind(spineJsonParser);
    spineJsonParser.readAttachment = function(map, skin, slotIndex, name) {
      try {
        return originalReadAttachment(map, skin, slotIndex, name);
      } catch (err) {
        if (err.message && err.message.includes("Region not found")) {
          showTerminal(`⚠️ Skipping missing attachment: ${name} (slot ${slotIndex})`);
          return null; // Graceful fallback
        }
        throw err; // Re-throw other errors
      }
    };

    showTerminal('Creating skeleton data...');
    skeletonData = spineJsonParser.readSkeletonData(spineData);
    showTerminal('Skeleton data created successfully');

    // Create and setup Spine object
    showTerminal('Creating Spine object...');
    if (spineObj) {
      app.stage.removeChild(spineObj);
      spineObj.destroy({ children: true, texture: true, baseTexture: true });
    }

    spineObj = new PIXI.spine.Spine(skeletonData);
    
    // Auto-center and scale
    spineObj.x = app.renderer.width / 2;
    spineObj.y = app.renderer.height / 2;
    
    // Wait one frame for bounds to be calculated
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    const bounds = spineObj.getBounds();
    const scaleX = (app.renderer.width * 0.8) / bounds.width;
    const scaleY = (app.renderer.height * 0.8) / bounds.height;
    spineObj.scale.set(Math.min(scaleX, scaleY, 0.8));
    
    showTerminal(`Bounds: ${Math.round(bounds.width)}x${Math.round(bounds.height)}, Scale: ${spineObj.scale.x.toFixed(2)}`);

    app.stage.addChild(spineObj);
    showTerminal('Spine object added to stage');

    // Populate selectors with skin awareness
    populateSelectorsWithSkinAwareness();

    // Set default skin and animation
    const defaultSkinName = getDefaultSkinName(skeletonData);
    if (defaultSkinName) {
      setSkin(defaultSkinName);
    }
    
    const animations = getAvailableAnimations(skeletonData);
    if (animations.length > 0) {
      playAnimation(animations[0]);
    }

    showTerminal(`✅ Successfully loaded! ${animations.length} animations, ${getSkinCount(skeletonData)} skins`);
    validationStatus.textContent = 'Loaded successfully';
    validationStatus.className = 'success';

  } catch (error) {
    showError('Loading failed: ' + error.message);
    showTerminal(`Load error: ${error.message}\nStack: ${error.stack}`);
    console.error('Load error:', error);
  }
}

// **NEW: Helper functions for skeleton data**
function getDefaultSkinName(skeletonData) {
  if (skeletonData.skins && Array.isArray(skeletonData.skins)) {
    const defaultSkin = skeletonData.skins.find(s => s.name === 'default') || skeletonData.skins[0];
    return defaultSkin ? defaultSkin.name : 'default';
  }
  return 'default';
}

function getAvailableAnimations(skeletonData) {
  if (skeletonData.animations && Array.isArray(skeletonData.animations)) {
    return skeletonData.animations.filter(a => a && a.name);
  } else if (skeletonData.animations && typeof skeletonData.animations === 'object') {
    return Object.values(skeletonData.animations).filter(a => a && a.name);
  }
  return [];
}

function getSkinCount(skeletonData) {
  if (skeletonData.skins && Array.isArray(skeletonData.skins)) {
    return skeletonData.skins.length;
  } else if (skeletonData.skins && typeof skeletonData.skins === 'object') {
    return Object.keys(skeletonData.skins).length;
  }
  return 0;
}

function setSkin(skinName) {
  if (spineObj && spineObj.skeleton && skeletonData) {
    try {
      const skin = skinName ? skeletonData.findSkin(skinName) : null;
      if (skin) {
        spineObj.skeleton.setSkin(skin);
        spineObj.skeleton.setSlotsToSetupPose();
        currentSkin = skinName;
        
        // Update animation selector for this skin
        updateAnimationSelectorForSkin(skinName);
        
        showTerminal(`🎨 Applied skin: ${skinName}`);
        
        // Check for missing attachments in current skin
        if (validationResults && validationResults.skins[skinName]) {
          const missingCount = validationResults.skins[skinName].missing.length;
          if (missingCount > 0) {
            showTerminal(`⚠️ Skin ${skinName} has ${missingCount} missing attachments`);
          }
        }
      } else {
        showTerminal(`❌ Skin not found: ${skinName}. Available skins: ${getSkinNames(skeletonData).join(', ')}`);
      }
    } catch (error) {
      showTerminal(`Error applying skin ${skinName}: ${error.message}`);
    }
  }
}

function getSkinNames(skeletonData) {
  if (skeletonData.skins && Array.isArray(skeletonData.skins)) {
    return skeletonData.skins.map(s => s.name).filter(Boolean);
  } else if (skeletonData.skins && typeof skeletonData.skins === 'object') {
    return Object.keys(skeletonData.skins).filter(k => skeletonData.skins[k] && skeletonData.skins[k].name);
  }
  return ['default'];
}

function playAnimation(name) {
  if (!spineObj || !spineObj.state) {
    showTerminal('❌ No Spine object available');
    return;
  }

  if (!spineObj.state.hasAnimation(name)) {
    showTerminal(`❌ Animation not found: ${name}`);
    return;
  }

  // Check if animation is suitable for current skin
  if (currentSkin && !canAnimationPlayWithSkin(name, currentSkin)) {
    const proceed = confirm(
      `Warning: Animation "${name}" may not display correctly with skin "${currentSkin}" ` +
      `(missing attachments). Continue anyway?`
    );
    if (!proceed) return;
  }

  try {
    spineObj.state.setAnimation(0, name, true);
    showTerminal(`▶️ Playing: ${name} (${currentSkin || 'default'})`);
  } catch (error) {
    showTerminal(`Error playing animation ${name}: ${error.message}`);
  }
}

// Event listeners
skinSelector.addEventListener("change", e => {
  const skinName = e.target.value;
  if (skinName) {
    setSkin(skinName);
  }
});

animSelector.addEventListener("change", e => {
  const animName = e.target.value;
  if (animName) {
    playAnimation(animName);
  }
});

// Utility function
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

// Window resize handler
window.addEventListener('resize', () => {
  if (spineObj) {
    spineObj.x = app.renderer.width / 2;
    spineObj.y = app.renderer.height / 2;
    
    // Wait for next frame to get accurate bounds
    requestAnimationFrame(() => {
      if (spineObj) {
        const bounds = spineObj.getBounds();
        const scaleX = (app.renderer.width * 0.8) / bounds.width;
        const scaleY = (app.renderer.height * 0.8) / bounds.height;
        spineObj.scale.set(Math.min(scaleX, scaleY, 0.8));
      }
    });
  }
});

// **NEW: Debug function - press F12 to see JSON structure**
document.addEventListener('keydown', (e) => {
  if (e.key === 'F12' && files.json) {
    e.preventDefault();
    readFileAsText(files.json).then(jsonContent => {
      try {
        const data = JSON.parse(jsonContent);
        console.log('=== SPINE JSON DEBUG INFO ===');
        console.log('Keys:', Object.keys(data));
        console.log('Animations:', data.animations);
        console.log('Skins:', data.skins);
        console.log('Structure type:', normalizeSpineData(data).type);
        console.log('Full data:', data);
        showTerminal('Check browser console (F12) for JSON structure debug info');
      } catch (error) {
        console.error('Debug error:', error);
      }
    });
  }
});

// Initialize
updateLoadButton();
clearTerminal();
showTerminal('Spine Animation Preview Tool Ready\nDrop files or use the file inputs to get started');