const app = new PIXI.Application({ backgroundColor: 0x1e1e1e, resizeTo: window });
document.body.appendChild(app.view);

const dropZone = document.getElementById('dropZone');
const jsonInput = document.getElementById('jsonInput');
const atlasInput = document.getElementById('atlasInput');
const pngInput = document.getElementById('pngInput');
const animSelector = document.getElementById('animSelector');
let files = {
  json: null,
  atlases: [],
  images: []
};
let spineObj = null;

// Get warn and terminal boxes
const warnBox = document.getElementById('warnBox');
const terminalBox = document.getElementById('terminalBox');

// **NEW: Skin selector**
const skinSelector = document.getElementById('skinSelector');

// Drag & drop
dropZone.addEventListener("dragover", e => e.preventDefault());
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  handleFiles(e.dataTransfer.files);
});

// File selectors for each input
jsonInput.addEventListener("change", e => {
  files.json = e.target.files[0] || null;
  checkAndLoadSpine();
});
atlasInput.addEventListener("change", e => {
  files.atlases = Array.from(e.target.files);
  checkAndLoadSpine();
});
pngInput.addEventListener("change", e => {
  files.images = Array.from(e.target.files);
  checkAndLoadSpine();
});

function handleFiles(fileList) {
  // Accept multiple .atlas and .png files
  files = { json: null, atlases: [], images: [] };
  for (let f of fileList) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (ext === "json") files.json = f;
    else if (ext === "atlas") files.atlases.push(f);
    else if (ext === "png") files.images.push(f);
  }
  checkAndLoadSpine();
}

function checkAndLoadSpine() {
  if (files.json && files.atlases.length > 0 && files.images.length > 0) {
    // Read JSON as text
    const readerJson = new FileReader();
    readerJson.onload = function(e) {
      const jsonContent = e.target.result;
      // Read all atlas files
      let atlasContents = [];
      let loaded = 0;
      files.atlases.forEach((atlasFile, i) => {
        const readerAtlas = new FileReader();
        readerAtlas.onload = function(e2) {
          atlasContents[i] = e2.target.result;
          loaded++;
          if (loaded === files.atlases.length) {
            loadSpine(jsonContent, atlasContents, files.images);
          }
        };
        readerAtlas.readAsText(atlasFile);
      });
    };
    readerJson.readAsText(files.json);
  }
}

function showWarn(msg) {
  warnBox.style.display = 'block';
  warnBox.textContent = msg;
}
function clearWarn() {
  warnBox.style.display = 'none';
  warnBox.textContent = '';
}
function showTerminal(msg) {
  terminalBox.style.display = 'block';
  terminalBox.textContent += '\n' + msg; // Append for log history
  terminalBox.scrollTop = terminalBox.scrollHeight;
}
function clearTerminal() {
  terminalBox.style.display = 'none';
  terminalBox.textContent = '';
}

// **NEW: Set skin function**
function setSkin(skinName) {
  if (spineObj && spineObj.skeleton && spineObj.skeleton.data.skins) {
    const skin = spineObj.skeleton.data.findSkin(skinName);
    if (skin) {
      spineObj.skeleton.setSkin(skin);
      spineObj.skeleton.setSlotsToSetupPose(); // Reset slots to default positions
      showTerminal(`Applied skin: ${skinName}`);
    } else {
      showTerminal(`Skin not found: ${skinName}`);
    }
  }
}

// **NEW: Play animation function with skin preservation**
function playAnimation(name) {
  if (spineObj && spineObj.state.hasAnimation(name)) {
    spineObj.state.setAnimation(0, name, true);
    showTerminal(`Playing animation: ${name}`);
  } else {
    showTerminal(`Animation not found: ${name}`);
  }
}

