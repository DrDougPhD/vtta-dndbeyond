import utils from "../../../utils.js";

// const SAVE_ALL = 0;
// const SAVE_NEW = 1;
// const SAVE_NONE = 2;

const FOLDER_BASE_COLOR = "#98020a"; // DDB red

/**
 * Creates a folder
 * @param {*} rootId
 * @param {*} folderName
 * @param {*} sourcebook
 * @param {*} entityName
 */
const createFolder = async (rootId, folderName, sourcebook, entityName) => {
  const folder = await Folder.create({
    name: folderName,
    type: entityName,
    color: FOLDER_BASE_COLOR,
    parent: rootId,
    flags: {
      vtta: {
        dndbeyond: {
          sourcebook: sourcebook.abbrev.toLowerCase(),
        },
      },
    },
  });

  return folder;
};

/**
 * Finds a folder
 * @param {*} rootId
 * @param {*} folderName
 * @param {*} sourcebook
 * @param {*} entityName
 */
const findFolder = async (rootId, folderName, sourcebook, entityName) => {
  // try and get the folder
  const folder = await game.folders.entities.find(
    (f) =>
      f.data.type === entityName &&
      f.data.name === folderName &&
      f.data.parent === rootId &&
      f.data.flags.vtta &&
      f.data.flags.vtta.dndbeyond &&
      f.data.flags.vtta.dndbeyond.sourcebook &&
      f.data.flags.vtta.dndbeyond.sourcebook === sourcebook.abbrev.toLowerCase()
  );
  return folder;
};

/**
 * Checks to see if folder exists or creates it
 * @param {*} rootId
 * @param {*} folderName
 * @param {*} sourcebook
 * @param {*} entityName
 */
const getOrCreateFolder = async (rootId, folderName, sourcebook, entityName) => {
  // try and get the folder
  const folder = await findFolder(rootId, folderName, sourcebook, entityName);

  if (folder) {
    return folder._id;
  } else {
    const newFolder = await createFolder(rootId, folderName, sourcebook, entityName);
    return newFolder._id;
  }
};

/**
 * Returns the folder object for the provided details
 * It will create any required folder structures
 * @param {*} structure
 * @param {*} entityName
 * @param {*} sourcebook
 */
const getFolder = async (structure, entityName, sourcebook) => {
  // use reduce to loop over folder structure to create and retrieve the correct
  // parentId to use to lookup the folder
  const parentId = await structure.reduce(async (acc, current) => {
    const accum = await acc;
    return getOrCreateFolder(accum, current, sourcebook, entityName);
  }, Promise.resolve(null));

  const folder = await game.folders.entities.find((folder) => folder._id === parentId);
  return folder;
};

const insertRollTables = (content) => {
  let orig = $("<div>" + content + "</div>");
  let processed = [];
  $(orig)
    .find('div[data-type="rolltable"]')
    .html(
      /* @this HTMLElement */ function () {
        let rollTableId = $(this).attr("data-id");
        if (rollTableId) {
          if (processed.includes(rollTableId)) {
            $(this).remove();
          } else {
            processed.push(rollTableId);
            let rollTable = game.tables.entities.find(
              (t) =>
                t.data.flags &&
                t.data.flags.vtta &&
                t.data.flags.vtta.dndbeyond &&
                t.data.flags.vtta.dndbeyond.rollTableId === rollTableId
            );
            const replacement = `<div class="rolltable"><span class="rolltable-head">Roll Table: </span><span class="rolltable-link">@RollTable[${rollTable._id}]{${rollTable.name}}</span></div>`;
            return replacement;
          }
        }
        return undefined;
      }
    );
  return $(orig).html();
};

const addJournalEntry = async (structure, sourcebook, name, content) => {
  const folder = await getFolder(structure, "JournalEntry", sourcebook);
  console.log("Folder: ");
  console.log(folder);
  let entry = game.journal.find((entry) => entry.data.folder === folder.data._id && entry.name === name);
  console.log("JE: Entry");
  console.log(entry);
  if (entry) {
    await JournalEntry.update({ _id: entry._id, content: insertRollTables(content) });
    // not sure if returning the entry here is okay. perhaps fetchting the updated one is better
    return entry;
  } else {
    entry = await JournalEntry.create({
      folder: folder._id,
      name: name,
      content: insertRollTables(content),
      img: null,
    });
  }
  return entry;
};