function loadSpine(jsonContent, atlasContents, imageFiles) {
  clearWarn();
  clearTerminal();

  // Map image file names to object URLs
  const imageMap = {};
  imageFiles.forEach(imgFile => {
    imageMap[imgFile.name] = URL.createObjectURL(imgFile);
  });

  // Custom texture loader for TextureAtlas
  function textureLoader(line, callback) {
    const url = imageMap[line.trim()];
    if (!url) {
      // Let pixi-spine throw its own error
      callback(null);
      return;
    }
    const baseTexture = PIXI.BaseTexture.from(url);
    callback(baseTexture);
  }

  // Merge all atlas regions/pages into one atlas
  let allRegions = [];
  let allPages = [];
  let lastAtlas = null;
  atlasContents.forEach(atlasContent => {
    const atlas = new PIXI.spine.core.TextureAtlas(atlasContent, textureLoader);
    allRegions = allRegions.concat(atlas.regions);
    allPages = allPages.concat(atlas.pages);
    lastAtlas = atlas;
  });

  // Merge all regions/pages into lastAtlas for the loader
  if (lastAtlas) {
    lastAtlas.regions = allRegions;
    lastAtlas.pages = allPages;
  }

  // Parse JSON and create skeleton
  let spineData;
  try {
    spineData = JSON.parse(jsonContent);
  } catch (e) {
    showTerminal('Invalid JSON file.');
    return;
  }

  try {
    const spineAtlasLoader = new PIXI.spine.core.AtlasAttachmentLoader(lastAtlas);
    const spineJsonParser = new PIXI.spine.core.SkeletonJson(spineAtlasLoader);

    // Patch: catch missing attachment warnings and show in terminalBox, but do not block rendering
    const originalReadAttachment = spineJsonParser.readAttachment.bind(spineJsonParser);
    spineJsonParser.readAttachment = function(map, skin, slotIndex, name) {
      try {
        return originalReadAttachment(map, skin, slotIndex, name);
      } catch (err) {
        // Only warn for missing attachments, not for other errors
        if (err && err.message && err.message.startsWith("Region not found in atlas")) {
          showTerminal("Warning: " + err.message);
          return null; // skip this attachment, render nothing
        }
        throw err;
      }
    };

    const skeletonData = spineJsonParser.readSkeletonData(spineData);

    if (spineObj) app.stage.removeChild(spineObj);

    spineObj = new PIXI.spine.Spine(skeletonData);
    
    // **ENHANCED: Better centering and scaling**
    spineObj.x = app.renderer.width / 2;
    spineObj.y = app.renderer.height / 2;
    
    // Auto-scale to fit screen
    const bounds = spineObj.getBounds();
    const scaleX = (app.renderer.width * 0.8) / bounds.width;
    const scaleY = (app.renderer.height * 0.8) / bounds.height;
    spineObj.scale.set(Math.min(scaleX, scaleY, 1)); // Don't scale larger than original
    
    app.stage.addChild(spineObj);

    // **ENHANCED: Populate animation dropdown**
    animSelector.innerHTML = '<option value="">Select Animation</option>';
    const anims = spineObj.spineData.animations || [];
    anims.forEach(anim => {
      let opt = document.createElement("option");
      opt.value = anim.name;
      opt.textContent = anim.name;
      animSelector.appendChild(opt);
    });

    // **NEW: Populate skin dropdown**
    populateSkinSelector(spineObj.spineData);

    // Apply default skin if available
    const defaultSkin = spineObj.spineData.skins && spineObj.spineData.skins.length > 0 
      ? spineObj.spineData.skins[0].name 
      : null;
    if (defaultSkin) {
      setSkin(defaultSkin);
      // Set default selection in dropdown
      if (skinSelector) {
        Array.from(skinSelector.options).forEach(opt => {
          if (opt.value === defaultSkin) opt.selected = true;
        });
      }
    }

    // Play first animation if available
    if (anims.length > 0) {
      playAnimation(anims[0].name);
    }

    showTerminal(`Loaded Spine animation with ${anims.length} animations and ${spineObj.spineData.skins ? spineObj.spineData.skins.length : 0} skins`);
  } catch (err) {
    showTerminal('Runtime error: ' + (err && err.message ? err.message : err));
  }
}

// **NEW: Populate skin selector**
function populateSkinSelector(spineData) {
  if (!skinSelector) return;
  
  skinSelector.innerHTML = '<option value="">Select Skin</option>';
  const skins = spineData.skins || [];
  
  if (skins.length === 0) {
    // If no explicit skins, try default skin
    let opt = document.createElement("option");
    opt.value = "default";
    opt.textContent = "Default";
    skinSelector.appendChild(opt);
    return;
  }

  skins.forEach(skin => {
    let opt = document.createElement("option");
    opt.value = skin.name;
    opt.textContent = skin.name;
    skinSelector.appendChild(opt);
  });
}

// **ENHANCED: Animation selector with better feedback**
animSelector.addEventListener("change", e => {
  const animName = e.target.value;
  if (animName) {
    playAnimation(animName);
  }
});

// **NEW: Skin selector event listener**
if (skinSelector) {
  skinSelector.addEventListener("change", e => {
    const skinName = e.target.value;
    if (skinName) {
      setSkin(skinName);
    }
  });
}

// **NEW: Handle window resize**
window.addEventListener('resize', () => {
  if (spineObj) {
    spineObj.x = app.renderer.width / 2;
    spineObj.y = app.renderer.height / 2;
    
    // Re-apply scaling
    const bounds = spineObj.getBounds();
    const scaleX = (app.renderer.width * 0.8) / bounds.width;
    const scaleY = (app.renderer.height * 0.8) / bounds.height;
    spineObj.scale.set(Math.min(scaleX, scaleY, 1));
  }
});