const addJournalEntries = async (data, scenes) => {
  // create the folders for all content before we import
  await getFolder([data.title], "JournalEntry", data.book);
  await Promise.all(
    data.scenes.map(async (scene) => {
      const structure = [data.title, scene.name];
      return getFolder(structure, "JournalEntry", data.book);
    })
  );

  // add main journal entry
  addJournalEntry([data.title], data.book, data.title, data.content);

  // create sub-entries for all scenes
  for (let s of data.scenes) {
    const entries = s.entries.filter((entry) => entry !== null);
    const scene = scenes.find((myScene) => myScene.name === s.name);
    // delete all VTTA created notes
    await scene.deleteEmbeddedEntity(
      "Note",
      scene.getEmbeddedCollection("Note").filter((note) => note.flags && note.flags.vtta)
    );

    // create the entities and place them on the scene, if possible
    const notes = [];
    for (let [index, entry] of entries.entries()) {
      const prefix = ("" + (index + 1)).padStart(2, "0");
      let je = await addJournalEntry([data.title, scene.name], data.book, prefix + " " + entry.name, entry.content);
      console.log("Position: ");
      console.log(entry.position);
      if (entry.position && entry.position.x && entry.position.y) {
        notes.push({
          entryId: je.data._id,
          flags: { vtta: true },
          icon: "modules/vtta-dndbeyond/icons/" + prefix + ".svg",
          x: entry.position.x,
          y: entry.position.y,
          iconSize: scene.data.grid,
        });
      }
    }
    console.log("Placing entry on scene");
    if (notes.length > 0) scene.createEmbeddedEntity("Note", notes);
  }
};

const updateScene = async (scene, folder) => {
  utils.log("Scene " + scene.name + " does exist already, updating...");
  let existing = await game.scenes.entities.find((s) => s.name === scene.name && s.data.folder === folder.data._id);
  let update = {
    width: scene.width,
    height: scene.height,
    backgroundColor: scene.backgroundColor,
  };
  if (scene.shiftX) update.shiftX = scene.shiftX;
  if (scene.shiftY) update.shiftY = scene.shiftY;
  if (scene.grid) update.grid = scene.grid;
  if (scene.gridDistance) update.gridDistance = scene.gridDistance;
  if (scene.gridType) update.gridType = scene.gridType;
  if (scene.globalLight) update.globalLight = scene.globalLight;
  await existing.update(update);

  // remove existing walls, add from import
  if (scene.walls && scene.walls.length > 0) {
    await existing.deleteEmbeddedEntity(
      "Wall",
      existing.getEmbeddedCollection("Wall").map((wall) => wall._id)
    );
    await existing.createEmbeddedEntity("Wall", scene.walls);
  }

  // remove existing lights, add from import
  if (scene.lights && scene.lights.length > 0) {
    await existing.deleteEmbeddedEntity(
      "AmbientLight",
      existing.getEmbeddedCollection("AmbientLight").map((light) => light._id)
    );
    await existing.createEmbeddedEntity("AmbientLight", scene.lights);
  }
  return existing;
};

const createScene = async (scene, folder) => {
  // this flag can be set to true if all GM maps are having the same dimensions as the player maps
  // and if Foundry stops resetting the scene dimensions to the original file dimensions if we stretched
  // the image on purpose to get the grids right
  const UNLOCK_GM_MAPS = false;
  const SCENE_FORMAT_WEBP = 0;
  const SCENE_FORMAT_ORIG = 1; // BOO!

  const uploadDirectory = game.settings.get("vtta-dndbeyond", "scene-upload-directory");
  const uploadFileFormat = game.settings.get("vtta-dndbeyond", "scene-format");

  let playerSrc = null,
    gmSrc = null;

  // upload player map
  let targetFilename = scene.playerLocal.replace(/\//g, "-").replace(".webp", "");
  if (uploadDirectory === SCENE_FORMAT_ORIG) {
    // replace webp with the desired file extension
    //&targetFilename.replace(".webp", ""); //"." + scene.playerSrc.split(".").pop());
    playerSrc = await utils.uploadImage(scene.playerSrc, uploadDirectory, targetFilename);
  } else {
    playerSrc = await utils.uploadImage(
      "https://cdn.vttassets.com/scenes/" + scene.playerLocal,
      uploadDirectory,
      targetFilename,
      false
    );
  }

  // upload GM map
  if (UNLOCK_GM_MAPS && scene.gmSrc && scene.gmLocal) {
    let targetFilename = scene.gmLocal.replace(/\//g, "-").replace(".webp", "");
    if (uploadDirectory === SCENE_FORMAT_ORIG) {
      // replace webp with the desired file extension
      //targetFilename.replace(".webp", "." + scene.gmSrc.split(".").pop());
      gmSrc = await utils.uploadImage(scene.gmSrc, uploadDirectory, targetFilename);
    } else {
      gmSrc = await utils.uploadImage(
        "https://cdn.vttassets.com/scenes/" + scene.gmLocal,
        uploadDirectory,
        targetFilename,
        false
      );
    }
  }

  // upload Thumbnail
  const thumb = await utils.uploadImage(
    "https://cdn.vttassets.com/scenes/" + scene.thumb,
    uploadDirectory,
    scene.thumb.replace(/\//g, "-").replace(".webp", ""),
    false
  );

  let createData = {
    name: scene.name,
    img: playerSrc,
    thumb: thumb,
    folder: folder._id,
    width: scene.width,
    height: scene.height,
    backgroundColor: scene.backgroundColor,
    globalLight: scene.globalLight ? scene.globalLight : true,
    navigation: false,
  };

  // store the original dimensions in a flag to retain them on switching
  createData.flags = {
    vtta: {
      width: scene.width,
      height: scene.height,
      thumb: scene.thumb,
    },
  };

  // enable map switching
  if (playerSrc && gmSrc) {
    createData.flags.vtta.alt = {
      GM: gmSrc,
      Player: playerSrc,
    };
  }

  if (scene.shiftX) createData.shiftX = scene.shiftX;
  if (scene.shiftY) createData.shiftY = scene.shiftY;
  if (scene.grid) createData.grid = scene.grid;
  if (scene.gridDistance) createData.gridDistance = scene.gridDistance;
  if (scene.gridType) createData.gridType = scene.gridType;

  let existing = await Scene.create(createData);

  if (scene.walls && scene.walls.length > 0) {
    await existing.createEmbeddedEntity("Wall", scene.walls);
  }
  if (scene.lights && scene.lights.length > 0) {
    await existing.createEmbeddedEntity("AmbientLight", scene.lights);
  }

  return existing;
};

const addScenes = async (data) => {
  const folder = await getFolder([data.book.name, data.title], "Scene", data.book);

  const existingScenes = await Promise.all(
    data.scenes
      .filter((scene) =>
        game.scenes.entities.some((s) => {
          return s.name === scene.name && s.data.folder === folder.data._id;
        })
      )
      .map((scene) => {
        return scene.name;
      })
  );

  // check if the scene already exists
  const scenes = [];
  for (let scene of data.scenes) {
    if (existingScenes && existingScenes.includes(scene.name)) {
      scenes.push(updateScene(scene, folder));
    } else {
      scenes.push(createScene(scene, folder));
    }
  }
  return await Promise.all(scenes);
};

const addRollTable = async (table, folder) => {
  let rollTable = await RollTable.create({
    name: table.name,
    formula: `1d${table.max}`,
    folder: folder._id,
    flags: {
      vtta: {
        dndbeyond: {
          rollTableId: table.id,
        },
      },
    },
  });
  await rollTable.createEmbeddedEntity("TableResult", table.results);
  return rollTable;
};

const addRollTables = async (data) => {
  // folderName, rollTables, sourcebook) => {
  const folderName = data.title;
  const rollTables = data.rollTables;

  let folder = await getFolder([folderName], "RollTable", data.book);

  const tables = await Promise.all(
    rollTables.map(async (table) => {
      return addRollTable(table, folder);
    })
  );
  return tables;
};

const parsePage = async (data) => {
  var tables;
  if (data.rollTables && data.rollTables.length > 0) {
    tables = await addRollTables(data);
  }

  const scenes = await addScenes(data);

  // add all Journal Entries
  var journals = await addJournalEntries(data, scenes);

  return [tables, journals, scenes];
};

let addPage = (body) => {
  return new Promise((resolve, reject) => {
    const { data } = body;

    parsePage(data)
      .then(() => {
        resolve(true);
      })
      .catch((error) => {
        console.error(`error parsing page: ${error}`); // eslint-disable-line no-console
        reject(error);
      });
  });
};

export default addPage;
